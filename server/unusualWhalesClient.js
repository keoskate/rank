/**
 * Unusual Whales API Client
 *
 * Real options-flow data for the options-flow strategy plugin. Endpoints and
 * response shapes verified live against api.unusualwhales.com (2026-06):
 *   GET /api/stock/{ticker}/flow-alerts  -> { data: [ alert, ... ] }
 *   GET /api/market/market-tide          -> { data: [ {net_call_premium,...} ], date }
 *
 * A flow-alert row (the fields we use):
 *   { type: 'call'|'put', ticker, created_at, total_premium, total_ask_side_prem,
 *     total_bid_side_prem, has_sweep, all_opening_trades, volume_oi_ratio,
 *     underlying_price, strike, expiry, ... }
 *
 * Requires UNUSUAL_WHALES_API_KEY. Degrades gracefully (configured:false) when
 * the key is absent so the plugin can no-op instead of throwing.
 */

const API_BASE_URL = 'https://api.unusualwhales.com';

// In-memory cache. Flow is bursty but we only need a fresh-enough snapshot;
// a short TTL keeps us well under the 120 req/min limit when many brokers poll
// the same symbols.
const cache = new Map();
const DEFAULT_TTL_MS = 60 * 1000;

const isConfigured = () => !!process.env.UNUSUAL_WHALES_API_KEY;

const _num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Authenticated GET with per-endpoint TTL cache. Returns the parsed JSON, or
 * an object with `error` set on failure (never throws).
 */
async function makeRequest(endpoint, ttlMs = DEFAULT_TTL_MS) {
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY;
  if (!apiKey) return { configured: false, error: 'API key not configured' };

  const cached = cache.get(endpoint);
  if (cached && Date.now() - cached.timestamp < ttlMs) return cached.data;

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        configured: true,
        error: `API error: ${response.status}`,
        detail: errorText.slice(0, 200),
      };
    }
    const data = await response.json();
    const wrapped = { ...data, configured: true };
    cache.set(endpoint, { data: wrapped, timestamp: Date.now() });
    return wrapped;
  } catch (error) {
    return { configured: true, error: error.message };
  }
}

/**
 * Raw flow alerts for a ticker (most recent first).
 * @returns {Array} alert rows, or [] on error/no-key.
 */
