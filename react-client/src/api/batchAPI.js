/**
 * BATCH API INTERFACE - Efficient Multi-Stock Data Fetching
 * 
 * This module provides a unified interface for fetching multiple stocks efficiently
 * across different financial API providers. It handles batching, rate limiting,
 * and provider-specific optimizations.
 * 
 * KEY FEATURES:
 * - Batch processing to minimize API calls
 * - Provider-agnostic interface for easy API switching  
 * - Intelligent rate limiting and request optimization
 * - Error handling and fallback strategies
 * - Scalable architecture for adding new APIs
 */

import { getStockData as getAlphaVantageData } from './alphaVantageAPI';
import { batchFetchYahooDirect } from './yahooDirectAPI';

/**
 * Batch fetch stock data efficiently based on the provider
 * 
 * @param {string[]} symbols - Array of stock symbols to fetch
 * @param {string} provider - API provider ('alphavantage', 'yahoo', 'polygon', etc.)
 * @param {Object} options - Additional options for fetching
 * @returns {Promise<Object[]>} Array of stock data objects
 */
export async function batchFetchStocks(symbols, provider = 'alphavantage', options = {}) {
  console.info(`📊 Batch fetching ${symbols.length} stocks using ${provider}`);
  
  const startTime = Date.now();
  
  try {
    let results;
    
    switch (provider) {
      case 'alphavantage':
        results = await batchFetchAlphaVantage(symbols, options);
        break;
      case 'yahoo':
        results = await batchFetchYahoo(symbols, options);
        break;
      case 'yahoo-direct':
        results = await batchFetchYahooDirect(symbols, options);
        break;
      case 'polygon':
        results = await batchFetchPolygon(symbols, options);
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
    
    const duration = (Date.now() - startTime) / 1000;
    console.info(`✅ Batch fetch completed in ${duration.toFixed(1)}s (${symbols.length} stocks)`);
    
    return results;
    
  } catch (error) {
    console.error('❌ Batch fetch failed:', error);
    throw error;
  }
}

/**
 * Alpha Vantage batch implementation - optimized for their API limits
 * Uses overview endpoint only (more efficient) and intelligent batching
 */
async function batchFetchAlphaVantage(symbols, options) {
  const API_KEY = process.env.REACT_APP_ALPHA_VANTAGE_API_KEY || '1KEVFA9KIQVOBJUE';
  const results = [];
  const errors = [];
  
  // Alpha Vantage: 5 calls/minute, so batch in groups of 5 with 60-second delays
  const BATCH_SIZE = 5;
  const BATCH_DELAY = 60000; // 1 minute between batches
  
  console.info(`📦 Processing ${symbols.length} stocks in batches of ${BATCH_SIZE}`);
  
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    console.info(`🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(symbols.length / BATCH_SIZE)}: ${batch.join(', ')}`);
    
    // Process current batch in parallel (within rate limit)
    const batchPromises = batch.map(async (symbol, index) => {
      // Stagger requests within batch (12 seconds apart)
      await new Promise(resolve => setTimeout(resolve, index * 12000));
      
      try {
        // Use only overview endpoint for efficiency (contains most data we need)
        const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${API_KEY}`;
        const response = await fetch(overviewUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${symbol}`);
        }
        
        const data = await response.json();
        
        // Check for API errors
        if (data.Note || data.Error || data.Information) {
          throw new Error(data.Note || data.Error || data.Information);
        }
        
        // Parse data using optimized single-endpoint approach
        return parseAlphaVantageOverview(data);
        
      } catch (error) {
        console.error(`❌ Failed to fetch ${symbol}:`, error.message);
        errors.push({ symbol, error: error.message });
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(result => result !== null));
    
    // Wait before next batch (except for last batch)
    if (i + BATCH_SIZE < symbols.length) {
      console.info(`⏳ Waiting ${BATCH_DELAY / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }
  }
  
  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} stocks failed to fetch:`, errors);
  }
  
  return results;
}

/**
 * Parse Alpha Vantage overview data (single endpoint approach)
 * This is more efficient than the dual-endpoint approach
 */
function parseAlphaVantageOverview(overview) {
  if (!overview || !overview.Symbol) {
    return null;
  }

  // Helper functions
  const formatNumber = (value, precision = 2) => {
    if (value == null || value === 'None' || value === '-') return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(precision));
  };

  // Calculate discount from 52-week high and current price
  const calculateDiscount = () => {
    const currentPrice = formatNumber(overview.Price);
    const yearHigh = formatNumber(overview['52WeekHigh']);
    
    if (yearHigh === 0) return 0;
    return formatNumber((yearHigh - currentPrice) / yearHigh);
  };

  // Calculate financial ratios
  const calculateDebtEbitda = () => {
    const bookValue = formatNumber(overview.BookValue);
    const ebitda = formatNumber(overview.EBITDA);
    
    if (ebitda === 0) return 0;
    
    // Conservative debt estimate
    const estimatedDebt = bookValue * 0.3;
    return formatNumber(estimatedDebt / (ebitda / 1000000));
  };

  const calculateNetDebt = () => {
    const bookValue = formatNumber(overview.BookValue);
    const marketCap = formatNumber(overview.MarketCapitalization);
    
    const estimatedDebt = Math.max(0, bookValue * 0.2);
    const estimatedCash = Math.max(0, marketCap * 0.05);
    
    return Math.max(0, estimatedDebt - estimatedCash);
  };

  return {
    rank: 0,
    ticker: overview.Symbol,
    name: overview.Name,
    industry: overview.Industry || 'Unknown',
    price: formatNumber(overview.Price),
    yearHigh: formatNumber(overview['52WeekHigh']),
    discount: calculateDiscount(),
    debtEbitda: calculateDebtEbitda(),
    netDebt: calculateNetDebt(),
    beta: formatNumber(overview.Beta),
    quickRatio: formatNumber(overview.QuickRatio || 1.0),
    dividend: formatNumber(overview.DividendPerShare),
    ebitda: formatNumber(overview.EBITDA ? overview.EBITDA / 1000000 : 0),
    evEbitda: formatNumber(overview.EVToEBITDA),
    cash: formatNumber(overview.MarketCapitalization ? overview.MarketCapitalization * 0.05 : 0)
  };
}

