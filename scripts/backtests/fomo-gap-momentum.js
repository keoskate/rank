#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/fomo-gap-momentum.js
//
// FOMO opening gap-up momentum (idea #5).
//
// HYPOTHESIS: on a liquid universe, when a stock gaps UP > X% at the open, you
// can buy at the open and ride momentum, exiting same-day-close (or next-close).
// "Don't fight the FOMO." Classic retail intuition. We test whether it has
// POSITIVE NET EXPECTANCY after transaction cost, or whether you just buy the top.
//
// MECHANICAL RULE (point-in-time, no lookahead):
//   Universe: ~40 liquid S&P-100 names.
//   For each ticker, each day D (using daily bars):
//     gap = open[D] / close[D-1] - 1
//   ENTRY: if gap >= GAP_PCT, buy at open[D].
//     (Everything in the signal — open[D], close[D-1] — is known AT the open[D].)
//   Optional VOLUME gate: relative volume uses prior-day volume vs trailing-20
//     average (KNOWN at open[D], no lookahead). We also test "no vol gate".
//   EXITS (three variants, all measured net of round-trip cost):
//     1) SAME-DAY CLOSE:  open[D] -> close[D]
//     2) NEXT-DAY CLOSE:  open[D] -> close[D+1]
//     3) TIGHT-STOP intraday same-day: stop at open*(1-STOP%), else exit close[D].
//        (conservative: if low[D] <= stop, assume filled at stop.)
//   Sizing for the equity curve: 1 unit per signal, signals pooled across the
//   universe by date; daily portfolio return = equal-weight mean of that day's
//   signal trade returns (net). Days with no signal = flat (0% return, cash).
//
// COST: server/risk/transactionCost.js bpsPerSide() — round trip = 2*bps.
//
// BENCHMARK: buy-and-hold SPY and QQQ over the SAME window (2018-01-01..today),
//   so we can separate alpha from beta and see 2020-crash / 2022-bear behavior.
//
// Usage:
//   node scripts/backtests/fomo-gap-momentum.js
//   node scripts/backtests/fomo-gap-momentum.js --gap 2 --stop 1.5 --relvol 1.5

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = '2018-01-01';
const END = new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const a = { gap: 2, stop: 1.5, relvol: 0, hold: 1 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k in a) {
      a[k] = parseFloat(argv[i + 1]);
      i++;
    }
  }
  return a;
}

// ~40 liquid S&P-100 names spanning sectors (all trading the whole window).
const UNIVERSE = [
  'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA', 'JPM', 'V', 'MA',
  'UNH', 'HD', 'PG', 'JNJ', 'XOM', 'CVX', 'KO', 'PEP', 'WMT', 'DIS',
  'NFLX', 'ADBE', 'CRM', 'INTC', 'AMD', 'QCOM', 'CSCO', 'ORCL', 'TXN', 'IBM',
  'BAC', 'WFC', 'GS', 'MS', 'C', 'BA', 'CAT', 'GE', 'MCD', 'NKE',
];

const mean = xs => (xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((p, c) => p + (c - m) ** 2, 0) / (xs.length - 1));
};
const pctStr = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const yearOf = d => d.slice(0, 4);

// regime tags for sub-windows
function regime(date) {
  if (date >= '2018-10-01' && date <= '2018-12-31') return '2018Q4-selloff';
  if (date >= '2020-02-19' && date <= '2020-04-07') return '2020-COVID-crash';
  if (date >= '2022-01-01' && date <= '2022-12-31') return '2022-bear';
  return 'other';
}

async function getBars(ticker) {
  try {
    const bars = await polygon.getHistoricalAggregates(ticker, START, END, 'day');
    return Array.isArray(bars) ? bars : [];
  } catch (e) {
    console.warn(`   ${ticker}: fetch error ${e.message}`);
    return [];
  }
}

