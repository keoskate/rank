#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-soxx-band-rebalance.js
//
// Five-gate validation of SOXX threshold (band) rebalancing — the sound
// reformulation of the fixed-share ladder.
//
// Claim under test: "a band-rebalanced SOXX/cash mix beats 100% SOXX buy-and-
// hold on RISK-ADJUSTED return" (gate 3 control = EW of the 1-name universe =
// SOXX buy-and-hold; passes on ΔSharpe > 0 OR ΔCalmar > 0).
//
// Pre-registered grid (every point a ledger trial):
//   target weight w ∈ {0.5, 0.7} × band ∈ {0.02, 0.05} → 4 candidates.
// Walk-forward selects per fold; stitched OOS is the headline.
//
//   node scripts/backtests/validate-soxx-band-rebalance.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateBandRebalance, SYMBOL, START } = require('./soxx-band-rebalance');

const GRID = [];
for (const targetW of [0.5, 0.7]) {
  for (const band of [0.02, 0.05]) GRID.push({ targetW, band });
}

async function main() {
  await validateStrategy({
    family: 'mean-reversion',
    strategyId: 'soxx-band-rebalance-WF-OOS',
    script: 'scripts/backtests/validate-soxx-band-rebalance.js',
    description:
      'SOXX threshold rebalancing (the sound ladder): hold w in SOXX / 1−w cash, trade back to target ' +
      'when the weight drifts beyond ±band. Grid w{50,70%} × band{2,5pts}. Control = 100% SOXX ' +
      'buy-and-hold — tests whether volatility harvesting beats holding on risk-adjusted return.',
    universe: [SYMBOL],
    controlUniverse: [SYMBOL],
    start: START,
    benchmarkSymbol: SYMBOL,
    buildCandidates: ({ dates, bars, costMultiplier }) => {
      const raw = bars[SYMBOL];
      return GRID.map(({ targetW, band }) => {
        const sim = simulateBandRebalance(raw, { targetW, band, costMultiplier });
        const returns = new Array(dates.length).fill(null);
        for (let i = 1; i < sim.equity.length; i++) {
          returns[i] = sim.equity[i] / sim.equity[i - 1] - 1;
        }
        return { params: { targetW, band }, returns };
      });
    },
    faithfulness: {
      status: 'not_run',
      note: 'research strategy — no live broker plugin executes band rebalancing yet; a live plugin + cert is required before VALIDATED.',
    },
    notes: [
      'Sound reformulation of the fixed-share ladder (soxx-ladder.js, FAILED:outOfSample): weight-anchored, dollar-sized, cannot strand.',
      'Cash sleeve modeled at 0% yield — conservative; T-bill yield on the cash would improve every candidate.',
      'The strategy holds ≤70% SOXX, so absolute return will lag the 100% control in a bull; the claim is risk-adjusted (Sharpe/Calmar), which gate 3 tests directly.',
    ],
    extraReport: { grid: GRID, variant: 'band-rebalance', cashYield: 0 },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
