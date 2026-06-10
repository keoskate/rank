import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { volumeProfile } = requireCjs('@keo/quant-core');
const { buildVolumeProfile, nakedPocs } = volumeProfile;

// Bars priced exactly at `p` so binning is unambiguous.
const flatBar = (p, volume) => ({ high: p, low: p, close: p, volume });

describe('volumeProfile.buildVolumeProfile', () => {
  it('value area covers >= valueAreaPct of total volume and brackets the POC', () => {
    const bars = [];
    // Bell-ish: heavy volume at 100, lighter at the wings 90..110.
    for (let p = 90; p <= 110; p++) {
      const v = 1000 - 40 * Math.abs(p - 100);
      bars.push(flatBar(p, v));
    }
    const prof = buildVolumeProfile(bars, { bins: 21, valueAreaPct: 0.7 });
    expect(prof.ok).toBe(true);
    expect(prof.pocPrice).toBeGreaterThan(98);
    expect(prof.pocPrice).toBeLessThan(102);
    expect(prof.val).toBeLessThanOrEqual(prof.pocPrice);
    expect(prof.vah).toBeGreaterThanOrEqual(prof.pocPrice);
    const covered = prof.bins
      .filter(b => b.pLo >= prof.val - 1e-9 && b.pHi <= prof.vah + 1e-9)
      .reduce((s, b) => s + b.vol, 0);
    expect(covered / prof.totalVolume).toBeGreaterThanOrEqual(0.7);
  });

  it('total binned volume equals input volume', () => {
    const bars = [flatBar(10, 100), flatBar(11, 250), flatBar(12.5, 50)];
    const prof = buildVolumeProfile(bars, { bins: 5 });
    expect(prof.totalVolume).toBe(400);
    expect(prof.bins.reduce((s, b) => s + b.vol, 0)).toBe(400);
  });

  it('single-bin dominance: POC lands on the dominant price', () => {
    const bars = [
      flatBar(50, 10),
      flatBar(60, 10000),
      flatBar(70, 10),
      flatBar(55, 20),
    ];
    const prof = buildVolumeProfile(bars, { bins: 20 });
    expect(Math.abs(prof.pocPrice - 60)).toBeLessThan(1.5);
    // VA stays tight around the dominant node (70% reached almost instantly).
    expect(prof.vah - prof.val).toBeLessThan(5);
  });

  it('degenerate single-price window returns one bin, poc=vah=val', () => {
    const prof = buildVolumeProfile([flatBar(42, 100), flatBar(42, 300)]);
    expect(prof.ok).toBe(true);
    expect(prof.pocPrice).toBe(42);
    expect(prof.vah).toBe(42);
    expect(prof.val).toBe(42);
    expect(prof.totalVolume).toBe(400);
  });

  it('uses per-bar vwap for binning when present', () => {
    // close says 100, vwap says 200 — volume must bin at 200.
    const bars = [
      { high: 100, low: 100, close: 100, volume: 100, vwap: 200 },
      flatBar(100, 1),
    ];
    const prof = buildVolumeProfile(bars, { bins: 10 });
    expect(prof.pocPrice).toBeGreaterThan(150);
  });

  it('empty/zero-volume input → ok:false', () => {
    expect(buildVolumeProfile([]).ok).toBe(false);
    expect(buildVolumeProfile([flatBar(10, 0)]).ok).toBe(false);
  });
});

describe('volumeProfile.nakedPocs', () => {
  const day = (date, pocPrice, low, high) => ({ date, pocPrice, low, high });

  it('flags POCs never revisited and ages them; touched POCs drop out', () => {
    const days = [
      day('d1', 100, 98, 102), // POC 100 — revisited on d3 (range 99..103)
      day('d2', 110, 108, 112), // POC 110 — never traded again
      day('d3', 101, 99, 103), // POC 101 — revisited on d4 (range 93..102)
      day('d4', 95, 93, 102),
    ];
    const naked = nakedPocs(days);
    expect(naked).toEqual([{ date: 'd2', pocPrice: 110, age: 2 }]);
  });

  it('respects throughIdx (point-in-time evaluation)', () => {
    const days = [
      day('d1', 100, 98, 102),
      day('d2', 120, 118, 122),
      day('d3', 100, 99, 101), // touches d1's POC only at d3
    ];
    // As of d2: d1's POC (100) is still naked (d2 range 118..122 missed it).
    expect(nakedPocs(days, 1)).toEqual([{ date: 'd1', pocPrice: 100, age: 1 }]);
    // As of d3: d1 revisited, d2's 120 still naked.
    expect(nakedPocs(days, 2)).toEqual([{ date: 'd2', pocPrice: 120, age: 1 }]);
  });

  it('handles empty input', () => {
    expect(nakedPocs([])).toEqual([]);
  });
});
