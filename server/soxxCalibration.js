/**
 * SOXX predictor calibration (Phase B) — maps a raw model probability to an
 * empirically-grounded one using the realized track record, so displayed
 * confidence reflects how often calls at that confidence actually hit (no bogus
 * 95%). Pure JS (no ML libs), in the spirit of kellySizing's Bayesian-prior +
 * Laplace shrink. At N=0 it returns the raw prior unchanged; it only moves the
 * number as evaluated outcomes accrue. Shared by the hourly + daily predictors.
 */

const { probUp } = require('./soxxPredictorCore');

// Calibration history from evaluated predictions: each contributes the model's
// probUp at prediction time and whether the horizon actually resolved up.
function historyFrom(preds) {
  return (preds || [])
    .filter(p => p.evaluated && Number.isFinite(p.realizedReturn) && p.prediction)
    .map(p => ({ prob: probUp(p.prediction), up: p.realizedReturn > 0 ? 1 : 0 }));
}

/**
 * Calibrated P(up) for a raw model probUp: the empirical hit-rate among nearby
 * historical calls, Bayesian-shrunk toward the raw value with pseudocount k (so a
 * thin record barely moves it, a thick one dominates). Clamped away from 0/1.
 * @param {number} rawProbUp
 * @param {Array<{prob:number, up:number}>} history
 * @param {{k?:number, window?:number}} [opts]
 */
function calibrateProb(rawProbUp, history, { k = 10, window = 0.1 } = {}) {
  const r = Number.isFinite(rawProbUp) ? Math.max(0, Math.min(1, rawProbUp)) : 0.5;
  if (!Array.isArray(history) || history.length === 0) return r;
  const near = history.filter(h => Math.abs(h.prob - r) <= window);
  const n = near.length;
  const ups = near.reduce((a, h) => a + (h.up ? 1 : 0), 0);
  const cal = (ups + k * r) / (n + k); // shrink empirical rate toward the raw prior
  return Math.max(0.02, Math.min(0.98, cal));
}

// Reliability curve: bin by predicted prob, report predicted vs actual per bin
// (the diagonal = perfectly calibrated). For the card's calibration display.
function reliability(history, bins = 5) {
  const out = [];
  if (!Array.isArray(history)) return out;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const inBin = history.filter(h => h.prob >= lo && (i === bins - 1 ? h.prob <= hi : h.prob < hi));
    if (!inBin.length) continue;
    out.push({
      lo,
      hi,
      n: inBin.length,
      predicted: inBin.reduce((a, h) => a + h.prob, 0) / inBin.length,
      actual: inBin.reduce((a, h) => a + h.up, 0) / inBin.length,
    });
  }
  return out;
}

// Mean Brier score of a history's raw probs (baseline to compare calibration against).
function brier(history) {
  if (!Array.isArray(history) || !history.length) return null;
  return history.reduce((a, h) => a + (h.prob - h.up) ** 2, 0) / history.length;
}

module.exports = { historyFrom, calibrateProb, reliability, brier };