/**
 * Yahoo Finance batch implementation (when available)
 */
async function batchFetchYahoo(symbols, options) {
  // Yahoo Finance can handle multiple symbols in a single request
  console.info('📦 Using Yahoo Finance batch endpoint');
  
  // Implementation would use Yahoo's bulk endpoint
  // For now, fallback to individual requests
  throw new Error('Yahoo Finance batch implementation not yet available');
}

/**
 * Polygon.io batch implementation (future)
 */
async function batchFetchPolygon(symbols, options) {
  // Polygon.io has excellent batch endpoints
  console.info('📦 Using Polygon.io batch endpoint');
  
  // Implementation would use Polygon's grouped daily bars endpoint
  throw new Error('Polygon.io batch implementation not yet available');
}

/**
 * Get optimal batch configuration for a provider
 */
export function getBatchConfig(provider) {
  const configs = {
    alphavantage: {
      maxBatchSize: 5,
      requestDelay: 12000, // 12 seconds between requests
      batchDelay: 60000,   // 1 minute between batches
      dailyLimit: 500,
      rateLimitWindow: 'minute'
    },
    yahoo: {
      maxBatchSize: 50,    // Can handle many symbols at once
      requestDelay: 1000,   // 1 second
      batchDelay: 5000,     // 5 seconds between batches
      monthlyLimit: 500,
      rateLimitWindow: 'month'
    },
    polygon: {
      maxBatchSize: 1000,   // Excellent batch support
      requestDelay: 100,    // Very fast
      batchDelay: 1000,     // 1 second
      dailyLimit: 'unlimited',
      rateLimitWindow: 'day'
    }
  };
  
  return configs[provider] || configs.alphavantage;
}