#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-vol-engine.js
//
// Five-gate validation: risk-estimator comparison on the champion vol-target mix.
//
// The champion strategy (validate-vol-target-mix.js) uses a fixed roll-20
// realized-vol estimator to drive the exposure scalar.  This study holds the
// mix FIXED at 50/50 SOXX/GLD (the champion's chosen weight, targetVol 0.12)
// and varies ONLY the risk estimator, asking: does a different estimator of
// realized variance produce a more stable or more efficient scalar?
//
// Four pre-registered estimators:
//   (a) roll20-vol  — sqrt(252)·stdev(last 20, ddof=1); s = min(1, 0.12/RV)
//                     [replication control — should reproduce ~the champion]
//   (b) ewma-vol    — EWMA variance v_i = 0.94·v_{i-1} + 0.06·r²_{i-1},
//                     seeded on the variance of the first 20 returns;
//                     RV = sqrt(252·v); s = min(1, 0.12/RV)
//   (c) ewma-var    — same EWMA variance, but VARIANCE scaling:
//                     s = min(1, (0.12²)/(252·v))   [Moreira-Muir style]
//   (d) semivol20   — downside semideviation over last 20:
//                     RV = sqrt(252·Σmin(r,0)²/(n-1)), floored at 0.005;
//                     target 0.12·(1/sqrt(2)) ≈ 0.08485 so average exposure
//                     is comparable to roll20-vol at the same targetVol.
//
// PRE-REGISTERED GRID (4): one per estimator.  No other knobs.
//
// COST MODEL: 5bps overlay cost per unit absolute change in scalar, per side,
// matching the champion's blended-turnover treatment.  The base mix is
// cost-free at the signal layer (mixDailyReturns from quant-core); execution
// costs are embedded in the scalar-turnover term below.
//
//   node scripts/backtests/validate-vol-engine.js   (build-only in phase 1)

require('dotenv').config();
const { volTargetMixCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const MIX_W = 0.5;          // champion's elected weight — frozen
const TARGET_VOL = 0.12;    // champion's elected targetVol — frozen
const COST_BPS = 5;         // blended turnover cost bps per unit scalar change
const VOL_WINDOW = 20;      // trailing days for rolling estimators
const EWMA_LAMBDA = 0.94;   // EWMA decay factor (RiskMetrics standard)
const EWMA_SEED_DAYS = 20;  // seed EWMA variance from first N returns
const SEMI_FLOOR = 0.005;   // floor annualized semivol to avoid div-by-zero
// Semivol normalization: E[downside-var] ≈ half total variance for symmetric
// distributions, so downside stdev ≈ totalVol/sqrt(2).  Target is adjusted
// accordingly so the average scalar stays comparable to roll20-vol.
const SEMI_TARGET = TARGET_VOL / Math.sqrt(2); // ≈ 0.08485

const START = '2016-01-04';

// ---------------------------------------------------------------------------
// PRE-REGISTERED GRID (do not alter)
// ---------------------------------------------------------------------------
const GRID = [
  { estimator: 'roll20-vol' },
  { estimator: 'ewma-vol' },
  { estimator: 'ewma-var' },
  { estimator: 'semivol20' },
];

// ---------------------------------------------------------------------------
// Base mix returns (cost-free signal path — certified core)
// ---------------------------------------------------------------------------
/**
 * Build cost-free daily mix returns aligned to `dates` using the certified
 * volTargetMixCore.mixDailyReturns.  Returns array parallel to dates; null
 * before both legs have a prior close.
 */
function buildMixReturns(series, dates) {
  // series[sym] is already a positional array parallel to dates (from alignCloses).
  // Pass directly to the certified core — same pure function as champion + live plugin.
  return volTargetMixCore.mixDailyReturns(
    dates,
    series['SOXX'] || dates.map(() => null),
    series['GLD']  || dates.map(() => null),
    MIX_W
  );
}

// ---------------------------------------------------------------------------
// Scalar builders — one per estimator
// ---------------------------------------------------------------------------

/**
 * (a) roll20-vol: trailing 20-day sample stdev annualized.
 * Replicates the champion's scalar exactly (uses realizedVolAt from core).
 * Returns scalar array parallel to mixReturns.
 */
function roll20VolScalars(mixReturns) {
  const n = mixReturns.length;
  const scalars = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const rv = volTargetMixCore.realizedVolAt(mixReturns, i, VOL_WINDOW);
    if (rv == null || !(rv > 0)) continue;
    scalars[i] = Math.min(1, TARGET_VOL / rv);
  }
  return scalars;
}

