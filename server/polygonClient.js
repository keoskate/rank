/**
 * POLYGON API CLIENT - Historical Market Data Fetcher
 *
 * Fetches real historical stock data from Polygon.io for backtesting
 * and real-time data integration.
 *
 * Features:
 * - Historical price data (OHLCV)
 * - Technical indicators (RSI, SMA, etc.)
 * - Fundamental data (P/E, market cap, etc.)
 * - Rate limiting and error handling
 */

const axios = require('axios');

// Polygon API Configuration - Must be set via environment variables
// See .env.example for setup instructions
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE_URL = 'https://api.polygon.io';

if (!POLYGON_API_KEY) {
  console.warn('⚠️  POLYGON_API_KEY not set in environment variables. Market data features will not work.');
}

// Rate limiting
const RATE_LIMIT_DELAY = 100; // 100ms between requests (10 req/sec)
let lastRequestTime = 0;

/**
 * Rate limiting helper - ensures we don't exceed API limits
 */
async function rateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    await new Promise(resolve =>
      setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
}

/**
 * Fetch historical aggregates (OHLCV) for a stock
 *
 * @param {string} symbol - Stock ticker symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} timespan - day, week, month, etc.
 * @returns {Array} - Array of OHLCV bars
 */
async function getHistoricalAggregates(
  symbol,
  startDate,
  endDate,
  timespan = 'day'
) {
  await rateLimit();

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/range/1/${timespan}/${startDate}/${endDate}`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        sort: 'asc',
        apiKey: POLYGON_API_KEY,
      },
      timeout: 30000, // 30 second timeout
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Polygon API error');
    }

    if (!response.data.results || response.data.results.length === 0) {
      console.warn(
        `⚠️ No historical data found for ${symbol} (${startDate} to ${endDate})`
      );
      return [];
    }

    // Transform Polygon format to our format
    const bars = response.data.results.map(bar => ({
      date: new Date(bar.t).toISOString().split('T')[0],
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      transactions: bar.n,
    }));

    console.log(
      `✅ Fetched ${bars.length} bars for ${symbol} (${startDate} to ${endDate})`
    );
    return bars;
  } catch (error) {
    if (error.response?.status === 429) {
      console.error(`❌ Rate limit exceeded for ${symbol}`);
      throw new Error('Rate limit exceeded - please wait before retrying');
    }

    console.error(
      `❌ Error fetching historical data for ${symbol}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get latest quote for a stock
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Object} - Latest price data
 */
