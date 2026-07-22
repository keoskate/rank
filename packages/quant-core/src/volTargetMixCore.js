// packages/quant-core/src/volTargetMixCore.js
//
// THE vol-targeted mix decision. Pure functions of (dates, closesA, closesB, cfg).
//
// Strategy (validated OOS Sharpe 1.30 vs EW control 1.22, 2026-07-21 sharpe-hunt):
// hold a monthly-rebalanced two-asset mix (w in A, 1−w in B — deployed: 50/50
// SOXX/GLD), and scale TOTAL exposure by a volatility target:
//
//   scalar_i = min(1, targetVol / realizedVol_{i-1})
//
// where realizedVol is the annualized stdev of the mix's daily returns over the
// trailing volWindow days ending at i−1. Data through i−1 only — no lookahead.
//
// Both the live plugin (server/strategies/volTargetMix.js) and the backtest
// (scripts/backtests/validate-vol-target-mix.js) MUST call this core — the
// faithfulness contract, certified by certify-vol-target-mix.js. The SIGNAL is
// deliberately cost-free (a decision must not depend on the cost model); costs
// belong to the execution/backtest layer.
//
// Conventions:
//  - dates/closesA/closesB are parallel arrays through the most recent
//    COMPLETED session, oldest → newest, already aligned (same calendar).
//  - Mix weights reset to (mixW, 1−mixW) at the close of the FIRST trading day
//    of each month and drift with returns in between (matches the backtest's
//    simulateMonthlyPair share mechanics, minus costs).
//  - evaluate() returns the decision for the NEXT session: target portfolio
//    weights {a, b, cash} that sum to 1.

const DEFAULTS = {
  mixW: 0.5, // weight of leg A at each monthly reset
  targetVol: 0.12, // annualized vol target for the scaled mix
  volWindow: 20, // trailing days for the realized-vol estimate
};

/**
 * Cost-free daily returns of the monthly-rebalanced mix.
 * returns[i] is the mix return from close i−1 → close i (null until both legs
 * have a prior close). Weight resets apply AFTER the month-start day's return
 * (rebalance executes at that day's close), exactly like the backtest engine.
 * @returns {Array<number|null>}
 */
function mixDailyReturns(dates, closesA, closesB, mixW = DEFAULTS.mixW) {
  const n = dates.length;
  const out = new Array(n).fill(null);
  let wA = mixW;
  for (let i = 1; i < n; i++) {
    const pA0 = closesA[i - 1];
    const pA1 = closesA[i];
    const pB0 = closesB[i - 1];
    const pB1 = closesB[i];
    if (pA0 > 0 && pA1 > 0 && pB0 > 0 && pB1 > 0) {
      const rA = pA1 / pA0 - 1;
      const rB = pB1 / pB0 - 1;
      const rMix = wA * rA + (1 - wA) * rB;
      out[i] = rMix;
      // drift the weight with the day's returns…
      wA = (wA * (1 + rA)) / (1 + rMix);
    }
    // …then reset at the close of the first trading day of a new month
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) {
      wA = mixW;
    }
  }
  return out;
}

/**
 * Annualized realized vol of the last `volWindow` non-null returns strictly
 * before index i. Sample stdev (ddof=1) × sqrt(252). Null if underfilled.
 */
function realizedVolAt(returns, i, volWindow = DEFAULTS.volWindow) {
  const slice = [];
  for (let j = i - 1; j >= 0 && slice.length < volWindow; j--) {
    if (returns[j] != null) slice.push(returns[j]);
  }
  if (slice.length < volWindow) return null;
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance =
    slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * Exposure scalar applying to the return from close i−1 → close i.
 * Null while the vol estimate is underfilled. Capped at 1 (no leverage).
 */
function scalarAt(mixReturns, i, cfg = {}) {
  const targetVol = cfg.targetVol || DEFAULTS.targetVol;
  const volWindow = cfg.volWindow || DEFAULTS.volWindow;
  const rv = realizedVolAt(mixReturns, i, volWindow);
  if (rv == null || !(rv > 0)) return null;
  return Math.min(1, targetVol / rv);
}

/**
 * Full scalar series for a backtest: series[i] is the exposure held during the
 * i-th day's return (decided from data through i−1).
 * @returns {Array<number|null>}
 */
function scalarSeries(dates, closesA, closesB, cfg = {}) {
  const mixW = cfg.mixW || DEFAULTS.mixW;
  const mixReturns = mixDailyReturns(dates, closesA, closesB, mixW);
  return dates.map((_, i) => (i === 0 ? null : scalarAt(mixReturns, i, cfg)));
}

/**
 * The live decision: given series through the most recent completed session,
 * return the target weights to hold NOW (for the next session).
 * @returns {{ok: boolean, scalar: number|null, realizedVol: number|null,
 *            weights: {a: number, b: number, cash: number}|null}}
 */
function evaluate(dates, closesA, closesB, cfg = {}) {
  const mixW = cfg.mixW || DEFAULTS.mixW;
  const n = dates ? dates.length : 0;
  if (
    n < (cfg.volWindow || DEFAULTS.volWindow) + 2 ||
    !closesA ||
    !closesB ||
    closesA.length !== n ||
    closesB.length !== n
  ) {
    return { ok: false, scalar: null, realizedVol: null, weights: null };
  }
  const mixReturns = mixDailyReturns(dates, closesA, closesB, mixW);
  const rv = realizedVolAt(mixReturns, n, cfg.volWindow || DEFAULTS.volWindow);
  const scalar = scalarAt(mixReturns, n, cfg);
  if (scalar == null) {
    return { ok: false, scalar: null, realizedVol: rv, weights: null };
  }
  return {
    ok: true,
    scalar,
    realizedVol: rv,
    weights: {
      a: mixW * scalar,
      b: (1 - mixW) * scalar,
      cash: 1 - scalar,
    },
  };
}

module.exports = {
  DEFAULTS,
  mixDailyReturns,
  realizedVolAt,
  scalarAt,
  scalarSeries,
  evaluate,
};
