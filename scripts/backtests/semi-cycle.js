#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/semi-cycle.js
//
// SEMICONDUCTOR CYCLE HUNTER (key: semi-cycle)
// =============================================
// Thesis under test: semiconductor sub-sectors lead/lag each other through the
// chip cycle (memory bottoms first, equipment leads capex, logic/design rides
// demand). If that's real, ranking sub-groups by relative strength and rotating
// into the strongest should beat just equal-weighting the whole semi basket.
//
// We test that mechanically: build 4 equal-weight sub-group "sleeves", rank them
// by trailing total return (momentum), hold the top-K, rebalance monthly, and
// TRIM rather than full-exit (a floor weight stays in every sleeve). Compare to:
//   - EW-BASKET: equal-weight all 4 sleeves, rebalanced monthly (the "just hold
//     the whole basket" null hypothesis the prompt demands)
//   - SPY buy & hold (beta benchmark)
//   - QQQ buy & hold (tech-beta benchmark — the real bar to clear)
//
// DATA CAVEAT (verified at runtime): the Polygon plan on this key only serves
// ~2 trailing years + change of daily history. Earliest authorized bar is
// ~2021-06. So 2018 Q4, the 2020 COVID crash, and the early-2021 bull are
// NOT testable here. We DO get the full 2022 bear, 2023 recovery, 2024-2026
// AI bull — i.e. the single most important regime (the 2022 drawdown) is
// covered. The report states this limitation plainly.
//
// Costs: charged round-trip on every dollar of turnover at each rebalance using
// transactionCost.bpsPerSide(sym) (5 bps/side for ordinary equities).

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

// ---- sub-group definitions (the "cycle" sleeves) -------------------------
const SLEEVES = {
  memory: ['MU', 'WDC', 'STX'],
  logic_foundry: ['TSM', 'INTC'],
  equipment: ['AMAT', 'LRCX', 'KLAC'],
  design: ['NVDA', 'AMD', 'AVGO'], // ARM only IPO'd 2023-09; excluded for full-window comparability
};
const SLEEVE_NAMES = Object.keys(SLEEVES);
const ALL_SEMIS = [...new Set(Object.values(SLEEVES).flat())];
const BENCH = ['SPY', 'QQQ'];

const START = '2021-06-01';
const END = '2026-06-03';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

// ---- fetch ---------------------------------------------------------------
async function fetchAll() {
  const data = {};
  const syms = [...ALL_SEMIS, ...BENCH];
  for (const sym of syms) {
    let tries = 0;
    while (tries < 3) {
      try {
        const bars = await polygon.getHistoricalAggregates(sym, START, END, 'day');
        const m = new Map();
        for (const b of bars) m.set(b.date, b.close);
        data[sym] = m;
        break;
      } catch (err) {
        tries++;
        if (err.message.includes('Rate limit') || err.response?.status === 429) {
          console.error(`  429 on ${sym}, backing off...`);
          await sleep(2000);
        } else {
          console.error(`  ${sym} failed: ${err.message}`);
          data[sym] = new Map();
          break;
        }
      }
    }
    await sleep(200);
  }
  return data;
}

// Build a sorted union calendar of dates where ALL semis + benches have a close.
function buildCalendar(data) {
  const syms = Object.keys(data).filter(s => data[s].size > 0);
  // intersection of dates
  let dates = null;
  for (const s of syms) {
    const ds = new Set(data[s].keys());
    if (dates === null) dates = ds;
    else dates = new Set([...dates].filter(d => ds.has(d)));
  }
  return [...dates].sort();
}

// ---- portfolio engine ----------------------------------------------------
// Each sleeve = equal-weight buy&hold of its members between rebalances. We
// track each sleeve's daily return series, then build portfolio NAVs from
// target weights that change at monthly rebalance points.

