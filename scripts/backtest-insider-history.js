#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtest-insider-history.js — Multi-REGIME insider backtest.
//
// The feed-based backtest only reaches ~3 recent weeks (all bull). This one uses
// the PER-TICKER insider-buy-sells endpoint (deep history, back to ~2003) across
// a liquid basket, so we can bucket insider-buy events BY YEAR and ask the real
// question: does following insiders work outside a bull market (2022 bear, 2020
// crash) — or is the edge just market beta?
//
// Point-in-time, no look-ahead: enter at the next session open after the filing
// date; forward returns net of round-trip cost; baseline = random days on the
// SAME ticker in the SAME year (so each year's edge is net of that year's drift).
//
// Usage: node scripts/backtest-insider-history.js [--min 250000] [--from 2018]

require('dotenv').config();
const uw = require('./../server/unusualWhalesClient');
const polygon = require('./../server/polygonClient');
const { bpsPerSide } = require('./../server/risk/transactionCost');

const COST = (bpsPerSide('X') * 2) / 10000; // round-trip cost fraction

// Liquid names that historically DO see insider buying (energy, financials/
// regionals, industrials, some healthcare/tech) — mega-cap tech is almost all
// sells, so a pure-tech basket would yield no events.
const BASKET = [
  'OXY',
  'KMI',
  'DVN',
  'FANG',
  'APA',
  'MRO',
  'HAL',
  'SLB',
  'COP',
  'EOG',
  'WMB',
  'OKE',
  'WFC',
  'USB',
  'PNC',
  'TFC',
  'KEY',
  'CFG',
  'RF',
  'FITB',
  'HBAN',
  'ZION',
  'MTB',
  'CMA',
  'GS',
  'MS',
  'SCHW',
  'C',
  'BAC',
  'AXP',
  'SYF',
  'ALLY',
  'CAT',
  'DE',
  'GE',
  'HON',
  'EMR',
  'ETN',
  'PH',
  'PFE',
  'GILD',
  'CVS',
  'MRK',
  'BMY',
  'INTC',
  'MU',
  'HPE',
  'WDC',
  'CSCO',
  'T',
  'VZ',
  'PARA',
  'WBD',
  'KHC',
  'F',
  'GM',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

function parseArgs(argv) {
  const a = { min: 250000, from: 2018 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'min' || k === 'from') a[k] = parseFloat(argv[++i]);
  }
  return a;
}

function fwdReturn(bars, idxByDate, date, n) {
  const i = idxByDate.get(date);
  if (i == null) {
    // find first bar strictly after `date`
    let lo = 0;
    for (; lo < bars.length; lo++) if (bars[lo].date > date) break;
    if (lo >= bars.length) return null;
    return _ret(bars, lo, n);
  }
  return _ret(bars, i + 1, n); // enter the session AFTER the event bar
}
function _ret(bars, entryIdx, n) {
  const e = bars[entryIdx];
  const x = bars[entryIdx + n];
  if (!e || !x || !(e.open > 0)) return null;
  return x.close / e.open - 1 - COST;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY + POLYGON_API_KEY');
    process.exit(1);
  }
  const start = `${args.from}-01-01`;
  const end = new Date().toISOString().slice(0, 10);
  console.log(
    `\n🔎 Multi-regime insider backtest — ${BASKET.length} liquid names, ${start}→${end}, min $${args.min.toLocaleString()} insider buying/day`
  );

  // year -> { sig:[+5d returns], base:[+5d returns], n }
  const byYear = {};
  const add = (y, k, v) => {
    (byYear[y] ||= { sig: [], base: [], sig1: [], sig10: [] })[k].push(v);
  };

  for (let t = 0; t < BASKET.length; t++) {
    const tk = BASKET[t];
    let rows = [];
    try {
      rows = await uw.getInsiderBuySells(tk, 60 * 60 * 1000);
    } catch {
      rows = [];
    }
    let bars = [];
    try {
      bars = await polygon.getHistoricalAggregates(tk, start, end, 'day');
    } catch {
      bars = [];
    }
    if (!Array.isArray(bars) || bars.length < 60) {
      await sleep(150);
      continue;
    }
    const idxByDate = new Map(bars.map((b, i) => [b.date, i]));

    // signal events: days with meaningful insider BUYING
    const buyDates = [];
    for (const r of rows) {
      const buy = Math.abs(parseFloat(r.purchases_notional) || 0);
      const d = (r.filing_date || '').slice(0, 10);
      if (buy >= args.min && d >= start && d <= end) buyDates.push(d);
    }
    for (const d of buyDates) {
      const y = d.slice(0, 4);
      const r5 = fwdReturn(bars, idxByDate, d, 5);
      const r1 = fwdReturn(bars, idxByDate, d, 1);
      const r10 = fwdReturn(bars, idxByDate, d, 10);
      if (r5 != null) add(y, 'sig', r5);
      if (r1 != null) byYear[y].sig1.push(r1);
      if (r10 != null) byYear[y].sig10.push(r10);
    }
    // baseline: evenly-spaced random entries on the same ticker, bucketed by year
    const step = Math.max(1, Math.floor(bars.length / 120));
    for (let i = 0; i + 5 < bars.length; i += step) {
      const y = bars[i].date.slice(0, 4);
      if (!byYear[y]) continue; // only years that have signal events
      const r = bars[i + 5].close / bars[i].open - 1 - COST;
      if (Number.isFinite(r)) add(y, 'base', r);
    }
    if (t % 8 === 0) process.stdout.write('.');
    await sleep(150);
  }
  console.log('');

  // ---- report ----
  const years = Object.keys(byYear).sort();
  // rough regime tag for context (not used in math)
  const regime = {
    2018: 'late-2018 selloff',
    2019: 'bull',
    2020: 'COVID crash+recovery',
    2021: 'bull',
    2022: 'BEAR',
    2023: 'recovery',
    2024: 'bull',
    2025: 'bull',
    2026: 'recent bull',
  };
  console.log(
    '\nYear  Regime               n    signal+5d   baseline+5d   EDGE      win%'
  );
  console.log(
    '────────────────────────────────────────────────────────────────────'
  );
  let totSig = [],
    totBase = [];
  for (const y of years) {
    const b = byYear[y];
    if (b.sig.length < 5) continue;
    const s = mean(b.sig),
      base = mean(b.base),
      edge = s - base;
    const win = (b.sig.filter(x => x > 0).length / b.sig.length) * 100;
    totSig.push(...b.sig);
    totBase.push(...b.base);
    const flag = edge > 0.005 ? '✅' : edge < -0.005 ? '❌' : '⚖️';
    console.log(
      `${y}  ${(regime[y] || '').padEnd(20)} ${String(b.sig.length).padStart(4)}  ${pct(s).padStart(9)}   ${pct(base).padStart(9)}   ${pct(edge).padStart(8)} ${flag}  ${win.toFixed(0)}%`
    );
  }
  console.log(
    '────────────────────────────────────────────────────────────────────'
  );
  const allEdge = mean(totSig) - mean(totBase);
  console.log(
    `ALL   ${''.padEnd(20)} ${String(totSig.length).padStart(4)}  ${pct(mean(totSig)).padStart(9)}   ${pct(mean(totBase)).padStart(9)}   ${pct(allEdge).padStart(8)}`
  );
  console.log(
    `\n▶ The question that matters: is EDGE positive in the BEAR/down years (2022, 2020), not just the bull years?`
  );
}

main().catch(e => {
  console.error('failed:', e);
  process.exit(1);
});
