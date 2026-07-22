#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/thematic-buyhold.js
//
// Backtest: equal-weight, monthly-rebalanced buy-and-hold basket of quality
// semiconductor / AI names + a few hyperscalers, 2018-01-01 -> today, on
// ADJUSTED daily bars from Polygon. THE key question this answers: does the
// thematic basket beat just holding QQQ on a RISK-ADJUSTED basis across
// regimes, or is it the same beta with more single-name risk and a worse 2022?
//
// STRATEGY (mechanical):
//   Universe (16): NVDA AMD AVGO TSM ASML MU AMAT LRCX KLAC MRVL ARM SMCI
//                  + MSFT GOOGL META AMZN
//   Entry/weighting: equal-weight across the names that HAVE traded data on the
//                    rebalance date (handles late IPOs like ARM 2023-09; a name
//                    enters the basket the first month it has price history).
//   Rebalance: monthly (first trading day of each month). Reset every held name
//              back to target weight -> trims winners, adds to laggards.
//   Exit: none (buy-and-hold core). Only rebalancing trades.
//   Sizing: full invested (no cash drag, no leverage).
//   Cost: bpsPerSide(sym) charged on the |delta| notional traded at each
//         rebalance (both the trim side and the add side pay their per-side bps).
//
// Benchmarks: SPY and QQQ buy-and-hold (single buy day 1, hold to end), net of
// one entry cost. We also compute an equal-weight basket WITHOUT rebalancing
// (pure buy-and-hold-and-forget) to isolate the contribution of rebalancing.
//
// All daily bars are adjusted=true (Polygon), so splits/dividends are baked in.

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const START = '2018-01-01';
const END = new Date().toISOString().slice(0, 10);

const BASKET = [
  'NVDA', 'AMD', 'AVGO', 'TSM', 'ASML', 'MU', 'AMAT', 'LRCX', 'KLAC',
  'MRVL', 'ARM', 'SMCI', 'MSFT', 'GOOGL', 'META', 'AMZN',
];
const BENCHMARKS = ['SPY', 'QQQ'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchDaily(sym) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const bars = await polygon.getHistoricalAggregates(sym, START, END, 'day');
      return (bars || []).filter(b => b && b.close > 0);
    } catch (err) {
      const wait = 1500 * (attempt + 1);
      console.error(`  ${sym} attempt ${attempt + 1} failed: ${err.message}; retry in ${wait}ms`);
      await sleep(wait);
    }
  }
  console.error(`  ${sym}: GAVE UP after retries`);
  return [];
}

// Build a map date -> close for a symbol, and the sorted list of trading dates.
function indexBars(bars) {
  const m = new Map();
  for (const b of bars) m.set(b.date, b.close);
  return m;
}

function annualizedStats(dailyRets, tradingDaysPerYear = 252) {
  const n = dailyRets.length;
  if (n === 0) return { cagr: 0, vol: 0, sharpe: 0 };
  const mean = dailyRets.reduce((a, b) => a + b, 0) / n;
  const variance = dailyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1 || 1);
  const sd = Math.sqrt(variance);
  const vol = sd * Math.sqrt(tradingDaysPerYear);
  // CAGR from compounded equity below; sharpe from daily mean/sd (rf=0).
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(tradingDaysPerYear) : 0;
  return { vol, sharpe, meanDaily: mean };
}

// Given an equity curve [{date, equity}], compute CAGR, maxDD, and per-year ret.
function equityStats(curve) {
  if (curve.length < 2) return null;
  const first = curve[0];
  const last = curve[curve.length - 1];
  const years =
    (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 864e5);
  const totalRet = last.equity / first.equity - 1;
  const cagr = years > 0 ? (last.equity / first.equity) ** (1 / years) - 1 : 0;

  let peak = -Infinity;
  let maxDD = 0;
  let maxDDdate = null;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = p.equity / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      maxDDdate = p.date;
    }
  }

  // daily returns
  const rets = [];
  for (let i = 1; i < curve.length; i++) {
    rets.push(curve[i].equity / curve[i - 1].equity - 1);
  }
  const { vol, sharpe } = annualizedStats(rets);

  // per-year total return + intra-year maxDD
  const byYear = {};
  for (let i = 1; i < curve.length; i++) {
    const y = curve[i].date.slice(0, 4);
    if (!byYear[y]) byYear[y] = { startEq: curve[i - 1].equity, endEq: curve[i].equity, peak: curve[i - 1].equity, maxDD: 0 };
    byYear[y].endEq = curve[i].equity;
    if (curve[i].equity > byYear[y].peak) byYear[y].peak = curve[i].equity;
    const dd = curve[i].equity / byYear[y].peak - 1;
    if (dd < byYear[y].maxDD) byYear[y].maxDD = dd;
  }
  const yearly = {};
  for (const [y, v] of Object.entries(byYear)) {
    yearly[y] = { ret: v.endEq / v.startEq - 1, maxDD: v.maxDD };
  }

  return { totalRet, cagr, maxDD, maxDDdate, vol, sharpe, yearly };
}

