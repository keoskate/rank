#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/ai-momentum.js
//
// STRATEGY: AI/semi momentum — "bubble rider" (long-only trend overlay).
//
// Concrete mechanical rule (no vibes):
//   Universe: an AI + semiconductor basket of liquid single names + sector ETFs
//             (see BASKET). Newer names (where Polygon has no 2018 data) are
//             simply absent until they have >=60 daily bars of history — they
//             can't be held before they trade, which is realistic.
//   Signal:   each name is "IN" if its close is above its own 50-day SMA on the
//             rebalance date (a trend filter). Otherwise it is "OUT" (held flat,
//             that sleeve goes to cash).
//   Sizing:   equal weight across the names that are eligible *today* (have >=50
//             bars of history). Each eligible name gets 1/N of the book; if it is
//             "IN" it holds its sleeve long, if "OUT" that sleeve sits in cash.
//             -> This is the honest comparison vs buy-and-hold of the SAME basket:
//                buy-hold always holds every eligible sleeve; momentum only holds
//                the sleeves that are above their 50d MA, parking the rest in cash.
//   Cadence:  rebalance every REBAL_DAYS trading days (monthly ~21, weekly ~5).
//   Cost:     transactionCost.bpsPerSide(sym) charged per side on the dollar
//             turnover of each sleeve when it flips IN<->OUT or rebalances weight.
//
// We also test a "top-half by 3-month return" momentum-ranking variant as a
// robustness check on the same engine.
//
// BENCHMARKS: buy-and-hold equal-weight SAME basket, SPY buy-hold, QQQ buy-hold.
// Reported by year + regime (2018 Q4, 2020 crash, 2021, 2022 bear, 2023-26).

require('dotenv').config();
const polygon = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

// AI + semiconductor basket. Mix of single names + sector ETFs.
// Tagged with whether they have full 2018 history (older) — the engine handles
// missing early history gracefully (a name is only eligible once it has 50 bars).
const BASKET = [
  // Semiconductors (single names, full 2018 history)
  'NVDA', 'AMD', 'AVGO', 'QCOM', 'TXN', 'MU', 'INTC', 'AMAT', 'LRCX', 'KLAC',
  'ASML', 'TSM', 'ADI', 'MRVL', 'NXPI', 'MCHP', 'ON',
  // AI-adjacent megacaps / software (full 2018 history)
  'MSFT', 'GOOGL', 'META', 'AMZN', 'CRM', 'NOW', 'ORCL',
  // Sector / thematic ETFs (SMH & SOXX full history; others vary)
  'SMH', 'SOXX',
  // Newer AI names (limited early history — eligible once they have 50 bars)
  'PLTR', 'SNOW', 'NET', 'ARM', 'SMCI',
];

const BENCH = ['SPY', 'QQQ'];

const START = '2018-01-01';
const END = new Date().toISOString().slice(0, 10);

const MA_LEN = 50;
const MOM_LOOKBACK = 63; // ~3 months trading days for ranking variant
const ANNUAL = 252;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;

// SMA of close ending at index i (inclusive), length L. null if not enough bars.
function sma(bars, i, L) {
  if (i < L - 1) return null;
  let s = 0;
  for (let k = i - L + 1; k <= i; k++) s += bars[k].close;
  return s / L;
}

async function fetchAll(symbols) {
  const data = {};
  for (const sym of symbols) {
    try {
      const bars = await polygon.getHistoricalAggregates(sym, START, END, 'day');
      if (bars && bars.length) data[sym] = bars;
      else console.error(`  ${sym}: no data`);
    } catch (e) {
      console.error(`  ${sym}: ${e.message}`);
    }
    await sleep(220);
  }
  return data;
}

// Build a master, sorted list of trading dates from a reference (SPY).
function masterDates(spyBars) {
  return spyBars.map(b => b.date);
}

// For each symbol build an index: date -> bar index, so we can look up "the bar
// for symbol on date D" and its trailing window. Also a fast close lookup.
function indexBars(data) {
  const idx = {};
  for (const [sym, bars] of Object.entries(data)) {
    const m = new Map();
    bars.forEach((b, i) => m.set(b.date, i));
    idx[sym] = { bars, byDate: m };
  }
  return idx;
}

// daily close return series for a single symbol aligned to master dates.
// Returns array (len = dates.length) of daily simple returns (0 for first/missing).
function dailyReturns(idx, sym, dates) {
  const out = new Array(dates.length).fill(0);
  const { bars, byDate } = idx[sym];
  let prevClose = null;
  for (let d = 0; d < dates.length; d++) {
    const bi = byDate.get(dates[d]);
    if (bi == null) { out[d] = 0; continue; }
    const c = bars[bi].close;
    if (prevClose != null && prevClose > 0) out[d] = c / prevClose - 1;
    prevClose = c;
  }
  return out;
}

