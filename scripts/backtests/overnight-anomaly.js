// Overnight return anomaly backtest.
// Decomposes daily ETF returns into OVERNIGHT (prevClose -> open) and
// INTRADAY (open -> close), and tests three strategies:
//   - overnight-only: buy at close, sell at next open. Holds overnight only.
//   - intraday-only:  buy at open, sell at same close. Holds intraday only.
//   - buy&hold:       prevClose -> close (the full daily return).
// We test SPY and QQQ, gross AND net of transaction cost.
//
// Cost model: overnight-only and intraday-only each do ONE round trip per day
// (enter + exit). Cost is charged per trade using bpsPerSide(sym) * 2 (round trip).
// Buy&hold pays cost once at the very start (negligible, ignored).
//
// Run: cd /Users/keo/projects/rank-app/rank && node scripts/backtests/overnight-anomaly.js

require('dotenv').config();
const { getHistoricalAggregates } = require('../../server/polygonClient');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const START = '2018-01-01';
const END = '2026-06-03';
const SYMBOLS = ['SPY', 'QQQ'];

const TRADING_DAYS = 252;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Annualized Sharpe of a series of daily simple returns (excess over 0; rf~0 assumption).
function sharpe(dailyRets) {
  const n = dailyRets.length;
  if (n < 2) return NaN;
  const mean = dailyRets.reduce((a, b) => a + b, 0) / n;
  const variance =
    dailyRets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return NaN;
  return (mean / sd) * Math.sqrt(TRADING_DAYS);
}

// CAGR from a compounded equity curve and number of days.
function cagrFromTotal(totalGrowth, nDays) {
  const years = nDays / TRADING_DAYS;
  if (years <= 0) return NaN;
  return Math.pow(totalGrowth, 1 / years) - 1;
}

// Max drawdown of an equity curve (array of cumulative multipliers starting at 1).
function maxDrawdown(equity) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD; // negative number
}

// Build equity curve from daily returns.
function equityCurve(dailyRets) {
  const eq = [];
  let cum = 1;
  for (const r of dailyRets) {
    cum *= 1 + r;
    eq.push(cum);
  }
  return eq;
}

function stats(dailyRets) {
  if (dailyRets.length === 0) return null;
  const eq = equityCurve(dailyRets);
  const total = eq[eq.length - 1];
  return {
    n: dailyRets.length,
    totalReturn: total - 1,
    cagr: cagrFromTotal(total, dailyRets.length),
    sharpe: sharpe(dailyRets),
    maxDD: maxDrawdown(eq),
    finalEquity: total,
  };
}

function yearOf(dateStr) {
  return dateStr.slice(0, 4);
}

// Regime labels for special-attention windows.
function regimeOf(dateStr) {
  // 2020 COVID crash: Feb 19 2020 peak -> Mar 23 2020 trough
  if (dateStr >= '2020-02-19' && dateStr <= '2020-03-23') return 'COVID-crash';
  // 2022 bear market: Jan 3 2022 peak -> Oct 12 2022 trough
  if (dateStr >= '2022-01-03' && dateStr <= '2022-10-12') return '2022-bear';
  return null;
}

async function fetchWithRetry(sym) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const bars = await getHistoricalAggregates(sym, START, END, 'day');
      return bars;
    } catch (e) {
      const wait = 1500 * (attempt + 1);
      console.warn(`retry ${sym} attempt ${attempt + 1}: ${e.message}; wait ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`failed to fetch ${sym}`);
}

async function run() {
  const results = {};

  for (const sym of SYMBOLS) {
    await sleep(200);
    const bars = await fetchWithRetry(sym);
    if (!bars || bars.length < 100) {
      console.error(`Insufficient data for ${sym}`);
      continue;
    }
    // sanity: sorted ascending
    bars.sort((a, b) => (a.date < b.date ? -1 : 1));

    const sideBps = bpsPerSide(sym); // per side
    const rtCost = (sideBps * 2) / 10000; // round-trip fractional cost per daily trade

    // Build daily decomposed return series. Start from index 1 (need prevClose).
    const rows = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1];
      const cur = bars[i];
      if (!prev.close || !cur.open || !cur.close) continue;
      const overnightGross = cur.open / prev.close - 1; // prevClose -> open
      const intradayGross = cur.close / cur.open - 1; // open -> close
      const fullGross = cur.close / prev.close - 1; // prevClose -> close (buy&hold)

      rows.push({
        date: cur.date,
        year: yearOf(cur.date),
        regime: regimeOf(cur.date),
        overnightGross,
        intradayGross,
        fullGross,
        // net: one round trip cost per day for the daily strategies
        overnightNet: overnightGross - rtCost,
        intradayNet: intradayGross - rtCost,
      });
    }

    results[sym] = { rows, sideBps, rtCost, firstDate: rows[0].date, lastDate: rows[rows.length - 1].date };
  }

  // Print summary
  const report = { meta: { START, END }, perSymbol: {} };

  for (const sym of SYMBOLS) {
    const r = results[sym];
    if (!r) continue;
    const rows = r.rows;

    const series = {
      overnightGross: rows.map(x => x.overnightGross),
      overnightNet: rows.map(x => x.overnightNet),
      intradayGross: rows.map(x => x.intradayGross),
      intradayNet: rows.map(x => x.intradayNet),
      buyhold: rows.map(x => x.fullGross),
    };

    const summary = {};
    for (const [k, v] of Object.entries(series)) {
      summary[k] = stats(v);
    }

    // Per-year breakdown (total return only) for each strategy
    const years = [...new Set(rows.map(x => x.year))].sort();
    const byYear = {};
    for (const y of years) {
      const yrRows = rows.filter(x => x.year === y);
      byYear[y] = {
        n: yrRows.length,
        overnightGross: yrRows.reduce((a, x) => a * (1 + x.overnightGross), 1) - 1,
        overnightNet: yrRows.reduce((a, x) => a * (1 + x.overnightNet), 1) - 1,
        intradayGross: yrRows.reduce((a, x) => a * (1 + x.intradayGross), 1) - 1,
        intradayNet: yrRows.reduce((a, x) => a * (1 + x.intradayNet), 1) - 1,
        buyhold: yrRows.reduce((a, x) => a * (1 + x.fullGross), 1) - 1,
      };
    }

    // Regime breakdown
    const regimes = {};
    for (const reg of ['COVID-crash', '2022-bear']) {
      const regRows = rows.filter(x => x.regime === reg);
      if (regRows.length === 0) continue;
      regimes[reg] = {
        n: regRows.length,
        dateRange: `${regRows[0].date}..${regRows[regRows.length - 1].date}`,
        overnightGross: regRows.reduce((a, x) => a * (1 + x.overnightGross), 1) - 1,
        overnightNet: regRows.reduce((a, x) => a * (1 + x.overnightNet), 1) - 1,
        intradayGross: regRows.reduce((a, x) => a * (1 + x.intradayGross), 1) - 1,
        intradayNet: regRows.reduce((a, x) => a * (1 + x.intradayNet), 1) - 1,
        buyhold: regRows.reduce((a, x) => a * (1 + x.fullGross), 1) - 1,
      };
    }

    report.perSymbol[sym] = {
      sideBps: r.sideBps,
      rtCostBps: r.rtCost * 10000,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
      nDays: rows.length,
      summary,
      byYear,
      regimes,
    };
  }

  console.log('\n========== OVERNIGHT ANOMALY BACKTEST ==========\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

run().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
