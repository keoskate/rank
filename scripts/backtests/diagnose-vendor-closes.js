#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/diagnose-vendor-closes.js
//
// D17 evidence script: classifies Alpaca-vs-Yahoo disagreements by their
// LEVEL-ratio signature instead of eyeballing return mismatches.
//   z(d) = (alpaca_adj(d) / yahoo_adj(d)) / rolling-median of same
//   - transient close fault:  |z-1| spikes on one day, back to ~0 next day
//   - missing adjustment:     ratio steps PERMANENTLY at the ex-date
// Scans the FULL series of each symbol; for every flagged day also reports
// the 20d-median ratio before vs after (step test).
//
// Usage: node scripts/backtests/diagnose-vendor-closes.js [SYM ...]
//        (default: the 23-ETF trend universe)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadDailyBars } = require('./lib/marketData');
const { UNIVERSE: BASE } = require('./validate-trend');

const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const START = '2016-01-04';
const YAHOO_DIR = path.join(__dirname, '../../data/backtests/bars-cache-yahoo');
const Z_TOL = 0.004;
const MAX_FLAGS = 40;

function yahooCached(sym) {
  const f = fs
    .readdirSync(YAHOO_DIR)
    .find(n => n.startsWith(`${sym}_`) && n.endsWith('.json'));
  if (!f) return null;
  return JSON.parse(fs.readFileSync(path.join(YAHOO_DIR, f), 'utf8'));
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

async function main() {
  const symbols = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [...new Set([...BASE, ...DIVERSIFIERS])];
  const { bars } = await loadDailyBars(symbols, { start: START, quiet: true });
  for (const sym of symbols) {
    const adj = bars[sym];
    const y = yahooCached(sym);
    if (!adj || !y) {
      console.log(`\n${sym}: missing data (alpaca ${!!adj}, yahoo ${!!y})`);
      continue;
    }
    const yBy = new Map(y.map(b => [b.date, b.close]));
    const rows = [];
    for (const b of adj) {
      const yc = yBy.get(b.date);
      if (yc > 0) rows.push({ date: b.date, ratio: b.close / yc });
    }
    const flagged = [];
    for (let i = 0; i < rows.length; i++) {
      const lo = Math.max(0, i - 30);
      const hi = Math.min(rows.length, i + 30);
      const med = median(rows.slice(lo, hi).map(r => r.ratio));
      rows[i].z = rows[i].ratio / med - 1;
      if (Math.abs(rows[i].z) > Z_TOL) flagged.push(i);
    }
    if (!flagged.length) continue;
    console.log(`\n${sym}: level-ratio deviations (z = vs 60d rolling median)`);
    for (const i of flagged.slice(0, MAX_FLAGS)) {
      const next = rows[i + 1];
      const before = rows.slice(Math.max(0, i - 20), i).map(r => r.ratio);
      const after = rows.slice(i + 1, i + 21).map(r => r.ratio);
      let step = null;
      if (before.length >= 10 && after.length >= 10) {
        step = median(after) / median(before) - 1;
      }
      const kind =
        step != null && Math.abs(step) > 0.01
          ? `PERMANENT STEP ${(step * 100).toFixed(2)}% (missing adjustment?)`
          : next && Math.abs(next.z) < Z_TOL
            ? 'TRANSIENT (gone next day)'
            : 'persists/mixed';
      console.log(
        `  ${rows[i].date}  z ${(rows[i].z * 100).toFixed(2)}%  next ${next ? (next.z * 100).toFixed(2) + '%' : 'n/a'}  -> ${kind}`
      );
    }
    if (flagged.length > MAX_FLAGS) {
      console.log(`  …and ${flagged.length - MAX_FLAGS} more flagged days`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