async function getLatestQuote(symbol) {
  await rateLimit();

  try {
    const url = `${POLYGON_BASE_URL}/v2/last/trade/${symbol}`;

    const response = await axios.get(url, {
      params: {
        apiKey: POLYGON_API_KEY,
      },
      timeout: 10000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Failed to fetch quote');
    }

    const result = response.data.results;

    return {
      price: result.p,
      size: result.s,
      exchange: result.x,
      timestamp: result.t,
      conditions: result.c,
    };
  } catch (error) {
    console.error(`❌ Error fetching quote for ${symbol}:`, error.message);
    throw error;
  }
}

/**
 * Get previous day's close price
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Object} - Previous day's OHLCV data
 */
async function getPreviousClose(symbol) {
  await rateLimit();

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/prev`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        apiKey: POLYGON_API_KEY,
      },
      timeout: 10000,
    });

    if (!response.data.results || response.data.results.length === 0) {
      return null;
    }

    const result = response.data.results[0];

    return {
      date: new Date(result.t).toISOString().split('T')[0],
      open: result.o,
      high: result.h,
      low: result.l,
      close: result.c,
      volume: result.v,
      vwap: result.vw,
    };
  } catch (error) {
    console.error(
      `❌ Error fetching previous close for ${symbol}:`,
      error.message
    );
    return null;
  }
}

/**
 * Get stock details and fundamentals
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Object} - Stock details
 */
async function getStockDetails(symbol) {
  await rateLimit();

  try {
    const url = `${POLYGON_BASE_URL}/v3/reference/tickers/${symbol}`;

    const response = await axios.get(url, {
      params: {
        apiKey: POLYGON_API_KEY,
      },
      timeout: 10000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Failed to fetch stock details');
    }

    const result = response.data.results;

    return {
      ticker: result.ticker,
      name: result.name,
      market: result.market,
      locale: result.locale,
      primaryExchange: result.primary_exchange,
      type: result.type,
      active: result.active,
      currencyName: result.currency_name,
      cik: result.cik,
      marketCap: result.market_cap,
      phoneNumber: result.phone_number,
      address: result.address,
      description: result.description,
      sicCode: result.sic_code,
      sicDescription: result.sic_description,
      totalEmployees: result.total_employees,
      listDate: result.list_date,
      branding: result.branding,
      shareClassSharesOutstanding: result.share_class_shares_outstanding,
      weightedSharesOutstanding: result.weighted_shares_outstanding,
    };
  } catch (error) {
    console.error(
      `❌ Error fetching stock details for ${symbol}:`,
      error.message
    );
    return null;
  }
}

/**
 * Calculate technical indicators from price data
 *
 * @param {Array} bars - Array of OHLCV bars
 * @returns {Object} - Technical indicators
 */
function calculateTechnicalIndicators(bars) {
  if (!bars || bars.length === 0) {
    return null;
  }

  // Sort by date ascending
  const sortedBars = [...bars].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // RSI calculation (14-period)
  const rsi = calculateRSI(sortedBars, 14);

  // SMA calculations
  const sma20 = calculateSMA(sortedBars, 20);
  const sma50 = calculateSMA(sortedBars, 50);
  const sma200 = calculateSMA(sortedBars, 200);

  // Volatility (20-day)
  const volatility = calculateVolatility(sortedBars, 20);

  return {
    rsi,
    sma20,
    sma50,
    sma200,
    volatility,
  };
}

/**
 * Calculate RSI (Relative Strength Index)
 *
 * @param {Array} bars - Price bars
 * @param {number} period - RSI period (default 14)
 * @returns {number} - RSI value (0-100)
 */
function calculateRSI(bars, period = 14) {
  if (bars.length < period + 1) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  // Calculate initial average gain/loss
  for (let i = bars.length - period; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return Math.round(rsi * 100) / 100;
}

/**
 * Calculate SMA (Simple Moving Average)
 *
 * @param {Array} bars - Price bars
 * @param {number} period - SMA period
 * @returns {number} - SMA value
 */
function calculateSMA(bars, period) {
  if (bars.length < period) {
    return null;
  }

  const recentBars = bars.slice(-period);
  const sum = recentBars.reduce((acc, bar) => acc + bar.close, 0);

  return Math.round((sum / period) * 100) / 100;
}

/**
 * Calculate volatility (standard deviation of returns)
 *
 * @param {Array} bars - Price bars
 * @param {number} period - Lookback period
 * @returns {number} - Volatility percentage
 */
function calculateVolatility(bars, period = 20) {
  if (bars.length < period + 1) {
    return null;
  }

  const recentBars = bars.slice(-period - 1);
  const returns = [];

  for (let i = 1; i < recentBars.length; i++) {
    const dailyReturn =
      (recentBars[i].close - recentBars[i - 1].close) / recentBars[i - 1].close;
    returns.push(dailyReturn);
  }

  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  return Math.round(stdDev * 100 * 100) / 100; // Convert to percentage
}

/**
 * Batch fetch historical data for multiple symbols
 *
 * @param {Array} symbols - Array of stock symbols
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Object} - Map of symbol -> bars
 */
async function batchGetHistoricalData(symbols, startDate, endDate) {
  const results = {};

  console.log(`📊 Fetching historical data for ${symbols.length} symbols...`);

  for (const symbol of symbols) {
    try {
      const bars = await getHistoricalAggregates(symbol, startDate, endDate);
      results[symbol] = bars;

      // Add small delay between symbols to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Failed to fetch data for ${symbol}:`, error.message);
      results[symbol] = [];
    }
  }

  console.log(`✅ Completed batch fetch for ${symbols.length} symbols`);
  return results;
}

/**
 * Wrapper for getAggregates with different API signature
 * Used by AI trading engine and enhanced backtest engine
 *
 * @param {string} symbol - Stock ticker symbol
 * @param {number} multiplier - Size of timespan multiplier (e.g., 5 for 5 minutes)
 * @param {string} timespan - minute, hour, day, week, month
 * @param {Object} options - Optional parameters { from, to }
 * @returns {Array} - Array of OHLCV bars
 */
