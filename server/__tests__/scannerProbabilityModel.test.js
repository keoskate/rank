import { describe, it, expect } from 'vitest';
import { computeProbability, PROB_MIN, PROB_MAX, EDGE_MIN_LOGIT } from '../scanner/probabilityModel.js';

function makeIndicators({ rsi = 50, bbPercentB = 0.5, trendShort = null, trendMed = null, divBull = false, divBear = false } = {}) {
  return {
    rsi: { value: rsi, divergence: { bullish: divBull, bearish: divBear } },
    bollingerBands: { percentB: bbPercentB },
    trend: { shortTerm: trendShort, mediumTerm: trendMed },
  };
}

describe('probabilityModel.computeProbability', () => {
  it('returns 50/50 with neutral inputs', () => {
    const r = computeProbability({
      indicators: makeIndicators(),
      signalEval: { confidence: 50 },
      patternPred: null,
    });
    expect(r.probability).toBeGreaterThanOrEqual(PROB_MIN);
    expect(r.probability).toBeLessThanOrEqual(PROB_MAX);
    expect(r.hasEdge).toBe(false);
  });

  it('clamps probability inside [PROB_MIN, PROB_MAX]', () => {
    // Maximal bullish setup
    const r = computeProbability({
      indicators: makeIndicators({ rsi: 20, bbPercentB: 0.05, trendShort: 'bullish', trendMed: 'bullish', divBull: true }),
      signalEval: { confidence: 95 },
      patternPred: { signal: 'BUY_SIGNAL', confidence: 90, probabilities: { BUY_SIGNAL: 90, SELL_SIGNAL: 5 } },
    });
    expect(r.probability).toBeLessThanOrEqual(PROB_MAX);
    expect(r.probability).toBeGreaterThanOrEqual(PROB_MIN);
    expect(r.direction).toBe('LONG');
  });

  it('picks SHORT direction when logits trend bearish', () => {
    const r = computeProbability({
      indicators: makeIndicators({ rsi: 80, bbPercentB: 0.95, trendShort: 'bearish' }),
      signalEval: { confidence: 50 },
      patternPred: { signal: 'SELL_SIGNAL', confidence: 80, probabilities: { BUY_SIGNAL: 10, SELL_SIGNAL: 80 } },
    });
    expect(r.direction).toBe('SHORT');
    expect(r.hasEdge).toBe(true);
  });

  it('flags no edge when |logit| < EDGE_MIN_LOGIT', () => {
    const r = computeProbability({
      indicators: makeIndicators({ rsi: 50, bbPercentB: 0.5 }),
      signalEval: { confidence: 52 },
      patternPred: null,
    });
    expect(Math.abs(r.logit)).toBeLessThan(EDGE_MIN_LOGIT);
    expect(r.hasEdge).toBe(false);
  });

  it('produces reasons list on extreme RSI', () => {
    const r = computeProbability({
      indicators: makeIndicators({ rsi: 22 }),
      signalEval: { confidence: 50 },
      patternPred: null,
    });
    expect(r.reasons.some(s => /oversold/i.test(s))).toBe(true);
  });

  it('handles missing indicators gracefully', () => {
    const r = computeProbability({
      indicators: { rsi: { value: NaN }, bollingerBands: {}, trend: {} },
      signalEval: { confidence: 50 },
      patternPred: null,
    });
    expect(r.probability).toBeGreaterThanOrEqual(PROB_MIN);
  });
});
