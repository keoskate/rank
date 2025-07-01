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

// Import stock columns configuration
export { STOCK_COLUMNS } from '../config/stockColumns';

/**
 * Get stock data using the modern Alpha Vantage API
 * 
 * This is the main entry point for fetching stock data.
 * It uses the Alpha Vantage API for reliable, up-to-date information.
 *
 * @param {string} stock - The Stock Ticker
 * @param {boolean} fetchFinancials - Whether to fetch additional financial data
 * @param {boolean} retry - Whether to retry on failure
 * @returns {Object|null} Formatted stock data or null if failed
 */
export async function getStockData(stock, fetchFinancials = false, retry = true) {
  return await getAlphaVantageData(stock, fetchFinancials, retry);
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