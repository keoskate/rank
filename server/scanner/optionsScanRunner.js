/**
 * Options scanner orchestrator — expresses the stock scanner's directional
 * edge through long single-leg calls/puts.
 *
 * Pipeline: stock directional scan (reused when fresh) -> for each symbol
 * with edge, fetch the Alpaca chain (direction side only, strikes ±20%,
 * DTE-windowed) + UW earnings/IV-rank context -> score every contract via
 * optionsPricingModel -> hard filters + quality gates -> rank by expected
 * ROI -> persist. Most contracts SHOULD be filtered; a scan surfacing a
 * handful of rows (or zero) is the feature working.
 *
 * Wired into Express routes via routes/scanner.js.
 */

const alpacaOptions = require('../alpacaOptionsClient');
const uw = require('../unusualWhalesClient');
const { runScan } = require('./scanRunner');
const scanStore = require('./scanStore');
const {
  parseOccSymbol,
  resolveEarningsContext,
  scoreContract,
  MIN_POP_MODEL,
  MIN_EXPECTED_ROI,
  MAX_PER_UNDERLYING,
} = require('./optionsPricingModel');

const DEFAULT_HORIZON_DAYS = 5;
const DEFAULT_MIN_PROBABILITY = 0.55;
const DEFAULT_MAX_UNDERLYINGS = 25;
const DEFAULT_DTE_MIN = 7;
const DEFAULT_DTE_MAX = 60;
const DEFAULT_MAX_RESULTS = 30;
const STOCK_SCAN_REUSE_MS = 10 * 60 * 1000;
const STRIKE_BAND = 0.2; // strikes within ±20% of spot
const UNDERLYING_BATCH_SIZE = 5;
const STALE_QUOTE_MINUTES = 30;