async function getAggregates(
  symbol,
  multiplier = 1,
  timespan = 'day',
  options = {}
) {
  await rateLimit();

  // Helper to convert date to YYYY-MM-DD string
  const toDateString = d => {
    if (!d) return null;
    if (typeof d === 'string') return d.split('T')[0]; // Handle ISO strings or YYYY-MM-DD
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d);
  };

  // Default to last 30 days if no dates specified
  const endDate =
    toDateString(options.to) || new Date().toISOString().split('T')[0];
  const startDate =
    toDateString(options.from) ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    })();

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${startDate}/${endDate}`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        sort: 'asc',
        limit: options.limit || 50000,
        apiKey: POLYGON_API_KEY,
      },
      timeout: 30000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Polygon API error');
    }

    if (!response.data.results || response.data.results.length === 0) {
      console.warn(`⚠️ No aggregate data found for ${symbol}`);
      return [];
    }

    // Transform Polygon format to our format
    const bars = response.data.results.map(bar => ({
      date: new Date(bar.t).toISOString().split('T')[0],
      time: Math.floor(bar.t / 1000), // Unix timestamp for lightweight-charts
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      transactions: bar.n,
    }));

    console.log(
      `✅ Fetched ${bars.length} ${multiplier}${timespan} bars for ${symbol}`
    );
    return bars;
  } catch (error) {
    if (error.response?.status === 429) {
      console.error(`❌ Rate limit exceeded for ${symbol}`);
      throw new Error('Rate limit exceeded - please wait before retrying');
    }

    console.error(`❌ Error fetching aggregates for ${symbol}:`, error.message);
    throw error;
  }
}

// ============================================================
// CRYPTO-SPECIFIC ENDPOINTS (isolated from stock endpoints)
// ============================================================
// These functions handle cryptocurrency data from Polygon
// Crypto symbols use format: X:BTCUSD (X: prefix + pair without slash)

const assetUtils = require('./assetUtils');

/**
 * Fetch historical aggregates (OHLCV) for a cryptocurrency
 *
 * @param {string} symbol - Crypto symbol (BTC, ETH, BTC/USD, BTCUSD, X:BTCUSD all accepted)
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {string} timespan - minute, hour, day, week, month
 * @param {number} multiplier - Timespan multiplier (e.g., 5 for 5 minutes)
 * @returns {Array} - Array of OHLCV bars
 */
async function getCryptoHistoricalAggregates(
  symbol,
  startDate,
  endDate,
  timespan = 'day',
  multiplier = 1
) {
  await rateLimit();

  // Normalize to Polygon crypto format (X:BTCUSD)
  const normalizedSymbol = assetUtils.normalizeForPolygonCrypto(symbol);
  console.log(`🪙 Polygon: Fetching crypto aggregates for ${normalizedSymbol} (${startDate} to ${endDate})`);

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${normalizedSymbol}/range/${multiplier}/${timespan}/${startDate}/${endDate}`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        sort: 'asc',
        apiKey: POLYGON_API_KEY,
      },
      timeout: 30000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Polygon API error');
    }

    if (!response.data.results || response.data.results.length === 0) {
      console.warn(
        `⚠️ No crypto historical data found for ${normalizedSymbol} (${startDate} to ${endDate})`
      );
      return [];
    }

    // Transform Polygon format to our format
    const bars = response.data.results.map(bar => ({
      date: new Date(bar.t).toISOString().split('T')[0],
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      transactions: bar.n,
    }));

    console.log(
      `🪙 Polygon: Fetched ${bars.length} crypto bars for ${normalizedSymbol}`
    );
    return bars;
  } catch (error) {
    if (error.response?.status === 429) {
      console.error(`❌ Rate limit exceeded for crypto ${normalizedSymbol}`);
      throw new Error('Rate limit exceeded - please wait before retrying');
    }

    console.error(
      `❌ Error fetching crypto historical data for ${normalizedSymbol}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get crypto aggregates with flexible API signature
 * Used by AI trading engine for crypto analysis
 *
 * @param {string} symbol - Crypto symbol
 * @param {number} multiplier - Size of timespan multiplier
 * @param {string} timespan - minute, hour, day, week, month
 * @param {Object} options - Optional parameters { from, to, limit }
 * @returns {Array} - Array of OHLCV bars
 */
async function getCryptoAggregates(
  symbol,
  multiplier = 1,
  timespan = 'day',
  options = {}
) {
  await rateLimit();

  // Normalize to Polygon crypto format
  const normalizedSymbol = assetUtils.normalizeForPolygonCrypto(symbol);

  // Helper to convert date to YYYY-MM-DD string
  const toDateString = d => {
    if (!d) return null;
    if (typeof d === 'string') return d.split('T')[0];
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d);
  };

  // Default to last 30 days if no dates specified
  const endDate =
    toDateString(options.to) || new Date().toISOString().split('T')[0];
  const startDate =
    toDateString(options.from) ||
    (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
    })();

  console.log(`🪙 Polygon: Getting crypto aggregates for ${normalizedSymbol}`);

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${normalizedSymbol}/range/${multiplier}/${timespan}/${startDate}/${endDate}`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        sort: 'asc',
        limit: options.limit || 50000,
        apiKey: POLYGON_API_KEY,
      },
      timeout: 30000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Polygon API error');
    }

    if (!response.data.results || response.data.results.length === 0) {
      console.warn(`⚠️ No crypto aggregate data found for ${normalizedSymbol}`);
      return [];
    }

    // Transform Polygon format to our format
    const bars = response.data.results.map(bar => ({
      date: new Date(bar.t).toISOString().split('T')[0],
      time: Math.floor(bar.t / 1000), // Unix timestamp for lightweight-charts
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
      transactions: bar.n,
    }));

    console.log(
      `🪙 Polygon: Fetched ${bars.length} ${multiplier}${timespan} crypto bars for ${normalizedSymbol}`
    );
    return bars;
  } catch (error) {
    if (error.response?.status === 429) {
      console.error(`❌ Rate limit exceeded for crypto ${normalizedSymbol}`);
      throw new Error('Rate limit exceeded - please wait before retrying');
    }

    console.error(
      `❌ Error fetching crypto aggregates for ${normalizedSymbol}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get latest trade for a cryptocurrency
 *
 * @param {string} symbol - Crypto symbol
 * @returns {Object} - Latest trade data
 */
async function getCryptoLatestTrade(symbol) {
  await rateLimit();

  const normalizedSymbol = assetUtils.normalizeForPolygonCrypto(symbol);
  console.log(`🪙 Polygon: Fetching crypto latest trade for ${normalizedSymbol}`);

  try {
    const url = `${POLYGON_BASE_URL}/v1/last/crypto/${normalizedSymbol}`;

    const response = await axios.get(url, {
      params: {
        apiKey: POLYGON_API_KEY,
      },
      timeout: 10000,
    });

    if (response.data.status === 'ERROR') {
      throw new Error(response.data.error || 'Failed to fetch crypto trade');
    }

    const result = response.data.last;

    return {
      symbol: normalizedSymbol,
      price: result.price,
      size: result.size,
      exchange: result.exchange,
      timestamp: result.timestamp,
      conditions: result.conditions,
    };
  } catch (error) {
    console.error(
      `❌ Error fetching crypto trade for ${normalizedSymbol}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get previous day's close for a cryptocurrency
 *
 * @param {string} symbol - Crypto symbol
 * @returns {Object} - Previous day's OHLCV data
 */
async function getCryptoPreviousClose(symbol) {
  await rateLimit();

  const normalizedSymbol = assetUtils.normalizeForPolygonCrypto(symbol);
  console.log(`🪙 Polygon: Fetching crypto previous close for ${normalizedSymbol}`);

  try {
    const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${normalizedSymbol}/prev`;

    const response = await axios.get(url, {
      params: {
        adjusted: 'true',
        apiKey: POLYGON_API_KEY,
      },
      timeout: 10000,
    });

    if (!response.data.results || response.data.results.length === 0) {
      return null;
    }

    const result = response.data.results[0];

    return {
      symbol: normalizedSymbol,
      date: new Date(result.t).toISOString().split('T')[0],
      open: result.o,
      high: result.h,
      low: result.l,
      close: result.c,
      volume: result.v,
      vwap: result.vw,
    };
  } catch (error) {
    console.error(
      `❌ Error fetching crypto previous close for ${normalizedSymbol}:`,
      error.message
    );
    return null;
  }
}

module.exports = {
  // Stock endpoints
  getHistoricalAggregates,
  getAggregates,
  getLatestQuote,
  getPreviousClose,
  getStockDetails,
  calculateTechnicalIndicators,
  calculateRSI,
  calculateSMA,
  calculateVolatility,
  batchGetHistoricalData,

  // Crypto-specific endpoints (isolated from stock endpoints)
  getCryptoHistoricalAggregates,
  getCryptoAggregates,
  getCryptoLatestTrade,
  getCryptoPreviousClose,
};
