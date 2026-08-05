import { describe, it, expect } from 'vitest';
import { shouldApplyAiAdjustment } from '../semiAiAdjustmentGuard.js';

const NOW = Date.parse('2026-08-05T18:00:00.000Z');

const analysis = (over = {}) => ({
  confidenceAdjustment: -15,
  timestamp: new Date(NOW).toISOString(),
  inputData: { phase: 'ACTIVE' },
  ...over,
});

describe('shouldApplyAiAdjustment', () => {
  it('applies a fresh, phase-matched adjustment', () => {
    const r = shouldApplyAiAdjustment(analysis(), 'ACTIVE', NOW);
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('fresh');
  });

  it('skips when the analysis is older than the max age (10 min)', () => {
    const old = analysis({ timestamp: new Date(NOW - 11 * 60 * 1000).toISOString() });
    const r = shouldApplyAiAdjustment(old, 'ACTIVE', NOW);
    expect(r.apply).toBe(false);
    expect(r.reason).toMatch(/^stale/);
  });

  it('skips when the analysis phase no longer matches the current phase', () => {
    const stalePhase = analysis({ inputData: { phase: 'OPEN' } });
    const r = shouldApplyAiAdjustment(stalePhase, 'ACTIVE', NOW);
    expect(r.apply).toBe(false);
    expect(r.reason).toMatch(/^phase-mismatch/);
  });

  it('does not apply when there is no adjustment', () => {
    expect(shouldApplyAiAdjustment(null, 'ACTIVE', NOW).apply).toBe(false);
    expect(shouldApplyAiAdjustment(analysis({ confidenceAdjustment: 0 }), 'ACTIVE', NOW).apply).toBe(false);
  });

  it('applies when phase metadata is absent (cannot prove mismatch)', () => {
    const noPhase = analysis({ inputData: {} });
    expect(shouldApplyAiAdjustment(noPhase, 'ACTIVE', NOW).apply).toBe(true);
  });

  it('applies when timestamp is absent (age unknown → treated as fresh)', () => {
    const noTs = analysis({ timestamp: null });
    expect(shouldApplyAiAdjustment(noTs, 'ACTIVE', NOW).apply).toBe(true);
  });
});
