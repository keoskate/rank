#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/options-flow.js
//
// Backtest a HISTORICAL PROXY for the live options-flow signal.
//
// The live plugin (server/strategies/optionsFlow.js) reads INTRADAY flow-alerts
// (/api/stock/{t}/flow-alerts) which are RECENT-ONLY (~last 2h, confirmed: the
// alert feed for NVDA spanned only 18:01->19:59 same day). You CANNOT backtest
// the alert feed from history.
//
// BUT the UW key exposes a daily options-flow aggregate that IS queryable back
// ~120 sessions via the rolling `limit` param (the `date=` param is gated to 7
// trading days, but `?limit=120` is NOT):
//   GET /api/stock/{t}/options-volume?limit=120
//     -> [{ date, call_volume, put_volume, net_call_premium, net_put_premium,
//           bullish_premium, bearish_premium, call_volume_ask_side, ... }, ...]
//
// This is the closest faithful PROXY for the live signal: it measures the same
// thing (net directional options premium / call-vs-put skew per day), just
// aggregated to a daily bar instead of intraday alerts.
//
// Method (point-in-time, NO lookahead):
//   For each ticker, for each day D where the daily flow is BULLISH-skewed and
//   sized (mirrors the plugin's minSkew + minPremium gates), enter at the NEXT
//   session's open (D+1, flow for day D is only known after the close), then
//   measure forward return at +1/+3/+5 sessions and a broker-style TP/SL exit.
//   Compare to a random-day baseline on the same tickers.
//
// Two skew definitions are tested:
//   A) callShare = call_premium / (call_premium+put_premium)   [matches plugin]
//   B) bullShare = bullish_premium / (bullish_premium+bearish_premium)
//      (UW's own buy/sell-pressure classification — arguably truer "smart money")
//
// Usage:
//   node scripts/backtests/options-flow.js
//   node scripts/backtests/options-flow.js --skew 0.62 --minprem 200000000 --tp 2 --sl 1 --hold 5

require('dotenv').config();
const uw = require('../../server/unusualWhalesClient');
const polygon = require('../../server/polygonClient');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const _num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const mean = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};
const pctStr = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const winRate = xs => (xs.length ? (xs.filter(x => x > 0).length / xs.length) * 100 : 0);

function parseArgs(argv) {
  const a = { skew: 0.6, minprem: 0, tp: 2, sl: 1, hold: 5, limit: 120 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k in a) {
      a[k] = parseFloat(argv[i + 1]);
      i++;
    }
  }
  return a;
}

// Liquid optionable names that the plugin universe actually watches + a few more.
const UNIVERSE = [
  'NVDA', 'AMD', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'SMCI',
  'AVGO', 'MU', 'NFLX', 'COIN', 'PLTR', 'MARA', 'SOFI', 'BABA', 'INTC',
  'QCOM', 'CRM', 'UBER', 'SHOP', 'SNAP', 'DELL', 'ARM',
];