// Compute a sleeve's normalized price index across the calendar (EW of members,
// reconstituted daily — i.e. EW return each day). Returns array aligned to cal.
function sleeveReturns(members, data, cal) {
  // daily simple return of the equal-weight sleeve
  const rets = new Array(cal.length).fill(0);
  for (let i = 1; i < cal.length; i++) {
    const dPrev = cal[i - 1], dCur = cal[i];
    let sum = 0, n = 0;
    for (const m of members) {
      const p0 = data[m].get(dPrev), p1 = data[m].get(dCur);
      if (p0 > 0 && p1 > 0) { sum += p1 / p0 - 1; n++; }
    }
    rets[i] = n ? sum / n : 0;
  }
  return rets;
}

function benchReturns(sym, data, cal) {
  const rets = new Array(cal.length).fill(0);
  for (let i = 1; i < cal.length; i++) {
    const p0 = data[sym].get(cal[i - 1]), p1 = data[sym].get(cal[i]);
    rets[i] = p0 > 0 && p1 > 0 ? p1 / p0 - 1 : 0;
  }
  return rets;
}

// Cumulative total return of a sleeve over a lookback window ending at index i.
function lookbackReturn(sleeveRet, i, lb) {
  const start = Math.max(1, i - lb + 1);
  let cum = 1;
  for (let k = start; k <= i; k++) cum *= 1 + sleeveRet[k];
  return cum - 1;
}

// Average cost (bps/side) of a sleeve = mean across members. Used to charge
// turnover on rebalance.
function sleeveCostBps(members) {
  return mean(members.map(m => bpsPerSide(m)));
}

// Run a weighted strategy. `weightFn(i)` returns a weight vector over sleeves
// for the period STARTING at rebalance index i (held until next rebalance).
// Charges round-trip turnover cost at each rebalance.
function runStrategy({ cal, sleeveRet, rebalIdx, weightFn, costBps }) {
  let nav = 1;
  const navSeries = new Array(cal.length).fill(1);
  let curW = SLEEVE_NAMES.map(() => 0);
  let rebalPtr = 0;
  // drift weights between rebalances so cost is charged on real turnover
  let driftW = curW.slice();

  for (let i = 1; i < cal.length; i++) {
    // rebalance at start of day i if i is a rebalance index
    if (rebalPtr < rebalIdx.length && rebalIdx[rebalPtr] === i) {
      const targetW = weightFn(i);
      // turnover = sum |target - drifted current|, cost = turnover * bps both sides
      let turnover = 0;
      for (let s = 0; s < SLEEVE_NAMES.length; s++) {
        turnover += Math.abs(targetW[s] - driftW[s]);
      }
      // round-trip cost: turnover fraction of NAV traded, charged at per-side bps
      // (turnover already counts one direction of the swap; charge entry+exit)
      const costFrac = turnover * (costBps / 10000); // bps/side * turnover (sell side ~= buy side)
      nav *= 1 - costFrac;
      curW = targetW.slice();
      driftW = targetW.slice();
      rebalPtr++;
    }
    // apply daily returns; drift weights
    let port = 0;
    const newDrift = new Array(SLEEVE_NAMES.length).fill(0);
    let dsum = 0;
    for (let s = 0; s < SLEEVE_NAMES.length; s++) {
      const r = sleeveRet[s][i];
      port += driftW[s] * r;
      const grown = driftW[s] * (1 + r);
      newDrift[s] = grown;
      dsum += grown;
    }
    if (dsum > 0) for (let s = 0; s < SLEEVE_NAMES.length; s++) newDrift[s] /= dsum;
    driftW = newDrift;
    nav *= 1 + port;
    navSeries[i] = nav;
  }
  return navSeries;
}

// Daily-return series from a NAV series.
function navToRets(nav) {
  const r = new Array(nav.length).fill(0);
  for (let i = 1; i < nav.length; i++) r[i] = nav[i] / nav[i - 1] - 1;
  return r;
}

// ---- metrics -------------------------------------------------------------
function cagr(nav, years) {
  return Math.pow(nav[nav.length - 1] / nav[0], 1 / years) - 1;
}
function sharpe(rets) {
  const r = rets.slice(1); // drop day 0
  const s = std(r);
  return s ? (mean(r) / s) * Math.sqrt(252) : 0;
}
function maxDD(nav) {
  let peak = nav[0], mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}