// Is symbol eligible on date d (has >= MA_LEN bars of its own history up to d)?
// Returns {eligible, inTrend(close>50dMA), mom3m} or null if no bar that day.
function symState(idx, sym, date) {
  const { bars, byDate } = idx[sym];
  const bi = byDate.get(date);
  if (bi == null) return null;
  const ma = sma(bars, bi, MA_LEN);
  if (ma == null) return { eligible: false };
  const close = bars[bi].close;
  let mom = null;
  if (bi >= MOM_LOOKBACK) {
    const past = bars[bi - MOM_LOOKBACK].close;
    if (past > 0) mom = close / past - 1;
  }
  return { eligible: true, inTrend: close > ma, mom3m: mom };
}

// Core simulation.
// mode: 'ma' (hold sleeve if close>50dMA), 'tophalf' (hold sleeve if in top half
//        by 3m return among eligible names), or 'buyhold' (hold every eligible
//        sleeve regardless of trend).
// Equal weight across ELIGIBLE sleeves; non-held sleeves sit in cash (0 return).
// Rebalance every rebalDays trading days. Costs charged on per-sleeve turnover.
function simulate(idx, syms, dates, retSeries, mode, rebalDays) {
  // target weights per symbol, updated at each rebalance; held between rebalances
  // (weights drift with price but we approximate by re-deriving held set at rebal;
  //  between rebalances each held sleeve compounds at its own daily return).
  let weights = {}; // sym -> current dollar weight (fraction of book)
  let cashW = 1; // fraction in cash
  let equity = 1;
  const dailyPortRet = new Array(dates.length).fill(0);
  let lastRebal = -1;

  for (let d = 0; d < dates.length; d++) {
    // 1) apply today's market move to existing weights (drift)
    if (d > 0) {
      let gross = cashW; // cash earns 0
      const newW = {};
      for (const [sym, w] of Object.entries(weights)) {
        const r = retSeries[sym][d];
        const wNew = w * (1 + r);
        newW[sym] = wNew;
        gross += wNew;
      }
      const portRet = gross - 1; // book was normalized to 1 at prior close
      dailyPortRet[d] = portRet;
      equity *= 1 + portRet;
      // renormalize weights to fractions of the (now grown) book
      for (const sym of Object.keys(newW)) newW[sym] /= gross;
      cashW /= gross;
      weights = newW;
    }

    // 2) rebalance if due (or first eligible day)
    const due = lastRebal < 0 || d - lastRebal >= rebalDays;
    if (!due) continue;

    // determine eligible set + held set
    const elig = [];
    const states = {};
    for (const sym of syms) {
      const st = symState(idx, sym, dates[d]);
      if (st && st.eligible) { elig.push(sym); states[sym] = st; }
    }
    if (elig.length === 0) continue;

    let held;
    if (mode === 'buyhold') {
      held = elig.slice();
    } else if (mode === 'ma') {
      held = elig.filter(s => states[s].inTrend);
    } else if (mode === 'tophalf') {
      const ranked = elig
        .filter(s => states[s].mom3m != null)
        .sort((a, b) => states[b].mom3m - states[a].mom3m);
      const k = Math.ceil(ranked.length / 2);
      held = ranked.slice(0, k).filter(s => states[s].mom3m > 0); // top half AND positive
    }

    // target weights: equal weight across ELIGIBLE sleeves (1/N each); each
    // eligible sleeve is either invested (if held) or its 1/N sits in cash.
    const N = elig.length;
    const perSleeve = 1 / N;
    const target = {};
    let targetCash = 0;
    for (const sym of elig) {
      if (held.includes(sym)) target[sym] = perSleeve;
      else targetCash += perSleeve;
    }

    // 3) charge turnover cost: sum |target_w - current_w| per sleeve * bps/side
    let costFrac = 0;
    const allSyms = new Set([...Object.keys(weights), ...Object.keys(target)]);
    for (const sym of allSyms) {
      const cur = weights[sym] || 0;
      const tgt = target[sym] || 0;
      const turn = Math.abs(tgt - cur);
      if (turn > 0) costFrac += turn * (bpsPerSide(sym) / 10000);
    }
    // apply cost as a one-time equity hit on the rebalance day
    if (costFrac > 0) {
      equity *= 1 - costFrac;
      dailyPortRet[d] += -costFrac; // fold into the day's return
    }

    weights = target;
    cashW = targetCash;
    lastRebal = d;
  }

  return { dailyPortRet, finalEquity: equity };
}

// Pure buy-hold of a single benchmark symbol (SPY/QQQ), aligned to dates.
function buyHoldSingle(retSeries, sym, dates) {
  const dr = new Array(dates.length).fill(0);
  let eq = 1;
  for (let d = 1; d < dates.length; d++) {
    dr[d] = retSeries[sym][d];
    eq *= 1 + dr[d];
  }
  return { dailyPortRet: dr, finalEquity: eq };
}

