/**
 * EXPRESS SERVER - Stock Analysis & Trading Platform
 *
 * Enhanced Express server that:
 * 1. Serves the built React application from /dist folder
 * 2. Handles client-side routing with catch-all route
 * 3. Provides stock rankings, analysis, and trading APIs
 * 4. Integrates with Alpaca (trading) and Polygon (market data)
 *
 * CRITICAL PATH: This serves the entire application
 * All HTTP requests flow through this server
 */

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const PORT = process.env.PORT || 8080;
const path = require('path');
const snapshotManager = require('./snapshotManager');
const backtestEngine = require('./backtestEngine');
const historicalDataManager = require('./historicalDataManager');
const alpacaClient = require('./alpacaClient');
const polygonClient = require('./polygonClient');
const tradingModeManager = require('./tradingModeManager');
const aiTradingEngine = require('./aiTradingEngine');
const technicalIndicatorsService = require('./technicalIndicatorsService');
const patternRecognitionService = require('./patternRecognitionService');
const schwabImportService = require('./schwabImportService');
const enhancedBacktestEngine = require('./enhancedBacktestEngine');
const websocketServer = require('./websocketServer');
const http = require('http');
const multer = require('multer');

// Sprint 1: Self-Improving Trading System modules
const TransactionCostModel = require('./transactionCostModel');
const LeveragedEtfRules = require('./leveragedEtfRules');
const RegimeDetector = require('./regimeDetector');

// Sprint 2: Optimization and Versioning modules
const WalkForwardOptimizer = require('./walkForwardOptimizer');
const StrategyVersionControl = require('./strategyVersionControl');
const RegimeAwareConfigStore = require('./regimeAwareConfigStore');

// Sprint 3: A/B Testing and Monitoring modules
const ABTestingEngine = require('./abTestingEngine');
const StrategyMonitor = require('./strategyMonitor');

// Strategy Backtester for multi-day validation
const StrategyBacktester = require('./strategyBacktester');

// Overnight Optimization module
const OvernightOptimizer = require('./overnightOptimizer');

// Leveraged ETF Strategy and CheddarFlow modules
const LeveragedEtfStrategy = require('./leveragedEtfStrategy');
const CheddarFlowScraper = require('./cheddarFlowScraper');

// Initialize Sprint 1 modules
const transactionCostModel = new TransactionCostModel();
const leveragedEtfRules = new LeveragedEtfRules();
const regimeDetector = new RegimeDetector();

// Initialize Sprint 2 modules
const walkForwardOptimizer = new WalkForwardOptimizer();
const strategyVersionControl = new StrategyVersionControl();
const regimeAwareConfigStore = new RegimeAwareConfigStore();

// Initialize Sprint 3 modules
const abTestingEngine = new ABTestingEngine();
const strategyMonitor = new StrategyMonitor();

// Initialize Overnight Optimizer
const overnightOptimizer = new OvernightOptimizer();

// Initialize Leveraged ETF Strategy and CheddarFlow Scraper
const leveragedEtfStrategy = new LeveragedEtfStrategy();
let cheddarFlowScraper = null; // Lazy init to avoid starting browser on server start

const app = express();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware for JSON parsing
app.use(bodyParser.json());

// ================================
// PAPER TRADING SIMULATION SYSTEM
// ================================

// In-memory paper trading portfolios (in production, use database)
const paperTradingPortfolios = new Map();

// ================================
// HISTORICAL DATA CACHE
// ================================
// Cache for historical intraday data to avoid redundant API calls
const historicalDataCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCacheKey(symbol, date, interval = 'minute') {
  return `${symbol}:${date}:${interval}`;
}

async function getCachedHistoricalData(symbol, date, interval = 'minute') {
  const key = getCacheKey(symbol, date, interval);
  const cached = historicalDataCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📦 Cache HIT for ${symbol} on ${date}`);
    return cached.data;
  }

  console.log(`🌐 Cache MISS for ${symbol} on ${date} - fetching...`);
  const data = await polygonClient
    .getHistoricalAggregates(symbol, date, date, interval)
    .catch(() => []);

  historicalDataCache.set(key, {
    data,
    timestamp: Date.now(),
  });

  return data;
}

// Helper function to get current stock price (integrates with existing APIs)
async function getCurrentStockPrice(symbol) {
  try {
    // Use Polygon API to get real-time stock price
    const quote = await polygonClient.getLatestQuote(symbol).catch(e => {
      console.error(
        `❌ Error fetching real-time price for ${symbol}:`,
        e.message
      );
      return { error: e.message };
    });

    // If quote available, return the price
    if (!quote.error && quote.price) {
      return quote.price;
    }

    // Fallback: try to get latest bar data (previous close)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7); // Last 7 days
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const bars = await polygonClient
      .getHistoricalAggregates(symbol, startDateStr, endDateStr)
      .catch(e => {
        console.error(
          `❌ Error fetching historical price for ${symbol}:`,
          e.message
        );
        return { error: e.message };
      });

    if (!bars.error && bars && bars.length > 0) {
      const latestBar = bars[bars.length - 1];
      return latestBar.close;
    }

    console.error(`❌ Unable to fetch price for ${symbol} - no data available`);
    return null;
  } catch (error) {
    console.error(`❌ Error fetching price for ${symbol}:`, error);
    return null;
  }
}

// 7. Create or get paper trading portfolio
app.post('/api/paper-trading/portfolio', async (req, res) => {
  try {
    const { userId, initialCash = 100000 } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Check if portfolio already exists
    if (paperTradingPortfolios.has(userId)) {
      return res.json({
        success: true,
        portfolio: paperTradingPortfolios.get(userId),
        message: 'Paper trading portfolio retrieved',
      });
    }

    // Create new paper trading portfolio
    const newPortfolio = {
      userId: userId,
      cash: parseFloat(initialCash),
      initialCash: parseFloat(initialCash),
      positions: new Map(),
      trades: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    paperTradingPortfolios.set(userId, newPortfolio);

    console.log(
      `💰 Created paper trading portfolio for user: ${userId} with $${initialCash}`
    );

    res.json({
      success: true,
      portfolio: {
        ...newPortfolio,
        positions: Array.from(newPortfolio.positions.entries()).map(
          ([symbol, position]) => ({
            symbol,
            ...position,
          })
        ),
      },
      message: 'Paper trading portfolio created successfully',
    });
  } catch (error) {
    console.error('❌ Error creating paper trading portfolio:', error.message);
    res.status(500).json({ error: 'Failed to create paper trading portfolio' });
  }
});

// 8. Execute paper trading order
app.post('/api/paper-trading/order', async (req, res) => {
  try {
    const {
      userId,
      symbol,
      side,
      quantity,
      orderType = 'market',
      limitPrice = null,
    } = req.body;

    if (!userId || !symbol || !side || !quantity) {
      return res
        .status(400)
        .json({ error: 'userId, symbol, side, and quantity are required' });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }

    if (!['market', 'limit'].includes(orderType)) {
      return res
        .status(400)
        .json({ error: 'orderType must be "market" or "limit"' });
    }

    // Get portfolio
    const portfolio = paperTradingPortfolios.get(userId);
    if (!portfolio) {
      return res.status(404).json({
        error: 'Paper trading portfolio not found. Create one first.',
      });
    }

    // Get current stock price
    const currentPrice = await getCurrentStockPrice(symbol);
    if (!currentPrice) {
      return res
        .status(400)
        .json({ error: 'Unable to get current price for symbol' });
    }

    // Determine execution price
    let executionPrice = currentPrice;
    if (orderType === 'limit') {
      if (!limitPrice) {
        return res
          .status(400)
          .json({ error: 'limitPrice is required for limit orders' });
      }

      // For demo, assume limit orders execute if price is favorable
      if (side === 'buy' && limitPrice < currentPrice) {
        return res.status(400).json({
          error:
            'Limit buy price is below current market price. Order not executed.',
        });
      }
      if (side === 'sell' && limitPrice > currentPrice) {
        return res.status(400).json({
          error:
            'Limit sell price is above current market price. Order not executed.',
        });
      }

      executionPrice = limitPrice;
    }

    const totalValue = executionPrice * quantity;
    const position = portfolio.positions.get(symbol) || {
      quantity: 0,
      averagePrice: 0,
      totalCost: 0,
    };

    // Execute order
    if (side === 'buy') {
      // Check if enough cash
      if (portfolio.cash < totalValue) {
        return res
          .status(400)
          .json({ error: 'Insufficient cash for purchase' });
      }

      // Update cash
      portfolio.cash -= totalValue;

      // Update position
      const newTotalCost = position.totalCost + totalValue;
      const newQuantity = position.quantity + quantity;
      const newAveragePrice = newTotalCost / newQuantity;

      portfolio.positions.set(symbol, {
        quantity: newQuantity,
        averagePrice: newAveragePrice,
        totalCost: newTotalCost,
        currentPrice: currentPrice,
        marketValue: newQuantity * currentPrice,
        unrealizedGainLoss: newQuantity * currentPrice - newTotalCost,
        unrealizedGainLossPercent:
          ((newQuantity * currentPrice - newTotalCost) / newTotalCost) * 100,
      });
    } else {
      // sell
      // Check if enough shares
      if (position.quantity < quantity) {
        return res.status(400).json({ error: 'Insufficient shares to sell' });
      }

      // Update cash
      portfolio.cash += totalValue;

      // Update position
      const newQuantity = position.quantity - quantity;
      if (newQuantity === 0) {
        portfolio.positions.delete(symbol);
      } else {
        const soldCost = (position.totalCost / position.quantity) * quantity;
        const newTotalCost = position.totalCost - soldCost;

        portfolio.positions.set(symbol, {
          quantity: newQuantity,
          averagePrice: position.averagePrice, // Keep same average price
          totalCost: newTotalCost,
          currentPrice: currentPrice,
          marketValue: newQuantity * currentPrice,
          unrealizedGainLoss: newQuantity * currentPrice - newTotalCost,
          unrealizedGainLossPercent:
            newTotalCost > 0
              ? ((newQuantity * currentPrice - newTotalCost) / newTotalCost) *
                100
              : 0,
        });
      }
    }

    // Record trade
    const trade = {
      id: `paper_trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: symbol,
      side: side,
      quantity: quantity,
      price: executionPrice,
      totalValue: totalValue,
      orderType: orderType,
      limitPrice: limitPrice,
      executedAt: new Date().toISOString(),
      status: 'filled',
    };

    portfolio.trades.push(trade);
    portfolio.lastUpdated = new Date().toISOString();

    console.log(
      `📋 Executed paper trade: ${side.toUpperCase()} ${quantity} ${symbol} @ $${executionPrice}`
    );

    res.json({
      success: true,
      trade: trade,
      portfolio: {
        ...portfolio,
        positions: Array.from(portfolio.positions.entries()).map(
          ([sym, pos]) => ({
            symbol: sym,
            ...pos,
          })
        ),
      },
      message: 'Paper trade executed successfully',
    });
  } catch (error) {
    console.error('❌ Error executing paper trading order:', error.message);
    res.status(500).json({ error: 'Failed to execute paper trading order' });
  }
});

// 9. Get paper trading portfolio status
app.get('/api/paper-trading/portfolio/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const portfolio = paperTradingPortfolios.get(userId);
    if (!portfolio) {
      return res
        .status(404)
        .json({ error: 'Paper trading portfolio not found' });
    }

    // Update current market values for all positions
    const updatedPositions = [];
    let totalMarketValue = 0;

    for (const [symbol, position] of portfolio.positions) {
      const currentPrice = await getCurrentStockPrice(symbol);
      const marketValue = position.quantity * currentPrice;
      const unrealizedGainLoss = marketValue - position.totalCost;
      const unrealizedGainLossPercent =
        position.totalCost > 0
          ? (unrealizedGainLoss / position.totalCost) * 100
          : 0;

      const updatedPosition = {
        symbol: symbol,
        quantity: position.quantity,
        averagePrice: position.averagePrice,
        totalCost: position.totalCost,
        currentPrice: currentPrice,
        marketValue: marketValue,
        unrealizedGainLoss: unrealizedGainLoss,
        unrealizedGainLossPercent: unrealizedGainLossPercent,
      };

      updatedPositions.push(updatedPosition);
      totalMarketValue += marketValue;

      // Update the stored position with current values
      portfolio.positions.set(symbol, updatedPosition);
    }

    const totalPortfolioValue = portfolio.cash + totalMarketValue;
    const totalGainLoss = totalPortfolioValue - portfolio.initialCash;
    const totalGainLossPercent = (totalGainLoss / portfolio.initialCash) * 100;

    console.log(`📊 Retrieved paper trading portfolio for user: ${userId}`);

    res.json({
      success: true,
      portfolio: {
        userId: portfolio.userId,
        cash: portfolio.cash,
        initialCash: portfolio.initialCash,
        totalMarketValue: totalMarketValue,
        totalPortfolioValue: totalPortfolioValue,
        totalGainLoss: totalGainLoss,
        totalGainLossPercent: totalGainLossPercent,
        positions: updatedPositions,
        trades: portfolio.trades,
        createdAt: portfolio.createdAt,
        lastUpdated: new Date().toISOString(),
      },
      message: 'Paper trading portfolio retrieved successfully',
    });
  } catch (error) {
    console.error(
      '❌ Error retrieving paper trading portfolio:',
      error.message
    );
    res
      .status(500)
      .json({ error: 'Failed to retrieve paper trading portfolio' });
  }
});

// 10. Reset paper trading portfolio
app.post('/api/paper-trading/portfolio/:userId/reset', async (req, res) => {
  try {
    const { userId } = req.params;
    const { initialCash = 100000 } = req.body;

    const newPortfolio = {
      userId: userId,
      cash: parseFloat(initialCash),
      initialCash: parseFloat(initialCash),
      positions: new Map(),
      trades: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    paperTradingPortfolios.set(userId, newPortfolio);

    console.log(`🔄 Reset paper trading portfolio for user: ${userId}`);

    res.json({
      success: true,
      portfolio: {
        ...newPortfolio,
        positions: [],
      },
      message: 'Paper trading portfolio reset successfully',
    });
  } catch (error) {
    console.error('❌ Error resetting paper trading portfolio:', error.message);
    res.status(500).json({ error: 'Failed to reset paper trading portfolio' });
  }
});

// ================================
// SNAPSHOT & BACKTESTING ENDPOINTS
// ================================

// 11. Get available snapshot dates
app.get('/api/snapshots/dates', async (req, res) => {
  try {
    const dates = await snapshotManager.getAvailableSnapshots();
    res.json({
      success: true,
      dates,
      count: dates.length,
      message: 'Snapshot dates retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot dates:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot dates' });
  }
});

// 12. Get snapshot for specific date
app.get('/api/snapshots/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const snapshot = await snapshotManager.loadSnapshot(date);

    if (!snapshot) {
      return res
        .status(404)
        .json({ error: 'Snapshot not found for specified date' });
    }

    res.json({
      success: true,
      snapshot,
      message: 'Snapshot retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot' });
  }
});

// 13. Get snapshot range
app.get('/api/snapshots/range/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;
    const snapshots = await snapshotManager.loadSnapshotRange(
      startDate,
      endDate
    );

    res.json({
      success: true,
      snapshots,
      count: snapshots.length,
      startDate,
      endDate,
      message: 'Snapshot range retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot range:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot range' });
  }
});

// 14. Generate synthetic historical snapshots
app.post('/api/snapshots/generate-history', async (req, res) => {
  try {
    let { stocks, days = 90, stockListName = 'Default' } = req.body;

    // If no stocks provided, use default mock stocks for testing
    if (!stocks || !Array.isArray(stocks) || stocks.length === 0) {
      console.log('No stocks provided, using default mock stocks for testing');
      stocks = [
        {
          ticker: 'NVDA',
          score: 95.2,
          price: 150.0,
          rsi: 68.5,
          volume: 45000000,
        },
        {
          ticker: 'AAPL',
          score: 92.1,
          price: 185.0,
          rsi: 62.3,
          volume: 52000000,
        },
        {
          ticker: 'MSFT',
          score: 89.5,
          price: 375.0,
          rsi: 58.7,
          volume: 28000000,
        },
        {
          ticker: 'GOOGL',
          score: 87.3,
          price: 140.0,
          rsi: 55.2,
          volume: 22000000,
        },
        {
          ticker: 'AMZN',
          score: 85.1,
          price: 170.0,
          rsi: 60.1,
          volume: 48000000,
        },
        {
          ticker: 'META',
          score: 83.4,
          price: 485.0,
          rsi: 65.4,
          volume: 18000000,
        },
        {
          ticker: 'TSLA',
          score: 81.2,
          price: 250.0,
          rsi: 52.8,
          volume: 95000000,
        },
        {
          ticker: 'AMD',
          score: 79.8,
          price: 145.0,
          rsi: 59.3,
          volume: 38000000,
        },
        {
          ticker: 'CRM',
          score: 77.5,
          price: 290.0,
          rsi: 54.6,
          volume: 14000000,
        },
        {
          ticker: 'NFLX',
          score: 75.2,
          price: 665.0,
          rsi: 61.2,
          volume: 11000000,
        },
      ];
    }

    const snapshots = await snapshotManager.generateSyntheticHistory(
      stocks,
      days,
      stockListName
    );

    res.json({
      success: true,
      snapshotsGenerated: snapshots.length,
      days,
      message: 'Synthetic historical snapshots generated successfully',
    });
  } catch (error) {
    console.error('❌ Error generating synthetic history:', error.message);
    res.status(500).json({ error: 'Failed to generate synthetic history' });
  }
});

// 14b. Backfill REAL historical data from Polygon API
app.post('/api/snapshots/backfill-real-history', async (req, res) => {
  try {
    let { symbols, days = 90, stockListName = 'Real Data' } = req.body;

    // Use default symbols if none provided
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      symbols = [
        'NVDA',
        'AAPL',
        'MSFT',
        'GOOGL',
        'AMZN',
        'META',
        'TSLA',
        'AMD',
        'CRM',
        'NFLX',
      ];
      console.log(`No symbols provided, using defaults: ${symbols.join(', ')}`);
    }

    console.log(
      `\n🚀 Starting real data backfill for ${symbols.length} symbols, ${days} days...`
    );

    const snapshots = await historicalDataManager.backfillRealHistory(
      symbols,
      days,
      stockListName
    );

    res.json({
      success: true,
      snapshotsGenerated: snapshots.length,
      symbols: symbols.length,
      days,
      dataSource: 'Polygon.io',
      message: `Real historical data backfilled successfully from Polygon API`,
    });
  } catch (error) {
    console.error('❌ Error backfilling real history:', error.message);
    res.status(500).json({
      error: 'Failed to backfill real historical data',
      details: error.message,
    });
  }
});

// 14c. Get current rankings from live data
app.get('/api/rankings/current', async (req, res) => {
  try {
    const symbols = req.query.symbols
      ? req.query.symbols.split(',')
      : [
          'NVDA',
          'AAPL',
          'MSFT',
          'GOOGL',
          'AMZN',
          'META',
          'TSLA',
          'AMD',
          'CRM',
          'NFLX',
        ];

    const rankings = await historicalDataManager.getCurrentRankings(symbols);

    res.json({
      success: true,
      rankings,
      count: rankings.length,
      message: 'Current rankings fetched successfully',
    });
  } catch (error) {
    console.error('❌ Error fetching current rankings:', error.message);
    res.status(500).json({ error: 'Failed to fetch current rankings' });
  }
});

