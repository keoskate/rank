#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-risk-parity-vt.js
//
// Five-gate validation of a 3-leg inverse-vol risk-parity portfolio with a
// vol-target overlay.
//
// Strategy (pre-registered):
//   Legs: equity E ∈ {QQQ, SOXX}, GLD, bond B ∈ {IEF, TLT}
//
//   Monthly weights (set at the close of the first trading day of month m,
//   computed from data through the PRIOR trading day):
//     w_j ∝ 1 / vol63_j,  normalized to sum 1
//   where vol63_j = annualized stdev of leg j's daily returns over trailing
//   63 days (sample stdev, ddof=1), using prices through the day before the
//   first trading day of month m.  No lookahead: weights for month m are
//   entirely determined before any return of month m is observed.
//
//   Daily mix return (returns-space approximation, weights held fixed between
//   monthly rebalances applied to each leg's simple return):
//     r_mix_i = Σ_j w_j * r_j_i
//
//   Vol-target overlay (exactly mirrors validate-vol-target-mix champion):
//     s_i = min(1, targetVol / RV20(r_mix, through i-1))
//   where RV20 is annualized sample stdev of the last 20 non-null mix returns
//   strictly before day i (ddof=1). s_i capped at 1 (no leverage).
//
//   Strategy daily return:
//     ret_i = s_i * r_mix_i - costs_i
//   where costs_i = (5/10000) * costMultiplier * Σ_j |effW_j_i - effW_j_{i-1}|
//   and effW_j_i = s_i * w_j (effective weight of leg j on day i).
//
//   Mechanism: diversification across 3 low-corr assets (equity/gold/bond) via
//   inverse-vol weighting + vol management; edge is risk reduction, not return
//   enhancement.
//
// PRE-REGISTERED GRID (8 candidates — do not alter):
//   E{QQQ, SOXX} × B{IEF, TLT} × targetVol{0.10, 0.14}
//
// validateStrategy spec:
//   family:          'vol-managed'
//   strategyId:      'risk-parity-3leg-vt-WF-OOS'
//   universe:        ['QQQ','SOXX','GLD','IEF','TLT','SPY']
//   controlUniverse: ['QQQ','SOXX','GLD','IEF','TLT']
//   benchmarkSymbol: 'SPY'
//   start:           '2016-01-04'
//
//   node scripts/backtests/validate-risk-parity-vt.js