// Build the rebalance schedule: first trading day of each month present in the
// union of all trading dates.
function monthlyRebalanceDates(allDates) {
  const seenMonth = new Set();
  const out = [];
  for (const d of allDates) {
    const ym = d.slice(0, 7);
    if (!seenMonth.has(ym)) {
      seenMonth.add(ym);
      out.push(d);
    }
  }
  return out;
}

// Core: simulate a monthly-rebalanced equal-weight basket.
// closeMaps: { sym -> Map(date->close) }
// allDates: sorted union of all trading dates in window.
// Returns equity curve [{date, equity}] net of rebalance costs.
function simulateBasket(closeMaps, allDates, rebalance = true) {
  const rebalDates = new Set(monthlyRebalanceDates(allDates));
  // holdings: sym -> shares
  let holdings = {};
  let cash = 0;
  const START_CAP = 1_000_000;
  let invested = false;
  const curve = [];

  // helper: which syms have a price on date d
  const availOn = d =>
    BASKET.filter(s => closeMaps[s] && closeMaps[s].has(d));

  // value the portfolio at date d (using last-known close if a name is missing
  // a given day — but we only step on allDates so most names have it; fall back
  // to carrying shares * lastClose).
  const lastClose = {};
  const priceOn = (s, d) => {
    if (closeMaps[s] && closeMaps[s].has(d)) {
      lastClose[s] = closeMaps[s].get(d);
      return closeMaps[s].get(d);
    }
    return lastClose[s]; // may be undefined if never seen
  };

  for (const d of allDates) {
    // mark to market
    if (invested) {
      let v = cash;
      for (const [s, sh] of Object.entries(holdings)) {
        const p = priceOn(s, d);
        if (p != null && sh) v += sh * p;
      }
      curve.push({ date: d, equity: v });
    }

    const isRebal = rebalDates.has(d);
    if (!invested) {
      // initial investment on first date: equal weight across available names.
      // Deposit START_CAP, buy target notional in each name, pay entry cost out
      // of cash. Net starting cash = -(sum of entry costs).
      const names = availOn(d);
      if (names.length === 0) continue;
      const target = START_CAP / names.length;
      holdings = {};
      cash = START_CAP;
      for (const s of names) {
        const p = priceOn(s, d);
        const cost = target * (bpsPerSide(s) / 10000);
        holdings[s] = target / p;
        cash -= target; // spent on shares
        cash -= cost; // entry cost
      }
      invested = true;
      // equity now = shares*price (== START_CAP) + cash (== -costs)
      let eq = cash;
      for (const [s, sh] of Object.entries(holdings)) eq += sh * priceOn(s, d);
      curve.push({ date: d, equity: eq });
      continue;
    }

    if (rebalance && isRebal) {
      // current total value
      let totalVal = cash;
      for (const [s, sh] of Object.entries(holdings)) {
        const p = priceOn(s, d);
        if (p != null && sh) totalVal += sh * p;
      }
      const names = availOn(d);
      if (names.length === 0) continue;
      const target = totalVal / names.length;
      let totalCost = 0;
      const newHoldings = {};
      for (const s of names) {
        const p = priceOn(s, d);
        const curShares = holdings[s] || 0;
        const curNotional = curShares * p;
        const delta = target - curNotional; // + = buy more, - = trim
        totalCost += Math.abs(delta) * (bpsPerSide(s) / 10000);
        newHoldings[s] = target / p;
      }
      // names dropping out (shouldn't happen — names only enter) liquidate:
      for (const s of Object.keys(holdings)) {
        if (!names.includes(s) && holdings[s]) {
          const p = priceOn(s, d);
          if (p != null) {
            totalCost += holdings[s] * p * (bpsPerSide(s) / 10000);
          }
        }
      }
      holdings = newHoldings;
      cash -= totalCost;
    }
  }

  return curve;
}

// Buy-and-hold single symbol benchmark, net of one entry cost.
function simulateSingle(closeMap, allDates, sym) {
  const dates = allDates.filter(d => closeMap.has(d));
  if (dates.length < 2) return [];
  const START_CAP = 1_000_000;
  const entryCost = START_CAP * (bpsPerSide(sym) / 10000);
  const p0 = closeMap.get(dates[0]);
  const shares = (START_CAP - entryCost) / p0;
  return dates.map(d => ({ date: d, equity: shares * closeMap.get(d) }));
}

