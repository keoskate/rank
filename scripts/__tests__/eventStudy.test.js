import { describe, it, expect } from 'vitest';
import {
  walkTrade,
  buildTrades,
  aggregateEquity,
  bootstrapP,
  makeRng,
} from '../backtests/lib/eventStudy.js';

const bar = (date, open, high, low, close) => ({
  date,
  open,
  high,
  low,
  close,
  volume: 1000,
});

describe('eventStudy.walkTrade — conservative exit conventions', () => {
  const policy = { id: 'tp5sl5h10', tpPct: 5, slPct: 5, maxHoldDays: 10 };

  it('stop beats target when both are touchable within one bar', () => {
    // entry 100; bar 1 spans 94..106 — both stop (95) and target (105) touchable
    const bars = [bar('d1', 100, 101, 99, 100), bar('d2', 100, 106, 94, 100)];
    const t = walkTrade(bars, 0, policy);
    // entry day itself: high 101 < 105, low 99 > 95 → no exit on d1
    expect(t.exitDate).toBe('d2');
    expect(t.exitReason).toBe('stop');
    expect(t.exitPrice).toBeCloseTo(95, 10);
  });

  it('gap-through opens fill at the open, not the level', () => {
    const bars = [
      bar('d1', 100, 101, 99, 100),
      bar('d2', 90, 92, 89, 91), // gaps far below the 95 stop
    ];
    const t = walkTrade(bars, 0, policy);
    expect(t.exitReason).toBe('gap-stop');
    expect(t.exitPrice).toBe(90); // the open, worse than the stop level
  });

  it('time exit at the last bar close when nothing triggers', () => {
    const bars = [
      bar('d1', 100, 101, 99, 100.5),
      bar('d2', 100.5, 101, 99.5, 100.2),
      bar('d3', 100.2, 101, 99.5, 100.8),
    ];
    const t = walkTrade(bars, 0, { ...policy, maxHoldDays: 3 });
    expect(t.exitReason).toBe('time');
    expect(t.exitDate).toBe('d3');
    expect(t.exitPrice).toBe(100.8);
    expect(t.holdDays).toBe(3);
  });

  it('tp/sl of 999 behaves as a pure time exit', () => {
    const bars = [
      bar('d1', 100, 150, 60, 100), // wild bar — neither 999% level reachable
      bar('d2', 100, 100, 100, 100),
    ];
    const t = walkTrade(bars, 0, {
      id: 't2',
      tpPct: 999,
      slPct: 999,
      maxHoldDays: 2,
    });
    expect(t.exitReason).toBe('time');
  });
});

describe('eventStudy.buildTrades — next-open entry', () => {
  it('enters at the open of the first bar STRICTLY after the event date', () => {
    const barsBySym = {
      AAA: [
        bar('2026-01-02', 10, 10, 10, 10),
        bar('2026-01-03', 11, 11, 11, 11),
        bar('2026-01-06', 12, 12, 12, 12),
      ],
    };
    const { trades } = buildTrades(
      [{ symbol: 'AAA', date: '2026-01-03' }], // filed on the 3rd → enter the 6th
      barsBySym,
      { id: 't1', tpPct: 999, slPct: 999, maxHoldDays: 1 },
      5
    );
    expect(trades).toHaveLength(1);
    expect(trades[0].entryDate).toBe('2026-01-06');
    expect(trades[0].entryPrice).toBe(12);
    // net = gross − 2×5bps = 0% − 0.10%
    expect(trades[0].netPct).toBeCloseTo(-0.1, 10);
  });

  it('skips events with no future bar', () => {
    const barsBySym = { AAA: [bar('2026-01-02', 10, 10, 10, 10)] };
    const { trades, skippedNoBars } = buildTrades(
      [{ symbol: 'AAA', date: '2026-01-02' }],
      barsBySym,
      { id: 't1', tpPct: 999, slPct: 999, maxHoldDays: 1 },
      5
    );
    expect(trades).toHaveLength(0);
    expect(skippedNoBars).toBe(1);
  });
});

describe('eventStudy.aggregateEquity — fixed slots', () => {
  it('caps concurrency and skips surplus events deterministically', () => {
    const mk = (sym, entry, exit) => ({
      symbol: sym,
      entryDate: entry,
      exitDate: exit,
      entryIdx: 0,
      entryPrice: 100,
      netPct: 1,
    });
    const flat = [bar('d1', 100, 100, 100, 100), bar('d2', 100, 100, 100, 100)];
    const barsBySym = { A: flat, B: flat, C: flat };
    const trades = [
      mk('A', 'd1', 'd2'),
      mk('B', 'd1', 'd2'),
      mk('C', 'd1', 'd2'),
    ];
    const agg = aggregateEquity(trades, barsBySym, ['d1', 'd2'], 2);
    expect(agg.taken).toBe(2);
    expect(agg.skippedFull).toBe(1);
    // two slots of 1/2 weight each earning +1% net → equity ends ~1.01
    expect(agg.equity[agg.equity.length - 1]).toBeCloseTo(1.01, 3);
  });
});

describe('eventStudy.bootstrapP — determinism and sanity', () => {
  // 60 bars trending up 1%/day: a long policy at any entry profits — a
  // "signal" indistinguishable from the symbol's drift must NOT look special.
  const up = [];
  for (let i = 0; i < 60; i++) {
    const p = 100 * Math.pow(1.01, i);
    up.push(bar(`d${String(i).padStart(2, '0')}`, p, p * 1.005, p * 0.995, p));
  }
  const barsBySym = { UP: up };
  const policy = { id: 't3', tpPct: 999, slPct: 999, maxHoldDays: 3 };
  // The constant 1%/day fixture makes every random 3-day hold return exactly
  // (1.01^2 − 1) − costs ≈ +1.91% net: a point-mass null. So observed means
  // AT or BELOW the symbol's own drift must read as nothing special, and
  // anything above it as rare — the sharpest possible sanity check.
  const testTrades = [
    { symbol: 'UP', netPct: 1.8 },
    { symbol: 'UP', netPct: 1.9 },
    { symbol: 'UP', netPct: 1.7 },
  ];

  it('is deterministic for a given seed', () => {
    const p1 = bootstrapP(testTrades, barsBySym, policy, 5, 500, makeRng(42));
    const p2 = bootstrapP(testTrades, barsBySym, policy, 5, 500, makeRng(42));
    expect(p1).toBe(p2);
  });

  it('returns at/below the symbol’s own drift are NOT significant (p ≈ 1)', () => {
    const p = bootstrapP(testTrades, barsBySym, policy, 5, 500, makeRng(7));
    expect(p).toBeGreaterThan(0.9);
  });

  it('returns far above drift ARE rare under the null (p small)', () => {
    const hot = [{ symbol: 'UP', netPct: 25 }];
    const p = bootstrapP(hot, barsBySym, policy, 5, 500, makeRng(7));
    expect(p).toBeLessThan(0.05);
  });
});
