#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-soxx-ladder.js
//
// Five-gate validation of the SOXX 5% mean-reversion ladder.
//
// Claim under test: "a fixed-share ladder (sell 1 on +T%, buy 1 on −T% from the
// last trade price) beats simply holding SOXX." Gate 3's passive control is
// EW-of-universe = 100% SOXX buy-and-hold, so the verdict directly answers that.
//
// We validate the RE-ANCHOR variant (anchor tracks price even when flat/capped)
// — the literal spec strands itself in cash (~9 trades in 10y) and is strictly
// worse, so testing it through the gates is pointless. Threshold is gridded
// {3,5,7,10}% for the walk-forward; every grid point is a ledger trial.
//
//   node scripts/backtests/validate-soxx-ladder.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateLadder, SYMBOL, START } = require('./soxx-ladder');

const THRESH_GRID = [0.03, 0.05, 0.07, 0.1];
const BUFFER_BUYS = 10;

async function main() {
  await validateStrategy({
    family: 'mean-reversion',
    strategyId: 'soxx-ladder-WF-OOS',
    script: 'scripts/backtests/validate-soxx-ladder.js',
    description:
      'SOXX fixed-share mean-reversion ladder (re-anchor variant): sell 1 on +T% / buy 1 on −T% from the ' +
      'last-trade price, start 1 share + 10×price cash, no shorting/borrowing. Threshold gridded {3,5,7,10}%. ' +
      'Control = 100% SOXX buy-and-hold (gate 3). Tests whether laddering beats simply holding SOXX.',
    universe: [SYMBOL],
    controlUniverse: [SYMBOL],
    start: START,
    benchmarkSymbol: SYMBOL,
    buildCandidates: ({ dates, bars, costMultiplier }) => {
      const raw = bars[SYMBOL];
      const buffer = BUFFER_BUYS * raw[0].close;
      return THRESH_GRID.map(threshold => {
        const sim = simulateLadder(raw, {
          threshold,
          buffer,
          costMultiplier,
          reanchorWhenIdle: true,
        });
        // equity multiples (aligned to the SOXX calendar == master `dates`) → daily returns
        const returns = new Array(dates.length).fill(null);
        for (let i = 1; i < sim.equity.length; i++) {
          returns[i] = sim.equity[i] / sim.equity[i - 1] - 1;
        }
        return {
          params: { threshold, bufferBuys: BUFFER_BUYS, reanchor: true },
          returns,
        };
      });
    },
    faithfulness: {
      status: 'not_run',
      note: 'research strategy — no live broker plugin executes the SOXX ladder; cannot reach VALIDATED without one.',
    },
    notes: [
      'Control is 100% SOXX buy-and-hold (EW of a 1-name universe) — the ladder is ~90% cash, so it is a lower-risk profile; gate 3 tests risk-adjusted (Sharpe/Calmar), which is the fair comparison.',
      'Standalone soxx-ladder.js also compares to hold-1-share+cash (same capital) — the ladder ≈ that, i.e. the trading adds no edge.',
      'Literal spec (anchor only moves on trades) strands in cash after ~2016; this validates the more-generous re-anchor variant.',
    ],
    extraReport: { threshGrid: THRESH_GRID, bufferBuys: BUFFER_BUYS, variant: 'reanchor-when-idle' },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
