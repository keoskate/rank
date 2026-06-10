import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const { darkPoolCore } = requireCjs('@keo/quant-core');
const { classifyDarkPool, FETCH_CAP } = darkPoolCore;

// 2026-06-10 was a Wednesday; 14:30Z = 10:30 ET (RTH).
const RTH_BASE = Date.parse('2026-06-10T14:30:00Z');

const print = (over = {}) => ({
  executed_at: new Date(RTH_BASE).toISOString(),
  price: '100.50',
  size: 1000,
  premium: '1000000',
  nbbo_bid: '100.00',
  nbbo_ask: '100.20', // mid 100.10 → price 100.50 is a buy
  ...over,
});

const sellPrint = (over = {}) =>
  print({ price: '99.90', ...over }); // below mid 100.10 → sell

const atMidPrint = (over = {}) =>
  print({ price: '100.10', ...over }); // exactly at mid

const minuteOffset = m =>
  new Date(RTH_BASE + m * 60 * 1000).toISOString();

describe('darkPoolCore.classifyDarkPool — audit fixes', () => {
  it('drops at-mid prints (audit #2) and reports their premium', () => {
    const prints = [
      ...Array.from({ length: 6 }, (_, i) =>
        print({ executed_at: minuteOffset(i) })
      ),
      atMidPrint({ premium: '50000000', executed_at: minuteOffset(7) }),
    ];
    const r = classifyDarkPool(prints, { asOf: RTH_BASE + 10 * 60 * 1000 });
    expect(r.droppedAtMid).toBe(1);
    expect(r.atMidPremium).toBe(50_000_000);
    // The $50M at-mid cross contributes nothing to the directional read.
    expect(r.totalPremium).toBe(6_000_000);
    expect(r.sentiment).toBe('bullish');
  });

  it('drops missing/zero-NBBO prints instead of auto-classifying them as buys', () => {
    const prints = [
      print({ nbbo_bid: '0', nbbo_ask: '0', executed_at: minuteOffset(1) }),
      print({ nbbo_bid: null, nbbo_ask: null, executed_at: minuteOffset(2) }),
    ];
    const r = classifyDarkPool(prints, { asOf: RTH_BASE + 10 * 60 * 1000 });
    expect(r.droppedNoNbbo).toBe(2);
    expect(r.printCount).toBe(0);
    expect(r.sentiment).toBe('neutral');
  });

  it('reproduces the audit #4 mega-print scenario — one block can no longer flip the read', () => {
    // 9 independent sells of $100k + ONE $20M buy print. Raw premium share
    // would be 95.7% buy (the audit's 7% → 96% flip). Capped premium +
    // count-majority + minPrints requirements must all refuse the bullish read.
    const prints = [
      ...Array.from({ length: 9 }, (_, i) =>
        sellPrint({ premium: '100000', executed_at: minuteOffset(i) })
      ),
      print({ premium: '20000000', executed_at: minuteOffset(10) }),
    ];
    const r = classifyDarkPool(prints, { asOf: RTH_BASE + 15 * 60 * 1000 });
    const rawBuyShare = 20_000_000 / 20_900_000;
    expect(rawBuyShare).toBeGreaterThan(0.95); // the old read
    expect(r.buyShare).toBeLessThan(0.9); // capped share
    expect(r.countShare).toBeCloseTo(0.1, 5); // 1 of 10 prints
    expect(r.sentiment).not.toBe('bullish');
  });

  it('requires >= minPrints on the dominant side', () => {
    const prints = Array.from({ length: 3 }, (_, i) =>
      print({ premium: '2000000', executed_at: minuteOffset(i) })
    );
    const r = classifyDarkPool(prints, {
      asOf: RTH_BASE + 10 * 60 * 1000,
      minPrints: 5,
    });
    expect(r.buyShare).toBe(1);
    expect(r.sentiment).toBe('neutral'); // 3 < 5 prints
    const r2 = classifyDarkPool(prints, {
      asOf: RTH_BASE + 10 * 60 * 1000,
      minPrints: 3,
    });
    expect(r2.sentiment).toBe('bullish');
  });

  it('excludes after-hours prints under rthOnly (audit #5) and never uses one for lastRthPrice', () => {
    const ahIso = '2026-06-10T21:30:00Z'; // 17:30 ET — after hours
    const prints = [
      ...Array.from({ length: 5 }, (_, i) =>
        print({ executed_at: minuteOffset(i) })
      ),
      print({ price: '999', executed_at: ahIso }),
    ];
    const r = classifyDarkPool(prints, {
      asOf: Date.parse(ahIso),
      lookbackMinutes: 600,
    });
    expect(r.droppedAfterHours).toBe(1);
    expect(r.lastRthPrice).toBe(100.5); // not the 999 AH print
    const r2 = classifyDarkPool(prints, {
      asOf: Date.parse(ahIso),
      lookbackMinutes: 600,
      rthOnly: false,
    });
    expect(r2.droppedAfterHours).toBe(0);
    expect(r2.printCount).toBe(6);
  });

  it('flags windowTruncated only when the 500-cap cuts into the requested window (audit #6)', () => {
    // Capped fetch whose oldest raw print (offset 0) is NEWER than the
    // 120-min window start → the cap cut into our window: truncated.
    const capped = Array.from({ length: FETCH_CAP }, (_, i) =>
      print({ executed_at: minuteOffset(i % 30) })
    );
    expect(
      classifyDarkPool(capped, {
        asOf: RTH_BASE + 31 * 60 * 1000,
        lookbackMinutes: 120,
      }).windowTruncated
    ).toBe(true);

    // Capped fetch that spans PAST the window start (10-min lookback, oldest
    // print 29 min back) → the cap cut history we didn't ask for: NOT truncated.
    expect(
      classifyDarkPool(capped, {
        asOf: RTH_BASE + 29 * 60 * 1000,
        lookbackMinutes: 10,
      }).windowTruncated
    ).toBe(false);

    // Uncapped sparse fetch (6 prints, 120-min lookback): UW returned
    // everything it has — a quiet tape is not truncation.
    const short = Array.from({ length: 6 }, (_, i) =>
      print({ executed_at: minuteOffset(i) })
    );
    expect(
      classifyDarkPool(short, {
        asOf: RTH_BASE + 5 * 60 * 1000,
        lookbackMinutes: 120,
      }).windowTruncated
    ).toBe(false);
  });

  it('bearish is exactly symmetric to bullish', () => {
    const sells = Array.from({ length: 6 }, (_, i) =>
      sellPrint({ executed_at: minuteOffset(i) })
    );
    const r = classifyDarkPool(sells, { asOf: RTH_BASE + 10 * 60 * 1000 });
    expect(r.sentiment).toBe('bearish');
    expect(r.score).toBeGreaterThan(0);

    const buys = Array.from({ length: 6 }, (_, i) =>
      print({ executed_at: minuteOffset(i) })
    );
    const b = classifyDarkPool(buys, { asOf: RTH_BASE + 10 * 60 * 1000 });
    expect(b.sentiment).toBe('bullish');
    expect(b.score).toBeCloseTo(r.score, 10); // mirror-image inputs, same score
  });

  it('is deterministic without asOf: anchors to the newest print (pure replay)', () => {
    const prints = Array.from({ length: 6 }, (_, i) =>
      print({ executed_at: minuteOffset(i) })
    );
    const a = classifyDarkPool(prints);
    const b = classifyDarkPool(prints);
    expect(a).toEqual(b);
    expect(a.sentiment).toBe('bullish');
  });

  it('handles empty input', () => {
    const r = classifyDarkPool([]);
    expect(r.sentiment).toBe('neutral');
    expect(r.reasons[0]).toMatch(/no dark pool prints/);
  });
});
