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
const { sentimentEngine, phaseTracker } = require('./semiconductorSentiment');
const { aiAnalyst } = require('./aiSemiconductorAnalyst');
const { SemiconductorAutoTrader } = require('./semiconductorAutoTrader');
const technicalIndicatorsService = require('./technicalIndicatorsService');
const patternRecognitionService = require('./patternRecognitionService');
const schwabImportService = require('./schwabImportService');
const enhancedBacktestEngine = require('./enhancedBacktestEngine');
const websocketServer = require('./websocketServer');
const alpacaStream = require('./alpacaStreamClient');
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

// Asset utilities for crypto/stock detection
const assetUtils = require('./assetUtils');

// Trading Logger for diagnostics
const tradingLogger = require('./tradingLogger');

// Telegram Bot for remote trading control
const telegramBot = require('./telegramBot');

// Self-Improvement Engine (nightly auto-tuning)
const SelfImprovementEngine = require('./selfImprovementEngine');

// Watchlist Regime Detector
const WatchlistRegimeDetector = require('./watchlistRegimeDetector');

// AI Broker Agents — markdown-driven autonomous trading personas
const brokerBridge = require('./brokers/brokerSessionBridge');

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
const cheddarFlowScraper = null; // Lazy init to avoid starting browser on server start

// Initialize Self-Improvement Engine
const selfImprovementEngine = new SelfImprovementEngine();
selfImprovementEngine.start();

// Initialize Watchlist Regime Detector
const watchlistRegimeDetector = new WatchlistRegimeDetector();

// Initialize the semiconductor auto-trader
const semiconductorAutoTrader = new SemiconductorAutoTrader(aiTradingEngine, {
  autoTrade: false, // Safety: manual execution by default
});

const app = express();

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Middleware for JSON parsing
app.use(bodyParser.json());

// Lightweight liveness probe for the process supervisor / Fly health check.
// Intentionally does NO work (no DB/API/engine calls) so it answers instantly
// and distinguishes "process alive" from "trading healthy".
const _serverStartedAt = Date.now();
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - _serverStartedAt) / 1000),
    pid: process.pid,
    ts: new Date().toISOString(),
  });
});

// ================================
// IN-MEMORY STATE
// ================================

// In-memory paper trading portfolios (in production, use database)
const paperTradingPortfolios = new Map();

// Cache for historical intraday data to avoid redundant API calls
const historicalDataCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// In-memory storage for simulation results (in production, use database)
const simulationResults = new Map();

// ================================
// HELPER FUNCTIONS
// ================================

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

  // Detect if this is a crypto symbol
  const upperSymbol = symbol.toUpperCase();
  const isCryptoSymbol =
    assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
    upperSymbol.includes('/USD') ||
    upperSymbol.startsWith('X:');

  let data;
  if (isCryptoSymbol) {
    // Use crypto API for crypto symbols
    data = await polygonClient
      .getCryptoHistoricalAggregates(symbol, date, date, interval)
      .catch(() => []);
  } else {
    // Use stock API for stocks
    data = await polygonClient
      .getHistoricalAggregates(symbol, date, date, interval)
      .catch(() => []);
  }

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

// ================================
// DEPENDENCY INJECTION OBJECT
// ================================

const deps = {
  // Core modules
  polygonClient,
  alpacaClient,
  alpacaStream,
  tradingModeManager,
  aiTradingEngine,
  snapshotManager,
  backtestEngine,
  historicalDataManager,
  enhancedBacktestEngine,
  technicalIndicatorsService,
  patternRecognitionService,
  schwabImportService,
  tradingLogger,
  assetUtils,

  // Semiconductor
  sentimentEngine,
  phaseTracker,
  aiAnalyst,
  semiconductorAutoTrader,

  // Sprint modules
  transactionCostModel,
  leveragedEtfRules,
  regimeDetector,
  walkForwardOptimizer,
  strategyVersionControl,
  regimeAwareConfigStore,
  abTestingEngine,
  strategyMonitor,
  overnightOptimizer,
  selfImprovementEngine,

  // ETF / Flow
  leveragedEtfStrategy,
  CheddarFlowScraper,
  cheddarFlowScraper,

  // Watchlist
  watchlistRegimeDetector,

  // Constructors (for route files that instantiate)
  RegimeDetector,
  StrategyBacktester,
  WalkForwardOptimizer,

  // Multer + PORT
  upload,
  PORT,

  // In-memory state
  paperTradingPortfolios,
  simulationResults,

  // Helper functions
  getCachedHistoricalData,
  getCurrentStockPrice,
  calculateRSI,
  calculateSMA,
  analyzeMarketSentiment,
  analyzeIntradayPattern,
  analyzeIntradaySwings,
  generateTradingRecommendations,
  findSimilarPatterns,
  executeStrategy,
  calculateMarketMetrics,
};