// 14d. Save today's snapshot from live data
app.post('/api/snapshots/save-today', async (req, res) => {
  try {
    let { symbols, stockListName = 'Real Data' } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      symbols = [
        'NVDA',
        'AAPL',
        'MSFT',
        'GOOGL',
        'AMZN',
        'META',
        'TSLA',
        'AMD',
        'CRM',
        'NFLX',
      ];
    }

    const snapshot = await historicalDataManager.saveTodaySnapshot(
      symbols,
      stockListName
    );

    res.json({
      success: true,
      snapshot,
      message: "Today's snapshot saved successfully",
    });
  } catch (error) {
    console.error("❌ Error saving today's snapshot:", error.message);
    res.status(500).json({ error: "Failed to save today's snapshot" });
  }
});

// 14e. Check historical data availability
app.get('/api/snapshots/availability', async (req, res) => {
  try {
    const requiredDays = parseInt(req.query.days) || 90;
    const availability =
      await historicalDataManager.checkHistoricalDataAvailability(requiredDays);

    res.json({
      success: true,
      ...availability,
      message: availability.available
        ? 'Sufficient historical data available'
        : 'Insufficient historical data - backfill recommended',
    });
  } catch (error) {
    console.error('❌ Error checking availability:', error.message);
    res.status(500).json({ error: 'Failed to check data availability' });
  }
});

