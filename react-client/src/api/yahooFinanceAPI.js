/**
 * YAHOO FINANCE API - Real financial data and market metrics
 *
 * Yahoo Finance provides reliable, free financial data including:
 * - Real 52-week highs and lows
 * - Comprehensive financial statements
 * - Market statistics and ratios
 * - Historical price data
 *
 * No API key required - uses public endpoints
 */

/**
 * Fetch comprehensive stock data from Yahoo Finance
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Promise<Object|null>} Yahoo Finance data or null if failed
 */
export async function fetchYahooFinanceData(symbol) {
  try {
    console.log(`📊 Fetching Yahoo Finance data for ${symbol}`);

    // Yahoo Finance quote endpoint - includes 52W high/low, market stats
    const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`;

    const quoteResponse = await fetch(quoteUrl);

    if (!quoteResponse.ok) {
      throw new Error(`Yahoo Finance HTTP ${quoteResponse.status}`);
    }

    const quoteData = await quoteResponse.json();

    if (!quoteData.chart?.result?.[0]) {
      throw new Error('No quote data available');
    }

    const result = quoteData.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];

    // Calculate real 52-week high and low from historical data
    const closesPrices = quote?.close || [];
    const highPrices = quote?.high || [];
    const lowPrices = quote?.low || [];

    const validHighs = highPrices.filter(p => p !== null && isFinite(p));
    const validLows = lowPrices.filter(p => p !== null && isFinite(p));
    const validCloses = closesPrices.filter(p => p !== null && isFinite(p));

    const yearHigh = validHighs.length > 0 ? Math.max(...validHighs) : null;
    const yearLow = validLows.length > 0 ? Math.min(...validLows) : null;

    // Get current price
    const currentPrice = meta.regularMarketPrice || validCloses[validCloses.length - 1];

    // Fetch detailed statistics and financials
    const statsUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics,financialData,summaryDetail`;

    let statsData = null;
    try {
      const statsResponse = await fetch(statsUrl);
      if (statsResponse.ok) {
        const json = await statsResponse.json();
        statsData = json.quoteSummary?.result?.[0];
      }
    } catch (error) {
      console.warn(`⚠️ Could not fetch detailed stats for ${symbol}:`, error.message);
    }

    // Extract financial metrics
    const keyStats = statsData?.defaultKeyStatistics || {};
    const financialData = statsData?.financialData || {};
    const summaryDetail = statsData?.summaryDetail || {};

    // Calculate discount from 52-week high
    const discount = yearHigh && currentPrice
      ? (yearHigh - currentPrice) / yearHigh
      : null;

    return {
      symbol: meta.symbol,
      currency: meta.currency,
      exchangeName: meta.exchangeName,
      instrumentType: meta.instrumentType,
      regularMarketPrice: currentPrice,

      // Real 52-week data
      fiftyTwoWeekHigh: yearHigh,
      fiftyTwoWeekLow: yearLow,
      fiftyTwoWeekRange: yearHigh && yearLow ? `${yearLow.toFixed(2)} - ${yearHigh.toFixed(2)}` : null,
      discount: discount,

      // Volume and trading
      regularMarketVolume: meta.regularMarketVolume,
      averageVolume: keyStats.averageDailyVolume10Day?.raw,

      // Market cap and valuation
      marketCap: summaryDetail.marketCap?.raw,
      enterpriseValue: keyStats.enterpriseValue?.raw,

      // Financial ratios (REAL from Yahoo)
      peRatio: summaryDetail.trailingPE?.raw || keyStats.forwardPE?.raw,
      priceToBook: keyStats.priceToBook?.raw,
      priceToSales: summaryDetail.priceToSalesTrailing12Months?.raw,
      pegRatio: keyStats.pegRatio?.raw,

      // Profitability metrics
      profitMargins: financialData.profitMargins?.raw,
      operatingMargins: financialData.operatingMargins?.raw,
      returnOnAssets: financialData.returnOnAssets?.raw,
      returnOnEquity: financialData.returnOnEquity?.raw,

      // Cash and debt (REAL data)
      totalCash: financialData.totalCash?.raw,
      totalDebt: financialData.totalDebt?.raw,
      debtToEquity: financialData.debtToEquity?.raw,
      currentRatio: financialData.currentRatio?.raw,
      quickRatio: financialData.quickRatio?.raw,

      // Revenue and earnings
      totalRevenue: financialData.totalRevenue?.raw,
      revenuePerShare: financialData.revenuePerShare?.raw,
      earningsGrowth: financialData.earningsGrowth?.raw,
      revenueGrowth: financialData.revenueGrowth?.raw,

      // Free cash flow
      freeCashflow: financialData.freeCashflow?.raw,
      operatingCashflow: financialData.operatingCashflow?.raw,

      // EBITDA
      ebitda: financialData.ebitda?.raw,
      ebitdaMargins: financialData.ebitdaMargins?.raw,

      // Risk metrics
      beta: keyStats.beta?.raw || summaryDetail.beta?.raw,

      // Dividend info
      dividendRate: summaryDetail.dividendRate?.raw,
      dividendYield: summaryDetail.dividendYield?.raw,

      // Target and recommendations
      targetMeanPrice: financialData.targetMeanPrice?.raw,
      recommendationKey: financialData.recommendationKey,

      // Timestamp
      timestamp: Date.now(),
      source: 'Yahoo Finance'
    };
  } catch (error) {
    console.error(`❌ Yahoo Finance fetch failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch historical price data from Yahoo Finance
 * Useful for backtesting and calculating technical indicators
 *
 * @param {string} symbol - Stock ticker symbol
 * @param {string} range - Time range (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max)
 * @param {string} interval - Data interval (1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo)
 * @returns {Promise<Object|null>} Historical price data
 */
export async function fetchYahooHistoricalData(symbol, range = '1y', interval = '1d') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.chart?.result?.[0]) {
      throw new Error('No historical data available');
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];

    if (!quote) {
      throw new Error('No quote data in historical response');
    }

    // Format historical data
    const historicalData = timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString(),
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index]
    })).filter(item => item.close !== null); // Filter out null data points

    return {
      symbol: result.meta.symbol,
      range: range,
      interval: interval,
      dataPoints: historicalData,
      timestamp: Date.now(),
      source: 'Yahoo Finance'
    };
  } catch (error) {
    console.error(`❌ Yahoo Finance historical fetch failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Get current stock quote (lightweight, just price and basic info)
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Promise<Object|null>} Current quote data
 */
export async function fetchYahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.chart?.result?.[0]) {
      throw new Error('No quote data available');
    }

    const result = data.chart.result[0];
    const meta = result.meta;

    return {
      symbol: meta.symbol,
      price: meta.regularMarketPrice,
      change: meta.regularMarketPrice - meta.chartPreviousClose,
      changePercent: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100,
      volume: meta.regularMarketVolume,
      timestamp: meta.regularMarketTime * 1000,
      source: 'Yahoo Finance'
    };
  } catch (error) {
    console.error(`❌ Yahoo Finance quote fetch failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Batch fetch multiple stocks efficiently
 *
 * @param {string[]} symbols - Array of stock ticker symbols
 * @param {number} batchSize - Number of concurrent requests (default: 5)
 * @returns {Promise<Object[]>} Array of Yahoo Finance data
 */
export async function batchFetchYahooFinance(symbols, batchSize = 5) {
  console.log(`📦 Batch fetching ${symbols.length} stocks from Yahoo Finance`);

  const results = [];
  const errors = [];

  // Process in batches to avoid rate limiting
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    console.log(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(symbols.length / batchSize)}: ${batch.join(', ')}`);

    const batchPromises = batch.map(async symbol => {
      try {
        const data = await fetchYahooFinanceData(symbol);
        return data;
      } catch (error) {
        console.error(`❌ Failed to fetch ${symbol}:`, error.message);
        errors.push({ symbol, error: error.message });
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(result => result !== null));

    // Small delay between batches to be respectful to the API
    if (i + batchSize < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} stocks failed to fetch from Yahoo Finance:`, errors);
  }

  console.log(`✅ Successfully fetched ${results.length}/${symbols.length} stocks from Yahoo Finance`);
  return results;
}

/**
 * Test Yahoo Finance API connection
 *
 * @returns {Promise<boolean>} True if API is accessible
 */
export async function testYahooFinanceConnection() {
  try {
    console.log('🔍 Testing Yahoo Finance API connection...');
    const testData = await fetchYahooQuote('AAPL');

    if (testData && testData.price) {
      console.log(`✅ Yahoo Finance API is working! AAPL price: $${testData.price}`);
      return true;
    }

    console.warn('⚠️ Yahoo Finance API returned invalid data');
    return false;
  } catch (error) {
    console.error('❌ Yahoo Finance API test failed:', error.message);
    return false;
  }
}