async function getDailyFlow(ticker, limit) {
  const res = await uw.makeRequest(
    `/api/stock/${ticker}/options-volume?limit=${limit}`,
    5 * 60 * 1000
  );
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows
    .map(r => {
      const callPrem = _num(r.call_premium);
      const putPrem = _num(r.put_premium);
      const bull = _num(r.bullish_premium);
      const bear = _num(r.bearish_premium);
      const totCP = callPrem + putPrem;
      const totBB = bull + bear;
      return {
        date: (r.date || '').slice(0, 10),
        callShare: totCP > 0 ? callPrem / totCP : 0.5,
        bullShare: totBB > 0 ? bull / totBB : 0.5,
        totalPremium: totCP,
        netCallPremium: _num(r.net_call_premium),
        netPutPremium: _num(r.net_put_premium),
      };
    })
    .filter(r => r.date)
    .sort((a, b) => a.date.localeCompare(b.date));
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

// Forward outcome from first session strictly after `date`.
function evaluateForward(bars, date, { tp, sl, hold }) {
  const idx = bars.findIndex(b => b.date > date);
  if (idx < 1 || idx >= bars.length) return null; // need idx>=1 so we don't enter on day 0
  const entry = bars[idx].open;
  if (!(entry > 0)) return null;
  const ret = n => {
    const b = bars[idx + n];
    return b ? b.close / entry - 1 : null;
  };
  let exitRet = null;
  let exitReason = 'time';
  const tpPx = entry * (1 + tp / 100);
  const slPx = entry * (1 - sl / 100);
  for (let n = 0; n < hold; n++) {
    const b = bars[idx + n];
    if (!b) break;
    // conservative: check stop before target within the same bar
    if (b.low <= slPx) {
      exitRet = -sl / 100;
      exitReason = 'stop';
      break;
    }
    if (b.high >= tpPx) {
      exitRet = tp / 100;
      exitReason = 'target';
      break;
    }
    exitRet = b.close / entry - 1;
  }
  return { r1: ret(1), r3: ret(3), r5: ret(5), exitRet, exitReason };
}

function baselineForward(bars, { hold }) {
  const outs = [];
  const step = Math.max(1, Math.floor(bars.length / 12));
  for (let i = 0; i + hold < bars.length; i += step) {
    const entry = bars[i].open;
    const exit = bars[i + hold]?.close;
    if (entry > 0 && exit > 0) outs.push(exit / entry - 1);
  }
  return outs;
}

async function runVariant(label, pick, args, flowByTicker, barsByTicker) {
  const sig = { r1: [], r3: [], r5: [], exit: [] };
  let target = 0, stop = 0, time = 0, signals = 0;
  for (const ticker of Object.keys(flowByTicker)) {
    const flow = flowByTicker[ticker];
    const bars = barsByTicker[ticker];
    if (!bars || bars.length < 15) continue;
    for (const f of flow) {
      if (!pick(f)) continue;
      const o = evaluateForward(bars, f.date, args);
      if (!o) continue;
      signals++;
      if (o.r1 != null) sig.r1.push(o.r1);
      if (o.r3 != null) sig.r3.push(o.r3);
      if (o.r5 != null) sig.r5.push(o.r5);
      if (o.exitRet != null) {
        sig.exit.push(o.exitRet);
        if (o.exitReason === 'target') target++;
        else if (o.exitReason === 'stop') stop++;
        else time++;
      }
    }
  }
  return { label, sig, target, stop, time, signals };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!uw.isConfigured() || !process.env.POLYGON_API_KEY) {
    console.error('Need UNUSUAL_WHALES_API_KEY and POLYGON_API_KEY');
    process.exit(1);
  }
  console.log(
    `\n🔎 options-flow PROXY backtest — daily options-volume aggregate, ` +
      `${UNIVERSE.length} tickers, limit=${args.limit}`
  );
  console.log(
    `   gates: bullish-skew >= ${args.skew}, totalPremium >= $${args.minprem.toLocaleString()}  | ` +
      `exit TP +${args.tp}% / SL -${args.sl}% / ${args.hold}d`
  );

  const flowByTicker = {};
  const barsByTicker = {};
  for (const ticker of UNIVERSE) {
    const flow = await getDailyFlow(ticker, args.limit);
    await sleep(300);
    if (!flow.length) {
      console.log(`   ${ticker}: no flow data, skipping`);
      continue;
    }
    flowByTicker[ticker] = flow;
    const start = flow[0].date;
    const end = new Date(Date.parse(flow[flow.length - 1].date) + 15 * 864e5)
      .toISOString()
      .slice(0, 10);
    barsByTicker[ticker] = await getBars(ticker, start, end);
    process.stdout.write('.');
  }
  console.log('');

  // baseline across the same tickers
  const baseline = [];
  for (const ticker of Object.keys(barsByTicker)) {
    baseline.push(...baselineForward(barsByTicker[ticker], args));
  }

  // Variant A: callShare skew (matches the live plugin's callShare definition)
  const A = await runVariant(
    'A: callShare>=skew',
    f => f.callShare >= args.skew && f.totalPremium >= args.minprem,
    args, flowByTicker, barsByTicker
  );
  // Variant B: UW bullish/bearish premium classification
  const B = await runVariant(
    'B: bullShare>=skew',
    f => f.bullShare >= args.skew && f.totalPremium >= args.minprem,
    args, flowByTicker, barsByTicker
  );
  // Variant C: positive net_call_premium (institutional net call buying)
  const C = await runVariant(
    'C: netCallPrem>0',
    f => f.netCallPremium > 0 && f.totalPremium >= args.minprem,
    args, flowByTicker, barsByTicker
  );

  const tval = (xs, base) => {
    // Welch-ish t-stat of signal mean vs baseline mean (+5d horizon)
    const n1 = xs.length, n2 = base.length;
    if (n1 < 2 || n2 < 2) return 0;
    const v1 = std(xs) ** 2 / n1, v2 = std(base) ** 2 / n2;
    const se = Math.sqrt(v1 + v2);
    return se > 0 ? (mean(xs) - mean(base)) / se : 0;
  };

  const row = (label, xs) =>
    `   ${label.padEnd(20)} n=${String(xs.length).padStart(4)}  mean ${pctStr(mean(xs)).padStart(8)}  win ${winRate(xs).toFixed(0).padStart(3)}%`;

  console.log(`\n📊 BASELINE (random entry days, same tickers, +${args.hold}d):`);
  console.log(row('baseline', baseline));

  for (const V of [A, B, C]) {
    console.log(`\n📈 VARIANT ${V.label}   (${V.signals} signal-days)`);
    console.log(row('  +1 session', V.sig.r1));
    console.log(row('  +3 sessions', V.sig.r3));
    console.log(row('  +5 sessions', V.sig.r5));
    console.log(row('  broker-exit', V.sig.exit));
    console.log(
      `   exits → target ${V.target} · stop ${V.stop} · time ${V.time}`
    );
    const edge5 = mean(V.sig.r5) - mean(baseline);
    const t = tval(V.sig.r5, baseline);
    console.log(
      `   ▶ edge vs baseline (+5d): ${pctStr(edge5)}  t≈${t.toFixed(2)}  ` +
        `${t > 2 ? 'EDGE ✅' : t < -2 ? 'NEGATIVE ❌' : 'inconclusive ⚖️'}`
    );
    console.log(
      `   ▶ broker-exit expectancy: ${pctStr(mean(V.sig.exit))}/trade`
    );
  }
  console.log('');
}

main().catch(e => {
  console.error('Backtest failed:', e);
  process.exit(1);
});
