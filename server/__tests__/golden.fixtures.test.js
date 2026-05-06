import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', '..', 'fixtures', 'golden');
const requireCjs = createRequire(import.meta.url);
const { normalize } = requireCjs('../../scripts/fixture-normalize.js');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
}

// Normalize live outputs the same way the capture script does, then do a
// JSON round-trip so undefined fields, NaN, and Date objects flatten the
// same way fixtures do on disk. This makes the comparison apples-to-apples.
function n(v) {
  return JSON.parse(JSON.stringify(normalize(v)));
}

// ─────────────────────────────────────────────────────────────────
// Golden contract tests.
//
// The fixtures in fixtures/golden/ are snapshots of input → output
// pairs captured from the live code via scripts/capture-fixtures.js.
//
// These tests assert the current implementation reproduces those
// outputs exactly. Their real purpose is to catch behavior change
// during refactors — especially when modules get extracted into
// separate packages. Move the import path, run the suite, and any
// drift in output (rounding, edge case, threshold) lights up here.
//
// To regenerate after an INTENTIONAL behavior change:
//   1. Update the source module
//   2. node scripts/capture-fixtures.js   (re-captures from new code)
//   3. git diff fixtures/golden/          (review what changed)
//   4. Commit fixture + code together
// ─────────────────────────────────────────────────────────────────

describe('golden fixtures: tradingCalculations', () => {
  const fixture = loadFixture('tradingCalculations');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tc = require('../tradingCalculations.js');

  it('exported constants match', () => {
    expect(tc.BULLISH_ETFS).toEqual(fixture.constants.BULLISH_ETFS);
    expect(tc.BEARISH_ETFS).toEqual(fixture.constants.BEARISH_ETFS);
  });

  it('getEtfLeverage matches captured outputs', () => {
    for (const [sym, expected] of Object.entries(fixture.getEtfLeverage)) {
      expect(tc.getEtfLeverage(sym), `getEtfLeverage('${sym}')`).toBe(expected);
    }
  });

  it('getOppositeEtf matches captured outputs', () => {
    for (const [sym, expected] of Object.entries(fixture.getOppositeEtf)) {
      expect(tc.getOppositeEtf(sym), `getOppositeEtf('${sym}')`).toBe(expected);
    }
  });

  it('isDST/getEasternOffset/getEasternMinutes match for fixed dates', () => {
    for (const [iso, expected] of Object.entries(fixture.isDST)) {
      expect(tc.isDST(new Date(iso)), `isDST(${iso})`).toBe(expected);
    }
    for (const [iso, expected] of Object.entries(fixture.getEasternOffset)) {
      expect(tc.getEasternOffset(new Date(iso)), `getEasternOffset(${iso})`).toBe(expected);
    }
    for (const [iso, expected] of Object.entries(fixture.getEasternMinutes)) {
      expect(tc.getEasternMinutes(new Date(iso)), `getEasternMinutes(${iso})`).toBe(expected);
    }
  });

  it('isMarketOpen / isExtendedHoursOpen / getMinutesUntilClose match', () => {
    for (const [iso, expected] of Object.entries(fixture.isMarketOpen)) {
      expect(tc.isMarketOpen(new Date(iso)), `isMarketOpen(${iso})`).toBe(expected);
    }
    for (const [iso, expected] of Object.entries(fixture.isExtendedHoursOpen)) {
      expect(tc.isExtendedHoursOpen(new Date(iso)), `isExtendedHoursOpen(${iso})`).toBe(expected);
    }
    for (const [iso, expected] of Object.entries(fixture.getMinutesUntilClose)) {
      expect(tc.getMinutesUntilClose(new Date(iso)), `getMinutesUntilClose(${iso})`).toBe(expected);
    }
  });

  it('getMarketHolidays for 2025 and 2026 match', () => {
    expect(n(tc.getMarketHolidays(2025))).toEqual(fixture.getMarketHolidays_2025);
    expect(n(tc.getMarketHolidays(2026))).toEqual(fixture.getMarketHolidays_2026);
  });

  it('calculateQuantity matches captured outputs', () => {
    for (const { in: input, out: expected } of fixture.calculateQuantity) {
      expect(tc.calculateQuantity(input), `calculateQuantity(${JSON.stringify(input)})`).toEqual(expected);
    }
  });
});