function segmentReturn(nav, cal, startDate, endDate) {
  let si = cal.findIndex(d => d >= startDate);
  let ei = -1;
  for (let i = cal.length - 1; i >= 0; i--) { if (cal[i] <= endDate) { ei = i; break; } }
  if (si < 0 || ei < 0 || ei <= si) return null;
  return { ret: nav[ei] / nav[si] - 1, mdd: maxDD(nav.slice(si, ei + 1)), si, ei };
}

const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

async function main() {
  if (!process.env.POLYGON_API_KEY) { console.error('Need POLYGON_API_KEY'); process.exit(1); }
  console.log('\nSEMI-CYCLE backtest — fetching daily bars', START, '->', END, '\n');
  const data = await fetchAll();

  const cal = buildCalendar(data);
  console.log(`\nCalendar: ${cal.length} common trading days, ${cal[0]} -> ${cal[cal.length - 1]}`);
  const years = (Date.parse(cal[cal.length - 1]) - Date.parse(cal[0])) / (365.25 * 864e5);
  console.log(`Span: ${years.toFixed(2)} years\n`);

  // sleeve daily returns
  const sleeveRet = SLEEVE_NAMES.map(name => sleeveReturns(SLEEVES[name], data, cal));
  const costBps = mean(SLEEVE_NAMES.map(name => sleeveCostBps(SLEEVES[name])));

  // monthly rebalance indices: first trading day of each new month
  const rebalIdx = [];
  for (let i = 1; i < cal.length; i++) {
    if (cal[i].slice(0, 7) !== cal[i - 1].slice(0, 7)) rebalIdx.push(i);
  }
  console.log(`Rebalances: ${rebalIdx.length} (monthly), avg sleeve cost ${costBps.toFixed(1)} bps/side\n`);

  const LOOKBACK = 63; // ~3 months trailing momentum for ranking

  // ---- weight functions --------------------------------------------------
  // EW-BASKET: 25% each sleeve always (the null hypothesis)
  const wEW = () => SLEEVE_NAMES.map(() => 0.25);

  // ROTATE-TOP2-TRIM: rank sleeves by 3mo momentum, top-2 get overweight,
  // bottom-2 keep a floor (trim, not exit).
  const makeRotateTopK = (k, topW, floorW) => i => {
    const scored = SLEEVE_NAMES.map((_, s) => ({ s, mom: lookbackReturn(sleeveRet[s], i - 1, LOOKBACK) }));
    scored.sort((a, b) => b.mom - a.mom);
    const w = new Array(SLEEVE_NAMES.length).fill(floorW);
    for (let r = 0; r < k; r++) w[scored[r].s] = topW;
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map(x => x / sum); // normalize to 1
  };

  // ROTATE-TOP1-TRIM: concentrate harder — top sleeve 55%, rest split floor.
  const wTop2 = makeRotateTopK(2, 0.40, 0.10); // 0.4+0.4+0.1+0.1 = 1.0
  const wTop1 = makeRotateTopK(1, 0.55, 0.15); // 0.55+0.15*3 = 1.0

  const navEW = runStrategy({ cal, sleeveRet, rebalIdx, weightFn: wEW, costBps });
  const navTop2 = runStrategy({ cal, sleeveRet, rebalIdx, weightFn: wTop2, costBps });
  const navTop1 = runStrategy({ cal, sleeveRet, rebalIdx, weightFn: wTop1, costBps });

  // benchmarks (buy & hold, no rebalance cost)
  const spyRet = benchReturns('SPY', data, cal);
  const qqqRet = benchReturns('QQQ', data, cal);
  const navSPY = [1]; for (let i = 1; i < cal.length; i++) navSPY[i] = navSPY[i - 1] * (1 + spyRet[i]);
  const navQQQ = [1]; for (let i = 1; i < cal.length; i++) navQQQ[i] = navQQQ[i - 1] * (1 + qqqRet[i]);

  const strategies = {
    'EW-BASKET (null)': navEW,
    'ROTATE-TOP2-TRIM': navTop2,
    'ROTATE-TOP1-TRIM': navTop1,
    'SPY (buy&hold)': navSPY,
    'QQQ (buy&hold)': navQQQ,
  };

  // ---- overall table -----------------------------------------------------
  console.log('================ OVERALL (full window) ================\n');
  console.log('Strategy            CAGR      Sharpe   MaxDD     TotalRet');
  for (const [name, nav] of Object.entries(strategies)) {
    const rets = navToRets(nav);
    console.log(
      `${name.padEnd(20)}${pct(cagr(nav, years)).padStart(7)}  ${sharpe(rets).toFixed(2).padStart(6)}  ${pct(maxDD(nav)).padStart(7)}  ${pct(nav[nav.length - 1] - 1).padStart(8)}`
    );
  }

  // ---- regime segments ---------------------------------------------------
  const REGIMES = [
    ['2021 tail (start->2021-12-31)', cal[0], '2021-12-31'],
    ['2022 BEAR (full year)', '2022-01-01', '2022-12-31'],
    ['2023 recovery', '2023-01-01', '2023-12-31'],
    ['2024 AI bull', '2024-01-01', '2024-12-31'],
    ['2025 bull', '2025-01-01', '2025-12-31'],
    ['2026 YTD', '2026-01-01', cal[cal.length - 1]],
  ];
  console.log('\n================ BY REGIME (period return / maxDD) ================\n');
  const hdr = 'Regime'.padEnd(34);
  console.log(hdr + Object.keys(strategies).map(n => n.split(' ')[0].slice(0, 9).padStart(11)).join(''));
  for (const [label, s, e] of REGIMES) {
    let line = label.padEnd(34);
    for (const nav of Object.values(strategies)) {
      const seg = segmentReturn(nav, cal, s, e);
      line += (seg ? pct(seg.ret) : 'n/a').padStart(11);
    }
    console.log(line);
    // dd row
    let ddline = '   (maxDD)'.padEnd(34);
    for (const nav of Object.values(strategies)) {
      const seg = segmentReturn(nav, cal, s, e);
      ddline += (seg ? pct(seg.mdd) : 'n/a').padStart(11);
    }
    console.log(ddline);
  }

  // ---- per-year Sharpe (risk-adjusted, the real test) -------------------
  console.log('\n================ PER-YEAR SHARPE ================\n');
  const years_list = ['2022', '2023', '2024', '2025'];
  console.log('Year'.padEnd(8) + Object.keys(strategies).map(n => n.split(' ')[0].slice(0, 9).padStart(11)).join(''));
  for (const yr of years_list) {
    let line = yr.padEnd(8);
    for (const nav of Object.values(strategies)) {
      const idx = [];
      for (let i = 0; i < cal.length; i++) if (cal[i].startsWith(yr)) idx.push(i);
      if (idx.length < 20) { line += 'n/a'.padStart(11); continue; }
      const rets = [];
      for (let k = 1; k < idx.length; k++) rets.push(nav[idx[k]] / nav[idx[k] - 1] - 1);
      const sh = std(rets) ? (mean(rets) / std(rets)) * Math.sqrt(252) : 0;
      line += sh.toFixed(2).padStart(11);
    }
    console.log(line);
  }

  // ---- sleeve diagnostics: did sub-groups actually rotate leadership? ----
  console.log('\n================ SLEEVE LEADERSHIP BY YEAR (sleeve total return) ================\n');
  console.log('Year'.padEnd(8) + SLEEVE_NAMES.map(n => n.slice(0, 9).padStart(13)).join(''));
  for (const yr of ['2022', '2023', '2024', '2025']) {
    const idx = [];
    for (let i = 0; i < cal.length; i++) if (cal[i].startsWith(yr)) idx.push(i);
    if (idx.length < 20) continue;
    let line = yr.padEnd(8);
    for (let s = 0; s < SLEEVE_NAMES.length; s++) {
      let cum = 1;
      for (let k = idx[0] + 1; k <= idx[idx.length - 1]; k++) cum *= 1 + sleeveRet[s][k];
      line += pct(cum - 1).padStart(13);
    }
    console.log(line);
  }

  console.log('\nDone.\n');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
