/**
 * API MODULE INDEX - Central API Management
 * 
 * This module provides a clean interface for managing different financial APIs.
 * It allows easy switching between API providers and maintains backward compatibility.
 * 
 * CURRENT SETUP:
 * - Primary: Alpha Vantage API (modern, reliable, 500 calls/day)
 * - Legacy: Yahoo Finance API (deprecated, 500 calls/month)
 * 
 * USAGE:
 * import { getStockData } from '../api';  // Uses current primary API
 * import { getAlphaVantageData, getYahooFinanceData } from '../api';  // Specific APIs
 */

// Export the primary API (Alpha Vantage)
export { getStockData, parseData } from './alphaVantageAPI';

// Export specific API implementations for advanced usage
export { 
  getStockData as getAlphaVantageData,
  parseData as parseAlphaVantageData 
} from './alphaVantageAPI';

export { 
  getStockDataLegacy as getYahooFinanceData,
  parseDataLegacy as parseYahooFinanceData 
} from './yahooFinanceAPI';

// API configuration and metadata
export const API_CONFIG = {
  primary: 'alphavantage',
  available: ['alphavantage', 'yahoo-finance'],
  limits: {
    alphavantage: {
      daily: 500,
      perMinute: 5,
      description: 'Alpha Vantage free tier'
    },
    'yahoo-finance': {
      monthly: 500,
      perSecond: 1,
      description: 'Yahoo Finance via RapidAPI (deprecated)'
    }
  }
};

/**
 * Get API configuration information
 * @param {string} apiName - Name of the API ('alphavantage' or 'yahoo-finance')
 * @returns {Object} API configuration object
 */
export function getAPIConfig(apiName = null) {
  if (apiName) {
    return {
      name: apiName,
      limits: API_CONFIG.limits[apiName],
      isPrimary: apiName === API_CONFIG.primary
    };
  }
  return API_CONFIG;
}