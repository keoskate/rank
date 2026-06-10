import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  residualForFill,
  summarizeAbsBps,
  isoWeekKey,
  consecutiveWeeksInTolerance,
} from '../backtests/lib/executionBenchmark.js';

// Three RTH minute bars; flat prices make VWAP arithmetic exact.
const dayBars = [
  { t: '2026-06-08T13:30:00Z', high: 100, low: 100, close: 100, volume: 100 },
  { t: '2026-06-08T13:31:00Z', high: 102, low: 102, close: 102, volume: 100 },
  { t: '2026-06-08T20:00:00Z', high: 104, low: 104, close: 104, volume: 200 },
];
// VWAP(13:30→close) = (100*100 + 102*100 + 104*200)/400 = 102.5
// VWAP(13:31→close) = (102*100 + 104*200)/300 = 103.333…

describe('executionBenchmark.residualForFill', () => {
  it('buy fill: positive residual when worse (higher) than benchmark', () => {
    const r = residualForFill(
      { timestamp: '2026-06-08T13:30:00Z', side: 'buy', price: 103 },
      dayBars
    );
    expect(r.actualClose).toBe(104);
    expect(r.closeResidualBps).toBeCloseTo((103 / 104 - 1) * 1e4, 6); // better than close → negative
    expect(r.vwapToClose).toBeCloseTo(102.5, 10);
    expect(r.vwapResidualBps).toBeCloseTo((103 / 102.5 - 1) * 1e4, 6); // worse than VWAP → positive
  });

  it('sell fill: sign flips (receiving less than benchmark is positive/worse)', () => {
    const r = residualForFill(
      { timestamp: '2026-06-08T13:31:00Z', side: 'sell', price: 102 },
      dayBars
    );
    const vwap = (102 * 100 + 104 * 200) / 300; // window starts at the fill bar
    expect(r.vwapToClose).toBeCloseTo(vwap, 10);
    expect(r.vwapResidualBps).toBeCloseTo(-(102 / vwap - 1) * 1e4, 6);
    expect(r.vwapResidualBps).toBeGreaterThan(0); // sold below VWAP → worse
  });

  it('fill after the last bar uses the last bar; empty day yields nulls', () => {
    const r = residualForFill(
      { timestamp: '2026-06-08T21:30:00Z', side: 'buy', price: 104 },
      dayBars
    );
    expect(r.vwapToClose).toBeCloseTo(104, 10);
    const empty = residualForFill(
      { timestamp: '2026-06-08T14:00:00Z', side: 'buy', price: 1 },
      []
    );
    expect(empty.vwapResidualBps).toBe(null);
    expect(empty.closeResidualBps).toBe(null);
  });
});

describe('executionBenchmark.summarizeAbsBps', () => {
  it('summarizes |bps| quantiles and ignores non-finite values', () => {
    const s = summarizeAbsBps([-10, 5, null, NaN, 20]);
    expect(s.n).toBe(3);
    expect(s.p50).toBe(10);
    expect(s.max).toBe(20);
    expect(summarizeAbsBps([]).p50).toBe(null);
  });
});

describe('executionBenchmark.consecutiveWeeksInTolerance', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const report = (over = {}) => ({
    nMatched: 3,
    decisionMatchRate: 1,
    residuals: { vsVwapToClose: { p50: 10, p95: 20, max: 25, n: 3 } },
    ...over,
  });

  it('counts consecutive passing ISO weeks newest-first and breaks on a miss', () => {
    dir = mkdtempSync(join(tmpdir(), 'execbench-'));
    // three consecutive ISO weeks: Wed 2026-05-20, Wed 2026-05-27, Wed 2026-06-03
    writeFileSync(join(dir, '2026-06-03.json'), JSON.stringify(report()));
    writeFileSync(join(dir, '2026-05-27.json'), JSON.stringify(report()));
    writeFileSync(
      join(dir, '2026-05-20.json'),
      JSON.stringify(report({ residuals: { vsVwapToClose: { p50: 40 } } })) // out of tolerance
    );
    expect(consecutiveWeeksInTolerance(dir)).toBe(2);
  });

  it('a no-fills week (nMatched 0) breaks the streak; empty dir is 0', () => {
    dir = mkdtempSync(join(tmpdir(), 'execbench-'));
    writeFileSync(
      join(dir, '2026-06-03.json'),
      JSON.stringify(report({ nMatched: 0 }))
    );
    expect(consecutiveWeeksInTolerance(dir)).toBe(0);
    expect(consecutiveWeeksInTolerance(join(dir, 'nope'))).toBe(0);
  });

  it('isoWeekKey groups Mon-Sun together', () => {
    expect(isoWeekKey('2026-06-08')).toBe(isoWeekKey('2026-06-12')); // Mon..Fri same week
    expect(isoWeekKey('2026-06-05')).not.toBe(isoWeekKey('2026-06-08')); // Fri vs next Mon
  });
});
