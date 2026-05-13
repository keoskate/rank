/**
 * Target & stop derivation from ATR + recent swing structure.
 *
 * Volatility-time scaling: expected move = ATR * sqrt(horizonDays) * 1.2.
 * Snap to nearest recent 20-bar swing high/low if within ±15% of the
 * computed target — gives more realistic levels than pure math.
 *
 * Reject opportunities with riskReward < MIN_RR. The scanner caller
 * should drop those before returning to client.
 */

const MIN_RR = 1.5;
const SWING_LOOKBACK = 20;
const SWING_SNAP_TOLERANCE = 0.15; // ±15%

function recentSwing(candles, n = SWING_LOOKBACK) {
  if (!Array.isArray(candles) || candles.length < 5) return { high: null, low: null };
  const slice = candles.slice(-n);
  let high = -Infinity, low = Infinity;
  for (const bar of slice) {
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
  }
  return { high: Number.isFinite(high) ? high : null, low: Number.isFinite(low) ? low : null };
}

function snapToSwing(target, swing, direction) {
  if (!swing || target == null) return target;
  const candidate = direction === 'LONG' ? swing.high : swing.low;
  if (candidate == null) return target;
  const tolerance = Math.abs(target) * SWING_SNAP_TOLERANCE;
  if (Math.abs(candidate - target) <= tolerance) return candidate;
  return target;
}

/**
 * @param {Object} args
 * @param {number} args.currentPrice
 * @param {number} args.atr - ATR value
 * @param {Array}  args.candles - OHLCV bars for swing detection
 * @param {string} args.direction - 'LONG' | 'SHORT'
 * @param {number} args.horizonDays - 1..30
 * @returns {{ targetPrice, stopPrice, expectedMovePct, atrPct,
 *            riskReward, viable, reason }}
 */
function deriveTargets({ currentPrice, atr, candles, direction, horizonDays = 5 }) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { viable: false, reason: 'Invalid currentPrice' };
  }
  if (!Number.isFinite(atr) || atr <= 0) {
    return { viable: false, reason: 'Invalid ATR' };
  }

  const expectedMove = atr * Math.sqrt(horizonDays) * 1.2;
  const stopDistance = atr * 1.0;
  const swing = recentSwing(candles, SWING_LOOKBACK);

  let stopPrice;
  let atrTarget;
  if (direction === 'LONG') {
    atrTarget = currentPrice + expectedMove;
    stopPrice = currentPrice - stopDistance;
  } else {
    atrTarget = currentPrice - expectedMove;
    stopPrice = currentPrice + stopDistance;
  }

  // Snap to swing only if doing so keeps R:R >= MIN_RR. Otherwise stick with
  // the ATR-projected target — better to overshoot a level than to kill the
  // trade's R:R by snapping to a too-close structural level.
  const snapped = snapToSwing(atrTarget, swing, direction);
  const risk = Math.abs(currentPrice - stopPrice);
  const rrFor = (tgt) => (risk > 0 ? Math.abs(tgt - currentPrice) / risk : 0);
  const targetPrice = rrFor(snapped) >= MIN_RR ? snapped : atrTarget;

  const reward = Math.abs(targetPrice - currentPrice);
  const riskReward = risk > 0 ? reward / risk : 0;
  const expectedMovePct = (reward / currentPrice) * 100;
  const atrPct = (atr / currentPrice) * 100;

  const viable = riskReward >= MIN_RR;
  return {
    targetPrice,
    stopPrice,
    expectedMovePct,
    atrPct,
    riskReward,
    viable,
    reason: viable ? null : `R:R ${riskReward.toFixed(2)} below ${MIN_RR}`,
  };
}

module.exports = {
  deriveTargets,
  recentSwing,
  MIN_RR,
};
