#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-momtilt-rp.js
//
// Five-gate validation: momentum-tilted 3-leg risk parity + vol target.
//
// Construction:
//   Legs: E (QQQ or SOXX), GLD, IEF.
//
//   1. MONTHLY REBALANCE (first trading day of each month, using only data
//      through the PRIOR session):
//      a. Inverse-vol63 weights: for each leg j, RV63_j = annualized stdev of
//         the leg's trailing 63 daily returns (sample stdev × sqrt(252)), using
//         data through the day BEFORE the first trading day.  ivW_j = 1/RV63_j,
//         normalized so Σ ivW_j = 1.
//      b. Momentum tilt: for each leg j, compute 12-1 momentum =
//         close[t-21] / close[t-252] - 1 (data through the day before the
//         rebalance).  Multiply ivW_j by 1.25 if momentum > 0, else by 0.75.
//         Renormalize the tilted weights to sum to 1.
//      These tilted weights apply from the rebalance day's close onward and
//      drift with intra-month returns until the next rebalance.
//
//   2. DAILY VOL-TARGET OVERLAY:
//      On each day i, compute RV20 of the mix's trailing 20 daily returns
//      (data through i-1 only).
//      scalar_i = min(1, targetVol / RV20)   [targetVol = 0.12]
//      Effective weight of leg j on day i: effW_j,i = monthlyW_j,i × scalar_i
//
//   3. COSTS (rule 4):
//      Each day i: costDrag_i = (5/10000) * costMultiplier * Σ_j |effW_j,i - effW_j,i-1|
//
// Pre-registered grid (2 candidates — DO NOT ALTER):
//   E ∈ {QQQ, SOXX}   (targetVol = 0.12, tilt multipliers ±25% fixed)
//
//   node scripts/backtests/validate-momtilt-rp.js

