import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock polygonClient BEFORE importing the sentiment engine — it's required
// at module top level. We only need getAggregates for these tests.
vi.mock('../polygonClient', () => ({
  default: { getAggregates: vi.fn() },
  getAggregates: vi.fn(),
}));

const polygonClient = await import('../polygonClient');
const { SemiconductorSentimentEngine } = await import('../semiconductorSentiment.js');

describe('semiconductorSentiment — stale-while-error fallback', () => {
  // Regression: prior to 2026-05-06, any failed Polygon fetch (incl. transient
  // ENOTFOUND DNS hiccups) returned confidence: 0, which slammed the market
  // gate shut. Cost ~3 trading days of missed SOXL run (+24% move).
  // The catch block should now fall back to the most recent cached sentiment
  // when one exists within 30 minutes, and only hard-fail to confidence:0
  // when there is no usable cache.
  let engine;

  beforeEach(() => {
    engine = new SemiconductorSentimentEngine();
    vi.clearAllMocks();
  });

  it('returns cached sentiment marked stale when fetch fails and cache is recent', async () => {
    engine.sentimentCache = {
      direction: 'bullish',
      confidence: 65,
      currentPrice: '503.50',
      signals: ['SOXX up 0.53% from open'],
    };
    engine.lastUpdate = Date.now() - 60_000; // 1 min ago, well within tolerance

    polygonClient.getAggregates.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.polygon.io')
    );

    const result = await engine.getSentiment(true);

    expect(result.confidence, 'should reuse cached confidence, not degrade to 0').toBe(65);
    expect(result.direction).toBe('bullish');
    expect(result.stale).toBe(true);
    expect(typeof result.staleReason).toBe('string');
    expect(result.staleReason.length).toBeGreaterThan(0);
  });

  it('returns confidence:0 when fetch fails and there is no cache at all', async () => {
    engine.sentimentCache = null;
    engine.lastUpdate = null;

    polygonClient.getAggregates.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.polygon.io')
    );

    const result = await engine.getSentiment(true);

    expect(result.confidence).toBe(0);
    expect(result.direction).toBe('neutral');
    expect(result.canTrade).toBe(false);
  });

  it('returns confidence:0 when fetch fails and cache is older than 30 min', async () => {
    engine.sentimentCache = { direction: 'bullish', confidence: 65 };
    engine.lastUpdate = Date.now() - 35 * 60 * 1000; // 35 min ago, past tolerance

    polygonClient.getAggregates.mockRejectedValueOnce(
      new Error('getaddrinfo ENOTFOUND api.polygon.io')
    );

    const result = await engine.getSentiment(true);

    expect(result.confidence).toBe(0);
    expect(result.direction).toBe('neutral');
  });
});
