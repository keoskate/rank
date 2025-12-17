/**
 * ALPACA API CLIENT - Paper/Live Trading Integration
 *
 * Integrates with Alpaca's API for both paper and live trading.
 * Provides cross-validation with Polygon data for reliability checks.
 *
 * Features:
 * - Paper and live trading account management
 * - Order placement (market, limit, stop)
 * - Position tracking
 * - Trade history
 * - Real-time quotes
 * - Data validation against Polygon
 * - Safety checks for live trading
 */

const axios = require('axios');
const tradingModeManager = require('./tradingModeManager');

// Rate limiting
const RATE_LIMIT_DELAY = 100; // 100ms between requests
let lastRequestTime = 0;

/**
 * Rate limiting helper
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
 * Make authenticated request to Alpaca API
 * Automatically uses the correct endpoint and credentials based on current trading mode
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {object|null} data - Request body data
 * @param {string|null} mode - Optional mode override ('paper' or 'live') - uses this instead of global mode
 */
async function alpacaRequest(method, endpoint, data = null, mode = null) {
  await rateLimit();

  // Get credentials and base URL - use mode-specific if provided, otherwise use global
  let credentials, baseURL;
  if (mode) {
    credentials = tradingModeManager.getCredentialsForMode(mode);
    baseURL = tradingModeManager.getBaseURLForMode(mode);
  } else {
    credentials = tradingModeManager.getCredentials();
    baseURL = tradingModeManager.getBaseURL();
  }

  const config = {
    method,
    url: `${baseURL}${endpoint}`,
    headers: {
      'APCA-API-KEY-ID': credentials.apiKey,
      'APCA-API-SECRET-KEY': credentials.secretKey,
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`❌ Alpaca API Error (${endpoint}):`, error.response.data);
      throw new Error(
        error.response.data.message || 'Alpaca API request failed'
      );
    }
    throw error;
  }
}

/**
 * Get account information
 *
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Object} - Account details (equity, cash, buying_power, etc.)
 */
async function getAccount(mode = null) {
  const modeLabel = mode ? mode.toUpperCase() : tradingModeManager.getModeInfo().statusText;
  console.log(`📊 Fetching Alpaca account info (${modeLabel})...`);

  const account = await alpacaRequest('GET', '/v2/account', null, mode);

  console.log(`✅ Account Status: ${account.status}`);
  console.log(
    `   Portfolio Value: $${parseFloat(account.portfolio_value).toLocaleString()}`
  );
  console.log(`   Cash: $${parseFloat(account.cash).toLocaleString()}`);
  console.log(
    `   Buying Power: $${parseFloat(account.buying_power).toLocaleString()}`
  );

  return account;
}

/**
 * Get all open positions
 *
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Array} - Array of position objects
 */
async function getPositions(mode = null) {
  const modeLabel = mode ? mode.toUpperCase() : 'CURRENT';
  console.log(`📊 Fetching Alpaca positions (${modeLabel})...`);
  const positions = await alpacaRequest('GET', '/v2/positions', null, mode);

  console.log(`✅ Found ${positions.length} open positions`);

  return positions.map(pos => ({
    symbol: pos.symbol,
    quantity: parseInt(pos.qty),
    side: pos.side,
    avgEntryPrice: parseFloat(pos.avg_entry_price),
    currentPrice: parseFloat(pos.current_price),
    marketValue: parseFloat(pos.market_value),
    costBasis: parseFloat(pos.cost_basis),
    unrealizedPL: parseFloat(pos.unrealized_pl),
    unrealizedPLPercent: parseFloat(pos.unrealized_plpc) * 100,
    changeToday: parseFloat(pos.change_today) * 100,
  }));
}

/**
 * Get position for a specific symbol
 *
 * @param {string} symbol - Stock symbol
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Object} - Position details or null
 */
