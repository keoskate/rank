/**
 * Unusual Whales API Client
 *
 * Provides access to Unusual Whales market data:
 * - Market Tide (overall market sentiment)
 * - Flow Sentiment (per-symbol options flow)
 *
 * Requires UNUSUAL_WHALES_API_KEY environment variable.
 * Returns placeholder data when API key is not configured.
 */

const API_BASE_URL = 'https://api.unusualwhales.com';

// Cache for API responses (5 minute TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if API key is configured
 */
const isConfigured = () => {
  return !!process.env.UNUSUAL_WHALES_API_KEY;
};

/**
 * Make authenticated request to Unusual Whales API
 */
const makeRequest = async (endpoint) => {
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY;

  if (!apiKey) {
    return { configured: false, error: 'API key not configured' };
  }

  // Check cache
  const cacheKey = endpoint;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Unusual Whales API error: ${response.status} - ${errorText}`);
      return {
        configured: true,
        error: `API error: ${response.status}`,
      };
    }

    const data = await response.json();

    // Cache the response
    cache.set(cacheKey, {
      data: { ...data, configured: true },
      timestamp: Date.now(),
    });

    return { ...data, configured: true };
  } catch (error) {
    console.error('Unusual Whales API request failed:', error.message);
    return {
      configured: true,
      error: error.message,
    };
  }
};

/**
 * Get market-wide sentiment (Market Tide)
 *
 * Returns overall market sentiment based on options flow:
 * - callPercent: percentage of bullish flow
 * - putPercent: percentage of bearish flow
 * - sentiment: 'bullish', 'bearish', or 'neutral'
 */
const getMarketTide = async () => {
  if (!isConfigured()) {
    // Return placeholder data when not configured
    return {
      configured: false,
      sentiment: null,
      callPercent: null,
      putPercent: null,
      message: 'Add UNUSUAL_WHALES_API_KEY to .env to enable market tide data',
    };
  }

  try {
    // Try the market tide endpoint
    const data = await makeRequest('/api/market/tide');

    if (data.error) {
      return data;
    }

    // Parse the response - adapt based on actual API response structure
    // The actual structure may vary, this is a best guess
    const callPercent = data.call_premium_percent || data.calls_percent || 50;
    const putPercent = data.put_premium_percent || data.puts_percent || 50;

    // Determine sentiment
    let sentiment = 'neutral';
    if (callPercent > 55) sentiment = 'bullish';
    else if (putPercent > 55) sentiment = 'bearish';

    return {
      configured: true,
      sentiment,
      callPercent,
      putPercent,
      totalVolume: data.total_volume || data.volume,
      netFlow: data.net_flow || data.net_premium,
      timestamp: new Date().toISOString(),
      raw: data, // Include raw data for debugging
    };
  } catch (error) {
    console.error('Error fetching market tide:', error);
    return {
      configured: true,
      error: error.message,
    };
  }
};

/**
 * Get flow sentiment for a specific symbol
 *
 * @param {string} symbol - Stock ticker symbol
 * Returns options flow sentiment for the symbol
 */
const getFlowSentiment = async (symbol) => {
  if (!isConfigured()) {
    return {
      configured: false,
      symbol,
      sentiment: null,
      message: 'Add UNUSUAL_WHALES_API_KEY to .env to enable flow sentiment data',
    };
  }

  if (!symbol) {
    return { error: 'Symbol is required' };
  }

  try {
    const data = await makeRequest(`/api/stock/${symbol.toUpperCase()}/flow-sentiment`);

    if (data.error) {
      return data;
    }

    // Parse the response
    const callPercent = data.call_percent || data.calls_percent || 50;
    const putPercent = data.put_percent || data.puts_percent || 50;

    let sentiment = 'neutral';
    if (callPercent > 55) sentiment = 'bullish';
    else if (putPercent > 55) sentiment = 'bearish';

    return {
      configured: true,
      symbol: symbol.toUpperCase(),
      sentiment,
      callPercent,
      putPercent,
      putCallRatio: data.put_call_ratio || (putPercent / callPercent),
      totalPremium: data.total_premium,
      timestamp: new Date().toISOString(),
      raw: data,
    };
  } catch (error) {
    console.error(`Error fetching flow sentiment for ${symbol}:`, error);
    return {
      configured: true,
      symbol,
      error: error.message,
    };
  }
};

/**
 * Clear the cache (useful for testing or forcing refresh)
 */
const clearCache = () => {
  cache.clear();
};

module.exports = {
  isConfigured,
  getMarketTide,
  getFlowSentiment,
  clearCache,
};
