#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/exit-hold-policy.js
//
// EXIT-SENSITIVITY GRID for the multi-day signal (insider open-market buys).
//
// We reuse the insider signal (deeply backtestable, multi-day drift) as a
// stand-in for "a real multi-day entry" and grid the engine's actual exit
// primitives: take-profit %, stop-loss %, max-hold days, plus optional
// min-hold and a trailing-stop variant. Goal: find the exit PROFILE that
// maximizes per-trade expectancy, and recommend defaults per horizon.
//
// Method (point-in-time, no look-ahead):
//   1. Source officer/director open-market PURCHASES (code 'P', >= --min).
//   2. Enter at the NEXT session open (filing is public after the event).
//   3. Walk daily bars day-by-day. Within each day, model the engine's exit
//      ordering CONSERVATIVELY (stop checked before target — assume the
//      adverse touch happens first when a bar straddles both). Honor a
//      min-hold-days floor (stop/target suppressed until floor passed; this
//      mirrors minHoldMinutes but at day granularity), and a trailing stop
//      on the running high-water-mark.
//   4. Expectancy = mean realized return per trade for each exit profile.
//   5. Baseline = same exit grid applied to RANDOM entry days on the same
//      tickers, so we measure the exit profile's edge net of the signal.
//
// Bounded: <=150 events, <=25 tickers, 300ms sleeps, 429-safe.
//
// Usage:
//   node scripts/backtests/exit-hold-policy.js
//   node scripts/backtests/exit-hold-policy.js --events 120 --min 150000

require('dotenv').config();
const uw = require('../../server/unusualWhalesClient');
const polygon = require('../../server/polygonClient');

const MAX_TICKERS = 25;

function parseArgs(argv) {
  const a = { events: 150, min: 100000 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    if (['events', 'min'].includes(k)) {
      a[k] = parseFloat(v);
      i++;
    }
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((p, c) => p + (c - m) ** 2, 0) / (xs.length - 1));
};
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const winRate = xs =>
  xs.length ? (xs.filter(x => x > 0).length / xs.length) * 100 : 0;