function fmtPct(x) {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
}

async function main() {
  if (!process.env.POLYGON_API_KEY) {
    console.error('Need POLYGON_API_KEY');
    process.exit(1);
  }
  console.log(`\nThematic buy-and-hold basket — ${START} -> ${END}`);
  console.log(`Universe (${BASKET.length}): ${BASKET.join(' ')}`);
  console.log(`Benchmarks: ${BENCHMARKS.join(', ')}\n`);

  const closeMaps = {};
  const coverage = {};
  const allDatesSet = new Set();

  for (const sym of [...BASKET, ...BENCHMARKS]) {
    const bars = await fetchDaily(sym);
    if (bars.length === 0) {
      console.log(`  ${sym.padEnd(6)} NO DATA`);
      await sleep(200);
      continue;
    }
    const m = indexBars(bars);
    closeMaps[sym] = m;
    coverage[sym] = { first: bars[0].date, last: bars[bars.length - 1].date, n: bars.length };
    if (BASKET.includes(sym)) {
      // benchmark dates shouldn't define the union (they're SPY/QQQ); use the
      // semis/AI names + benchmarks both. Actually use ALL for the union so the
      // curve is dense.
    }
    for (const b of bars) allDatesSet.add(b.date);
    console.log(`  ${sym.padEnd(6)} ${bars.length} bars  ${bars[0].date} -> ${bars[bars.length - 1].date}`);
    await sleep(200);
  }

  const allDates = [...allDatesSet].sort();
  console.log(`\n  Union trading days: ${allDates.length}  (${allDates[0]} -> ${allDates[allDates.length - 1]})`);

  // ---- run sims ----
  const basketRebal = simulateBasket(closeMaps, allDates, true);
  const basketNoRebal = simulateBasket(closeMaps, allDates, false);
  const spy = closeMaps.SPY ? simulateSingle(closeMaps.SPY, allDates, 'SPY') : [];
  const qqq = closeMaps.QQQ ? simulateSingle(closeMaps.QQQ, allDates, 'QQQ') : [];

  const stats = {
    'BASKET (monthly rebal)': equityStats(basketRebal),
    'BASKET (no rebal)': equityStats(basketNoRebal),
    'SPY buy&hold': equityStats(spy),
    'QQQ buy&hold': equityStats(qqq),
  };

  console.log('\n================ HEADLINE ================\n');
  console.log(
    'Strategy'.padEnd(24) +
      'CAGR'.padStart(8) +
      'Vol'.padStart(8) +
      'Sharpe'.padStart(8) +
      'MaxDD'.padStart(9) +
      'TotalRet'.padStart(11)
  );
  for (const [name, s] of Object.entries(stats)) {
    if (!s) {
      console.log(name.padEnd(24) + '  (no data)');
      continue;
    }
    console.log(
      name.padEnd(24) +
        fmtPct(s.cagr).padStart(8) +
        fmtPct(s.vol).padStart(8) +
        s.sharpe.toFixed(2).padStart(8) +
        fmtPct(s.maxDD).padStart(9) +
        fmtPct(s.totalRet).padStart(11)
    );
  }

  // ---- per-year table (return + maxDD) ----
  const years = [];
  for (let y = 2018; y <= Number(END.slice(0, 4)); y++) years.push(String(y));

  console.log('\n================ PER-YEAR TOTAL RETURN ================\n');
  console.log(
    'Year'.padEnd(6) +
      'BASKET'.padStart(10) +
      'SPY'.padStart(10) +
      'QQQ'.padStart(10) +
      '  | regime'
  );
  const regimeNote = {
    2018: 'Q4 selloff',
    2019: 'bull',
    2020: 'COVID crash+recovery',
    2021: 'bull/mania',
    2022: 'BEAR (rates)',
    2023: 'bull',
    2024: 'bull',
    2025: 'bull?',
    2026: 'YTD',
  };
  for (const y of years) {
    const b = stats['BASKET (monthly rebal)']?.yearly[y];
    const sp = stats['SPY buy&hold']?.yearly[y];
    const qq = stats['QQQ buy&hold']?.yearly[y];
    if (!b && !sp && !qq) continue;
    console.log(
      y.padEnd(6) +
        (b ? fmtPct(b.ret) : '--').padStart(10) +
        (sp ? fmtPct(sp.ret) : '--').padStart(10) +
        (qq ? fmtPct(qq.ret) : '--').padStart(10) +
        `  | ${regimeNote[y] || ''}`
    );
  }

  console.log('\n================ PER-YEAR INTRA-YEAR MAX DRAWDOWN ================\n');
  console.log('Year'.padEnd(6) + 'BASKET'.padStart(10) + 'SPY'.padStart(10) + 'QQQ'.padStart(10));
  for (const y of years) {
    const b = stats['BASKET (monthly rebal)']?.yearly[y];
    const sp = stats['SPY buy&hold']?.yearly[y];
    const qq = stats['QQQ buy&hold']?.yearly[y];
    if (!b && !sp && !qq) continue;
    console.log(
      y.padEnd(6) +
        (b ? fmtPct(b.maxDD) : '--').padStart(10) +
        (sp ? fmtPct(sp.maxDD) : '--').padStart(10) +
        (qq ? fmtPct(qq.maxDD) : '--').padStart(10)
    );
  }

  // ---- specific regime windows: 2020 crash + 2022 bear, peak-to-trough ----
  function windowDD(curve, startD, endD) {
    const seg = curve.filter(p => p.date >= startD && p.date <= endD);
    if (seg.length < 2) return null;
    let peak = -Infinity, maxDD = 0;
    for (const p of seg) {
      if (p.equity > peak) peak = p.equity;
      const dd = p.equity / peak - 1;
      if (dd < maxDD) maxDD = dd;
    }
    const ret = seg[seg.length - 1].equity / seg[0].equity - 1;
    return { ret, maxDD };
  }

  console.log('\n================ KEY REGIME WINDOWS ================\n');
  const windows = [
    ['2020 COVID crash', '2020-02-19', '2020-03-23'],
    ['2020 full year recovery', '2020-01-01', '2020-12-31'],
    ['2022 BEAR (full year)', '2022-01-01', '2022-12-31'],
    ['2022 peak->trough', '2022-01-03', '2022-10-13'],
    ['2018 Q4 selloff', '2018-10-01', '2018-12-24'],
  ];
  console.log('Window'.padEnd(26) + 'BASKET ret/DD'.padStart(18) + 'SPY ret/DD'.padStart(18) + 'QQQ ret/DD'.padStart(18));
  for (const [label, s, e] of windows) {
    const b = windowDD(basketRebal, s, e);
    const sp = windowDD(spy, s, e);
    const qq = windowDD(qqq, s, e);
    const fmt = w => (w ? `${fmtPct(w.ret)} / ${fmtPct(w.maxDD)}` : '--');
    console.log(label.padEnd(26) + fmt(b).padStart(18) + fmt(sp).padStart(18) + fmt(qq).padStart(18));
  }

  // ---- alpha vs QQQ: regression-free quick check (return/maxDD & Sharpe) ----
  console.log('\n================ ALPHA-OR-BETA QUICK READ ================\n');
  const bStats = stats['BASKET (monthly rebal)'];
  const qStats = stats['QQQ buy&hold'];
  if (bStats && qStats) {
    const bRetDD = bStats.cagr / Math.abs(bStats.maxDD);
    const qRetDD = qStats.cagr / Math.abs(qStats.maxDD);
    console.log(`  BASKET  Sharpe ${bStats.sharpe.toFixed(2)}  CAGR/|maxDD| ${bRetDD.toFixed(2)}  vol ${fmtPct(bStats.vol)}`);
    console.log(`  QQQ     Sharpe ${qStats.sharpe.toFixed(2)}  CAGR/|maxDD| ${qRetDD.toFixed(2)}  vol ${fmtPct(qStats.vol)}`);
    console.log(`  Sharpe delta (BASKET - QQQ): ${(bStats.sharpe - qStats.sharpe).toFixed(3)}`);
    console.log(`  CAGR/maxDD delta: ${(bRetDD - qRetDD).toFixed(3)}`);
  }

  console.log('\nDONE. Coverage notes (late IPOs reduce early diversification):');
  for (const s of BASKET) {
    if (coverage[s] && coverage[s].first > START) {
      console.log(`  ${s.padEnd(6)} first bar ${coverage[s].first} (entered basket then)`);
    }
  }
  console.log('');

  // emit a compact JSON blob for the report
  const out = {
    window: [allDates[0], allDates[allDates.length - 1]],
    stats: Object.fromEntries(
      Object.entries(stats).map(([k, v]) => [
        k,
        v && { cagr: v.cagr, vol: v.vol, sharpe: v.sharpe, maxDD: v.maxDD, totalRet: v.totalRet },
      ])
    ),
  };
  console.log('JSON_RESULT ' + JSON.stringify(out));
}

main().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
