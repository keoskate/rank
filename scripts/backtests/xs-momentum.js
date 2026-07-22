#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/xs-momentum.js
//
// CROSS-SECTIONAL MOMENTUM backtest, 2017-06-01 -> today (daily bars).
//
// STRATEGY (mechanical):
//   Universe: ~45 large-cap liquid US equities that traded continuously since
//     2017 (a fixed, point-in-time-frozen S&P-100-ish subset). See SURVIVORSHIP
//     caveat below.
//   Signal: at each monthly rebalance date t, rank each name by its trailing
//     12-1 momentum = total return from t-252 trading days to t-21 trading days
//     (12-month return, skipping the most recent ~1 month to dodge short-term
//     reversal). Classic Jegadeesh-Titman / academic momentum.
//   Entry: go long the top QUINTILE (top 20% of ranked names), equal-weight.
//   Exit/rebalance: fully rebalance monthly (sell anything no longer in the top
//     quintile, rebuy the new top quintile equal-weight).
//   Sizing: equal-weight, fully invested in the selected names (no leverage,
//     no cash buffer). When a name carries over month-to-month, no trade cost
//     is charged on the carried portion (we only cost the turnover).
//
// Cost: server/risk/transactionCost.js bpsPerSide() per side, charged on the
//   dollar turnover at each rebalance (names sold + names bought).
//
// Benchmarks: buy-and-hold SPY and QQQ over the identical window, same daily
//   bars, one entry cost. We report CAGR, annualized vol, Sharpe (rf=0), max
//   drawdown, and per-calendar-year returns so 2018-Q4 / 2020 / 2022 stand out.
//
// SURVIVORSHIP CAVEAT (stated honestly): the universe is chosen from names that
//   survived to 2026, so it is mildly survivorship-biased UP. We mitigate by (a)
//   using only mega/large caps that were already huge in 2017 (low delisting
//   risk) and (b) comparing momentum-selection vs an EQUAL-WEIGHT-ALL portfolio
//   of the SAME universe. That EW-all leg shares the identical survivorship
//   bias, so [momentum - EWall] isolates the *selection* edge free of survivor
//   inflation. This is the cleanest alpha read available without a paid
//   point-in-time constituents feed.

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const START = '2017-06-01'; // need ~12mo lookback before first 2018 rebalance
const today = new Date();
const END = today.toISOString().split('T')[0];

// Fixed universe: large/mega-cap names trading continuously since 2017.
// 45 tickers (HARD CONSTRAINT <=45). Deliberately diversified across sectors.
const UNIVERSE = [
  // Mega tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AMD', 'INTC', 'QCOM', 'TXN',
  'ORCL', 'CSCO', 'IBM', 'ADBE', 'CRM',
  // Consumer / retail
  'WMT', 'HD', 'NKE', 'MCD', 'SBUX', 'COST', 'TGT', 'LOW',
  // Financials
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'AXP',
  // Healthcare
  'JNJ', 'PFE', 'MRK', 'UNH', 'ABBV', 'LLY',
  // Industrials / energy / staples
  'BA', 'CAT', 'GE', 'XOM', 'CVX', 'PG', 'KO', 'PEP', 'DIS',
];

const BENCH = ['SPY', 'QQQ'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSeries(sym) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bars = await polygon.getHistoricalAggregates(sym, START, END, 'day');
      await sleep(200);
      return bars || [];
    } catch (e) {
      if (String(e.message).includes('Rate limit')) {
        console.warn(`  429 on ${sym}, backing off…`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      console.warn(`  fetch failed ${sym}: ${e.message}`);
      await sleep(200);
      return [];
    }
  }
  return [];
}

