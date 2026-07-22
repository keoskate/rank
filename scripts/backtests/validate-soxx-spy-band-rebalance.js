#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-soxx-spy-band-rebalance.js
//
// Five-gate validation of SOXX/SPY pair band rebalancing (no cash sleeve —
// the user's upgrade of the SOXX/cash version: both legs earn premium).
//
// Claim under test: "band-rebalancing a SOXX/SPY mix beats passively holding
// the same pair." Gate 3's control for the 2-name universe is EW(SOXX,SPY)
// monthly-rebalanced — so the verdict directly answers band-trigger vs naive
// pair holding, on identical OOS dates.
//
// Pre-registered grid (each point a ledger trial):
//   w(SOXX) ∈ {0.5, 0.7} × band ∈ {0.02, 0.05} → 4 candidates.
//
//   node scripts/backtests/validate-soxx-spy-band-rebalance.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const {
  simulateBandRebalancePair,
  alignPair,
  SYMBOL,
  START,
} = require('./soxx-band-rebalance');

const SLEEVE = 'SPY';
const GRID = [];
for (const targetW of [0.5, 0.7]) {
  for (const band of [0.02, 0.05]) GRID.push({ targetW, band });
}

async function main() {
  await validateStrategy({
    family: 'mean-reversion',
    strategyId: 'soxx-spy-band-rebalance-WF-OOS',
    script: 'scripts/backtests/validate-soxx-spy-band-rebalance.js',
    description:
      'SOXX/SPY pair band rebalancing: w in SOXX / 1−w in SPY, both legs traded back to target when ' +
      'the SOXX weight drifts beyond ±band. Grid w{50,70%} × band{2,5pts}. No cash sleeve. Control = ' +
      'EW(SOXX,SPY) — tests band-triggered rebalancing against naive holding of the same pair.',
    universe: [SYMBOL, SLEEVE],
    controlUniverse: [SYMBOL, SLEEVE],
    start: START,
    benchmarkSymbol: SLEEVE,
    buildCandidates: ({ dates, bars, costMultiplier }) => {
      const { A, B } = alignPair(bars[SYMBOL], bars[SLEEVE]);
      const dateIdx = new Map(dates.map((d, i) => [d, i]));
      return GRID.map(({ targetW, band }) => {
        const sim = simulateBandRebalancePair(A, B, {
          targetW,
          band,
          costMultiplier,
          symB: SLEEVE,
        });
        const returns = new Array(dates.length).fill(null);
        for (let i = 1; i < sim.equity.length; i++) {
          const idx = dateIdx.get(sim.dates[i]);
          if (idx != null) returns[idx] = sim.equity[i] / sim.equity[i - 1] - 1;
        }
        return { params: { targetW, band, sleeve: SLEEVE }, returns };
      });
    },
    faithfulness: {
      status: 'not_run',
      note: 'research strategy — no live broker plugin executes pair band rebalancing yet.',
    },
    notes: [
      'Upgrade of soxx-band-rebalance (cash sleeve → SPY): both legs earn premium, no cash drag; harvests the SOXX−SPY relative swing (~0.8 correlated, so a smaller premium than vs cash).',
      'Control = EW(SOXX,SPY) of the same universe — the verdict isolates the value of the band trigger + tilt, not equity beta.',
      'Cash-sleeve version verdict for comparison: FAILED:multipleTesting (gates 1/3/4 pass, ΔSharpe +0.01).',
    ],
    extraReport: { grid: GRID, variant: 'pair-band-rebalance', sleeve: SLEEVE },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