/**
 * (b) ewma-vol: EWMA variance, vol scaling.
 * v_i = λ·v_{i-1} + (1-λ)·r²_{i-1}; seeded from first EWMA_SEED_DAYS returns.
 * RV = sqrt(252·v); s = min(1, targetVol/RV).
 * Returns scalar array parallel to mixReturns.
 */
function ewmaVolScalars(mixReturns) {
  const n = mixReturns.length;
  const scalars = new Array(n).fill(null);

  // Collect seed returns (first EWMA_SEED_DAYS non-null)
  const seedReturns = [];
  let seedEndIdx = -1;
  for (let i = 0; i < n && seedReturns.length < EWMA_SEED_DAYS; i++) {
    if (mixReturns[i] != null) {
      seedReturns.push(mixReturns[i]);
      seedEndIdx = i;
    }
  }
  if (seedReturns.length < EWMA_SEED_DAYS) return scalars; // not enough history

  // Seed variance = sample variance of first EWMA_SEED_DAYS returns
  const seedMean = seedReturns.reduce((s, v) => s + v, 0) / seedReturns.length;
  let v =
    seedReturns.reduce((s, r) => s + (r - seedMean) ** 2, 0) /
    (seedReturns.length - 1);

  // Walk forward from seedEndIdx onward, updating EWMA with r_{i-1}
  // scalar[i] uses variance v which was built from data through i-1
  for (let i = seedEndIdx + 1; i < n; i++) {
    const rPrev = mixReturns[i - 1];
    if (rPrev != null) {
      v = EWMA_LAMBDA * v + (1 - EWMA_LAMBDA) * rPrev * rPrev;
    }
    // v is now the variance estimate based on data through i-1
    if (!(v > 0)) continue;
    const rv = Math.sqrt(252 * v);
    scalars[i] = Math.min(1, TARGET_VOL / rv);
  }
  return scalars;
}

/**
 * (c) ewma-var: same EWMA variance, but variance-managed scaling (Moreira-Muir).
 * s = min(1, targetVol² / (252·v)).
 * Same seed logic as ewma-vol.
 * Returns scalar array parallel to mixReturns.
 */
function ewmaVarScalars(mixReturns) {
  const n = mixReturns.length;
  const scalars = new Array(n).fill(null);

  const seedReturns = [];
  let seedEndIdx = -1;
  for (let i = 0; i < n && seedReturns.length < EWMA_SEED_DAYS; i++) {
    if (mixReturns[i] != null) {
      seedReturns.push(mixReturns[i]);
      seedEndIdx = i;
    }
  }
  if (seedReturns.length < EWMA_SEED_DAYS) return scalars;

  const seedMean = seedReturns.reduce((s, v) => s + v, 0) / seedReturns.length;
  let v =
    seedReturns.reduce((s, r) => s + (r - seedMean) ** 2, 0) /
    (seedReturns.length - 1);

  const targetVar = TARGET_VOL * TARGET_VOL; // 0.12² = 0.0144

  for (let i = seedEndIdx + 1; i < n; i++) {
    const rPrev = mixReturns[i - 1];
    if (rPrev != null) {
      v = EWMA_LAMBDA * v + (1 - EWMA_LAMBDA) * rPrev * rPrev;
    }
    if (!(v > 0)) continue;
    const annualizedVar = 252 * v;
    scalars[i] = Math.min(1, targetVar / annualizedVar);
  }
  return scalars;
}

