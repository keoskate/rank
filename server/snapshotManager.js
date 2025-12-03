/**
 * Snapshot Manager - Handles daily ranking and quarterly metric snapshots
 *
 * This module provides functionality to:
 * 1. Generate daily ranking snapshots for backtesting
 * 2. Store and retrieve quarterly financial metrics
 * 3. Calculate QoQ/YoY comparisons
 * 4. Generate synthetic historical data for testing
 */

const fs = require('fs').promises;
const path = require('path');

// Paths
const SNAPSHOTS_DIR = path.join(__dirname, '../data/snapshots');
const QUARTERLY_DIR = path.join(__dirname, '../data/quarterly');

/**
 * Ensure directories exist
 */
async function ensureDirectories() {
  try {
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
    await fs.mkdir(QUARTERLY_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

/**
 * Generate daily ranking snapshot
 * Takes current stock data and saves it to a dated JSON file
 *
 * @param {Array} stocks - Array of stock data objects
 * @param {string} stockListName - Name of the stock list
 * @param {Date} date - Date for the snapshot (defaults to today)
 * @returns {Object} - Snapshot data
 */
async function generateDailySnapshot(stocks, stockListName = 'Default', date = new Date()) {
  await ensureDirectories();

  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const snapshot = {
    date: dateStr,
    timestamp: date.toISOString(),
    generatedAt: new Date().toISOString(),
    stockListName,
    rankings: stocks.map((stock, index) => ({
      symbol: stock.ticker,
      rank: index + 1,
      score: stock.score || 0,

      // Price data
      price: stock.price,
      marketCap: stock.marketCap,

      // Daily metrics
      rsi: stock.rsi,
      volume: stock.volume,
      impliedVolatility: stock.impliedVolatility,

      // Quarterly metrics
      peRatio: stock.peRatio,
      debtEbitda: stock.debtEbitda,
      roe: stock.roe,
      priceToBook: stock.priceToBook,
      freeCashFlowYield: stock.freeCashFlowYield,
      quickRatio: stock.quickRatio,
      ebitda: stock.ebitda,
      cash: stock.cash,
      netDebt: stock.netDebt,
      evEbitda: stock.evEbitda,

      // Snapshot metrics
      yearHigh: stock.yearHigh,
      yearLow: stock.yearLow,
      discount: stock.discount,
      beta: stock.beta,
      dividend: stock.dividend,

      // Metadata
      lastQuarterUpdate: stock.lastQuarterUpdate || '2025-11-01',
      dataQuality: stock._validation || { overallConfidence: 0.8, status: 'estimated' }
    })),
    metadata: {
      totalStocks: stocks.length,
      dataSource: 'polygon',
      version: '1.0'
    }
  };

  const filePath = path.join(SNAPSHOTS_DIR, `${dateStr}.json`);
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));

  console.log(`✅ Generated daily snapshot: ${dateStr} (${stocks.length} stocks)`);
  return snapshot;
}

/**
 * Load snapshot for a specific date
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Object|null} - Snapshot data or null if not found
 */
async function loadSnapshot(dateStr) {
  try {
    const filePath = path.join(SNAPSHOTS_DIR, `${dateStr}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`Snapshot not found for ${dateStr}:`, error.message);
    return null;
  }
}

/**
 * Get all available snapshot dates
 *
 * @returns {Array} - Array of date strings (YYYY-MM-DD)
 */
async function getAvailableSnapshots() {
  await ensureDirectories();

  try {
    const files = await fs.readdir(SNAPSHOTS_DIR);
    const dates = files
      .filter(f => f.endsWith('.json') && f !== 'README.md')
      .map(f => f.replace('.json', ''))
      .sort();
    return dates;
  } catch (error) {
    console.error('Error reading snapshots:', error);
    return [];
  }
}

/**
 * Load snapshots for a date range
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Array} - Array of snapshot objects
 */
async function loadSnapshotRange(startDate, endDate) {
  const allDates = await getAvailableSnapshots();
  const filteredDates = allDates.filter(date => date >= startDate && date <= endDate);

  const snapshots = [];
  for (const date of filteredDates) {
    const snapshot = await loadSnapshot(date);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}

/**
 * Generate synthetic historical snapshots for testing
 * Creates realistic historical rankings using random walk from current data
 *
 * @param {Array} currentStocks - Current stock data
 * @param {number} days - Number of days to generate
 * @param {string} stockListName - Name of stock list
 * @returns {Array} - Array of generated snapshots
 */
async function generateSyntheticHistory(currentStocks, days = 90, stockListName = 'Default') {
  await ensureDirectories();

  console.log(`🔄 Generating ${days} days of synthetic historical data...`);

  const snapshots = [];
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Generate realistic price movements (random walk with slight upward bias)
    const stocks = currentStocks.map(stock => {
      const daysBack = i;
      const volatility = 0.02; // 2% daily volatility
      const drift = 0.0005; // Slight upward bias

      // Random walk for price
      const priceChange = (Math.random() - 0.5 + drift) * volatility;
      const historicalPrice = stock.price * (1 - priceChange * daysBack);

      // Adjust other metrics proportionally
      const marketCap = stock.marketCap * (historicalPrice / stock.price);

      return {
        ...stock,
        price: parseFloat(historicalPrice.toFixed(2)),
        marketCap: parseFloat(marketCap.toFixed(0)),
        // Keep quarterly metrics constant (they don't change daily)
        // Add slight variation to daily metrics
        rsi: stock.rsi ? stock.rsi + (Math.random() - 0.5) * 10 : null,
        volume: stock.volume ? Math.floor(stock.volume * (0.8 + Math.random() * 0.4)) : null
      };
    });

    // Re-rank based on historical prices
    stocks.sort((a, b) => (b.score || 0) - (a.score || 0));

    const snapshot = await generateDailySnapshot(stocks, stockListName, date);
    snapshots.push(snapshot);
  }

  console.log(`✅ Generated ${snapshots.length} synthetic snapshots`);
  return snapshots;
}

/**
 * Save quarterly data for a stock
 *
 * @param {string} symbol - Stock ticker symbol
 * @param {Object} quarterData - Quarterly financial data
 * @returns {Object} - Updated quarterly data
 */
async function saveQuarterlyData(symbol, quarterData) {
  await ensureDirectories();

  const filePath = path.join(QUARTERLY_DIR, `${symbol}.json`);

  // Load existing data or create new
  let data;
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    data = JSON.parse(existing);
  } catch {
    data = {
      symbol,
      lastUpdated: new Date().toISOString(),
      quarters: [],
      metadata: {
        totalQuarters: 0,
        earliestQuarter: null,
        latestQuarter: null
      }
    };
  }

  // Add new quarter (avoid duplicates)
  const existingIndex = data.quarters.findIndex(q => q.quarter === quarterData.quarter);
  if (existingIndex >= 0) {
    data.quarters[existingIndex] = quarterData;
  } else {
    data.quarters.push(quarterData);
  }

  // Sort by date (newest first)
  data.quarters.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Update metadata
  data.lastUpdated = new Date().toISOString();
  data.metadata.totalQuarters = data.quarters.length;
  data.metadata.latestQuarter = data.quarters[0]?.quarter;
  data.metadata.earliestQuarter = data.quarters[data.quarters.length - 1]?.quarter;

  await fs.writeFile(filePath, JSON.stringify(data, null, 2));

  console.log(`✅ Saved quarterly data for ${symbol}: ${quarterData.quarter}`);
  return data;
}

/**
 * Load quarterly data for a stock
 *
 * @param {string} symbol - Stock ticker symbol
 * @returns {Object|null} - Quarterly data or null if not found
 */
async function loadQuarterlyData(symbol) {
  try {
    const filePath = path.join(QUARTERLY_DIR, `${symbol}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn(`Quarterly data not found for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Calculate Quarter-over-Quarter change
 *
 * @param {string} symbol - Stock ticker
 * @param {string} metric - Metric name (e.g., 'peRatio', 'roe')
 * @returns {Object|null} - QoQ data { value, trend, quarters, previousValue, currentValue }
 */
async function calculateQoQ(symbol, metric) {
  const data = await loadQuarterlyData(symbol);

  if (!data || data.quarters.length < 2) {
    return null;
  }

  const current = data.quarters[0];
  const previous = data.quarters[1];

  const currentValue = current[metric];
  const previousValue = previous[metric];

  if (currentValue == null || previousValue == null) {
    return null;
  }

  const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;

  // Determine trend direction
  let trend = 'neutral';
  if (Math.abs(change) > 5) {
    // For metrics where higher is better (ROE, etc.)
    const higherIsBetter = ['roe', 'freeCashFlowYield', 'quickRatio', 'ebitda', 'cash'].includes(metric);
    // For metrics where lower is better (debt, P/E, etc.)
    const lowerIsBetter = ['debtEbitda', 'peRatio', 'evEbitda', 'netDebt'].includes(metric);

    if (higherIsBetter) {
      trend = change > 0 ? 'improving' : 'declining';
    } else if (lowerIsBetter) {
      trend = change < 0 ? 'improving' : 'declining';
    } else {
      trend = change > 0 ? 'growth' : 'decline';
    }
  }

  return {
    value: parseFloat(change.toFixed(2)),
    trend,
    quarters: [current.quarter, previous.quarter],
    currentValue,
    previousValue,
    metric
  };
}

/**
 * Calculate Year-over-Year change
 *
 * @param {string} symbol - Stock ticker
 * @param {string} metric - Metric name
 * @returns {Object|null} - YoY data
 */
async function calculateYoY(symbol, metric) {
  const data = await loadQuarterlyData(symbol);

  if (!data || data.quarters.length < 4) {
    return null; // Need at least 4 quarters for YoY
  }

  const current = data.quarters[0];
  const yearAgo = data.quarters.find(q =>
    q.fiscalYear === current.fiscalYear - 1 && q.fiscalQuarter === current.fiscalQuarter
  ) || data.quarters[3]; // Fallback to 4 quarters ago

  const currentValue = current[metric];
  const previousValue = yearAgo[metric];

  if (currentValue == null || previousValue == null) {
    return null;
  }

  const change = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;

  let trend = 'neutral';
  if (Math.abs(change) > 10) {
    const higherIsBetter = ['roe', 'freeCashFlowYield', 'quickRatio', 'ebitda', 'cash'].includes(metric);
    const lowerIsBetter = ['debtEbitda', 'peRatio', 'evEbitda', 'netDebt'].includes(metric);

    if (higherIsBetter) {
      trend = change > 0 ? 'strong_growth' : 'declining';
    } else if (lowerIsBetter) {
      trend = change < 0 ? 'strong_improvement' : 'worsening';
    } else {
      trend = change > 0 ? 'growth' : 'decline';
    }
  }

  return {
    value: parseFloat(change.toFixed(2)),
    trend,
    quarters: [current.quarter, yearAgo.quarter],
    currentValue,
    previousValue,
    metric
  };
}

module.exports = {
  generateDailySnapshot,
  loadSnapshot,
  getAvailableSnapshots,
  loadSnapshotRange,
  generateSyntheticHistory,
  saveQuarterlyData,
  loadQuarterlyData,
  calculateQoQ,
  calculateYoY,
  ensureDirectories
};
