import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { indicators, RegimeDetector, getEtfLeverage, calculateQuantity } =
  requireCjs('@keo/quant-core');

// ─────────────────────────────────────────────────────────────────
// Layer A — Math invariants.
//
// These assert facts that must hold no matter what the input is.
// If any of these fails, the system is computing wrong, full stop.
// We exercise each with many seeded random sequences plus a few
// deliberately adversarial inputs.
// ─────────────────────────────────────────────────────────────────

// Linear congruential generator — deterministic per seed so failures
// reproduce without external deps.
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Generate candles from a seeded random walk. Caller can dial
// `volatility` (per-bar pct), `drift` (per-bar pct), and `startPrice`.
function genCandles(n, seed, opts = {}) {
  const { startPrice = 100, drift = 0, volatility = 0.01 } = opts;
  const rand = seededRandom(seed);
  const bars = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const shock = (rand() - 0.5) * 2 * volatility;
    const close = Math.max(0.01, price * (1 + drift + shock));
    const open = i === 0 ? close : bars[i - 1].close;
    const high = Math.max(open, close) * (1 + rand() * volatility * 0.3);
    const low = Math.min(open, close) * (1 - rand() * volatility * 0.3);
    const volume = Math.round(10000 + rand() * 50000);
    bars.push({
      timestamp: 1700000000000 + i * 60000,
      open: +open.toFixed(4),
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      close: +close.toFixed(4),
      volume,
    });
    price = close;
  }
  return bars;
}

// Convenience — run a body across N seeded scenarios.
function forEachScenario(count, opts, body) {
  for (let seed = 1; seed <= count; seed++) {
    body(genCandles(opts.bars || 100, seed, opts), seed);
  }
}

