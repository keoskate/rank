#!/usr/bin/env node
/**
 * Golden Fixture Capture
 *
 * Captures input/output pairs for pure modules so we can lock in current
 * behavior before any extraction. After modules are moved into packages,
 * tests assert the extracted code reproduces these exact outputs.
 *
 * Run:  node scripts/capture-fixtures.js
 * Out:  fixtures/golden/<module>.json
 *
 * Add a new module by writing a capture<Module>() function below and
 * pushing it to the CAPTURES array. Inputs should cover:
 *   - representative happy paths
 *   - edge cases (unknown symbol, null, empty, DST boundary)
 *   - boundary conditions (exact threshold values)
 */

const fs = require('fs');
const path = require('path');
const { normalize } = require('./fixture-normalize');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'golden');
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

function save(name, data) {
  const normalized = normalize(data);
  const file = path.join(FIXTURES_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n');
  const lines = JSON.stringify(normalized, null, 2).split('\n').length;
  console.log(`  ${name}.json   (${lines} lines)`);
}

// ─────────────────────────────────────────────────────────────────
// tradingCalculations.js
// ─────────────────────────────────────────────────────────────────
function captureTradingCalculations() {
  const tc = require('../server/tradingCalculations');

  const symbols = [
    'SOXL', 'SOXS', 'QBTX', 'QBTZ', 'TQQQ', 'SQQQ', 'SPXL', 'SPXS',
    'PLTU', 'UPRO', 'TECL', 'TECS', 'FNGU', 'FNGD',
    'AAPL', 'SPY', 'QQQ', 'BTCUSD', 'ETHUSD',
    'soxl', 'Soxl', 'unknown_symbol', '',
  ];

  // Fixed timestamps covering DST boundaries, weekends, market hours
  const dates = [
    '2026-01-15T14:30:00Z', // EST, market open (9:30 ET)
    '2026-01-15T20:59:00Z', // EST, 1 min before close (3:59 ET)
    '2026-01-15T21:01:00Z', // EST, 1 min after close (4:01 ET)
    '2026-01-15T08:00:00Z', // EST, pre-market (3:00 ET)
    '2026-01-15T09:00:00Z', // EST, premarket open (4:00 ET)
    '2026-06-15T13:30:00Z', // EDT, market open (9:30 ET)
    '2026-06-15T19:59:00Z', // EDT, near close (3:59 ET)
    '2026-03-08T09:00:00Z', // DST start day (US)
    '2026-11-01T09:00:00Z', // DST end day (US)
    '2026-01-17T15:00:00Z', // Saturday, market closed
    '2026-12-25T15:00:00Z', // Christmas, holiday
    '2026-07-04T15:00:00Z', // Independence Day
  ];

  return {
    constants: {
      BULLISH_ETFS: tc.BULLISH_ETFS,
      BEARISH_ETFS: tc.BEARISH_ETFS,
    },
    getEtfLeverage: Object.fromEntries(symbols.map(s => [s, tc.getEtfLeverage(s)])),
    getOppositeEtf: Object.fromEntries(symbols.map(s => [s, tc.getOppositeEtf(s)])),
    isDST: Object.fromEntries(dates.map(d => [d, tc.isDST(new Date(d))])),
    getEasternOffset: Object.fromEntries(dates.map(d => [d, tc.getEasternOffset(new Date(d))])),
    getEasternMinutes: Object.fromEntries(dates.map(d => [d, tc.getEasternMinutes(new Date(d))])),
    getMinutesUntilClose: Object.fromEntries(dates.map(d => [d, tc.getMinutesUntilClose(new Date(d))])),
    isMarketOpen: Object.fromEntries(dates.map(d => [d, tc.isMarketOpen(new Date(d))])),
    isExtendedHoursOpen: Object.fromEntries(dates.map(d => [d, tc.isExtendedHoursOpen(new Date(d))])),
    getMarketHolidays_2026: tc.getMarketHolidays(2026),
    getMarketHolidays_2025: tc.getMarketHolidays(2025),
    calculateQuantity: [
      // [params, expected output]
      { in: { maxPositionValue: 8000, currentPrice: 125.50, riskAmount: 200, stopLoss: 122 }, out: tc.calculateQuantity({ maxPositionValue: 8000, currentPrice: 125.50, riskAmount: 200, stopLoss: 122 }) },
      { in: { maxPositionValue: 15000, currentPrice: 161.47, riskAmount: 375, stopLoss: 157.43 }, out: tc.calculateQuantity({ maxPositionValue: 15000, currentPrice: 161.47, riskAmount: 375, stopLoss: 157.43 }) },
      { in: { maxPositionValue: 25000, currentPrice: 76000, riskAmount: 500, stopLoss: 75240, isCrypto: true }, out: tc.calculateQuantity({ maxPositionValue: 25000, currentPrice: 76000, riskAmount: 500, stopLoss: 75240, isCrypto: true }) },
      { in: { maxPositionValue: 0, currentPrice: 100, riskAmount: 0, stopLoss: 99 }, out: tc.calculateQuantity({ maxPositionValue: 0, currentPrice: 100, riskAmount: 0, stopLoss: 99 }) },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────
// leveragedEtfStrategy.js  (class)
// ─────────────────────────────────────────────────────────────────
function captureLeveragedEtfStrategy() {
  const LeveragedEtfStrategy = require('../server/leveragedEtfStrategy');
  const s = new LeveragedEtfStrategy();

  const symbols = ['SOXL', 'SOXS', 'QBTX', 'QBTZ', 'TQQQ', 'PLTU', 'AAPL', 'unknown'];

  return {
    getSupportedFamilies: s.getSupportedFamilies(),
    isSupported: Object.fromEntries(symbols.map(sym => [sym, s.isSupported(sym)])),
    getFamily: Object.fromEntries(symbols.map(sym => [sym, s.getFamily(sym)])),
    analyzeFlowSentiment: [
      { in: null, out: s.analyzeFlowSentiment(null) },
      { in: { putCallRatio: 0.5 }, out: s.analyzeFlowSentiment({ putCallRatio: 0.5 }) },
      { in: { putCallRatio: 1.5 }, out: s.analyzeFlowSentiment({ putCallRatio: 1.5 }) },
      { in: { callFlowPercent: 90, putFlowPercent: 10 }, out: s.analyzeFlowSentiment({ callFlowPercent: 90, putFlowPercent: 10 }) },
      { in: { callFlowPercent: 10, putFlowPercent: 90 }, out: s.analyzeFlowSentiment({ callFlowPercent: 10, putFlowPercent: 90 }) },
      { in: { sentimentText: 'strongly bullish' }, out: s.analyzeFlowSentiment({ sentimentText: 'strongly bullish' }) },
      { in: { sentimentText: 'bearish reversal' }, out: s.analyzeFlowSentiment({ sentimentText: 'bearish reversal' }) },
    ],
    makeDecision: [
      { in: ['bullish', { sentiment: 'bullish', confidence: 80 }, 'semiconductor'], out: s.makeDecision('bullish', { sentiment: 'bullish', confidence: 80 }, 'semiconductor') },
      { in: ['bearish', { sentiment: 'bearish', confidence: 75 }, 'semiconductor'], out: s.makeDecision('bearish', { sentiment: 'bearish', confidence: 75 }, 'semiconductor') },
      { in: ['neutral', { sentiment: 'neutral', confidence: 50 }, 'semiconductor'], out: s.makeDecision('neutral', { sentiment: 'neutral', confidence: 50 }, 'semiconductor') },
      { in: ['bullish', { sentiment: 'bearish', confidence: 70 }, 'semiconductor'], out: s.makeDecision('bullish', { sentiment: 'bearish', confidence: 70 }, 'semiconductor') },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────
// leveragedEtfRules.js  (class)
// ─────────────────────────────────────────────────────────────────
function captureLeveragedEtfRules() {
  const LeveragedEtfRules = require('../server/leveragedEtfRules');
  const r = new LeveragedEtfRules();

  const symbols = ['SOXL', 'SOXS', 'QBTX', 'TQQQ', 'AAPL', 'unknown'];

  // Times spanning the trading day for applyConstraints
  const fixedTimes = [
    new Date('2026-04-15T14:00:00Z'), // 10:00 ET — early entry allowed
    new Date('2026-04-15T17:00:00Z'), // 13:00 ET — mid-day
    new Date('2026-04-15T18:30:00Z'), // 14:30 ET — past noNewPositionsAfter for SOXS-likes?
    new Date('2026-04-15T19:55:00Z'), // 15:55 ET — force exit time
    new Date('2026-04-15T20:00:00Z'), // 16:00 ET — close
  ];

  const constraintScenarios = [];
  for (const sym of ['SOXL', 'SOXS', 'AAPL']) {
    for (const time of fixedTimes) {
      const decision = { action: 'BUY', symbol: sym, confidence: 75 };
      const noPosition = null;
      const heldPosition = { entryTime: new Date('2026-04-14T18:00:00Z'), symbol: sym }; // overnight
      constraintScenarios.push({
        in: { sym, decision, time: time.toISOString(), position: noPosition, vix: null },
        out: r.applyConstraints(sym, { ...decision }, time, noPosition, null),
      });
      constraintScenarios.push({
        in: { sym, decision, time: time.toISOString(), position: { entryTime: heldPosition.entryTime.toISOString(), symbol: sym }, vix: 35 },
        out: r.applyConstraints(sym, { ...decision }, time, heldPosition, 35),
      });
    }
  }

  return {
    isLeveraged: Object.fromEntries(symbols.map(s => [s, r.isLeveraged(s)])),
    getLeverage: Object.fromEntries(symbols.map(s => [s, r.getLeverage(s)])),
    getInfo: Object.fromEntries(symbols.map(s => [s, r.getInfo(s)])),
    getBacktestProxy: Object.fromEntries(symbols.map(s => [s, r.getBacktestProxy(s)])),
    calculateExpectedDecay: {
      SOXL_1d: r.calculateExpectedDecay('SOXL', 1),
      SOXL_5d: r.calculateExpectedDecay('SOXL', 5),
      SOXL_30d: r.calculateExpectedDecay('SOXL', 30),
      AAPL_1d: r.calculateExpectedDecay('AAPL', 1),
    },
    isOvernight: {
      same_day: r.isOvernight(new Date('2026-04-15T14:00:00Z'), new Date('2026-04-15T19:00:00Z')),
      next_day: r.isOvernight(new Date('2026-04-14T19:00:00Z'), new Date('2026-04-15T14:00:00Z')),
      null_entry: r.isOvernight(null, new Date('2026-04-15T14:00:00Z')),
    },
    timeToDecimal: {
      morning: r.timeToDecimal(new Date('2026-04-15T13:30:00Z')), // 9:30 ET
      noon: r.timeToDecimal(new Date('2026-04-15T16:00:00Z')),    // 12:00 ET
      close: r.timeToDecimal(new Date('2026-04-15T20:00:00Z')),   // 16:00 ET
    },
    applyConstraints: constraintScenarios,
  };
}

// ─────────────────────────────────────────────────────────────────
const CAPTURES = [
  ['tradingCalculations', captureTradingCalculations],
  ['leveragedEtfStrategy', captureLeveragedEtfStrategy],
  ['leveragedEtfRules', captureLeveragedEtfRules],
];

console.log(`Capturing golden fixtures → ${path.relative(process.cwd(), FIXTURES_DIR)}/`);
for (const [name, fn] of CAPTURES) {
  try {
    save(name, fn());
  } catch (err) {
    console.error(`  ${name}: FAILED — ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}
console.log(`\nCaptured ${CAPTURES.length} module fixtures.`);
