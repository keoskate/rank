/**
 * STOCK UTILITIES - Unified API Integration & Configuration
 *
 * This module provides a clean interface for stock data operations:
 *
 * KEY FUNCTIONS:
 * 1. getStockData() - Fetches live data from configured API provider
 * 2. Helper utilities for data manipulation
 * 3. STOCK_COLUMNS - Ranking criteria and weights configuration
 *
 * UNIFIED API FEATURES:
 * - Single configurable API (switch providers in config/apiConfig.js)
 * - Environment-based API key management
 * - Built-in rate limiting and error handling
 * - Clean, provider-agnostic interface
 * - Smart caching with validation
 *
 * SUPPORTED PROVIDERS: Alpha Vantage, Polygon.io
 * Configure provider in: config/apiConfig.js
 */

// Import from unified API system
import { getStockData as getUnifiedStockData, batchFetchStocks, getApiInfo } from '../api/unifiedAPI';

// Import stock columns configuration
export { STOCK_COLUMNS } from '../config/stockColumns';

/**
 * Get stock data using the configured API provider (single stock)
 * 
 * For better performance with multiple stocks, use getMultipleStocksData() instead.
 *
 * @param {string} stock - The Stock Ticker
 * @param {boolean} fetchFinancials - Whether to fetch additional financial data
 * @param {boolean} retry - Whether to retry on failure
 * @returns {Object|null} Formatted stock data or null if failed
 */
export async function getStockData(stock, fetchFinancials = false, retry = true) {
  return await getUnifiedStockData(stock, { fetchFinancials, retry });
}

/**
 * Get multiple stocks data efficiently using batch processing
 * 
 * Uses the configured API provider from config/apiConfig.js
 * Automatically handles rate limiting and provides clear progress updates
 *
 * @param {string[]} stocks - Array of stock tickers
 * @param {string} provider - Legacy parameter (ignored, uses config instead)
 * @param {Object} options - Additional options
 * @returns {Promise<Object[]>} Array of stock data objects
 */
export async function getMultipleStocksData(stocks, provider = null, options = {}) {
  if (!Array.isArray(stocks) || stocks.length === 0) {
    throw new Error('Stocks must be a non-empty array');
  }
  
  // Log current API configuration
  const apiInfo = getApiInfo();
  console.info(`🎯 Using ${apiInfo.name} (${apiInfo.cost}) for ${stocks.length} stocks`);
  
  if (stocks.length === 1) {
    // Single stock - use individual API for simplicity
    const result = await getStockData(stocks[0], options.fetchFinancials);
    return result ? [result] : [];
  }
  
  try {
    return await batchFetchStocks(stocks, options);
    
  } catch (error) {
    console.error(`❌ Failed to fetch stocks using ${apiInfo.name}:`, error.message);
    
    // Provide helpful error guidance
    console.info('💡 Troubleshooting suggestions:');
    console.info(`1. Check your API key is set correctly`);
    console.info(`2. Verify you haven't exceeded your ${apiInfo.dailyLimit} daily limit`);
    console.info(`3. Check rate limiting: ${apiInfo.rateLimit}`);
    console.info(`4. Switch providers in config/apiConfig.js if needed`);
    console.info(`5. Use debug mode with cached data for development`);
    
    throw error;
  }
}

// ******** Helpers  ********** //

export function revertSortFunc(a, b, order, sortField) {
  // order is desc or asc
  if (order === 'desc') {
    return a[sortField] - b[sortField];
  } else {
    return b[sortField] - a[sortField];
  }
}

export function wait(ms) {
  var start = new Date().getTime();
  var end = start;
  while (end < start + ms) {
    end = new Date().getTime();
  }
}

// Export API information for debugging and UI display
export { getApiInfo } from '../api/unifiedAPI';