// ================================
// MOUNT ROUTE FILES
// ================================

app.use(require('./routes/paperTrading')(deps));
app.use(require('./routes/snapshots')(deps));
app.use(require('./routes/alpaca')(deps));
app.use(require('./routes/aiSessions')(deps));
app.use(require('./routes/presets')(deps));
app.use(require('./routes/semiconductor')(deps));
app.use(require('./routes/tradingLogs')(deps));
app.use(require('./routes/backtest')(deps));
app.use(require('./routes/backtestRuns')());
app.use(require('./routes/volumeProfile')());
app.use(require('./routes/darkpoolArchive')());
app.use(require('./routes/strategyLab')(deps));
app.use(require('./routes/sprint')(deps));
app.use(require('./routes/misc')(deps));
app.use(require('./routes/scanner')(deps));
app.use(
  require('./routes/brokers')({ ...deps, brokerBridge, aiTradingEngine })
);

// ================================
// STATIC FILES & CATCH-ALL
// ================================

// Serve static files from React build
app.use(express.static(`${__dirname}/../react-client/dist`));

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../react-client/dist/index.html`));
});

// ================================
// SERVER STARTUP
// ================================

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

  // Initialize the AI Broker bridge: scan agents/brokers/*.md and reconcile
  // each into a running trading session, then watch the directory for adds/changes.
  brokerBridge.init({ engine: aiTradingEngine, logger: console });
  brokerBridge
    .syncBrokersToSessions()
    .then(summary => {
      console.log(
        `\n🤝 Brokers: ${summary.loaded} loaded · ${summary.started} started · ${summary.updated} updated · ${summary.errored} errored`
      );
      if (summary.errored > 0) {
        summary.errors.forEach(e =>
          console.error(`   ✗ ${e.file}: ${e.errors.join('; ')}`)
        );
      }
      brokerBridge.startWatcher();
    })
    .catch(err => console.error('[bridge] initial sync failed:', err));

  // Daily tier evaluation: every 24h, check if any broker should be promoted,
  // demoted, or fired. Manual triggers also available via POST /api/brokers/tier-eval.
  const tierPromotion = require('./brokers/tierPromotion');
  const selfMutation = require('./brokers/selfMutation');
  const DAILY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    tierPromotion
      .runTierEvaluation(
        { engine: aiTradingEngine, bridge: brokerBridge },
        { breed: process.env.BROKER_BREED === '1' }
      )
      .then(r => {
        const s = r.summary;
        if (s.promoted + s.demoted + s.fired + (s.defunded || 0) + s.bred > 0) {
          console.log(
            `🎚️  Tier eval: ${s.promoted} promoted · ${s.demoted} demoted · ${s.fired} fired · ${s.defunded || 0} defunded · ${s.bred} bred`
          );
        }
      })
      .catch(err => console.error('[tier] daily eval failed:', err.message));

    // Phase 6: nightly self-mutation pass. Only brokers whose
    // selfImprovement.intervals includes 'eod' are touched. Disabled if
    // ANTHROPIC_API_KEY is not set.
    if (process.env.ANTHROPIC_API_KEY) {
      selfMutation
        .runAllSelfMutations({ engine: aiTradingEngine, interval: 'eod' })
        .then(r => {
          if (r.mutated > 0 || r.errors > 0) {
            console.log(
              `🧬 Self-mutation (eod): ${r.evaluated} evaluated · ${r.mutated} mutated · ${r.errors} errors · ${r.skipped} skipped`
            );
          }
        })
        .catch(err =>
          console.error('[self-mutation] daily eod failed:', err.message)
        );
    }

    // Morning brief: write a markdown snapshot of today's broker activity to
    // data/reports/YYYY-MM-DD.md so you can read overnight outcomes without
    // the server running. Generates after self-mutation so mutations are captured.
    try {
      const { generateBrief } = require('../scripts/morning-brief');
      const fs = require('fs');
      const today = new Date().toISOString().slice(0, 10);
      const reportPath = path.join(
        __dirname,
        '..',
        'data',
        'reports',
        `${today}.md`
      );
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, generateBrief(today));
      console.log(`📰 Morning brief: ${reportPath}`);
    } catch (err) {
      console.error('[brief] generation failed:', err.message);
    }

    // Daily summary (structured per-source record + markdown). Also fires on a
    // precise market-close schedule defined below; idempotent (keyed by date).
    writeDailySummary(nowEastern().dateStr);
  }, DAILY_MS);

  // --- Daily summary scheduling --------------------------------------------
  // The 24h interval above is anchored to server start, so on its own it would
  // capture the day at an arbitrary time. This adds a reliable capture right
  // after the 4:00pm ET close — and a catch-up if the server was down at close.
  // Idempotent: the record is keyed by date and upsert replaces in place.
  function writeDailySummary(dateStr) {
    try {
      const fs = require('fs');
      const {
        buildRecord,
        upsertHistory,
        renderMarkdown,
      } = require('../scripts/daily-summary');
      const rec = buildRecord(dateStr);
      upsertHistory(rec);
      const out = path.join(
        __dirname,
        '..',
        'data',
        'reports',
        `daily-${dateStr}.md`
      );
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, renderMarkdown(rec));
      console.log(
        `📊 Daily summary ${dateStr}: $${rec.exchange.todayPnL.toFixed(2)} today, ${rec.exchange.todayClosed} closed`
      );
      return rec;
    } catch (err) {
      console.error('[daily-summary] failed:', err.message);
    }
  }

  // Current Eastern-time wall clock (DST-safe via Intl).
  function nowEastern() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    const hour = parseInt(get('hour'), 10) % 24;
    const wd = get('weekday');
    return {
      dateStr: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: hour * 60 + parseInt(get('minute'), 10),
      isWeekend: wd === 'Sat' || wd === 'Sun',
    };
  }

  function dailyRecordExists(dateStr) {
    try {
      const fs = require('fs');
      const h = JSON.parse(
        fs.readFileSync(
          path.join(__dirname, '..', 'data', 'daily-history.json'),
          'utf8'
        )
      );
      return Array.isArray(h) && h.some(r => r.date === dateStr);
    } catch {
      return false;
    }
  }

  // Poll every 5 min: once it's a weekday past 4:05pm ET and today's record
  // isn't written, write it. Survives restarts (checks the history file) and
  // self-corrects; runs once immediately as a startup catch-up.
  const CLOSE_MINUTE = 16 * 60 + 5; // 4:05pm ET
  function maybeWriteDailySummary() {
    const { dateStr, minutes, isWeekend } = nowEastern();
    if (isWeekend || minutes < CLOSE_MINUTE || dailyRecordExists(dateStr)) {
      return;
    }
    console.log(`📊 Market-close daily summary for ${dateStr}…`);
    writeDailySummary(dateStr);
  }
  setInterval(maybeWriteDailySummary, 5 * 60 * 1000);
  maybeWriteDailySummary();

  // --- Options-flow forward capture ----------------------------------------
  // Flow can't be backtested from history (UW flow-alerts is recent-only), so
  // we snapshot it ourselves every 15 min during market hours to build a
  // backtestable dataset over time → data/flow-history/<ET-date>.jsonl.
  const flowCapture = require('./flowCapture');
  function maybeCaptureFlow() {
    const { minutes, isWeekend } = nowEastern();
    // 9:30am (570) … 4:00pm (960) ET on weekdays.
    if (isWeekend || minutes < 570 || minutes > 960) return;
    flowCapture
      .captureSnapshot()
      .then(r => {
        if (r.captured) console.log(`📸 Flow snapshot: ${r.captured} symbols`);
      })
      .catch(err => console.error('[flow-capture] failed:', err.message));
  }
  setInterval(maybeCaptureFlow, 15 * 60 * 1000);
  maybeCaptureFlow();

  // --- Dark-pool forward capture (point-in-time archive) --------------------
  // UW dark-pool prints are recent-only (~500-print window, no history); the
  // 2026-06-01 audit found a near-close fetch reaches back only to ~15:40 ET
  // on liquid names. Merged 15-min captures during RTH are the only way to
  // build an honest point-in-time dataset → data/darkpool-archive/<ET-date>/.
  // The B6 event-study needs >= 60 archived days; a day the server is down
  // during RTH is lost forever (cron fallback: scripts/capture-darkpool.js).
  const darkPoolArchive = require('./darkPoolArchive');
  function darkPoolSessionWatchlists() {
    try {
      const sessions =
        aiTradingEngine.getAllUserSessions(brokerBridge.BROKER_USER_ID) || [];
      return sessions
        .filter(s => (s.config || {}).strategyKey === 'dark-pool')
        .flatMap(s => s.config.watchlist || []);
    } catch {
      return [];
    }
  }
  function maybeCaptureDarkPool() {
    const { minutes, isWeekend } = nowEastern();
    // 9:35am (575) … 4:05pm (965) ET on weekdays.
    if (isWeekend || minutes < 575 || minutes > 965) return;
    darkPoolArchive
      .captureOnce(darkPoolSessionWatchlists())
      .then(r => {
        if (r.captured) {
          const capped = r.cappedSymbols.length
            ? ` (cap hit: ${r.cappedSymbols.join(', ')})`
            : '';
          console.log(`🕳️  Dark-pool snapshot: ${r.captured} symbols${capped}`);
        }
      })
      .catch(err => console.error('[darkpool-archive] failed:', err.message));
  }
  setInterval(maybeCaptureDarkPool, 15 * 60 * 1000);
  maybeCaptureDarkPool();
  // Finalize today's archive once after the close (idempotent, restart-safe).
  function maybeFinalizeDarkPool() {
    const { dateStr, minutes, isWeekend } = nowEastern();
    if (isWeekend || minutes < 16 * 60 + 15) return;
    darkPoolArchive
      .finalizeDay(dateStr)
      .then(r => {
        if (r.finalized) console.log(`🕳️  Dark-pool archive finalized ${dateStr}`);
      })
      .catch(err => console.error('[darkpool-finalize] failed:', err.message));
  }
  setInterval(maybeFinalizeDarkPool, 5 * 60 * 1000);
  maybeFinalizeDarkPool();

  // --- Self-driving maintenance (insider capture, cert freshness) -----------
  // Critical chores that must never depend on a human remembering them:
  // daily insider-feed archival (the feed forgets in ~2 weeks) and automatic
  // regeneration of gate-2 faithfulness certifications before their 30-day
  // expiry. See server/maintenanceJobs.js.
  require('./maintenanceJobs').start({ logger: console });

  // --- Signal scanners: feed-driven watchlists ------------------------------
  // A fixed watchlist misses the signal — insiders buy obscure names, flow and
  // dark-pool concentrate wherever the action is today. Scanner brokers refresh
  // their watchlist from the relevant UW market-wide feed every 30 min, so they
  // hunt where the signal actually is instead of staring at a hardcoded list.
  const uwClient = require('./unusualWhalesClient');
  async function scannerUniverse(cfg) {
    if (cfg.strategyKey === 'insider-following' && cfg.insiderScanner) {
      return uwClient.getRecentInsiderBuyTickers({
        minNotional: cfg.insiderMinNotional || 500000,
        lookbackDays: cfg.insiderLookbackDays || 10,
        max: 15,
      });
    }
    if (cfg.strategyKey === 'options-flow' && cfg.flowScanner) {
      return uwClient.getTopFlowTickers({ max: 12 });
    }
    if (cfg.strategyKey === 'dark-pool' && cfg.darkpoolScanner) {
      return uwClient.getTopDarkPoolTickers({ max: 12 });
    }
    return null;
  }
  async function refreshScanners() {
    try {
      const sessions =
        aiTradingEngine.getAllUserSessions(brokerBridge.BROKER_USER_ID) || [];
      for (const s of sessions) {
        const tickers = await scannerUniverse(s.config || {});
        if (!tickers || !tickers.length) continue;
        aiTradingEngine.updateConfig(s.sessionId, { watchlist: tickers });
        console.log(
          `🛰️  Scanner: ${s.name} → ${tickers.length} names (${tickers.slice(0, 6).join(', ')}…)`
        );
      }
    } catch (err) {
      console.error('[scanner] refresh failed:', err.message);
    }
  }
  setInterval(refreshScanners, 30 * 60 * 1000);
  refreshScanners();
  // Re-run shortly after boot: the first call can land before the bridge has
  // created the broker sessions, which would leave a scanner broker idle on its
  // seed watchlist for up to 30 min after a restart.
  setTimeout(refreshScanners, 90 * 1000);

  // SOXX hourly self-improving predictor (pre-registered forward-test). Additive,
  // market-hours-guarded, decoupled from the trading engine. SOXX_PREDICTION_LOOP=off to disable.
  if (process.env.SOXX_PREDICTION_LOOP !== 'off') {
    try {
      require('./soxxPredictionLoop').startSoxxPredictionLoop();
    } catch (err) {
      console.error('SOXX prediction loop failed to start:', err.message);
    }
    // Sibling next-day (close-to-close) predictor. Same guard/kill switch.
    try {
      require('./soxxDailyPredictionLoop').startSoxxDailyPredictionLoop();
    } catch (err) {
      console.error('SOXX daily prediction loop failed to start:', err.message);
    }
  }

  // Semiconductor daily Telegram briefing — self-improving snapshots at
  // 9:30 / 10:10 / 11:11 ET. Additive, weekday-guarded, no engine side-effects.
  // SEMI_DAILY_LOOP=off to disable.
  if (process.env.SEMI_DAILY_LOOP !== 'off') {
    try {
      require('./semiDailyLoop').start();
    } catch (err) {
      console.error('Semi daily briefing loop failed to start:', err.message);
    }
  }

  // Options self-improvement heartbeat: one earnest scan + full grading per
  // market day, ledger delta to Telegram. OPTIONS_DAILY_LOOP=off to disable.
  try {
    require('./scanner/optionsDailyLoop').start();
  } catch (err) {
    console.error('Options daily loop failed to start:', err.message);
  }

  // Initialize Telegram bot if configured
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OWNER_ID) {
    telegramBot.initialize(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_OWNER_ID
    );
    telegramBot.hookIntoEvents(websocketServer.getIO());
    console.log('📱 Telegram bot initialized');
    // Engine-online alert. Because the supervisor auto-restarts on crash, a
    // burst of these is your signal that the engine bounced — uptime monitoring
    // without a separate service.
    try {
      const brokerCount = (aiTradingEngine.getAllUserSessions('brokers') || [])
        .length;
      const host = process.env.FLY_APP_NAME ? 'cloud' : 'local';
      telegramBot.sendAlert(
        `🟢 Broker engine online (${host}) — ${brokerCount} brokers, ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`
      );
    } catch (e) {
      /* best-effort */
    }
  }
});

// ================================
// GRACEFUL SHUTDOWN
// ================================

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(
    `\n[Server] ${signal} received — initiating graceful shutdown...`
  );

  try {
    // Save current session state immediately. We deliberately preserve
    // each session's status (running/paused) on disk so that on the next
    // boot, loadSessions() can call startTradingLoop() for the ones the
    // user had running. A previous version of this handler force-paused
    // every running session before exit, which meant nodemon restarts
    // (or any other restart) silently turned all sessions off — costing
    // hours of trading time per dev session and surprising the user.
    //
    // Trading loop setIntervals are cleaned up automatically when the
    // process exits, so there's no leak from skipping the pause.
    console.log('[Server] Saving trading sessions...');
    aiTradingEngine.saveSessions();
    console.log('[Server] Sessions saved (running status preserved).');

    // Disconnect Alpaca price stream
    alpacaStream.disconnect();
    console.log('[Server] Alpaca stream disconnected.');

    // 5. Close WebSocket + HTTP server
    const io = websocketServer.getIO();
    if (io) {
      io.close();
      console.log('[Server] WebSocket server closed.');
    }

    server.close(() => {
      console.log('[Server] HTTP server closed. Goodbye.');
      process.exit(0);
    });
  } catch (err) {
    console.error('[Server] Error during shutdown:', err.message);
    process.exit(1);
  }

  // Force exit after 5 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('[Server] Forced exit after 5s timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', err => {
  console.error(
    '[Server] Uncaught exception — saving state before crash:',
    err
  );
  try {
    aiTradingEngine.saveSessions();
  } catch (saveErr) {
    console.error(
      '[Server] Failed to save sessions on crash:',
      saveErr.message
    );
  }
  process.exit(1);
});