async function getPosition(symbol, mode = null) {
  try {
    const position = await alpacaRequest('GET', `/v2/positions/${symbol}`, null, mode);

    return {
      symbol: position.symbol,
      quantity: parseInt(position.qty),
      side: position.side,
      avgEntryPrice: parseFloat(position.avg_entry_price),
      currentPrice: parseFloat(position.current_price),
      marketValue: parseFloat(position.market_value),
      costBasis: parseFloat(position.cost_basis),
      unrealizedPL: parseFloat(position.unrealized_pl),
      unrealizedPLPercent: parseFloat(position.unrealized_plpc) * 100,
    };
  } catch (error) {
    // Position doesn't exist
    return null;
  }
}

/**
 * Place an order
 *
 * @param {Object} orderParams - Order parameters
 * @param {string} orderParams.symbol - Stock symbol
 * @param {number} orderParams.qty - Quantity
 * @param {string} orderParams.side - 'buy' or 'sell'
 * @param {string} orderParams.type - 'market', 'limit', 'stop', etc.
 * @param {string} orderParams.time_in_force - 'day', 'gtc', etc.
 * @param {number} orderParams.limit_price - Limit price (for limit orders)
 * @param {number} orderParams.market_price - Estimated market price (for validation)
 * @param {number} accountValue - Current account value (for validation)
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Object} - Order details
 */
async function placeOrder(orderParams, accountValue = null, mode = null) {
  const modeInfo = mode
    ? { statusText: mode.toUpperCase() + ' TRADING', isLive: mode === 'live' }
    : tradingModeManager.getModeInfo();

  // Ensure qty is a valid positive integer
  if (orderParams.qty !== undefined) {
    orderParams.qty = parseInt(orderParams.qty, 10);
    if (isNaN(orderParams.qty) || orderParams.qty < 1) {
      throw new Error(
        `Invalid quantity: ${orderParams.qty}. qty must be a positive integer.`
      );
    }
    // Convert to string as Alpaca API expects string for qty
    orderParams.qty = String(orderParams.qty);
  } else if (!orderParams.notional) {
    throw new Error('Order must have either qty or notional specified');
  }

  // Validate order before placing
  const validation = tradingModeManager.validateOrder(
    orderParams,
    accountValue
  );

  if (!validation.valid) {
    console.error('❌ Order validation failed:');
    validation.errors.forEach(err => console.error(`   - ${err}`));
    throw new Error(`Order validation failed: ${validation.errors.join(', ')}`);
  }

  // Log warnings
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(warn => console.warn(`⚠️  ${warn}`));
  }

  console.log(
    `📝 Placing ${orderParams.side} order: ${orderParams.qty} shares of ${orderParams.symbol} (${modeInfo.statusText})`
  );

  const order = await alpacaRequest('POST', '/v2/orders', orderParams, mode);

  console.log(`✅ Order placed: ${order.id} (${order.status})`);

  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    side: order.side,
    quantity: parseInt(order.qty),
    type: order.type,
    timeInForce: order.time_in_force,
    status: order.status,
    filledQty: parseInt(order.filled_qty || 0),
    filledAvgPrice: order.filled_avg_price
      ? parseFloat(order.filled_avg_price)
      : null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    submittedAt: order.submitted_at,
  };
}

/**
 * Get all orders (optionally filtered)
 *
 * @param {Object} filters - Optional filters (status, limit, after, until, etc.)
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Array} - Array of orders
 */
async function getOrders(filters = {}, mode = null) {
  const params = new URLSearchParams(filters).toString();
  const endpoint = params ? `/v2/orders?${params}` : '/v2/orders';

  const orders = await alpacaRequest('GET', endpoint, null, mode);

  return orders.map(order => ({
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    quantity: parseInt(order.qty),
    filledQty: parseInt(order.filled_qty || 0),
    type: order.type,
    status: order.status,
    filledAvgPrice: order.filled_avg_price
      ? parseFloat(order.filled_avg_price)
      : null,
    createdAt: order.created_at,
  }));
}

/**
 * Cancel an order
 *
 * @param {string} orderId - Order ID to cancel
 * @returns {boolean} - Success status
 */
async function cancelOrder(orderId) {
  console.log(`❌ Cancelling order: ${orderId}`);
  await alpacaRequest('DELETE', `/v2/orders/${orderId}`);
  console.log(`✅ Order cancelled: ${orderId}`);
  return true;
}