describe('invariants: RSI', () => {
  it('values are always in [0, 100] across 50 random scenarios', () => {
    forEachScenario(50, { bars: 100, volatility: 0.02 }, candles => {
      const closes = candles.map(c => c.close);
      const values = indicators.calculateRSI(closes);
      for (const v of values) {
        expect(v, `RSI value ${v} out of bounds`).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  it('higher volatility does not break bounds', () => {
    forEachScenario(20, { bars: 200, volatility: 0.10 }, candles => {
      const values = indicators.calculateRSI(candles.map(c => c.close));
      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    });
  });

  it('handles flat prices without NaN', () => {
    const flat = Array(100).fill(100);
    const values = indicators.calculateRSI(flat);
    for (const v of values) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('invariants: Bollinger Bands', () => {
  it('upper >= middle >= lower for every bar across 30 scenarios', () => {
    forEachScenario(30, { bars: 100, volatility: 0.03 }, candles => {
      const bb = indicators.calculateBollingerBands(candles.map(c => c.close));
      for (const point of bb) {
        if (
          point.upper === undefined ||
          point.middle === undefined ||
          point.lower === undefined
        )
          continue;
        expect(point.upper, `upper ${point.upper} < middle ${point.middle}`).toBeGreaterThanOrEqual(
          point.middle
        );
        expect(point.middle).toBeGreaterThanOrEqual(point.lower);
      }
    });
  });

  it('bandwidth is non-negative', () => {
    forEachScenario(20, { bars: 100, volatility: 0.02 }, candles => {
      const bb = indicators.calculateBollingerBands(candles.map(c => c.close));
      for (const point of bb) {
        if (point.bandwidth !== undefined) {
          expect(point.bandwidth).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  it('finite values only — no NaN even on flat input', () => {
    const flat = Array(100).fill(50);
    const bb = indicators.calculateBollingerBands(flat);
    for (const point of bb) {
      for (const k of ['upper', 'middle', 'lower', 'bandwidth', 'percentB']) {
        if (point[k] !== undefined) {
          expect(Number.isFinite(point[k]), `${k} not finite`).toBe(true);
        }
      }
    }
  });
});

describe('invariants: ATR', () => {
  it('always non-negative across 30 scenarios', () => {
    forEachScenario(30, { bars: 100, volatility: 0.02 }, candles => {
      const atr = indicators.calculateATR(candles);
      for (const v of atr) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });
});

describe('invariants: Stochastic', () => {
  it('K and D both in [0, 100]', () => {
    forEachScenario(30, { bars: 100, volatility: 0.02 }, candles => {
      const stoch = indicators.calculateStochastic(candles);
      for (const point of stoch) {
        if (point.k !== undefined) {
          expect(point.k).toBeGreaterThanOrEqual(0);
          expect(point.k).toBeLessThanOrEqual(100);
        }
        if (point.d !== undefined) {
          expect(point.d).toBeGreaterThanOrEqual(0);
          expect(point.d).toBeLessThanOrEqual(100);
        }
      }
    });
  });
});

describe('invariants: ADX', () => {
  it('value in [0, 100]', () => {
    forEachScenario(20, { bars: 100, volatility: 0.02 }, candles => {
      const adx = indicators.calculateADX(candles);
      for (const v of adx) {
        // some impls return objects with .value, others return numbers
        const x = typeof v === 'number' ? v : v?.value;
        if (x === undefined) continue;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(Number.isFinite(x)).toBe(true);
      }
    });
  });
});

describe('invariants: getAllIndicators (composite shape)', () => {
  it('produces the expected key structure with no NaN/undefined leaks', () => {
    forEachScenario(10, { bars: 100, volatility: 0.02 }, candles => {
      const all = indicators.getAllIndicators(candles);
      // Top-level keys we depend on
      for (const k of ['rsi', 'macd', 'bollingerBands', 'atr', 'adx', 'price']) {
        expect(all, `missing key ${k}`).toHaveProperty(k);
      }
      expect(Number.isFinite(all.price)).toBe(true);
      // RSI scalar
      const rsiValue = all.rsi?.value ?? all.rsi;
      if (typeof rsiValue === 'number') {
        expect(rsiValue).toBeGreaterThanOrEqual(0);
        expect(rsiValue).toBeLessThanOrEqual(100);
      }
    });
  });
});

describe('invariants: getEtfLeverage', () => {
  it('returns positive integer for known leveraged ETFs', () => {
    for (const sym of ['SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'SPXL', 'SPXS']) {
      const lev = getEtfLeverage(sym);
      expect(Number.isInteger(lev)).toBe(true);
      expect(lev).toBeGreaterThan(1);
    }
  });

  it('returns 1 for non-leveraged tickers', () => {
    for (const sym of ['AAPL', 'SPY', 'QQQ', 'BTCUSD']) {
      expect(getEtfLeverage(sym)).toBe(1);
    }
  });
});

describe('invariants: calculateQuantity', () => {
  it('never returns negative qty or notional', () => {
    const cases = [
      { maxPositionValue: 8000, currentPrice: 125.50, riskAmount: 200, stopLoss: 122 },
      { maxPositionValue: 15000, currentPrice: 161.47, riskAmount: 375, stopLoss: 157.43 },
      { maxPositionValue: 1, currentPrice: 1, riskAmount: 0, stopLoss: 0.5 },
      { maxPositionValue: 25000, currentPrice: 76000, riskAmount: 500, stopLoss: 75240, isCrypto: true },
    ];
    for (const c of cases) {
      const result = calculateQuantity(c);
      // The function may return a number or { qty, ... } — handle both
      const qty = typeof result === 'number' ? result : result?.qty ?? result?.quantity;
      const notional = typeof result === 'object' ? result?.notional : qty * c.currentPrice;
      if (qty !== undefined) expect(qty, `negative qty for ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(0);
      if (Number.isFinite(notional)) expect(notional).toBeGreaterThanOrEqual(0);
    }
  });

  it('respects maxPositionValue cap', () => {
    const r = calculateQuantity({
      maxPositionValue: 1000,
      currentPrice: 100,
      riskAmount: 50,
      stopLoss: 95,
    });
    const qty = typeof r === 'number' ? r : r?.qty ?? r?.quantity;
    if (qty !== undefined) {
      expect(qty * 100).toBeLessThanOrEqual(1000 + 0.01); // tolerate rounding
    }
  });
});

describe('invariants: RegimeDetector', () => {
  it('confidence ∈ [0, 100] across many scenarios and regimes', () => {
    const detector = new RegimeDetector();
    const scenarios = [
      { bars: 100, volatility: 0.02, drift: 0.005 },   // mild uptrend
      { bars: 100, volatility: 0.02, drift: -0.005 },  // mild downtrend
      { bars: 100, volatility: 0.05, drift: 0 },       // choppy
      { bars: 100, volatility: 0.001, drift: 0 },      // very flat
    ];
    for (const opts of scenarios) {
      for (let seed = 1; seed <= 10; seed++) {
        const candles = genCandles(opts.bars, seed, opts);
        const r = detector.detectRegime(candles);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(100);
        expect(['bull', 'bear', 'sideways', 'unknown'].includes(r.regime)).toBe(true);
      }
    }
  });

  it('insufficient data returns regime: unknown', () => {
    const detector = new RegimeDetector();
    expect(detector.detectRegime([]).regime).toBe('unknown');
    expect(detector.detectRegime(null).regime).toBe('unknown');
    expect(detector.detectRegime(genCandles(10, 1)).regime).toBe('unknown');
  });
});

describe('invariants: idempotency', () => {
  it('calculateRSI is deterministic — same input → same output', () => {
    const candles = genCandles(100, 42, { volatility: 0.02 });
    const closes = candles.map(c => c.close);
    const a = indicators.calculateRSI(closes);
    const b = indicators.calculateRSI(closes);
    expect(a).toEqual(b);
  });

  it('detectRegime is deterministic', () => {
    const detector = new RegimeDetector();
    const candles = genCandles(100, 42, { drift: 0.01 });
    const a = detector.detectRegime(candles);
    const b = detector.detectRegime(candles);
    // confidence and regime must match exactly; timestamps inside indicators
    // are derived from candles so they'll match too
    expect(a.regime).toBe(b.regime);
    expect(a.confidence).toBe(b.confidence);
  });
});
