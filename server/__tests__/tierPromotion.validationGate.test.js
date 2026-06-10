import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const {
  evaluateBroker,
  evaluateValidationGate,
  REQUIRES_EVENT_VALIDATION,
  PROMOTE,
} = requireCjs('../brokers/tierPromotion.js');

// A sim session whose AGGREGATE stats and PER-SOURCE edge gate both pass —
// before the validation gate existed, this promoted to paper. The gate must
// hold it at sim until the event-study writes a VALIDATED verdict to
// data/backtests/validated-sources.json (which does not exist in this repo
// state — that absence is exactly what we assert against).
function passingSession(source, nTrades = 120) {
  const start = new Date(Date.now() - 30 * 864e5).toISOString();
  // Steady winners: high expectancy with tiny variance → significance passes.
  const trades = Array.from({ length: nTrades }, (_, i) => ({
    side: 'sell',
    symbol: 'TEST',
    source,
    realizedPct: 0.8 + (i % 3) * 0.05, // 0.8/0.85/0.9% per trade
    realizedPnL: 80,
    timestamp: new Date(Date.now() - (nTrades - i) * 36e5).toISOString(),
  }));
  return {
    sessionId: 'test-session',
    status: 'running',
    startTime: start,
    stats: { wins: nTrades, losses: 0, maxDrawdown: 2 },
    tradingLog: trades,
    dailyReturns: Array.from({ length: 25 }, (_, i) => ({
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      returnPct: 0.5,
    })),
  };
}

const broker = slug => ({ slug, tier: 'simulated' });

describe('tierPromotion validation gate (ROADMAP B6)', () => {
  it('covers exactly the three event-driven sources', () => {
    expect([...REQUIRES_EVENT_VALIDATION].sort()).toEqual([
      'dark-pool',
      'insider-following',
      'options-flow',
    ]);
  });

  it('dark-pool: aggregate + edge gate pass, promotion still HELD with archive progress', () => {
    const session = passingSession('dark-pool');
    const d = evaluateBroker(broker('volume-hunter'), session, { events: [] });
    // Sanity: this session genuinely clears the aggregate bars…
    expect(session.tradingLog.length).toBeGreaterThanOrEqual(PROMOTE.minTrades);
    // …yet the decision is hold, attributed to the validation gate.
    expect(d.action).toBe('hold');
    expect(d.reason).toMatch(/validation gate blocked promotion/);
    expect(d.reason).toMatch(/dark-pool unvalidated/);
    expect(d.reason).toMatch(/archive \d+\/60 days/);
  });

  it('insider-following and options-flow are also held (B6 hard dependency)', () => {
    for (const source of ['insider-following', 'options-flow']) {
      const d = evaluateBroker(broker('any-broker'), passingSession(source), {
        events: [],
      });
      expect(d.action).toBe('hold');
      expect(d.reason).toMatch(/validation gate blocked promotion/);
    }
  });

  it('non-event sources are unaffected by the gate', () => {
    expect(evaluateValidationGate('trend-following').pass).toBe(true);
    expect(evaluateValidationGate(null).pass).toBe(true);
    // The full decision for a passing trend session must NOT mention the gate.
    const d = evaluateBroker(
      broker('trend-follower'),
      passingSession('trend-following'),
      { events: [] }
    );
    expect(['promote', 'hold']).toContain(d.action);
    expect(d.reason).not.toMatch(/validation gate/i);
  });
});
