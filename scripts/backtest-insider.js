#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtest-insider.js — Pulse-check the insider-following signal against
// HISTORY. Insider data is deeply queryable (UW returns Form-4 transactions going
// back years), so unlike options-flow we can actually backtest this one.
//
// Method (point-in-time, no lookahead):
//   1. Source real officer/director OPEN-MARKET PURCHASES from the UW insider
//      transactions feed (transaction_code 'P', dollar value >= --min).
//   2. For each event, enter at the NEXT session's open (the filing is public
//      after the event), using Polygon daily bars.
//   3. Measure forward return at +1/+3/+5/+10 sessions, plus a TP/SL outcome
//      (the way the broker would actually exit).
//   4. Compare against a random-day baseline on the same tickers — the only
//      honest way to know if "insider bought" beats "any day".
//
// Usage:
//   node scripts/backtest-insider.js                 # defaults: 250 events, $100k min
//   node scripts/backtest-insider.js --events 400 --min 250000 --tp 8 --sl 4 --hold 10
//
// Requires UNUSUAL_WHALES_API_KEY + POLYGON_API_KEY.

require('dotenv').config();
const uw = require('../server/unusualWhalesClient');
const polygon = require('../server/polygonClient');
const { bpsPerSide } = require('../server/risk/transactionCost');

// Round-trip cost as a fraction of notional (entry + exit), for net returns.
const COST_FRAC = (sym => (bpsPerSide(sym) * 2) / 10000)('GENERIC');

