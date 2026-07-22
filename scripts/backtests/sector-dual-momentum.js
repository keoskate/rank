/**
 * Dual-momentum sector rotation backtest.
 *
 * Rule (mechanical):
 *   Universe (risk sleeve): SMH, XLK, QQQ, XLE, XLF, XLV, IWM, GLD
 *   Safe asset: TLT (long Treasuries). Cash fallback (BIL/SHV proxy) = risk-free.
 *   Cadence: monthly, rebalance on last trading day of each month, fill at next
 *            day's open (no look-ahead).
 *   Signal: trailing total return over LOOKBACK trading days (~12 months = 252,
 *           also tests 126/63 blends).
 *   Relative momentum: pick the universe member with the highest trailing return.
 *   Absolute momentum: if that winner's trailing return <= risk-free trailing
 *           return over same window, do NOT hold it — go to TLT (or cash if TLT
 *           also negative absolute momentum).
 *   Sizing: 100% in the single chosen asset (classic dual momentum).
 *   Cost: bpsPerSide(sym) charged per side on every switch (round trip when both
 *           legs traded).
 *
 * Benchmarks: buy-and-hold SPY and QQQ, same window, same starting capital.
 */

require('dotenv').config();
const { getHistoricalAggregates } = require('/Users/keo/projects/rank-app/rank/server/polygonClient.js');
const { bpsPerSide } = require('/Users/keo/projects/rank-app/rank/server/risk/transactionCost.js');

const RISK_UNIVERSE = ['SMH', 'XLK', 'QQQ', 'XLE', 'XLF', 'XLV', 'IWM', 'GLD'];
const SAFE = 'TLT';
const BENCHES = ['SPY', 'QQQ'];
const RF_PROXY = 'BIL'; // 1-3mo T-bill ETF, total-return proxy for cash
const ALL = [...new Set([...RISK_UNIVERSE, SAFE, ...BENCHES, RF_PROXY])];

const START = '2017-01-01'; // need 1yr lookback warmup before 2018
const END = '2026-06-01';
const LOOKBACK = 252; // ~12 months
const INIT = 100000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAll() {
  const data = {};
  for (const sym of ALL) {
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const bars = await getHistoricalAggregates(sym, START, END, 'day');
        if (bars && bars.length) {
          data[sym] = bars;
          ok = true;
        } else {
          console.warn(`No bars for ${sym}`);
          ok = true; // don't retry empty
        }
      } catch (e) {
        console.warn(`retry ${sym}: ${e.message}`);
        await sleep(1500);
      }
      await sleep(200);
    }
  }
  return data;
}

// Build a unified trading calendar from SPY, and a per-symbol close lookup.
function buildSeries(data) {
  const cal = data['SPY'].map((b) => b.date);
  const closeBy = {};
  const openBy = {};
  for (const sym of Object.keys(data)) {
    const c = {};
    const o = {};
    for (const b of data[sym]) {
      c[b.date] = b.close;
      o[b.date] = b.open;
    }
    closeBy[sym] = c;
    openBy[sym] = o;
  }
  return { cal, closeBy, openBy };
}

// month-end trading days (last cal date in each YYYY-MM)
function monthEnds(cal) {
  const byMonth = {};
  for (const d of cal) {
    const m = d.slice(0, 7);
    byMonth[m] = d; // last seen = last trading day (cal is ascending)
  }
  return Object.values(byMonth);
}

function trailingReturn(closeBy, sym, idxDate, cal, calIdxMap) {
  const i = calIdxMap[idxDate];
  if (i == null || i < LOOKBACK) return null;
  const past = cal[i - LOOKBACK];
  const pc = closeBy[sym]?.[past];
  const cc = closeBy[sym]?.[idxDate];
  if (pc == null || cc == null) return null;
  return cc / pc - 1;
}

function nextTradingDate(cal, calIdxMap, date) {
  const i = calIdxMap[date];
  if (i == null || i + 1 >= cal.length) return null;
  return cal[i + 1];
}

function cagr(final, init, years) {
  return Math.pow(final / init, 1 / years) - 1;
}