describe('golden fixtures: leveragedEtfStrategy', () => {
  const fixture = loadFixture('leveragedEtfStrategy');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const LeveragedEtfStrategy = require('../leveragedEtfStrategy.js');
  const s = new LeveragedEtfStrategy();

  it('getSupportedFamilies matches', () => {
    expect(s.getSupportedFamilies()).toEqual(fixture.getSupportedFamilies);
  });

  it('isSupported and getFamily match for all symbols', () => {
    for (const [sym, expected] of Object.entries(fixture.isSupported)) {
      expect(s.isSupported(sym), `isSupported('${sym}')`).toBe(expected);
    }
    for (const [sym, expected] of Object.entries(fixture.getFamily)) {
      expect(s.getFamily(sym), `getFamily('${sym}')`).toEqual(expected);
    }
  });

  it('analyzeFlowSentiment matches captured scenarios', () => {
    for (const { in: input, out: expected } of fixture.analyzeFlowSentiment) {
      expect(s.analyzeFlowSentiment(input), `analyzeFlowSentiment(${JSON.stringify(input)})`).toEqual(expected);
    }
  });

  it('makeDecision matches captured scenarios', () => {
    for (const { in: input, out: expected } of fixture.makeDecision) {
      const [regime, flow, family] = input;
      expect(n(s.makeDecision(regime, flow, family)), `makeDecision(${JSON.stringify(input)})`).toEqual(expected);
    }
  });
});

describe('golden fixtures: leveragedEtfRules', () => {
  const fixture = loadFixture('leveragedEtfRules');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const LeveragedEtfRules = require('../leveragedEtfRules.js');
  const r = new LeveragedEtfRules();

  it('isLeveraged / getLeverage / getInfo / getBacktestProxy match', () => {
    for (const [sym, expected] of Object.entries(fixture.isLeveraged)) {
      expect(r.isLeveraged(sym), `isLeveraged('${sym}')`).toBe(expected);
    }
    for (const [sym, expected] of Object.entries(fixture.getLeverage)) {
      expect(r.getLeverage(sym), `getLeverage('${sym}')`).toBe(expected);
    }
    for (const [sym, expected] of Object.entries(fixture.getInfo)) {
      expect(r.getInfo(sym), `getInfo('${sym}')`).toEqual(expected);
    }
    for (const [sym, expected] of Object.entries(fixture.getBacktestProxy)) {
      expect(r.getBacktestProxy(sym), `getBacktestProxy('${sym}')`).toEqual(expected);
    }
  });

  it('calculateExpectedDecay matches', () => {
    expect(r.calculateExpectedDecay('SOXL', 1)).toEqual(fixture.calculateExpectedDecay.SOXL_1d);
    expect(r.calculateExpectedDecay('SOXL', 5)).toEqual(fixture.calculateExpectedDecay.SOXL_5d);
    expect(r.calculateExpectedDecay('SOXL', 30)).toEqual(fixture.calculateExpectedDecay.SOXL_30d);
    expect(r.calculateExpectedDecay('AAPL', 1)).toEqual(fixture.calculateExpectedDecay.AAPL_1d);
  });

  it('isOvernight matches', () => {
    expect(r.isOvernight(new Date('2026-04-15T14:00:00Z'), new Date('2026-04-15T19:00:00Z'))).toBe(fixture.isOvernight.same_day);
    expect(r.isOvernight(new Date('2026-04-14T19:00:00Z'), new Date('2026-04-15T14:00:00Z'))).toBe(fixture.isOvernight.next_day);
    expect(r.isOvernight(null, new Date('2026-04-15T14:00:00Z'))).toBe(fixture.isOvernight.null_entry);
  });

  it('timeToDecimal matches', () => {
    expect(r.timeToDecimal(new Date('2026-04-15T13:30:00Z'))).toBe(fixture.timeToDecimal.morning);
    expect(r.timeToDecimal(new Date('2026-04-15T16:00:00Z'))).toBe(fixture.timeToDecimal.noon);
    expect(r.timeToDecimal(new Date('2026-04-15T20:00:00Z'))).toBe(fixture.timeToDecimal.close);
  });

  it('applyConstraints reproduces captured decisions exactly', () => {
    for (const { in: input, out: expected } of fixture.applyConstraints) {
      const decision = { ...input.decision };
      const time = new Date(input.time);
      const position = input.position
        ? { ...input.position, entryTime: new Date(input.position.entryTime) }
        : null;
      const got = r.applyConstraints(input.sym, decision, time, position, input.vix);
      expect(n(got), `applyConstraints(${input.sym} @ ${input.time})`).toEqual(expected);
    }
  });
});
