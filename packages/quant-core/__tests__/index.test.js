import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
// Import via the workspace alias, NOT a relative path — this exercises
// the npm workspace resolution end-to-end. If `@keo/quant-core` ever
// fails to resolve (broken symlink, removed workspace), this test fails.
const quantCore = requireCjs('@keo/quant-core');
describe('@keo/quant-core: public surface', () => {
  it('re-exports tradingCalculations utilities', () => {
    expect(typeof quantCore.getEtfLeverage).toBe('function');
    expect(typeof quantCore.getOppositeEtf).toBe('function');
    expect(typeof quantCore.isMarketOpen).toBe('function');
    expect(typeof quantCore.calculateQuantity).toBe('function');
    expect(Array.isArray(quantCore.BULLISH_ETFS)).toBe(true);
    expect(Array.isArray(quantCore.BEARISH_ETFS)).toBe(true);
  });

  it('exposes ETF strategy and rules classes', () => {
    expect(typeof quantCore.LeveragedEtfStrategy).toBe('function');
    expect(typeof quantCore.LeveragedEtfRules).toBe('function');

    const strategy = new quantCore.LeveragedEtfStrategy();
    const rules = new quantCore.LeveragedEtfRules();
    expect(typeof strategy.getFamily).toBe('function');
    expect(typeof rules.applyConstraints).toBe('function');
  });

  it('basic facts hold via the package surface', () => {
    expect(quantCore.getEtfLeverage('SOXL')).toBe(3);
    expect(quantCore.getOppositeEtf('SOXL')).toBe('SOXS');
    expect(new quantCore.LeveragedEtfRules().isLeveraged('SOXL')).toBe(true);
    expect(new quantCore.LeveragedEtfRules().isLeveraged('AAPL')).toBe(false);
  });

  it('exposes RegimeDetector', () => {
    expect(typeof quantCore.RegimeDetector).toBe('function');
    const d = new quantCore.RegimeDetector();
    expect(typeof d.detectRegime).toBe('function');
    expect(typeof d.getDefaultConfigForRegime).toBe('function');
  });

  it('exposes indicators namespace', () => {
    expect(quantCore.indicators).toBeDefined();
    expect(typeof quantCore.indicators.calculateRSI).toBe('function');
    expect(typeof quantCore.indicators.calculateMACD).toBe('function');
    expect(typeof quantCore.indicators.calculateBollingerBands).toBe('function');
    expect(typeof quantCore.indicators.calculateATR).toBe('function');
    expect(typeof quantCore.indicators.calculateADX).toBe('function');
    expect(typeof quantCore.indicators.getAllIndicators).toBe('function');
  });
});
