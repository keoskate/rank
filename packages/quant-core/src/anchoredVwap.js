// packages/quant-core/src/anchoredVwap.js
//
// Anchored VWAP — cumulative volume-weighted average price from a chosen
// anchor bar forward. THE one VWAP-aggregation definition shared by:
//   - the AVWAP trend-filter research trials (daily bars), and
//   - the execution benchmark in scripts/monitorExecutionFaithfulness.js
//     (fill-vs-VWAP residuals over minute bars).
// One definition, one module — live, benchmark and backtest can never
// diverge on what "the VWAP from X to Y" means.
//
// Per-bar price: Alpaca minute bars carry a true trade-weighted per-bar vwap
// (bar.vw, stored as `vwap` by loadMinuteBars); prefer it when present and
// positive. Daily-bar caches have no vw field, so fall back to HLC/3 — the
// standard typical-price approximation. Zero/negative-volume bars contribute
// no weight.
//
// This is distinct from technicalIndicatorsService.calculateVWAP, which is
// the per-ET-session-resetting intraday VWAP guarding the live `belowVwap`
// gate. Anchored VWAP never resets — that is its point.

/** Default per-bar price: per-bar vwap when present, else typical price. */
function barPrice(b) {
  const vw = Number(b.vwap);
  if (Number.isFinite(vw) && vw > 0) return vw;
  return (Number(b.high) + Number(b.low) + Number(b.close)) / 3;
}

/**
 * Volume-weighted average of `price(bar)` over bars[startIdx..endIdx]
 * (inclusive). Returns null when the range is empty/invalid or carries no
 * volume. This is the primitive the execution benchmark uses for
 * VWAP(fillTime → close).
 *
 * @param {object[]} bars - chronological bars with {high, low, close, volume[, vwap]}
 * @param {number} startIdx
 * @param {number} endIdx
 * @param {object} [opts] { price: bar => number }
 * @returns {number|null}
 */
function vwapBetween(bars, startIdx, endIdx, opts = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  const price = opts.price || barPrice;
  const a = Math.max(0, startIdx);
  const b = Math.min(bars.length - 1, endIdx);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return null;
  let pv = 0;
  let vol = 0;
  for (let i = a; i <= b; i++) {
    const v = Number(bars[i].volume);
    if (!Number.isFinite(v) || v <= 0) continue;
    const p = price(bars[i]);
    if (!Number.isFinite(p)) continue;
    pv += p * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : null;
}

/**
 * Anchored VWAP series: out[i] = vwap of bars[anchorIdx..i] for i >= anchorIdx,
 * null before the anchor. Aligned 1:1 with input. O(n) cumulative.
 *
 * @param {object[]} bars - chronological
 * @param {number} anchorIdx
 * @param {object} [opts] { price: bar => number }
 * @returns {(number|null)[]}
 */
function anchoredVwapSeries(bars, anchorIdx, opts = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const price = opts.price || barPrice;
  const out = new Array(bars.length).fill(null);
  if (
    !Number.isInteger(anchorIdx) ||
    anchorIdx < 0 ||
    anchorIdx >= bars.length
  ) {
    return out;
  }
  let pv = 0;
  let vol = 0;
  for (let i = anchorIdx; i < bars.length; i++) {
    const v = Number(bars[i].volume);
    const p = price(bars[i]);
    if (Number.isFinite(v) && v > 0 && Number.isFinite(p)) {
      pv += p * v;
      vol += v;
    }
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

/** Calendar year of a bar, tolerant of {date:'YYYY-MM-DD'} or epoch fields. */
function _barYear(b) {
  if (typeof b.date === 'string' && b.date.length >= 4) {
    return b.date.slice(0, 4);
  }
  const t = b.timestamp ?? b.time ?? b.t ?? null;
  if (t == null) return null;
  return String(new Date(t).getUTCFullYear());
}

/**
 * Resolve an anchor index by policy:
 *   'high252'   — index of the highest close within the trailing 252 bars
 *                 (institutional convention: anchor to the recent major high).
 *   'yearStart' — first bar of the last bar's calendar year.
 * Returns -1 when not computable (empty input / unknown policy / no dates).
 *
 * @param {object[]} bars - chronological
 * @param {'high252'|'yearStart'} policy
 * @returns {number}
 */
function anchorIndex(bars, policy) {
  if (!Array.isArray(bars) || bars.length === 0) return -1;
  if (policy === 'high252') {
    const start = Math.max(0, bars.length - 252);
    let best = -1;
    let bestClose = -Infinity;
    for (let i = start; i < bars.length; i++) {
      const c = Number(bars[i].close);
      if (Number.isFinite(c) && c > bestClose) {
        bestClose = c;
        best = i;
      }
    }
    return best;
  }
  if (policy === 'yearStart') {
    const lastYear = _barYear(bars[bars.length - 1]);
    if (lastYear == null) return -1;
    for (let i = 0; i < bars.length; i++) {
      if (_barYear(bars[i]) === lastYear) return i;
    }
    return -1;
  }
  return -1;
}

module.exports = { barPrice, vwapBetween, anchoredVwapSeries, anchorIndex };
