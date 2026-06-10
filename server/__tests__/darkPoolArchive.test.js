import { describe, it, expect } from 'vitest';
import {
  mergePrints,
  dedupeKey,
  coverageOf,
  captureMetaOf,
  etDateOf,
  CAP_COUNT,
} from '../darkPoolArchive.js';

const print = (over = {}) => ({
  tracking_id: over.tracking_id,
  executed_at: '2026-06-10T14:30:00Z',
  price: '100.00',
  size: 500,
  premium: '50000',
  nbbo_bid: '99.98',
  nbbo_ask: '100.02',
  ...over,
});

describe('darkPoolArchive pure helpers', () => {
  it('dedupeKey prefers tracking_id and falls back to composite', () => {
    expect(dedupeKey(print({ tracking_id: 'abc' }))).toBe('abc');
    expect(dedupeKey(print({ tracking_id: undefined }))).toBe(
      '2026-06-10T14:30:00Z|100.00|500'
    );
  });

  it('mergePrints dedupes across overlapping captures and keeps first copy', () => {
    const a = [
      print({ tracking_id: '1', executed_at: '2026-06-10T14:00:00Z' }),
      print({ tracking_id: '2', executed_at: '2026-06-10T14:05:00Z' }),
    ];
    const b = [
      print({ tracking_id: '2', executed_at: '2026-06-10T14:05:00Z' }), // dup
      print({ tracking_id: '3', executed_at: '2026-06-10T13:55:00Z' }), // earlier
    ];
    const merged = mergePrints(a, b);
    expect(merged).toHaveLength(3);
    // sorted ascending by executed_at
    expect(merged.map(p => p.tracking_id)).toEqual(['3', '1', '2']);
    // a second merge of the same batch is a no-op
    expect(mergePrints(merged, b)).toHaveLength(3);
  });

  it('mergePrints sorts timestamp-less prints last', () => {
    const merged = mergePrints(
      [print({ tracking_id: 'x', executed_at: null })],
      [print({ tracking_id: 'y', executed_at: '2026-06-10T15:59:00Z' })]
    );
    expect(merged.map(p => p.tracking_id)).toEqual(['y', 'x']);
  });

  it('captureMetaOf flags a capped fetch at CAP_COUNT rows', () => {
    const rows = Array.from({ length: CAP_COUNT }, (_, i) =>
      print({ tracking_id: `t${i}` })
    );
    const meta = captureMetaOf(rows, '2026-06-10T19:55:00Z');
    expect(meta.capped).toBe(true);
    expect(meta.count).toBe(CAP_COUNT);
    expect(captureMetaOf(rows.slice(0, 10), 'x').capped).toBe(false);
  });

  it('captureMetaOf detects the cap from the RAW count even when date filtering kept few rows', () => {
    // A 500-row fetch straddling midnight keeps only today's rows, but the
    // fetch itself was still truncated — capped must reflect the raw response.
    const kept = [print({ tracking_id: 'k1' })];
    const meta = captureMetaOf(kept, 'now', CAP_COUNT);
    expect(meta.capped).toBe(true);
    expect(meta.count).toBe(CAP_COUNT);
    expect(meta.kept).toBe(1);
  });

  it('etDateOf converts UTC timestamps to the ET calendar date', () => {
    // 01:30Z on 06-10 is 21:30 ET on 06-09 — belongs to the prior ET day.
    expect(etDateOf('2026-06-10T01:30:00Z')).toBe('2026-06-09');
    expect(etDateOf('2026-06-10T14:30:00Z')).toBe('2026-06-10');
    expect(etDateOf(null)).toBe(null);
    expect(etDateOf('garbage')).toBe(null);
  });

  it('captureMetaOf reports oldest/newest executed_at of the fetch', () => {
    const meta = captureMetaOf(
      [
        print({ tracking_id: 'a', executed_at: '2026-06-10T15:00:00Z' }),
        print({ tracking_id: 'b', executed_at: '2026-06-10T14:00:00Z' }),
        print({ tracking_id: 'c', executed_at: null }),
      ],
      'now'
    );
    expect(meta.oldestExecutedAt).toBe('2026-06-10T14:00:00Z');
    expect(meta.newestExecutedAt).toBe('2026-06-10T15:00:00Z');
  });

  it('coverageOf summarizes merged prints + capture log', () => {
    const prints = mergePrints(
      [print({ tracking_id: '1', executed_at: '2026-06-10T13:31:00Z' })],
      [print({ tracking_id: '2', executed_at: '2026-06-10T19:59:00Z' })]
    );
    const captures = [
      { at: 'a', count: 500, capped: true },
      { at: 'b', count: 120, capped: false },
    ];
    const cov = coverageOf(prints, captures);
    expect(cov.firstExecutedAt).toBe('2026-06-10T13:31:00Z');
    expect(cov.lastExecutedAt).toBe('2026-06-10T19:59:00Z');
    expect(cov.uniquePrints).toBe(2);
    expect(cov.cappedFetches).toBe(1);
  });
});
