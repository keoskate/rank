// packages/quant-core/src/trendCore.js
//
// THE trend-following decision. Pure function of (daily closes, config).
//
// Both the live plugin (server/strategies/trendFollowing.js) and every
// backtest MUST call this — the faithfulness contract, same pattern as
// entropyGateCore. Before this existed the live plugin computed its own
// SMA/momentum on Polygon split-only data while backtests used Alpaca
// split+dividend-adjusted data with different window timing — the exact
// divergence class that made the entropy gate's backtest worthless.
//
// Rule (the trend-follower broker's deployed spec):
//   uptrend ⇔ price > SMA(smaWindow)  AND  12-1 momentum > 0
// where momentum = closes[t-momSkip] / closes[t-momLookback] − 1.
//
// Conventions:
//  - `closes` are daily closes through the most recent COMPLETED session,
//    oldest → newest.
//  - The SMA window ends at the last provided close. `price` defaults to the
//    last close (backtest semantics: signal on yesterday's close); the live
//    plugin may pass a realtime price override for timely trend breaks —
//    that override is the documented execution-timing difference between
//    live and backtest, not a logic difference.
//  - Insufficient history → ok:false, uptrend:false. There is deliberately
//    NO momentum fallback: the old plugin substituted price/SMA−1 when
//    history was short, which silently disabled the momentum condition.
//    Short history now means "not eligible", in live and backtest alike.

const DEFAULTS = {
  smaWindow: 200,
  momLookback: 252,
  momSkip: 21,
  volWindow: 63,
};

/**
 * @param {number[]} closes - daily closes, oldest → newest
 * @param {object} [cfg]
 * @param {number} [cfg.smaWindow=200]
 * @param {number} [cfg.momLookback=252]
 * @param {number} [cfg.momSkip=21]
 * @param {number} [cfg.volWindow=63] - realized-vol window for rankScore
 * @param {number} [cfg.price] - optional realtime price override
 * @returns {{ok: boolean, uptrend: boolean, aboveSma: boolean|null,
 *            sma: number|null, momentum: number|null, price: number|null,
 *            vol: number|null, rankScore: number|null}}
 *
 * `rankScore` = momentum / realized vol (sd of daily returns over volWindow,
 * per-period units — scale cancels in ranking). Raw-momentum ranking is
 * volatility-biased: a bond trending up 10%/yr at 8% vol never outranks a
 * sector up 30% at 35% vol, so diversifiers never make a top-N book.
 * Vol-adjusted ranking is how institutional trend programs admit them.
 * The eligibility decision (uptrend) is unchanged either way.
 */
function evaluateTrend(closes, cfg = {}) {
  const smaWindow = cfg.smaWindow || DEFAULTS.smaWindow;
  const momLookback = cfg.momLookback || DEFAULTS.momLookback;
  const momSkip = cfg.momSkip ?? DEFAULTS.momSkip;
  const volWindow = cfg.volWindow || DEFAULTS.volWindow;

  const n = closes ? closes.length : 0;
  const need = Math.max(smaWindow, momLookback + 1);
  if (n < need) {
    return {
      ok: false,
      uptrend: false,
      aboveSma: null,
      sma: null,
      momentum: null,
      price: null,
      vol: null,
      rankScore: null,
    };
  }

  let s = 0;
  for (let k = n - smaWindow; k < n; k++) s += closes[k];
  const sma = s / smaWindow;

  const price = cfg.price > 0 ? cfg.price : closes[n - 1];

  const pOld = closes[n - 1 - momLookback];
  const pRecent = closes[n - 1 - momSkip];
  const momentum = pOld > 0 && pRecent > 0 ? pRecent / pOld - 1 : null;

  // realized vol over the trailing volWindow completed days
  let vol = null;
  if (n >= volWindow + 1) {
    const rets = [];
    for (let k = n - volWindow; k < n; k++) {
      if (closes[k - 1] > 0) rets.push(closes[k] / closes[k - 1] - 1);
    }
    if (rets.length >= 2) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      vol = Math.sqrt(
        rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)
      );
    }
  }
  const rankScore = momentum != null && vol > 0 ? momentum / vol : null;

  const aboveSma = price > sma;
  const uptrend = aboveSma && momentum != null && momentum > 0;

  return { ok: true, uptrend, aboveSma, sma, momentum, price, vol, rankScore };
}

module.exports = { evaluateTrend, DEFAULTS };