// Build all signal trades for a ticker given thresholds. Returns array of
// { date, year, regime, gap, retSameDay, retNextDay, retStop }, each net of cost.
function buildTrades(bars, { gapPct, stopPct, relvolMin }) {
  const trades = [];
  if (bars.length < 25) return trades;
  const cost = (bpsPerSide('AAPL') * 2) / 10000; // ordinary equity round-trip
  for (let i = 21; i < bars.length; i++) {
    const today = bars[i];
    const prev = bars[i - 1];
    if (!(today.open > 0) || !(prev.close > 0)) continue;
    const gap = today.open / prev.close - 1;
    if (gap < gapPct / 100) continue;

    // relative volume gate uses PRIOR day's volume (known at today's open).
    if (relvolMin > 0) {
      const win = bars.slice(i - 21, i - 1); // 20 days before prev
      const avgVol = mean(win.map(b => b.volume).filter(v => v > 0));
      if (!(avgVol > 0)) continue;
      const relvol = prev.volume / avgVol;
      if (relvol < relvolMin) continue;
    }

    const entry = today.open;
    // 1) same-day close
    const retSameDay = today.close / entry - 1 - cost;
    // 2) next-day close
    const next = bars[i + 1];
    const retNextDay = next ? next.close / entry - 1 - cost : null;
    // 3) tight-stop same-day
    const stopPx = entry * (1 - stopPct / 100);
    let retStop;
    if (today.low <= stopPx) {
      retStop = -stopPct / 100 - cost; // assume filled at stop
    } else {
      retStop = today.close / entry - 1 - cost;
    }

    trades.push({
      date: today.date,
      year: yearOf(today.date),
      regime: regime(today.date),
      gap,
      retSameDay,
      retNextDay,
      retStop,
    });
  }
  return trades;
}

