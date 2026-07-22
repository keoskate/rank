#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-vol-target-mix.js
//
// Five-gate validation of a vol-target overlay on top of a monthly-rebalanced
// SOXX/GLD mix.
//
// Step 1: build the SOXX/GLD base mix using simulateMonthlyPair(A, B, mixW,
//         costMultiplier, 'SOXX', 'GLD') — both legs earn premium, no cash drag.
//         Convert the resulting equity curve into daily simple returns r_mix,
//         mapped onto the master calendar by date.
//
// Step 2: apply a volatility-target overlay at returns level:
//         w_i = min(1, targetVol / realizedVol_{i-1}(r_mix, volWindow=20))
//         where realizedVol is annualized (sqrt(252) * stdev of last 20 r_mix
//         returns, using data through i-1 only — no lookahead).
//         Overlay return day i = w_i * r_mix_i
//           - |w_i - w_{i-1}| * (5/10000) * costMultiplier
//         The 5bps blended turnover cost covers the fractional SOXX/GLD legs
//         being rescaled.
//
// Pre-registered grid (6 candidates, do not alter):
//   mixW ∈ {0.5, 0.6} × targetVol ∈ {0.12, 0.16, 0.20}
//
//   node scripts/backtests/validate-vol-target-mix.js

require('dotenv').config();
const { volTargetMixCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateMonthlyPair, alignPair } = require('./soxx-band-rebalance');

const VOL_WINDOW = 20; // look-back days for realized vol estimate
const COST_BPS = 5; // blended turnover cost bps per unit weight change (per side)
const START = '2016-01-04';

// FAITHFULNESS: the exposure scalar (the DECISION) comes from quant-core
// volTargetMixCore — the same pure function the live plugin
// (server/strategies/volTargetMix.js) calls, certified zero-divergence by
// certify-vol-target-mix.js. The signal is computed on COST-FREE mix returns
// (a decision must not depend on the cost model); the RETURN path below still
// uses the cost-inclusive simulateMonthlyPair mix, and overlay turnover costs
// are charged here in the execution layer.

// Pre-registered grid — DO NOT ALTER
const GRID = [];
for (const mixW of [0.5, 0.6]) {
  for (const targetVol of [0.12, 0.16, 0.2]) {
    GRID.push({ mixW, targetVol });
  }
}

/**
 * Build daily returns for the monthly-rebalanced SOXX/GLD mix, aligned to the
 * master calendar. Returns an array parallel to `dates`; null before the mix
 * has data.
 */
function buildMixReturns(bars, dates, mixW, costMultiplier) {
  const { A, B } = alignPair(bars['SOXX'], bars['GLD']);
  // simulateMonthlyPair returns an equity array parallel to A (SOXX calendar)
  const mixEquity = simulateMonthlyPair(
    A,
    B,
    mixW,
    costMultiplier,
    'SOXX',
    'GLD'
  );

  // Build a date→mixReturn map from the pair's calendar
  const mixReturnByDate = new Map();
  for (let i = 1; i < A.length; i++) {
    const r = mixEquity[i] / mixEquity[i - 1] - 1;
    mixReturnByDate.set(A[i].date, r);
  }

  // Map onto the master calendar (null where no mix data)
  return dates.map(d => {
    const r = mixReturnByDate.get(d);
    return r !== undefined ? r : null;
  });
}

/**
 * Exposure scalar per date from the SHARED CORE (cost-free signal path).
 * scalar for date d applies to the return earned ON d (decided from data
 * through the prior session) — the same convention the core documents.
 * @returns {Map<string, number>}
 */
function buildScalarByDate(bars, { mixW, targetVol }) {
  const { A, B } = alignPair(bars['SOXX'], bars['GLD']);
  const pairDates = A.map(b => b.date);
  const scalars = volTargetMixCore.scalarSeries(
    pairDates,
    A.map(b => b.close),
    B.map(b => b.close),
    { mixW, targetVol, volWindow: VOL_WINDOW }
  );
  const byDate = new Map();
  for (let i = 0; i < pairDates.length; i++) {
    if (scalars[i] != null) byDate.set(pairDates[i], scalars[i]);
  }
  return byDate;
}

async function main() {
  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'vol-target-soxx-gld-mix-WF-OOS',
    script: 'scripts/backtests/validate-vol-target-mix.js',
    description:
      'Vol-target overlay on a monthly-rebalanced SOXX/GLD mix. ' +
      'Step 1: build the base mix equity via simulateMonthlyPair (SOXX/GLD, mixW). ' +
      'Step 2: scale daily exposure by w_i = min(1, targetVol / RV_{i-1,20d}); ' +
      'charge 5bps blended turnover cost per unit weight change. ' +
      'Grid: mixW{50,60%} × targetVol{12,16,20%} → 6 candidates.',
    universe: ['SOXX', 'GLD', 'SPY'],
    controlUniverse: ['SOXX', 'GLD'],
    benchmarkSymbol: 'SPY',
    start: START,
    faithfulness: { certification: 'vol-target-mix' },
    buildCandidates: ({ dates, bars, costMultiplier }) => {
      return GRID.map(({ mixW, targetVol }) => {
        // Step 1: base mix returns on the master calendar (cost-inclusive —
        // the RETURN path keeps its execution costs)
        const mixReturns = buildMixReturns(bars, dates, mixW, costMultiplier);

        // Step 2: vol-target overlay — scalar from the SHARED CORE
        const scalarByDate = buildScalarByDate(bars, { mixW, targetVol });
        const overlayReturns = new Array(dates.length).fill(null);
        let prevW = null;

        for (let i = 0; i < dates.length; i++) {
          if (mixReturns[i] === null) {
            // No mix data yet — overlay is null too
            prevW = null;
            continue;
          }

          const w = scalarByDate.get(dates[i]);
          if (w == null) {
            // Not enough history for the vol estimate — skip (remain null)
            prevW = null;
            continue;
          }

          // Turnover cost: |w_i - w_{i-1}| * (5bps) * costMultiplier
          // If prevW is null (first valid day), treat as coming from 0 weight
          const wPrev = prevW !== null ? prevW : 0;
          const turnoverCost =
            Math.abs(w - wPrev) * (COST_BPS / 10000) * costMultiplier;

          overlayReturns[i] = w * mixReturns[i] - turnoverCost;
          prevW = w;
        }

        return {
          params: { mixW, targetVol, volWindow: VOL_WINDOW },
          returns: overlayReturns,
        };
      });
    },
    notes: [
      'DECISION CORE SHARED WITH LIVE: exposure scalar from @keo/quant-core volTargetMixCore (certified by certify-vol-target-mix.js); signal computed on cost-free mix returns, costs charged in this execution layer.',
      'Base mix is monthly-rebalanced SOXX/GLD (simulateMonthlyPair) — both legs risky, no cash sleeve.',
      'Vol overlay scales exposure to target annualized vol; realized vol uses 20d trailing stdev*sqrt(252), data through i-1 (no lookahead).',
      'Overlay cost: 5bps blended per unit absolute weight change, charged on overlay turnover only; base-mix costs already embedded in simulateMonthlyPair.',
      'w capped at 1.0 — no leverage beyond the full mix position.',
      'Control (gate 3): EW(SOXX,GLD) monthly-rebalanced, identical OOS dates — tests whether vol targeting adds Sharpe or Calmar vs naive pair holding.',
    ],
    extraReport: { grid: GRID, volWindow: VOL_WINDOW, costBps: COST_BPS },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