function maxDrawdown(equitySeries) {
  let peak = -Infinity;
  let mdd = 0;
  for (const { v } of equitySeries) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function sharpe(dailyRets) {
  const n = dailyRets.length;
  if (!n) return 0;
  const mean = dailyRets.reduce((a, b) => a + b, 0) / n;
  const variance = dailyRets.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

function periodReturn(equitySeries, startDate, endDate) {
  const inWin = equitySeries.filter((e) => e.date >= startDate && e.date <= endDate);
  if (inWin.length < 2) return null;
  return inWin[inWin.length - 1].v / inWin[0].v - 1;
}

function run(data) {
  const { cal, closeBy, openBy } = buildSeries(data);
  const calIdxMap = {};
  cal.forEach((d, i) => (calIdxMap[d] = i));
  const mEnds = monthEnds(cal);

  // Determine target holding each month-end (decided at close, filled next open).
  // backtest start: first month-end on/after 2018-01-01 with enough lookback.
  const decisions = []; // {decisionDate, fillDate, target}
  for (const me of mEnds) {
    if (me < '2018-01-01') continue;
    const i = calIdxMap[me];
    if (i < LOOKBACK) continue;
    const fill = nextTradingDate(cal, calIdxMap, me);
    if (!fill) continue;

    // relative momentum
    let best = null;
    let bestRet = -Infinity;
    for (const sym of RISK_UNIVERSE) {
      const r = trailingReturn(closeBy, sym, me, cal, calIdxMap);
      if (r == null) continue;
      if (r > bestRet) {
        bestRet = r;
        best = sym;
      }
    }
    // absolute momentum: compare winner vs risk-free (BIL) trailing return
    const rf = trailingReturn(closeBy, RF_PROXY, me, cal, calIdxMap) ?? 0;
    let target;
    if (best == null) {
      target = 'CASH';
    } else if (bestRet > rf) {
      target = best; // risk-on
    } else {
      // risk-off: prefer TLT if its own absolute momentum positive, else cash
      const tltR = trailingReturn(closeBy, SAFE, me, cal, calIdxMap) ?? -1;
      target = tltR > rf ? SAFE : 'CASH';
    }
    decisions.push({ decisionDate: me, fillDate: fill, target });
  }

  if (!decisions.length) throw new Error('no decisions');

  // Simulate daily equity. Hold target until next fillDate.
  const startDate = decisions[0].fillDate;
  const startIdx = calIdxMap[startDate];
  const endIdx = cal.length - 1;

  // map each trading day -> active holding (the most recent decision whose fillDate <= day)
  let equity = INIT;
  let holding = decisions[0].target;
  let cashRfDaily = null; // for CASH, accrue BIL daily return
  const equitySeries = [];
  const dailyRets = [];
  let decPtr = 0;
  const switches = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const day = cal[i];
    const prevDay = cal[i - 1];

    // Apply any rebalance that fills today (at open). Charge cost on switch.
    while (decPtr < decisions.length && decisions[decPtr].fillDate === day) {
      const newTarget = decisions[decPtr].target;
      if (newTarget !== holding) {
        // round-trip-ish: sell old (if not cash) + buy new (if not cash)
        let costBps = 0;
        if (holding !== 'CASH') costBps += bpsPerSide(holding);
        if (newTarget !== 'CASH') costBps += bpsPerSide(newTarget);
        equity *= 1 - costBps / 10000;
        switches.push({ date: day, from: holding, to: newTarget });
        holding = newTarget;
      }
      decPtr++;
    }

    // Daily P&L from prevDay close to day close for the held asset.
    let dret = 0;
    if (holding === 'CASH') {
      // accrue BIL daily return
      const pc = closeBy[RF_PROXY]?.[prevDay];
      const cc = closeBy[RF_PROXY]?.[day];
      dret = pc && cc ? cc / pc - 1 : 0;
    } else {
      const pc = closeBy[holding]?.[prevDay];
      const cc = closeBy[holding]?.[day];
      dret = pc && cc ? cc / pc - 1 : 0;
    }
    equity *= 1 + dret;
    dailyRets.push(dret);
    equitySeries.push({ date: day, v: equity, holding });
  }

  // Benchmarks: buy and hold from startDate close, no cost beyond entry.
  function buyHold(sym) {
    const series = [];
    const rets = [];
    const base = closeBy[sym][startDate];
    let eq = INIT;
    for (let i = startIdx; i <= endIdx; i++) {
      const day = cal[i];
      const prev = cal[i - 1];
      const pc = closeBy[sym][prev];
      const cc = closeBy[sym][day];
      const r = pc && cc ? cc / pc - 1 : 0;
      eq *= 1 + r;
      rets.push(r);
      series.push({ date: day, v: eq });
    }
    return { series, rets };
  }

  const years = (calIdxMap[cal[endIdx]] - startIdx) / 252;
  const benches = {};
  for (const b of BENCHES) benches[b] = buyHold(b);

  return { equitySeries, dailyRets, switches, benches, years, startDate, endDate: cal[endIdx], holding };
}

function fmtPct(x) {
  return x == null ? 'n/a' : (x * 100).toFixed(1) + '%';
}

(async () => {
  console.log('Fetching data...');
  const data = await fetchAll();
  const missing = ALL.filter((s) => !data[s] || !data[s].length);
  if (missing.length) console.warn('MISSING:', missing.join(','));

  const res = run(data);
  const { equitySeries, dailyRets, switches, benches, years } = res;

  const stratFinal = equitySeries[equitySeries.length - 1].v;
  const stratCagr = cagr(stratFinal, INIT, years);
  const stratMdd = maxDrawdown(equitySeries);
  const stratSharpe = sharpe(dailyRets);

  console.log('\n===== DUAL-MOMENTUM SECTOR ROTATION =====');
  console.log(`Window: ${res.startDate} -> ${res.endDate}  (${years.toFixed(2)} yrs)`);
  console.log(`Switches: ${switches.length}`);
  console.log(`Final: $${stratFinal.toFixed(0)}  CAGR ${fmtPct(stratCagr)}  MaxDD ${fmtPct(stratMdd)}  Sharpe ${stratSharpe.toFixed(2)}  Return/|MaxDD| ${(stratCagr / Math.abs(stratMdd)).toFixed(2)}`);

  for (const b of BENCHES) {
    const s = benches[b].series;
    const f = s[s.length - 1].v;
    const c = cagr(f, INIT, years);
    const m = maxDrawdown(s);
    const sh = sharpe(benches[b].rets);
    console.log(`B&H ${b}: Final $${f.toFixed(0)}  CAGR ${fmtPct(c)}  MaxDD ${fmtPct(m)}  Sharpe ${sh.toFixed(2)}  Ret/|DD| ${(c / Math.abs(m)).toFixed(2)}`);
  }

  // Regime breakdown
  const regimes = [
    ['2018 (Q4 selloff yr)', '2018-01-01', '2018-12-31'],
    ['2019 bull', '2019-01-01', '2019-12-31'],
    ['2020 COVID crash+recov', '2020-01-01', '2020-12-31'],
    ['2020 crash only', '2020-02-19', '2020-03-23'],
    ['2021 bull', '2021-01-01', '2021-12-31'],
    ['2022 BEAR', '2022-01-01', '2022-12-31'],
    ['2023 bull', '2023-01-01', '2023-12-31'],
    ['2024 bull', '2024-01-01', '2024-12-31'],
    ['2025-26 YTD', '2025-01-01', '2026-06-01'],
  ];
  console.log('\n--- By regime (period return) ---');
  console.log('Regime'.padEnd(26), 'Strat'.padStart(8), 'SPY'.padStart(8), 'QQQ'.padStart(8));
  const regimeRows = [];
  for (const [name, s, e] of regimes) {
    const st = periodReturn(equitySeries, s, e);
    const sp = periodReturn(benches['SPY'].series, s, e);
    const qq = periodReturn(benches['QQQ'].series, s, e);
    console.log(name.padEnd(26), fmtPct(st).padStart(8), fmtPct(sp).padStart(8), fmtPct(qq).padStart(8));
    regimeRows.push({ name, st, sp, qq });
  }

  // Holdings histogram
  const hist = {};
  for (const e of equitySeries) hist[e.holding] = (hist[e.holding] || 0) + 1;
  console.log('\n--- Days held per asset ---');
  Object.entries(hist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`${k}: ${v} days (${(100 * v / equitySeries.length).toFixed(0)}%)`));

  // emit JSON for report
  const out = {
    window: { start: res.startDate, end: res.endDate, years },
    strat: { final: stratFinal, cagr: stratCagr, mdd: stratMdd, sharpe: stratSharpe, switches: switches.length },
    benches: Object.fromEntries(BENCHES.map((b) => {
      const s = benches[b].series; const f = s[s.length - 1].v;
      return [b, { final: f, cagr: cagr(f, INIT, years), mdd: maxDrawdown(s), sharpe: sharpe(benches[b].rets) }];
    })),
    regimes: regimeRows,
    histogram: hist,
    switchLog: switches,
  };
  require('fs').writeFileSync('/Users/keo/projects/rank-app/rank/scripts/backtests/sector-dual-momentum-result.json', JSON.stringify(out, null, 2));
  console.log('\nWrote result JSON.');
})();
