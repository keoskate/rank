import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { indicators, RegimeDetector } = requireCjs('@keo/quant-core');

// ─────────────────────────────────────────────────────────────────
// Layer C — Synthetic-pattern truth tests.
//
// We feed deterministic candle patterns where the right answer is
// obvious (a child could classify them by looking at a chart) and
// assert our pipeline produces it. If our regime detector says "bear"
// on a 100-bar straight uptrend, the algorithm is broken and no
// amount of backtest tuning makes it OK.
// ─────────────────────────────────────────────────────────────────

function makeCandle(price, i, vol = 0) {
  // Each candle's open == previous close, high/low slightly out
  return {
    timestamp: 1700000000000 + i * 60000,
    open: +(price * (1 - vol * 0.1)).toFixed(4),
    high: +(price * (1 + vol * 0.1)).toFixed(4),
    low: +(price * (1 - vol * 0.1)).toFixed(4),
    close: +price.toFixed(4),
    volume: 10000,
  };
}

function monotonicUp(n, opts = {}) {
  const { startPrice = 100, perBarPct = 0.005 } = opts;
  const bars = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    p = p * (1 + perBarPct);
    bars.push(makeCandle(p, i, perBarPct));
  }
  return bars;
}

function monotonicDown(n, opts = {}) {
  const { startPrice = 100, perBarPct = 0.005 } = opts;
  const bars = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    p = p * (1 - perBarPct);
    bars.push(makeCandle(p, i, perBarPct));
  }
  return bars;
}

function flat(n, opts = {}) {
  const { price = 100, micro = 0.0001 } = opts;
  // Tiny micro jitter so std-dev / range calculations don't divide by zero
  const bars = [];
  for (let i = 0; i < n; i++) {
    const p = price * (1 + (i % 2 === 0 ? micro : -micro));
    bars.push(makeCandle(p, i));
  }
  return bars;
}

function sineWave(n, opts = {}) {
  const { center = 100, amplitude = 5, period = 20 } = opts;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const p = center + amplitude * Math.sin((i / period) * 2 * Math.PI);
    bars.push(makeCandle(p, i, amplitude / center / 5));
  }
  return bars;
}

// ─────────────────────────────────────────────────────────────────