require('dotenv').config();
const { volTargetMixCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const VOL_WINDOW_WEIGHT = 63; // trailing days for inverse-vol weight estimation
const VOL_WINDOW_SCALAR = 20; // trailing days for vol-target overlay (mirrors champion)
const COST_BPS = 5;           // bps per side per unit weight change
const START = '2016-01-04';

// PRE-REGISTERED GRID — DO NOT ALTER
const EQUITY_LEGS = ['QQQ', 'SOXX'];
const BOND_LEGS = ['IEF', 'TLT'];
const TARGET_VOLS = [0.10, 0.14];

const GRID = [];
for (const E of EQUITY_LEGS) {
  for (const B of BOND_LEGS) {
    for (const targetVol of TARGET_VOLS) {
      GRID.push({ E, B, targetVol });
    }
  }
}
// GRID.length === 8 — pre-registered

/**
 * Annualized sample stdev (ddof=1, sqrt(252)) of the last `window` non-null
 * values strictly before index `i` in `returns`. Returns null if underfilled.
 * Exactly matches volTargetMixCore.realizedVolAt conventions.
 */
function realizedVol(returns, i, window) {
  const slice = [];
  for (let j = i - 1; j >= 0 && slice.length < window; j--) {
    if (returns[j] != null) slice.push(returns[j]);
  }
  if (slice.length < window) return null;
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * Compute inverse-vol monthly weights for 3 legs (E, GLD, B) at each
 * rebalance point.
 *
 * Rebalance convention: at the start of month m (first trading day), we use
 * all returns data through the day BEFORE that first trading day.  Weights are
 * held constant for the whole month (returns-space approximation).
 *
 * @param {string[]} dates   - master calendar dates (oldest → newest)
 * @param {Object}   series  - { [sym]: number[] } closes aligned to dates
 * @param {string}   E       - equity leg symbol
 * @param {string}   B       - bond leg symbol
 * @returns {number[][]}     - weights[i] = [wE, wGLD, wB] for day i (null until
 *                             we have enough history for ALL three legs)
 */
function buildMonthlyWeights(dates, series, E, B) {
  const legs = [E, 'GLD', B];
  const n = dates.length;

  // Precompute daily simple returns for each leg (null at i=0)
  const legReturns = {};
  for (const sym of legs) {
    const px = series[sym];
    legReturns[sym] = dates.map((_, i) => {
      if (i === 0 || px[i] == null || px[i - 1] == null) return null;
      return px[i] / px[i - 1] - 1;
    });
  }

  // For each calendar date, determine the "active" monthly weight vector.
  // We walk forward and reset weights at the start of each new month.
  // Current month tag — seeded to a sentinel so the first day triggers a reset.
  let currentMonthTag = '';
  let currentWeights = null; // [wE, wGLD, wB] or null (pre-warmup)

  const weights = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const monthTag = dates[i].slice(0, 7); // 'YYYY-MM'

    if (monthTag !== currentMonthTag) {
      // First trading day of a new month: compute weights from data through i-1.
      // We need vol63 for every leg using returns through index i-1 (exclusive).
      currentMonthTag = monthTag;

      const vols = [];
      let allValid = true;
      for (const sym of legs) {
        const rv = realizedVol(legReturns[sym], i, VOL_WINDOW_WEIGHT);
        if (rv == null || !(rv > 0)) {
          allValid = false;
          break;
        }
        vols.push(rv);
      }

      if (!allValid) {
        // Not enough history yet — weights remain null
        currentWeights = null;
      } else {
        // Inverse-vol weights, normalized to sum 1
        const invVols = vols.map(v => 1 / v);
        const totalInvVol = invVols.reduce((s, v) => s + v, 0);
        currentWeights = invVols.map(v => v / totalInvVol);
      }
    }

    // Apply the current month's weights (null until enough history)
    weights[i] = currentWeights; // reference to same array (immutable within month)
  }

  return weights;
}

/**
 * Simulate the 3-leg risk-parity strategy for a given (E, B, targetVol)
 * combination.  Returns an array of daily simple returns aligned to `dates`;
 * null before we have enough history to compute both weights and the overlay
 * scalar.
 *
 * HARD RULES enforced:
 *  1. Monthly weights computed from data strictly before the first day of month m.
 *  2. Vol-target scalar s_i computed from mix returns strictly before day i.
 *  3. Effective weight effW_j_i = s_i * w_j; costs on |effW_j_i - effW_j_{i-1}|.
 *  4. No leverage: s_i capped at 1.
 */
function simulateCombination(dates, series, E, B, targetVol, costMultiplier) {
  const legs = [E, 'GLD', B];
  const n = dates.length;

  // Step 1: build monthly inverse-vol weights
  const monthlyWeights = buildMonthlyWeights(dates, series, E, B);

  // Step 2: compute daily mix returns (returns-space, no lookahead)
  //   r_mix_i = Σ_j w_j * r_j_i   (weights already set for month m before day i)
  const mixReturns = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const w = monthlyWeights[i]; // weights valid for this day
    if (w == null) continue;

    let r = 0;
    let allValid = true;
    for (let j = 0; j < legs.length; j++) {
      const sym = legs[j];
      const px = series[sym];
      if (px[i] == null || px[i - 1] == null) { allValid = false; break; }
      r += w[j] * (px[i] / px[i - 1] - 1);
    }
    if (allValid) mixReturns[i] = r;
  }

  // Step 3: vol-target scalar (reuses volTargetMixCore.realizedVolAt logic
  // via our local realizedVol helper — same semantics: ddof=1, sqrt(252),
  // 20 non-null returns strictly before i).
  // NOTE: we intentionally do NOT call volTargetMixCore.scalarSeries() here
  // because that function hard-codes a two-asset mix (closesA / closesB).
  // The faithfulness note explains why: this strategy has a different shape
  // (3-leg inverse-vol mix vs. 2-leg fixed-weight mix), so the certified
  // vol-target-mix core cannot be the decision-sharing bridge for gate 2.
  // The scalar computation is the SAME arithmetic — so we reference the same
  // realizedVol formula — but the input mix is produced here, not by
  // mixDailyReturns.

  // Step 4: assemble final returns with costs
  const out = new Array(n).fill(null);
  // Track previous effective weights for turnover cost computation
  let prevEffW = null; // [effWE, effWGLD, effWB] or null

  for (let i = 1; i < n; i++) {
    if (mixReturns[i] == null) {
      prevEffW = null;
      continue;
    }

    const w = monthlyWeights[i]; // [wE, wGLD, wB] — always set when mixReturns[i] != null
    if (w == null) { prevEffW = null; continue; }

    // Vol-target scalar: data through i-1 (no lookahead)
    const rv = realizedVol(mixReturns, i, VOL_WINDOW_SCALAR);
    if (rv == null || !(rv > 0)) {
      prevEffW = null;
      continue;
    }
    const s = Math.min(1, targetVol / rv);

    // Effective weights for this day
    const effW = w.map(wj => s * wj);

    // Turnover cost: Σ_j |effW_j_i - effW_j_{i-1}| * (5/10000) * costMultiplier
    // If prevEffW is null (first valid day), treat prior effective weights as 0.
    const prevEff = prevEffW !== null ? prevEffW : [0, 0, 0];
    let totalTurnover = 0;
    for (let j = 0; j < legs.length; j++) {
      totalTurnover += Math.abs(effW[j] - prevEff[j]);
    }
    const cost = totalTurnover * (COST_BPS / 10000) * costMultiplier;

    out[i] = s * mixReturns[i] - cost;
    prevEffW = effW;
  }

  return out;
}

