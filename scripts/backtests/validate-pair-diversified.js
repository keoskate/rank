#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-pair-diversified.js
//
// Five-gate validation of a band-rebalanced equity/GLD pair.
//
// Claim under test: pairing a high-Sharpe equity leg (SOXX or QQQ) with GLD
// (a low-correlation sleeve) and band-rebalancing harvests a diversification +
// rebalancing premium — distinct from the pure equity beta captured by holding
// the same blend statically.
//
// Pre-registered grid (10 candidates — do not alter):
//   equityLeg ∈ {SOXX, QQQ} × targetW ∈ {0.4, 0.5, 0.6} × band ∈ {0.02, 0.05}
//   skip (targetW=0.4, band=0.05) per both equityLegs → 2 × (3×2 − 1) = 10 total
//
//   node --check scripts/backtests/validate-pair-diversified.js
//   node scripts/backtests/validate-pair-diversified.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateBandRebalancePair, alignPair } = require('./soxx-band-rebalance');

const GLD = 'GLD';
const START = '2016-01-04';

// Build the pre-registered 10-point grid
const GRID = [];
for (const equityLeg of ['SOXX', 'QQQ']) {
  for (const targetW of [0.4, 0.5, 0.6]) {
    for (const band of [0.02, 0.05]) {
      if (targetW === 0.4 && band === 0.05) continue; // skip per spec
      GRID.push({ equityLeg, targetW, band });
    }
  }
}
// Sanity: assert exactly 10 candidates
if (GRID.length !== 10) {
  throw new Error(`Grid build error: expected 10 candidates, got ${GRID.length}`);
}

async function main() {
  await validateStrategy({
    family: 'mean-reversion',
    strategyId: 'pair-diversified-gld-WF-OOS',
    script: 'scripts/backtests/validate-pair-diversified.js',
    description:
      'Band-rebalanced equity/GLD pair: w in equity leg (SOXX or QQQ), 1−w in GLD. ' +
      'Both legs rebalanced to target when equity weight drifts beyond ±band. ' +
      'Grid: equityLeg{SOXX,QQQ} × targetW{40,50,60%} × band{2,5pts}, skipping ' +
      '(targetW=0.4, band=0.05) → 10 candidates. ' +
      'Claim: diversification (SOXX/QQQ−GLD low correlation) + rebalancing premium ' +
      'versus a passive EW(SOXX,QQQ,GLD) control.',
    universe: ['SOXX', 'QQQ', 'GLD', 'SPY'],
    controlUniverse: ['SOXX', 'QQQ', 'GLD'],
    start: START,
    benchmarkSymbol: 'SPY',
    buildCandidates: ({ dates, bars, costMultiplier }) => {
      const dateIdx = new Map(dates.map((d, i) => [d, i]));
      return GRID.map(({ equityLeg, targetW, band }) => {
        const { A, B } = alignPair(bars[equityLeg], bars[GLD]);
        const sim = simulateBandRebalancePair(A, B, {
          targetW,
          band,
          costMultiplier,
          symA: equityLeg,
          symB: GLD,
        });
        // Map sim equity (indexed by sim.dates) onto the master dates array.
        // sim.equity[0] is day-0 NAV = 1.0 (the starting point); daily return
        // for sim index i is equity[i]/equity[i-1]-1, which belongs to the date
        // sim.dates[i]. No lookahead: sim already guards that on day i only
        // data through day i-1 (the prior close) is used.
        const returns = new Array(dates.length).fill(null);
        for (let i = 1; i < sim.equity.length; i++) {
          const idx = dateIdx.get(sim.dates[i]);
          if (idx != null) {
            returns[idx] = sim.equity[i] / sim.equity[i - 1] - 1;
          }
        }
        return { params: { equityLeg, targetW, band, sleeve: GLD }, returns };
      });
    },
    faithfulness: {
      status: 'not_run',
      note: 'research strategy — no live broker plugin executes pair band rebalancing yet.',
    },
    notes: [
      'Claim: diversification (low SOXX/QQQ−GLD correlation, historically ~0.0 to −0.2) + rebalancing premium from harvesting mean-reversion across an equity/gold spread.',
      'Equity leg choices: SOXX (semiconductor 3x-ish beta, high vol) and QQQ (large-cap tech, lower vol). GLD sleeve: uncorrelated, non-cash premium.',
      'Gate-3 control = EW(SOXX, QQQ, GLD) passive monthly-rebalanced on identical OOS dates — the verdict answers band-triggered rebalancing vs naive blend holding.',
      'Benchmark = SPY (standard). Cash residual in sim is always < $5 (asserted in simulator).',
    ],
    extraReport: {
      grid: GRID,
      variant: 'pair-diversified-equity-gld',
      sleeve: GLD,
      gridSize: GRID.length,
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
