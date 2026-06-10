// packages/quant-core/src/shannonEntropy.js
// Shannon entropy on log returns, used as a market-regime gate.
//
// High entropy (H near ln(N)) → chop / uncertainty → favor mean-reversion.
// Low entropy (H << ln(N))   → directional trend → favor momentum/breakout.
// Large ΔH/Δt                → regime transition → stand down.
//
// All pure functions. No I/O. Aligned with the rest of @keo/quant-core.

const DEFAULT_BINS = 20;

/**
 * Convert a series of closes into log returns r_i = ln(p_i / p_{i-1}).
 * Skips zero/negative prices. Returns an array of length closes.length - 1
 * (or shorter if there are gaps).
 */
function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

/**
 * Compute Shannon entropy H(X) = -Σ p_i · ln(p_i) on a returns sample using
 * histogram binning.
 *
 * For regime detection, the `range` parameter is critical: it must be the
 * SAME across windows being compared. Using each sample's own min/max would
 * make narrow-range trending and wide-range chaos look equally uniform.
 *
 * Recommended usage: derive `range` once from a long reference window's
 * standard deviation (e.g., ±4σ on the 252d sample), then apply it to all
 * shorter rolling windows. `rollingEntropy` and `entropySnapshot` do this
 * automatically.
 *
 * If `range` is omitted, falls back to a degenerate min/max-based binning
 * (useful only for one-off inspections, not for regime comparisons).
 *
 * @param {number[]} returns log-return sample
 * @param {number} bins number of histogram bins (default 20)
 * @param {{ min: number, max: number }} [range] fixed bin edges
 * @returns {number} entropy in nats, in [0, ln(bins)]
 */
function calculateShannonEntropy(returns, bins = DEFAULT_BINS, range) {
  if (!returns || returns.length < 2) return 0;

  let min;
  let max;
  if (
    range &&
    isFinite(range.min) &&
    isFinite(range.max) &&
    range.max > range.min
  ) {
    ({ min, max } = range);
  } else {
    // Fallback: sample min/max. Not appropriate for regime comparisons.
    min = Infinity;
    max = -Infinity;
    for (const r of returns) {
      if (r < min) min = r;
      if (r > max) max = r;
    }
    if (!isFinite(min) || !isFinite(max) || max === min) return 0;
  }

  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const r of returns) {
    let idx = Math.floor((r - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx]++;
  }

  const total = returns.length;
  let H = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    H -= p * Math.log(p);
  }
  return H;
}

/**
 * The maximum possible entropy for the bin count (uniform distribution).
 * Returns ln(bins).
 */
function maxEntropy(bins = DEFAULT_BINS) {
  return Math.log(bins);
}

/**
 * Computes a fixed bin range from a reference returns sample using ±sigmaSpan·σ
 * around the mean. This range is then used consistently across all rolling
 * windows so shorter windows can be compared against the long-term distribution.
 */
function _rangeFromReference(returns, sigmaSpan = 4) {
  if (!returns || returns.length < 2) return null;
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / returns.length;
  let sq = 0;
  for (const r of returns) sq += (r - mean) ** 2;
  const stdev = Math.sqrt(sq / returns.length);
  if (!isFinite(stdev) || stdev <= 0) return null;
  return { min: mean - sigmaSpan * stdev, max: mean + sigmaSpan * stdev };
}

/**
 * Rolling Shannon entropy over a fixed window of log returns. Returns an array
 * the same length as the input closes; entries before the first full window
 * are null.
 *
 * Bins are anchored to the FULL series volatility (±4σ) so the metric is
 * comparable across windows — narrow-range trending stretches get low H while
 * wide-range chaotic stretches get high H.
 *
 * @param {number[]} closes price series
 * @param {number} window window length (in bars)
 * @param {number} bins histogram bin count
 */
function rollingEntropy(closes, window, bins = DEFAULT_BINS) {
  if (!closes || closes.length < window + 1) {
    return new Array(closes ? closes.length : 0).fill(null);
  }
  const returns = logReturns(closes); // length closes.length - 1
  const range = _rangeFromReference(returns);
  const out = new Array(closes.length).fill(null);
  for (let i = window; i < closes.length; i++) {
    const slice = returns.slice(i - window, i);
    out[i] = calculateShannonEntropy(slice, bins, range);
  }
  return out;
}

/**
 * Multi-window entropy snapshot. Computes the latest H for each window using a
 * shared bin range derived from the LONGEST available window's volatility.
 *
 * @param {number[]} closes
 * @param {number[]} windows e.g. [21, 63, 252]
 * @param {number} bins
 * @returns {object} keyed by window: { 21: H, 63: H, 252: H }, plus `Hmax`
 */
function entropySnapshot(closes, windows = [21, 63, 252], bins = DEFAULT_BINS) {
  const out = { Hmax: maxEntropy(bins) };
  if (!closes || closes.length < 3) {
    for (const w of windows) out[w] = null;
    return out;
  }
  const allReturns = logReturns(closes);
  // Derive a shared range from the longest window we have data for. This is
  // what makes the per-window readings comparable.
  const maxWindow = Math.max(...windows);
  const refLen = Math.min(allReturns.length, maxWindow);
  const refSlice = allReturns.slice(-refLen);
  const range = _rangeFromReference(refSlice);

  for (const w of windows) {
    if (allReturns.length < w) {
      out[w] = null;
      continue;
    }
    const slice = allReturns.slice(-w);
    out[w] = calculateShannonEntropy(slice, bins, range);
  }
  return out;
}

/**
 * Classify the current market regime from a normalized entropy reading and
 * the rate of change between two consecutive readings.
 *
 * @param {number} H current entropy (nats)
 * @param {number} Hmax max possible entropy (ln bins)
 * @param {number} prevH previous entropy reading (for transition detection)
 * @param {object} opts thresholds
 * @returns {{ state: 'low-entropy'|'high-entropy'|'neutral'|'transitioning', confidence: number, normH: number, deltaH: number }}
 */
function classifyRegime(H, Hmax, prevH = null, opts = {}) {
  const lowCut = opts.lowCut ?? 0.65;
  const highCut = opts.highCut ?? 0.85;
  const transitionDelta = opts.transitionDelta ?? 0.08; // normalized H change

  if (!Hmax || !isFinite(H) || H < 0) {
    return { state: 'neutral', confidence: 0, normH: 0, deltaH: 0 };
  }

  // H = 0 is the most directional possible state — perfect clustering of returns.
  const normH = H / Hmax;
  const deltaH = prevH ? normH - prevH / Hmax : 0;

  if (Math.abs(deltaH) >= transitionDelta) {
    return {
      state: 'transitioning',
      confidence: Math.min(1, Math.abs(deltaH) / (transitionDelta * 2)),
      normH,
      deltaH,
    };
  }

  if (normH <= lowCut) {
    // Lower normH = more directional. Confidence scales toward 1 as normH → 0.
    return {
      state: 'low-entropy',
      confidence: Math.min(1, (lowCut - normH) / lowCut),
      normH,
      deltaH,
    };
  }
  if (normH >= highCut) {
    // Higher normH = more chaotic. Confidence scales toward 1 as normH → 1.
    return {
      state: 'high-entropy',
      confidence: Math.min(1, (normH - highCut) / (1 - highCut)),
      normH,
      deltaH,
    };
  }
  return { state: 'neutral', confidence: 0, normH, deltaH };
}

module.exports = {
  DEFAULT_BINS,
  logReturns,
  calculateShannonEntropy,
  maxEntropy,
  rollingEntropy,
  entropySnapshot,
  classifyRegime,
};