// ---- stats helpers ----
function cagr(equity, years) {
  if (equity <= 0 || years <= 0) return -1;
  return Math.pow(equity, 1 / years) - 1;
}
function maxDrawdown(curve) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}
function annualizedVol(dailyRets) {
  if (dailyRets.length < 2) return 0;
  const m = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
  const v = dailyRets.reduce((a, b) => a + (b - m) ** 2, 0) / (dailyRets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}
function sharpe(dailyRets) {
  if (dailyRets.length < 2) return 0;
  const m = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
  const v = dailyRets.reduce((a, b) => a + (b - m) ** 2, 0) / (dailyRets.length - 1);
  const sd = Math.sqrt(v);
  return sd === 0 ? 0 : (m / sd) * Math.sqrt(252);
}
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

async function main() {
  console.log(`Fetching ${UNIVERSE.length} universe + ${BENCH.length} bench (${START} -> ${END})`);
  const data = {};
  const all = [...UNIVERSE, ...BENCH];
  for (let i = 0; i < all.length; i++) {
    const sym = all[i];
    const bars = await fetchSeries(sym);
    if (bars.length) {
      const m = new Map();
      for (const b of bars) m.set(b.date, b.close);
      data[sym] = { dates: bars.map(b => b.date), close: m };
    }
    if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${all.length}`);
  }

  // Master trading-day calendar = union of SPY dates (most complete liquid name)
  const calendar = data.SPY ? data.SPY.dates.slice() : [];
  if (!calendar.length) throw new Error('no SPY calendar');

  // closeOn(sym, date): last known close on/before date
  const closeOn = (sym, date) => {
    const d = data[sym];
    if (!d) return null;
    return d.close.get(date) ?? null;
  };

  // Build month-end rebalance dates from calendar (first trading day of each month
  // is the rebalance; we trade at that day's close).
  const rebalIdx = [];
  for (let i = 1; i < calendar.length; i++) {
    const prevMonth = calendar[i - 1].slice(0, 7);
    const curMonth = calendar[i].slice(0, 7);
    if (curMonth !== prevMonth) rebalIdx.push(i); // first trading day of new month
  }

  // momentum LOOKBACK-1: ret from idx-LB to idx-21, using calendar indices.
  // LB=252 -> classic 12-1. LB=126 -> 6-1 (lets us start earlier given the
  // Polygon 2021-06 data floor, so we capture the full 2022 bear).
  const LB = parseInt(process.env.MOM_LOOKBACK || '252', 10);
  function momScore(sym, idx) {
    if (idx - LB < 0) return null;
    const dEnd = calendar[idx - 21];
    const dStart = calendar[idx - LB];
    const pEnd = closeOn(sym, dEnd);
    const pStart = closeOn(sym, dStart);
    if (!pEnd || !pStart || pStart <= 0) return null;
    return pEnd / pStart - 1;
  }

  // ---- simulate momentum portfolio + EW-all portfolio ----
  // We track equity day-by-day on the calendar so we get clean daily returns
  // for Sharpe. Holdings change only on rebalance days.
  const TOPN = Math.max(1, Math.round(UNIVERSE.length * 0.2)); // top quintile

  function simulate(selector) {
    // selector(idx) -> array of symbols to hold (equal weight) for the month
    let equity = 1;
    let holdings = null; // {sym: shares-equivalent weight value}
    let prevHoldSet = new Set();
    const curve = [];
    const dailyRets = [];
    const yearRet = {}; // year -> product of (1+daily)
    let turnoverEvents = 0;

    // find first rebalance idx with valid momentum (idx>=252)
    let started = false;

    for (let i = 0; i < calendar.length; i++) {
      const date = calendar[i];

      // daily mark-to-market BEFORE any rebalance (uses yesterday holdings)
      if (started && holdings) {
        let port = 0;
        let valid = 0;
        for (const sym of Object.keys(holdings)) {
          const p = closeOn(sym, date);
          const pPrev = holdings[sym].lastPrice;
          if (p && pPrev) {
            port += holdings[sym].weight * (p / pPrev);
            holdings[sym].lastPrice = p; // roll mark
            valid += holdings[sym].weight;
          } else {
            port += holdings[sym].weight; // stale -> no move
            valid += holdings[sym].weight;
          }
        }
        const dayRet = valid > 0 ? port / valid - 1 : 0;
        equity *= 1 + dayRet;
        dailyRets.push(dayRet);
        const yr = date.slice(0, 4);
        yearRet[yr] = (yearRet[yr] || 1) * (1 + dayRet);
        curve.push(equity);
      }

      // rebalance at this day's close
      if (rebalIdx.includes(i)) {
        const picks = selector(i);
        if (picks && picks.length) {
          const newSet = new Set(picks);
          // turnover cost: symbols leaving + entering, each priced at equal weight
          if (started) {
            let turnoverWeight = 0;
            for (const s of prevHoldSet) if (!newSet.has(s)) turnoverWeight += 1 / Math.max(prevHoldSet.size, 1);
            for (const s of newSet) if (!prevHoldSet.has(s)) turnoverWeight += 1 / picks.length;
            // cost = turnoverWeight (fraction of portfolio traded) * avg per-side bps
            const avgBps = picks.reduce((a, s) => a + bpsPerSide(s), 0) / picks.length;
            const costFrac = turnoverWeight * (avgBps / 10000);
            equity *= 1 - costFrac;
            if (turnoverWeight > 0) turnoverEvents++;
          }
          // set new equal-weight holdings, seed lastPrice at today's close
          holdings = {};
          for (const s of picks) {
            const p = closeOn(s, date);
            if (p) holdings[s] = { weight: 1 / picks.length, lastPrice: p };
          }
          prevHoldSet = newSet;
          started = true;
          if (!curve.length) curve.push(equity);
        }
      }
    }
    return { equity, curve, dailyRets, yearRet, turnoverEvents };
  }

  const momSelector = idx => {
    const scored = UNIVERSE
      .map(s => ({ s, m: momScore(s, idx) }))
      .filter(x => x.m != null)
      .sort((a, b) => b.m - a.m);
    if (scored.length < TOPN) return null;
    return scored.slice(0, TOPN).map(x => x.s);
  };

  const ewAllSelector = idx => {
    // hold entire universe that has valid price -> isolates survivorship from selection
    const avail = UNIVERSE.filter(s => closeOn(s, calendar[idx]) != null && momScore(s, idx) != null);
    return avail.length ? avail : null;
  };

  const mom = simulate(momSelector);
  const ewAll = simulate(ewAllSelector);

  // ---- benchmarks: buy & hold from first rebalance date ----
  function buyHold(sym) {
    // start at the same date momentum strategy starts (first valid rebal)
    const startIdx = rebalIdx.find(i => i >= LB);
    const startDate = calendar[startIdx];
    let equity = 1;
    let last = closeOn(sym, startDate);
    // one entry cost
    equity *= 1 - bpsPerSide(sym) / 10000;
    const curve = [equity];
    const dailyRets = [];
    const yearRet = {};
    for (let i = startIdx + 1; i < calendar.length; i++) {
      const p = closeOn(sym, calendar[i]);
      if (p && last) {
        const r = p / last - 1;
        equity *= 1 + r;
        dailyRets.push(r);
        const yr = calendar[i].slice(0, 4);
        yearRet[yr] = (yearRet[yr] || 1) * (1 + r);
        last = p;
      }
      curve.push(equity);
    }
    return { equity, curve, dailyRets, yearRet };
  }

  const spy = buyHold('SPY');
  const qqq = buyHold('QQQ');

  const startIdx = rebalIdx.find(i => i >= LB);
  const years = (new Date(calendar[calendar.length - 1]) - new Date(calendar[startIdx])) / (365.25 * 864e5);

  function summarize(name, r) {
    return {
      name,
      totalRet: r.equity - 1,
      cagr: cagr(r.equity, years),
      vol: annualizedVol(r.dailyRets),
      sharpe: sharpe(r.dailyRets),
      maxDD: maxDrawdown(r.curve),
      yearRet: r.yearRet,
      turnover: r.turnoverEvents,
    };
  }

  const results = [
    summarize('XS-MOMENTUM (top quintile)', mom),
    summarize('EW-ALL universe (same names)', ewAll),
    summarize('SPY buy&hold', spy),
    summarize('QQQ buy&hold', qqq),
  ];

  console.log('\n==================== RESULTS ====================');
  console.log(`Window: ${calendar[startIdx]} -> ${calendar[calendar.length - 1]}  (${years.toFixed(2)} yrs)`);
  console.log(`Universe size ${UNIVERSE.length}, top quintile = ${TOPN} names, monthly rebalance\n`);
  console.log('Strategy                          CAGR     Vol    Sharpe   MaxDD    TotalRet');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(33)} ${pct(r.cagr).padStart(7)} ${pct(r.vol).padStart(7)} ${r.sharpe.toFixed(2).padStart(7)} ${pct(r.maxDD).padStart(8)} ${pct(r.totalRet).padStart(9)}`
    );
  }

  // per-year table
  const years_ = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
  console.log('\n---- Calendar-year returns ----');
  console.log('Strategy                          ' + years_.map(y => y.padStart(8)).join(''));
  for (const r of results) {
    const row = years_.map(y => pct((r.yearRet[y] || 1) - 1).padStart(8)).join('');
    console.log(`${r.name.padEnd(33)} ${row}`);
  }

  console.log('\n==================== JSON ====================');
  console.log(JSON.stringify({ window: [calendar[startIdx], calendar[calendar.length - 1]], years, topN: TOPN, results }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
