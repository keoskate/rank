// packages/quant-core/src/trimCore.js
//
// THE winner-trim decision. Pure function of (position P&L state, config).
//
// Both the live plugins (server/strategies/trendFollowing.js and
// server/strategies/xsMomentum.js) and the backtest overlay
// (scripts/backtests/validate-trend.js) MUST call this — the faithfulness
// contract, same pattern as trendCore/entropyGateCore.
//
// Rule:
//   trim once  ⇔  trimAtProfitPercent is set (> 0)
//             AND  the position has not already been trimmed (partialExitDone)
//             AND  unrealized P&L % ≥ trimAtProfitPercent.
//
// "Trim once" is load-bearing: on the plugin exit path the executors set
// position.partialExitDone after a partial, but nothing on that path re-checks
// it (signalEvaluator's alreadyPartial guard lives in the universal path the
// plugins bypass). So this helper is the only thing preventing a winner from
// being re-trimmed every tick — the guard must live here.
//
// Disabled (trimAtProfitPercent == null) returns null with zero overhead.

/**
 * @param {object} position
 * @param {number} position.unrealizedPnLPercent - current unrealized P&L, percent units (e.g. 25 = +25%)
 * @param {boolean} [position.partialExitDone] - true if this position was already trimmed
 * @param {object} cfg
 * @param {?number} cfg.trimAtProfitPercent - profit threshold in percent; null/0 = disabled
 * @returns {?{trim: true, pnlPercent: number, threshold: number}} null when no trim
 */
function evaluateTrim(
  { unrealizedPnLPercent, partialExitDone } = {},
  cfg = {}
) {
  const threshold = cfg.trimAtProfitPercent;
  if (threshold == null || !(threshold > 0)) return null; // disabled
  if (partialExitDone === true) return null; // trim once only

  const pnl = Number(unrealizedPnLPercent);
  if (!Number.isFinite(pnl) || pnl < threshold) return null;

  return { trim: true, pnlPercent: pnl, threshold };
}

module.exports = { evaluateTrim };
