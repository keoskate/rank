/**
 * Scanner orchestrator — fetches bars for a symbol universe, scores
 * each via the probability + target models, ranks by expected value,
 * persists, and returns a ranked opportunity list.
 *
 * Wired into Express routes via routes/scanner.js.
 */

const polygonClient = require('../polygonClient');
const technicalIndicators = require('../technicalIndicatorsService');
const patternRecognitionService = require('../patternRecognitionService');
const signalEvaluator = require('../signalEvaluator');
const { computeProbability } = require('./probabilityModel');
const { deriveTargets } = require('./targetModel');
const scanCache = require('./scanCache');
const scanStore = require('./scanStore');
const { getDefaultUniverse } = require('./universe');

const DEFAULT_HORIZON_DAYS = 5;
const DEFAULT_MIN_PROBABILITY = 0.55;
const DEFAULT_MAX_RESULTS = 25;
const LOOKBACK_DAYS = 120; // daily bars; 120 cal days ~= 80 trading days (need 50+ for indicators)

function _dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function _fetchBarsCached(symbol) {
  const key = `${symbol}|${_dateKey()}`;
  const cached = scanCache.get(key);
  if (cached) return cached;

  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 86400000);
  try {
    const bars = await polygonClient.getAggregates(symbol, 1, 'day', { from, to });
    if (Array.isArray(bars) && bars.length >= 30) {
      scanCache.set(key, bars);
    }
    return bars;
  } catch (err) {
    return null;
  }
}

async function _scoreSymbol(symbol, horizonDays) {
  const bars = await _fetchBarsCached(symbol);
  if (!bars || bars.length < 30) {
    return { symbol, error: 'insufficient bars', barCount: bars?.length || 0 };
  }

  let indicators;
  try {
    indicators = technicalIndicators.getAllIndicators(bars);
  } catch (e) {
    return { symbol, error: `indicators failed: ${e.message}` };
  }
  if (!indicators || indicators.error) {
    return { symbol, error: indicators?.error || 'no indicators' };
  }

  const signalEval = signalEvaluator.evaluateSymbolStateless(symbol, bars, indicators);

  let patternPred = null;
  try {
    patternPred = await patternRecognitionService.predictPattern(bars, indicators);
  } catch {
    // pattern model is optional — proceed without it
  }

  const probResult = computeProbability({ indicators, signalEval, patternPred });

  if (!probResult.hasEdge) {
    return { symbol, error: 'no edge', probability: probResult.probability, logit: probResult.logit };
  }

  const currentPrice = bars[bars.length - 1].close;
  const atr = indicators.atr?.value;
  if (!Number.isFinite(atr) || atr <= 0) {
    return { symbol, error: 'no ATR' };
  }

  const targets = deriveTargets({
    currentPrice,
    atr,
    candles: bars,
    direction: probResult.direction,
    horizonDays,
  });

  if (!targets.viable) {
    return { symbol, error: targets.reason };
  }

  // Expected value in R units: prob * RR - (1 - prob) * 1.0
  const expectedValue = probResult.probability * targets.riskReward - (1 - probResult.probability);

  return {
    symbol,
    direction: probResult.direction,
    currentPrice: +currentPrice.toFixed(4),
    targetPrice: +targets.targetPrice.toFixed(4),
    stopPrice: +targets.stopPrice.toFixed(4),
    horizonDays,
    probability: +probResult.probability.toFixed(4),
    expectedMovePct: +targets.expectedMovePct.toFixed(2),
    atrPct: +targets.atrPct.toFixed(2),
    riskReward: +targets.riskReward.toFixed(2),
    expectedValue: +expectedValue.toFixed(3),
    signalConfidence: signalEval.confidence,
    patternConfidence: patternPred?.confidence ?? null,
    patternSignal: patternPred?.signal ?? null,
    components: probResult.components,
    reasons: probResult.reasons,
    indicatorsSnapshot: {
      rsi: indicators.rsi?.value,
      macdHist: indicators.macd?.histogram,
      bbPercentB: indicators.bollingerBands?.percentB,
      atr,
      adx: indicators.adx?.value,
      trendShort: indicators.trend?.shortTerm,
      trendMed: indicators.trend?.mediumTerm,
    },
  };
}

async function runScan({
  symbols,
  horizonDays = DEFAULT_HORIZON_DAYS,
  minProbability = DEFAULT_MIN_PROBABILITY,
  maxResults = DEFAULT_MAX_RESULTS,
} = {}) {
  const universe = (Array.isArray(symbols) && symbols.length > 0)
    ? Array.from(new Set(symbols.map(s => String(s).toUpperCase())))
    : getDefaultUniverse();

  const startedAt = Date.now();
  const results = await Promise.all(universe.map(sym => _scoreSymbol(sym, horizonDays)));
  const elapsedMs = Date.now() - startedAt;

  const opportunities = results
    .filter(r => !r.error)
    .filter(r => r.probability >= minProbability)
    .filter(r => r.expectedValue > 0.2)
    .sort((a, b) => b.expectedValue - a.expectedValue || b.probability - a.probability)
    .slice(0, maxResults);

  const errors = results
    .filter(r => r.error)
    .map(r => ({ symbol: r.symbol, error: r.error }));

  const scanResult = {
    scanId: `scan-${startedAt}`,
    generatedAt: new Date(startedAt).toISOString(),
    horizonDays,
    minProbability,
    universeSize: universe.length,
    scannedSymbols: results.length,
    elapsedMs,
    opportunities,
    errors,
    universe,
  };

  try {
    scanStore.saveScan(scanResult);
  } catch (err) {
    scanResult.persistError = err.message;
  }

  return scanResult;
}

module.exports = { runScan };
