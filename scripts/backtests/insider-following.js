#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/insider-following.js
// EXTENDED insider-following backtest. Sources real officer/director open-market
// PURCHASES once, then sweeps a grid of (TP, SL, hold) exit rules over the same
// event set to find the exit that best captures the multi-day drift. Also reports
// raw forward returns per horizon and a hold-matched random-day baseline.
//
// Point-in-time, no look-ahead: enter at the OPEN of the first session strictly
// AFTER filing_date (the public-information date). Exits walk intraday H/L.
//
// Usage:
//   node scripts/backtests/insider-following.js --events 150 --min 500000
//
// Requires UNUSUAL_WHALES_API_KEY + POLYGON_API_KEY.

require('dotenv').config();
const uw = require('../../server/unusualWhalesClient');
const polygon = require('../../server/polygonClient');

function parseArgs(argv) {
  const a = { events: 150, min: 500000 };
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
const pctStr = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const winRate = xs => (xs.filter(x => x > 0).length / (xs.length || 1)) * 100;

// Source events across the full page budget (NEWEST-first feed), then keep the
// OLDEST `want` events — those are the only ones with enough forward bars to
// honestly measure +5d/+10d returns (the most recent filings have no future yet).
async function sourcePurchaseEvents(want, minNotional, maxPages = 40) {
  const events = [];
  let page = 0;
  const seen = new Set();
  while (page < maxPages) {
    let res;
    try {
      res = await uw.makeRequest(
        `/api/insider/transactions?limit=500&page=${page}`,
        5 * 60 * 1000
      );
    } catch (e) {
      console.error('feed error', e.message);
      break;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      const code = r.transaction_code;
      const amount = Number(r.amount);
      const price = parseFloat(r.price) || 0;
      const isInsider = r.is_officer || r.is_director;
      if (code !== 'P' || amount <= 0 || !isInsider) continue;
      const notional = Math.abs(amount) * price;
      if (notional < minNotional) continue;
      const fdate = (r.filing_date || '').slice(0, 10);
      const tdate = (r.transaction_date || '').slice(0, 10);
      const date = fdate || tdate;
      if (!date || !r.ticker) continue;
      // Drop stale/late filings: if filing lags the txn by > 21 days, the public
      // signal is old news — not representative of a fresh insider buy.
      let lag = null;
      if (fdate && tdate) {
        lag = Math.round((Date.parse(fdate) - Date.parse(tdate)) / 864e5);
      }
      if (lag != null && lag > 21) continue;
      const key = `${r.ticker}|${date}|${r.reporter_cik}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ticker: r.ticker, date, notional, lag });
    }
    page++;
    if (!res.has_more) break;
    await sleep(300);
  }
  // keep the OLDEST `want` (max forward-window availability)
  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return events.slice(0, want);
}

const barCache = new Map();
async function getBars(ticker, startDate, endDate) {
  const key = `${ticker}|${startDate}|${endDate}`;
  if (barCache.has(key)) return barCache.get(key);
  let bars = [];
  try {
    bars = await polygon.getHistoricalAggregates(ticker, startDate, endDate, 'day');
  } catch {
    bars = [];
  }
  const arr = Array.isArray(bars) ? bars : [];
  barCache.set(key, arr);
  return arr;
}

// One exit-rule simulation over the holding window starting at idx (entry bar).
function simExit(bars, idx, tp, sl, hold) {
  const entry = bars[idx].open;
  if (!(entry > 0)) return null;
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  let exitRet = null;
  let reason = 'time';
  let heldDays = 0;
  for (let n = 0; n < hold; n++) {
    const b = bars[idx + n];
    if (!b) break;
    heldDays = n + 1;
    // Conservative ordering: check stop before target within a bar (worst case).
    if (b.low <= slPx) {
      exitRet = -sl / 100;
      reason = 'stop';
      break;
    }
    if (b.high >= tpPx) {
      exitRet = tp / 100;
      reason = 'target';
      break;
    }
    exitRet = b.close / entry - 1;
  }
  return { exitRet, reason, heldDays };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY and POLYGON_API_KEY in .env');
    process.exit(1);
  }

  console.log(
    `\nSourcing up to ${args.events} officer/director purchases >= $${args.min.toLocaleString()} (drop filings lagging txn > 21d)...`
  );
  const events = await sourcePurchaseEvents(args.events, args.min);
  console.log(`Found ${events.length} qualifying purchase events.`);
  if (!events.length) return;

  const dates = events.map(e => e.date).sort();
  console.log(`Date range: ${dates[0]} -> ${dates[dates.length - 1]}`);
  const lags = events.map(e => e.lag).filter(x => x != null);
  console.log(`Median filing lag: ${lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)]} days`);

  const byTicker = {};
  for (const e of events) (byTicker[e.ticker] ||= []).push(e);
  const tickers = Object.keys(byTicker);
  console.log(`${tickers.length} unique tickers.`);

  // Raw forward returns per horizon (entry = next-session OPEN).
  const horizons = [1, 3, 5, 10];
  const rawFwd = {};
  for (const h of horizons) rawFwd[h] = [];

  // Exit-rule grid.
  const grid = [];
  for (const tp of [4, 6, 8, 10, 15]) {
    for (const sl of [3, 4, 6, 8]) {
      for (const hold of [3, 5, 10]) {
        grid.push({ tp, sl, hold, rets: [], target: 0, stop: 0, time: 0 });
      }
    }
  }

  // Hold-matched baseline (random/evenly-spaced entries on same tickers).
  const baseline = { 3: [], 5: [], 10: [] };

  let evaluated = 0;
  for (let t = 0; t < tickers.length; t++) {
    const ticker = tickers[t];
    const evs = byTicker[ticker];
    const evDates = evs.map(e => e.date).sort();
    // Wide window: 120 cal days before the first event (for baseline context)
    // through 30 cal days after the last event (forward bars; capped at today).
    const start = new Date(Date.parse(evDates[0]) - 120 * 864e5).toISOString().slice(0, 10);
    const todayMs = Date.now();
    const endMs = Math.min(Date.parse(evDates[evDates.length - 1]) + 30 * 864e5, todayMs);
    const end = new Date(endMs).toISOString().slice(0, 10);
    const bars = await getBars(ticker, start, end);
    if (bars.length < 8) continue;

    // baseline: every session that has a full +h forward window gets sampled
    // (close-to-open vs entry-open). Same tickers, same forward-window rule as
    // the signal — the only honest comparator.
    for (const h of [3, 5, 10]) {
      for (let i = 0; i + h < bars.length; i++) {
        const o = bars[i].open;
        const c = bars[i + h]?.close;
        if (o > 0 && c > 0) baseline[h].push(c / o - 1);
      }
    }

    for (const e of evs) {
      const idx = bars.findIndex(b => b.date > e.date);
      if (idx < 0 || idx >= bars.length) continue;
      if (!(bars[idx].open > 0)) continue;
      evaluated++;
      const entry = bars[idx].open;
      for (const h of horizons) {
        const b = bars[idx + h];
        if (b) rawFwd[h].push(b.close / entry - 1);
      }
      for (const g of grid) {
        const r = simExit(bars, idx, g.tp, g.sl, g.hold);
        if (r && r.exitRet != null) {
          g.rets.push(r.exitRet);
          g[r.reason]++;
        }
      }
    }
    if (t % 10 === 0) process.stdout.write('.');
    await sleep(50);
  }
  console.log('');

  console.log(`\n=== RAW FORWARD RETURNS (entry = next session open) — ${evaluated} events ===`);
  for (const h of horizons) {
    const xs = rawFwd[h];
    console.log(
      `  +${String(h).padStart(2)}d  n=${String(xs.length).padStart(4)}  mean ${pctStr(mean(xs)).padStart(8)}  median ${pctStr(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] || 0).padStart(8)}  win ${winRate(xs).toFixed(0)}%  std ${(std(xs) * 100).toFixed(1)}%`
    );
  }

  console.log(`\n=== HOLD-MATCHED BASELINE (same tickers, evenly-spaced entries) ===`);
  for (const h of [3, 5, 10]) {
    const xs = baseline[h];
    console.log(`  +${String(h).padStart(2)}d  n=${String(xs.length).padStart(4)}  mean ${pctStr(mean(xs)).padStart(8)}  win ${winRate(xs).toFixed(0)}%`);
  }

  console.log(`\n=== EDGE vs hold-matched baseline (raw fwd close-to-close) ===`);
  for (const h of [3, 5, 10]) {
    const edge = mean(rawFwd[h]) - mean(baseline[h]);
    console.log(`  +${String(h).padStart(2)}d edge ${pctStr(edge).padStart(8)}  (signal ${pctStr(mean(rawFwd[h]))} - base ${pctStr(mean(baseline[h]))})`);
  }

  // Rank exit grid by mean realized return; also show expectancy & sharpe-ish.
  console.log(`\n=== EXIT-RULE GRID (ranked by mean realized return/trade) ===`);
  console.log('  TP/SL/hold      n    mean      win%   target/stop/time   ret/risk');
  const ranked = grid
    .filter(g => g.rets.length >= 20)
    .map(g => ({ ...g, m: mean(g.rets), s: std(g.rets) }))
    .sort((a, b) => b.m - a.m);
  for (const g of ranked) {
    const rr = g.s > 0 ? (g.m / g.s).toFixed(2) : 'n/a';
    console.log(
      `  ${(`${g.tp}/${g.sl}/${g.hold}d`).padEnd(12)} n=${String(g.rets.length).padStart(3)}  ${pctStr(g.m).padStart(7)}  ${winRate(g.rets).toFixed(0).padStart(3)}%   ${String(g.target).padStart(3)}/${String(g.stop).padStart(3)}/${String(g.time).padStart(3)}        ${rr}`
    );
  }

  console.log(`\nTOP 5 EXITS BY EXPECTANCY:`);
  for (const g of ranked.slice(0, 5)) {
    console.log(`  TP ${g.tp}% / SL ${g.sl}% / ${g.hold}d -> ${pctStr(g.m)}/trade, win ${winRate(g.rets).toFixed(0)}%`);
  }
  // also report the broker's CURRENT config (8/4/10)
  const cur = grid.find(g => g.tp === 8 && g.sl === 4 && g.hold === 10);
  if (cur) {
    console.log(`\nBROKER CURRENT (TP 8 / SL 4 / 10d): ${pctStr(mean(cur.rets))}/trade, win ${winRate(cur.rets).toFixed(0)}%, n=${cur.rets.length}`);
  }
}

main().catch(e => {
  console.error('Backtest failed:', e);
  process.exit(1);
});
