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

const app = express();

// Middleware for JSON parsing
app.use(bodyParser.json());


// ================================
// PAPER TRADING SIMULATION SYSTEM
// ================================

// In-memory paper trading portfolios (in production, use database)
const paperTradingPortfolios = new Map();

// Helper function to get current stock price (integrates with existing APIs)
async function getCurrentStockPrice(symbol) {
  try {
    // Use Polygon API to get real-time stock price
    const quote = await polygonClient.getLatestQuote(symbol).catch(e => {
      console.error(`❌ Error fetching real-time price for ${symbol}:`, e.message);
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

    const bars = await polygonClient.getHistoricalAggregates(symbol, startDateStr, endDateStr).catch(e => {
      console.error(`❌ Error fetching historical price for ${symbol}:`, e.message);
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

    console.log(`📈 Analyzing intraday trading for ${symbol}${date ? ` on ${date}` : ''}...`);

    // Get today's date or specified date
    const targetDate = date ? new Date(date) : new Date();
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Calculate date range for analysis (7 days history for pattern matching)
    const startDate = new Date(targetDate);
    startDate.setDate(startDate.getDate() - 7);
    const startDateStr = startDate.toISOString().split('T')[0];

    // Fetch 5-minute candles for the target day (market hours: 9:30 AM - 4:00 PM ET = 78 candles)
    const intradayCandles = await polygonClient.getHistoricalAggregates(
      symbol,
      targetDateStr,
      targetDateStr,
      'minute'
    ).catch(e => {
      console.log(`⚠️  Could not fetch intraday candles: ${e.message}`);
      return [];
    });

    // Fetch daily bars for historical context and pattern matching
    const dailyBars = await polygonClient.getHistoricalAggregates(
      symbol,
      startDateStr,
      targetDateStr,
      'day'
    ).catch(e => {
      console.error(`❌ Error fetching daily bars: ${e.message}`);
      return [];
    });

    // Fetch market indicators (S&P 500 and VIX for sentiment)
    const [spyBars, vixBars] = await Promise.all([
      polygonClient.getHistoricalAggregates('SPY', startDateStr, targetDateStr, 'day').catch(() => []),
      polygonClient.getHistoricalAggregates('VIX', startDateStr, targetDateStr, 'day').catch(() => [])
    ]);

    // Calculate market sentiment
    const marketSentiment = analyzeMarketSentiment(spyBars, vixBars);

    // Calculate technical indicators
    const technicals = polygonClient.calculateTechnicalIndicators(dailyBars);

    // Analyze intraday pattern
    const intradayAnalysis = analyzeIntradayPattern(intradayCandles, dailyBars);

    // Generate entry/exit recommendations
    const recommendations = generateTradingRecommendations(
      symbol,
      intradayCandles,
      dailyBars,
      marketSentiment,
      technicals
    );

    // Find historical patterns similar to current setup
    const similarPatterns = await findSimilarPatterns(symbol, dailyBars, marketSentiment);

    res.json({
      success: true,
      symbol,
      date: targetDateStr,
      intraday: {
        candles: intradayCandles,
        openPrice: intradayCandles[0]?.open || null,
        currentPrice: intradayCandles[intradayCandles.length - 1]?.close || null,
        highOfDay: Math.max(...intradayCandles.map(c => c.high)),
        lowOfDay: Math.min(...intradayCandles.map(c => c.low)),
        volume: intradayCandles.reduce((sum, c) => sum + c.volume, 0),
        analysis: intradayAnalysis
      },
      marketSentiment,
      technicals,
      recommendations,
      similarPatterns
    });

  } catch (error) {
    console.error(`❌ Error analyzing intraday for ${symbol}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Analyze market sentiment from S&P and VIX
function analyzeMarketSentiment(spyBars, vixBars) {
  if (spyBars.length === 0 || vixBars.length === 0) {
    return { sentiment: 'Unknown', confidence: 0, description: 'Insufficient market data' };
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
    description = 'Strong uptrend with low volatility - favorable for long positions';
  } else if (spyChange > 0 && vixLevel < 25) {
    sentiment = 'Bullish';
    confidence = 65;
    description = 'Moderate uptrend - cautiously bullish';
  } else if (spyChange < -0.5 && vixLevel > 25) {
    sentiment = 'Bearish';
    confidence = 85;
    description = 'Strong downtrend with elevated volatility - risky environment';
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
    vixLevel: vixLevel.toFixed(2)
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

  const firstHalfAvgHigh = firstHalf.reduce((sum, hl) => sum + hl.high, 0) / firstHalf.length;
  const secondHalfAvgHigh = secondHalf.reduce((sum, hl) => sum + hl.high, 0) / secondHalf.length;

  let pattern, strength;

  if (secondHalfAvgHigh > firstHalfAvgHigh * 1.01) {
    pattern = 'Uptrend';
    strength = Math.min(((secondHalfAvgHigh - firstHalfAvgHigh) / firstHalfAvgHigh) * 1000, 100);
  } else if (secondHalfAvgHigh < firstHalfAvgHigh * 0.99) {
    pattern = 'Downtrend';
    strength = Math.min(((firstHalfAvgHigh - secondHalfAvgHigh) / firstHalfAvgHigh) * 1000, 100);
  } else {
    pattern = 'Ranging';
    strength = 50;
  }

  return {
    pattern,
    strength: Math.round(strength),
    priceChange: priceChange.toFixed(2)
  };
}

// Helper: Generate trading recommendations
function generateTradingRecommendations(symbol, intradayCandles, dailyBars, marketSentiment, technicals) {
  if (intradayCandles.length === 0 || dailyBars.length === 0) {
    return {
      action: 'WAIT',
      confidence: 0,
      reason: 'Insufficient data for recommendation',
      entryPrice: null,
      exitPrice: null,
      stopLoss: null
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
    if (technicals.rsi < 30) score += 20; // Oversold - bullish
    else if (technicals.rsi > 70) score -= 20; // Overbought - bearish
  }

  // Price position relative to MAs (20%)
  if (technicals?.sma20 && technicals?.sma50) {
    if (currentPrice > technicals.sma20 && technicals.sma20 > technicals.sma50) {
      score += 20; // Above MAs and MAs aligned - bullish
    } else if (currentPrice < technicals.sma20 && technicals.sma20 < technicals.sma50) {
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
    score: Math.round(score)
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
      outcome: 'Pattern matching requires more historical data'
    }
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

// 22. Get Alpaca orders
app.get('/api/alpaca/orders', async (req, res) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.limit) filters.limit = req.query.limit;

    const orders = await alpacaClient.getOrders(filters);
    res.json({ success: true, orders });
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
    const bars = await polygonClient.getHistoricalAggregates(symbol, startDateStr, endDateStr).catch(e => {
      console.error(`❌ Polygon bars fetch failed for ${symbol}:`, e.message);
      return { error: e.message };
    });

    // We need at least bars data to provide analysis
    if (bars.error || !bars || bars.length === 0) {
      throw new Error(`Unable to fetch historical data for ${symbol}. The symbol may be invalid or market data unavailable.`);
    }

    // Get latest quote from Polygon for current price
    const latestQuote = await polygonClient.getLatestQuote(symbol).catch(e => {
      console.log(`⚠️  Polygon quote fetch failed for ${symbol} (may be normal if market closed)`);
      return { error: e.message };
    });

    // Extract current price - use latest bar close price if real-time data unavailable
    const latestBar = bars[bars.length - 1];
    const currentPrice = (!latestQuote.error && latestQuote.price) || latestBar.close;
    const bidPrice = (!latestQuote.error && latestQuote.bidPrice) || null;
    const askPrice = (!latestQuote.error && latestQuote.askPrice) || null;
    const spread = bidPrice && askPrice ? askPrice - bidPrice : null;

    // Volume analysis
    const dailyVolume = bars && bars.length > 0 ? bars[bars.length - 1].volume : null;
    const prevVolume = bars && bars.length > 1 ? bars[bars.length - 2].volume : null;
    const volumeChange = prevVolume && dailyVolume ? ((dailyVolume - prevVolume) / prevVolume) * 100 : null;

    // Calculate technical indicators from historical data
    let technicals = null;
    if (bars && bars.length >= 14) {
      // RSI calculation (14-period)
      const rsi = calculateRSI(bars, 14);

      // Moving averages
      const sma20 = calculateSMA(bars, 20);
      const sma50 = calculateSMA(bars, 50);

      // Price momentum
      const priceChange1D = bars.length >= 2 ? ((bars[bars.length - 1].close - bars[bars.length - 2].close) / bars[bars.length - 2].close) * 100 : null;
      const priceChange1W = bars.length >= 7 ? ((bars[bars.length - 1].close - bars[bars.length - 7].close) / bars[bars.length - 7].close) * 100 : null;
      const priceChange1M = bars.length >= 30 ? ((bars[bars.length - 1].close - bars[bars.length - 30].close) / bars[bars.length - 30].close) * 100 : null;

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
        trendSignal: currentPrice > sma20 && sma20 > sma50 ? 'Bullish' : currentPrice < sma20 && sma20 < sma50 ? 'Bearish' : 'Neutral',
        priceChange1D: priceChange1D ? priceChange1D.toFixed(2) : null,
        priceChange1W: priceChange1W ? priceChange1W.toFixed(2) : null,
        priceChange1M: priceChange1M ? priceChange1M.toFixed(2) : null,
        high52w: high52w.toFixed(2),
        low52w: low52w.toFixed(2),
        distanceFromHigh: distanceFromHigh.toFixed(2),
        distanceFromLow: distanceFromLow.toFixed(2)
      };
    }

    // Generate buy/sell recommendation
    let recommendation = 'Neutral';
    let reasons = [];
    let score = 0;

    if (technicals) {
      // RSI analysis
      if (technicals.rsi < 30) {
        score += 2;
        reasons.push('RSI indicates oversold conditions');
      } else if (technicals.rsi > 70) {
        score -= 2;
        reasons.push('RSI indicates overbought conditions');
      }

      // Trend analysis
      if (technicals.trendSignal === 'Bullish') {
        score += 1;
        reasons.push('Price above both 20 and 50-day moving averages');
      } else if (technicals.trendSignal === 'Bearish') {
        score -= 1;
        reasons.push('Price below both 20 and 50-day moving averages');
      }

      // Distance from 52-week high/low
      if (parseFloat(technicals.distanceFromHigh) > -5) {
        score -= 1;
        reasons.push('Trading near 52-week high');
      } else if (parseFloat(technicals.distanceFromLow) < 10) {
        score += 1;
        reasons.push('Trading near 52-week low');
      }

      // Volume analysis
      if (volumeChange > 50) {
        reasons.push(`Volume up ${volumeChange.toFixed(0)}% - increased interest`);
      }

      // Determine recommendation
      if (score >= 2) recommendation = 'Strong Buy';
      else if (score === 1) recommendation = 'Buy';
      else if (score === -1) recommendation = 'Sell';
      else if (score <= -2) recommendation = 'Strong Sell';
    }

    // Calculate expected returns (simple projections based on historical volatility)
    let projections = null;
    if (bars && bars.length >= 30 && currentPrice) {
      const returns = [];
      for (let i = 1; i < bars.length; i++) {
        returns.push((bars[i].close - bars[i-1].close) / bars[i-1].close);
      }

      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stdDev = Math.sqrt(returns.reduce((sq, n) => sq + Math.pow(n - avgReturn, 2), 0) / returns.length);

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
          expectedPrice: (currentPrice * (1 + return1W/100)).toFixed(2),
          volatility: vol1W.toFixed(2),
          range: {
            low: (currentPrice * (1 + return1W/100 - vol1W/100)).toFixed(2),
            high: (currentPrice * (1 + return1W/100 + vol1W/100)).toFixed(2)
          }
        },
        oneMonth: {
          expectedReturn: return1M.toFixed(2),
          expectedPrice: (currentPrice * (1 + return1M/100)).toFixed(2),
          volatility: vol1M.toFixed(2),
          range: {
            low: (currentPrice * (1 + return1M/100 - vol1M/100)).toFixed(2),
            high: (currentPrice * (1 + return1M/100 + vol1M/100)).toFixed(2)
          }
        }
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
        changePercent: volumeChange ? volumeChange.toFixed(2) : null
      },
      technicals,
      recommendation: {
        action: recommendation,
        score,
        reasons
      },
      projections
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
    changes.push(bars[i].close - bars[i-1].close);
  }

  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
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

// Serve static files from React build
app.use(express.static(`${__dirname}/../react-client/dist`));

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../react-client/dist/index.html`));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}!`);
  console.log(`\n💰 Alpaca Paper Trading endpoints available:`);
  console.log(`   GET  /api/alpaca/account`);
  console.log(`   GET  /api/alpaca/positions`);
  console.log(`   GET  /api/alpaca/positions/:symbol`);
  console.log(`   POST /api/alpaca/orders`);
  console.log(`   GET  /api/alpaca/orders`);
  console.log(`   DELETE /api/alpaca/orders/:orderId`);
  console.log(`   DELETE /api/alpaca/positions/:symbol`);
  console.log(`   GET  /api/alpaca/quotes/:symbol`);
  console.log(`   GET  /api/alpaca/trades/:symbol`);
  console.log(`\n🔍 Data Validation endpoints (Alpaca vs Polygon):`);
  console.log(`   GET  /api/validate/price/:symbol`);
  console.log(`   POST /api/validate/historical`);
  console.log(`   POST /api/validate/prices/batch`);
  console.log(`\n📊 SnapTrade API proxy endpoints available:`);
  console.log(`   POST /api/snaptrade/users`);
  console.log(`   POST /api/snaptrade/connection-portal`);
  console.log(`   GET  /api/snaptrade/accounts/:userId`);
  console.log(`   GET  /api/snaptrade/accounts/:accountId/positions`);
  console.log(`   GET  /api/snaptrade/accounts/:accountId/trades`);
  console.log(`   GET  /api/snaptrade/accounts/:accountId/trade-summary`);
  console.log(`\n📸 Snapshot & Backtesting endpoints available:`);
  console.log(`   GET  /api/snapshots/dates`);
  console.log(`   GET  /api/snapshots/:date`);
  console.log(`   GET  /api/snapshots/range/:startDate/:endDate`);
  console.log(`   POST /api/snapshots/generate-history`);
  console.log(`   POST /api/snapshots/backfill-real-history  🆕 Real Data`);
  console.log(`   POST /api/snapshots/save-today`);
  console.log(`   GET  /api/snapshots/availability`);
  console.log(`   GET  /api/rankings/current  🆕 Live Rankings`);
  console.log(`   GET  /api/quarterly/:symbol`);
  console.log(`   GET  /api/quarterly/:symbol/qoq/:metric`);
  console.log(`   GET  /api/quarterly/:symbol/yoy/:metric`);
  console.log(`   POST /api/backtest/run`);
});
