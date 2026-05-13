import { describe, it, expect } from 'vitest';
import { deriveTargets, recentSwing, MIN_RR } from '../scanner/targetModel.js';

function syntheticCandles(prices) {
  return prices.map((p, i) => ({
    timestamp: 1700000000000 + i * 86400000,
    open: p,
    high: p * 1.01,
    low: p * 0.99,
    close: p,
    volume: 100000,
  }));
}

describe('targetModel.deriveTargets', () => {
  it('computes long target/stop sensibly', () => {
    const r = deriveTargets({
      currentPrice: 100,
      atr: 2.0,
      candles: syntheticCandles([95, 96, 97, 98, 99, 100]),
      direction: 'LONG',
      horizonDays: 5,
    });
    expect(r.viable).toBe(true);
    expect(r.targetPrice).toBeGreaterThan(100);
    expect(r.stopPrice).toBeLessThan(100);
    expect(r.riskReward).toBeGreaterThanOrEqual(MIN_RR);
  });

  it('mirrors logic for SHORT', () => {
    const r = deriveTargets({
      currentPrice: 100,
      atr: 2.0,
      candles: syntheticCandles([105, 104, 103, 102, 101, 100]),
      direction: 'SHORT',
      horizonDays: 5,
    });
    expect(r.viable).toBe(true);
    expect(r.targetPrice).toBeLessThan(100);
    expect(r.stopPrice).toBeGreaterThan(100);
  });

  it('rejects when R:R < MIN_RR', () => {
    // Tiny horizon → small expected move → R:R below threshold
    const r = deriveTargets({
      currentPrice: 100,
      atr: 5.0,
      candles: syntheticCandles([100, 100, 100]),
      direction: 'LONG',
      horizonDays: 1,
    });
    expect(r.viable).toBe(false);
    expect(r.reason).toMatch(/R:R/i);
  });

  it('returns viable=false on bad inputs', () => {
    expect(deriveTargets({ currentPrice: 0, atr: 2, candles: [], direction: 'LONG' }).viable).toBe(false);
    expect(deriveTargets({ currentPrice: 100, atr: 0, candles: [], direction: 'LONG' }).viable).toBe(false);
  });

  it('scales expected move with sqrt(horizon)', () => {
    const r1 = deriveTargets({ currentPrice: 100, atr: 2, candles: syntheticCandles([100, 100, 100, 100]), direction: 'LONG', horizonDays: 1 });
    const r5 = deriveTargets({ currentPrice: 100, atr: 2, candles: syntheticCandles([100, 100, 100, 100]), direction: 'LONG', horizonDays: 5 });
    // Move5 / Move1 should be ~sqrt(5) ≈ 2.24 (before any swing snap)
    expect(r5.expectedMovePct).toBeGreaterThan(r1.expectedMovePct);
  });
});

describe('targetModel.recentSwing', () => {
  it('finds high/low within window', () => {
    const swing = recentSwing(syntheticCandles([90, 95, 100, 110, 105, 102, 108]), 20);
    expect(swing.high).toBeGreaterThanOrEqual(110);
    expect(swing.low).toBeLessThanOrEqual(91);
  });

  it('handles empty arrays', () => {
    const swing = recentSwing([], 20);
    expect(swing.high).toBeNull();
    expect(swing.low).toBeNull();
  });
});