require('dotenv').config();
const { volTargetMixCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const VOL_WINDOW_REBAL = 63;  // inverse-vol weight look-back (monthly rebalance)
const VOL_WINDOW_SCALAR = 20; // realized-vol look-back for vol-target scalar
const TARGET_VOL = 0.12;      // vol-target (fixed, pre-registered)
const TILT_UP = 1.25;         // weight multiplier when 12-1 momentum > 0
const TILT_DOWN = 0.75;       // weight multiplier when 12-1 momentum ≤ 0
const MOM_SHORT = 21;         // days for 1-month lag (12-1 convention)
const MOM_LONG = 252;         // days for 12-month window
const COST_BPS = 5;           // bps per side, per unit absolute weight change
const START = '2016-01-04';

// PRE-REGISTERED GRID — DO NOT ALTER
const GRID = [
  { equityLeg: 'QQQ' },
  { equityLeg: 'SOXX' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Annualized realized vol (sample stdev × sqrt(252)) of the last `window`
 * non-null returns strictly BEFORE index i.
 * Returns null if underfilled.
 */
function realizedVol(returnsArr, i, window) {
  const slice = [];
  for (let j = i - 1; j >= 0 && slice.length < window; j--) {
    if (returnsArr[j] != null) slice.push(returnsArr[j]);
  }
  if (slice.length < window) return null;
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance =
    slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * Build per-day daily simple returns for one candidate (equityLeg).
 *
 * Returns an array parallel to `dates`; null before the strategy is ready
 * (insufficient history for the weight computation).
 *
 * NO LOOKAHEAD: all data used for a decision on day i comes through i-1.
 *   - Monthly weights are computed from closes through the day BEFORE the
 *     first trading day of the month.
 *   - Momentum uses close[t-21] / close[t-252] - 1 where t is the day before
 *     the rebalance.
 *   - Vol-target scalar uses RV20 through i-1.
 */
function buildReturns(dates, series, equityLeg, costMultiplier) {
  const legs = [equityLeg, 'GLD', 'IEF'];
  const pxArr = legs.map(sym => series[sym]); // parallel to dates

  const n = dates.length;
  const out = new Array(n).fill(null);

  // Monthly base weights (tilted, normalized); update at each month boundary.
  // Drifted effective monthly weights (before scalar) parallel to dates.
  let monthlyW = null;     // [wE, wGLD, wIEF] at rebalance, drift-adjusted
  let driftedW = null;     // intra-month drift (sum not necessarily 1)
  // Initialize to the first date's month so the rebalance fires only when the
  // calendar month actually rolls over (not spuriously on day 1).
  let currentMonth = dates.length ? dates[0].slice(0, 7) : '';

  // Vol-target scalar state
  // Mix daily returns (cost-free, for scalar computation)
  const mixReturns = new Array(n).fill(null);

  // Previous effective weights (for cost calculation)
  let prevEffW = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const date = dates[i];
    const month = date.slice(0, 7);

    // ── Monthly rebalance ──────────────────────────────────────────────────
    // Triggered on the first trading day of a new month (i > 0, month changed)
    // All computation uses data through i-1 (no lookahead).
    if (i > 0 && month !== currentMonth) {
      currentMonth = month;
      // Need VOL_WINDOW_REBAL returns and MOM_LONG closes before i for weights
      if (i >= MOM_LONG + 1) {
        // (a) Inverse-vol63 weights using returns through i-1
        const ivW = legs.map((_, legIdx) => {
          const px = pxArr[legIdx];
          // Build trailing 63 daily returns ending at i-1
          const rets = [];
          for (let k = i - 1; k >= 1 && rets.length < VOL_WINDOW_REBAL; k--) {
            if (px[k] != null && px[k - 1] != null && px[k - 1] > 0) {
              rets.push(px[k] / px[k - 1] - 1);
            }
          }
          if (rets.length < VOL_WINDOW_REBAL) return null;
          const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
          const variance =
            rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1);
          const rv = Math.sqrt(variance * 252);
          return rv > 0 ? 1 / rv : null;
        });

        if (ivW.every(v => v != null)) {
          const ivSum = ivW.reduce((s, v) => s + v, 0);
          const normalized = ivW.map(v => v / ivSum);

          // (b) Momentum tilt: 12-1 = close[i-1-MOM_SHORT] / close[i-1-MOM_LONG] - 1
          // t = i - 1 (last completed session); t-21 = i-1-21; t-252 = i-1-252
          const shortIdx = i - 1 - MOM_SHORT;   // close 1 month ago
          const longIdx  = i - 1 - MOM_LONG;    // close 12 months ago

          const tilted = legs.map((_, legIdx) => {
            const px = pxArr[legIdx];
            const pShort = shortIdx >= 0 ? px[shortIdx] : null;
            const pLong  = longIdx  >= 0 ? px[longIdx]  : null;
            let mult = TILT_DOWN; // default: no momentum signal
            if (pShort != null && pLong != null && pLong > 0) {
              const mom = pShort / pLong - 1;
              mult = mom > 0 ? TILT_UP : TILT_DOWN;
            }
            return normalized[legIdx] * mult;
          });

          const tiltSum = tilted.reduce((s, v) => s + v, 0);
          monthlyW = tiltSum > 0 ? tilted.map(v => v / tiltSum) : normalized;
          // Reset drift: new rebalance = new starting point
          driftedW = [...monthlyW];
        }
      }
    }

    // ── Intra-month weight drift ───────────────────────────────────────────
    if (i > 0 && driftedW != null) {
      // Drift previous day's effective monthly weights by today's individual
      // leg returns so that the total portfolio weight evolves naturally.
      // driftedW is the MONTHLY weight (before scalar). The scalar applies after.
      const newDrifted = legs.map((_, legIdx) => {
        const px = pxArr[legIdx];
        if (px[i] != null && px[i - 1] != null && px[i - 1] > 0) {
          const legR = px[i] / px[i - 1] - 1;
          return driftedW[legIdx] * (1 + legR);
        }
        return driftedW[legIdx];
      });
      // Compute mix return from drift
      let mixR = 0;
      for (let legIdx = 0; legIdx < legs.length; legIdx++) {
        const px = pxArr[legIdx];
        if (px[i] != null && px[i - 1] != null && px[i - 1] > 0) {
          mixR += driftedW[legIdx] * (px[i] / px[i - 1] - 1);
        }
      }
      mixReturns[i] = mixR;

      // Renormalize drifted weights (so they still reflect portfolio fractions)
      const driftSum = newDrifted.reduce((s, v) => s + v, 0);
      driftedW = driftSum > 0 ? newDrifted.map(v => v / driftSum) : driftedW;
    }

    if (driftedW == null || mixReturns[i] == null) {
      prevEffW = [0, 0, 0];
      continue;
    }

    // ── Vol-target scalar ──────────────────────────────────────────────────
    // RV20 of mix returns through i-1 (no lookahead)
    const rv20 = realizedVol(mixReturns, i, VOL_WINDOW_SCALAR);
    if (rv20 == null || !(rv20 > 0)) {
      prevEffW = [0, 0, 0];
      continue;
    }

    const scalar = Math.min(1, TARGET_VOL / rv20);

    // ── Effective weights day i ────────────────────────────────────────────
    const effW = driftedW.map(w => w * scalar);

    // ── Cost drag ─────────────────────────────────────────────────────────
    let turnover = 0;
    for (let legIdx = 0; legIdx < legs.length; legIdx++) {
      turnover += Math.abs(effW[legIdx] - prevEffW[legIdx]);
    }
    const costDrag = (COST_BPS / 10000) * costMultiplier * turnover;

    // ── Strategy return day i ─────────────────────────────────────────────
    out[i] = mixReturns[i] * scalar - costDrag;
    prevEffW = effW;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validator entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'momtilt-riskparity-WF-OOS',
    script: 'scripts/backtests/validate-momtilt-rp.js',
    description:
      'Momentum-tilted 3-leg risk parity + vol-target overlay. ' +
      'Monthly inverse-vol63 weights across (E, GLD, IEF) — E ∈ {QQQ, SOXX} — ' +
      'tilted ±25% by 12-1 momentum (renormalized). ' +
      'Daily vol-target scalar: s = min(1, 0.12/RV20(mix)). ' +
      'Costs: 5bps × |ΔeffW| per leg per day. ' +
      'Tests whether trend adds ON TOP of diversification (tilt) rather than ' +
      'replacing it (switching, which failed).',
    universe: ['QQQ', 'SOXX', 'GLD', 'IEF', 'SPY'],
    controlUniverse: ['QQQ', 'SOXX', 'GLD', 'IEF'],
    benchmarkSymbol: 'SPY',
    start: START,
    faithfulness: {
      status: 'not_run',
      note: 'research — shares volTargetMixCore where applicable; dedicated cert pending',
    },
    buildCandidates: ({ dates, series, costMultiplier }) => {
      return GRID.map(({ equityLeg }) => {
        const returns = buildReturns(dates, series, equityLeg, costMultiplier);
        return {
          params: {
            equityLeg,
            volWindowRebal: VOL_WINDOW_REBAL,
            volWindowScalar: VOL_WINDOW_SCALAR,
            targetVol: TARGET_VOL,
            tiltUp: TILT_UP,
            tiltDown: TILT_DOWN,
            momShortDays: MOM_SHORT,
            momLongDays: MOM_LONG,
          },
          returns,
        };
      });
    },
    notes: [
      'RESEARCH — not deployable until a live plugin shares the decision core and a faithfulness cert runs.',
      'Grid: equityLeg ∈ {QQQ, SOXX} × targetVol=0.12, tilt±25% (fixed). 2 candidates.',
      'Inverse-vol63 weights: each leg\'s RV63 computed from 63 trailing daily returns through the day BEFORE the first trading day of the month (no lookahead).',
      'Momentum tilt: 12-1 = close[t-21] / close[t-252] - 1 (t = last session before rebalance); multiply each leg\'s weight by 1.25 if >0, else 0.75; renormalize to sum 1.',
      'Vol-target scalar: min(1, 0.12 / RV20_mix) — RV20 uses 20 trailing mix returns through i-1 (no lookahead). No leverage: scalar capped at 1.',
      'Effective weight of leg j on day i: effW_j = monthlyDriftedW_j × scalar_i.',
      'Cost model: (5/10000) × costMultiplier × Σ_j |effW_j,i − effW_j,i-1| per day — blended turnover covers all three legs including scalar-driven changes.',
      'Monthly weights drift intra-month with individual leg returns (no forced daily rebalance), reset at the close of the first trading day of each new month.',
      'Control (gate 3): EW(QQQ, SOXX, GLD, IEF) monthly-rebalanced — tests whether risk-parity + momentum tilt + vol target adds vs naive equal-weight holding.',
      'Hypothesis: tilt as a modifier ON TOP of diversification avoids the switching failure (switching entirely to/from bonds failed cross-sectional momentum validation).',
    ],
    extraReport: {
      grid: GRID,
      volWindowRebal: VOL_WINDOW_REBAL,
      volWindowScalar: VOL_WINDOW_SCALAR,
      targetVol: TARGET_VOL,
      tiltUp: TILT_UP,
      tiltDown: TILT_DOWN,
      momShortDays: MOM_SHORT,
      momLongDays: MOM_LONG,
      costBps: COST_BPS,
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
