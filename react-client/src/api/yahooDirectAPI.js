/**
 * YAHOO FINANCE DIRECT API - No API Key Required
 * 
 * This module provides direct access to Yahoo Finance data without requiring
 * API keys or dealing with rate limits. Perfect for development and testing.
 * 
 * BENEFITS:
 * - No API key required
 * - No rate limits (be respectful)
 * - Fast and reliable
 * - Real-time data
 * - Free forever
 * 
 * NOTE: This uses Yahoo's public endpoints directly. While this works great
 * for development, consider premium APIs for production applications.
 */

/**
 * Get stock data directly from Yahoo Finance (no API key required)
 * 
 * @param {string} symbol - Stock symbol (e.g., 'AAPL')
 * @param {Object} options - Additional options
 * @returns {Promise<Object|null>} Formatted stock data
 */
export async function getStockDataDirect(symbol, options = {}) {
  console.info(`📊 Fetching ${symbol} from Yahoo Finance Direct (no API key)`);
  
  try {
    // Yahoo Finance public API endpoint
    const modules = [
      'defaultKeyStatistics',
      'financialData', 
      'summaryDetail',
      'price',
      'summaryProfile'
    ].join(',');
    
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${symbol}`);
    }
    
    const data = await response.json();
    
    if (!data.quoteSummary || !data.quoteSummary.result || !data.quoteSummary.result[0]) {
      throw new Error(`No data available for ${symbol}`);
    }
    
    const result = data.quoteSummary.result[0];
    return parseYahooDirectData(result);
    
  } catch (error) {
    console.error(`❌ Failed to fetch ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Batch fetch multiple stocks from Yahoo Finance Direct
 * 
 * @param {string[]} symbols - Array of stock symbols
 * @param {Object} options - Additional options
 * @returns {Promise<Object[]>} Array of stock data
 */
export async function batchFetchYahooDirect(symbols, options = {}) {
  console.info(`📦 Batch fetching ${symbols.length} stocks from Yahoo Direct`);
  
  const results = [];
  const errors = [];
  
  // Yahoo Direct can handle faster requests (no rate limits)
  const promises = symbols.map(async (symbol, index) => {
    // Small delay to be respectful to Yahoo's servers
    await new Promise(resolve => setTimeout(resolve, index * 100));
    
    try {
      const result = await getStockDataDirect(symbol, options);
      return result;
    } catch (error) {
      console.error(`❌ Failed to fetch ${symbol}:`, error.message);
      errors.push({ symbol, error: error.message });
      return null;
    }
  });
  
  const batchResults = await Promise.all(promises);
  const validResults = batchResults.filter(result => result !== null);
  
  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} stocks failed to fetch:`, errors);
  }
  
  console.info(`✅ Successfully fetched ${validResults.length}/${symbols.length} stocks`);
  return validResults;
}

/**
 * Parse Yahoo Finance direct data into our standard format
 */
function parseYahooDirectData(data) {
  const { 
    price, 
    summaryDetail, 
    financialData, 
    defaultKeyStatistics, 
    summaryProfile 
  } = data;
  
  // Helper function
  const getRawValue = (obj) => {
    if (!obj) return 0;
    return obj.raw !== undefined ? obj.raw : obj;
  };
  
  const formatNumber = (value, precision = 2) => {
    const num = parseFloat(getRawValue(value));
    return isNaN(num) ? 0 : parseFloat(num.toFixed(precision));
  };
  
  // Calculate discount from 52-week high
  const calculateDiscount = () => {
    const currentPrice = formatNumber(price?.regularMarketPrice);
    const yearHigh = formatNumber(summaryDetail?.fiftyTwoWeekHigh);
    
    if (yearHigh === 0) return 0;
    return formatNumber((yearHigh - currentPrice) / yearHigh);
  };
  
  // Calculate debt to EBITDA ratio
  const calculateDebtEbitda = () => {
    const totalDebt = formatNumber(financialData?.totalDebt);
    const ebitda = formatNumber(financialData?.ebitda);
    
    if (ebitda === 0) return 0;
    return formatNumber(totalDebt / ebitda);
  };
  
  // Calculate net debt
  const calculateNetDebt = () => {
    const totalDebt = formatNumber(financialData?.totalDebt);
    const totalCash = formatNumber(financialData?.totalCash);
    
    return Math.max(0, totalDebt - totalCash);
  };
  
  return {
    rank: 0,
    ticker: getRawValue(price?.symbol) || 'N/A',
    name: summaryProfile?.longName || 'Unknown Company',
    industry: summaryProfile?.industry || 'Unknown',
    price: formatNumber(price?.regularMarketPrice),
    yearHigh: formatNumber(summaryDetail?.fiftyTwoWeekHigh),
    discount: calculateDiscount(),
    debtEbitda: calculateDebtEbitda(),
    netDebt: calculateNetDebt() / 1000000, // Convert to millions
    beta: formatNumber(summaryDetail?.beta),
    quickRatio: formatNumber(financialData?.quickRatio || 1.0),
    dividend: formatNumber(summaryDetail?.dividendRate),
    ebitda: formatNumber(financialData?.ebitda) / 1000000, // Convert to millions
    evEbitda: formatNumber(defaultKeyStatistics?.enterpriseToEbitda),
    cash: formatNumber(financialData?.totalCash) / 1000000 // Convert to millions
  };
}

/**
 * Test the Yahoo Direct API with a sample stock
 */
export async function testYahooDirectAPI() {
  console.log('🧪 Testing Yahoo Finance Direct API...');
  
  try {
    const result = await getStockDataDirect('AAPL');
    if (result) {
      console.log('✅ Yahoo Direct API working!');
      console.log('📊 Sample data:', result);
      return true;
    } else {
      console.log('❌ No data returned');
      return false;
    }
  } catch (error) {
    console.error('❌ Yahoo Direct API test failed:', error);
    return false;
  }
}