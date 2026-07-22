/**
 * Alpaca Options API Client (options scanner data source)
 *
 * Endpoints and response shapes verified live against Alpaca (2026-07-22):
 *   GET paper-api.alpaca.markets/v2/options/contracts
 *     -> { option_contracts: [ { symbol, strike_price, expiration_date, type,
 *          open_interest, open_interest_date, ... } ], next_page_token }
 *   GET data.alpaca.markets/v1beta1/options/snapshots/{underlying}
 *     -> { snapshots: { OCC_SYMBOL: { latestQuote: {bp, ap, t},
 *          latestTrade, dailyBar, prevDailyBar, minuteBar,
 *          greeks: {delta, gamma, theta, vega, rho} | null,
 *          impliedVolatility: number | null } }, next_page_token }
 *
 * feed=indicative is hard-coded: it is free with our keys and includes greeks
 * + IV near the money; the OPRA agreement is not signed on this account.
 * Greeks/IV come back null for deep ITM/OTM and same-day expiries — callers
 * must filter, this client passes snapshots through untouched.
 *
 * Uses ALPACA_PAPER_API_KEY / ALPACA_PAPER_SECRET_KEY. Degrades gracefully
 * (configured:false / empty results) when keys are absent so the scanner can
 * report a clean error instead of throwing.
 */

const TRADING_BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_BASE_URL = 'https://data.alpaca.markets';

// Chains move fast intraday but the scanner only needs fresh-enough marks;
// OI only updates once a day, so contracts can sit much longer.
const cache = new Map(); // key -> { data, timestamp }
const CHAIN_TTL_MS = 5 * 60 * 1000;
const CONTRACTS_TTL_MS = 30 * 60 * 1000;

// Pagination runaway guards. With ±20% strike / 7-60 DTE filters a chain is
// a few hundred contracts, so these caps are never hit in normal operation.
const MAX_SNAPSHOT_PAGES = 5;
const MAX_CONTRACT_PAGES = 3;

// Stay well under Alpaca's ~200 req/min data limit even when the scanner
// fans out across underlyings.
const MIN_REQUEST_INTERVAL_MS = 150;
let _lastRequestAt = 0;

const isConfigured = () =>
  !!(process.env.ALPACA_PAPER_API_KEY && process.env.ALPACA_PAPER_SECRET_KEY);

async function _rateLimit() {
  const wait = _lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastRequestAt = Date.now();
}

/** Authenticated GET returning parsed JSON, or { error } (never throws). */
async function _get(url) {
  if (!isConfigured()) return { configured: false, error: 'Alpaca keys not configured' };
  await _rateLimit();
  try {
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': process.env.ALPACA_PAPER_API_KEY,
        'APCA-API-SECRET-KEY': process.env.ALPACA_PAPER_SECRET_KEY,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return { error: `Alpaca ${response.status}`, detail: errorText.slice(0, 200) };
    }
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

function _buildQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  return qs.toString();
}

function _cached(key, ttlMs) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttlMs) return entry.data;
  return null;
}

/**
 * Option contracts for an underlying (source of open interest, which the
 * snapshots endpoint lacks).
 * @returns {{ contracts: Array, error?: string }}
 */
async function getContracts(underlying, {
  type,
  expirationDateGte,
  expirationDateLte,
  strikePriceGte,
  strikePriceLte,
} = {}) {
  const sym = String(underlying || '').toUpperCase();
  if (!sym) return { contracts: [], error: 'no underlying' };

  const query = _buildQuery({
    underlying_symbols: sym,
    type,
    expiration_date_gte: expirationDateGte,
    expiration_date_lte: expirationDateLte,
    strike_price_gte: strikePriceGte,
    strike_price_lte: strikePriceLte,
    limit: 1000,
  });
  const cacheKey = `contracts|${query}`;
  const hit = _cached(cacheKey, CONTRACTS_TTL_MS);
  if (hit) return hit;

  const contracts = [];
  let pageToken = null;
  for (let page = 0; page < MAX_CONTRACT_PAGES; page++) {
    const url = `${TRADING_BASE_URL}/v2/options/contracts?${query}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const res = await _get(url);
    if (res.error) {
      // Partial pages are still useful; only fail if we got nothing at all.
      if (contracts.length === 0) return { contracts: [], error: res.error };
      break;
    }
    contracts.push(...(res.option_contracts || []));
    pageToken = res.next_page_token;
    if (!pageToken) break;
  }

  const result = { contracts };
  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

/**
 * Chain snapshots (quotes + greeks + IV) for an underlying on the indicative
 * feed. Returns a flat map keyed by OCC symbol.
 * @returns {{ snapshots: Object<string, object>, error?: string }}
 */
async function getChainSnapshots(underlying, {
  type,
  expirationDateGte,
  expirationDateLte,
  strikePriceGte,
  strikePriceLte,
} = {}) {
  const sym = String(underlying || '').toUpperCase();
  if (!sym) return { snapshots: {}, error: 'no underlying' };

  const query = _buildQuery({
    feed: 'indicative',
    type,
    expiration_date_gte: expirationDateGte,
    expiration_date_lte: expirationDateLte,
    strike_price_gte: strikePriceGte,
    strike_price_lte: strikePriceLte,
    limit: 1000,
  });
  const cacheKey = `chain|${sym}|${query}`;
  const hit = _cached(cacheKey, CHAIN_TTL_MS);
  if (hit) return hit;

  const snapshots = {};
  let pageToken = null;
  for (let page = 0; page < MAX_SNAPSHOT_PAGES; page++) {
    const url = `${DATA_BASE_URL}/v1beta1/options/snapshots/${sym}?${query}` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const res = await _get(url);
    if (res.error) {
      if (Object.keys(snapshots).length === 0) return { snapshots: {}, error: res.error };
      break;
    }
    Object.assign(snapshots, res.snapshots || {});
    pageToken = res.next_page_token;
    if (!pageToken) break;
  }

  const result = { snapshots };
  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

const clearCache = () => cache.clear();

module.exports = {
  isConfigured,
  getContracts,
  getChainSnapshots,
  clearCache,
  CHAIN_TTL_MS,
};
