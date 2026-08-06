import { describe, it, expect } from 'vitest';
import { historyFrom, calibrateProb, reliability, brier } from '../soxxCalibration.js';

describe('soxxCalibration', () => {
  describe('calibrateProb', () => {
    it('returns the raw prior unchanged when there is no history (N=0)', () => {
      expect(calibrateProb(0.6, [])).toBe(0.6);
      expect(calibrateProb(0.42, null)).toBe(0.42);
    });

    it('pulls toward the empirical hit-rate, Bayesian-shrunk by pseudocount k', () => {
      // 20 nearby calls at 0.6, all resolved up → (20 + 10*0.6)/(20+10) = 0.8667
      const hist = Array.from({ length: 20 }, () => ({ prob: 0.6, up: 1 }));
      expect(calibrateProb(0.6, hist, { k: 10, window: 0.1 })).toBeCloseTo(26 / 30, 6);
    });

    it('shrinks less as the record thickens', () => {
      const thin = Array.from({ length: 4 }, () => ({ prob: 0.6, up: 1 }));
      const thick = Array.from({ length: 100 }, () => ({ prob: 0.6, up: 1 }));
      const cThin = calibrateProb(0.6, thin, { k: 10 });
      const cThick = calibrateProb(0.6, thick, { k: 10 });
      expect(cThick).toBeGreaterThan(cThin); // more evidence → closer to the empirical 1.0
    });

    it('ignores calls outside the neighborhood window', () => {
      // history all at 0.9 (far from 0.5) → no nearby samples → returns the raw prior
      const far = Array.from({ length: 30 }, () => ({ prob: 0.9, up: 1 }));
      expect(calibrateProb(0.5, far, { window: 0.1 })).toBe(0.5);
    });

    it('clamps away from 0 and 1 once calibration engages', () => {
      const allUpHigh = Array.from({ length: 200 }, () => ({ prob: 0.9, up: 1 }));
      expect(calibrateProb(0.9, allUpHigh, { k: 10 })).toBeLessThanOrEqual(0.98);
      const allDownLow = Array.from({ length: 200 }, () => ({ prob: 0.1, up: 0 }));
      expect(calibrateProb(0.1, allDownLow, { k: 10 })).toBeGreaterThanOrEqual(0.02);
    });
  });

  describe('brier', () => {
    it('is the mean squared error of prob vs outcome', () => {
      expect(brier([{ prob: 0.6, up: 1 }, { prob: 0.4, up: 0 }])).toBeCloseTo(0.16, 6);
    });
    it('is null for an empty history', () => {
      expect(brier([])).toBeNull();
    });
  });

  describe('reliability', () => {
    it('bins predicted vs actual', () => {
      const hist = [
        { prob: 0.1, up: 0 },
        { prob: 0.15, up: 0 },
        { prob: 0.85, up: 1 },
        { prob: 0.9, up: 1 },
      ];
      const bins = reliability(hist, 5);
      const low = bins.find(b => b.lo === 0);
      const high = bins.find(b => b.lo === 0.8);
      expect(low.n).toBe(2);
      expect(low.actual).toBe(0);
      expect(high.n).toBe(2);
      expect(high.actual).toBe(1);
    });
  });

  describe('historyFrom', () => {
    it('keeps only evaluated calls and maps to {prob, up}', () => {
      const preds = [
        { evaluated: true, realizedReturn: 0.5, prediction: { direction: 'bullish', probability: 0.6 } },
        { evaluated: true, realizedReturn: -0.3, prediction: { direction: 'bearish', probability: 0.7 } },
        { evaluated: false, prediction: { direction: 'bullish', probability: 0.6 } }, // dropped
      ];
      const h = historyFrom(preds);
      expect(h).toHaveLength(2);
      expect(h[0]).toEqual({ prob: 0.6, up: 1 }); // bullish 0.6 → probUp 0.6, up
      expect(h[1]).toEqual({ prob: 1 - 0.7, up: 0 }); // bearish 0.7 → probUp 0.3, down
    });
  });
});
