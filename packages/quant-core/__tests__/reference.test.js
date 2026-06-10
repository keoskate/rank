import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { indicators } = requireCjs('@keo/quant-core');
// The npm package we wrap. If our outputs ever drift from this, our
// wrapper has a bug.
const ti = requireCjs('technicalindicators');

// ─────────────────────────────────────────────────────────────────
// Layer B — Reference comparison.
//
// For every indicator that's a thin wrapper around the upstream
// `technicalindicators` package, assert exact match. This catches
// the class of bug where the wrapper accidentally swaps a parameter
// (period 7 when caller said 14, etc.) or applies a transformation
// that no longer agrees with the underlying library after a version
// bump.
// ─────────────────────────────────────────────────────────────────

// Deterministic candle sample identical to capture-fixtures.js so
// any test harness, fixture, or reference test sees the same numbers.
function gen(n, opts = {}) {
  const { startPrice = 100, drift = 0.05, noiseAmp = 0.5 } = opts;
  const bars = [];
  let prevClose = startPrice;
  for (let i = 0; i < n; i++) {
    const noise = Math.sin(i * 0.3) * noiseAmp + Math.cos(i * 0.7) * (noiseAmp * 0.6);
    const close = startPrice + i * drift + noise;
    const open = i === 0 ? close : prevClose;
    const high = Math.max(open, close) + Math.abs(noise) * 0.4;
    const low = Math.min(open, close) - Math.abs(noise) * 0.4;
    const volume = Math.round(10000 + Math.abs(noise) * 5000 + (i % 7) * 500);
    bars.push({
      timestamp: 1700000000000 + i * 5 * 60 * 1000,
      open: +open.toFixed(4),
      high: +high.toFixed(4),
      low: +low.toFixed(4),
      close: +close.toFixed(4),
      volume,
    });
    prevClose = close;
  }
  return bars;
}

const candles = gen(100);
const closes = candles.map(c => c.close);

describe('reference comparison: pass-through wrappers must match upstream exactly', () => {
  it('RSI(14) — wrapper output ≡ ti.RSI.calculate output', () => {
    const ours = indicators.calculateRSI(closes, 14);
    const ref = ti.RSI.calculate({ values: closes, period: 14 });
    expect(ours).toEqual(ref);
  });

  it('RSI honors custom period (7) — wrapper passes period through', () => {
    const ours = indicators.calculateRSI(closes, 7);
    const ref = ti.RSI.calculate({ values: closes, period: 7 });
    expect(ours).toEqual(ref);
  });

  it('RSI honors custom period (21) — wrapper passes period through', () => {
    const ours = indicators.calculateRSI(closes, 21);
    const ref = ti.RSI.calculate({ values: closes, period: 21 });
    expect(ours).toEqual(ref);
  });

  it('MACD default(12,26,9) ≡ ti.MACD.calculate', () => {
    const ours = indicators.calculateMACD(closes);
    const ref = ti.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    expect(ours).toEqual(ref);
  });

  it('ATR(14) ≡ ti.ATR.calculate', () => {
    const ours = indicators.calculateATR(candles, 14);
    const ref = ti.ATR.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period: 14,
    });
    expect(ours).toEqual(ref);
  });

  it('EMA(9) ≡ ti.EMA.calculate', () => {
    const ours = indicators.calculateEMA(closes, 9);
    const ref = ti.EMA.calculate({ values: closes, period: 9 });
    expect(ours).toEqual(ref);
  });

  it('SMA(20) ≡ ti.SMA.calculate', () => {
    const ours = indicators.calculateSMA(closes, 20);
    const ref = ti.SMA.calculate({ values: closes, period: 20 });
    expect(ours).toEqual(ref);
  });

  it('OBV ≡ ti.OBV.calculate', () => {
    const ours = indicators.calculateOBV(candles);
    const ref = ti.OBV.calculate({
      close: candles.map(c => c.close),
      volume: candles.map(c => c.volume),
    });
    expect(ours).toEqual(ref);
  });

  it('Stochastic default ≡ ti.Stochastic.calculate', () => {
    const ours = indicators.calculateStochastic(candles);
    const ref = ti.Stochastic.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period: 14,
      signalPeriod: 3,
    });
    expect(ours).toEqual(ref);
  });

  it('ADX(14) ≡ ti.ADX.calculate', () => {
    const ours = indicators.calculateADX(candles);
    const ref = ti.ADX.calculate({
      high: candles.map(c => c.high),
      low: candles.map(c => c.low),
      close: candles.map(c => c.close),
      period: 14,
    });
    expect(ours).toEqual(ref);
  });

  // VWAP is intentionally NOT a whole-window pass-through: our wrapper resets
  // per ET session, because the engine feeds multi-day 5-min windows and a
  // cumulative VWAP anchored to a prior day's open corrupts the mandatory
  // `belowVwap` entry gate (see calculateVWAP's doc comment). The fixture
  // starts at 17:13 ET and crosses ET midnight, so the old whole-window
  // comparison against upstream's single cumulative VWAP asserted a wrong
  // contract — that, not upstream float drift, was the ROADMAP D13 failure.
  const etDay = ts =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ts));

  const tiVwap = seg =>
    ti.VWAP.calculate({
      high: seg.map(c => c.high),
      low: seg.map(c => c.low),
      close: seg.map(c => c.close),
      volume: seg.map(c => c.volume),
    });

  it('VWAP within a single ET session ≡ ti.VWAP.calculate (bit-exact)', () => {
    const firstDay = etDay(candles[0].timestamp);
    const seg = candles.filter(c => etDay(c.timestamp) === firstDay);
    // Fixture sanity: a real segment, and the window does span ET midnight.
    expect(seg.length).toBeGreaterThan(10);
    expect(seg.length).toBeLessThan(candles.length);
    expect(indicators.calculateVWAP(seg)).toEqual(tiVwap(seg));
  });

  it('VWAP across sessions ≡ per-ET-day ti.VWAP segments concatenated (session-reset contract)', () => {
    const ref = [];
    let i = 0;
    while (i < candles.length) {
      const day = etDay(candles[i].timestamp);
      let j = i;
      while (j < candles.length && etDay(candles[j].timestamp) === day) j++;
      ref.push(...tiVwap(candles.slice(i, j)));
      i = j;
    }
    expect(indicators.calculateVWAP(candles)).toEqual(ref);
  });
});