function _isoDatePlusDays(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** Reuse a fresh stock scan with the same horizon, else run one. */
async function _getStockLeg({ symbols, horizonDays, minProbability, maxUnderlyings, reuseStockScan }) {
  if (reuseStockScan) {
    const last = scanStore.loadLatest('scan');
    if (
      last &&
      last.horizonDays === horizonDays &&
      last.minProbability <= minProbability &&
      Date.now() - Date.parse(last.generatedAt) < STOCK_SCAN_REUSE_MS
    ) {
      return {
        stockScanId: last.scanId,
        reused: true,
        opportunities: (last.opportunities || [])
          .filter(o => o.probability >= minProbability)
          .slice(0, maxUnderlyings),
      };
    }
  }
  const fresh = await runScan({ symbols, horizonDays, minProbability, maxResults: maxUnderlyings });
  return {
    stockScanId: fresh.scanId,
    reused: false,
    opportunities: (fresh.opportunities || []).slice(0, maxUnderlyings),
  };
}

/** Fetch chain + context and score every contract for one stock-scan row. */
async function _scanUnderlying(stockRow, params, today) {
  const symbol = stockRow.symbol;
  const side = stockRow.direction === 'LONG' ? 'call' : 'put';
  const chainFilters = {
    type: side,
    expirationDateGte: _isoDatePlusDays(params.dteMin),
    expirationDateLte: _isoDatePlusDays(params.dteMax),
    strikePriceGte: +(stockRow.currentPrice * (1 - STRIKE_BAND)).toFixed(2),
    strikePriceLte: +(stockRow.currentPrice * (1 + STRIKE_BAND)).toFixed(2),
  };

  const [chain, contractsRes, earningsRows, ivRankRes] = await Promise.all([
    alpacaOptions.getChainSnapshots(symbol, chainFilters),
    alpacaOptions.getContracts(symbol, chainFilters),
    uw.getEarnings(symbol),
    uw.getIvRank(symbol),
  ]);

  if (chain.error) return { symbol, error: chain.error, rows: [], filtered: {}, evaluated: 0, quoteAges: [] };
  const occSymbols = Object.keys(chain.snapshots);
  if (occSymbols.length === 0) return { symbol, error: 'empty chain', rows: [], filtered: {}, evaluated: 0, quoteAges: [] };

  const oiBySymbol = new Map(
    (contractsRes.contracts || []).map(c => [c.symbol, parseFloat(c.open_interest)])
  );
  const earnings = resolveEarningsContext(earningsRows, {
    today,
    horizonDays: params.horizonDays,
    underlyingPrice: stockRow.currentPrice,
  });
  const context = { today, ivRank: ivRankRes?.ivRank1y ?? null, earnings };
  const filters = {
    minOpenInterest: params.minOpenInterest,
    maxSpreadPct: params.maxSpreadPct,
    maxDebit: params.maxDebit,
    minDelta: params.minDelta,
  };

  const rows = [];
  const filtered = {};
  const quoteAges = [];
  const count = reason => { filtered[reason] = (filtered[reason] || 0) + 1; };

  for (const occ of occSymbols) {
    const snap = chain.snapshots[occ];
    const meta = parseOccSymbol(occ);
    if (!meta) { count('noGreeks'); continue; }
    const quote = snap.latestQuote;
    const contract = {
      occSymbol: occ,
      strike: meta.strike,
      expiration: meta.expiration,
      type: meta.type,
      bid: quote?.bp,
      ask: quote?.ap,
      greeks: snap.greeks || null,
      iv: snap.impliedVolatility ?? null,
      openInterest: oiBySymbol.get(occ) ?? null,
      dayVolume: snap.dailyBar?.v ?? null,
    };
    const result = scoreContract(stockRow, contract, context, filters);
    if (!result.ok) { count(result.reason); continue; }

    const row = result.row;
    // Earnings-mode filter uses per-contract span (expiry vs earnings date).
    if (params.earningsMode === 'exclude' && row.earnings?.withinHorizon) {
      count('earningsExcluded');
      continue;
    }
    if (params.earningsMode === 'only' && !(row.earnings?.spansEarnings && row.earnings?.withinHorizon)) {
      count('earningsExcluded');
      continue;
    }
    if (row.popModel < MIN_POP_MODEL || row.expectedRoi < MIN_EXPECTED_ROI || row.evPerContract <= 0) {
      count('belowThresholds');
      continue;
    }

    const quoteMs = quote?.t ? Date.parse(quote.t) : NaN;
    row.quoteAgeMinutes = Number.isFinite(quoteMs)
      ? Math.max(Math.round((Date.now() - quoteMs) / 60000), 0)
      : null;
    if (row.quoteAgeMinutes != null) quoteAges.push(row.quoteAgeMinutes);
    rows.push(row);
  }

  return { symbol, rows, filtered, evaluated: occSymbols.length, quoteAges };
}

/** Clamp a numeric param to a sane range; non-numeric -> fallback. */
function _clamp(v, lo, hi, fallback) {
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback;
}

async function runOptionsScan(rawParams = {}) {
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Hostile-input hardening: horizon 0/9999, inverted or negative DTE
  // windows etc. must degrade to sane scans, not nonsense math.
  const symbols = rawParams.symbols;
  const horizonDays = _clamp(rawParams.horizonDays, 1, 20, DEFAULT_HORIZON_DAYS);
  const minProbability = _clamp(rawParams.minProbability, 0.4, 0.9, DEFAULT_MIN_PROBABILITY);
  const maxUnderlyings = _clamp(rawParams.maxUnderlyings, 1, 50, DEFAULT_MAX_UNDERLYINGS);
  let dteMin = _clamp(rawParams.dteMin, 0, 400, DEFAULT_DTE_MIN);
  let dteMax = _clamp(rawParams.dteMax, 0, 400, DEFAULT_DTE_MAX);
  if (dteMin > dteMax) [dteMin, dteMax] = [dteMax, dteMin];
  const maxResults = _clamp(rawParams.maxResults, 1, 100, DEFAULT_MAX_RESULTS);
  const maxSpreadPct = _clamp(rawParams.maxSpreadPct, 0.01, 0.5, undefined);
  const minOpenInterest = _clamp(rawParams.minOpenInterest, 0, 1e7, undefined);
  const minDelta = _clamp(rawParams.minDelta, 0, 0.9, undefined);
  const maxDebit = _clamp(rawParams.maxDebit, 1, 1e7, null);
  const earningsMode = ['all', 'exclude', 'only'].includes(rawParams.earningsMode)
    ? rawParams.earningsMode
    : 'all';
  const reuseStockScan = rawParams.reuseStockScan !== false;

  const params = {
    horizonDays, minProbability, maxUnderlyings, dteMin, dteMax,
    maxSpreadPct, minOpenInterest, minDelta, maxDebit, earningsMode, maxResults, reuseStockScan,
  };

  const base = {
    scanId: `options-scan-${startedAt}`,
    generatedAt: new Date(startedAt).toISOString(),
    horizonDays,
    params,
  };

  if (!alpacaOptions.isConfigured()) {
    return { ...base, error: 'Alpaca options not configured (ALPACA_PAPER_API_KEY missing)', opportunities: [], errors: [], underlyingsScanned: 0, contractsEvaluated: 0, contractsFiltered: {}, elapsedMs: 0 };
  }

  const stockLeg = await _getStockLeg({ symbols, horizonDays, minProbability, maxUnderlyings, reuseStockScan });

  const perUnderlying = [];
  for (let i = 0; i < stockLeg.opportunities.length; i += UNDERLYING_BATCH_SIZE) {
    const batch = stockLeg.opportunities.slice(i, i + UNDERLYING_BATCH_SIZE);
    const results = await Promise.all(batch.map(row => _scanUnderlying(row, params, today)));
    perUnderlying.push(...results);
  }

  const contractsFiltered = {};
  let contractsEvaluated = 0;
  const allQuoteAges = [];
  const errors = [];
  const allRows = [];
  for (const r of perUnderlying) {
    contractsEvaluated += r.evaluated;
    allQuoteAges.push(...r.quoteAges);
    if (r.error) errors.push({ underlying: r.symbol, error: r.error });
    for (const [reason, n] of Object.entries(r.filtered)) {
      contractsFiltered[reason] = (contractsFiltered[reason] || 0) + n;
    }
    allRows.push(...r.rows);
  }

  // Rank by expected ROI, cap per underlying so one hot symbol can't flood
  // the board, then trim to maxResults.
  allRows.sort((a, b) => b.expectedRoi - a.expectedRoi || b.popModel - a.popModel);
  const perUnderlyingCount = new Map();
  const opportunities = [];
  for (const row of allRows) {
    const n = perUnderlyingCount.get(row.underlying) || 0;
    if (n >= MAX_PER_UNDERLYING) continue;
    perUnderlyingCount.set(row.underlying, n + 1);
    opportunities.push(row);
    if (opportunities.length >= maxResults) break;
  }

  const sortedAges = [...allQuoteAges].sort((a, b) => a - b);
  const medianQuoteAge = sortedAges.length ? sortedAges[Math.floor(sortedAges.length / 2)] : null;

  const scanResult = {
    ...base,
    stockScanId: stockLeg.stockScanId,
    stockScanReused: stockLeg.reused,
    underlyingsScanned: stockLeg.opportunities.length,
    contractsEvaluated,
    contractsFiltered,
    contractsPassed: allRows.length,
    medianQuoteAgeMinutes: medianQuoteAge,
    marketLikelyClosed: medianQuoteAge != null && medianQuoteAge > STALE_QUOTE_MINUTES,
    elapsedMs: Date.now() - startedAt,
    opportunities,
    errors,
  };

  try {
    scanStore.saveScan(scanResult, 'options-scan');
  } catch (err) {
    scanResult.persistError = err.message;
  }

  return scanResult;
}

module.exports = { runOptionsScan };
