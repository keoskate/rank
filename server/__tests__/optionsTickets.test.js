import { describe, it, expect } from 'vitest';
import { shouldAutoExit, planExitDateFor, roundToTick } from '../scanner/optionsTickets.js';

describe('optionsTickets', () => {
  it('shouldAutoExit fires on/after the plan date, open tickets only', () => {
    const t = { status: 'open', planExitDate: '2026-08-10' };
    expect(shouldAutoExit(t, '2026-08-09')).toBe(false);
    expect(shouldAutoExit(t, '2026-08-10')).toBe(true);
    expect(shouldAutoExit(t, '2026-08-12')).toBe(true);
    expect(shouldAutoExit({ ...t, status: 'closing' }, '2026-08-12')).toBe(false);
    expect(shouldAutoExit({ ...t, status: 'closed' }, '2026-08-12')).toBe(false);
  });

  it('planExitDateFor is horizon end, capped a day before expiry', () => {
    const boughtAt = Date.parse('2026-08-07T14:00:00Z');
    // 5d horizon → 7 calendar days → 2026-08-14; expiry far away
    expect(planExitDateFor({ expiration: '2026-09-18' }, 5, boughtAt)).toBe('2026-08-14');
    // Expiry inside the horizon → day before expiry
    expect(planExitDateFor({ expiration: '2026-08-12' }, 5, boughtAt)).toBe('2026-08-11');
  });

  it('roundToTick respects the $3 tick boundary', () => {
    expect(roundToTick(1.234, 'up')).toBe(1.24);
    expect(roundToTick(4.52, 'up')).toBe(4.55);
    expect(roundToTick(4.52, 'down')).toBe(4.5);
  });
});
