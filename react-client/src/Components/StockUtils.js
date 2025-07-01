/**
 * STOCK UTILITIES - Modern API Integration & Configuration
 *
 * This module provides a clean interface for stock data operations:
 *
 * KEY FUNCTIONS:
 * 1. getStockData() - Fetches live data from Alpha Vantage API
 * 2. Helper utilities for data manipulation
 * 3. STOCK_COLUMNS - Ranking criteria and weights configuration
 *
 * MODERN FEATURES:
 * - Alpha Vantage API integration (500 calls/day vs 500/month)
 * - Environment-based API key management
 * - Built-in rate limiting and error handling
 * - Modular API structure for easy switching
 * - Better security and reliability
 *
 * IMPORTANT: Uses Alpha Vantage API for modern, reliable data
 * Changes here affect data fetching and ranking calculations
 */

// Import from modern Alpha Vantage API
import { getStockData as getAlphaVantageData } from '../api/alphaVantageAPI';
import { batchFetchStocks } from '../api/batchAPI';

// Import stock columns configuration
export { STOCK_COLUMNS } from '../config/stockColumns';

/**
 * Get stock data using the modern Alpha Vantage API (single stock)
 * 
 * For better performance with multiple stocks, use getMultipleStocksData() instead.
 *
 * @param {string} stock - The Stock Ticker
 * @param {boolean} fetchFinancials - Whether to fetch additional financial data
 * @param {boolean} retry - Whether to retry on failure
 * @returns {Object|null} Formatted stock data or null if failed
 */
export async function getStockData(stock, fetchFinancials = false, retry = true) {
  return await getAlphaVantageData(stock, fetchFinancials, retry);
}

/**
 * Get multiple stocks data efficiently using batch processing
 * 
 * This is the RECOMMENDED way to fetch multiple stocks as it's much faster
 * and uses fewer API calls than individual requests.
 *
 * @param {string[]} stocks - Array of stock tickers
 * @param {string} provider - API provider ('alphavantage', 'yahoo', 'polygon')
 * @param {Object} options - Additional options
 * @returns {Promise<Object[]>} Array of stock data objects
 */
export async function getMultipleStocksData(stocks, provider = 'alphavantage', options = {}) {
  if (!Array.isArray(stocks) || stocks.length === 0) {
    throw new Error('Stocks must be a non-empty array');
  }
  
  if (stocks.length === 1) {
    // Single stock - use individual API for simplicity
    const result = await getStockData(stocks[0]);
    return result ? [result] : [];
  }
  
  // Multiple stocks - use efficient batch processing
  return await batchFetchStocks(stocks, provider, options);
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

// Re-export for backward compatibility if needed
// Note: Prefer using the direct imports from api/ folder for new code
export { getStockData as getAlphaVantageData } from '../api/alphaVantageAPI';
export { getStockDataLegacy as getYahooFinanceData } from '../api/yahooFinanceAPI';