/**
 * Cancel all open orders
 *
 * @returns {Array} - Array of cancelled order IDs
 */
async function cancelAllOrders() {
  console.log('❌ Cancelling all open orders...');
  const result = await alpacaRequest('DELETE', '/v2/orders');
  console.log(`✅ Cancelled ${result.length} orders`);
  return result.map(r => r.id);
}

/**
 * Get latest quote for a symbol
 *
 * @param {string} symbol - Stock symbol
 * @returns {Object} - Latest quote data
 */
async function getLatestQuote(symbol) {
  const quote = await alpacaRequest(
    'GET',
    `/v2/stocks/${symbol}/quotes/latest`
  );

  return {
    symbol: quote.symbol,
    askPrice: parseFloat(quote.quote.ap),
    askSize: quote.quote.as,
    bidPrice: parseFloat(quote.quote.bp),
    bidSize: quote.quote.bs,
    timestamp: quote.quote.t,
  };
}

/**
 * Get latest trade for a symbol
 *
 * @param {string} symbol - Stock symbol
 * @returns {Object} - Latest trade data
 */
async function getLatestTrade(symbol) {
  const trade = await alpacaRequest(
    'GET',
    `/v2/stocks/${symbol}/trades/latest`
  );

  return {
    symbol: trade.symbol,
    price: parseFloat(trade.trade.p),
    size: trade.trade.s,
    timestamp: trade.trade.t,
    exchange: trade.trade.x,
  };
}

/**
 * Get bars (OHLCV) data
 *
 * @param {string} symbol - Stock symbol
 * @param {string} timeframe - '1Min', '5Min', '1Hour', '1Day', etc.
 * @param {string} start - Start date (RFC-3339 format or YYYY-MM-DD)
 * @param {string} end - End date
 * @param {number} limit - Max number of bars
 * @returns {Array} - Array of bar data
 */
