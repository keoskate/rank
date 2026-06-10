import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { anchoredVwap } = requireCjs('@keo/quant-core');
const { barPrice, vwapBetween, anchoredVwapSeries, anchorIndex } =
  anchoredVwap;

const bar = (high, low, close, volume, extra = {}) => ({
  high,
  low,
  close,
  volume,
  ...extra,
});

describe('anchoredVwap.barPrice', () => {
  it('prefers per-bar vwap when present and positive', () => {
    expect(barPrice(bar(10, 8, 9, 100, { vwap: 9.25 }))).toBe(9.25);
  });
  it('falls back to HLC/3 when vwap is absent or zero', () => {
    expect(barPrice(bar(12, 9, 9, 100))).toBe(10);
    expect(barPrice(bar(12, 9, 9, 100, { vwap: 0 }))).toBe(10);
  });
});

describe('anchoredVwap.anchoredVwapSeries', () => {
  it('matches a hand-computed 3-bar case (HLC/3 weights)', () => {
    // typical prices: (12+9+9)/3=10, (14+10+12)/3=12, (15+13+14)/3=14
    const bars = [bar(12, 9, 9, 100), bar(14, 10, 12, 300), bar(15, 13, 14, 100)];
    const out = anchoredVwapSeries(bars, 0);
    expect(out[0]).toBeCloseTo(10, 12);
    expect(out[1]).toBeCloseTo((10 * 100 + 12 * 300) / 400, 12);
    expect(out[2]).toBeCloseTo((10 * 100 + 12 * 300 + 14 * 100) / 500, 12);
  });

  it('is null before the anchor and cumulative after it', () => {
    const bars = [bar(10, 10, 10, 50), bar(20, 20, 20, 50), bar(30, 30, 30, 50)];
    const out = anchoredVwapSeries(bars, 1);
    expect(out[0]).toBe(null);
    expect(out[1]).toBeCloseTo(20, 12);
    expect(out[2]).toBeCloseTo(25, 12);
  });

  it('skips zero-volume bars without breaking alignment', () => {
    const bars = [bar(10, 10, 10, 100), bar(99, 99, 99, 0), bar(20, 20, 20, 100)];
    const out = anchoredVwapSeries(bars, 0);
    expect(out[1]).toBeCloseTo(10, 12); // zero-vol bar adds no weight
    expect(out[2]).toBeCloseTo(15, 12);
  });

  it('returns all-null for an out-of-range anchor', () => {
    const bars = [bar(10, 10, 10, 100)];
    expect(anchoredVwapSeries(bars, 5)).toEqual([null]);
    expect(anchoredVwapSeries(bars, -1)).toEqual([null]);
  });
});

describe('anchoredVwap.vwapBetween', () => {
  const bars = [
    bar(10, 10, 10, 100),
    bar(20, 20, 20, 200),
    bar(30, 30, 30, 100),
  ];
  it('computes the volume-weighted mean over an inclusive range', () => {
    expect(vwapBetween(bars, 0, 2)).toBeCloseTo(
      (10 * 100 + 20 * 200 + 30 * 100) / 400,
      12
    );
    expect(vwapBetween(bars, 1, 1)).toBeCloseTo(20, 12);
  });
  it('agrees with the last point of anchoredVwapSeries (one definition)', () => {
    expect(vwapBetween(bars, 0, 2)).toBeCloseTo(
      anchoredVwapSeries(bars, 0)[2],
      12
    );
  });
  it('returns null on empty/no-volume ranges', () => {
    expect(vwapBetween(bars, 2, 1)).toBe(null);
    expect(vwapBetween([bar(10, 10, 10, 0)], 0, 0)).toBe(null);
    expect(vwapBetween([], 0, 0)).toBe(null);
  });
});

describe('anchoredVwap.anchorIndex', () => {
  it('high252 finds the highest close within the trailing 252 bars', () => {
    const bars = [];
    for (let i = 0; i < 300; i++) bars.push(bar(1, 1, 1 + (i % 50), 1));
    // closes cycle 1..50; within last 252 bars the max close (50) occurs at
    // i ≡ 49 (mod 50); the FIRST max within that window is kept.
    const idx = anchorIndex(bars, 'high252');
    expect(idx).toBeGreaterThanOrEqual(300 - 252);
    expect(bars[idx].close).toBe(50);
    const window = bars.slice(300 - 252);
    expect(Math.max(...window.map(b => b.close))).toBe(50);
  });

  it('yearStart finds the first bar of the last bar’s calendar year', () => {
    const bars = [
      bar(1, 1, 1, 1, { date: '2025-12-30' }),
      bar(1, 1, 1, 1, { date: '2025-12-31' }),
      bar(1, 1, 1, 1, { date: '2026-01-02' }),
      bar(1, 1, 1, 1, { date: '2026-06-09' }),
    ];
    expect(anchorIndex(bars, 'yearStart')).toBe(2);
  });

  it('returns -1 for unknown policy or empty input', () => {
    expect(anchorIndex([], 'high252')).toBe(-1);
    expect(anchorIndex([bar(1, 1, 1, 1)], 'nope')).toBe(-1);
  });
});
