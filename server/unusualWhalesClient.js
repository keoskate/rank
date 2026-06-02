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

// ---------------------------------------------------------------------------
// Insider activity (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Per-ticker insider buy/sell daily aggregates (Form 4 derived).
 * Each row: { filing_date, purchases, purchases_notional, sells, sells_notional }
 * @returns {Array}
 */
async function getInsiderBuySells(symbol, ttlMs = 15 * 60 * 1000) {
  if (!symbol) return [];
  const res = await makeRequest(
    `/api/stock/${symbol.toUpperCase()}/insider-buy-sells`,
    ttlMs
  );
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Analyze recent insider activity into a directional signal. We act on
 * open-market PURCHASES (insiders buy ahead of catalysts); sells are reported
 * but ignored (insiders sell for liquidity/diversification, not just bad news).
 *
 * @param {string} symbol
 * @param {object} opts { lookbackDays=10, minNotional=100000 }
 * @returns {object} { configured, symbol, sentiment, score, buyNotional,
 *   sellNotional, buyDays, reasons }
 */
async function analyzeInsiderActivity(symbol, opts = {}) {
  const lookbackDays = opts.lookbackDays ?? 10;
  const minNotional = opts.minNotional ?? 100000;
  if (!isConfigured()) {
    return {
      configured: false,
      symbol,
      sentiment: null,
      reasons: ['UW key not configured'],
    };
  }

  const rows = await getInsiderBuySells(symbol);
  if (!rows.length) {
    return {
      configured: true,
      symbol,
      sentiment: 'neutral',
      score: 0,
      buyDays: 0,
      reasons: ['no insider data'],
    };
  }

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  let buyNotional = 0;
  let sellNotional = 0;
  let buyDays = 0;
  for (const r of rows) {
    const d = r.filing_date ? Date.parse(r.filing_date) : NaN;
    if (Number.isFinite(d) && d < cutoff) continue;
    const buy = Math.abs(_num(r.purchases_notional));
    const sell = Math.abs(_num(r.sells_notional));
    buyNotional += buy;
    sellNotional += sell;
    if (_num(r.purchases) > 0 || buy > 0) buyDays++;
  }

  // Long signal: meaningful open-market buying in the window. Clustering across
  // multiple days strengthens it (2+ buy days = conviction, not a one-off).
  const bullish = buyNotional >= minNotional;
  const sentiment = bullish ? 'bullish' : 'neutral';
  const notionalStrength = Math.min(
    Math.log10(Math.max(buyNotional, 1)) / Math.log10(5_000_000),
    1
  );
  const clusterBoost = Math.min(buyDays / 3, 1) * 0.3;
  const score = bullish
    ? Math.min(0.5 * notionalStrength + clusterBoost + 0.2, 1)
    : 0;

  return {
    configured: true,
    symbol: symbol.toUpperCase(),
    sentiment,
    score,
    buyNotional,
    sellNotional,
    buyDays,
    reasons: [
      `insider buys $${Math.round(buyNotional).toLocaleString()} vs sells $${Math.round(sellNotional).toLocaleString()} (${lookbackDays}d)`,
      `${buyDays} buy day(s)`,
    ],
  };
}

/**
 * Scanner universe: tickers with recent qualifying open-market insider BUYING,
 * sourced from the market-wide insider feed. This is how a feed-driven insider
 * broker finds names to trade instead of staring at a fixed watchlist (mega-caps
 * rarely have insider buys). Returns tickers ranked by total buy notional.
 *
 * @param {object} opts { minNotional=500000, lookbackDays=10, max=15 }
 * @returns {Promise<string[]>}
 */
async function getRecentInsiderBuyTickers(opts = {}) {
  const minNotional = opts.minNotional ?? 500000;
  const lookbackDays = opts.lookbackDays ?? 10;
  const max = opts.max ?? 15;
  // Liquidity floor: ~60% of insider buys are in sub-$500M micro-caps (often
  // sub-$1 names) that are untradeable at size — the edge doesn't survive their
  // spreads/gaps (a sub-$1 holding gapped -10% for a $1.5k loss on day 1).
  // Only follow insiders into names liquid enough to actually trade.
  const minMarketCap = opts.minMarketCap ?? 1_000_000_000;
  const minPrice = opts.minPrice ?? 5;
  if (!isConfigured()) return [];

  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const byTicker = new Map(); // ticker -> total qualifying buy notional
  let page = 0;
  while (page < 10) {
    const res = await makeRequest(
      `/api/insider/transactions?limit=500&page=${page}`,
      10 * 60 * 1000
    );
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    let anyInWindow = false;
    for (const r of rows) {
      const date = (r.filing_date || r.transaction_date || '').slice(0, 10);
      const ts = date ? Date.parse(date) : NaN;
      if (Number.isFinite(ts) && ts >= cutoff) anyInWindow = true;
      if (Number.isFinite(ts) && ts < cutoff) continue;
      if (r.transaction_code !== 'P' || !(r.is_officer || r.is_director)) {
        continue;
      }
      const amount = Number(r.amount);
      const price = parseFloat(r.price) || 0;
      if (amount <= 0) continue;
      // Liquidity gates — skip micro-caps and penny names.
      const marketcap = _num(r.marketcap);
      if (marketcap > 0 && marketcap < minMarketCap) continue;
      if (price > 0 && price < minPrice) continue;
      const notional = Math.abs(amount) * price;
      if (notional < minNotional || !r.ticker) continue;
      byTicker.set(r.ticker, (byTicker.get(r.ticker) || 0) + notional);
    }
    page++;
    if (!res.has_more || !anyInWindow) break;
    await new Promise(r => setTimeout(r, 300));
  }
  return [...byTicker.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

// ---------------------------------------------------------------------------
// Dark pool prints (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Recent dark-pool prints for a ticker (newest first).
 * Each: { size, price, premium, executed_at, nbbo_ask, nbbo_bid, ... }
 * @returns {Array}
 */
async function getDarkPoolPrints(symbol, ttlMs = 60 * 1000) {
  if (!symbol) return [];
  const res = await makeRequest(`/api/darkpool/${symbol.toUpperCase()}`, ttlMs);
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Analyze dark-pool prints into a directional accumulation signal. A print is
 * classified buy-side vs sell-side by where it executed relative to the NBBO
 * midpoint (above mid = buyer-initiated accumulation, below = distribution).
 *
 * @param {string} symbol
 * @param {object} opts { lookbackMinutes=120, minPremium=1000000, minBuyShare=0.6 }
 * @returns {object} { configured, symbol, sentiment, score, buyPremium,
 *   sellPremium, totalPremium, buyShare, printCount, lastPrice, reasons }
 */
async function analyzeDarkPool(symbol, opts = {}) {
  const lookbackMinutes = opts.lookbackMinutes ?? 120;
  const minPremium = opts.minPremium ?? 1_000_000;
  const minBuyShare = opts.minBuyShare ?? 0.6;
  if (!isConfigured()) {
    return {
      configured: false,
      symbol,
      sentiment: null,
      reasons: ['UW key not configured'],
    };
  }

  const prints = await getDarkPoolPrints(symbol);
  if (!prints.length) {
    return {
      configured: true,
      symbol,
      sentiment: 'neutral',
      score: 0,
      printCount: 0,
      reasons: ['no dark pool prints'],
    };
  }

  const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
  let buyPremium = 0;
  let sellPremium = 0;
  let printCount = 0;
  let lastPrice = 0;
  for (const p of prints) {
    const ts = p.executed_at ? Date.parse(p.executed_at) : NaN;
    if (Number.isFinite(ts) && ts < cutoff) continue;
    const prem = _num(p.premium);
    if (prem <= 0) continue;
    printCount++;
    if (lastPrice === 0) lastPrice = _num(p.price); // newest first
    const price = _num(p.price);
    const ask = _num(p.nbbo_ask);
    const bid = _num(p.nbbo_bid);
    const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : price;
    if (price >= mid) buyPremium += prem;
    else sellPremium += prem;
  }

  const totalPremium = buyPremium + sellPremium;
  if (totalPremium <= 0) {
    return {
      configured: true,
      symbol,
      sentiment: 'neutral',
      score: 0,
      printCount,
      lastPrice,
      reasons: [`no dark pool premium in last ${lookbackMinutes}m`],
    };
  }

  const buyShare = buyPremium / totalPremium;
  const bullish = buyShare >= minBuyShare && totalPremium >= minPremium;
  const sentiment = bullish
    ? 'bullish'
    : buyShare <= 1 - minBuyShare && totalPremium >= minPremium
      ? 'bearish'
      : 'neutral';

  const shareStrength = Math.min(Math.max((buyShare - 0.5) / 0.4, 0), 1);
  const premStrength = Math.min(
    Math.log10(totalPremium) / Math.log10(50_000_000),
    1
  );
  const score = bullish
    ? Math.min(0.5 * shareStrength + 0.4 * premStrength + 0.1, 1)
    : 0;

  return {
    configured: true,
    symbol: symbol.toUpperCase(),
    sentiment,
    score,
    buyPremium,
    sellPremium,
    totalPremium,
    buyShare,
    printCount,
    lastPrice,
    reasons: [
      `dark pool buy $${Math.round(buyPremium).toLocaleString()} vs sell $${Math.round(sellPremium).toLocaleString()} (${(buyShare * 100).toFixed(0)}% buy)`,
      `${printCount} prints/${lookbackMinutes}m`,
    ],
  };
}

/**
 * Scanner universe for the options-flow broker: liquid tickers with the hottest
 * unusual options flow right now, from the market-wide flow-alerts feed. Ranked
 * by total alert premium; gated on market cap so we stay in optionable, liquid
 * names. The plugin then decides direction (call-premium skew) per ticker.
 * @param {object} opts { minMarketCap=5e9, max=12 }
 * @returns {Promise<string[]>}
 */
async function getTopFlowTickers(opts = {}) {
  const minMarketCap = opts.minMarketCap ?? 5_000_000_000;
  const max = opts.max ?? 12;
  if (!isConfigured()) return [];
  const res = await makeRequest('/api/option-trades/flow-alerts', 60 * 1000);
  const rows = Array.isArray(res.data) ? res.data : [];
  const byTicker = new Map();
  for (const r of rows) {
    if (!r.ticker) continue;
    const cap = _num(r.marketcap);
    if (cap > 0 && cap < minMarketCap) continue;
    const prem =
      _num(r.total_ask_side_prem) + _num(r.total_bid_side_prem) ||
      _num(r.volume) * _num(r.price) * 100;
    byTicker.set(r.ticker, (byTicker.get(r.ticker) || 0) + prem);
  }
  return [...byTicker.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

/**
 * Scanner universe for the dark-pool broker: tickers with the biggest recent
 * dark-pool prints, from the market-wide recent-prints feed. Ranked by total
 * premium; penny names filtered out by price. The plugin decides direction
 * (buy-side share of premium) per ticker.
 * @param {object} opts { minPrice=5, max=12 }
 * @returns {Promise<string[]>}
 */
async function getTopDarkPoolTickers(opts = {}) {
  const minPrice = opts.minPrice ?? 5;
  const max = opts.max ?? 12;
  if (!isConfigured()) return [];
  const res = await makeRequest('/api/darkpool/recent', 60 * 1000);
  const rows = Array.isArray(res.data) ? res.data : [];
  const byTicker = new Map();
  for (const r of rows) {
    if (!r.ticker) continue;
    const price = _num(r.price);
    if (price > 0 && price < minPrice) continue;
    byTicker.set(r.ticker, (byTicker.get(r.ticker) || 0) + _num(r.premium));
  }
  return [...byTicker.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

const clearCache = () => cache.clear();

module.exports = {
  isConfigured,
  makeRequest,
  getFlowAlerts,
  getMarketTide,
  analyzeTickerFlow,
  getInsiderBuySells,
  analyzeInsiderActivity,
  getRecentInsiderBuyTickers,
  getTopFlowTickers,
  getDarkPoolPrints,
  analyzeDarkPool,
  getTopDarkPoolTickers,
  clearCache,
};