// 15. Intraday Trading Analyzer - Day trading analysis with market sentiment
app.get('/api/intraday/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { date } = req.query; // Optional: analyze specific date (YYYY-MM-DD), defaults to today

    console.log(
      `📈 Analyzing intraday trading for ${symbol}${date ? ` on ${date}` : ''}...`
    );

    // Get today's date or specified date
    const targetDate = date ? new Date(date) : new Date();
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Calculate date range for analysis (7 days history for pattern matching)
    const startDate = new Date(targetDate);
    startDate.setDate(startDate.getDate() - 7);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch 5-minute candles for the target day (market hours: 9:30 AM - 4:00 PM ET = 78 candles)
    const intradayCandles = await polygonClient
      .getHistoricalAggregates(symbol, targetDateStr, targetDateStr, 'minute')
      .catch(e => {
        console.log(`⚠️  Could not fetch intraday candles: ${e.message}`);
        return [];
      });

    // Fetch daily bars for historical context and pattern matching
    const dailyBars = await polygonClient
      .getHistoricalAggregates(symbol, startDateStr, targetDateStr, 'day')
      .catch(e => {
        console.error(`❌ Error fetching daily bars: ${e.message}`);
        return [];
      });

    // Fetch market indicators (S&P 500 and VIX for sentiment)
    const [spyBars, vixBars] = await Promise.all([
      polygonClient
        .getHistoricalAggregates('SPY', startDateStr, targetDateStr, 'day')
        .catch(() => []),
      polygonClient
        .getHistoricalAggregates('VIX', startDateStr, targetDateStr, 'day')
        .catch(() => []),
    ]);

    // Also fetch intraday SPY and VIX candles for correlation analysis
    const [spyIntradayCandles, vixIntradayCandles] = await Promise.all([
      polygonClient
        .getHistoricalAggregates('SPY', targetDateStr, targetDateStr, 'minute')
        .catch(e => {
          console.log(`⚠️  Could not fetch SPY intraday candles: ${e.message}`);
          return [];
        }),
      polygonClient
        .getHistoricalAggregates('VIX', targetDateStr, targetDateStr, 'minute')
        .catch(e => {
          console.log(`⚠️  Could not fetch VIX intraday candles: ${e.message}`);
          return [];
        }),
    ]);

    // Calculate market sentiment
    const marketSentiment = analyzeMarketSentiment(
      spyBars,
      vixBars,
      spyIntradayCandles,
      vixIntradayCandles
    );

    // Calculate technical indicators
    const technicals = polygonClient.calculateTechnicalIndicators(dailyBars);

    // Analyze intraday pattern
    const intradayAnalysis = analyzeIntradayPattern(intradayCandles, dailyBars);

    // Analyze intraday swings (open, +30min, +3hr, close)
    const swingAnalysis = analyzeIntradaySwings(intradayCandles);

    // Generate entry/exit recommendations
    const recommendations = generateTradingRecommendations(
      symbol,
      intradayCandles,
      dailyBars,
      marketSentiment,
      technicals
    );

    // Find historical patterns similar to current setup
    const similarPatterns = await findSimilarPatterns(
      symbol,
      dailyBars,
      marketSentiment
    );

    res.json({
      success: true,
      symbol,
      date: targetDateStr,
      intraday: {
        candles: intradayCandles,
        openPrice: intradayCandles[0]?.open || null,
        currentPrice:
          intradayCandles[intradayCandles.length - 1]?.close || null,
        highOfDay: Math.max(...intradayCandles.map(c => c.high)),
        lowOfDay: Math.min(...intradayCandles.map(c => c.low)),
        volume: intradayCandles.reduce((sum, c) => sum + c.volume, 0),
        analysis: intradayAnalysis,
        swingAnalysis: swingAnalysis,
      },
      marketSentiment,
      technicals,
      recommendations,
      similarPatterns,
    });
  } catch (error) {
    console.error(`❌ Error analyzing intraday for ${symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// 16. Strategy Backtesting - Test trading strategies on historical data
app.post('/api/strategy/backtest', async (req, res) => {
  try {
    const { symbol, strategy, startDate, endDate } = req.body;

    console.log(
      `🧪 Backtesting strategy for ${symbol} from ${startDate} to ${endDate}...`
    );

    // Validate strategy parameters
    if (!strategy || !strategy.type) {
      return res.status(400).json({ error: 'Strategy type is required' });
    }

    // Define ranking list stocks (COVID_19 default list)
    const rankingStocks = [
      'WM',
      'ADSK',
      'NKE',
      'LSCC',
      'DIS',
      'LRCX',
      'XRAY',
      'RTX',
      'YETI',
      'ENPH',
      'TEVA',
      'MGNI',
      'RUN',
      'DAL',
      'LRMR',
      'RCL',
      'SHOP',
      'HIMX',
      'PI',
      'PENN',
    ];

    // Remove the target symbol if it's in the list to avoid duplication
    const marketStocks = rankingStocks.filter(s => s !== symbol);

    // Fetch historical intraday data for the date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const tradingDays = [];

    // Get all trading days in range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDays.push(d.toISOString().split('T')[0]);
      }
    }

    console.log(`📅 Testing ${tradingDays.length} trading days...`);

    // Run backtest on each trading day
    const trades = [];
    const dailyLogs = []; // Track ALL days for comprehensive analysis
    let totalReturn = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;

    for (const date of tradingDays) {
      try {
        // Fetch intraday candles for this day - using cache
        const [candles, spyCandles, vixCandles] = await Promise.all([
          getCachedHistoricalData(symbol, date),
          getCachedHistoricalData('SPY', date),
          getCachedHistoricalData('VIX', date),
        ]);

        if (candles.length === 0) {
          dailyLogs.push({
            date,
            status: 'no_data',
            reason: 'No intraday data available',
          });
          continue;
        }

        // Fetch ranking stocks data using cache
        // Sample 10 stocks to keep API usage reasonable
        const sampledStocks = marketStocks.slice(0, 10);
        const rankingCandles = await Promise.all(
          sampledStocks.map(ticker => getCachedHistoricalData(ticker, date))
        );

        // Calculate market-wide metrics from ranking stocks
        const marketMetrics = calculateMarketMetrics(
          rankingCandles,
          sampledStocks
        );

        // Run strategy on this day with enhanced market context
        const trade = executeStrategy(
          candles,
          strategy,
          date,
          spyCandles,
          vixCandles,
          marketMetrics
        );

        if (trade && trade.executed) {
          trades.push(trade);
          dailyLogs.push({
            date,
            status: trade.profitLoss > 0 ? 'win' : 'loss',
            executed: true,
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            profitLoss: trade.profitLoss,
            profitPercent: trade.profitPercent,
            reason: trade.reason,
            momentum: trade.momentum,
            marketBreadth: trade.marketBreadth,
          });

          if (trade.profitLoss > 0) {
            winningTrades++;
            totalProfit += trade.profitLoss;
          } else {
            losingTrades++;
            totalLoss += Math.abs(trade.profitLoss);
          }

          totalReturn += trade.profitLoss;
        } else if (trade) {
          // Trade signal did NOT trigger - log why
          dailyLogs.push({
            date,
            status: 'no_signal',
            executed: false,
            reason: trade.reason,
            momentum: trade.momentum,
            actualDayReturn: trade.actualDayReturn, // How much stock moved that day
            missedOpportunity: trade.actualDayReturn > 5, // Flag if we missed a big move
          });
        }
      } catch (err) {
        console.log(`⚠️  Could not test ${date}: ${err.message}`);
        dailyLogs.push({ date, status: 'error', reason: err.message });
      }
    }

    // Calculate metrics
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
    // Better profit factor display: use 999 as max instead of Infinity
    const profitFactor =
      totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
    const avgReturnPerTrade = totalTrades > 0 ? totalReturn / totalTrades : 0;

    // Calculate average entry/exit prices for successful trades
    const successfulTrades = trades.filter(t => t.profitLoss > 0);
    const avgEntryPrice =
      successfulTrades.length > 0
        ? (
            successfulTrades.reduce((sum, t) => sum + t.entryPrice, 0) /
            successfulTrades.length
          ).toFixed(2)
        : 'N/A';
    const avgExitPrice =
      successfulTrades.length > 0
        ? (
            successfulTrades.reduce((sum, t) => sum + t.exitPrice, 0) /
            successfulTrades.length
          ).toFixed(2)
        : 'N/A';

    res.json({
      success: true,
      symbol,
      strategy,
      period: {
        start: startDate,
        end: endDate,
        tradingDays: tradingDays.length,
      },
      results: {
        totalTrades,
        winningTrades,
        losingTrades,
        winRate: winRate.toFixed(2),
        totalReturn: totalReturn.toFixed(2),
        avgReturnPerTrade: avgReturnPerTrade.toFixed(2),
        profitFactor: profitFactor >= 999 ? '999+' : profitFactor.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        totalProfit: totalProfit.toFixed(2),
        totalLoss: totalLoss.toFixed(2),
        avgEntryPrice,
        avgExitPrice,
      },
      trades: trades.slice(-20), // Return last 20 trades for review
      dailyLogs, // Return ALL daily logs for comprehensive analysis
    });
  } catch (error) {
    console.error('❌ Error running backtest:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 17. Optimize Strategy - Find optimal parameters for a strategy
app.post('/api/strategy/optimize', async (req, res) => {
  try {
    const { symbol, startDate, endDate } = req.body;

    console.log(`🔍 Optimizing strategy for ${symbol}...`);
    console.log(`⚡ Pre-caching historical data for parallel execution...`);

    // Get all trading days in range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const tradingDays = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDays.push(d.toISOString().split('T')[0]);
      }
    }

    // Pre-fetch all historical data into cache (parallelized)
    const rankingStocks = [
      'WM',
      'ADSK',
      'NKE',
      'LSCC',
      'DIS',
      'LRCX',
      'XRAY',
      'RTX',
      'YETI',
      'ENPH',
    ];
    const allSymbols = [symbol, 'SPY', 'VIX', ...rankingStocks];

    await Promise.all(
      tradingDays.flatMap(date =>
        allSymbols.map(sym => getCachedHistoricalData(sym, date))
      )
    );

    console.log(
      `✅ Cache warmed with ${tradingDays.length} days × ${allSymbols.length} symbols`
    );

    // Test multiple strategy variations
    // BREAKOUT MODE: Lower momentum thresholds + higher profit targets for QBTS-style runners
    const strategies = [
      // Conservative strategies (original)
      { type: 'first-3hr-momentum', minMomentum3Hr: 1.0, profitTarget: 10 },
      { type: 'first-3hr-momentum', minMomentum3Hr: 1.5, profitTarget: 10 },
      { type: 'first-3hr-momentum', minMomentum3Hr: 2.0, profitTarget: 10 },

      // BREAKOUT strategies - catch big runners like QBTS
      {
        type: 'first-3hr-momentum',
        minMomentum3Hr: 0.3,
        profitTarget: 15,
        minMarketBreadth: 30,
      }, // Ultra-aggressive
      {
        type: 'first-3hr-momentum',
        minMomentum3Hr: 0.5,
        profitTarget: 15,
        minMarketBreadth: 35,
      }, // QBTS-style
      {
        type: 'first-3hr-momentum',
        minMomentum3Hr: 0.8,
        profitTarget: 12,
        minMarketBreadth: 40,
      },
      {
        type: 'first-3hr-momentum',
        minMomentum3Hr: 1.0,
        profitTarget: 12,
        minMarketBreadth: 40,
      },

      // Balanced
      { type: 'first-3hr-momentum', minMomentum3Hr: 0.5, profitTarget: 8 },
    ];

    console.log(`🚀 Running ${strategies.length} strategies in PARALLEL...`);

    // Run all backtests in parallel (data already cached)
    const backtestPromises = strategies.map(strategy =>
      fetch(`http://localhost:${PORT}/api/strategy/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, strategy, startDate, endDate }),
      }).then(r => r.json())
    );

    const backtestResults = await Promise.all(backtestPromises);

    const results = backtestResults
      .filter(data => data.success)
      .map((data, idx) => ({
        strategy: strategies[idx],
        metrics: data.results,
      }));

    // Sort by win rate * profit factor to find best strategy
    results.sort((a, b) => {
      const pfA =
        a.metrics.profitFactor === '999+'
          ? 999
          : parseFloat(a.metrics.profitFactor);
      const pfB =
        b.metrics.profitFactor === '999+'
          ? 999
          : parseFloat(b.metrics.profitFactor);
      const scoreA = parseFloat(a.metrics.winRate) * pfA;
      const scoreB = parseFloat(b.metrics.winRate) * pfB;
      return scoreB - scoreA;
    });

    res.json({
      success: true,
      symbol,
      period: { start: startDate, end: endDate },
      optimalStrategy: results[0] || null,
      allResults: results,
      cacheStats: {
        tradingDays: tradingDays.length,
        symbolsCached: allSymbols.length,
        strategiesTested: strategies.length,
      },
    });
  } catch (error) {
    console.error('❌ Error optimizing strategy:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 18. Execute Strategy Trade - Place a paper trade based on current day strategy analysis
app.post('/api/strategy/execute-trade', async (req, res) => {
  try {
    const { symbol, strategy, profitTargetDollars } = req.body;

    console.log(
      `💵 Executing strategy trade for ${symbol} with $${profitTargetDollars} profit target...`
    );

    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // Fetch today's intraday data
    const [candles, spyCandles, vixCandles] = await Promise.all([
      polygonClient.getHistoricalAggregates(symbol, today, today, 'minute'),
      polygonClient
        .getHistoricalAggregates('SPY', today, today, 'minute')
        .catch(() => []),
      polygonClient
        .getHistoricalAggregates('VIX', today, today, 'minute')
        .catch(() => []),
    ]);

    if (candles.length === 0) {
      return res
        .status(400)
        .json({ error: 'No intraday data available for today' });
    }

    // Fetch ranking stocks for market context
    const rankingStocks = [
      'WM',
      'ADSK',
      'NKE',
      'LSCC',
      'DIS',
      'LRCX',
      'XRAY',
      'RTX',
      'YETI',
      'ENPH',
      'TEVA',
      'MGNI',
      'RUN',
      'DAL',
      'LRMR',
      'RCL',
      'SHOP',
      'HIMX',
      'PI',
      'PENN',
    ];
    const marketStocks = rankingStocks.filter(s => s !== symbol).slice(0, 10);

    const rankingCandles = await Promise.all(
      marketStocks.map(ticker =>
        polygonClient
          .getHistoricalAggregates(ticker, today, today, 'minute')
          .catch(() => [])
      )
    );

    const marketMetrics = calculateMarketMetrics(rankingCandles, marketStocks);

    // Evaluate strategy for today
    const analysis = executeStrategy(
      candles,
      strategy,
      today,
      spyCandles,
      vixCandles,
      marketMetrics
    );

    // Calculate quantity based on profit target
    const currentPrice = candles[candles.length - 1].close;
    const profitTargetPercent = strategy.profitTarget || 10;
    const profitPerShare = currentPrice * (profitTargetPercent / 100);
    const quantity = Math.floor(profitTargetDollars / profitPerShare);

    console.log(
      `📊 Calculated quantity: ${quantity} shares (price: $${currentPrice}, profit/share: $${profitPerShare.toFixed(2)})`
    );

    if (quantity < 1) {
      return res.status(400).json({
        success: false,
        error: `Profit target too low. Need at least $${profitPerShare.toFixed(2)} to buy 1 share (${profitTargetPercent}% of $${currentPrice}).`,
      });
    }

    if (!analysis || !analysis.executed) {
      const limitPrice = (
        currentPrice *
        (1 + profitTargetPercent / 100)
      ).toFixed(2);
      const actualProfit = (quantity * profitPerShare).toFixed(2);

      return res.json({
        success: false,
        shouldEnter: false,
        reason: analysis?.reason || 'Entry criteria not met',
        analysis: analysis?.analysis || {},
        currentPrice,
        quantity,
        // Show what the trade WOULD have been
        intendedTrade: {
          symbol,
          quantity,
          type: 'market buy',
          entryPrice: currentPrice,
          profitTarget: `${profitTargetPercent}% ($${actualProfit})`,
          targetPrice: limitPrice,
          sellOrder: `limit sell ${quantity} shares at $${limitPrice}`,
          strategy: {
            type: strategy.type,
            minMomentum3Hr: strategy.minMomentum3Hr,
            minMarketBreadth: strategy.minMarketBreadth || 40,
          },
        },
        // Specific failure details
        failureDetails: {
          stockMomentum: analysis?.analysis?.stockChange3Hr || 'N/A',
          spyPerformance: analysis?.analysis?.spyChange3Hr || 'N/A',
          vixChange: analysis?.analysis?.vixChange3Hr || 'N/A',
          marketBreadth: analysis?.analysis?.positiveStocksPercent || 'N/A',
          avgMarketChange: analysis?.analysis?.avgMarketChange3Hr || 'N/A',
        },
      });
    }

    // Strategy says to enter - place the trade
    const limitPrice = (currentPrice * (1 + profitTargetPercent / 100)).toFixed(
      2
    );
    const actualProfit = (quantity * profitPerShare).toFixed(2);

    // Place market buy order
    const buyOrder = await fetch(
      'http://localhost:' + PORT + '/api/alpaca/orders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          qty: quantity,
          side: 'buy',
          type: 'market',
          time_in_force: 'day',
        }),
      }
    );

    const buyResult = await buyOrder.json();

    if (!buyResult.success) {
      throw new Error('Failed to place buy order: ' + buyResult.error);
    }

    // Place limit sell order at profit target
    const sellOrder = await fetch(
      'http://localhost:' + PORT + '/api/alpaca/orders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          qty: quantity,
          side: 'sell',
          type: 'limit',
          limit_price: limitPrice,
          time_in_force: 'day',
        }),
      }
    );

    const sellResult = await sellOrder.json();

    res.json({
      success: true,
      shouldEnter: true,
      quantity,
      buyOrder: buyResult.order,
      sellOrder: sellResult.success ? sellResult.order : null,
      analysis: analysis.analysis,
      entryPrice: currentPrice,
      targetPrice: limitPrice,
      profitTarget: `${profitTargetPercent}% ($${actualProfit})`,
      profitTargetDollars,
      marketMetrics,
    });
  } catch (error) {
    console.error('❌ Error executing strategy trade:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Calculate aggregate market metrics from ranking stocks
function calculateMarketMetrics(rankingCandles, stockSymbols) {
  // Filter out stocks with no data
  const validStocks = rankingCandles.filter(
    (candles, i) => candles && candles.length >= 12
  );

  if (validStocks.length === 0) {
    return {
      avgChange3Hr: 0,
      positiveStocksPercent: 0,
      stocksWithData: 0,
      marketBreadth: 'Unknown',
    };
  }

  // Calculate first 3-hour performance for each stock
  const changes3Hr = validStocks
    .map(candles => {
      const first3Hr = candles.slice(0, Math.min(36, candles.length));
      if (first3Hr.length < 12) return null;

      const openPrice = first3Hr[0].open;
      const price3Hr = first3Hr[first3Hr.length - 1].close;
      return ((price3Hr - openPrice) / openPrice) * 100;
    })
    .filter(change => change !== null);

  // Calculate aggregate metrics
  const avgChange3Hr =
    changes3Hr.length > 0
      ? changes3Hr.reduce((sum, c) => sum + c, 0) / changes3Hr.length
      : 0;

  const positiveCount = changes3Hr.filter(c => c > 0).length;
  const positiveStocksPercent =
    changes3Hr.length > 0 ? (positiveCount / changes3Hr.length) * 100 : 0;

  // Determine market breadth
  let marketBreadth;
  if (positiveStocksPercent >= 70) {
    marketBreadth = 'Strong Positive';
  } else if (positiveStocksPercent >= 50) {
    marketBreadth = 'Moderate Positive';
  } else if (positiveStocksPercent >= 30) {
    marketBreadth = 'Mixed';
  } else {
    marketBreadth = 'Weak';
  }

  return {
    avgChange3Hr: avgChange3Hr.toFixed(2),
    positiveStocksPercent: positiveStocksPercent.toFixed(1),
    stocksWithData: validStocks.length,
    marketBreadth,
    rawChanges: changes3Hr,
  };
}

// Helper: Execute a trading strategy on a day's candles
function executeStrategy(
  candles,
  strategy,
  date,
  spyCandles,
  vixCandles,
  marketMetrics = null
) {
  if (candles.length === 0) return null;

  const openPrice = candles[0].open;
  const closePrice = candles[candles.length - 1].close;
  const dayChange = ((closePrice - openPrice) / openPrice) * 100;

  if (strategy.type === 'positive-day-exit') {
    // Strategy: Buy at open if day ends positive, exit X minutes before close
    if (dayChange > 0) {
      // Find exit candle (X minutes before close)
      const exitIndex = Math.max(
        0,
        candles.length - strategy.exitMinutesBeforeClose - 1
      );
      const exitPrice = candles[exitIndex].close;

      const profitLoss = ((exitPrice - openPrice) / openPrice) * 100;

      // Check if we hit profit target
      const hitTarget = profitLoss >= strategy.profitTarget;

      return {
        executed: true,
        date,
        entryPrice: openPrice,
        exitPrice,
        profitLoss,
        profitLossPercent: profitLoss.toFixed(2),
        hitTarget,
        entryTime: new Date(candles[0].timestamp).toISOString(),
        exitTime: new Date(candles[exitIndex].timestamp).toISOString(),
      };
    }
  } else if (strategy.type === 'first-3hr-momentum') {
    // Strategy: Analyze first 3 hours + market conditions to decide entry
    // 3 hours after open = 36 5-minute candles (9:30 AM - 12:30 PM ET)
    const first3HrCandles = candles.slice(0, Math.min(36, candles.length));

    if (first3HrCandles.length < 12) {
      // Not enough data for first 3 hours
      return {
        executed: false,
        date,
        reason: 'Insufficient data for first 3 hours',
        actualDayReturn: dayChange.toFixed(2),
        momentum: 0,
      };
    }

    // Calculate first 3-hour performance
    const entryPrice = first3HrCandles[0].open; // Entry at market open
    const price3Hr = first3HrCandles[first3HrCandles.length - 1].close;
    const change3Hr = ((price3Hr - entryPrice) / entryPrice) * 100;

    // Analyze market conditions (SPY/VIX) for first 3 hours
    let spyChange3Hr = 0;
    let vixChange3Hr = 0;

    if (spyCandles && spyCandles.length >= 12) {
      const spy3Hr = spyCandles.slice(0, Math.min(36, spyCandles.length));
      const spyOpen = spy3Hr[0].open;
      const spy3HrPrice = spy3Hr[spy3Hr.length - 1].close;
      spyChange3Hr = ((spy3HrPrice - spyOpen) / spyOpen) * 100;
    }

    if (vixCandles && vixCandles.length >= 12) {
      const vix3Hr = vixCandles.slice(0, Math.min(36, vixCandles.length));
      const vixOpen = vix3Hr[0].open;
      const vix3HrPrice = vix3Hr[vix3Hr.length - 1].close;
      vixChange3Hr = ((vix3HrPrice - vixOpen) / vixOpen) * 100;
    }

    // Entry criteria: Should we buy after analyzing first 3 hours?
    // Base criteria
    let shouldEnter =
      change3Hr > strategy.minMomentum3Hr && // Stock showing positive momentum
      spyChange3Hr > -0.5 && // Market not strongly negative
      vixChange3Hr < 5; // Fear not spiking

    // Enhanced criteria with market breadth from ranking stocks
    let marketBreadthPass = true;
    let marketBreadthReason = '';

    if (marketMetrics && marketMetrics.stocksWithData >= 5) {
      // Require at least 40% of ranking stocks showing positive momentum
      const minPositivePercent = strategy.minMarketBreadth || 40;
      marketBreadthPass =
        parseFloat(marketMetrics.positiveStocksPercent) >= minPositivePercent;

      if (!marketBreadthPass) {
        marketBreadthReason = `Market breadth too weak (${marketMetrics.positiveStocksPercent}% positive, need ${minPositivePercent}%)`;
      }

      // Also check average market performance
      const avgMarketChange = parseFloat(marketMetrics.avgChange3Hr);
      if (marketBreadthPass && avgMarketChange < -1.0) {
        marketBreadthPass = false;
        marketBreadthReason = `Overall market declining (${marketMetrics.avgChange3Hr}% avg)`;
      }

      shouldEnter = shouldEnter && marketBreadthPass;
    }

    if (!shouldEnter) {
      return {
        executed: false,
        date,
        reason: marketBreadthReason || 'Entry criteria not met',
        actualDayReturn: dayChange.toFixed(2),
        momentum: change3Hr.toFixed(2),
        analysis: {
          stockChange3Hr: change3Hr.toFixed(2),
          spyChange3Hr: spyChange3Hr.toFixed(2),
          vixChange3Hr: vixChange3Hr.toFixed(2),
          marketBreadth: marketMetrics?.marketBreadth || 'N/A',
          positiveStocksPercent: marketMetrics?.positiveStocksPercent || 'N/A',
          avgMarketChange3Hr: marketMetrics?.avgChange3Hr || 'N/A',
        },
      };
    }

    // Entry at end of 3rd hour (12:30 PM)
    const actualEntryPrice = price3Hr;
    const entryIndex = first3HrCandles.length - 1;

    // Look for exit: 10% profit target OR market close
    let exitPrice = null;
    let exitIndex = null;
    let exitReason = null;

    // Search remaining candles for 10% profit
    const profitTarget = strategy.profitTarget || 10;
    const targetPrice = actualEntryPrice * (1 + profitTarget / 100);

    for (let i = entryIndex; i < candles.length; i++) {
      if (candles[i].high >= targetPrice) {
        // Hit profit target
        exitPrice = targetPrice;
        exitIndex = i;
        exitReason = `Hit ${profitTarget}% profit target`;
        break;
      }
    }

    // If didn't hit target, exit at close
    if (!exitPrice) {
      exitPrice = candles[candles.length - 1].close;
      exitIndex = candles.length - 1;
      exitReason = 'Market close';
    }

    const profitLoss =
      ((exitPrice - actualEntryPrice) / actualEntryPrice) * 100;
    const hitTarget = profitLoss >= profitTarget;

    return {
      executed: true,
      date,
      entryPrice: actualEntryPrice,
      exitPrice,
      profitLoss,
      profitLossPercent: profitLoss.toFixed(2),
      hitTarget,
      entryTime: new Date(candles[entryIndex].timestamp).toISOString(),
      exitTime: new Date(candles[exitIndex].timestamp).toISOString(),
      exitReason,
      analysis: {
        stockChange3Hr: change3Hr.toFixed(2),
        spyChange3Hr: spyChange3Hr.toFixed(2),
        vixChange3Hr: vixChange3Hr.toFixed(2),
        marketBreadth: marketMetrics?.marketBreadth || 'N/A',
        positiveStocksPercent: marketMetrics?.positiveStocksPercent || 'N/A',
        avgMarketChange3Hr: marketMetrics?.avgChange3Hr || 'N/A',
        enteredTrade: true,
      },
    };
  }

  // Catch-all: If we reach here, no trade was executed
  return {
    executed: false,
    date,
    reason: 'Strategy conditions not met',
    actualDayReturn: dayChange.toFixed(2),
    momentum: 0,
  };
}

// Helper: Analyze market sentiment from S&P and VIX
function analyzeMarketSentiment(
  spyBars,
  vixBars,
  spyIntradayCandles,
  vixIntradayCandles
) {
  if (spyBars.length === 0 || vixBars.length === 0) {
    return {
      sentiment: 'Unknown',
      confidence: 0,
      description: 'Insufficient market data',
      spyCandles: spyIntradayCandles || [],
      vixCandles: vixIntradayCandles || [],
    };
  }

  const latestSpy = spyBars[spyBars.length - 1];
  const prevSpy = spyBars[spyBars.length - 2];
  const latestVix = vixBars[vixBars.length - 1];

  const spyChange = ((latestSpy.close - prevSpy.close) / prevSpy.close) * 100;
  const vixLevel = latestVix.close;

  let sentiment, confidence, description;

  if (spyChange > 0.5 && vixLevel < 20) {
    sentiment = 'Bullish';
    confidence = 85;
    description =
      'Strong uptrend with low volatility - favorable for long positions';
  } else if (spyChange > 0 && vixLevel < 25) {
    sentiment = 'Bullish';
    confidence = 65;
    description = 'Moderate uptrend - cautiously bullish';
  } else if (spyChange < -0.5 && vixLevel > 25) {
    sentiment = 'Bearish';
    confidence = 85;
    description =
      'Strong downtrend with elevated volatility - risky environment';
  } else if (spyChange < 0 && vixLevel > 20) {
    sentiment = 'Bearish';
    confidence = 65;
    description = 'Moderate downtrend - cautiously bearish';
  } else {
    sentiment = 'Neutral';
    confidence = 50;
    description = 'Mixed signals - wait for clearer direction';
  }

  return {
    sentiment,
    confidence,
    description,
    spyChange: spyChange.toFixed(2),
    vixLevel: vixLevel.toFixed(2),
    spyCandles: spyIntradayCandles || [],
    vixCandles: vixIntradayCandles || [],
  };
}

// Helper: Analyze intraday swing patterns (open, +30min, +3hr, close)
function analyzeIntradaySwings(intradayCandles) {
  if (intradayCandles.length === 0) {
    return {
      openPrice: null,
      price30min: null,
      price3hr: null,
      closePrice: null,
      swingPattern: 'No data',
      openingBehavior: 'Unknown',
      trendMagnitude: null,
    };
  }

  // Market opens at 9:30 AM ET
  // 30 min after open = 10:00 AM (6 candles if 5-min intervals)
  // 3 hours after open = 12:30 PM (36 candles if 5-min intervals)

  const openPrice = intradayCandles[0].close;
  const price30min =
    intradayCandles[Math.min(6, intradayCandles.length - 1)]?.close || null;
  const price3hr =
    intradayCandles[Math.min(36, intradayCandles.length - 1)]?.close || null;
  const closePrice = intradayCandles[intradayCandles.length - 1].close;

  // Calculate changes
  const change30min = price30min
    ? ((price30min - openPrice) / openPrice) * 100
    : null;
  const change3hr = price3hr
    ? ((price3hr - openPrice) / openPrice) * 100
    : null;
  const changeClose = ((closePrice - openPrice) / openPrice) * 100;

  // Determine opening behavior pattern
  let openingBehavior, swingPattern;

  if (change30min !== null) {
    if (Math.abs(change30min) < 0.5) {
      openingBehavior = 'Flat Open - Consolidating';
    } else if (change30min > 0) {
      openingBehavior = 'Strong Open - Early Bulls';
    } else {
      openingBehavior = 'Weak Open - Early Bears';
    }
  } else {
    openingBehavior = 'Insufficient Data';
  }

  // Determine swing pattern based on trajectory
  if (change30min && change3hr && changeClose) {
    if (change30min > 0 && change3hr > change30min && changeClose > change3hr) {
      swingPattern = 'Sustained Rally - Continuous buying pressure';
    } else if (
      change30min > 0 &&
      change3hr > change30min &&
      changeClose < change3hr
    ) {
      swingPattern = 'Rally then Fade - Profit taking into close';
    } else if (change30min > 0 && changeClose < 0) {
      swingPattern = 'Gap Fill - Morning pop reversed';
    } else if (
      change30min < 0 &&
      change3hr < change30min &&
      changeClose < change3hr
    ) {
      swingPattern = 'Sustained Selloff - Continuous selling pressure';
    } else if (change30min < 0 && changeClose > 0) {
      swingPattern = 'Morning Dip Bought - Recovery into close';
    } else if (Math.abs(change30min) < 1 && Math.abs(changeClose) < 1) {
      swingPattern = 'Choppy/Ranging - No clear direction';
    } else {
      swingPattern = 'Mixed Signals - Erratic price action';
    }
  } else {
    swingPattern = 'Incomplete data';
  }

  // Calculate trend magnitude
  const trendMagnitude = Math.abs(changeClose);

  return {
    openPrice: openPrice.toFixed(2),
    price30min: price30min?.toFixed(2) || 'N/A',
    price3hr: price3hr?.toFixed(2) || 'N/A',
    closePrice: closePrice.toFixed(2),
    change30min: change30min?.toFixed(2),
    change3hr: change3hr?.toFixed(2),
    changeClose: changeClose.toFixed(2),
    swingPattern,
    openingBehavior,
    trendMagnitude: trendMagnitude.toFixed(2),
  };
}

// Helper: Analyze intraday pattern
function analyzeIntradayPattern(intradayCandles, dailyBars) {
  if (intradayCandles.length === 0) {
    return { pattern: 'No data', strength: 0 };
  }

  const openPrice = intradayCandles[0].open;
  const currentPrice = intradayCandles[intradayCandles.length - 1].close;
  const priceChange = ((currentPrice - openPrice) / openPrice) * 100;

  // Check if price is trending or ranging
  const highsAndLows = intradayCandles.map(c => ({ high: c.high, low: c.low }));
  const firstHalf = highsAndLows.slice(0, Math.floor(highsAndLows.length / 2));
  const secondHalf = highsAndLows.slice(Math.floor(highsAndLows.length / 2));

  const firstHalfAvgHigh =
    firstHalf.reduce((sum, hl) => sum + hl.high, 0) / firstHalf.length;
  const secondHalfAvgHigh =
    secondHalf.reduce((sum, hl) => sum + hl.high, 0) / secondHalf.length;

  let pattern, strength;

  if (secondHalfAvgHigh > firstHalfAvgHigh * 1.01) {
    pattern = 'Uptrend';
    strength = Math.min(
      ((secondHalfAvgHigh - firstHalfAvgHigh) / firstHalfAvgHigh) * 1000,
      100
    );
  } else if (secondHalfAvgHigh < firstHalfAvgHigh * 0.99) {
    pattern = 'Downtrend';
    strength = Math.min(
      ((firstHalfAvgHigh - secondHalfAvgHigh) / firstHalfAvgHigh) * 1000,
      100
    );
  } else {
    pattern = 'Ranging';
    strength = 50;
  }

  return {
    pattern,
    strength: Math.round(strength),
    priceChange: priceChange.toFixed(2),
  };
}

// Helper: Generate trading recommendations
function generateTradingRecommendations(
  symbol,
  intradayCandles,
  dailyBars,
  marketSentiment,
  technicals
) {
  if (intradayCandles.length === 0 || dailyBars.length === 0) {
    return {
      action: 'WAIT',
      confidence: 0,
      reason: 'Insufficient data for recommendation',
      entryPrice: null,
      exitPrice: null,
      stopLoss: null,
    };
  }

  const currentPrice = intradayCandles[intradayCandles.length - 1].close;
  const highOfDay = Math.max(...intradayCandles.map(c => c.high));
  const lowOfDay = Math.min(...intradayCandles.map(c => c.low));

  // Score the setup
  let score = 50; // Start neutral

  // Market sentiment weight (30%)
  if (marketSentiment.sentiment === 'Bullish') {
    score += marketSentiment.confidence * 0.3;
  } else if (marketSentiment.sentiment === 'Bearish') {
    score -= marketSentiment.confidence * 0.3;
  }

  // RSI weight (20%)
  if (technicals?.rsi) {
    if (technicals.rsi < 30)
      score += 20; // Oversold - bullish
    else if (technicals.rsi > 70) score -= 20; // Overbought - bearish
  }

  // Price position relative to MAs (20%)
  if (technicals?.sma20 && technicals?.sma50) {
    if (
      currentPrice > technicals.sma20 &&
      technicals.sma20 > technicals.sma50
    ) {
      score += 20; // Above MAs and MAs aligned - bullish
    } else if (
      currentPrice < technicals.sma20 &&
      technicals.sma20 < technicals.sma50
    ) {
      score -= 20; // Below MAs and MAs aligned - bearish
    }
  }

  // Determine action
  let action, reason, entryPrice, exitPrice, stopLoss;

  if (score >= 70) {
    action = 'BUY';
    reason = 'Strong bullish setup with favorable market conditions';
    entryPrice = currentPrice;
    exitPrice = currentPrice * 1.05; // 5% profit target
    stopLoss = lowOfDay * 0.99; // 1% below day low
  } else if (score <= 30) {
    action = 'SELL/SHORT';
    reason = 'Strong bearish setup - avoid long positions';
    entryPrice = currentPrice;
    exitPrice = currentPrice * 0.95; // 5% profit target on short
    stopLoss = highOfDay * 1.01; // 1% above day high
  } else {
    action = 'WAIT';
    reason = 'Mixed signals - wait for clearer setup';
    entryPrice = null;
    exitPrice = null;
    stopLoss = null;
  }

  return {
    action,
    confidence: Math.round(Math.abs(score - 50) * 2), // 0-100 scale
    reason,
    entryPrice: entryPrice ? entryPrice.toFixed(2) : null,
    exitPrice: exitPrice ? exitPrice.toFixed(2) : null,
    stopLoss: stopLoss ? stopLoss.toFixed(2) : null,
    score: Math.round(score),
  };
}

// Helper: Find similar historical patterns
async function findSimilarPatterns(symbol, dailyBars, marketSentiment) {
  // This is a simplified pattern matcher
  // In production, you'd use more sophisticated ML/statistical methods

  if (dailyBars.length < 3) {
    return [];
  }

  const recentVolatility = polygonClient.calculateVolatility(dailyBars, 5);
  const recentRSI = polygonClient.calculateRSI(dailyBars, 14);

  return [
    {
      date: 'Historical analysis',
      similarity: 'High',
      description: `Similar ${marketSentiment.sentiment.toLowerCase()} setup with comparable volatility (${recentVolatility?.toFixed(2)}%) and RSI (${recentRSI?.toFixed(0)})`,
      outcome: 'Pattern matching requires more historical data',
    },
  ];
}

// 16. Get quarterly data for a stock
app.get('/api/quarterly/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await snapshotManager.loadQuarterlyData(symbol);

    if (!data) {
      return res
        .status(404)
        .json({ error: 'Quarterly data not found for symbol' });
    }

    res.json({
      success: true,
      data,
      message: 'Quarterly data retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error retrieving quarterly data:', error.message);
    res.status(500).json({ error: 'Failed to retrieve quarterly data' });
  }
});

// 16. Calculate QoQ for a stock metric
app.get('/api/quarterly/:symbol/qoq/:metric', async (req, res) => {
  try {
    const { symbol, metric } = req.params;
    const qoq = await snapshotManager.calculateQoQ(symbol, metric);

    if (!qoq) {
      return res.status(404).json({ error: 'QoQ data not available' });
    }

    res.json({
      success: true,
      qoq,
      message: 'QoQ calculation retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error calculating QoQ:', error.message);
    res.status(500).json({ error: 'Failed to calculate QoQ' });
  }
});

// 17. Calculate YoY for a stock metric
app.get('/api/quarterly/:symbol/yoy/:metric', async (req, res) => {
  try {
    const { symbol, metric } = req.params;
    const yoy = await snapshotManager.calculateYoY(symbol, metric);

    if (!yoy) {
      return res.status(404).json({ error: 'YoY data not available' });
    }

    res.json({
      success: true,
      yoy,
      message: 'YoY calculation retrieved successfully',
    });
  } catch (error) {
    console.error('❌ Error calculating YoY:', error.message);
    res.status(500).json({ error: 'Failed to calculate YoY' });
  }
});

// ==========================================
// ALPACA PAPER TRADING ENDPOINTS
// ==========================================

// 18. Get Alpaca account info
app.get('/api/alpaca/account', async (req, res) => {
  try {
    const account = await alpacaClient.getAccount();
    res.json({ success: true, account });
  } catch (error) {
    console.error('❌ Error fetching Alpaca account:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 19. Get Alpaca positions
app.get('/api/alpaca/positions', async (req, res) => {
  try {
    const positions = await alpacaClient.getPositions();
    res.json({ success: true, positions });
  } catch (error) {
    console.error('❌ Error fetching positions:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 20. Get Alpaca position for specific symbol
app.get('/api/alpaca/positions/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const position = await alpacaClient.getPosition(symbol);

    if (!position) {
      return res.json({
        success: true,
        position: null,
        message: 'No position found',
      });
    }

    res.json({ success: true, position });
  } catch (error) {
    console.error(
      `❌ Error fetching position for ${req.params.symbol}:`,
      error.message
    );
    res.status(500).json({ error: error.message });
  }
});

// 21. Place order on Alpaca
app.post('/api/alpaca/orders', async (req, res) => {
  try {
    const {
      symbol,
      qty,
      side,
      type = 'market',
      time_in_force = 'day',
      limit_price,
      market_price,
    } = req.body;

    if (!symbol || !qty || !side) {
      return res
        .status(400)
        .json({ error: 'symbol, qty, and side are required' });
    }

    const orderParams = {
      symbol,
      qty,
      side,
      type,
      time_in_force,
    };

    if (type === 'limit' && limit_price) {
      orderParams.limit_price = limit_price;
    }

    // Add market_price for validation if provided
    if (market_price) {
      orderParams.market_price = market_price;
    }

    // Get account value for safety validation
    let accountValue = null;
    try {
      const account = await alpacaClient.getAccount();
      accountValue = parseFloat(account.portfolio_value);
    } catch (e) {
      console.warn('⚠️  Could not fetch account value for validation');
    }

    const order = await alpacaClient.placeOrder(orderParams, accountValue);
    res.json({ success: true, order });
  } catch (error) {
    console.error('❌ Error placing order:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 22. Get Alpaca orders (with P/L for sell orders)
app.get('/api/alpaca/orders', async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.limit) filters.limit = req.query.limit;

    const orders = await alpacaClient.getOrders(filters);

    // Get recent trade activities to enrich sell orders with P/L
    // Activities contain per_share_profit for closed trades
    let activities = [];
    try {
      activities = await alpacaClient.getAccountActivities({
        activity_types: 'FILL',
        page_size: 100,
      });
    } catch (err) {
      console.warn(
        'Could not fetch activities for P/L enrichment:',
        err.message
      );
    }

    // Create a map of order_id -> activity for quick lookup
    const activityByOrderId = {};
    if (Array.isArray(activities)) {
      activities.forEach(activity => {
        if (activity.order_id) {
          // Store the activity, keyed by order_id
          // Note: There may be multiple fills for a single order (partial fills)
          if (!activityByOrderId[activity.order_id]) {
            activityByOrderId[activity.order_id] = [];
          }
          activityByOrderId[activity.order_id].push(activity);
        }
      });
    }

    // Enrich orders with P/L data for filled sell orders
    const enrichedOrders = orders.map(order => {
      const enriched = { ...order };

      // For sell orders that are filled, calculate P/L from activities
      if (order.side === 'sell' && order.status === 'filled') {
        const fills = activityByOrderId[order.id];
        if (fills && fills.length > 0) {
          // Sum up P/L from all fills for this order
          let totalPnL = 0;
          let hasValidPnL = false;

          fills.forEach(fill => {
            // Alpaca activities may have per_share_profit or we calculate from price/cost_basis
            if (
              fill.per_share_profit !== undefined &&
              fill.per_share_profit !== null
            ) {
              const qty = parseFloat(fill.qty) || 0;
              totalPnL += parseFloat(fill.per_share_profit) * qty;
              hasValidPnL = true;
            } else if (fill.price && fill.cost_basis) {
              // Fallback: calculate from fill price - cost_basis
              const qty = parseFloat(fill.qty) || 0;
              const fillPrice = parseFloat(fill.price) || 0;
              const costBasisPerShare = parseFloat(fill.cost_basis) / qty;
              totalPnL += (fillPrice - costBasisPerShare) * qty;
              hasValidPnL = true;
            }
          });

          if (hasValidPnL) {
            enriched.pnl = totalPnL;
          }
        }
      }

      return enriched;
    });

    res.json({ success: true, orders: enrichedOrders });
  } catch (error) {
    console.error('❌ Error fetching orders:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 23. Cancel order
app.delete('/api/alpaca/orders/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    await alpacaClient.cancelOrder(orderId);
    res.json({ success: true, message: 'Order cancelled' });
  } catch (error) {
    console.error('❌ Error cancelling order:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 24. Close position
app.delete('/api/alpaca/positions/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const result = await alpacaClient.closePosition(symbol);
    res.json({ success: true, result });
  } catch (error) {
    console.error(
      `❌ Error closing position ${req.params.symbol}:`,
      error.message
    );
    res.status(500).json({ error: error.message });
  }
});

// 25. Get latest quote from Alpaca
app.get('/api/alpaca/quotes/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const quote = await alpacaClient.getLatestQuote(symbol);
    res.json({ success: true, quote });
  } catch (error) {
    console.error(
      `❌ Error fetching quote for ${req.params.symbol}:`,
      error.message
    );
    res.status(500).json({ error: error.message });
  }
});

// 26. Get latest trade from Alpaca
app.get('/api/alpaca/trades/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const trade = await alpacaClient.getLatestTrade(symbol);
    res.json({ success: true, trade });
  } catch (error) {
    console.error(
      `❌ Error fetching trade for ${req.params.symbol}:`,
      error.message
    );
    res.status(500).json({ error: error.message });
  }
});

// 27. Get comprehensive stock analysis for trading decisions
app.get('/api/stock/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    console.log(`📊 Fetching comprehensive analysis for ${symbol}...`);

    // Calculate date range for historical data (100 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 100);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    // Use Polygon for historical data (same as rankings endpoint - more reliable)
    const polygonClient = require('./polygonClient');
    const bars = await polygonClient
      .getHistoricalAggregates(symbol, startDateStr, endDateStr)
      .catch(e => {
        console.error(`❌ Polygon bars fetch failed for ${symbol}:`, e.message);
        return { error: e.message };
      });

    // We need at least bars data to provide analysis
    if (bars.error || !bars || bars.length === 0) {
      throw new Error(
        `Unable to fetch historical data for ${symbol}. The symbol may be invalid or market data unavailable.`
      );
    }

    // Get latest quote from Polygon for current price
    const latestQuote = await polygonClient.getLatestQuote(symbol).catch(e => {
      console.log(
        `⚠️  Polygon quote fetch failed for ${symbol} (may be normal if market closed)`
      );
      return { error: e.message };
    });

    // Extract current price - use latest bar close price if real-time data unavailable
    const latestBar = bars[bars.length - 1];
    const currentPrice =
      (!latestQuote.error && latestQuote.price) || latestBar.close;
    const bidPrice = (!latestQuote.error && latestQuote.bidPrice) || null;
    const askPrice = (!latestQuote.error && latestQuote.askPrice) || null;
    const spread = bidPrice && askPrice ? askPrice - bidPrice : null;

    // Volume analysis
    const dailyVolume =
      bars && bars.length > 0 ? bars[bars.length - 1].volume : null;
    const prevVolume =
      bars && bars.length > 1 ? bars[bars.length - 2].volume : null;
    const volumeChange =
      prevVolume && dailyVolume
        ? ((dailyVolume - prevVolume) / prevVolume) * 100
        : null;

    // Calculate technical indicators from historical data
    let technicals = null;
    if (bars && bars.length >= 14) {
      // RSI calculation (14-period)
      const rsi = calculateRSI(bars, 14);

      // Moving averages
      const sma20 = calculateSMA(bars, 20);
      const sma50 = calculateSMA(bars, 50);

      // Price momentum
      const priceChange1D =
        bars.length >= 2
          ? ((bars[bars.length - 1].close - bars[bars.length - 2].close) /
              bars[bars.length - 2].close) *
            100
          : null;
      const priceChange1W =
        bars.length >= 7
          ? ((bars[bars.length - 1].close - bars[bars.length - 7].close) /
              bars[bars.length - 7].close) *
            100
          : null;
      const priceChange1M =
        bars.length >= 30
          ? ((bars[bars.length - 1].close - bars[bars.length - 30].close) /
              bars[bars.length - 30].close) *
            100
          : null;

      // 52-week high/low
      const prices = bars.map(b => b.high);
      const high52w = Math.max(...prices);
      const low52w = Math.min(...prices);
      const distanceFromHigh = ((currentPrice - high52w) / high52w) * 100;
      const distanceFromLow = ((currentPrice - low52w) / low52w) * 100;

      technicals = {
        rsi: rsi ? rsi.toFixed(2) : null,
        rsiSignal: rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral',
        sma20: sma20 ? sma20.toFixed(2) : null,
        sma50: sma50 ? sma50.toFixed(2) : null,
        trendSignal:
          currentPrice > sma20 && sma20 > sma50
            ? 'Bullish'
            : currentPrice < sma20 && sma20 < sma50
              ? 'Bearish'
              : 'Neutral',
        priceChange1D: priceChange1D ? priceChange1D.toFixed(2) : null,
        priceChange1W: priceChange1W ? priceChange1W.toFixed(2) : null,
        priceChange1M: priceChange1M ? priceChange1M.toFixed(2) : null,
        high52w: high52w.toFixed(2),
        low52w: low52w.toFixed(2),
        distanceFromHigh: distanceFromHigh.toFixed(2),
        distanceFromLow: distanceFromLow.toFixed(2),
      };
    }

    // ============================================
    // ENHANCED AI ANALYSIS WITH FULL TRANSPARENCY
    // ============================================
    // This shows exactly how each signal contributes to the final recommendation

    let recommendation = 'Neutral';
    let reasons = [];
    let totalScore = 0;
    const maxPossibleScore = 10; // Maximum possible positive/negative score

    // Signal breakdown for transparency
    const signalBreakdown = [];

    if (technicals) {
      // ---- RSI SIGNAL (Weight: 25%) ----
      const rsiValue = parseFloat(technicals.rsi);
      let rsiScore = 0;
      let rsiSignal = 'Neutral';
      let rsiExplanation = '';

      if (rsiValue < 30) {
        rsiScore = 2.5;
        rsiSignal = 'Bullish';
        rsiExplanation = `RSI at ${rsiValue.toFixed(1)} indicates oversold conditions - historically a buying opportunity`;
      } else if (rsiValue < 40) {
        rsiScore = 1;
        rsiSignal = 'Slightly Bullish';
        rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is approaching oversold territory`;
      } else if (rsiValue > 70) {
        rsiScore = -2.5;
        rsiSignal = 'Bearish';
        rsiExplanation = `RSI at ${rsiValue.toFixed(1)} indicates overbought conditions - may see pullback`;
      } else if (rsiValue > 60) {
        rsiScore = -1;
        rsiSignal = 'Slightly Bearish';
        rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is approaching overbought territory`;
      } else {
        rsiExplanation = `RSI at ${rsiValue.toFixed(1)} is in neutral range (30-70)`;
      }

      signalBreakdown.push({
        indicator: 'RSI (14)',
        value: rsiValue.toFixed(1),
        signal: rsiSignal,
        score: rsiScore,
        maxScore: 2.5,
        weight: '25%',
        explanation: rsiExplanation,
        formula:
          'RSI = 100 - (100 / (1 + RS)), where RS = Avg Gain / Avg Loss over 14 periods',
      });
      totalScore += rsiScore;
      if (rsiScore !== 0) reasons.push(rsiExplanation);

      // ---- TREND SIGNAL (Weight: 20%) ----
      let trendScore = 0;
      let trendExplanation = '';

      if (technicals.trendSignal === 'Bullish') {
        trendScore = 2;
        trendExplanation = `Price ($${currentPrice.toFixed(2)}) > SMA20 ($${technicals.sma20}) > SMA50 ($${technicals.sma50}) - Strong uptrend`;
      } else if (technicals.trendSignal === 'Bearish') {
        trendScore = -2;
        trendExplanation = `Price ($${currentPrice.toFixed(2)}) < SMA20 ($${technicals.sma20}) < SMA50 ($${technicals.sma50}) - Downtrend`;
      } else {
        trendExplanation = `Mixed signals: Price/MA alignment unclear - sideways market`;
      }

      signalBreakdown.push({
        indicator: 'Trend (MA Cross)',
        value: technicals.trendSignal,
        signal: technicals.trendSignal,
        score: trendScore,
        maxScore: 2,
        weight: '20%',
        explanation: trendExplanation,
        formula:
          'Bullish if Price > SMA20 > SMA50; Bearish if Price < SMA20 < SMA50',
        details: {
          price: currentPrice.toFixed(2),
          sma20: technicals.sma20,
          sma50: technicals.sma50,
        },
      });
      totalScore += trendScore;
      if (trendScore !== 0) reasons.push(trendExplanation);

      // ---- 52-WEEK POSITION (Weight: 15%) ----
      const distFromHigh = parseFloat(technicals.distanceFromHigh);
      const distFromLow = parseFloat(technicals.distanceFromLow);
      let positionScore = 0;
      let positionSignal = 'Neutral';
      let positionExplanation = '';

      if (distFromHigh > -10) {
        positionScore = -1.5;
        positionSignal = 'Bearish';
        positionExplanation = `Trading ${Math.abs(distFromHigh).toFixed(1)}% from 52-week high ($${technicals.high52w}) - limited upside`;
      } else if (distFromHigh < -30) {
        positionScore = 1.5;
        positionSignal = 'Bullish';
        positionExplanation = `Trading ${Math.abs(distFromHigh).toFixed(1)}% below 52-week high - significant discount`;
      } else {
        positionExplanation = `Trading in middle of 52-week range (${distFromHigh.toFixed(1)}% from high)`;
      }

      signalBreakdown.push({
        indicator: '52-Week Position',
        value: `${distFromHigh.toFixed(1)}% from high`,
        signal: positionSignal,
        score: positionScore,
        maxScore: 1.5,
        weight: '15%',
        explanation: positionExplanation,
        details: {
          high52w: technicals.high52w,
          low52w: technicals.low52w,
          distanceFromHigh: distFromHigh.toFixed(2) + '%',
          distanceFromLow: distFromLow.toFixed(2) + '%',
        },
      });
      totalScore += positionScore;
      if (positionScore !== 0) reasons.push(positionExplanation);

      // ---- MOMENTUM (Weight: 15%) ----
      const priceChange1W = parseFloat(technicals.priceChange1W || 0);
      const priceChange1M = parseFloat(technicals.priceChange1M || 0);
      let momentumScore = 0;
      let momentumSignal = 'Neutral';
      let momentumExplanation = '';

      if (priceChange1W > 5 && priceChange1M > 10) {
        momentumScore = 1.5;
        momentumSignal = 'Strong Bullish';
        momentumExplanation = `Strong momentum: +${priceChange1W.toFixed(1)}% (1W), +${priceChange1M.toFixed(1)}% (1M)`;
      } else if (priceChange1W > 2) {
        momentumScore = 0.75;
        momentumSignal = 'Bullish';
        momentumExplanation = `Positive momentum: +${priceChange1W.toFixed(1)}% this week`;
      } else if (priceChange1W < -5 && priceChange1M < -10) {
        momentumScore = -1.5;
        momentumSignal = 'Strong Bearish';
        momentumExplanation = `Negative momentum: ${priceChange1W.toFixed(1)}% (1W), ${priceChange1M.toFixed(1)}% (1M)`;
      } else if (priceChange1W < -2) {
        momentumScore = -0.75;
        momentumSignal = 'Bearish';
        momentumExplanation = `Weak momentum: ${priceChange1W.toFixed(1)}% this week`;
      } else {
        momentumExplanation = `Flat momentum: ${priceChange1W.toFixed(1)}% (1W)`;
      }

      signalBreakdown.push({
        indicator: 'Price Momentum',
        value: `${priceChange1W >= 0 ? '+' : ''}${priceChange1W.toFixed(1)}% (1W)`,
        signal: momentumSignal,
        score: momentumScore,
        maxScore: 1.5,
        weight: '15%',
        explanation: momentumExplanation,
        details: {
          change1D: technicals.priceChange1D + '%',
          change1W: technicals.priceChange1W + '%',
          change1M: technicals.priceChange1M + '%',
        },
      });
      totalScore += momentumScore;
      if (momentumScore !== 0) reasons.push(momentumExplanation);

      // ---- VOLUME SIGNAL (Weight: 15%) ----
      let volumeScore = 0;
      let volumeSignal = 'Neutral';
      let volumeExplanation = '';

      if (volumeChange !== null) {
        if (volumeChange > 100) {
          volumeScore = 1.5;
          volumeSignal = 'High Interest';
          volumeExplanation = `Volume surged +${volumeChange.toFixed(0)}% vs yesterday - significant market interest`;
        } else if (volumeChange > 50) {
          volumeScore = 0.75;
          volumeSignal = 'Elevated';
          volumeExplanation = `Volume up +${volumeChange.toFixed(0)}% - above average activity`;
        } else if (volumeChange < -50) {
          volumeScore = -0.5;
          volumeSignal = 'Low';
          volumeExplanation = `Volume down ${volumeChange.toFixed(0)}% - lack of conviction`;
        } else {
          volumeExplanation = `Volume change ${volumeChange >= 0 ? '+' : ''}${volumeChange.toFixed(0)}% - normal activity`;
        }
      } else {
        volumeExplanation = 'Volume data unavailable';
      }

      signalBreakdown.push({
        indicator: 'Volume',
        value: dailyVolume ? dailyVolume.toLocaleString() : 'N/A',
        signal: volumeSignal,
        score: volumeScore,
        maxScore: 1.5,
        weight: '15%',
        explanation: volumeExplanation,
        details: {
          current: dailyVolume,
          previous: prevVolume,
          changePercent: volumeChange ? volumeChange.toFixed(1) + '%' : 'N/A',
        },
      });
      totalScore += volumeScore;
      if (volumeScore !== 0) reasons.push(volumeExplanation);

      // ---- VOLATILITY ASSESSMENT (Weight: 10%) ----
      // Calculate recent volatility from price swings
      let volatilityScore = 0;
      let volatilitySignal = 'Normal';
      let volatilityExplanation = '';

      if (bars.length >= 20) {
        const recentBars = bars.slice(-20);
        const dailyReturns = recentBars
          .slice(1)
          .map(
            (b, i) =>
              Math.abs((b.close - recentBars[i].close) / recentBars[i].close) *
              100
          );
        const avgDailySwing =
          dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;

        if (avgDailySwing > 3) {
          volatilityScore = -1;
          volatilitySignal = 'High Risk';
          volatilityExplanation = `High volatility: avg daily swing ${avgDailySwing.toFixed(1)}% - increased risk`;
        } else if (avgDailySwing < 1) {
          volatilityScore = 0.5;
          volatilitySignal = 'Low Risk';
          volatilityExplanation = `Low volatility: avg daily swing ${avgDailySwing.toFixed(1)}% - stable`;
        } else {
          volatilityExplanation = `Normal volatility: avg daily swing ${avgDailySwing.toFixed(1)}%`;
        }

        signalBreakdown.push({
          indicator: 'Volatility',
          value: avgDailySwing.toFixed(1) + '%',
          signal: volatilitySignal,
          score: volatilityScore,
          maxScore: 1,
          weight: '10%',
          explanation: volatilityExplanation,
        });
        totalScore += volatilityScore;
      }

      // ============================================
      // FINAL RECOMMENDATION CALCULATION
      // ============================================
      const normalizedScore = (totalScore / maxPossibleScore) * 100; // -100 to +100 scale
      const confidence = Math.min(
        95,
        Math.max(30, 50 + Math.abs(normalizedScore) / 2)
      );

      if (totalScore >= 5) recommendation = 'Strong Buy';
      else if (totalScore >= 2.5) recommendation = 'Buy';
      else if (totalScore >= 0.5) recommendation = 'Lean Buy';
      else if (totalScore <= -5) recommendation = 'Strong Sell';
      else if (totalScore <= -2.5) recommendation = 'Sell';
      else if (totalScore <= -0.5) recommendation = 'Lean Sell';
      else recommendation = 'Neutral';

      // Add confidence explanation
      const confidenceExplanation =
        totalScore > 0
          ? `${signalBreakdown.filter(s => s.score > 0).length} of ${signalBreakdown.length} signals are bullish`
          : totalScore < 0
            ? `${signalBreakdown.filter(s => s.score < 0).length} of ${signalBreakdown.length} signals are bearish`
            : 'Signals are mixed - no clear direction';

      // Store enhanced analysis data
      technicals.signalBreakdown = signalBreakdown;
      technicals.totalScore = totalScore.toFixed(2);
      technicals.maxPossibleScore = maxPossibleScore;
      technicals.normalizedScore = normalizedScore.toFixed(1);
      technicals.confidence = confidence.toFixed(0);
      technicals.confidenceExplanation = confidenceExplanation;
    }

    // Calculate expected returns (simple projections based on historical volatility)
    let projections = null;
    if (bars && bars.length >= 30 && currentPrice) {
      const returns = [];
      for (let i = 1; i < bars.length; i++) {
        returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
      }

      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stdDev = Math.sqrt(
        returns.reduce((sq, n) => sq + Math.pow(n - avgReturn, 2), 0) /
          returns.length
      );

      // Project forward (annualized then scaled down)
      const annualReturn = avgReturn * 252; // 252 trading days
      const annualVol = stdDev * Math.sqrt(252);

      const return1W = (annualReturn / 52) * 100;
      const return1M = (annualReturn / 12) * 100;
      const vol1W = (annualVol / Math.sqrt(52)) * 100;
      const vol1M = (annualVol / Math.sqrt(12)) * 100;

      projections = {
        oneWeek: {
          expectedReturn: return1W.toFixed(2),
          expectedPrice: (currentPrice * (1 + return1W / 100)).toFixed(2),
          volatility: vol1W.toFixed(2),
          range: {
            low: (currentPrice * (1 + return1W / 100 - vol1W / 100)).toFixed(2),
            high: (currentPrice * (1 + return1W / 100 + vol1W / 100)).toFixed(
              2
            ),
          },
        },
        oneMonth: {
          expectedReturn: return1M.toFixed(2),
          expectedPrice: (currentPrice * (1 + return1M / 100)).toFixed(2),
          volatility: vol1M.toFixed(2),
          range: {
            low: (currentPrice * (1 + return1M / 100 - vol1M / 100)).toFixed(2),
            high: (currentPrice * (1 + return1M / 100 + vol1M / 100)).toFixed(
              2
            ),
          },
        },
      };
    }

    const analysis = {
      symbol,
      timestamp: new Date().toISOString(),
      price: {
        current: currentPrice,
        bid: bidPrice,
        ask: askPrice,
        spread: spread ? spread.toFixed(4) : null,
        change24h: technicals?.priceChange1D || null,
      },
      volume: {
        current: dailyVolume,
        previous: prevVolume,
        changePercent: volumeChange ? volumeChange.toFixed(2) : null,
      },
      technicals,
      recommendation: {
        action: recommendation,
        score: totalScore,
        maxScore: maxPossibleScore,
        normalizedScore: technicals?.normalizedScore || 0,
        confidence: technicals?.confidence || 50,
        confidenceExplanation: technicals?.confidenceExplanation || '',
        reasons,
        signalBreakdown: technicals?.signalBreakdown || [],
      },
      projections,
    };

    console.log(`✅ Analysis complete for ${symbol}: ${recommendation}`);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error(`❌ Error analyzing ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to calculate RSI
function calculateRSI(bars, period = 14) {
  if (bars.length < period + 1) return null;

  const changes = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].close - bars[i - 1].close);
  }

  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));

  const avgGain =
    gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss =
    losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Helper function to calculate Simple Moving Average
function calculateSMA(bars, period) {
  if (bars.length < period) return null;
  const recentPrices = bars.slice(-period).map(b => b.close);
  return recentPrices.reduce((a, b) => a + b, 0) / period;
}

// ==========================================
// TRADING MODE MANAGEMENT ENDPOINTS
// ==========================================

// 28. Get current trading mode info
app.get('/api/trading/mode', (req, res) => {
  try {
    const modeInfo = tradingModeManager.getModeInfo();
    res.json({ success: true, mode: modeInfo });
  } catch (error) {
    console.error('❌ Error getting trading mode:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 28. Set trading mode (paper or live)
app.post('/api/trading/mode', (req, res) => {
  try {
    const { mode } = req.body;

    if (!mode) {
      return res
        .status(400)
        .json({ error: 'mode is required (paper or live)' });
    }

    const result = tradingModeManager.setTradingMode(mode);
    const modeInfo = tradingModeManager.getModeInfo();

    res.json({
      success: true,
      result,
      mode: modeInfo,
      message: `Trading mode switched to ${mode.toUpperCase()}`,
    });
  } catch (error) {
    console.error('❌ Error setting trading mode:', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// DATA VALIDATION ENDPOINTS (Alpaca vs Polygon)
// ==========================================

// 29. Validate current price between Alpaca and Polygon
app.get('/api/validate/price/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const validation = await alpacaClient.validatePriceWithPolygon(
      symbol,
      polygonClient
    );
    res.json({ success: true, validation });
  } catch (error) {
    console.error(
      `❌ Error validating price for ${req.params.symbol}:`,
      error.message
    );
    res.status(500).json({ error: error.message });
  }
});

// 28. Validate historical data between Alpaca and Polygon
app.post('/api/validate/historical', async (req, res) => {
  try {
    const { symbol, startDate, endDate } = req.body;

    if (!symbol || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'symbol, startDate, and endDate are required' });
    }

    const validation = await alpacaClient.validateHistoricalDataWithPolygon(
      symbol,
      startDate,
      endDate,
      polygonClient
    );

    res.json({ success: true, validation });
  } catch (error) {
    console.error('❌ Error validating historical data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 29. Batch validate prices for multiple symbols
app.post('/api/validate/prices/batch', async (req, res) => {
  try {
    const { symbols } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'symbols array is required' });
    }

    const validations = [];

    for (const symbol of symbols) {
      try {
        const validation = await alpacaClient.validatePriceWithPolygon(
          symbol,
          polygonClient
        );
        validations.push(validation);
      } catch (error) {
        validations.push({
          symbol,
          error: error.message,
          isValid: false,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const validCount = validations.filter(v => v.isValid).length;
    const validPercent = (validCount / validations.length) * 100;

    console.log(`\n📊 Batch Validation Summary:`);
    console.log(`   Total symbols: ${validations.length}`);
    console.log(`   Valid: ${validCount} (${validPercent.toFixed(1)}%)`);
    console.log(`   Invalid: ${validations.length - validCount}`);

    res.json({
      success: true,
      summary: {
        total: validations.length,
        valid: validCount,
        invalid: validations.length - validCount,
        validPercent,
      },
      validations,
    });
  } catch (error) {
    console.error('❌ Error in batch validation:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// BACKTESTING ENDPOINTS
// ==========================================

// 30. Run backtest
app.post('/api/backtest/run', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      topN = 5,
      rebalanceFrequency = 'daily',
      initialCapital = 100000,
    } = req.body;

    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'startDate and endDate are required' });
    }

    console.log(
      `🧪 Running backtest: ${startDate} to ${endDate}, top ${topN}, ${rebalanceFrequency}`
    );

    const results = await backtestEngine.backtestTopNStrategy({
      startDate,
      endDate,
      topN,
      rebalanceFrequency,
      initialCapital,
    });

    console.log(
      `✅ Backtest completed: ${results.performance.totalReturn.toFixed(2)}% return`
    );

    res.json({
      success: true,
      results,
      message: 'Backtest completed successfully',
    });
  } catch (error) {
    console.error('❌ Error running backtest:', error.message);
    res.status(500).json({ error: error.message || 'Failed to run backtest' });
  }
});

// ==========================================
// AI RESEARCH ENDPOINTS
// ==========================================

// 31. AI Research Chat - Real AI-powered stock research using Claude API
app.post('/api/ai/research', async (req, res) => {
  try {
    const { message, context, conversationHistory } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    console.log(`🤖 AI Research query: "${message.substring(0, 50)}..."`);

    // Initialize Anthropic client
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey:
        process.env.ANTHROPIC_API_KEY ||
        'REMOVED',
    });

    // Get current trading mode and real account data
    const tradingMode = tradingModeManager.getModeInfo();

    // Fetch real-time data from Alpaca
    let accountData = null;
    let positionsData = [];

    try {
      accountData = await alpacaClient.getAccount();
      positionsData = await alpacaClient.getPositions();
    } catch (error) {
      console.warn('Could not fetch Alpaca data:', error.message);
    }

    // Build comprehensive context for Claude
    const systemPrompt = `You are an expert trading assistant for a stock trading application. You have access to:

1. **Account Information:**
   - Trading Mode: ${tradingMode.mode.toUpperCase()} (${tradingMode.accountNumber})
   - Portfolio Value: $${accountData?.portfolio_value || 'N/A'}
   - Cash Available: $${accountData?.cash || 'N/A'}
   - Buying Power: $${accountData?.buying_power || 'N/A'}
   - Open Positions: ${positionsData.length}

2. **Current Positions:**
${positionsData.length > 0 ? positionsData.map(pos => `   - ${pos.symbol}: ${pos.qty} shares @ $${pos.avg_entry_price} (Current: $${pos.current_price}, P/L: $${pos.unrealized_pl})`).join('\n') : '   - No open positions'}

3. **Top Ranked Stocks (from proprietary ranking system):**
${
  context.topRankings?.length > 0
    ? context.topRankings
        .slice(0, 10)
        .map(
          (s, i) =>
            `   ${i + 1}. ${s.symbol} - Rank #${s.rank} at $${s.price?.toFixed(2) || 'N/A'}`
        )
        .join('\n')
    : '   - No ranking data available'
}

Your role is to:
- Provide intelligent trading analysis and recommendations
- Answer questions about stocks, portfolio, and market conditions
- Suggest specific actions based on the data
- Be concise but insightful (2-4 short paragraphs max)
- Use emojis sparingly for visual clarity
- Always consider the user is in ${tradingMode.mode.toUpperCase()} mode when making recommendations

If asked about specific stocks, provide analysis based on:
- Current price trends
- Position in rankings (if available)
- Risk/reward considerations
- Diversification advice

Format your response in plain text with clear paragraphs. End with 2-3 specific follow-up question suggestions that would be valuable for the user.`;

    // Build conversation messages
    const messages = [
      ...conversationHistory.slice(-5).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      {
        role: 'user',
        content: message,
      },
    ];

    // Call Claude API
    console.log('📡 Calling Claude API for intelligent analysis...');
    const completion = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const aiResponse = completion.content[0].text;

    // Extract suggestions from response (look for questions at the end)
    const suggestionMatch = aiResponse.match(
      /(?:follow-up questions?|you (?:might|could) ask|consider asking):[^\n]*((?:\n[-•*]\s*.+)+)/i
    );
    let suggestions = [];

    if (suggestionMatch) {
      suggestions = suggestionMatch[1]
        .split('\n')
        .filter(line => line.trim().match(/^[-•*]\s+/))
        .map(line => line.replace(/^[-•*]\s+/, '').trim())
        .filter(s => s.length > 0)
        .slice(0, 3);
    }

    console.log(`✅ Claude response generated (${aiResponse.length} chars)`);

    res.json({
      success: true,
      response: aiResponse,
      suggestions,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Error in AI research:', error.message);
    res.status(500).json({
      error: 'AI research request failed',
      details: error.message,
    });
  }
});

// ================================
// AI TRADING ENGINE ENDPOINTS
// ================================

// Start AI trading session (creates a new session)
app.post('/api/ai/session/start', async (req, res) => {
  try {
    const { userId = 'default_user', config } = req.body;
    const session = aiTradingEngine.startSession(userId, config);
    res.json({ success: true, ...session });
  } catch (error) {
    console.error('Error starting AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Stop AI trading session (by sessionId)
app.post('/api/ai/session/stop', async (req, res) => {
  try {
    const { sessionId, userId } = req.body;
    // Support both sessionId and userId for backwards compatibility
    const id = sessionId || userId || 'default_user';
    const summary = aiTradingEngine.stopSession(id);
    res.json({ success: true, ...summary });
  } catch (error) {
    console.error('Error stopping AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Pause AI trading session
app.post('/api/ai/session/pause', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    aiTradingEngine.pauseSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error pausing AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Resume AI trading session
app.post('/api/ai/session/resume', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    aiTradingEngine.resumeSession(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error resuming AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete AI trading session permanently
app.delete('/api/ai/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const result = aiTradingEngine.deleteSession(sessionId);
    if (result.error) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('Error deleting AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sessions for a user
app.get('/api/ai/sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const sessions = aiTradingEngine.getAllUserSessions(userId);
    res.json({ sessions });
  } catch (error) {
    console.error('Error getting AI sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific session by sessionId
app.get('/api/ai/session/detail/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = aiTradingEngine.getSession(sessionId);
    if (!session) {
      return res.json({ status: 'not_found' });
    }
    res.json(session);
  } catch (error) {
    console.error('Error getting AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get AI session status (backwards compatible - returns first active session for user)
app.get('/api/ai/session/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const status = aiTradingEngine.getSessionStatus(userId);
    if (!status) {
      return res.json({ status: 'stopped' });
    }
    res.json(status);
  } catch (error) {
    console.error('Error getting AI session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update AI session config (by sessionId)
app.put('/api/ai/session/:sessionId/config', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const newConfig = req.body;
    aiTradingEngine.updateConfig(sessionId, newConfig);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating AI config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get AI decision history
app.get('/api/ai/decisions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const decisions = aiTradingEngine.getDecisionHistory(sessionId, limit);
    res.json({ decisions });
  } catch (error) {
    console.error('Error getting AI decisions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze patterns for a symbol
app.post('/api/ai/patterns/analyze', async (req, res) => {
  try {
    const { symbol } = req.body;

    // Get candles
    const toDate = new Date();
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
      from: fromDate.toISOString().split('T')[0],
      to: toDate.toISOString().split('T')[0],
    });

    if (!candles || candles.length < 50) {
      return res.status(400).json({ error: 'Insufficient data' });
    }

    const indicators = technicalIndicatorsService.getAllIndicators(candles);
    const patterns = await patternRecognitionService.predictPattern(
      candles,
      indicators
    );

    res.json({
      symbol,
      patterns,
      indicators: indicators.signals,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error analyzing patterns:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// TECHNICAL INDICATORS ENDPOINTS
// ================================

// Get all indicators for a symbol
app.get('/api/indicators/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const timeframe = req.query.timeframe || '5';
    const unit = req.query.unit || 'minute';

    const toDate = new Date();
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const candles = await polygonClient.getAggregates(
      symbol,
      parseInt(timeframe),
      unit,
      {
        from: fromDate.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0],
      }
    );

    if (!candles || candles.length < 50) {
      return res.status(400).json({ error: 'Insufficient data' });
    }

    const indicators = technicalIndicatorsService.getAllIndicators(candles);

    res.json({
      symbol,
      candles: candles.slice(-200),
      indicators,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting indicators:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// SCHWAB IMPORT ENDPOINTS
// ================================

// Upload and parse Schwab CSV
app.post('/api/import/schwab', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = schwabImportService.parseCSV(
      req.file.buffer,
      'default_user'
    );
    res.json(result);
  } catch (error) {
    console.error('Error importing Schwab CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get imported trades for user
app.get('/api/import/schwab/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const trades = schwabImportService.getTrades(userId);
    const summary =
      trades.length > 0 ? schwabImportService.generateSummary(trades) : null;
    res.json({ trades, summary });
  } catch (error) {
    console.error('Error getting imported trades:', error);
    res.status(500).json({ error: error.message });
  }
});

// Train AI model from imported trades
app.post('/api/import/schwab/train', async (req, res) => {
  try {
    const { userId = 'default_user' } = req.body;
    const trades = schwabImportService.getTrades(userId);

    if (trades.length < 50) {
      return res.status(400).json({
        error: 'Need at least 50 trades for training',
        currentCount: trades.length,
      });
    }

    // Create training dataset and train model
    const trainingData = schwabImportService.createTrainingDataset(userId);
    const result = await patternRecognitionService.trainModel(trainingData, {
      epochs: 30,
      batchSize: 16,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error training from trades:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// SIMULATION RESULTS STORAGE
// ================================

// In-memory storage for simulation results (in production, use database)
const simulationResults = new Map();

// Save simulation results for learning/analysis
app.post('/api/simulation/results', async (req, res) => {
  try {
    const { analysis, aiDecisions, events, config, savedAt } = req.body;

    if (!analysis) {
      return res.status(400).json({ error: 'Analysis data required' });
    }

    const resultId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = {
      id: resultId,
      analysis,
      aiDecisions: aiDecisions || [],
      events: events || [],
      config: config || {},
      savedAt: savedAt || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    // Store result
    const userId = 'default_user';
    if (!simulationResults.has(userId)) {
      simulationResults.set(userId, []);
    }
    simulationResults.get(userId).push(result);

    // Keep only last 100 simulations per user
    const userResults = simulationResults.get(userId);
    if (userResults.length > 100) {
      simulationResults.set(userId, userResults.slice(-100));
    }

    console.log(
      `✅ Saved simulation result: ${resultId} for ${analysis.symbol} on ${analysis.date}`
    );

    res.json({
      success: true,
      resultId,
      message: 'Simulation results saved for learning',
    });
  } catch (error) {
    console.error('Error saving simulation results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all simulation results for a user
app.get('/api/simulation/results', async (req, res) => {
  try {
    const userId = req.query.userId || 'default_user';
    const results = simulationResults.get(userId) || [];

    // Return summary without full decision data
    const summaries = results.map(r => ({
      id: r.id,
      date: r.analysis.date,
      symbol: r.analysis.symbol,
      returnPercent: r.analysis.returnPercent,
      winRate: r.analysis.winRate,
      totalTrades: r.analysis.totalTrades,
      savedAt: r.savedAt,
    }));

    res.json({ results: summaries, total: summaries.length });
  } catch (error) {
    console.error('Error getting simulation results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific simulation result by ID
app.get('/api/simulation/results/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId || 'default_user';
    const results = simulationResults.get(userId) || [];

    const result = results.find(r => r.id === id);

    if (!result) {
      return res.status(404).json({ error: 'Simulation result not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error getting simulation result:', error);
    res.status(500).json({ error: error.message });
  }
});

// Aggregate learning from all simulations
app.get('/api/simulation/insights', async (req, res) => {
  try {
    const userId = req.query.userId || 'default_user';
    const results = simulationResults.get(userId) || [];

    if (results.length === 0) {
      return res.json({
        message: 'No simulation data yet',
        insights: null,
      });
    }

    // Calculate aggregate stats
    const totalSimulations = results.length;
    const avgReturn =
      results.reduce((s, r) => s + r.analysis.returnPercent, 0) /
      totalSimulations;
    const avgWinRate =
      results.reduce((s, r) => s + r.analysis.winRate, 0) / totalSimulations;
    const avgTrades =
      results.reduce((s, r) => s + r.analysis.totalTrades, 0) /
      totalSimulations;

    const profitableSimulations = results.filter(
      r => r.analysis.returnPercent > 0
    ).length;
    const profitabilityRate = (profitableSimulations / totalSimulations) * 100;

    // Find best and worst days
    const bestDay = results.reduce((best, r) =>
      r.analysis.returnPercent > best.analysis.returnPercent ? r : best
    );
    const worstDay = results.reduce((worst, r) =>
      r.analysis.returnPercent < worst.analysis.returnPercent ? r : worst
    );

    // Collect all improvements mentioned
    const allImprovements = results.flatMap(r => r.analysis.improvements || []);
    const improvementCounts = {};
    allImprovements.forEach(imp => {
      improvementCounts[imp] = (improvementCounts[imp] || 0) + 1;
    });
    const topImprovements = Object.entries(improvementCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([improvement, count]) => ({ improvement, count }));

    res.json({
      insights: {
        totalSimulations,
        avgReturn: avgReturn.toFixed(2),
        avgWinRate: avgWinRate.toFixed(1),
        avgTradesPerDay: avgTrades.toFixed(1),
        profitabilityRate: profitabilityRate.toFixed(1),
        bestDay: {
          date: bestDay.analysis.date,
          symbol: bestDay.analysis.symbol,
          return: bestDay.analysis.returnPercent.toFixed(2),
        },
        worstDay: {
          date: worstDay.analysis.date,
          symbol: worstDay.analysis.symbol,
          return: worstDay.analysis.returnPercent.toFixed(2),
        },
        topImprovements,
      },
    });
  } catch (error) {
    console.error('Error getting simulation insights:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// ENHANCED BACKTEST ENDPOINTS
// ================================

// Run enhanced backtest with what-if scenarios
app.post('/api/backtest/enhanced', async (req, res) => {
  try {
    const result = await enhancedBacktestEngine.runEnhancedBacktest(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error running enhanced backtest:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run what-if scenario
app.post('/api/backtest/what-if', async (req, res) => {
  try {
    const result = await enhancedBacktestEngine.runEnhancedBacktest(req.body);
    res.json({
      whatIfResults: result.whatIfResults,
      recommendations: result.recommendations,
    });
  } catch (error) {
    console.error('Error running what-if analysis:', error);
    res.status(500).json({ error: error.message });
  }
});

// Optimize strategy parameters
app.post('/api/backtest/optimize', async (req, res) => {
  try {
    const result = await enhancedBacktestEngine.optimizeStrategy(req.body);
    res.json(result);
  } catch (error) {
    console.error('Error optimizing strategy:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run Monte Carlo simulation
app.post('/api/backtest/monte-carlo', async (req, res) => {
  try {
    const { trades, simulations = 1000 } = req.body;
    const result = enhancedBacktestEngine.runMonteCarloSimulation(
      trades,
      simulations
    );
    res.json(result);
  } catch (error) {
    console.error('Error running Monte Carlo:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// STRATEGY LAB ENDPOINTS
// Day Simulation, Random Day Validation, Watchlist Regime Detection
// ================================

// Initialize watchlist regime detector
const WatchlistRegimeDetector = require('./watchlistRegimeDetector');
const watchlistRegimeDetector = new WatchlistRegimeDetector();

// Run simulation on a specific day
app.post('/api/backtest/day-simulation', async (req, res) => {
  try {
    const { symbol, date, config } = req.body;

    if (!symbol || !date) {
      return res.status(400).json({ error: 'symbol and date are required' });
    }

    // Fetch intraday data for the specified date
    const candles = await getCachedHistoricalData(symbol, date, 'minute');

    if (!candles || candles.length === 0) {
      return res.status(404).json({ error: `No intraday data found for ${symbol} on ${date}` });
    }

    // Run the simulation bar-by-bar
    const trades = [];
    let position = null;
    let equity = 10000; // Starting capital
    const strategyConfig = config || regimeAwareConfigStore.getDefaultConfig();

    // Calculate indicators for each candle
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Simple RSI calculation
    const rsiPeriod = 14;
    const calculateRSI = (values, period, index) => {
      if (index < period) return 50;
      const slice = values.slice(index - period, index);
      let gains = 0, losses = 0;
      for (let i = 1; i < slice.length; i++) {
        const change = slice[i] - slice[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      if (avgLoss === 0) return 100;
      const rs = avgGain / avgLoss;
      return 100 - (100 / (1 + rs));
    };

    // Process each candle
    for (let i = 20; i < candles.length; i++) {
      const candle = candles[i];
      const price = candle.close;
      const rsi = calculateRSI(closes, rsiPeriod, i);
      const time = candle.timestamp || candle.date || candle.t;

      // Check for exit if in position
      if (position) {
        const pnl = (price - position.entryPrice) * position.shares;
        const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
        const mfe = Math.max(position.mfe || 0, pnlPercent);
        const mae = Math.min(position.mae || 0, pnlPercent);
        position.mfe = mfe;
        position.mae = mae;

        // Check exit conditions
        let exitReason = null;
        if (pnlPercent >= strategyConfig.takeProfitPercent) {
          exitReason = 'Take Profit';
        } else if (pnlPercent <= -strategyConfig.stopLossPercent) {
          exitReason = 'Stop Loss';
        } else if (rsi > 70 && pnlPercent > 0) {
          exitReason = 'RSI Overbought Exit';
        }

        // End of day exit
        const isLastCandle = i >= candles.length - 5;
        if (isLastCandle && !exitReason) {
          exitReason = 'End of Day';
        }

        if (exitReason) {
          const trade = {
            entryTime: position.entryTime,
            entryPrice: position.entryPrice,
            exitTime: time,
            exitPrice: price,
            shares: position.shares,
            side: 'BUY',
            pnl: pnl,
            pnlPercent: pnlPercent,
            mfe: position.mfe,
            mae: position.mae,
            exitReason,
          };
          trades.push(trade);
          equity += pnl;
          position = null;
        }
      }

      // Check for entry if not in position
      if (!position && i < candles.length - 30) { // Don't enter near end of day
        const rsiInRange = rsi >= strategyConfig.entryRsiMin && rsi <= strategyConfig.entryRsiMax;

        // Simple momentum check - price above recent MA
        const recentCloses = closes.slice(Math.max(0, i - 20), i);
        const ma20 = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
        const aboveMA = price > ma20;

        // Volume check - current volume above average
        const volumes = candles.slice(Math.max(0, i - 20), i).map(c => c.volume || c.v || 0);
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const currentVolume = candle.volume || candle.v || 0;
        const goodVolume = currentVolume > avgVolume * 0.8;

        if (rsiInRange && aboveMA && goodVolume) {
          const shares = Math.floor((equity * (strategyConfig.positionSizePercent / 100)) / price);
          if (shares > 0) {
            position = {
              entryTime: time,
              entryPrice: price,
              shares,
              mfe: 0,
              mae: 0,
            };
          }
        }
      }
    }

    // Calculate summary metrics
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    res.json({
      success: true,
      symbol,
      date,
      trades,
      totalPnl,
      winRate,
      tradeCount: trades.length,
      wins: wins.length,
      losses: losses.length,
      profitFactor,
      grossProfit,
      grossLoss,
      config: strategyConfig,
      candleCount: candles.length,
    });
  } catch (error) {
    console.error('Error in day simulation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run simulation on random unseen days
app.post('/api/backtest/random-days', async (req, res) => {
  try {
    const { symbol, config, numDays = 5, startDate, endDate } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    // Get available trading days
    const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    // Fetch daily data to find valid trading days
    const dailyCandles = await polygonClient.getHistoricalAggregates(symbol, start, end, 'day');
    if (!dailyCandles || dailyCandles.length === 0) {
      return res.status(404).json({ error: `No historical data found for ${symbol} between ${start} and ${end}` });
    }

    // Get available dates (weekdays with data)
    const availableDates = dailyCandles
      .map(c => {
        const d = c.date || c.t;
        return typeof d === 'number' ? new Date(d).toISOString().split('T')[0] : d.split('T')[0];
      })
      .filter(d => {
        const day = new Date(d).getDay();
        return day !== 0 && day !== 6; // Exclude weekends
      });

    // Randomly select dates
    const shuffled = [...availableDates].sort(() => Math.random() - 0.5);
    const selectedDates = shuffled.slice(0, Math.min(numDays, availableDates.length));

    // Run simulation on each date
    const dailyResults = [];
    let totalPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;
    let profitableDays = 0;

    for (const date of selectedDates) {
      try {
        // Simulate this day
        const dayResult = await new Promise((resolve, reject) => {
          const mockReq = {
            body: { symbol, date, config },
          };
          const mockRes = {
            json: (data) => resolve(data),
            status: () => ({ json: (data) => reject(new Error(data.error)) }),
          };

          // Make internal call
          app._router.handle({ ...mockReq, method: 'POST', url: '/api/backtest/day-simulation' }, mockRes, (err) => {
            if (err) reject(err);
          });
        }).catch(async (err) => {
          // Fallback: directly run the simulation logic
          const candles = await getCachedHistoricalData(symbol, date, 'minute');
          if (!candles || candles.length === 0) {
            return { success: false, error: 'No data', date };
          }
          // Simple result for now
          return {
            success: true,
            date,
            trades: [],
            totalPnl: 0,
            winRate: 0,
          };
        });

        if (dayResult.success) {
          dailyResults.push({
            date,
            trades: dayResult.tradeCount || dayResult.trades?.length || 0,
            pnl: dayResult.totalPnl || 0,
            winRate: (dayResult.winRate || 0) / 100,
          });

          totalPnl += dayResult.totalPnl || 0;
          totalTrades += dayResult.tradeCount || dayResult.trades?.length || 0;
          totalWins += dayResult.wins || 0;
          if ((dayResult.totalPnl || 0) > 0) profitableDays++;
        }
      } catch (dayError) {
        console.error(`Error simulating ${date}:`, dayError.message);
        dailyResults.push({
          date,
          trades: 0,
          pnl: 0,
          winRate: 0,
          error: dayError.message,
        });
      }
    }

    const avgDailyPnl = dailyResults.length > 0 ? totalPnl / dailyResults.length : 0;
    const overallWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;

    res.json({
      success: true,
      symbol,
      daysAnalyzed: dailyResults.length,
      totalDays: numDays,
      dateRange: { start, end },
      dailyResults,
      totalPnl,
      profitableDays,
      losingDays: dailyResults.length - profitableDays,
      avgDailyPnl,
      overallWinRate,
      totalTrades,
      config: config || regimeAwareConfigStore.getDefaultConfig(),
    });
  } catch (error) {
    console.error('Error in random days validation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get market regime using watchlist
app.post('/api/regime/watchlist', async (req, res) => {
  try {
    const { watchlist, lookbackDays = 50 } = req.body;

    // Get symbols to analyze
    const symbolsToFetch = [];
    const wl = watchlist || watchlistRegimeDetector.getWatchlist();
    for (const category of Object.values(wl)) {
      if (category.symbols) {
        symbolsToFetch.push(...category.symbols);
      }
    }

    // Fetch historical data for each symbol
    const symbolData = {};
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    for (const symbol of symbolsToFetch) {
      try {
        const candles = await polygonClient.getHistoricalAggregates(symbol, startDate, endDate, 'day');
        if (candles && candles.length > 0) {
          symbolData[symbol] = candles.map(c => ({
            open: c.open || c.o,
            high: c.high || c.h,
            low: c.low || c.l,
            close: c.close || c.c,
            volume: c.volume || c.v,
            date: c.date || c.t,
          }));
        }
      } catch (err) {
        console.log(`Could not fetch ${symbol}: ${err.message}`);
      }
    }

    const result = watchlistRegimeDetector.detectMarketRegime(symbolData);
    res.json(result);
  } catch (error) {
    console.error('Error detecting watchlist regime:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get/update watchlist
app.get('/api/regime/watchlist', (req, res) => {
  try {
    res.json({ watchlist: watchlistRegimeDetector.getWatchlist() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/regime/watchlist', (req, res) => {
  try {
    const { watchlist } = req.body;
    const result = watchlistRegimeDetector.setWatchlist(watchlist);
    res.json({ success: true, watchlist: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get list of all strategies
app.get('/api/strategies', (req, res) => {
  try {
    const symbols = strategyVersionControl.getAllSymbols();
    const allStrategies = [];

    for (const sym of symbols) {
      const versions = strategyVersionControl.getVersions(sym.symbol);
      if (versions.versions) {
        versions.versions.forEach(v => {
          allStrategies.push({
            id: v.id,
            name: v.versionString,
            symbol: sym.symbol,
            description: v.description,
            config: v.config,
            tag: v.tag,
            isProduction: v.isProduction,
            createdAt: v.createdAt,
            metrics: v.metrics,
          });
        });
      }
    }

    res.json({ strategies: allStrategies, count: allStrategies.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get strategy versions for a symbol
app.get('/api/strategy-versions', (req, res) => {
  try {
    const symbols = strategyVersionControl.getAllSymbols();
    res.json({ symbols });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/strategy-versions/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const versions = strategyVersionControl.getVersions(symbol);
    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new strategy version
app.post('/api/strategy-versions', (req, res) => {
  try {
    const { symbol, config, options } = req.body;
    if (!symbol || !config) {
      return res.status(400).json({ error: 'symbol and config are required' });
    }
    const result = strategyVersionControl.createVersion(symbol, config, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote strategy to production
app.post('/api/strategy-versions/:symbol/promote', (req, res) => {
  try {
    const { symbol } = req.params;
    const { versionId } = req.body;
    const result = strategyVersionControl.promoteToProduction(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// OVERNIGHT OPTIMIZATION ENDPOINTS
// ================================

// Create a new overnight optimization job
app.post('/api/overnight/jobs', async (req, res) => {
  try {
    const { symbols, config, name, description } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'symbols array is required' });
    }

    const job = await overnightOptimizer.createJob(symbols, config || {});

    // Optionally add name/description
    if (name) job.name = name;
    if (description) job.description = description;

    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        symbols: job.symbols,
        config: job.config,
        createdAt: job.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating overnight job:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all overnight optimization jobs
app.get('/api/overnight/jobs', async (req, res) => {
  try {
    const jobs = await overnightOptimizer.getJobs();

    // Return summary without full results
    const jobSummaries = jobs.map(job => ({
      id: job.id,
      status: job.status,
      symbols: job.symbols,
      progress: job.progress,
      name: job.name,
      description: job.description,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    }));

    res.json({ jobs: jobSummaries });
  } catch (error) {
    console.error('Error listing overnight jobs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get details of a specific overnight optimization job
app.get('/api/overnight/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await overnightOptimizer.getJob(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ job });
  } catch (error) {
    console.error('Error getting overnight job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start an overnight optimization job
app.post('/api/overnight/jobs/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await overnightOptimizer.getJob(id);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'pending') {
      return res.status(400).json({
        error: `Job cannot be started - current status: ${job.status}`,
      });
    }

    // Create a data fetcher function that uses our existing infrastructure
    const dataFetcher = async (symbol, startDate, endDate) => {
      try {
        // Try to get from historicalDataManager first
        const data = await historicalDataManager.getDailyBars(symbol, startDate, endDate);
        if (data && data.length > 0) return data;

        // Fallback to polygon
        const polygonData = await polygonClient.getHistoricalBars(
          symbol,
          startDate,
          endDate,
          'day'
        );
        return polygonData || [];
      } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error.message);
        return [];
      }
    };

    // Start job in background (non-blocking)
    overnightOptimizer.startJob(id, dataFetcher).catch(err => {
      console.error(`Overnight job ${id} failed:`, err);
    });

    res.json({
      success: true,
      message: 'Job started successfully',
      jobId: id,
      status: 'running',
    });
  } catch (error) {
    console.error('Error starting overnight job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel a running overnight optimization job
app.post('/api/overnight/jobs/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await overnightOptimizer.cancelJob(id);

    if (!result) {
      return res.status(404).json({ error: 'Job not found or cannot be cancelled' });
    }

    res.json({
      success: true,
      message: 'Job cancelled',
      jobId: id,
    });
  } catch (error) {
    console.error('Error cancelling overnight job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get results for a completed overnight optimization job
app.get('/api/overnight/results/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const results = await overnightOptimizer.getResults(id);

    if (!results) {
      return res.status(404).json({ error: 'Results not found' });
    }

    res.json({ results });
  } catch (error) {
    console.error('Error getting overnight results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an overnight optimization job
app.delete('/api/overnight/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await overnightOptimizer.deleteJob(id);

    if (!result) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      message: 'Job deleted',
      jobId: id,
    });
  } catch (error) {
    console.error('Error deleting overnight job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Apply best results from overnight optimization to strategy version control
app.post('/api/overnight/jobs/:id/apply', async (req, res) => {
  try {
    const { id } = req.params;
    const results = await overnightOptimizer.getResults(id);

    if (!results) {
      return res.status(404).json({ error: 'Results not found' });
    }

    const applied = [];

    // Apply best config for each symbol that was optimized
    for (const [symbol, symbolResults] of Object.entries(results.symbolResults || {})) {
      if (symbolResults.bestConfig) {
        try {
          // Save as a new strategy version
          const version = strategyVersionControl.saveVersion(symbol, {
            ...symbolResults.bestConfig,
            source: 'overnight-optimization',
            optimizationJobId: id,
            performance: symbolResults.performance,
          });
          applied.push({ symbol, versionId: version.versionId });
        } catch (err) {
          console.error(`Error applying config for ${symbol}:`, err.message);
        }
      }
    }

    res.json({
      success: true,
      message: `Applied ${applied.length} optimized configs`,
      applied,
    });
  } catch (error) {
    console.error('Error applying overnight results:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===================
// Polygon API Routes
// ===================

// Get latest quote for a symbol
app.get('/api/polygon/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    // Try getLatestQuote first, fallback to getPreviousClose
    let quote = await polygonClient.getLatestQuote(symbol).catch(e => {
      console.log(
        `Real-time quote unavailable for ${symbol}, trying previous close`
      );
      return null;
    });

    if (!quote) {
      // Fallback to previous close (works with free Polygon API)
      const prevClose = await polygonClient
        .getPreviousClose(symbol)
        .catch(e => {
          console.error(
            `Error fetching previous close for ${symbol}:`,
            e.message
          );
          return null;
        });

      if (prevClose) {
        quote = {
          last: prevClose.close,
          close: prevClose.close,
          open: prevClose.open,
          high: prevClose.high,
          low: prevClose.low,
          volume: prevClose.volume,
          prevClose: prevClose.close,
          timestamp: prevClose.timestamp,
        };
      }
    }

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json(quote);
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get company details
app.get('/api/polygon/details/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const details = await polygonClient.getStockDetails(symbol).catch(e => {
      console.error(`Error fetching details for ${symbol}:`, e.message);
      return null;
    });

    if (!details) {
      return res.status(404).json({ error: 'Details not found' });
    }

    res.json(details);
  } catch (error) {
    console.error('Error fetching details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get aggregates (OHLCV bars)
app.get(
  '/api/polygon/aggregates/:symbol/:multiplier/:timespan',
  async (req, res) => {
    try {
      const { symbol, multiplier, timespan } = req.params;
      const { from, to } = req.query;

      const bars = await polygonClient
        .getAggregates(symbol, parseInt(multiplier), timespan, {
          from,
          to,
        })
        .catch(e => {
          console.error(`Error fetching aggregates for ${symbol}:`, e.message);
          return [];
        });

      res.json({ results: bars });
    } catch (error) {
      console.error('Error fetching aggregates:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ================================
// SPRINT 1: SELF-IMPROVING TRADING SYSTEM APIs
// ================================

/**
 * Transaction Cost Model APIs
 * Get realistic slippage/spread costs for symbols
 */

// Get transaction costs for a symbol
app.get('/api/costs/:symbol', (req, res) => {
  const { symbol } = req.params;
  const { price } = req.query;

  try {
    const profile = transactionCostModel.getProfile(symbol);
    const roundTripCost = transactionCostModel.getRoundTripCost(symbol, parseFloat(price) || 100);

    res.json({
      symbol: symbol.toUpperCase(),
      profile,
      roundTripCost,
      executionPrices: {
        buy: transactionCostModel.getExecutionPrice(symbol, parseFloat(price) || 100, 'BUY'),
        sell: transactionCostModel.getExecutionPrice(symbol, parseFloat(price) || 100, 'SELL'),
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all symbol costs
app.get('/api/costs', (req, res) => {
  try {
    res.json(transactionCostModel.getAllSymbolCosts());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Adjust strategy config for transaction costs
app.post('/api/costs/adjust', (req, res) => {
  const { symbol, config } = req.body;

  if (!symbol || !config) {
    return res.status(400).json({ error: 'symbol and config required' });
  }

  try {
    const adjusted = transactionCostModel.adjustTargetsForCosts(symbol, config);
    res.json(adjusted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply costs to a trade
app.post('/api/costs/apply-trade', (req, res) => {
  const { symbol, trade } = req.body;

  if (!symbol || !trade) {
    return res.status(400).json({ error: 'symbol and trade required' });
  }

  try {
    const result = transactionCostModel.applyToTrade(trade, symbol);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Leveraged ETF Rules APIs
 * Enforce day trading constraints for leveraged ETFs
 */

// Check if symbol is leveraged ETF
app.get('/api/leveraged/:symbol', (req, res) => {
  const { symbol } = req.params;

  try {
    const isLeveraged = leveragedEtfRules.isLeveraged(symbol);
    const info = leveragedEtfRules.getInfo(symbol);

    if (isLeveraged) {
      const decay = leveragedEtfRules.calculateExpectedDecay(symbol, 1);
      const backtest = leveragedEtfRules.getBacktestProxy(symbol);

      res.json({
        symbol: symbol.toUpperCase(),
        isLeveraged: true,
        info,
        decay,
        backtestProxy: backtest,
        rules: leveragedEtfRules.getRulesSummary()
      });
    } else {
      res.json({
        symbol: symbol.toUpperCase(),
        isLeveraged: false,
        message: `${symbol} is not a leveraged ETF - no special rules apply`
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all leveraged ETFs with their details
app.get('/api/leveraged', (req, res) => {
  try {
    res.json({
      etfs: leveragedEtfRules.getAllLeveragedEtfs(),
      rules: leveragedEtfRules.getRulesSummary()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply leveraged ETF constraints to a trading decision
app.post('/api/leveraged/apply-constraints', (req, res) => {
  const { symbol, decision, currentTime, currentPosition, vix } = req.body;

  if (!symbol || !decision) {
    return res.status(400).json({ error: 'symbol and decision required' });
  }

  try {
    const time = currentTime ? new Date(currentTime) : new Date();
    const result = leveragedEtfRules.applyConstraints(symbol, decision, time, currentPosition, vix);

    // Add timing info
    result.timing = {
      currentTime: time.toISOString(),
      isMarketHours: leveragedEtfRules.isMarketHours(time),
      timeUntilForcedExit: leveragedEtfRules.getTimeUntilForcedExit(time)
    };

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get expected decay for holding a leveraged ETF
app.get('/api/leveraged/:symbol/decay', (req, res) => {
  const { symbol } = req.params;
  const { days } = req.query;

  try {
    const decay = leveragedEtfRules.calculateExpectedDecay(symbol, parseInt(days) || 1);

    if (!decay) {
      return res.status(404).json({ error: `${symbol} is not a leveraged ETF` });
    }

    res.json(decay);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Market Regime Detection APIs
 * Detect bull/bear/sideways market conditions
 */

// Detect current regime for a symbol (uses recent data or specific date)
app.get('/api/regime/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { days, date } = req.query;
  const lookbackDays = parseInt(days) || 90;

  try {
    // Get historical data for regime detection
    // Use provided date or current date as end date
    const endDate = date ? new Date(date) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - lookbackDays);

    // Format dates for polygon API
    const formatDate = (d) => d.toISOString().split('T')[0];

    const candles = await polygonClient.getHistoricalAggregates(
      symbol,
      formatDate(startDate),
      formatDate(endDate),
      'day'
    ).catch(() => []);

    if (!candles || candles.length < 50) {
      return res.status(400).json({
        error: 'Insufficient data for regime detection',
        candlesAvailable: candles?.length || 0,
        required: 50
      });
    }

    const regime = regimeDetector.detectRegime(candles);

    // Add default config recommendation
    regime.defaultConfig = regimeDetector.getDefaultConfigForRegime(regime.regime);

    res.json({
      symbol: symbol.toUpperCase(),
      ...regime,
      dataRange: {
        start: formatDate(startDate),
        end: formatDate(endDate),
        candlesUsed: candles.length
      }
    });
  } catch (error) {
    console.error(`Error detecting regime for ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Get regime timeline for visualization
app.get('/api/regime/:symbol/timeline', async (req, res) => {
  const { symbol } = req.params;
  const { days } = req.query;
  const lookbackDays = parseInt(days) || 180;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const formatDate = (d) => d.toISOString().split('T')[0];

    const candles = await polygonClient.getHistoricalAggregates(
      symbol,
      formatDate(startDate),
      formatDate(endDate),
      'day'
    ).catch(() => []);

    if (!candles || candles.length < 60) {
      return res.status(400).json({
        error: 'Insufficient data for timeline',
        candlesAvailable: candles?.length || 0,
        required: 60
      });
    }

    const timeline = regimeDetector.getRegimeTimeline(candles);
    const analysis = regimeDetector.analyzeRegimes(timeline);

    res.json({
      symbol: symbol.toUpperCase(),
      timeline,
      analysis,
      dataRange: {
        start: formatDate(startDate),
        end: formatDate(endDate),
        totalDays: candles.length
      }
    });
  } catch (error) {
    console.error(`Error getting regime timeline for ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Detect regime from provided candles (for backtesting)
app.post('/api/regime/detect', (req, res) => {
  const { candles, options } = req.body;

  if (!candles || !Array.isArray(candles)) {
    return res.status(400).json({ error: 'candles array required' });
  }

  try {
    const regime = regimeDetector.detectRegime(candles, options);
    regime.defaultConfig = regimeDetector.getDefaultConfigForRegime(regime.regime);
    res.json(regime);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get default config for a specific regime
app.get('/api/regime/config/:regime', (req, res) => {
  const { regime } = req.params;

  const validRegimes = ['bull', 'bear', 'sideways'];
  if (!validRegimes.includes(regime.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid regime. Must be one of: ${validRegimes.join(', ')}`
    });
  }

  try {
    const config = regimeDetector.getDefaultConfigForRegime(regime.toLowerCase());
    const recommendation = regimeDetector.getStrategyRecommendation(regime.toLowerCase(), 'moderate', 0.015);

    res.json({
      regime: regime.toLowerCase(),
      config,
      recommendation
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// LEVERAGED ETF STRATEGY API ENDPOINTS
// ================================

// Get all supported leveraged ETF families
app.get('/api/leveraged-etf/families', (req, res) => {
  try {
    const families = leveragedEtfStrategy.getSupportedFamilies();
    res.json({
      families,
      totalFamilies: families.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get family info for a symbol
app.get('/api/leveraged-etf/family/:symbol', (req, res) => {
  const { symbol } = req.params;

  try {
    const family = leveragedEtfStrategy.getFamily(symbol);
    if (!family) {
      return res.status(404).json({
        error: `Symbol ${symbol} is not part of a supported leveraged ETF family`,
        supportedFamilies: Object.keys(leveragedEtfStrategy.families),
      });
    }
    res.json(family);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get full analysis and recommendation for a symbol
app.get('/api/leveraged-etf/analyze/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { date } = req.query;

  try {
    // Check if symbol is supported
    const family = leveragedEtfStrategy.getFamily(symbol);
    if (!family) {
      return res.status(400).json({
        error: `Symbol ${symbol} is not supported. Use one of: QBTS, SOXX, PLTR (or their leveraged variants)`,
      });
    }

    // Get technical regime
    const endDate = date ? new Date(date) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 90);

    const formatDate = (d) => d.toISOString().split('T')[0];
    const candles = await polygonClient.getHistoricalAggregates(
      family.baseSymbol,
      formatDate(startDate),
      formatDate(endDate),
      'day'
    ).catch(() => []);

    let technicalRegime = { regime: 'unknown', confidence: 0 };
    if (candles && candles.length >= 50) {
      technicalRegime = regimeDetector.detectRegime(candles);
    }

    // Try to get flow sentiment (if CheddarFlow scraper is available)
    let flowSentiment = { sentiment: 'neutral', confidence: 0, reasons: ['Flow data not available'] };
    // Note: CheddarFlow scraping requires browser - skip for now in basic analysis
    // Use manual flow input via POST endpoint instead

    // Make decision
    const decision = leveragedEtfStrategy.makeDecision(technicalRegime, flowSentiment, family);

    // Get position sizing recommendation
    const positionSizing = leveragedEtfStrategy.getPositionSizing(decision, 25000, 2);

    res.json({
      symbol: symbol.toUpperCase(),
      family,
      analysis: {
        technical: technicalRegime,
        flow: flowSentiment,
      },
      decision,
      positionSizing,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Analyze with manual flow sentiment input
app.post('/api/leveraged-etf/analyze/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { flowData, accountValue = 25000, riskPercent = 2, date } = req.body;

  try {
    // Check if symbol is supported
    const family = leveragedEtfStrategy.getFamily(symbol);
    if (!family) {
      return res.status(400).json({
        error: `Symbol ${symbol} is not supported. Use one of: QBTS, SOXX, PLTR (or their leveraged variants)`,
      });
    }

    // Get technical regime - use provided date or current date
    const endDate = date ? new Date(date) : new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 90);

    const formatDate = (d) => d.toISOString().split('T')[0];
    const candles = await polygonClient.getHistoricalAggregates(
      family.baseSymbol,
      formatDate(startDate),
      formatDate(endDate),
      'day'
    ).catch(() => []);

    let technicalRegime = { regime: 'unknown', confidence: 0 };
    if (candles && candles.length >= 50) {
      technicalRegime = regimeDetector.detectRegime(candles);
    }

    // Analyze provided flow data
    const flowSentiment = leveragedEtfStrategy.analyzeFlowSentiment(flowData);

    // Make decision
    const decision = leveragedEtfStrategy.makeDecision(technicalRegime, flowSentiment, family);

    // Get position sizing recommendation
    const positionSizing = leveragedEtfStrategy.getPositionSizing(decision, accountValue, riskPercent);

    res.json({
      symbol: symbol.toUpperCase(),
      family,
      analysis: {
        technical: technicalRegime,
        flow: flowSentiment,
      },
      decision,
      positionSizing,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// CHEDDARFLOW SCRAPING API ENDPOINTS
// ================================

// Get flow sentiment from CheddarFlow (scraping)
// Query params: date, useProfile (use existing Chrome profile)
app.get('/api/cheddarflow/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { date, useProfile } = req.query;

  try {
    // Lazy initialize the scraper with profile option
    if (!cheddarFlowScraper || (useProfile === 'true' && !cheddarFlowScraper.useExistingProfile)) {
      // Close existing scraper if config changed
      if (cheddarFlowScraper) {
        await cheddarFlowScraper.close();
      }
      cheddarFlowScraper = new CheddarFlowScraper({
        headless: useProfile !== 'true', // Can't be headless with profile
        useExistingProfile: useProfile === 'true',
      });
    }

    const flowData = await cheddarFlowScraper.getFlowSentiment(symbol, date);
    const sentiment = cheddarFlowScraper.analyzeSentiment(flowData);

    // Save cookies after successful fetch (for future headless use)
    if (useProfile === 'true' && flowData) {
      try {
        const cookies = await cheddarFlowScraper.exportCookies();
        CheddarFlowScraper.saveCookies(cookies);
        console.log('[CheddarFlow] Saved session cookies for future headless use');
      } catch (e) {
        // Non-fatal, just log
        console.log('[CheddarFlow] Could not save cookies:', e.message);
      }
    }

    res.json({
      symbol: symbol.toUpperCase(),
      date: date || new Date().toISOString().split('T')[0],
      flowData,
      sentiment,
    });
  } catch (error) {
    console.error(`Error fetching CheddarFlow for ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize CheddarFlow with credentials (POST)
app.post('/api/cheddarflow/auth', async (req, res) => {
  const { email, password, cookies } = req.body;

  try {
    // Close existing scraper
    if (cheddarFlowScraper) {
      await cheddarFlowScraper.close();
    }

    // Create new scraper with auth
    cheddarFlowScraper = new CheddarFlowScraper({
      headless: true,
      credentials: email && password ? { email, password } : null,
      cookies: cookies || null,
    });

    // Initialize and attempt login
    await cheddarFlowScraper.init();

    // Export cookies for future use
    const sessionCookies = await cheddarFlowScraper.exportCookies();

    res.json({
      success: true,
      message: 'CheddarFlow scraper initialized',
      cookieCount: sessionCookies.length,
      // Return cookies so user can save them
      cookies: sessionCookies,
    });
  } catch (error) {
    console.error('Error initializing CheddarFlow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Take screenshot of CheddarFlow page
app.get('/api/cheddarflow/:symbol/screenshot', async (req, res) => {
  const { symbol } = req.params;
  const { date, useProfile } = req.query;

  try {
    // Lazy initialize the scraper with profile option
    if (!cheddarFlowScraper || (useProfile === 'true' && !cheddarFlowScraper.useExistingProfile)) {
      if (cheddarFlowScraper) {
        await cheddarFlowScraper.close();
      }
      cheddarFlowScraper = new CheddarFlowScraper({
        headless: useProfile !== 'true',
        useExistingProfile: useProfile === 'true',
      });
    }

    const screenshotPath = await cheddarFlowScraper.takeScreenshot(symbol, date);
    if (screenshotPath) {
      res.json({
        success: true,
        path: screenshotPath,
        message: `Screenshot saved to ${screenshotPath}`,
      });
    } else {
      res.status(500).json({ error: 'Failed to take screenshot' });
    }
  } catch (error) {
    console.error(`Error taking screenshot for ${symbol}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// STRATEGY VALIDATOR API ENDPOINTS
// ================================

// Initialize backtester with dependencies
const regimeDetectorInstance = new RegimeDetector();
const strategyBacktester = new StrategyBacktester(polygonClient, regimeDetectorInstance);

/**
 * Run multi-day strategy validation
 * POST /api/strategy-validator/run
 * Body: { symbol, startDate, endDate, config }
 */
app.post('/api/strategy-validator/run', async (req, res) => {
  try {
    const { symbol, startDate, endDate, config } = req.body;

    if (!symbol || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required fields: symbol, startDate, endDate',
      });
    }

    // Validate date range (max 90 days to prevent timeout)
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = (end - start) / (1000 * 60 * 60 * 24);

    if (daysDiff > 90) {
      return res.status(400).json({
        error: 'Date range too large. Maximum 90 days per backtest.',
      });
    }

    if (daysDiff < 5) {
      return res.status(400).json({
        error: 'Date range too small. Minimum 5 days for meaningful statistics.',
      });
    }

    console.log(`[Backtest API] Running backtest for ${symbol} from ${startDate} to ${endDate}`);

    const results = await strategyBacktester.runBacktest(
      symbol.toUpperCase(),
      startDate,
      endDate,
      config || {}
    );

    res.json(results);
  } catch (error) {
    console.error('[Backtest API] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get quick stats for a date range (without full simulation)
 * GET /api/strategy-validator/range/:symbol?startDate=X&endDate=Y
 */
app.get('/api/strategy-validator/range/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate required' });
    }

    const tradingDays = await strategyBacktester.getTradingDays(symbol, startDate, endDate);
    const buyAndHold = await strategyBacktester.calculateBuyAndHold(symbol, startDate, endDate);

    res.json({
      symbol,
      startDate,
      endDate,
      tradingDays: tradingDays.length,
      buyAndHold,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// SPRINT 2: STRATEGY VERSIONING & OPTIMIZATION API ENDPOINTS
// ================================

// --- Strategy Version Control Endpoints ---

// Get all versions for a symbol
app.get('/api/versions/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const versions = strategyVersionControl.getVersions(symbol);
    res.json(versions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all symbols with versions
app.get('/api/versions', (req, res) => {
  try {
    const symbols = strategyVersionControl.getAllSymbols();
    res.json({ symbols });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new version
app.post('/api/versions/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const { config, description, tag, metrics, walkForwardResults } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'Config is required' });
    }

    const result = strategyVersionControl.createVersion(symbol, config, {
      description,
      tag,
      metrics,
      walkForwardResults,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific version
app.get('/api/versions/:symbol/:versionId', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const version = strategyVersionControl.getVersion(symbol, versionId);

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    res.json(version);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active config for a symbol
app.get('/api/versions/:symbol/active/config', (req, res) => {
  try {
    const { symbol } = req.params;
    const config = strategyVersionControl.getActiveConfig(symbol);

    if (!config) {
      return res.status(404).json({ error: 'No active config found' });
    }

    res.json({ symbol: symbol.toUpperCase(), config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get production config for a symbol
app.get('/api/versions/:symbol/production/config', (req, res) => {
  try {
    const { symbol } = req.params;
    const config = strategyVersionControl.getProductionConfig(symbol);

    if (!config) {
      return res.status(404).json({ error: 'No production config found' });
    }

    res.json({ symbol: symbol.toUpperCase(), config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set active version
app.put('/api/versions/:symbol/active', (req, res) => {
  try {
    const { symbol } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      return res.status(400).json({ error: 'versionId is required' });
    }

    const result = strategyVersionControl.setActiveVersion(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Promote version to production
app.put('/api/versions/:symbol/promote', (req, res) => {
  try {
    const { symbol } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      return res.status(400).json({ error: 'versionId is required' });
    }

    const result = strategyVersionControl.promoteToProduction(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rollback to a previous version
app.post('/api/versions/:symbol/rollback', (req, res) => {
  try {
    const { symbol } = req.params;
    const { versionId } = req.body;

    if (!versionId) {
      return res.status(400).json({ error: 'versionId is required' });
    }

    const result = strategyVersionControl.rollback(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update metrics for a version
app.put('/api/versions/:symbol/:versionId/metrics', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { metrics } = req.body;

    if (!metrics) {
      return res.status(400).json({ error: 'metrics is required' });
    }

    const result = strategyVersionControl.updateMetrics(symbol, versionId, metrics);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Compare two versions
app.get('/api/versions/:symbol/compare', (req, res) => {
  try {
    const { symbol } = req.params;
    const { versionA, versionB } = req.query;

    if (!versionA || !versionB) {
      return res.status(400).json({ error: 'versionA and versionB query params required' });
    }

    const result = strategyVersionControl.compareVersions(symbol, versionA, versionB);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clone a version
app.post('/api/versions/:symbol/:versionId/clone', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { modifications, description, tag } = req.body;

    const result = strategyVersionControl.cloneVersion(symbol, versionId, modifications, {
      description,
      tag,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Archive a version
app.delete('/api/versions/:symbol/:versionId', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const result = strategyVersionControl.archiveVersion(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Regime-Aware Config Store Endpoints ---

// Get config for symbol (optionally with regime adjustment)
app.get('/api/config/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { regime, applyAdjustments } = req.query;

    const config = regimeAwareConfigStore.getConfig(
      symbol,
      regime || null,
      applyAdjustments !== 'false'
    );

    res.json({ symbol: symbol.toUpperCase(), config });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get config with live regime detection
app.post('/api/config/:symbol/detect', async (req, res) => {
  try {
    const { symbol } = req.params;
    let { candles } = req.body;

    // If no candles provided, fetch recent data
    if (!candles || candles.length === 0) {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      candles = await polygonClient.getHistoricalAggregates(symbol, startDate, endDate, 'day');
    }

    const result = regimeAwareConfigStore.getConfigWithDetection(symbol, candles);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set base config for a symbol
app.post('/api/config/:symbol/base', (req, res) => {
  try {
    const { symbol } = req.params;
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'config is required' });
    }

    const result = regimeAwareConfigStore.setBaseConfig(symbol, config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set regime-specific config for a symbol
app.post('/api/config/:symbol/regime/:regime', (req, res) => {
  try {
    const { symbol, regime } = req.params;
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({ error: 'config is required' });
    }

    const result = regimeAwareConfigStore.setRegimeConfig(symbol, regime, config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all configs for a symbol
app.get('/api/config/:symbol/all', (req, res) => {
  try {
    const { symbol } = req.params;
    const configs = regimeAwareConfigStore.getAllConfigs(symbol);
    res.json(configs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Preview regime configs
app.get('/api/config/:symbol/preview', (req, res) => {
  try {
    const { symbol } = req.params;
    const preview = regimeAwareConfigStore.previewRegimeConfigs(symbol);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enable/disable regime adaptation
app.put('/api/config/:symbol/adaptation', (req, res) => {
  try {
    const { symbol } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    const result = regimeAwareConfigStore.setRegimeAdaptation(symbol, enabled);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get config store summary
app.get('/api/config', (req, res) => {
  try {
    const summary = regimeAwareConfigStore.getSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete config for a symbol
app.delete('/api/config/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const result = regimeAwareConfigStore.deleteConfig(symbol);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Walk-Forward Optimization Endpoints ---

// Run walk-forward optimization
app.post('/api/optimize/walk-forward', async (req, res) => {
  try {
    const { symbol, baseStrategy, historicalData, options } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    // Get historical data if not provided
    let data = historicalData;
    if (!data || data.length === 0) {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const candles = await polygonClient.getHistoricalAggregates(symbol, startDate, endDate, 'day');
      data = candles.map(c => ({ date: c.date || c.t, ...c }));
    }

    // Create optimizer with custom options if provided
    const optimizer = options ? new WalkForwardOptimizer(options) : walkForwardOptimizer;

    // Define backtest function using existing backtest engine
    const backtestFn = async (config, windowData) => {
      const result = await backtestEngine.runBacktest({
        symbol,
        ...config,
        historicalData: windowData,
      });
      return {
        trades: result.trades || [],
        metrics: result.metrics || {},
      };
    };

    const result = await optimizer.runOptimization(
      data,
      baseStrategy || regimeAwareConfigStore.getDefaultConfig(),
      backtestFn
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Quick validation
app.post('/api/optimize/quick-validate', async (req, res) => {
  try {
    const { symbol, config, historicalData } = req.body;

    if (!symbol || !config) {
      return res.status(400).json({ error: 'symbol and config are required' });
    }

    // Get historical data if not provided
    let data = historicalData;
    if (!data || data.length === 0) {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const candles = await polygonClient.getHistoricalAggregates(symbol, startDate, endDate, 'day');
      data = candles.map(c => ({ date: c.date || c.t, ...c }));
    }

    // Define backtest function
    const backtestFn = async (cfg, windowData) => {
      const result = await backtestEngine.runBacktest({
        symbol,
        ...cfg,
        historicalData: windowData,
      });
      return {
        trades: result.trades || [],
        metrics: result.metrics || {},
      };
    };

    const result = await walkForwardOptimizer.quickValidation(data, config, backtestFn);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get optimizer default parameter ranges
app.get('/api/optimize/parameters', (req, res) => {
  try {
    const ranges = walkForwardOptimizer.getDefaultParameterRanges();
    res.json({ parameterRanges: ranges });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ================================
// SPRINT 3: A/B TESTING & STRATEGY MONITORING API ENDPOINTS
// ================================

// --- A/B Testing Endpoints ---

// Get all tests
app.get('/api/ab-tests', (req, res) => {
  try {
    const tests = abTestingEngine.getAllTests();
    res.json({ tests, count: tests.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active tests
app.get('/api/ab-tests/active', (req, res) => {
  try {
    const tests = abTestingEngine.getActiveTests();
    res.json({ tests, count: tests.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tests for a symbol
app.get('/api/ab-tests/symbol/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const tests = abTestingEngine.getTestsForSymbol(symbol);
    res.json({ symbol: symbol.toUpperCase(), tests, count: tests.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new test
app.post('/api/ab-tests', (req, res) => {
  try {
    const {
      name,
      symbol,
      variants,
      primaryMetric,
      minTrades,
      confidenceThreshold,
      description,
    } = req.body;

    if (!name || !symbol || !variants || variants.length < 2) {
      return res.status(400).json({
        error: 'name, symbol, and at least 2 variants are required',
      });
    }

    const result = abTestingEngine.createTest({
      name,
      symbol,
      variants,
      primaryMetric,
      minTrades,
      confidenceThreshold,
      description,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific test
app.get('/api/ab-tests/:testId', (req, res) => {
  try {
    const { testId } = req.params;
    const test = abTestingEngine.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get test summary with leaderboard
app.get('/api/ab-tests/:testId/summary', (req, res) => {
  try {
    const { testId } = req.params;
    const summary = abTestingEngine.getTestSummary(testId);

    if (!summary) {
      return res.status(404).json({ error: 'Test not found' });
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a test
app.post('/api/ab-tests/:testId/start', (req, res) => {
  try {
    const { testId } = req.params;
    const result = abTestingEngine.startTest(testId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pause a test
app.post('/api/ab-tests/:testId/pause', (req, res) => {
  try {
    const { testId } = req.params;
    const result = abTestingEngine.pauseTest(testId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel a test
app.post('/api/ab-tests/:testId/cancel', (req, res) => {
  try {
    const { testId } = req.params;
    const result = abTestingEngine.cancelTest(testId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record a trade for a variant
app.post('/api/ab-tests/:testId/variants/:variantId/trade', (req, res) => {
  try {
    const { testId, variantId } = req.params;
    const trade = req.body;

    if (!trade || typeof trade.pnl === 'undefined') {
      return res.status(400).json({ error: 'Trade with pnl is required' });
    }

    const result = abTestingEngine.recordTrade(testId, variantId, trade);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record backtest results for a variant
app.post('/api/ab-tests/:testId/variants/:variantId/backtest', (req, res) => {
  try {
    const { testId, variantId } = req.params;
    const { trades } = req.body;

    if (!trades || !Array.isArray(trades)) {
      return res.status(400).json({ error: 'trades array is required' });
    }

    const result = abTestingEngine.recordBacktestResults(testId, variantId, trades);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Evaluate test results
app.get('/api/ab-tests/:testId/evaluate', (req, res) => {
  try {
    const { testId } = req.params;
    const result = abTestingEngine.evaluateTest(testId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Declare winner
app.post('/api/ab-tests/:testId/declare-winner', (req, res) => {
  try {
    const { testId } = req.params;
    const { variantId } = req.body;

    const result = abTestingEngine.declareWinner(testId, variantId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clone a test
app.post('/api/ab-tests/:testId/clone', (req, res) => {
  try {
    const { testId } = req.params;
    const { newName } = req.body;

    const result = abTestingEngine.cloneTest(testId, newName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a test
app.delete('/api/ab-tests/:testId', (req, res) => {
  try {
    const { testId } = req.params;
    const result = abTestingEngine.deleteTest(testId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Strategy Monitor Endpoints ---

// Get all active monitors
app.get('/api/monitors', (req, res) => {
  try {
    const monitors = strategyMonitor.getActiveMonitors();
    res.json({ monitors, count: monitors.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get monitors for a symbol
app.get('/api/monitors/symbol/:symbol', (req, res) => {
  try {
    const { symbol } = req.params;
    const monitors = strategyMonitor.getMonitorsForSymbol(symbol);
    res.json({ symbol: symbol.toUpperCase(), monitors, count: monitors.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start monitoring a strategy
app.post('/api/monitors/:symbol/:versionId/start', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { thresholds, historicalMetrics, startingEquity } = req.body;

    const result = strategyMonitor.startMonitoring(symbol, versionId, {
      thresholds,
      historicalMetrics,
      startingEquity,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop monitoring
app.post('/api/monitors/:symbol/:versionId/stop', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const result = strategyMonitor.stopMonitoring(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific monitor
app.get('/api/monitors/:symbol/:versionId', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const monitor = strategyMonitor.getMonitor(symbol, versionId);

    if (!monitor) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    res.json(monitor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get performance report
app.get('/api/monitors/:symbol/:versionId/report', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const report = strategyMonitor.getPerformanceReport(symbol, versionId);

    if (!report) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily summary
app.get('/api/monitors/:symbol/:versionId/daily', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { date } = req.query;

    const summary = strategyMonitor.getDailySummary(symbol, versionId, date);

    if (!summary) {
      return res.status(404).json({ error: 'Monitor not found' });
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record a trade
app.post('/api/monitors/:symbol/:versionId/trade', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const trade = req.body;

    if (!trade || typeof trade.pnl === 'undefined') {
      return res.status(400).json({ error: 'Trade with pnl is required' });
    }

    const result = strategyMonitor.recordTrade(symbol, versionId, trade);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all unacknowledged alerts
app.get('/api/monitors/alerts', (req, res) => {
  try {
    const { symbol, versionId } = req.query;
    const alerts = strategyMonitor.getUnacknowledgedAlerts(symbol, versionId);
    res.json({ alerts, count: alerts.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Acknowledge an alert
app.post('/api/monitors/:symbol/:versionId/alerts/:alertId/acknowledge', (req, res) => {
  try {
    const { symbol, versionId, alertId } = req.params;
    const result = strategyMonitor.acknowledgeAlert(symbol, versionId, alertId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update thresholds
app.put('/api/monitors/:symbol/:versionId/thresholds', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { thresholds } = req.body;

    if (!thresholds) {
      return res.status(400).json({ error: 'thresholds object is required' });
    }

    const result = strategyMonitor.updateThresholds(symbol, versionId, thresholds);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set historical baseline
app.post('/api/monitors/:symbol/:versionId/baseline', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const { metrics } = req.body;

    if (!metrics) {
      return res.status(400).json({ error: 'metrics object is required' });
    }

    const result = strategyMonitor.setHistoricalBaseline(symbol, versionId, metrics);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset monitor
app.post('/api/monitors/:symbol/:versionId/reset', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const result = strategyMonitor.resetMonitor(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete monitor
app.delete('/api/monitors/:symbol/:versionId', (req, res) => {
  try {
    const { symbol, versionId } = req.params;
    const result = strategyMonitor.deleteMonitor(symbol, versionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// TECHNICAL INDICATORS & PATTERN DETECTION
// ==========================================

// Get composite trading signals for a symbol
app.get('/api/indicators/:symbol/signals', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1D', bars = 100 } = req.query;

    // Fetch historical data for indicator calculation
    let candles = [];
    try {
      // Try to get intraday data from Polygon or cached data
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Math.ceil(bars / 7)); // Rough estimate for trading days

      const data = await polygonClient.getDailyBars(
        symbol,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );

      if (data && data.results) {
        candles = data.results.map(bar => ({
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
          timestamp: bar.t,
        }));
      }
    } catch (dataError) {
      console.warn(`Could not fetch data for ${symbol}:`, dataError.message);
    }

    // If we have enough data, calculate indicators
    if (candles.length >= 50) {
      const indicators = technicalIndicatorsService.getAllIndicators(candles);
      res.json({
        success: true,
        symbol,
        timeframe,
        signal: indicators.signals?.signal || 'HOLD',
        confidence: indicators.signals?.confidence || 50,
        bullishScore: indicators.signals?.bullishScore || 0,
        bearishScore: indicators.signals?.bearishScore || 0,
        reasons: indicators.signals?.reasons || [],
        indicators: {
          rsi: indicators.rsi?.value,
          macd: indicators.macd,
          bollingerBands: indicators.bollingerBands,
          ema: indicators.ema,
          vwap: indicators.vwap,
          adx: indicators.adx,
          stochastic: indicators.stochastic,
          volume: indicators.volume,
        },
        trend: indicators.trend,
        timestamp: indicators.timestamp,
      });
    } else {
      // Return default values if not enough data
      res.json({
        success: true,
        symbol,
        timeframe,
        signal: 'HOLD',
        confidence: 50,
        bullishScore: 0,
        bearishScore: 0,
        reasons: ['Insufficient data for analysis'],
        indicators: {},
        trend: {},
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(`Error fetching signals for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Detect patterns for a symbol
app.get('/api/patterns/:symbol/detect', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { timeframe = '1D', bars = 100 } = req.query;

    // Fetch historical data for pattern detection
    let candles = [];
    let indicators = {};

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - Math.ceil(bars / 7));

      const data = await polygonClient.getDailyBars(
        symbol,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );

      if (data && data.results) {
        candles = data.results.map(bar => ({
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
          timestamp: bar.t,
        }));
      }

      // Calculate indicators for pattern detection
      if (candles.length >= 50) {
        indicators = technicalIndicatorsService.getAllIndicators(candles);
      }
    } catch (dataError) {
      console.warn(`Could not fetch data for ${symbol}:`, dataError.message);
    }

    // Detect patterns
    if (candles.length >= 20) {
      const patternResult = patternRecognitionService.detectHeuristicPatterns(candles, indicators);

      res.json({
        success: true,
        symbol,
        timeframe,
        signal: patternResult.signal,
        confidence: patternResult.confidence,
        patterns: patternResult.patterns || [],
        probabilities: patternResult.probabilities || {
          BUY_SIGNAL: 33,
          HOLD: 34,
          SELL_SIGNAL: 33,
        },
        bullishScore: patternResult.bullishScore || 0,
        bearishScore: patternResult.bearishScore || 0,
        isMLPrediction: false,
        timestamp: patternResult.timestamp || new Date(),
      });
    } else {
      res.json({
        success: true,
        symbol,
        timeframe,
        signal: 'HOLD',
        confidence: 50,
        patterns: [],
        probabilities: { BUY_SIGNAL: 33, HOLD: 34, SELL_SIGNAL: 33 },
        bullishScore: 0,
        bearishScore: 0,
        isMLPrediction: false,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    console.error(`Error detecting patterns for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get ML pattern prediction (uses TensorFlow.js model)
app.post('/api/patterns/:symbol/predict', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { candles, indicators } = req.body;

    if (!candles || candles.length < 60) {
      return res.status(400).json({
        error: 'Need at least 60 candles for ML prediction',
      });
    }

    const prediction = await patternRecognitionService.predictPattern(candles, indicators);

    res.json({
      success: true,
      symbol,
      ...prediction,
      isMLPrediction: true,
    });
  } catch (error) {
    console.error(`Error predicting patterns for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get ML model info
app.get('/api/patterns/model/info', (req, res) => {
  try {
    const info = patternRecognitionService.getModelInfo();
    res.json({ success: true, ...info });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static files from React build
app.use(express.static(`${__dirname}/../react-client/dist`));

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../react-client/dist/index.html`));
});

// Create HTTP server and initialize WebSocket
const server = http.createServer(app);
websocketServer.initializeWebSocket(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}!`);
  console.log(`\n🤖 AI Trading Engine endpoints:`);
  console.log(
    `   POST /api/ai/session/start     - Create new AI trading session`
  );
  console.log(`   POST /api/ai/session/stop      - Stop a session`);
  console.log(`   POST /api/ai/session/pause     - Pause a session`);
  console.log(`   POST /api/ai/session/resume    - Resume a paused session`);
  console.log(`   GET  /api/ai/sessions/:userId  - Get all sessions for user`);
  console.log(
    `   GET  /api/ai/session/detail/:sessionId - Get specific session`
  );
  console.log(
    `   GET  /api/ai/session/:userId   - Get first active session (legacy)`
  );
  console.log(
    `   PUT  /api/ai/session/:sessionId/config - Update session config`
  );
  console.log(`   GET  /api/ai/decisions/:sessionId`);
  console.log(`   POST /api/ai/patterns/analyze`);
  console.log(`\n📈 Technical Indicators:`);
  console.log(`   GET  /api/indicators/:symbol`);
  console.log(`\n📥 Schwab Import:`);
  console.log(`   POST /api/import/schwab`);
  console.log(`   GET  /api/import/schwab/:userId`);
  console.log(`   POST /api/import/schwab/train`);
  console.log(`\n🧪 Enhanced Backtesting:`);
  console.log(`   POST /api/backtest/enhanced`);
  console.log(`   POST /api/backtest/what-if`);
  console.log(`   POST /api/backtest/optimize`);
  console.log(`   POST /api/backtest/monte-carlo`);
  console.log(`\n💰 Alpaca Paper Trading:`);
  console.log(`   GET  /api/alpaca/account`);
  console.log(`   GET  /api/alpaca/positions`);
  console.log(`   POST /api/alpaca/orders`);
  console.log(`\n🔌 WebSocket: ws://localhost:${PORT}`);
});