async function main() {
  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'risk-parity-3leg-vt-WF-OOS',
    script: 'scripts/backtests/validate-risk-parity-vt.js',
    description:
      '3-leg inverse-vol risk parity (equity/GLD/bond) with a vol-target overlay. ' +
      'Monthly weights w_j ∝ 1/vol63_j (normalized, computed from data through the ' +
      'prior trading day before month start). Daily mix return = Σ w_j·r_j (returns-' +
      'space approximation, weights fixed within month). Vol-target scalar s_i = ' +
      'min(1, targetVol/RV20_{i-1}), no leverage. Costs: 5bps×|ΔeffW| per leg per day. ' +
      'Grid: E{QQQ,SOXX} × B{IEF,TLT} × targetVol{0.10,0.14} → 8 candidates.',
    universe: ['QQQ', 'SOXX', 'GLD', 'IEF', 'TLT', 'SPY'],
    controlUniverse: ['QQQ', 'SOXX', 'GLD', 'IEF', 'TLT'],
    benchmarkSymbol: 'SPY',
    start: START,

    // FAITHFULNESS: this strategy has a different shape from the certified
    // vol-target-mix (2-leg fixed-weight vs. 3-leg inverse-vol).
    // volTargetMixCore.mixDailyReturns and .scalarSeries are NOT called here
    // because they hard-code the two-asset structure.  The scalar arithmetic
    // is identical (same formula, same conventions); a dedicated cert script
    // (certify-risk-parity-vt.js) would be needed to certify a live plugin.
    faithfulness: {
      status: 'not_run',
      note: 'research — shares volTargetMixCore where applicable; dedicated cert pending',
    },

    buildCandidates: ({ dates, series, costMultiplier }) => {
      return GRID.map(({ E, B, targetVol }) => {
        const returns = simulateCombination(
          dates, series, E, B, targetVol, costMultiplier
        );
        return {
          params: {
            equityLeg: E,
            bondLeg: B,
            targetVol,
            volWindowWeight: VOL_WINDOW_WEIGHT,
            volWindowScalar: VOL_WINDOW_SCALAR,
          },
          returns,
        };
      });
    },

    notes: [
      'MECHANISM: diversification across 3 low-corr assets (equity/gold/bond) via inverse-vol ' +
        'weighting + vol management; edge is risk reduction, not return enhancement. Control is EW ' +
        'of the 5-name universe (monthly-rebalanced, 2bps/month, identical OOS dates).',
      'WEIGHT COMPUTATION (no lookahead): monthly weights w_j ∝ 1/vol63_j computed from returns ' +
        'data through the trading day BEFORE the first trading day of month m; applied from that ' +
        'day\'s close onward for the full month (returns-space approximation).',
      'VOL-TARGET OVERLAY: s_i = min(1, targetVol/RV20_{i-1}), RV20 = annualized sample stdev ' +
        '(ddof=1, sqrt(252)) of the 20 most-recent non-null mix returns strictly before day i. ' +
        'Capped at 1 — no leverage.',
      'COST MODEL: 5bps per unit absolute change in effective weight, charged per leg per day. ' +
        'effW_j_i = s_i * w_j; turnover = Σ_j |effW_j_i - effW_j_{i-1}|. Matches the champion ' +
        'validate-vol-target-mix blended-turnover treatment (rule 4).',
      'PRE-REGISTERED GRID (8): E{QQQ,SOXX} × B{IEF,TLT} × targetVol{0.10,0.14}. Parameters ' +
        'are IMMUTABLE; bugs may be fixed but grid may not be re-tuned.',
      'FAITHFULNESS: no live plugin exists; strategy is research-only and cannot reach VALIDATED. ' +
        'A dedicated certify-risk-parity-vt.js would be required before deployment.',
    ],

    extraReport: {
      grid: GRID,
      volWindowWeight: VOL_WINDOW_WEIGHT,
      volWindowScalar: VOL_WINDOW_SCALAR,
      costBps: COST_BPS,
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
