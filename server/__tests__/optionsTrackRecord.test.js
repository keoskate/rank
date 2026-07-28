import { describe, it, expect } from 'vitest';
import { gradePick, gradeStockLeg } from '../scanner/optionsTrackRecord.js';

const basePick = {
  recordedAt: '2026-07-01T14:00:00.000Z',
  planExitDate: '2026-07-08',
  card: {
    contractSymbol: 'NVDA260717C00190000',
    underlying: 'NVDA',
    type: 'call',
    strike: 190,
    expiration: '2026-07-17',
    entryDebit: 4.0,
    targetPrice: 198,
    stopPrice: 179,
    popModel: 0.55,
  },
};

const uBar = (day, high, low, close) => ({ t: `${day}T04:00:00Z`, high, low, close });
const oBar = (day, close) => ({ t: `${day}T04:00:00Z`, c: close });

describe('gradePick', () => {
  it('target touch ends the trade that day at the option close — WIN', () => {
    const exit = gradePick(
      basePick,
      [oBar('2026-07-02', 4.5), oBar('2026-07-03', 9.2), oBar('2026-07-07', 6.0)],
      [uBar('2026-07-02', 190, 184, 188), uBar('2026-07-03', 199, 189, 197), uBar('2026-07-07', 197, 191, 195)],
      '2026-07-05'
    );
    expect(exit.exitReason).toBe('targetHit');
    expect(exit.exitDate).toBe('2026-07-03');
    expect(exit.exitValue).toBe(9.2);
    expect(exit.win).toBe(true);
    expect(exit.returnPct).toBeCloseTo((9.2 - 4) / 4, 4);
  });

  it('stop touch ends the trade — LOSS (and beats a same-day target touch)', () => {
    const exit = gradePick(
      basePick,
      [oBar('2026-07-02', 1.1)],
      [uBar('2026-07-02', 198.5, 178, 180)], // touched both — pessimistic: stop
      '2026-07-09'
    );
    expect(exit.exitReason).toBe('stopHit');
    expect(exit.win).toBe(false);
    expect(exit.plPerContract).toBeCloseTo((1.1 - 4) * 100, 2);
  });

  it('no touch: still open until the plan exit passes, then grades at exit close', () => {
    const optionBars = [oBar('2026-07-02', 4.2), oBar('2026-07-08', 3.1)];
    const underlyingBars = [uBar('2026-07-02', 192, 186, 190), uBar('2026-07-08', 193, 187, 191)];
    expect(gradePick(basePick, optionBars, underlyingBars, '2026-07-08')).toBeNull(); // exit day not over
    const exit = gradePick(basePick, optionBars, underlyingBars, '2026-07-09');
    expect(exit.exitReason).toBe('planExit');
    expect(exit.exitValue).toBe(3.1);
    expect(exit.win).toBe(false); // theta ate it even though the stock went nowhere bad
  });

  it('thin contract with no exit-day bar uses the nearest close in the grace window', () => {
    const exit = gradePick(
      basePick,
      [oBar('2026-07-09', 2.8)], // only traded the day after plan exit
      [uBar('2026-07-07', 192, 186, 190)],
      '2026-07-10'
    );
    expect(exit.valueSource).toBe('optionClose:2026-07-09');
    expect(exit.exitValue).toBe(2.8);
  });

  it('never-traded contract that expired grades at intrinsic — put side too', () => {
    const putPick = {
      ...basePick,
      planExitDate: '2026-07-17',
      card: { ...basePick.card, type: 'put', strike: 190, targetPrice: 179, stopPrice: 198, entryDebit: 3.0 },
    };
    const exit = gradePick(
      putPick,
      [],
      [uBar('2026-07-10', 192, 186, 191), uBar('2026-07-17', 186, 183, 184)],
      '2026-07-20'
    );
    expect(exit.valueSource).toBe('intrinsicAtExpiry');
    expect(exit.exitValue).toBeCloseTo(6, 3); // 190 - 184
    expect(exit.win).toBe(true);
  });

  it('returns null when there is no option data and no expiry yet', () => {
    expect(gradePick(basePick, [], [uBar('2026-07-09', 192, 186, 190)], '2026-07-10')).toBeNull();
  });
});

