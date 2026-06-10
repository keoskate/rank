// equityStats — pure equity-curve statistics.
//
// Single source of truth for the stats every backtest reports. Before this
// existed, statsFromEquity/sharpe/maxDrawdown were copy-pasted (with drifting
// conventions) across xs-momentum, ts-momentum-trend, and overlays. One
// implementation means one definition of "Sharpe" everywhere.
//
// Conventions (documented so nobody re-litigates them silently):
//  - Returns are simple daily returns from an equity curve aligned to dates.
//  - Sharpe = (mean daily ret * 252) / (stdev daily ret * sqrt(252)), rf = 0.
//  - Vol is annualized stdev of daily returns (sample stdev, n-1).
//  - Max drawdown is peak-to-trough on the equity curve, reported <= 0.
//  - CAGR uses calendar years between first and last date (365.25d years).

function dailyReturns(equity) {
  const rets = [];
  for (let i = 1; i < equity.length; i++) {
    rets.push(equity[i] / equity[i - 1] - 1);
  }
  return rets;
}

function yearsBetween(firstDate, lastDate) {
  return (new Date(lastDate) - new Date(firstDate)) / (365.25 * 864e5);
}

function annualizedVol(rets) {
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function sharpe(rets) {
  const vol = annualizedVol(rets);
  if (vol === 0) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return (mean * 252) / vol;
}

function maxDrawdown(equity) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = e / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Per-point drawdown series (each value <= 0), same length as equity.
 */
function drawdownSeries(equity) {
  const out = new Array(equity.length);
  let peak = -Infinity;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    out[i] = equity[i] / peak - 1;
  }
  return out;
}

/**
 * Core summary stats for an equity curve.
 * @param {string[]} dates - ISO dates aligned to equity
 * @param {number[]} equity - equity values (any base; ratios are used)
 */
function statsFromEquity(dates, equity) {
  if (
    !dates ||
    !equity ||
    equity.length < 2 ||
    dates.length !== equity.length
  ) {
    return null;
  }
  const rets = dailyReturns(equity);
  const years = yearsBetween(dates[0], dates[dates.length - 1]);
  const totalRet = equity[equity.length - 1] / equity[0] - 1;
  const cagr =
    years > 0
      ? Math.pow(equity[equity.length - 1] / equity[0], 1 / years) - 1
      : 0;
  const vol = annualizedVol(rets);
  const shrp = sharpe(rets);
  const maxDD = maxDrawdown(equity);
  const calmar = maxDD === 0 ? 0 : cagr / Math.abs(maxDD);
  return { totalRet, cagr, vol, sharpe: shrp, maxDD, calmar, years };
}

/**
 * Calendar-year returns: { '2022': -0.18, ... }
 */
function yearlyReturns(dates, equity) {
  const byYear = {};
  for (let i = 0; i < dates.length; i++) {
    const y = dates[i].slice(0, 4);
    if (!byYear[y]) byYear[y] = { first: equity[i], last: equity[i] };
    byYear[y].last = equity[i];
  }
  const out = {};
  for (const y of Object.keys(byYear)) {
    out[y] = byYear[y].last / byYear[y].first - 1;
  }
  return out;
}

/**
 * Return + max drawdown within a [from, to] date window (inclusive).
 */
function windowReturn(dates, equity, from, to) {
  let si = -1;
  let ei = -1;
  for (let i = 0; i < dates.length; i++) {
    if (si < 0 && dates[i] >= from) si = i;
    if (dates[i] <= to) ei = i;
  }
  if (si < 0 || ei < 0 || ei <= si) return null;
  let peak = equity[si];
  let maxDD = 0;
  for (let i = si; i <= ei; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = equity[i] / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return { ret: equity[ei] / equity[si] - 1, maxDD };
}

module.exports = {
  dailyReturns,
  yearsBetween,
  annualizedVol,
  sharpe,
  maxDrawdown,
  drawdownSeries,
  statsFromEquity,
  yearlyReturns,
  windowReturn,
};
