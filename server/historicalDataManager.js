/**
 * HISTORICAL DATA MANAGER - Real Data Backfill System
 *
 * Manages fetching and storing real historical stock data from Polygon API
 * for accurate backtesting.
 *
 * Features:
 * - Backfill historical rankings from API data
 * - Generate daily snapshots from real price data
 * - Calculate rankings based on historical fundamentals
 * - Store in snapshot format for backtesting
 */

const polygonClient = require('./polygonClient');
const snapshotManager = require('./snapshotManager');
const fs = require('fs').promises;
const path = require('path');

/**
 * Backfill historical snapshots from real market data
 *
 * @param {Array} symbols - Stock symbols to backfill
 * @param {number} days - Number of days to backfill
 * @param {string} stockListName - Name of the stock list
 * @returns {Array} - Generated snapshots
 */
async function backfillRealHistory(
  symbols,
  days = 90,
  stockListName = 'Real Data'
) {
  console.log(
    `\n🔄 Starting historical data backfill for ${symbols.length} stocks, ${days} days...`
  );

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  console.log(`📅 Date range: ${startDateStr} to ${endDateStr}`);

  // Step 1: Fetch historical price data for all symbols
  console.log('\n📊 Step 1: Fetching historical price data from Polygon...');
  const historicalData = await polygonClient.batchGetHistoricalData(
    symbols,
    startDateStr,
    endDateStr
  );

  // Step 2: Organize data by date
  console.log('\n📅 Step 2: Organizing data by date...');
  const dateMap = new Map();

  for (const [symbol, bars] of Object.entries(historicalData)) {
    if (!bars || bars.length === 0) {
      console.warn(`⚠️ No data for ${symbol}, skipping...`);
      continue;
    }

    for (const bar of bars) {
      if (!dateMap.has(bar.date)) {
        dateMap.set(bar.date, new Map());
      }
      dateMap.get(bar.date).set(symbol, bar);
    }
  }

  console.log(`✅ Found data for ${dateMap.size} unique dates`);

  // Step 3: Generate snapshots for each date
  console.log('\n💾 Step 3: Generating snapshots...');
  const snapshots = [];
  const dates = Array.from(dateMap.keys()).sort();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const stockDataForDate = dateMap.get(date);

    // Build stock array for this date
    const stocks = [];
    for (const [symbol, bar] of stockDataForDate.entries()) {
      // Get all historical bars up to this date for technical indicators
      const barsUpToDate = historicalData[symbol].filter(b => b.date <= date);

      // Calculate technical indicators
      const indicators =
        polygonClient.calculateTechnicalIndicators(barsUpToDate);

      // Calculate score (simple version based on price momentum and volume)
      const score = calculateHistoricalScore(bar, indicators, barsUpToDate);

      stocks.push({
        ticker: symbol,
        price: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        vwap: bar.vwap,
        rsi: indicators?.rsi || null,
        sma20: indicators?.sma20 || null,
        sma50: indicators?.sma50 || null,
        sma200: indicators?.sma200 || null,
        volatility: indicators?.volatility || null,
        score: score,
      });
    }

    // Sort by score descending
    stocks.sort((a, b) => b.score - a.score);

    // Generate and save snapshot
    const snapshot = await snapshotManager.generateDailySnapshot(
      stocks,
      stockListName,
      new Date(date)
    );
    snapshots.push(snapshot);

    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${dates.length} snapshots generated`);
    }
  }

  console.log(
    `\n✅ Backfill complete! Generated ${snapshots.length} real historical snapshots`
  );
  console.log(`📁 Snapshots saved to: data/snapshots/`);

  return snapshots;
}

/**
 * Calculate a simple historical score for ranking
 *
 * This is a placeholder scoring system. In production, you'd use
 * your actual ranking algorithm with fundamentals.
 *
 * @param {Object} bar - Price bar for the day
 * @param {Object} indicators - Technical indicators
 * @param {Array} historicalBars - All bars up to this date
 * @returns {number} - Score (0-100)
 */
function calculateHistoricalScore(bar, indicators, historicalBars) {
  let score = 50; // Base score

  // Price momentum (20-day)
  if (historicalBars.length >= 20) {
    const priceChange20d =
      ((bar.close - historicalBars[historicalBars.length - 20].close) /
        historicalBars[historicalBars.length - 20].close) *
      100;
    score += Math.min(Math.max(priceChange20d, -20), 20); // Cap at +/- 20 points
  }

  // RSI scoring (prefer 40-70 range)
  if (indicators?.rsi) {
    if (indicators.rsi >= 40 && indicators.rsi <= 70) {
      score += 10;
    } else if (indicators.rsi > 70) {
      score -= 5; // Overbought penalty
    } else if (indicators.rsi < 40) {
      score -= 5; // Oversold penalty
    }
  }

  // Trend (price vs SMA50)
  if (indicators?.sma50) {
    if (bar.close > indicators.sma50) {
      score += 10; // Price above 50-day SMA (uptrend)
    } else {
      score -= 5;
    }
  }

  // Volume analysis (compare to 20-day average)
  if (historicalBars.length >= 20) {
    const avgVolume =
      historicalBars.slice(-20).reduce((sum, b) => sum + b.volume, 0) / 20;
    if (bar.volume > avgVolume * 1.2) {
      score += 5; // High volume = interest
    }
  }

  // Volatility penalty (prefer lower volatility)
  if (indicators?.volatility) {
    if (indicators.volatility < 2) {
      score += 5; // Low volatility bonus
    } else if (indicators.volatility > 5) {
      score -= 10; // High volatility penalty
    }
  }

  // Clamp score to 0-100 range
  return Math.max(0, Math.min(100, score));
}

/**
 * Get current stock rankings from live data
 *
 * Fetches latest prices and calculates current rankings
 *
 * @param {Array} symbols - Stock symbols
 * @returns {Array} - Ranked stocks
 */
async function getCurrentRankings(symbols) {
  console.log(`\n📊 Fetching current rankings for ${symbols.length} stocks...`);

  const stocks = [];
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 200); // Get enough history for 200-day SMA
  const startDateStr = startDate.toISOString().split('T')[0];

  for (const symbol of symbols) {
    try {
      // Get historical data for technical indicators
      const bars = await polygonClient.getHistoricalAggregates(
        symbol,
        startDateStr,
        endDate
      );

      if (!bars || bars.length === 0) {
        console.warn(`⚠️ No data for ${symbol}`);
        continue;
      }

      const latestBar = bars[bars.length - 1];
      const indicators = polygonClient.calculateTechnicalIndicators(bars);
      const score = calculateHistoricalScore(latestBar, indicators, bars);

      stocks.push({
        ticker: symbol,
        price: latestBar.close,
        open: latestBar.open,
        high: latestBar.high,
        low: latestBar.low,
        volume: latestBar.volume,
        vwap: latestBar.vwap,
        rsi: indicators?.rsi || null,
        sma20: indicators?.sma20 || null,
        sma50: indicators?.sma50 || null,
        sma200: indicators?.sma200 || null,
        volatility: indicators?.volatility || null,
        score: score,
      });
    } catch (error) {
      console.error(`❌ Error fetching data for ${symbol}:`, error.message);
    }
  }

  // Sort by score descending
  stocks.sort((a, b) => b.score - a.score);

  console.log(`✅ Current rankings calculated for ${stocks.length} stocks`);
  return stocks;
}

/**
 * Save current rankings as today's snapshot
 *
 * @param {Array} symbols - Stock symbols
 * @param {string} stockListName - Stock list name
 * @returns {Object} - Generated snapshot
 */
async function saveTodaySnapshot(symbols, stockListName = 'Real Data') {
  console.log("\n💾 Saving today's snapshot...");

  const stocks = await getCurrentRankings(symbols);
  const snapshot = await snapshotManager.generateDailySnapshot(
    stocks,
    stockListName
  );

  console.log(`✅ Today's snapshot saved: ${snapshot.date}`);
  return snapshot;
}

/**
 * Check if we have recent enough data for backtesting
 *
 * @param {number} requiredDays - Minimum days of history needed
 * @returns {Object} - Status and available dates
 */
async function checkHistoricalDataAvailability(requiredDays = 90) {
  const dates = await snapshotManager.getAvailableSnapshots();

  const hasEnoughData = dates.length >= requiredDays;
  const oldestDate = dates.length > 0 ? dates[0] : null;
  const newestDate = dates.length > 0 ? dates[dates.length - 1] : null;

  return {
    available: hasEnoughData,
    count: dates.length,
    required: requiredDays,
    oldestDate,
    newestDate,
    needsBackfill: !hasEnoughData,
  };
}

module.exports = {
  backfillRealHistory,
  getCurrentRankings,
  saveTodaySnapshot,
  checkHistoricalDataAvailability,
  calculateHistoricalScore,
};