// Buy-and-hold benchmark stats over the window.
function buyHold(bars) {
  if (bars.length < 2) return null;
  const px = bars.map(b => b.close).filter(c => c > 0);
  const rets = [];
  for (let i = 1; i < px.length; i++) rets.push(px[i] / px[i - 1] - 1);
  const total = px[px.length - 1] / px[0] - 1;
  const years = bars.length / 252;
  const cagr = (1 + total) ** (1 / years) - 1;
  const sharpe = std(rets) > 0 ? (mean(rets) / std(rets)) * Math.sqrt(252) : 0;
  // max drawdown
  let peak = px[0], maxDD = 0;
  for (const p of px) {
    if (p > peak) peak = p;
    const dd = p / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return { total, cagr, sharpe, maxDD, rets, dates: bars.map(b => b.date) };
}

// Build a portfolio daily-return series from pooled signal trades for one exit
// variant. exitField in {retSameDay, retNextDay, retStop}. Daily return = mean
// of that day's signal returns (equal weight); no-signal days = 0 (cash).
function portfolioSeries(allTrades, exitField, allDates) {
  const byDate = new Map();
  for (const t of allTrades) {
    const r = t[exitField];
    if (r == null) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(r);
  }
  const rets = [];
  let nSignalDays = 0, nTrades = 0;
  for (const d of allDates) {
    if (byDate.has(d)) {
      const day = byDate.get(d);
      rets.push(mean(day));
      nSignalDays++;
      nTrades += day.length;
    } else {
      rets.push(0);
    }
  }
  return { rets, dates: allDates, nSignalDays, nTrades };
}

function curveStats(series) {
  const { rets, dates } = series;
  let equity = 1, peak = 1, maxDD = 0;
  const curve = [];
  for (const r of rets) {
    equity *= 1 + r;
    curve.push(equity);
    if (equity > peak) peak = equity;
    const dd = equity / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  const total = equity - 1;
  const years = rets.length / 252;
  const cagr = years > 0 ? (1 + total) ** (1 / years) - 1 : 0;
  // Sharpe on the FULL daily series (incl. cash days = 0) — annualized.
  const sharpe = std(rets) > 0 ? (mean(rets) / std(rets)) * Math.sqrt(252) : 0;
  return { total, cagr, sharpe, maxDD, curve, dates };
}

// per-trade expectancy stats for a variant (only signal trades).
function tradeStats(allTrades, exitField) {
  const xs = allTrades.map(t => t[exitField]).filter(r => r != null);
  if (!xs.length) return { n: 0 };
  const wins = xs.filter(x => x > 0).length;
  // t-stat of mean != 0
  const se = std(xs) / Math.sqrt(xs.length);
  const t = se > 0 ? mean(xs) / se : 0;
  return {
    n: xs.length,
    mean: mean(xs),
    median: [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)],
    win: (wins / xs.length) * 100,
    t,
  };
}

function byBucket(allTrades, exitField, keyFn) {
  const m = new Map();
  for (const tr of allTrades) {
    const r = tr[exitField];
    if (r == null) continue;
    const k = keyFn(tr);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  const out = [];
  for (const [k, xs] of [...m.entries()].sort()) {
    const wins = xs.filter(x => x > 0).length;
    out.push({
      key: k,
      n: xs.length,
      mean: mean(xs),
      win: (wins / xs.length) * 100,
      sum: xs.reduce((p, c) => p + c, 0), // cumulative (additive proxy)
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.POLYGON_API_KEY) {
    console.error('Need POLYGON_API_KEY');
    process.exit(1);
  }
  console.log(
    `\n🔎 FOMO gap-up momentum backtest — ${UNIVERSE.length} tickers, ${START}..${END}`
  );
  console.log(
    `   ENTRY: gap >= ${args.gap}%  | relvol gate >= ${args.relvol || 'none'}  ` +
      `| tight stop -${args.stop}%`
  );
  console.log(
    `   cost: ${bpsPerSide('AAPL')}bps/side -> ${bpsPerSide('AAPL') * 2}bps round-trip\n`
  );

  const allTrades = [];
  const allDatesSet = new Set();
  let benchSPY = null, benchQQQ = null;

  // benchmarks first
  for (const sym of ['SPY', 'QQQ']) {
    const bars = await getBars(sym);
    await sleep(200);
    const bh = buyHold(bars);
    if (sym === 'SPY') benchSPY = bh;
    else benchQQQ = bh;
    if (bh) bars.forEach(b => allDatesSet.add(b.date));
  }

  for (const ticker of UNIVERSE) {
    const bars = await getBars(ticker);
    await sleep(200);
    if (bars.length < 50) {
      console.log(`   ${ticker}: insufficient bars (${bars.length}), skip`);
      continue;
    }
    bars.forEach(b => allDatesSet.add(b.date));
    const trades = buildTrades(bars, {
      gapPct: args.gap,
      stopPct: args.stop,
      relvolMin: args.relvol,
    });
    for (const t of trades) allTrades.push(t);
    process.stdout.write('.');
  }
  console.log(`\n\nTotal signal trades: ${allTrades.length}`);

  const allDates = [...allDatesSet].sort();

  // ---- per-trade expectancy ----
  console.log('\n📊 PER-TRADE EXPECTANCY (net of cost):');
  for (const [label, field] of [
    ['same-day close (O->C)', 'retSameDay'],
    ['next-day close (O->C+1)', 'retNextDay'],
    [`tight-stop -${args.stop}% else close`, 'retStop'],
  ]) {
    const s = tradeStats(allTrades, field);
    console.log(
      `   ${label.padEnd(28)} n=${String(s.n).padStart(5)}  ` +
        `mean ${pctStr(s.mean).padStart(8)}  med ${pctStr(s.median).padStart(8)}  ` +
        `win ${s.win.toFixed(1).padStart(4)}%  t=${s.t.toFixed(2).padStart(6)}  ` +
        `${Math.abs(s.t) < 2 ? '⚖️ inconclusive' : s.mean > 0 ? '✅ +EV' : '❌ -EV'}`
    );
  }

  // ---- by year (same-day) ----
  console.log('\n📅 SAME-DAY (O->C) net mean by YEAR:');
  for (const b of byBucket(allTrades, 'retSameDay', t => t.year)) {
    console.log(
      `   ${b.key}  n=${String(b.n).padStart(4)}  mean ${pctStr(b.mean).padStart(8)}  ` +
        `win ${b.win.toFixed(0).padStart(3)}%  cumSum ${pctStr(b.sum).padStart(9)}`
    );
  }

  console.log('\n📅 NEXT-DAY (O->C+1) net mean by YEAR:');
  for (const b of byBucket(allTrades, 'retNextDay', t => t.year)) {
    console.log(
      `   ${b.key}  n=${String(b.n).padStart(4)}  mean ${pctStr(b.mean).padStart(8)}  ` +
        `win ${b.win.toFixed(0).padStart(3)}%  cumSum ${pctStr(b.sum).padStart(9)}`
    );
  }

  console.log('\n📅 TIGHT-STOP net mean by YEAR:');
  for (const b of byBucket(allTrades, 'retStop', t => t.year)) {
    console.log(
      `   ${b.key}  n=${String(b.n).padStart(4)}  mean ${pctStr(b.mean).padStart(8)}  ` +
        `win ${b.win.toFixed(0).padStart(3)}%  cumSum ${pctStr(b.sum).padStart(9)}`
    );
  }

  // ---- stress regimes ----
  console.log('\n🔥 STRESS REGIMES (same-day O->C):');
  for (const b of byBucket(
    allTrades.filter(t => t.regime !== 'other'),
    'retSameDay',
    t => t.regime
  )) {
    console.log(
      `   ${b.key.padEnd(18)} n=${String(b.n).padStart(4)}  mean ${pctStr(b.mean).padStart(8)}  ` +
        `win ${b.win.toFixed(0).padStart(3)}%  cumSum ${pctStr(b.sum).padStart(9)}`
    );
  }
  console.log('\n🔥 STRESS REGIMES (next-day O->C+1):');
  for (const b of byBucket(
    allTrades.filter(t => t.regime !== 'other'),
    'retNextDay',
    t => t.regime
  )) {
    console.log(
      `   ${b.key.padEnd(18)} n=${String(b.n).padStart(4)}  mean ${pctStr(b.mean).padStart(8)}  ` +
        `win ${b.win.toFixed(0).padStart(3)}%  cumSum ${pctStr(b.sum).padStart(9)}`
    );
  }

  // ---- portfolio equity curves vs benchmarks ----
  console.log('\n💰 PORTFOLIO EQUITY CURVE vs BUY-AND-HOLD:');
  console.log(
    `   ${'strategy'.padEnd(26)} ${'CAGR'.padStart(8)} ${'Sharpe'.padStart(7)} ` +
      `${'maxDD'.padStart(8)} ${'total'.padStart(9)}`
  );
  const variants = [
    ['gap same-day (O->C)', 'retSameDay'],
    ['gap next-day (O->C+1)', 'retNextDay'],
    [`gap tight-stop -${args.stop}%`, 'retStop'],
  ];
  const curveOut = {};
  for (const [label, field] of variants) {
    const series = portfolioSeries(allTrades, field, allDates);
    const cs = curveStats(series);
    curveOut[field] = { ...cs, nSignalDays: series.nSignalDays, nTrades: series.nTrades };
    console.log(
      `   ${label.padEnd(26)} ${pctStr(cs.cagr).padStart(8)} ${cs.sharpe.toFixed(2).padStart(7)} ` +
        `${pctStr(cs.maxDD).padStart(8)} ${pctStr(cs.total).padStart(9)}  ` +
        `(${series.nSignalDays} active days, ${series.nTrades} trades)`
    );
  }
  for (const [label, bh] of [['BUY-HOLD SPY', benchSPY], ['BUY-HOLD QQQ', benchQQQ]]) {
    if (!bh) continue;
    console.log(
      `   ${label.padEnd(26)} ${pctStr(bh.cagr).padStart(8)} ${bh.sharpe.toFixed(2).padStart(7)} ` +
        `${pctStr(bh.maxDD).padStart(8)} ${pctStr(bh.total).padStart(9)}`
    );
  }

  console.log('\n✅ done\n');
}

main().catch(e => {
  console.error('Backtest failed:', e);
  process.exit(1);
});
