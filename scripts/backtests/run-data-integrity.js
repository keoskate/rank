#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/run-data-integrity.js
//
// Standalone data-integrity gate runner (D17). Runs gate 1 — raw-vs-adjusted,
// stale runs, Polygon cross-source (2021-07+), and the Yahoo third-vendor leg
// (full window) — over a universe and prints every finding per symbol.
//
// Usage:
//   node scripts/backtests/run-data-integrity.js              # 23-ETF trend universe
//   node scripts/backtests/run-data-integrity.js SPY GLD TLT  # explicit symbols

require('dotenv').config();
const { loadDailyBars } = require('./lib/marketData');
const { runDataIntegrityGate } = require('./lib/dataIntegrity');
const { UNIVERSE: BASE } = require('./validate-trend');

const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const START = '2016-01-04';

async function main() {
  const symbols = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [...new Set([...BASE, ...DIVERSIFIERS])];
  console.log(
    `data-integrity gate over ${symbols.length} symbols from ${START}\n`
  );
  const { bars } = await loadDailyBars(symbols, { start: START });
  const missing = symbols.filter(s => !bars[s] || !bars[s].length);
  if (missing.length) {
    throw new Error(`universe incomplete — fetch failed for: ${missing}`);
  }
  const res = await runDataIntegrityGate(bars, { start: START });

  for (const sym of symbols) {
    const r = res.perSymbol[sym];
    if (!r) continue;
    const tag =
      r.level === 'pass' ? 'PASS' : r.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${tag}  ${sym}`);
    for (const issue of r.issues || []) console.log(`      - ${issue}`);
  }
  console.log(
    `\noverall: ${res.status.toUpperCase()}  (pass ${res.summary.pass} / warn ${res.summary.warn} / fail ${res.summary.fail})`
  );
  process.exit(res.status === 'fail' ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
