/**
 * SOXX next-1-hour predictor — PURE, deterministic core (shared by the live loop
 * and any replay/backtest). Given a feature snapshot, returns a direction, a
 * calibrated probability, and a recommended action.
 *
 * V1 wraps the existing heuristic sentiment read (direction + confidence) — the
 * honest starting point: we're testing whether the current SOXX read predicts
 * the NEXT hour. The forward-test record will tell us if it does, and Phases B/C
 * calibrate the probability + learn feature weights from that record.
 *
 * Kept pure (no I/O) so it's faithfully re-runnable over historical snapshots.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Map a 0–100 heuristic confidence to a probability, clamped so we never assert
// a bogus 95%. (Phase B replaces this with the empirical hit-rate calibration.)
function confidenceToProb(confidence) {
  const c = Number.isFinite(confidence) ? confidence : 50;
  return clamp(c / 100, 0.4, 0.85);
}

/**
 * @param {object} features - from server/soxxFeatures.assembleFeatures()
 * @param {object} [model]  - reserved for the learned model (Phase C); ignored in V1
 * @returns {{ direction:'bullish'|'bearish'|'neutral', probability:number, action:'SOXL'|'SOXS'|'CASH', basis:string }}
 */
function predict(features, model = null) {
  const dir = features && features.sentDirection ? features.sentDirection : 'neutral';
  const probability = confidenceToProb(features && features.sentConfidence);

  // Action: back the direction only when the probability clears a bar; else CASH.
  let action = 'CASH';
  if (probability >= 0.55) {
    if (dir === 'bullish') action = 'SOXL';
    else if (dir === 'bearish') action = 'SOXS';
  }

  return { direction: dir, probability, action, basis: model ? 'model' : 'heuristic-v1' };
}

// P(SOXX up next hour) implied by a prediction — for Brier/log-loss scoring.
function probUp(prediction) {
  if (!prediction) return 0.5;
  if (prediction.direction === 'bullish') return prediction.probability;
  if (prediction.direction === 'bearish') return 1 - prediction.probability;
  return 0.5;
}

module.exports = { predict, probUp, confidenceToProb };