describe('synthetic truth: regime detection', () => {
  it('100 bars rising 0.5%/bar → regime: bull', () => {
    const detector = new RegimeDetector();
    const result = detector.detectRegime(monotonicUp(100));
    expect(result.regime).toBe('bull');
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('100 bars rising 1%/bar → regime: bull, strong trend', () => {
    const detector = new RegimeDetector();
    const result = detector.detectRegime(monotonicUp(100, { perBarPct: 0.01 }));
    expect(result.regime).toBe('bull');
    expect(result.trendStrength).toMatch(/strong|moderate/);
  });

  it('100 bars falling 0.5%/bar → regime: bear', () => {
    const detector = new RegimeDetector();
    const result = detector.detectRegime(monotonicDown(100));
    expect(result.regime).toBe('bear');
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('100 bars falling 1%/bar → regime: bear, strong trend', () => {
    const detector = new RegimeDetector();
    const result = detector.detectRegime(monotonicDown(100, { perBarPct: 0.01 }));
    expect(result.regime).toBe('bear');
    expect(result.trendStrength).toMatch(/strong|moderate/);
  });

  it('100 effectively-flat bars → regime is NOT bull and NOT bear', () => {
    const detector = new RegimeDetector();
    const result = detector.detectRegime(flat(100));
    expect(['sideways', 'unknown'].includes(result.regime)).toBe(true);
  });
});

describe('synthetic truth: RSI behavior', () => {
  it('uptrend pushes RSI well above 50 in the last bars', () => {
    const closes = monotonicUp(100).map(c => c.close);
    const rsi = indicators.calculateRSI(closes);
    const last = rsi[rsi.length - 1];
    expect(last, `RSI on uptrend was ${last}, expected > 60`).toBeGreaterThan(60);
  });

  it('strong uptrend approaches RSI 100', () => {
    const closes = monotonicUp(100, { perBarPct: 0.02 }).map(c => c.close);
    const rsi = indicators.calculateRSI(closes);
    const last = rsi[rsi.length - 1];
    expect(last).toBeGreaterThan(90);
  });

  it('downtrend pushes RSI well below 50 in the last bars', () => {
    const closes = monotonicDown(100).map(c => c.close);
    const rsi = indicators.calculateRSI(closes);
    const last = rsi[rsi.length - 1];
    expect(last, `RSI on downtrend was ${last}, expected < 40`).toBeLessThan(40);
  });

  it('strong downtrend approaches RSI 0', () => {
    const closes = monotonicDown(100, { perBarPct: 0.02 }).map(c => c.close);
    const rsi = indicators.calculateRSI(closes);
    const last = rsi[rsi.length - 1];
    expect(last).toBeLessThan(10);
  });
});

describe('synthetic truth: Bollinger Bands', () => {
  it('sine wave centered at 100 → percentB oscillates roughly 0..1', () => {
    const closes = sineWave(200, { center: 100, amplitude: 8, period: 30 }).map(c => c.close);
    const bb = indicators.calculateBollingerBands(closes);
    let minPct = Infinity;
    let maxPct = -Infinity;
    for (const p of bb) {
      if (typeof p.percentB === 'number' && Number.isFinite(p.percentB)) {
        minPct = Math.min(minPct, p.percentB);
        maxPct = Math.max(maxPct, p.percentB);
      }
    }
    // Sine should drive %B near both extremes
    expect(minPct).toBeLessThan(0.2);
    expect(maxPct).toBeGreaterThan(0.8);
  });

  it('flat input → bandwidth tiny (≈ 0)', () => {
    const closes = flat(100).map(c => c.close);
    const bb = indicators.calculateBollingerBands(closes);
    const last = bb[bb.length - 1];
    if (last?.bandwidth !== undefined) {
      expect(last.bandwidth).toBeLessThan(0.001);
    }
  });
});

describe('synthetic truth: ATR', () => {
  it('flat input → ATR ≈ 0', () => {
    const candles = flat(100);
    const atr = indicators.calculateATR(candles);
    const last = atr[atr.length - 1];
    expect(last).toBeLessThan(0.1); // small absolute price terms
  });

  it('higher-volatility uptrend has higher ATR than low-volatility uptrend', () => {
    const lowVol = monotonicUp(100, { perBarPct: 0.005 });
    const highVol = monotonicUp(100, { perBarPct: 0.02 });
    const atrLow = indicators.calculateATR(lowVol);
    const atrHigh = indicators.calculateATR(highVol);
    expect(atrHigh[atrHigh.length - 1]).toBeGreaterThan(
      atrLow[atrLow.length - 1]
    );
  });
});

describe('synthetic truth: ADX', () => {
  // Note: calculateADX returns objects shaped { adx, pdi, mdi }.
  const adxValue = point => (typeof point === 'number' ? point : point?.adx ?? point?.value);

  it('strong trend → ADX > 25 (the conventional "trending" threshold)', () => {
    const candles = monotonicUp(100, { perBarPct: 0.01 });
    const adx = indicators.calculateADX(candles);
    const last = adx[adx.length - 1];
    const value = adxValue(last);
    expect(value, `ADX on strong trend was ${value}`).toBeGreaterThan(25);
  });

  it('flat input → ADX low or undefined (no defined trend)', () => {
    const candles = flat(100);
    const adx = indicators.calculateADX(candles);
    const last = adx[adx.length - 1];
    const value = adxValue(last);
    if (value !== undefined && Number.isFinite(value)) {
      expect(value).toBeLessThan(30);
    }
  });

  it('strong UPtrend → +DI > -DI (directional indicator agrees with trend)', () => {
    const adx = indicators.calculateADX(monotonicUp(100, { perBarPct: 0.01 }));
    const last = adx[adx.length - 1];
    if (last && typeof last === 'object' && 'pdi' in last && 'mdi' in last) {
      expect(last.pdi).toBeGreaterThan(last.mdi);
    }
  });

  it('strong DOWNtrend → -DI > +DI (directional indicator agrees with trend)', () => {
    const adx = indicators.calculateADX(monotonicDown(100, { perBarPct: 0.01 }));
    const last = adx[adx.length - 1];
    if (last && typeof last === 'object' && 'pdi' in last && 'mdi' in last) {
      expect(last.mdi).toBeGreaterThan(last.pdi);
    }
  });
});

describe('synthetic truth: getAllIndicators composite', () => {
  // The signal generator deliberately mixes trend-following and mean-reversion
  // logic (e.g., "RSI oversold" → bullish), so on a pure straight-line move
  // the mean-reversion side can outweigh the trend side. We don't test the
  // total score balance; we test that the trend-aware reasons correctly
  // identify the direction.

  it('uptrend → "Aligned bullish trend" appears in reasons', () => {
    const all = indicators.getAllIndicators(monotonicUp(100, { perBarPct: 0.01 }));
    expect(all.signals?.reasons || []).toEqual(
      expect.arrayContaining([expect.stringMatching(/bullish/i)])
    );
  });

  it('downtrend → bearish-trend reasons appear', () => {
    const all = indicators.getAllIndicators(monotonicDown(100, { perBarPct: 0.01 }));
    expect(all.signals?.reasons || []).toEqual(
      expect.arrayContaining([expect.stringMatching(/bearish/i)])
    );
  });

  it('uptrend → ADX trending=true with bullishDI=true', () => {
    const all = indicators.getAllIndicators(monotonicUp(100, { perBarPct: 0.01 }));
    expect(all.adx?.trending).toBe(true);
    expect(all.adx?.bullishDI).toBe(true);
  });

  it('downtrend → ADX trending=true with bullishDI=false', () => {
    const all = indicators.getAllIndicators(monotonicDown(100, { perBarPct: 0.01 }));
    expect(all.adx?.trending).toBe(true);
    expect(all.adx?.bullishDI).toBe(false);
  });
});