function parseArgs(argv) {
  const a = { events: 250, min: 100000, tp: 8, sl: 4, hold: 10 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    if (['events', 'min', 'tp', 'sl', 'hold'].includes(k)) {
      a[k] = parseFloat(v);
      i++;
    }
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0);
const pctStr = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

// Pull officer/director PURCHASE events from the market-wide insider feed,
// paginating until we have `want` of them (or run out).
async function sourcePurchaseEvents(want, minNotional) {
  const events = [];
  let page = 0;
  const seen = new Set();
  while (events.length < want && page < 40) {
    const res = await uw.makeRequest(
      `/api/insider/transactions?limit=500&page=${page}`,
      5 * 60 * 1000
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      const code = r.transaction_code;
      const amount = Number(r.amount);
      const price = parseFloat(r.price) || 0;
      const isInsider = r.is_officer || r.is_director;
      // Open-market purchase (P), by an officer/director, real money.
      if (code !== 'P' || amount <= 0 || !isInsider) continue;
      const notional = Math.abs(amount) * price;
      if (notional < minNotional) continue;
      const date = (r.filing_date || r.transaction_date || '').slice(0, 10);
      if (!date || !r.ticker) continue;
      const key = `${r.ticker}|${date}|${r.reporter_cik}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ticker: r.ticker, date, notional });
      if (events.length >= want) break;
    }
    page++;
    if (!res.has_more) break;
    await sleep(300);
  }
  return events;
}

// daily bars for a ticker, cached, indexed by date.
const barCache = new Map();
async function getBars(ticker, startDate, endDate) {
  const key = `${ticker}|${startDate}|${endDate}`;
  if (barCache.has(key)) return barCache.get(key);
  let bars = [];
  try {
    bars = await polygon.getHistoricalAggregates(
      ticker,
      startDate,
      endDate,
      'day'
    );
  } catch {
    bars = [];
  }
  const arr = Array.isArray(bars) ? bars : [];
  barCache.set(key, arr);
  return arr;
}

// Forward outcome from the first session strictly after `date`.
function evaluateForward(bars, date, { tp, sl, hold }) {
  const idx = bars.findIndex(b => b.date > date);
  if (idx < 0 || idx >= bars.length) return null;
  const entry = bars[idx].open;
  if (!(entry > 0)) return null;

  const ret = n => {
    const b = bars[idx + n];
    return b ? b.close / entry - 1 - COST_FRAC : null; // net of round-trip cost
  };

  // TP/SL walk over the holding window.
  let exitRet = null;
  let exitReason = 'time';
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  for (let n = 0; n < hold; n++) {
    const b = bars[idx + n];
    if (!b) break;
    if (b.low <= slPx) {
      exitRet = -sl / 100 - COST_FRAC;
      exitReason = 'stop';
      break;
    }
    if (b.high >= tpPx) {
      exitRet = tp / 100 - COST_FRAC;
      exitReason = 'target';
      break;
    }
    exitRet = b.close / entry - 1 - COST_FRAC;
  }

  return {
    r1: ret(1),
    r3: ret(3),
    r5: ret(5),
    r10: ret(10),
    exitRet,
    exitReason,
  };
}

// Baseline: forward return from a random set of entry days on the same tickers.
function baselineForward(bars, { hold }) {
  const outs = [];
  // sample up to 10 evenly-spaced entry points per ticker
  const step = Math.max(1, Math.floor(bars.length / 10));
  for (let i = 0; i + hold < bars.length; i += step) {
    const entry = bars[i].open;
    const exit = bars[i + 5]?.close;
    if (entry > 0 && exit > 0) outs.push(exit / entry - 1 - COST_FRAC);
  }
  return outs;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY and POLYGON_API_KEY in .env');
    process.exit(1);
  }

  console.log(
    `\n🔎 Insider backtest — sourcing up to ${args.events} officer/director purchases ≥ $${args.min.toLocaleString()}…`
  );
  const events = await sourcePurchaseEvents(args.events, args.min);
  console.log(`   Found ${events.length} qualifying purchase events.`);
  if (!events.length) {
    console.log('   No events — try a lower --min.');
    return;
  }

  const dates = events.map(e => e.date).sort();
  console.log(`   Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

  // Group by ticker; fetch one daily-bar series per ticker covering the span.
  const byTicker = {};
  for (const e of events) (byTicker[e.ticker] ||= []).push(e);

  const signal = { r1: [], r3: [], r5: [], r10: [], exit: [] };
  const baseline = [];
  let exitsTarget = 0,
    exitsStop = 0,
    exitsTime = 0;
  let evaluated = 0;
  const tickers = Object.keys(byTicker);

  for (let t = 0; t < tickers.length; t++) {
    const ticker = tickers[t];
    const evs = byTicker[ticker];
    const evDates = evs.map(e => e.date).sort();
    const start = new Date(Date.parse(evDates[0]) - 10 * 864e5)
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.parse(evDates[evDates.length - 1]) + 25 * 864e5)
      .toISOString()
      .slice(0, 10);
    const bars = await getBars(ticker, start, end);
    if (bars.length < 12) continue;

    baseline.push(...baselineForward(bars, args));
    for (const e of evs) {
      const o = evaluateForward(bars, e.date, args);
      if (!o) continue;
      evaluated++;
      if (o.r1 != null) signal.r1.push(o.r1);
      if (o.r3 != null) signal.r3.push(o.r3);
      if (o.r5 != null) signal.r5.push(o.r5);
      if (o.r10 != null) signal.r10.push(o.r10);
      if (o.exitRet != null) {
        signal.exit.push(o.exitRet);
        if (o.exitReason === 'target') exitsTarget++;
        else if (o.exitReason === 'stop') exitsStop++;
        else exitsTime++;
      }
    }
    if (t % 10 === 0) process.stdout.write('.');
  }
  console.log('');

  const winRate = xs => (xs.filter(x => x > 0).length / (xs.length || 1)) * 100;
  const row = (label, xs) =>
    `   ${label.padEnd(18)} n=${String(xs.length).padStart(4)}  mean ${pctStr(mean(xs)).padStart(8)}  win ${winRate(xs).toFixed(0).padStart(3)}%`;

  console.log(
    `\n📊 INSIDER BACKTEST RESULTS  (${evaluated} trades simulated)\n`
  );
  console.log('   Forward return after an insider open-market buy:');
  console.log(row('+1 session', signal.r1));
  console.log(row('+3 sessions', signal.r3));
  console.log(row('+5 sessions', signal.r5));
  console.log(row('+10 sessions', signal.r10));
  console.log('');
  console.log(
    `   Broker-style exit (TP +${args.tp}% / SL -${args.sl}% / ${args.hold}d max):`
  );
  console.log(row('  realized', signal.exit));
  console.log(
    `   exits → target ${exitsTarget} · stop ${exitsStop} · time ${exitsTime}`
  );
  console.log('');
  console.log('   Random-day baseline (same tickers, +5 sessions):');
  console.log(row('  baseline', baseline));

  const edge = mean(signal.r5) - mean(baseline);
  console.log(
    `\n   ▶ Edge vs baseline (+5d): ${pctStr(edge)}  →  ${edge > 0.002 ? 'INSIDER BUYS BEAT RANDOM ✅' : edge < -0.002 ? 'no edge ❌' : 'inconclusive ⚖️'}`
  );
  console.log(
    `   ▶ Broker-exit expectancy: ${pctStr(mean(signal.exit))}/trade  ` +
      `(${mean(signal.exit) > 0 ? 'positive — worth live sim' : 'negative — signal/exits need work'})\n`
  );
}

main().catch(e => {
  console.error('Backtest failed:', e);
  process.exit(1);
});