describe('gradePick — exit-at-bid haircut (v2)', () => {
  it('haircuts trade-based exits by half the entry-time relative spread', () => {
    const wideSpread = { ...basePick, card: { ...basePick.card, spreadPct: 0.1 } };
    const optionBars = [oBar('2026-07-03', 9.2)];
    const underlyingBars = [uBar('2026-07-03', 199, 189, 197)];
    const exit = gradePick(wideSpread, optionBars, underlyingBars, '2026-07-05');
    expect(exit.exitValueRaw).toBe(9.2);
    expect(exit.exitValue).toBeCloseTo(9.2 * 0.95, 3); // 10% spread → 5% off the print
    expect(exit.returnPct).toBeCloseTo((9.2 * 0.95 - 4) / 4, 4);
  });

  it('does not haircut intrinsic-at-expiry settlement', () => {
    const wideSpread = {
      ...basePick,
      planExitDate: '2026-07-17',
      card: { ...basePick.card, spreadPct: 0.2 },
    };
    const exit = gradePick(wideSpread, [], [uBar('2026-07-17', 200, 195, 198)], '2026-07-20');
    expect(exit.valueSource).toBe('intrinsicAtExpiry');
    expect(exit.exitValue).toBeCloseTo(8, 3); // 198 - 190, untouched
  });
});

describe('gradeStockLeg — direction vs vehicle attribution', () => {
  it('LONG stock leg wins at the target level', () => {
    const leg = gradeStockLeg(
      { ...basePick, card: { ...basePick.card, direction: 'LONG', underlyingPrice: 185 } },
      [uBar('2026-07-03', 199, 189, 197)],
      '2026-07-05'
    );
    expect(leg.exitReason).toBe('targetHit');
    expect(leg.exitPrice).toBe(198);
    expect(leg.returnPct).toBeCloseTo((198 - 185) / 185, 4);
    expect(leg.win).toBe(true);
  });

  it('SHORT stock leg signs returns correctly and loses on a stop', () => {
    const shortPick = {
      ...basePick,
      card: { ...basePick.card, direction: 'SHORT', underlyingPrice: 185, targetPrice: 172, stopPrice: 191 },
    };
    const leg = gradeStockLeg(shortPick, [uBar('2026-07-03', 192, 186, 190)], '2026-07-05');
    expect(leg.exitReason).toBe('stopHit');
    expect(leg.returnPct).toBeCloseTo(-(191 - 185) / 185, 4);
    expect(leg.win).toBe(false);
  });

  it('no touch grades at the plan-exit close after the date passes', () => {
    const bars = [uBar('2026-07-08', 193, 187, 191)];
    expect(gradeStockLeg({ ...basePick, card: { ...basePick.card, direction: 'LONG', underlyingPrice: 185 } }, bars, '2026-07-08')).toBeNull();
    const leg = gradeStockLeg({ ...basePick, card: { ...basePick.card, direction: 'LONG', underlyingPrice: 185 } }, bars, '2026-07-09');
    expect(leg.exitReason).toBe('planExit');
    expect(leg.exitPrice).toBe(191);
    expect(leg.win).toBe(true); // stock inched up — this is the "vehicle tax" case when the option still lost
  });
});

describe('gradePick — hold-to-plan playbook (useTouches: false)', () => {
  const hold = { useTouches: false };

  it('ignores a stop touch and rides to the plan exit', () => {
    // Stop touched 7/02 (low 178 < 179) but the stock recovered; option
    // closed the plan-exit day at 5.5. Playbook A stops out for a loss,
    // playbook B holds through the same dip and wins.
    const optionBars = [oBar('2026-07-02', 1.1), oBar('2026-07-08', 5.5)];
    const underlyingBars = [uBar('2026-07-02', 190, 178, 181), uBar('2026-07-08', 196, 190, 195)];
    const withStops = gradePick(basePick, optionBars, underlyingBars, '2026-07-09');
    const held = gradePick(basePick, optionBars, underlyingBars, '2026-07-09', hold);
    expect(withStops.exitReason).toBe('stopHit');
    expect(withStops.win).toBe(false);
    expect(held.exitReason).toBe('planExit');
    expect(held.exitValue).toBe(5.5);
    expect(held.win).toBe(true);
  });

  it('cannot grade early — even a target touch stays open until the plan exit passes', () => {
    const optionBars = [oBar('2026-07-03', 9.2)];
    const underlyingBars = [uBar('2026-07-03', 199, 189, 197)];
    // Playbook A resolves at the touch; B has no verdict yet.
    expect(gradePick(basePick, optionBars, underlyingBars, '2026-07-05').exitReason).toBe('targetHit');
    expect(gradePick(basePick, optionBars, underlyingBars, '2026-07-05', hold)).toBeNull();
    // After the plan exit passes, B grades at the nearest close in grace.
    const held = gradePick(basePick, optionBars, underlyingBars, '2026-07-09', hold);
    expect(held.exitReason).toBe('planExit');
  });

  it('both playbooks agree when nothing was touched', () => {
    const optionBars = [oBar('2026-07-08', 3.1)];
    const underlyingBars = [uBar('2026-07-08', 193, 187, 191)];
    const a = gradePick(basePick, optionBars, underlyingBars, '2026-07-09');
    const b = gradePick(basePick, optionBars, underlyingBars, '2026-07-09', hold);
    expect(a.exitValue).toBe(b.exitValue);
    expect(a.returnPct).toBe(b.returnPct);
  });
});