async function getBars(
  symbol,
  timeframe = '1Day',
  start = null,
  end = null,
  limit = 10000
) {
  // Market data uses a different endpoint than trading API
  const MARKET_DATA_URL = 'https://data.alpaca.markets';
  const credentials = tradingModeManager.getCredentials();

  const allBars = [];
  let nextPageToken = null;
  const maxBarsPerRequest = 1000; // Alpaca's max per request

  console.log(`📊 Fetching Alpaca bars for ${symbol} (${timeframe}) from ${start} to ${end}`);

  try {
    do {
      await rateLimit();

      const params = new URLSearchParams({
        timeframe,
        limit: Math.min(maxBarsPerRequest, limit - allBars.length).toString(),
      });

      if (start) params.append('start', start);
      if (end) params.append('end', end);
      if (nextPageToken) params.append('page_token', nextPageToken);

      const config = {
        method: 'GET',
        url: `${MARKET_DATA_URL}/v2/stocks/${symbol}/bars?${params.toString()}`,
        headers: {
          'APCA-API-KEY-ID': credentials.apiKey,
          'APCA-API-SECRET-KEY': credentials.secretKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout per request
      };

      const response = await axios(config);
      const data = response.data;

      if (data.bars && data.bars.length > 0) {
        allBars.push(...data.bars);
        console.log(`   Got ${data.bars.length} bars, total: ${allBars.length}`);
      }

      nextPageToken = data.next_page_token;
    } while (nextPageToken && allBars.length < limit);

    console.log(`📊 Alpaca: Retrieved ${allBars.length} total bars for ${symbol}`);

    return allBars.map(bar => ({
      timestamp: bar.t,
      open: parseFloat(bar.o),
      high: parseFloat(bar.h),
      low: parseFloat(bar.l),
      close: parseFloat(bar.c),
      volume: bar.v,
      vwap: bar.vw ? parseFloat(bar.vw) : null,
      tradeCount: bar.n,
    }));
  } catch (error) {
    console.error(`❌ Alpaca market data error for ${symbol}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Alpaca API request failed');
  }
}

// ==========================================
// CRYPTO-SPECIFIC ENDPOINTS
// These functions are isolated from stock endpoints to ensure
// existing stock flows are not affected by crypto additions.
// ==========================================

const assetUtils = require('./assetUtils');

/**
 * Get latest crypto quote
 * Uses Alpaca's crypto data API endpoint
 *
 * @param {string} symbol - Crypto symbol (BTC, BTC/USD, or BTCUSD)
 * @returns {Object} - Latest quote data
 */
async function getCryptoLatestQuote(symbol) {
  const normalizedSymbol = assetUtils.normalizeForAlpacaCrypto(symbol);
  const CRYPTO_DATA_URL = 'https://data.alpaca.markets';
  const credentials = tradingModeManager.getCredentials();

  await rateLimit();

  console.log(`🪙 Fetching crypto quote for ${normalizedSymbol}...`);

  try {
    const config = {
      method: 'GET',
      url: `${CRYPTO_DATA_URL}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(normalizedSymbol)}`,
      headers: {
        'APCA-API-KEY-ID': credentials.apiKey,
        'APCA-API-SECRET-KEY': credentials.secretKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    };

    const response = await axios(config);
    const quote = response.data.quotes[normalizedSymbol];

    if (!quote) {
      throw new Error(`No quote data returned for ${normalizedSymbol}`);
    }

    return {
      symbol: normalizedSymbol,
      askPrice: parseFloat(quote.ap),
      askSize: parseFloat(quote.as),
      bidPrice: parseFloat(quote.bp),
      bidSize: parseFloat(quote.bs),
      timestamp: quote.t,
    };
  } catch (error) {
    console.error(`❌ Crypto quote error for ${normalizedSymbol}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Crypto quote request failed');
  }
}

/**
 * Get latest crypto trade
 * Uses Alpaca's crypto data API endpoint
 *
 * @param {string} symbol - Crypto symbol (BTC, BTC/USD, or BTCUSD)
 * @returns {Object} - Latest trade data
 */
async function getCryptoLatestTrade(symbol) {
  const normalizedSymbol = assetUtils.normalizeForAlpacaCrypto(symbol);
  const CRYPTO_DATA_URL = 'https://data.alpaca.markets';
  const credentials = tradingModeManager.getCredentials();

  await rateLimit();

  console.log(`🪙 Fetching crypto trade for ${normalizedSymbol}...`);

  try {
    const config = {
      method: 'GET',
      url: `${CRYPTO_DATA_URL}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(normalizedSymbol)}`,
      headers: {
        'APCA-API-KEY-ID': credentials.apiKey,
        'APCA-API-SECRET-KEY': credentials.secretKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    };

    const response = await axios(config);
    const trade = response.data.trades[normalizedSymbol];

    if (!trade) {
      throw new Error(`No trade data returned for ${normalizedSymbol}`);
    }

    return {
      symbol: normalizedSymbol,
      price: parseFloat(trade.p),
      size: parseFloat(trade.s),
      timestamp: trade.t,
      exchange: trade.x || 'crypto',
    };
  } catch (error) {
    console.error(`❌ Crypto trade error for ${normalizedSymbol}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Crypto trade request failed');
  }
}

/**
 * Get crypto bars (OHLCV) data
 * Uses Alpaca's crypto data API endpoint
 *
 * @param {string} symbol - Crypto symbol (BTC, BTC/USD, or BTCUSD)
 * @param {string} timeframe - '1Min', '5Min', '1Hour', '1Day', etc.
 * @param {string} start - Start date (RFC-3339 format or YYYY-MM-DD)
 * @param {string} end - End date
 * @param {number} limit - Max number of bars
 * @returns {Array} - Array of bar data
 */
async function getCryptoBars(
  symbol,
  timeframe = '1Day',
  start = null,
  end = null,
  limit = 10000
) {
  const normalizedSymbol = assetUtils.normalizeForAlpacaCrypto(symbol);
  const CRYPTO_DATA_URL = 'https://data.alpaca.markets';
  const credentials = tradingModeManager.getCredentials();

  const allBars = [];
  let nextPageToken = null;
  const maxBarsPerRequest = 1000;

  console.log(`🪙 Fetching crypto bars for ${normalizedSymbol} (${timeframe}) from ${start} to ${end}`);

  try {
    do {
      await rateLimit();

      const params = new URLSearchParams({
        symbols: normalizedSymbol,
        timeframe,
        limit: Math.min(maxBarsPerRequest, limit - allBars.length).toString(),
      });

      if (start) params.append('start', start);
      if (end) params.append('end', end);
      if (nextPageToken) params.append('page_token', nextPageToken);

      const config = {
        method: 'GET',
        url: `${CRYPTO_DATA_URL}/v1beta3/crypto/us/bars?${params.toString()}`,
        headers: {
          'APCA-API-KEY-ID': credentials.apiKey,
          'APCA-API-SECRET-KEY': credentials.secretKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      };

      const response = await axios(config);
      const data = response.data;

      // Crypto bars are nested under the symbol key
      const bars = data.bars?.[normalizedSymbol] || [];
      if (bars.length > 0) {
        allBars.push(...bars);
        console.log(`   Got ${bars.length} crypto bars, total: ${allBars.length}`);
      }

      nextPageToken = data.next_page_token;
    } while (nextPageToken && allBars.length < limit);

    console.log(`🪙 Alpaca: Retrieved ${allBars.length} total crypto bars for ${normalizedSymbol}`);

    return allBars.map(bar => ({
      timestamp: bar.t,
      open: parseFloat(bar.o),
      high: parseFloat(bar.h),
      low: parseFloat(bar.l),
      close: parseFloat(bar.c),
      volume: parseFloat(bar.v),
      vwap: bar.vw ? parseFloat(bar.vw) : null,
      tradeCount: bar.n,
    }));
  } catch (error) {
    console.error(`❌ Crypto bars error for ${normalizedSymbol}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Crypto bars request failed');
  }
}

/**
 * Place a crypto order
 * Uses Alpaca's standard order endpoint but with crypto-specific validation
 *
 * @param {Object} orderParams - Order parameters
 * @param {string} orderParams.symbol - Crypto symbol (will be normalized to BTC/USD format)
 * @param {number} orderParams.qty - Quantity (can be fractional for crypto)
 * @param {number} orderParams.notional - Dollar amount (alternative to qty)
 * @param {string} orderParams.side - 'buy' or 'sell'
 * @param {string} orderParams.type - 'market' or 'limit'
 * @param {string} orderParams.time_in_force - 'gtc', 'ioc', 'fok' (crypto doesn't support 'day')
 * @param {string|null} mode - Trading mode ('paper' or 'live')
 * @returns {Object} - Order details
 */
async function placeCryptoOrder(orderParams, mode = null) {
  const normalizedSymbol = assetUtils.normalizeForAlpacaCrypto(orderParams.symbol);
  const modeInfo = mode
    ? { statusText: mode.toUpperCase() + ' TRADING', isLive: mode === 'live' }
    : tradingModeManager.getModeInfo();

  // Crypto-specific validations
  if (orderParams.time_in_force === 'day') {
    // Crypto doesn't support 'day' orders - convert to 'gtc'
    console.warn('⚠️ Crypto does not support day orders - converting to gtc');
    orderParams.time_in_force = 'gtc';
  }

  // For crypto, qty can be fractional - convert to string for API
  if (orderParams.qty !== undefined) {
    orderParams.qty = String(orderParams.qty);
  }

  // Normalize symbol
  orderParams.symbol = normalizedSymbol;

  console.log(
    `🪙 Placing crypto ${orderParams.side} order: ${orderParams.qty || '$' + orderParams.notional} of ${normalizedSymbol} (${modeInfo.statusText})`
  );

  const order = await alpacaRequest('POST', '/v2/orders', orderParams, mode);

  console.log(`✅ Crypto order placed: ${order.id} (${order.status})`);

  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    side: order.side,
    quantity: parseFloat(order.qty),
    type: order.type,
    timeInForce: order.time_in_force,
    status: order.status,
    filledQty: parseFloat(order.filled_qty || 0),
    filledAvgPrice: order.filled_avg_price
      ? parseFloat(order.filled_avg_price)
      : null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    submittedAt: order.submitted_at,
    assetClass: 'crypto',
  };
}

/**
 * Get crypto positions
 * Filters positions to only return crypto assets
 *
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Array} - Array of crypto position objects
 */
async function getCryptoPositions(mode = null) {
  const modeLabel = mode ? mode.toUpperCase() : 'CURRENT';
  console.log(`🪙 Fetching crypto positions (${modeLabel})...`);

  const allPositions = await alpacaRequest('GET', '/v2/positions', null, mode);

  // Filter to only crypto positions (symbols contain '/')
  const cryptoPositions = allPositions.filter(pos =>
    pos.symbol.includes('/') || pos.asset_class === 'crypto'
  );

  console.log(`✅ Found ${cryptoPositions.length} crypto positions`);

  return cryptoPositions.map(pos => ({
    symbol: pos.symbol,
    quantity: parseFloat(pos.qty),
    side: pos.side,
    avgEntryPrice: parseFloat(pos.avg_entry_price),
    currentPrice: parseFloat(pos.current_price),
    marketValue: parseFloat(pos.market_value),
    costBasis: parseFloat(pos.cost_basis),
    unrealizedPL: parseFloat(pos.unrealized_pl),
    unrealizedPLPercent: parseFloat(pos.unrealized_plpc) * 100,
    changeToday: parseFloat(pos.change_today) * 100,
    assetClass: 'crypto',
  }));
}

/**
 * Close a crypto position
 *
 * @param {string} symbol - Crypto symbol (will be normalized)
 * @param {string|null} mode - Trading mode
 * @returns {Object} - Close result
 */
async function closeCryptoPosition(symbol, mode = null) {
  const normalizedSymbol = assetUtils.normalizeForAlpacaCrypto(symbol);
  // URL encode the symbol since it contains a slash
  const encodedSymbol = encodeURIComponent(normalizedSymbol);

  const modeLabel = mode ? mode.toUpperCase() : 'DEFAULT';
  console.log(`🪙 Closing crypto position: ${normalizedSymbol} (${modeLabel})`);

  const result = await alpacaRequest('DELETE', `/v2/positions/${encodedSymbol}`, null, mode);
  console.log(`✅ Crypto position closed: ${normalizedSymbol}`);
  return result;
}

// ==========================================
// END CRYPTO-SPECIFIC ENDPOINTS
// ==========================================

/**
 * CROSS-VALIDATION: Compare Alpaca and Polygon prices
 *
 * @param {string} symbol - Stock symbol
 * @param {Object} polygonClient - Polygon client instance
 * @returns {Object} - Comparison results
 */
async function validatePriceWithPolygon(symbol, polygonClient) {
  console.log(
    `\n🔍 Cross-validating ${symbol} prices between Alpaca and Polygon...`
  );

  try {
    // Get latest price from both sources
    const alpacaTrade = await getLatestTrade(symbol);
    const polygonQuote = await polygonClient.getLatestQuote(symbol);

    const alpacaPrice = alpacaTrade.price;
    const polygonPrice = polygonQuote.price;

    const priceDiff = Math.abs(alpacaPrice - polygonPrice);
    const priceDiffPercent = (priceDiff / polygonPrice) * 100;

    console.log(`   Alpaca Price:  $${alpacaPrice.toFixed(2)}`);
    console.log(`   Polygon Price: $${polygonPrice.toFixed(2)}`);
    console.log(
      `   Difference:    $${priceDiff.toFixed(2)} (${priceDiffPercent.toFixed(2)}%)`
    );

    // Flag if difference is > 0.5%
    const isValid = priceDiffPercent < 0.5;

    if (!isValid) {
      console.warn(`   ⚠️  WARNING: Price difference exceeds 0.5% threshold!`);
    } else {
      console.log(`   ✅ Prices validated (within 0.5% tolerance)`);
    }

    return {
      symbol,
      alpacaPrice,
      polygonPrice,
      difference: priceDiff,
      differencePercent: priceDiffPercent,
      isValid,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`❌ Validation failed for ${symbol}:`, error.message);
    return {
      symbol,
      error: error.message,
      isValid: false,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * CROSS-VALIDATION: Compare historical bars between Alpaca and Polygon
 *
 * @param {string} symbol - Stock symbol
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {Object} polygonClient - Polygon client instance
 * @returns {Object} - Comparison results
 */
async function validateHistoricalDataWithPolygon(
  symbol,
  startDate,
  endDate,
  polygonClient
) {
  console.log(
    `\n🔍 Cross-validating ${symbol} historical data (${startDate} to ${endDate})...`
  );

  try {
    // Get bars from both sources
    const alpacaBars = await getBars(symbol, '1Day', startDate, endDate);
    const polygonBars = await polygonClient.getHistoricalAggregates(
      symbol,
      startDate,
      endDate
    );

    console.log(`   Alpaca bars:  ${alpacaBars.length}`);
    console.log(`   Polygon bars: ${polygonBars.length}`);

    // Compare overlapping dates
    const comparisons = [];

    for (const alpacaBar of alpacaBars) {
      const alpacaDate = new Date(alpacaBar.timestamp)
        .toISOString()
        .split('T')[0];
      const polygonBar = polygonBars.find(pb => pb.date === alpacaDate);

      if (polygonBar) {
        const closeDiff = Math.abs(alpacaBar.close - polygonBar.close);
        const closeDiffPercent = (closeDiff / polygonBar.close) * 100;

        comparisons.push({
          date: alpacaDate,
          alpacaClose: alpacaBar.close,
          polygonClose: polygonBar.close,
          difference: closeDiff,
          differencePercent: closeDiffPercent,
          isValid: closeDiffPercent < 0.5,
        });
      }
    }

    const validCount = comparisons.filter(c => c.isValid).length;
    const validPercent = (validCount / comparisons.length) * 100;

    console.log(
      `   ✅ Validated ${validCount}/${comparisons.length} dates (${validPercent.toFixed(1)}%)`
    );

    if (validPercent < 95) {
      console.warn(`   ⚠️  WARNING: Less than 95% of data points validated!`);
    }

    return {
      symbol,
      dateRange: { start: startDate, end: endDate },
      totalDates: comparisons.length,
      validDates: validCount,
      validPercent,
      comparisons: comparisons.slice(0, 10), // Include first 10 for inspection
      isValid: validPercent >= 95,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `❌ Historical validation failed for ${symbol}:`,
      error.message
    );
    return {
      symbol,
      error: error.message,
      isValid: false,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Execute market buy order
 *
 * @param {string} symbol - Stock symbol
 * @param {number} quantity - Number of shares
 * @returns {Object} - Order details
 */
async function marketBuy(symbol, quantity) {
  return await placeOrder({
    symbol,
    qty: quantity,
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
  });
}

/**
 * Execute market sell order
 *
 * @param {string} symbol - Stock symbol
 * @param {number} quantity - Number of shares
 * @returns {Object} - Order details
 */
async function marketSell(symbol, quantity) {
  return await placeOrder({
    symbol,
    qty: quantity,
    side: 'sell',
    type: 'market',
    time_in_force: 'day',
  });
}

/**
 * Close a position (sell all shares)
 *
 * @param {string} symbol - Stock symbol
 * @returns {Object} - Close result
 */
async function closePosition(symbol, mode = null) {
  const modeLabel = mode ? mode.toUpperCase() : 'DEFAULT';
  console.log(`📤 Closing position: ${symbol} (${modeLabel})`);
  const result = await alpacaRequest('DELETE', `/v2/positions/${symbol}`, null, mode);
  console.log(`✅ Position closed: ${symbol}`);
  return result;
}

/**
 * Close all positions
 *
 * @returns {Array} - Array of close results
 */
async function closeAllPositions() {
  console.log('📤 Closing all positions...');
  const result = await alpacaRequest(
    'DELETE',
    '/v2/positions?cancel_orders=true'
  );
  console.log(`✅ All positions closed`);
  return result;
}

/**
 * Get Pattern Day Trade (PDT) status for an account
 *
 * PDT rules apply to margin accounts with equity < $25,000
 * Accounts are limited to 3 day trades per 5 rolling business days
 *
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Object} - PDT status information
 */
async function getPDTStatus(mode = null) {
  const account = await alpacaRequest('GET', '/v2/account', null, mode);

  const equity = parseFloat(account.equity || account.portfolio_value);
  const daytradeCount = parseInt(account.daytrade_count || 0);
  const daytradeLimit = 3; // FINRA PDT limit
  const pdtThreshold = 25000; // $25k PDT threshold

  // Pattern day trader flag from Alpaca
  const isPDT = account.pattern_day_trader === true;

  // Check if account is under PDT threshold
  const isUnderThreshold = equity < pdtThreshold;

  // Trades remaining today (for accounts under $25k)
  const daytradesRemaining = isUnderThreshold ? Math.max(0, daytradeLimit - daytradeCount) : Infinity;

  // Can we make a day trade (buy + sell same day)?
  const canDayTrade = !isUnderThreshold || daytradeCount < daytradeLimit;

  // Should we warn about PDT risk?
  const pdtWarning = isUnderThreshold && daytradeCount >= 2; // Warn when 1 or 0 remaining

  console.log(`📊 PDT Status: ${isPDT ? 'PDT FLAGGED' : 'OK'} | Day trades: ${daytradeCount}/${daytradeLimit} | Equity: $${equity.toFixed(2)} | Can day trade: ${canDayTrade}`);

  return {
    isPDT,                    // Is account flagged as pattern day trader?
    daytradeCount,            // Number of day trades in rolling 5-day period
    daytradeLimit,            // FINRA limit (3)
    daytradesRemaining,       // How many day trades left (for sub-$25k accounts)
    equity,                   // Current account equity
    pdtThreshold,             // $25,000 threshold
    isUnderThreshold,         // Is equity below $25k?
    canDayTrade,              // Can we make another day trade?
    pdtWarning,               // Should we warn user about PDT risk?
    // Recommendation for AI trading
    recommendation: !canDayTrade
      ? 'HOLD_OVERNIGHT'
      : (pdtWarning ? 'SWING_TRADE_PREFERRED' : 'DAY_TRADE_OK'),
  };
}

/**
 * Get account activities (trades, fills, etc.)
 * Used for P/L calculation on sell orders
 *
 * @param {Object} filters - { activity_types, date, until, after, direction, page_size }
 * @param {string|null} mode - Optional mode override ('paper' or 'live')
 * @returns {Array} - Array of activities
 */
async function getAccountActivities(filters = {}, mode = null) {
  let queryParams = [];

  // Default to FILL activities (completed trades)
  const activityTypes = filters.activity_types || 'FILL';
  queryParams.push(`activity_types=${activityTypes}`);

  if (filters.date) queryParams.push(`date=${filters.date}`);
  if (filters.until) queryParams.push(`until=${filters.until}`);
  if (filters.after) queryParams.push(`after=${filters.after}`);
  if (filters.direction) queryParams.push(`direction=${filters.direction}`);
  if (filters.page_size) queryParams.push(`page_size=${filters.page_size}`);

  const queryString = queryParams.length ? `?${queryParams.join('&')}` : '';
  const activities = await alpacaRequest(
    'GET',
    `/v2/account/activities${queryString}`,
    null,
    mode
  );

  return activities;
}

module.exports = {
  // Account management
  getAccount,
  getAccountActivities,
  getPDTStatus,

  // Positions
  getPositions,
  getPosition,
  closePosition,
  closeAllPositions,

  // Orders
  placeOrder,
  getOrders,
  cancelOrder,
  cancelAllOrders,
  marketBuy,
  marketSell,

  // Market data
  getLatestQuote,
  getLatestTrade,
  getBars,

  // Cross-validation
  validatePriceWithPolygon,
  validateHistoricalDataWithPolygon,

  // Crypto-specific endpoints (isolated from stock endpoints)
  getCryptoLatestQuote,
  getCryptoLatestTrade,
  getCryptoBars,
  placeCryptoOrder,
  getCryptoPositions,
  closeCryptoPosition,
};
