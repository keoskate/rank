import { describe, it, expect } from 'vitest';
import {
  shouldRunNow,
  countGradedClusters,
  calibrationReady,
  RUN_HOUR_ET,
} from '../scanner/optionsDailyLoop.js';

describe('optionsDailyLoop.shouldRunNow', () => {
  const monday10 = { dateEt: '2026-07-27', hourEt: RUN_HOUR_ET, isWeekday: true };

  it('runs once per market day after the run hour', () => {
    expect(shouldRunNow({}, monday10)).toBe(true);
    expect(shouldRunNow({ lastRunDay: '2026-07-24' }, monday10)).toBe(true);
  });

  it('never double-fires the same day', () => {
    expect(shouldRunNow({ lastRunDay: '2026-07-27' }, monday10)).toBe(false);
  });

  it('waits for the run hour and skips weekends', () => {
    expect(shouldRunNow({}, { ...monday10, hourEt: RUN_HOUR_ET - 1 })).toBe(false);
    expect(shouldRunNow({}, { ...monday10, isWeekday: false })).toBe(false);
  });
});

describe('optionsDailyLoop.countGradedClusters', () => {
  const pick = (underlying, day, graded) => ({
    recordedAt: `${day}T14:00:00.000Z`,
    card: { underlying },
    ...(graded ? { exit: { win: false } } : {}),
  });

  it('counts one cluster per underlying per entry day, graded only', () => {
    const picks = [
      pick('NVDA', '2026-07-22', true),
      pick('NVDA', '2026-07-22', true), // second strike, same cluster
      pick('NVDA', '2026-07-23', true), // new day, new cluster
      pick('TSLA', '2026-07-22', true),
      pick('AMD', '2026-07-22', false), // ungraded — not evidence yet
    ];
    expect(countGradedClusters(picks)).toBe(3);
  });

  it('calibrationReady needs breadth across days, not just cluster count', () => {
    // 40 clusters but all from 4 market days — four correlated observations
    // wearing forty hats. Not ready.
    const sameDays = [];
    for (let d = 0; d < 4; d++) {
      for (let u = 0; u < 10; u++) sameDays.push(pick(`SYM${u}`, `2026-07-2${d + 2}`, true));
    }
    expect(countGradedClusters(sameDays)).toBe(40);
    expect(calibrationReady(sameDays)).toBe(false);

    // 30 clusters spread over 10 days — ready.
    const spread = [];
    for (let d = 0; d < 10; d++) {
      for (let u = 0; u < 3; u++) spread.push(pick(`SYM${u}`, `2026-08-${String(d + 1).padStart(2, '0')}`, true));
    }
    expect(calibrationReady(spread)).toBe(true);
  });
});