// Stats from a daily return series.
function stats(dailyPortRet, dates) {
  const rets = dailyPortRet.slice(1); // skip day 0
  const years = (dates.length - 1) / ANNUAL;
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  const equityCurve = [1];
  for (const r of rets) {
    eq *= 1 + r;
    equityCurve.push(eq);
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  const cagr = years > 0 ? eq ** (1 / years) - 1 : 0;
  const dailyMean = mean(rets);
  const dailyStd = std(rets);
  const sharpe = dailyStd > 0 ? (dailyMean / dailyStd) * Math.sqrt(ANNUAL) : 0;
  return { finalEquity: eq, cagr, sharpe, maxDD, equityCurve, rets };
}

// Per-period (year or custom regime) return from a daily return series.
function periodReturn(dailyPortRet, dates, startDate, endDate) {
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  let n = 0;
  for (let d = 1; d < dates.length; d++) {
    if (dates[d] < startDate || dates[d] > endDate) continue;
    eq *= 1 + dailyPortRet[d];
    n++;
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return { ret: eq - 1, maxDD, n };
}

async function main() {
  if (!process.env.POLYGON_API_KEY) { console.error('Need POLYGON_API_KEY'); process.exit(1); }

  console.log(`\nAI/semi MOMENTUM backtest  ${START} -> ${END}`);
  console.log(`Basket (${BASKET.length}): ${BASKET.join(', ')}`);
  console.log(`Fetching daily bars...\n`);

  const allSyms = [...new Set([...BASKET, ...BENCH])];
  const data = await fetchAll(allSyms);

  if (!data.SPY) { console.error('No SPY data — cannot align dates'); process.exit(1); }
  const dates = masterDates(data.SPY);
  console.log(`\nMaster trading days (SPY): ${dates.length}  (${dates[0]} -> ${dates[dates.length - 1]})`);

  const idx = indexBars(data);

  // precompute daily return series for every symbol aligned to master dates
  const retSeries = {};
  for (const sym of allSyms) {
    if (data[sym]) retSeries[sym] = dailyReturns(idx, sym, dates);
  }

  const basketSyms = BASKET.filter(s => data[s]);
  console.log(`Basket symbols with data: ${basketSyms.length}/${BASKET.length}`);
  const missing = BASKET.filter(s => !data[s]);
  if (missing.length) console.log(`Missing (skipped): ${missing.join(', ')}`);

  // Run strategies
  const runs = {};
  runs['MA-monthly'] = simulate(idx, basketSyms, dates, retSeries, 'ma', 21);
  runs['MA-weekly'] = simulate(idx, basketSyms, dates, retSeries, 'ma', 5);
  runs['TopHalf-monthly'] = simulate(idx, basketSyms, dates, retSeries, 'tophalf', 21);
  runs['BuyHold-basket'] = simulate(idx, basketSyms, dates, retSeries, 'buyhold', 21);
  runs['BuyHold-SPY'] = buyHoldSingle(retSeries, 'SPY', dates);
  runs['BuyHold-QQQ'] = buyHoldSingle(retSeries, 'QQQ', dates);

  console.log('\n================ HEADLINE (full window) ================\n');
  console.log('strategy            CAGR      Sharpe   maxDD     finalEq');
  const head = {};
  for (const [name, run] of Object.entries(runs)) {
    const s = stats(run.dailyPortRet, dates);
    head[name] = s;
    console.log(
      `${name.padEnd(18)} ${pct(s.cagr).padStart(8)}  ${s.sharpe.toFixed(2).padStart(5)}  ${pct(s.maxDD).padStart(8)}  ${s.finalEquity.toFixed(2)}x`
    );
  }

  // Per-year table
  const years = [];
  for (let y = 2018; y <= new Date().getFullYear(); y++) years.push(y);
  const stratList = Object.keys(runs);
  console.log('\n================ BY YEAR (total return) ================\n');
  console.log('year   ' + stratList.map(s => s.slice(0, 10).padStart(12)).join(''));
  for (const y of years) {
    const row = stratList.map(name => {
      const p = periodReturn(runs[name].dailyPortRet, dates, `${y}-01-01`, `${y}-12-31`);
      return (p.n ? pct(p.ret) : '—').padStart(12);
    });
    console.log(`${y}   ` + row.join(''));
  }

  // Regime table
  const regimes = [
    ['2018-Q4-selloff', '2018-10-01', '2018-12-31'],
    ['2020-COVID-crash', '2020-02-19', '2020-03-23'],
    ['2020-recovery', '2020-03-24', '2020-12-31'],
    ['2021-bull', '2021-01-01', '2021-12-31'],
    ['2022-BEAR', '2022-01-01', '2022-12-31'],
    ['2023-26-bull', '2023-01-01', END],
  ];
  console.log('\n================ BY REGIME (total return | maxDD) ================\n');
  for (const [label, s, e] of regimes) {
    console.log(`-- ${label} (${s} -> ${e}) --`);
    for (const name of stratList) {
      const p = periodReturn(runs[name].dailyPortRet, dates, s, e);
      console.log(`   ${name.padEnd(18)} ret ${pct(p.ret).padStart(9)}   maxDD ${pct(p.maxDD).padStart(9)}`);
    }
    console.log('');
  }

  console.log('================ RAW (for report) ================');
  console.log(JSON.stringify(
    Object.fromEntries(Object.entries(head).map(([k, v]) => [k, {
      cagr: +(v.cagr * 100).toFixed(2),
      sharpe: +v.sharpe.toFixed(2),
      maxDD: +(v.maxDD * 100).toFixed(2),
      finalEq: +v.finalEquity.toFixed(2),
    }])), null, 0));
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
