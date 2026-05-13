/**
 * Probability model — log-odds ensemble producing a calibrated 0.40–0.85
 * probability for a directional move.
 *
 * Inputs are normalized per-component scores; outputs are sigmoid-clamped
 * to avoid bogus 95% confidence claims. Bias-free starting point (logit=0
 * means 50/50 coin flip).
 *
 * Components:
 *   1. signalScore   — from evaluateSymbolStateless (signalEvaluator), 0..1
 *   2. patternScore  — from patternRecognitionService BUY/SELL probability, 0..1
 *   3. rsiExtreme    — RSI<30 long edge, RSI>70 short edge
 *   4. bbBreakout    — price vs Bollinger Bands
 *   5. trendAlign    — short/medium-term trend direction
 *   6. divergence    — bullish/bearish RSI divergence
 *
 * The "direction" (LONG/SHORT) is decided by the sign of the summed logit.
 * If |logit| < 0.2 we report no edge (caller should drop the symbol).
 *
 * Future: calibrate weights via Brier score against historical trades in
 * server/abTestingEngine.js. Left as Phase-2 work.
 */

const PROB_MIN = 0.40;
const PROB_MAX = 0.85;
const EDGE_MIN_LOGIT = 0.2;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Compute probability + direction from indicators and per-source scores.
 *
 * @param {Object} args
 * @param {Object} args.indicators - getAllIndicators() output
 * @param {Object} args.signalEval - { confidence, shouldEnter } from
 *                                   evaluateSymbolStateless (confidence 0-95)
 * @param {Object} args.patternPred - { signal, confidence, probabilities }
 *                                    from predictPattern, or null
 * @returns {{ direction, probability, components, reasons, logit }}
 */
function computeProbability({ indicators, signalEval, patternPred }) {
  const reasons = [];
  const components = {};

  // 1. signalScore: confidence 50-95 → 0..0.7 (signalEvaluator only scores
  // LONG setups, so contribution is always non-negative). Confidence at the
  // floor (50, no signal) → 0 contribution. Direction comes from other
  // components if signal is muted.
  const sigConf = signalEval?.confidence ?? 50;
  const sigNorm = clamp((sigConf - 50) / 45, 0, 1); // 50→0, 95→1
  components.signal = sigNorm * 0.7;
  if (sigConf >= 70) reasons.push(`Signal confidence ${sigConf.toFixed(0)}%`);

  // 2. patternScore: BUY_SIGNAL prob favors long, SELL_SIGNAL prob favors short
  let patternBias = 0;
  if (patternPred?.probabilities) {
    const buyP = patternPred.probabilities.BUY_SIGNAL ?? 0;
    const sellP = patternPred.probabilities.SELL_SIGNAL ?? 0;
    // Normalize: positive logit = bullish
    patternBias = ((buyP - sellP) / 100); // diff in percentage points → -1..1
    components.pattern = patternBias * 1.2;
    if (Math.abs(patternBias) > 0.15) {
      reasons.push(`Pattern ${patternPred.signal || '—'} (${(buyP || sellP).toFixed(0)}%)`);
    }
  } else {
    components.pattern = 0;
  }

  // 3. rsiExtreme: RSI<30 = bullish reversal bias, RSI>70 = bearish
  const rsi = indicators?.rsi?.value;
  if (Number.isFinite(rsi)) {
    if (rsi < 25)       { components.rsiExtreme =  0.7; reasons.push(`RSI ${rsi.toFixed(1)} deeply oversold`); }
    else if (rsi < 35)  { components.rsiExtreme =  0.4; reasons.push(`RSI ${rsi.toFixed(1)} oversold`); }
    else if (rsi > 75)  { components.rsiExtreme = -0.7; reasons.push(`RSI ${rsi.toFixed(1)} deeply overbought`); }
    else if (rsi > 65)  { components.rsiExtreme = -0.4; reasons.push(`RSI ${rsi.toFixed(1)} overbought`); }
    else                { components.rsiExtreme =  0;   }
  } else {
    components.rsiExtreme = 0;
  }

  // 4. bbBreakout: percentB < 0.1 = at/below lower band = bullish edge
  const bbPct = indicators?.bollingerBands?.percentB;
  if (Number.isFinite(bbPct)) {
    if (bbPct < 0.1)      { components.bbBreakout =  0.5; reasons.push(`BB %B ${(bbPct*100).toFixed(0)}% — at lower band`); }
    else if (bbPct < 0.2) { components.bbBreakout =  0.25; }
    else if (bbPct > 0.9) { components.bbBreakout = -0.5; reasons.push(`BB %B ${(bbPct*100).toFixed(0)}% — at upper band`); }
    else if (bbPct > 0.8) { components.bbBreakout = -0.25; }
    else                  { components.bbBreakout =  0;    }
  } else {
    components.bbBreakout = 0;
  }

  // 5. trendAlign: short/medium-term trend agreement
  const stTrend = indicators?.trend?.shortTerm;
  const mtTrend = indicators?.trend?.mediumTerm;
  let trendBias = 0;
  if (stTrend === 'bullish') trendBias += 0.25;
  if (stTrend === 'bearish') trendBias -= 0.25;
  if (mtTrend === 'bullish') trendBias += 0.15;
  if (mtTrend === 'bearish') trendBias -= 0.15;
  components.trendAlign = trendBias;
  if (Math.abs(trendBias) >= 0.35) {
    reasons.push(`Trend aligned ${trendBias > 0 ? 'bullish' : 'bearish'}`);
  }

  // 6. divergence
  let divBias = 0;
  if (indicators?.rsi?.divergence?.bullish) { divBias =  0.5; reasons.push('Bullish RSI divergence'); }
  if (indicators?.rsi?.divergence?.bearish) { divBias = -0.5; reasons.push('Bearish RSI divergence'); }
  components.divergence = divBias;

  // Sum logits
  const logit = Object.values(components).reduce((a, b) => a + b, 0);
  const direction = logit >= 0 ? 'LONG' : 'SHORT';
  const probabilityRaw = sigmoid(Math.abs(logit));
  const probability = clamp(probabilityRaw, PROB_MIN, PROB_MAX);

  const hasEdge = Math.abs(logit) >= EDGE_MIN_LOGIT;

  return {
    direction,
    probability,
    logit,
    hasEdge,
    components,
    reasons,
  };
}

module.exports = {
  computeProbability,
  PROB_MIN,
  PROB_MAX,
  EDGE_MIN_LOGIT,
};