/**
 * (d) semivol20: downside semideviation over last 20 returns.
 * RV = sqrt(252·Σmin(r,0)²/(n-1)), floored at SEMI_FLOOR.
 * s = min(1, SEMI_TARGET / RV).
 * Returns scalar array parallel to mixReturns.
 */
function semivol20Scalars(mixReturns) {
  const n = mixReturns.length;
  const scalars = new Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    // Collect last VOL_WINDOW non-null returns strictly before i
    const slice = [];
    for (let j = i - 1; j >= 0 && slice.length < VOL_WINDOW; j--) {
      if (mixReturns[j] != null) slice.push(mixReturns[j]);
    }
    if (slice.length < VOL_WINDOW) continue;

    // Downside semivariance: sum of min(r, 0)² / (n-1)
    const semiVar =
      slice.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / (slice.length - 1);
    const rv = Math.max(SEMI_FLOOR, Math.sqrt(252 * semiVar));
    scalars[i] = Math.min(1, SEMI_TARGET / rv);
  }
  return scalars;
}

// ---------------------------------------------------------------------------
// Map estimator name → scalar builder
// ---------------------------------------------------------------------------
function buildScalars(estimator, mixReturns) {
  switch (estimator) {
    case 'roll20-vol': return roll20VolScalars(mixReturns);
    case 'ewma-vol':   return ewmaVolScalars(mixReturns);
    case 'ewma-var':   return ewmaVarScalars(mixReturns);
    case 'semivol20':  return semivol20Scalars(mixReturns);
    default: throw new Error(`Unknown estimator: ${estimator}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'vol-engine-refinement-WF-OOS',
    script: 'scripts/backtests/validate-vol-engine.js',
    description:
      'Risk-estimator comparison on the champion 50/50 SOXX/GLD vol-target mix. ' +
      'Mix weight and targetVol are frozen at the champion\'s elected values (0.5, 0.12). ' +
      'Four pre-registered estimators drive the exposure scalar: ' +
      '(a) roll20-vol (replication control), ' +
      '(b) ewma-vol (EWMA λ=0.94, vol scaling), ' +
      '(c) ewma-var (EWMA λ=0.94, variance-managed Moreira-Muir scaling), ' +
      '(d) semivol20 (downside semideviation, target adjusted for comparable average exposure). ' +
      'Cost: 5bps blended per unit absolute scalar change per side.',
    universe: ['SOXX', 'GLD', 'SPY'],
    controlUniverse: ['SOXX', 'GLD'],
    benchmarkSymbol: 'SPY',
    start: START,
    faithfulness: {
      status: 'not_run',
      note: 'research — shares volTargetMixCore where applicable; dedicated cert pending',
    },

    buildCandidates: ({ dates, series, costMultiplier }) => {
      // Cost-free mix returns (certified core — same path as champion + live plugin)
      const mixReturns = buildMixReturns(series, dates);

      return GRID.map(({ estimator }) => {
        const scalars = buildScalars(estimator, mixReturns);

        // Overlay returns: s_i * r_mix_i - cost(|s_i - s_{i-1}|)
        // Cost convention: (5/10000) * costMultiplier * |effW_i - effW_{i-1}|
        // effW here is the scalar s_i (the single leg's effective weight).
        const overlayReturns = new Array(dates.length).fill(null);
        let prevS = null;

        for (let i = 0; i < dates.length; i++) {
          if (mixReturns[i] === null || scalars[i] == null) {
            // Not enough history for this estimator — remain null
            prevS = null;
            continue;
          }

          const s = scalars[i];
          // Treat a cold-start as coming from 0 weight
          const sPrev = prevS !== null ? prevS : 0;
          const turnoverCost =
            Math.abs(s - sPrev) * (COST_BPS / 10000) * costMultiplier;

          overlayReturns[i] = s * mixReturns[i] - turnoverCost;
          prevS = s;
        }

        return {
          params: {
            estimator,
            mixW: MIX_W,
            targetVol: TARGET_VOL,
            volWindow: VOL_WINDOW,
            ewmaLambda: estimator.startsWith('ewma') ? EWMA_LAMBDA : undefined,
            semiTarget: estimator === 'semivol20' ? SEMI_TARGET : undefined,
          },
          returns: overlayReturns,
        };
      });
    },

    notes: [
      'MIX FROZEN AT CHAMPION VALUES: 50/50 SOXX/GLD, targetVol 0.12, 5bps overlay cost. ' +
        'Only the risk estimator varies across the four pre-registered candidates.',
      'BASE MIX (cost-free signal): computed via volTargetMixCore.mixDailyReturns — ' +
        'the same certified pure function used by the champion and the live plugin. ' +
        'Monthly weight resets at the close of the first trading day of each month; ' +
        'weights drift with returns in between (no daily rebalancing of the underlying mix).',
      'ESTIMATOR (a) roll20-vol: sample stdev of last 20 returns × sqrt(252); ' +
        's = min(1, 0.12/RV). Uses volTargetMixCore.realizedVolAt — certified core. ' +
        'Expected to closely replicate the champion\'s OOS Sharpe.',
      'ESTIMATOR (b) ewma-vol: EWMA variance v_i = 0.94·v_{i-1} + 0.06·r²_{i-1}, ' +
        'seeded on sample variance of first 20 non-null mix returns; ' +
        'RV = sqrt(252·v); s = min(1, 0.12/RV). ' +
        'EWMA weights recent returns more heavily — faster reaction to volatility regimes.',
      'ESTIMATOR (c) ewma-var: identical EWMA variance, but variance-managed scaling ' +
        's = min(1, 0.12²/(252·v)) [Moreira-Muir 2017 style]. ' +
        'Scales quadratically with realized vol: high-vol regimes get much lower exposure ' +
        'than linear vol scaling; also responds more aggressively to vol spikes.',
      'ESTIMATOR (d) semivol20: downside semideviation = sqrt(252·Σmin(r,0)²/(n-1)) ' +
        'over last 20 returns, floored at 0.005 to avoid division-by-zero in calm periods. ' +
        'Target adjusted to 0.12/sqrt(2) ≈ 0.0849 so average exposure is comparable to ' +
        'roll20-vol (for symmetric return distributions, downside stdev ≈ totalVol/sqrt(2)). ' +
        'Responds only to downside variance; ignores rallies.',
      'COST MODEL: (5/10000)·costMultiplier·|s_i − s_{i-1}| charged each day, where s_i ' +
        'is the scalar (effective weight on the mix). Matches champion blended-turnover ' +
        'treatment. Base mix execution costs are embedded inside mixDailyReturns (cost-free ' +
        'path) — this overlay term covers only the vol-target resizing turnover.',
      'NO LOOKAHEAD: scalar at day i uses only mix returns through i-1. Monthly weight resets ' +
        'in mixDailyReturns apply at the first trading-day close of each month and affect ' +
        'returns from that day\'s close onward — no forward prices enter any calculation.',
      'FAITHFULNESS: not_run — research study only; these estimator variants are not yet ' +
        'deployed to a live plugin and therefore cannot reach VALIDATED until one is.',
    ],

    extraReport: {
      grid: GRID,
      frozenParams: { mixW: MIX_W, targetVol: TARGET_VOL, costBps: COST_BPS },
      estimatorConfig: {
        volWindow: VOL_WINDOW,
        ewmaLambda: EWMA_LAMBDA,
        ewmaSeedDays: EWMA_SEED_DAYS,
        semiFloor: SEMI_FLOOR,
        semiTarget: SEMI_TARGET,
        semiTargetRationale: '0.12 / sqrt(2) — normalizes downside stdev to be comparable to full stdev at equal average exposure',
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