async function sourcePurchaseEvents(want, minNotional, maxDate) {
  const events = [];
  let page = 0;
  const seen = new Set();
  while (events.length < want && page < 200) {
    let res;
    try {
      res = await uw.makeRequest(
        `/api/insider/transactions?limit=500&page=${page}`,
        5 * 60 * 1000
      );
    } catch (e) {
      console.error('  insider fetch error:', e.message);
      break;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      if (r.transaction_code !== 'P') continue;
      const amount = Number(r.amount);
      if (!(amount > 0)) continue;
      if (!(r.is_officer || r.is_director)) continue;
      const price = parseFloat(r.price) || 0;
      const notional = Math.abs(amount) * price;
      if (notional < minNotional) continue;
      const date = (r.filing_date || r.transaction_date || '').slice(0, 10);
      if (!date || !r.ticker) continue;
      // Only events old enough to have a full forward window (skip recent
      // entries whose +10 sessions don't exist yet → otherwise time-exits
      // truncate at "today" and bias expectancy).
      if (maxDate && date > maxDate) continue;
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

const barCache = new Map();
async function getBars(ticker, start, end) {
  const key = `${ticker}|${start}|${end}`;
  if (barCache.has(key)) return barCache.get(key);
  let bars = [];
  try {
    bars = await polygon.getHistoricalAggregates(ticker, start, end, 'day');
  } catch {
    bars = [];
  }
  const arr = Array.isArray(bars) ? bars : [];
  barCache.set(key, arr);
  return arr;
}

// Simulate one exit profile starting at bar index `idx` (the entry-open bar).
// profile: { tp, sl, hold, minHoldDays, trail }  (percentages; trail = % drop
// from high-water-mark, 0 = disabled). Returns { ret, reason } or null.
function simExit(bars, idx, profile) {
  const entry = bars[idx]?.open;
  if (!(entry > 0)) return null;
  const { tp, sl, hold, minHoldDays = 0, trail = 0 } = profile;
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  let hwm = entry;

  for (let n = 0; n < hold; n++) {
    const b = bars[idx + n];
    if (!b) break;
    const canExitStops = n >= minHoldDays;

    if (canExitStops) {
      // Conservative ordering: assume the adverse touch first within the bar.
      if (b.low <= slPx) return { ret: -sl / 100, reason: 'stop' };
      // Trailing stop on prior high-water-mark (uses bar low as proxy touch).
      if (trail > 0) {
        const trailPx = hwm * (1 - trail / 100);
        if (trailPx > slPx && b.low <= trailPx) {
          return { ret: trailPx / entry - 1, reason: 'trail' };
        }
      }
      if (b.high >= tpPx) return { ret: tp / 100, reason: 'target' };
    }
    if (b.high > hwm) hwm = b.high;
    // mark-to-market close (becomes the time-exit return if loop ends)
    if (n === hold - 1 || !bars[idx + n + 1]) {
      return { ret: b.close / entry - 1, reason: 'time' };
    }
  }
  return null;
}

function summarize(label, rets, reasons) {
  const m = mean(rets);
  const s = std(rets);
  const sharpe = s > 0 ? m / s : 0;
  const r = reasons.reduce((acc, x) => ((acc[x] = (acc[x] || 0) + 1), acc), {});
  return {
    label,
    n: rets.length,
    mean: m,
    win: winRate(rets),
    std: s,
    sharpe,
    target: r.target || 0,
    stop: r.stop || 0,
    trail: r.trail || 0,
    time: r.time || 0,
  };
}

async function main() {
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY and POLYGON_API_KEY in .env');
    process.exit(1);
  }
  const args = parseArgs(process.argv);
  // Require entries old enough that a ~10-session forward window exists.
  // The insider feed only reaches ~3 weeks back in practice, so 16 cal days
  // is the deepest cutoff that still leaves a usable forward window.
  const maxDate = new Date(Date.now() - 16 * 864e5).toISOString().slice(0, 10);
  console.log(
    `\n[exit-grid] sourcing up to ${args.events} insider buys >= $${args.min.toLocaleString()} dated <= ${maxDate}...`
  );
  const events = await sourcePurchaseEvents(args.events, args.min, maxDate);
  console.log(`  found ${events.length} events`);
  if (!events.length) return;

  // Cap tickers for bounded API use.
  const byTicker = {};
  for (const e of events) (byTicker[e.ticker] ||= []).push(e);
  let tickers = Object.keys(byTicker);
  if (tickers.length > MAX_TICKERS) {
    // keep the tickers with most events (densest data) up to the cap
    tickers = tickers
      .sort((a, b) => byTicker[b].length - byTicker[a].length)
      .slice(0, MAX_TICKERS);
  }
  const dates = events.map(e => e.date).sort();
  console.log(
    `  ${tickers.length} tickers, dates ${dates[0]} -> ${dates[dates.length - 1]}`
  );

  // Exit profiles to grid (the engine's real primitives).
  // tp/sl in %, hold in days, minHoldDays, trail in % off HWM.
  const profiles = [
    { tp: 8, sl: 4, hold: 10, minHoldDays: 0, trail: 0 }, // current insider default
    { tp: 4, sl: 2, hold: 5, minHoldDays: 0, trail: 0 }, // current dark-pool default
    { tp: 6, sl: 3, hold: 10, minHoldDays: 0, trail: 0 },
    { tp: 10, sl: 5, hold: 10, minHoldDays: 0, trail: 0 },
    { tp: 12, sl: 6, hold: 15, minHoldDays: 0, trail: 0 },
    { tp: 8, sl: 4, hold: 5, minHoldDays: 0, trail: 0 }, // tighter time
    { tp: 8, sl: 4, hold: 20, minHoldDays: 0, trail: 0 }, // longer time
    { tp: 8, sl: 6, hold: 10, minHoldDays: 0, trail: 0 }, // wider stop
    { tp: 8, sl: 3, hold: 10, minHoldDays: 0, trail: 0 }, // tighter stop
    { tp: 8, sl: 4, hold: 10, minHoldDays: 1, trail: 0 }, // 1-day min-hold
    { tp: 8, sl: 4, hold: 10, minHoldDays: 0, trail: 5 }, // + trailing 5%
    { tp: 99, sl: 4, hold: 10, minHoldDays: 0, trail: 0 }, // stop-only (let winners run to time)
    { tp: 8, sl: 99, hold: 10, minHoldDays: 0, trail: 0 }, // target-only (no stop)
    { tp: 99, sl: 99, hold: 5, minHoldDays: 0, trail: 0 }, // pure time exit, 5d
    { tp: 99, sl: 99, hold: 10, minHoldDays: 0, trail: 0 }, // pure time exit, 10d
  ];

  const sigRets = profiles.map(() => []);
  const sigReasons = profiles.map(() => []);
  const baseRets = profiles.map(() => []);
  const baseReasons = profiles.map(() => []);
  let evaluated = 0;

  for (let t = 0; t < tickers.length; t++) {
    const ticker = tickers[t];
    const evs = byTicker[ticker];
    const evDates = evs.map(e => e.date).sort();
    const start = new Date(Date.parse(evDates[0]) - 10 * 864e5)
      .toISOString()
      .slice(0, 10);
    const end = new Date(Date.parse(evDates[evDates.length - 1]) + 35 * 864e5)
      .toISOString()
      .slice(0, 10);
    const bars = await getBars(ticker, start, end);
    await sleep(300);
    if (bars.length < 15) continue;

    // Signal entries: next session after each event date.
    for (const e of evs) {
      const idx = bars.findIndex(b => b.date > e.date);
      if (idx < 0) continue;
      evaluated++;
      profiles.forEach((p, pi) => {
        const o = simExit(bars, idx, p);
        if (o) {
          sigRets[pi].push(o.ret);
          sigReasons[pi].push(o.reason);
        }
      });
    }

    // Baseline entries: evenly-spaced random days on the same ticker.
    const step = Math.max(1, Math.floor(bars.length / 8));
    for (let i = 5; i + 1 < bars.length; i += step) {
      profiles.forEach((p, pi) => {
        const o = simExit(bars, i, p);
        if (o) {
          baseRets[pi].push(o.ret);
          baseReasons[pi].push(o.reason);
        }
      });
    }
    process.stdout.write('.');
  }
  console.log(`\n  evaluated ${evaluated} signal entries\n`);

  const sig = profiles.map((p, i) =>
    summarize(JSON.stringify(p), sigRets[i], sigReasons[i])
  );
  const base = profiles.map((p, i) =>
    summarize(JSON.stringify(p), baseRets[i], baseReasons[i])
  );

  console.log('EXIT PROFILE GRID (signal = insider buy entries)\n');
  const hdr =
    'tp/sl/hold/minH/trail'.padEnd(24) +
    'n'.padStart(5) +
    'exp'.padStart(9) +
    'win'.padStart(6) +
    'sharpe'.padStart(8) +
    '  tgt/stp/trl/tim'.padEnd(20) +
    '  edge_vs_base'.padStart(14);
  console.log(hdr);
  console.log('-'.repeat(hdr.length));
  profiles.forEach((p, i) => {
    const s = sig[i];
    const b = base[i];
    const edge = s.mean - b.mean;
    const tag = `${p.tp}/${p.sl}/${p.hold}/${p.minHoldDays}/${p.trail}`;
    console.log(
      tag.padEnd(24) +
        String(s.n).padStart(5) +
        pct(s.mean).padStart(9) +
        `${s.win.toFixed(0)}%`.padStart(6) +
        s.sharpe.toFixed(2).padStart(8) +
        `  ${s.target}/${s.stop}/${s.trail}/${s.time}`.padEnd(20) +
        `  ${pct(edge)}`.padStart(14)
    );
  });

  // Rank by expectancy and by edge-vs-baseline.
  const ranked = profiles
    .map((p, i) => ({
      p,
      exp: sig[i].mean,
      edge: sig[i].mean - base[i].mean,
      sharpe: sig[i].sharpe,
      win: sig[i].win,
    }))
    .filter(x => x.exp != null);

  const byExp = [...ranked].sort((a, b) => b.exp - a.exp);
  const byEdge = [...ranked].sort((a, b) => b.edge - a.edge);

  console.log('\nTOP 3 by raw expectancy:');
  byExp.slice(0, 3).forEach(x => {
    const p = x.p;
    console.log(
      `  tp${p.tp}/sl${p.sl}/hold${p.hold}/minH${p.minHoldDays}/trail${p.trail}  exp ${pct(x.exp)}  win ${x.win.toFixed(0)}%  sharpe ${x.sharpe.toFixed(2)}`
    );
  });
  console.log('\nTOP 3 by edge vs baseline:');
  byEdge.slice(0, 3).forEach(x => {
    const p = x.p;
    console.log(
      `  tp${p.tp}/sl${p.sl}/hold${p.hold}/minH${p.minHoldDays}/trail${p.trail}  edge ${pct(x.edge)}  exp ${pct(x.exp)}`
    );
  });
  console.log('');
}

main().catch(e => {
  console.error('Backtest failed:', e);
  process.exit(1);
});