describe('reference comparison: BollingerBands wrapper adds percentB + bandwidth without changing the bands', () => {
  // Our wrapper extends each band point with percentB and bandwidth.
  // The upstream upper/middle/lower must remain bit-exact.

  it('upper/middle/lower match upstream exactly (default 20, 2σ)', () => {
    const ours = indicators.calculateBollingerBands(closes);
    const ref = ti.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
    expect(ours.length).toBe(ref.length);
    for (let i = 0; i < ref.length; i++) {
      expect(ours[i].upper).toBe(ref[i].upper);
      expect(ours[i].middle).toBe(ref[i].middle);
      expect(ours[i].lower).toBe(ref[i].lower);
    }
  });

  it('our percentB derivation matches its own definition: (price - lower) / (upper - lower)', () => {
    const ours = indicators.calculateBollingerBands(closes);
    // Our wrapper aligns each band with closes[closes.length - bb.length + i]
    for (let i = 0; i < ours.length; i++) {
      const price = closes[closes.length - ours.length + i];
      const expected =
        ours[i].upper !== ours[i].lower
          ? (price - ours[i].lower) / (ours[i].upper - ours[i].lower)
          : 0.5;
      expect(ours[i].percentB).toBe(expected);
    }
  });

  it('our bandwidth matches its own definition: (upper - lower) / middle', () => {
    const ours = indicators.calculateBollingerBands(closes);
    for (let i = 0; i < ours.length; i++) {
      const expected = (ours[i].upper - ours[i].lower) / ours[i].middle;
      expect(ours[i].bandwidth).toBe(expected);
    }
  });

  it('tight stdDev=1 still pass-through', () => {
    const ours = indicators.calculateBollingerBands(closes, { period: 20, stdDev: 1 });
    const ref = ti.BollingerBands.calculate({ period: 20, values: closes, stdDev: 1 });
    for (let i = 0; i < ref.length; i++) {
      expect(ours[i].upper).toBe(ref[i].upper);
      expect(ours[i].middle).toBe(ref[i].middle);
      expect(ours[i].lower).toBe(ref[i].lower);
    }
  });
});

describe('reference comparison: parameter passing sanity', () => {
  // If a wrapper silently ignores a custom param and uses defaults,
  // these tests catch it: different params must produce different output.

  it('RSI(7) and RSI(21) produce different output (i.e. period is honored)', () => {
    const a = indicators.calculateRSI(closes, 7);
    const b = indicators.calculateRSI(closes, 21);
    expect(a).not.toEqual(b);
  });

  it('SMA(9) and SMA(20) produce different output', () => {
    const a = indicators.calculateSMA(closes, 9);
    const b = indicators.calculateSMA(closes, 20);
    expect(a).not.toEqual(b);
  });

  it('Bollinger stdDev=1 and stdDev=2 produce different upper/lower', () => {
    const a = indicators.calculateBollingerBands(closes, { period: 20, stdDev: 1 });
    const b = indicators.calculateBollingerBands(closes, { period: 20, stdDev: 2 });
    // sigma=1 should be tighter
    expect(a[a.length - 1].upper).toBeLessThan(b[b.length - 1].upper);
    expect(a[a.length - 1].lower).toBeGreaterThan(b[b.length - 1].lower);
  });
});
