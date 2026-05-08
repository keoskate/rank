/**
 * Opening Range helpers for the ORB (Opening Range Breakout) entry strategy.
 *
 * Pure functions, no state. The opening range for a given ET date is
 * recomputed from the candle history each time evaluateEntry runs — cheap
 * (<1ms over 100 candles) and avoids any cache-invalidation problems.
 *
 * Definitions:
 *   - Opening range window: 9:30–9:45 ET (first 15 minutes after open)
 *   - Entry window:         9:45–11:30 ET (after range is finalized)
 *   - Range minimum bars:   2  (≥10 minutes of data required to be valid)
 */

const OR_WINDOW_START = 9.5;     // 9:30 ET
const OR_WINDOW_END = 9.75;      // 9:45 ET
const ENTRY_WINDOW_END = 11.5;   // 11:30 ET
const MIN_OR_BARS = 2;           // require ≥10min of bars in the OR window

function isDST(date) {
  const m = date.getUTCMonth();
  return m >= 2 && m <= 10;
}

function etTimeDecimal(date) {
  const offset = isDST(date) ? -4 : -5;
  let etH = date.getUTCHours() + offset;
  if (etH < 0) etH += 24;
  if (etH >= 24) etH -= 24;
  return etH + date.getUTCMinutes() / 60;
}

function etDateString(date) {
  const offset = isDST(date) ? -4 : -5;
  const shifted = new Date(date.getTime() + offset * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function computeOpeningRange(candles, asOfDate = new Date()) {
  const targetDate = etDateString(asOfDate);
  const orBars = [];
  for (const c of candles) {
    const ts = c.timestamp;
    if (typeof ts !== 'number') continue;
    const d = new Date(ts);
    if (etDateString(d) !== targetDate) continue;
    const t = etTimeDecimal(d);
    if (t >= OR_WINDOW_START && t < OR_WINDOW_END) orBars.push(c);
  }
  if (orBars.length < MIN_OR_BARS) {
    return { high: null, low: null, finalized: false, barCount: orBars.length };
  }
  const high = Math.max(...orBars.map(c => c.high));
  const low = Math.min(...orBars.map(c => c.low));
  const nowET = etTimeDecimal(asOfDate);
  return {
    high,
    low,
    height: high - low,
    finalized: nowET >= OR_WINDOW_END,
    barCount: orBars.length,
  };
}

function isInEntryWindow(date = new Date()) {
  const t = etTimeDecimal(date);
  return t >= OR_WINDOW_END && t < ENTRY_WINDOW_END;
}

function getStrategyTargets({ currentPrice, range, direction, fixedStopPct = 1.5, fixedTpPct = 3.0 }) {
  if (direction === 'long') {
    const fixedStop = currentPrice * (1 - fixedStopPct / 100);
    const rangeStop = range.low * 0.999;
    const stopLoss = Math.max(fixedStop, rangeStop);
    const fixedTp = currentPrice * (1 + fixedTpPct / 100);
    const rangeTp = currentPrice + range.height * 2;
    const profitTarget = Math.max(fixedTp, rangeTp);
    return { stopLoss, profitTarget };
  }
  const fixedStop = currentPrice * (1 + fixedStopPct / 100);
  const rangeStop = range.high * 1.001;
  const stopLoss = Math.min(fixedStop, rangeStop);
  const fixedTp = currentPrice * (1 - fixedTpPct / 100);
  const rangeTp = currentPrice - range.height * 2;
  const profitTarget = Math.min(fixedTp, rangeTp);
  return { stopLoss, profitTarget };
}

module.exports = {
  computeOpeningRange,
  isInEntryWindow,
  getStrategyTargets,
  etTimeDecimal,
  etDateString,
  OR_WINDOW_START,
  OR_WINDOW_END,
  ENTRY_WINDOW_END,
  MIN_OR_BARS,
};
