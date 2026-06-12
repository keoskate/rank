#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/sensitivity-xlf-correction.js
//
// D17 materiality diagnostic (NOT a strategy trial — same deployed spec, same
// universe; only the data fault toggles): full-window in-sample run of the
// deployed trend spec with and without the XLF spinoff correction
// (known-data-corrections.json). Quantifies how much the phantom -18.28%
// XLF day (2016-09-19, missing XLRE-spinoff adjustment in Alpaca's adjusted
// series) distorted our published numbers.
//
// Run pattern: this script reads BACKTEST_DATA_CORRECTIONS from the
// environment and runs ONE leg; the wrapper compares:
//   node scripts/backtests/sensitivity-xlf-correction.js                 # corrected
//   BACKTEST_DATA_CORRECTIONS=off node scripts/backtests/sensitivity-xlf-correction.js

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const {
  loadDailyBars,
  buildCalendar,
  alignCloses,
} = require('./lib/marketData');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE,
} = require('./validate-trend');

const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE23 = [...new Set([...BASE, ...DIVERSIFIERS])];
const START = '2016-01-04';
const SPEC = { ...DEPLOYED, rankBy: 'volAdjusted' };

async function main() {
  const mode =
    process.env.BACKTEST_DATA_CORRECTIONS === 'off'
      ? 'UNCORRECTED (vendor fault in place)'
      : 'CORRECTED (known-data-corrections.json applied)';
  const { bars } = await loadDailyBars(UNIVERSE23, {
    start: START,
    quiet: true,
  });
  const missing = UNIVERSE23.filter(s => !bars[s] || !bars[s].length);
  if (missing.length) {
    throw new Error(`universe incomplete — fetch failed for: ${missing}`);
  }
  const dates = buildCalendar(bars);
  const series = alignCloses(bars, dates);
  const ctx = { dates, series, bars };
  const sim = simulateDeployed(ctx, SPEC, 1, UNIVERSE23);
  const stats = equityStats.statsFromEquity(sim.eqDates, sim.eq);
  console.log(`\n[xlf-sensitivity] ${mode}`);
  console.log(
    `  full-window in-sample, deployed volrank-23 spec: Sharpe ${stats.sharpe.toFixed(3)}  CAGR ${(stats.cagr * 100).toFixed(2)}%  maxDD ${(stats.maxDD * 100).toFixed(1)}%  Calmar ${stats.calmar.toFixed(3)}`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
