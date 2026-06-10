import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../unusualWhalesClient.js'), 'utf8');

// Stand-in for the deferred certify-dark-pool.js (certification reports
// expire in 30 days; writing one before >= 60 archived days exist would be
// wasted). The honesty requirement it covers: the LIVE wrapper must delegate
// classification to @keo/quant-core darkPoolCore — the same function the B6
// event-study will replay archived days through — and must not keep a local
// classification path that could drift.

describe('analyzeDarkPool — wrapper ≡ darkPoolCore (deferred-cert stand-in)', () => {
  const fnSrc = (() => {
    const start = src.indexOf('async function analyzeDarkPool');
    expect(start).toBeGreaterThan(-1);
    // Body starts at the first brace AFTER the parameter list closes —
    // `opts = {}` in the signature would fool a naive first-brace matcher.
    const paramsEnd = src.indexOf(')', start);
    const i = src.indexOf('{', paramsEnd);
    let depth = 1;
    let j = i + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    return src.slice(start, j);
  })();

  it('delegates classification to darkPoolCore.classifyDarkPool', () => {
    expect(fnSrc).toContain('darkPoolCore.classifyDarkPool(');
    expect(src).toMatch(/require\('@keo\/quant-core'\)/);
  });

  it('keeps NO local classification logic (the audit-biased price >= mid rule is gone)', () => {
    expect(fnSrc).not.toContain('price >= mid');
    expect(fnSrc).not.toContain('buyPremium +=');
    expect(fnSrc).not.toMatch(/mid\s*=\s*ask/);
  });

  it('passes every integrity-guard option through to the core', () => {
    for (const opt of [
      'dropAtMid',
      'maxSinglePrintShare',
      'minPrints',
      'rthOnly',
      'lookbackMinutes',
      'minPremium',
      'minBuyShare',
    ]) {
      expect(fnSrc).toContain(`${opt}: opts.${opt}`);
    }
  });

  it('maps lastPrice from lastRthPrice (never an after-hours print)', () => {
    expect(fnSrc).toMatch(/lastPrice:\s*r\.lastRthPrice/);
  });
});

describe('analyzeDarkPool — unconfigured behavior preserved', () => {
  let saved;
  beforeEach(() => {
    saved = process.env.UNUSUAL_WHALES_API_KEY;
    delete process.env.UNUSUAL_WHALES_API_KEY;
  });
  afterEach(() => {
    if (saved !== undefined) process.env.UNUSUAL_WHALES_API_KEY = saved;
  });

  it('returns configured:false without a key (plugin no-ops instead of throwing)', async () => {
    const { createRequire } = await import('node:module');
    const requireCjs = createRequire(import.meta.url);
    const uw = requireCjs('../unusualWhalesClient.js');
    const r = await uw.analyzeDarkPool('NVDA');
    expect(r.configured).toBe(false);
    expect(r.sentiment).toBe(null);
  });
});