async function getFlowAlerts(symbol, ttlMs = DEFAULT_TTL_MS) {
  if (!symbol) return [];
  const res = await makeRequest(
    `/api/stock/${symbol.toUpperCase()}/flow-alerts`,
    ttlMs
  );
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Latest market-tide point: market-wide net call vs put premium.
 * @returns {{ configured, netCallPremium, netPutPremium, netVolume, sentiment }}
 */
async function getMarketTide(ttlMs = DEFAULT_TTL_MS) {
  const res = await makeRequest('/api/market/market-tide', ttlMs);
  if (res.error || !Array.isArray(res.data) || res.data.length === 0) {
    return { configured: isConfigured(), sentiment: null, error: res.error };
  }
  const latest = res.data[res.data.length - 1];
  const netCall = _num(latest.net_call_premium);
  const netPut = _num(latest.net_put_premium);
  const total = Math.abs(netCall) + Math.abs(netPut);
  const callShare = total > 0 ? netCall / total : 0.5;
  let sentiment = 'neutral';
  if (callShare > 0.6) sentiment = 'bullish';
  else if (callShare < 0.4) sentiment = 'bearish';
  return {
    configured: true,
    netCallPremium: netCall,
    netPutPremium: netPut,
    netVolume: _num(latest.net_volume),
    callShare,
    sentiment,
    timestamp: latest.timestamp || res.date,
  };
}

/**
 * Analyze a ticker's recent options flow into a normalized directional signal.
 *
 * @param {string} symbol
 * @param {object} opts
 *   @param {number} opts.lookbackMinutes - only count alerts this fresh (default 30)
 *   @param {number} opts.minPremium      - min total premium in window to act (default 250000)
 *   @param {number} opts.minSkew         - min dominant-side share 0.5..1 (default 0.65)
 * @returns {object} {
 *   configured, symbol, sentiment: 'bullish'|'bearish'|'neutral', score: 0..1,
 *   callPremium, putPremium, totalPremium, skew (dominant share), sweepCount,
 *   openingCount, alertCount, underlyingPrice, reasons: string[]
 * }
 */
async function analyzeTickerFlow(symbol, opts = {}) {
  const lookbackMinutes = opts.lookbackMinutes ?? 30;
  const minPremium = opts.minPremium ?? 250000;
  const minSkew = opts.minSkew ?? 0.65;

  if (!isConfigured()) {
    return {
      configured: false,
      symbol,
      sentiment: null,
      reasons: ['UW key not configured'],
    };
  }

  const alerts = await getFlowAlerts(symbol);
  if (!alerts.length) {
    return {
      configured: true,
      symbol,
      sentiment: 'neutral',
      score: 0,
      alertCount: 0,
      reasons: ['no flow alerts'],
    };
  }

  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  let callPremium = 0;
  let putPremium = 0;
  let callAskPrem = 0; // aggressive call buying (ask side)
  let putAskPrem = 0;
  let sweepCount = 0;
  let openingCount = 0;
  let alertCount = 0;
  let underlyingPrice = 0;

  for (const a of alerts) {
    const ts = a.created_at ? Date.parse(a.created_at) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;
    alertCount++;
    const prem = _num(a.total_premium);
    const askPrem = _num(a.total_ask_side_prem);
    if (a.type === 'call') {
      callPremium += prem;
      callAskPrem += askPrem;
    } else if (a.type === 'put') {
      putPremium += prem;
      putAskPrem += askPrem;
    }
    if (a.has_sweep) sweepCount++;
    if (a.all_opening_trades) openingCount++;
    const up = _num(a.underlying_price);
    if (up > 0) underlyingPrice = up; // most-recent (alerts are newest-first)
  }

  const totalPremium = callPremium + putPremium;
  if (totalPremium <= 0) {
    return {
      configured: true,
      symbol,
      sentiment: 'neutral',
      score: 0,
      alertCount,
      underlyingPrice,
      reasons: [`no premium in last ${lookbackMinutes}m`],
    };
  }

  const callShare = callPremium / totalPremium;
  const bullish = callShare >= minSkew;
  const bearish = 1 - callShare >= minSkew;
  const skew = bullish
    ? callShare
    : bearish
      ? 1 - callShare
      : Math.max(callShare, 1 - callShare);

  // Aggressive-buy confirmation: was the dominant side actually being BOUGHT
  // (ask side) rather than sold? Adds conviction.
  const dominantAskShare = bullish
    ? callPremium > 0
      ? callAskPrem / callPremium
      : 0
    : putPremium > 0
      ? putAskPrem / putPremium
      : 0;

  let sentiment = 'neutral';
  if (bullish && totalPremium >= minPremium) sentiment = 'bullish';
  else if (bearish && totalPremium >= minPremium) sentiment = 'bearish';

  // Score 0..1: blend skew strength, premium magnitude (log-scaled to ~$5M),
  // aggressive-buy share, and sweep presence.
  const skewStrength = Math.min(Math.max((skew - 0.5) / 0.4, 0), 1); // 0.5->0, 0.9->1
  const premStrength = Math.min(
    Math.log10(totalPremium) / Math.log10(5_000_000),
    1
  );
  const sweepBoost = sweepCount > 0 ? 0.1 : 0;
  const score = Math.min(
    0.5 * skewStrength +
      0.3 * premStrength +
      0.1 * dominantAskShare +
      sweepBoost,
    1
  );

  const reasons = [
    `${sentiment} flow: calls $${Math.round(callPremium).toLocaleString()} vs puts $${Math.round(putPremium).toLocaleString()} (${(callShare * 100).toFixed(0)}% call)`,
    `${alertCount} alerts/${lookbackMinutes}m, ${sweepCount} sweeps, ${(dominantAskShare * 100).toFixed(0)}% ask-side`,
  ];

  return {
    configured: true,
    symbol: symbol.toUpperCase(),
    sentiment,
    score,
    callPremium,
    putPremium,
    totalPremium,
    skew,
    callShare,
    dominantAskShare,
    sweepCount,
    openingCount,
    alertCount,
    underlyingPrice,
    reasons,
  };
}

const clearCache = () => cache.clear();

module.exports = {
  isConfigured,
  makeRequest,
  getFlowAlerts,
  getMarketTide,
  analyzeTickerFlow,
  clearCache,
};
