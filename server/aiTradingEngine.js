/**
 * AI Trading Engine
 *
 * Core autonomous trading system that makes buy/sell decisions based on
 * technical indicators, pattern recognition, and adaptive strategies.
 */

const { v4: uuidv4 } = require('uuid');
const { differenceInMinutes, format, isWithinInterval, parseISO } = require('date-fns');
const technicalIndicators = require('./technicalIndicatorsService');
const alpacaClient = require('./alpacaClient');
const polygonClient = require('./polygonClient');
const websocketServer = require('./websocketServer');

// Active trading sessions
const sessions = new Map();

// Decision history for audit
const decisionHistory = new Map();

// Trading hours (Eastern Time)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Default configuration
const DEFAULT_CONFIG = {
  timeframes: ['scalping', 'dayTrading', 'swing'],
  maxPositions: 5,
  maxPositionSizePercent: 10,
  riskPerTradePercent: 2,
  dailyLossLimitPercent: 5,
  consecutiveLossLimit: 3,
  profitTargetMultiplier: 2, // 2x ATR
  stopLossMultiplier: 1.5, // 1.5x ATR
  minConfidence: 70,
  watchlist: [],
  autoTrade: false // Safety: manual confirmation by default
};

/**
 * Initialize a new trading session
 * @param {string} userId - User identifier
 * @param {object} config - Session configuration
 * @returns {object} Session info
 */
function startSession(userId, config = {}) {
  const sessionId = uuidv4();
  const sessionConfig = { ...DEFAULT_CONFIG, ...config };

  const session = {
    sessionId,
    userId,
    status: 'running',
    startTime: new Date(),
    config: sessionConfig,
    portfolio: {
      cash: 100000, // Will be updated from Alpaca
      positions: new Map(),
      initialValue: 100000
    },
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      consecutiveLosses: 0,
      peakValue: 100000,
      maxDrawdown: 0
    },
    decisions: [],
    alerts: [],
    circuitBreakerTriggered: false
  };

  sessions.set(userId, session);
  decisionHistory.set(sessionId, []);

  console.log(`[AI Engine] Session started for user ${userId}: ${sessionId}`);

  // Start the trading loop
  startTradingLoop(userId);

  return {
    sessionId,
    status: 'running',
    config: sessionConfig,
    startTime: session.startTime
  };
}

/**
 * Stop a trading session
 * @param {string} userId - User identifier
 * @returns {object} Session summary
 */
function stopSession(userId) {
  const session = sessions.get(userId);
  if (!session) {
    return { error: 'No active session found' };
  }

  session.status = 'stopped';
  session.endTime = new Date();

  const summary = {
    sessionId: session.sessionId,
    duration: differenceInMinutes(session.endTime, session.startTime),
    stats: session.stats,
    totalDecisions: session.decisions.length,
    finalPositions: Array.from(session.portfolio.positions.values())
  };

  console.log(`[AI Engine] Session stopped for user ${userId}`);

  return summary;
}

/**
 * Pause a trading session
 * @param {string} userId - User identifier
 */
function pauseSession(userId) {
  const session = sessions.get(userId);
  if (session) {
    session.status = 'paused';
    console.log(`[AI Engine] Session paused for user ${userId}`);
  }
}

/**
 * Resume a trading session
 * @param {string} userId - User identifier
 */
function resumeSession(userId) {
  const session = sessions.get(userId);
  if (session && session.status === 'paused') {
    session.status = 'running';
    session.circuitBreakerTriggered = false;
    session.stats.consecutiveLosses = 0;
    console.log(`[AI Engine] Session resumed for user ${userId}`);
  }
}

/**
 * Get session status
 * @param {string} userId - User identifier
 * @returns {object} Session status
 */
function getSessionStatus(userId) {
  const session = sessions.get(userId);
  if (!session) return null;

  return {
    sessionId: session.sessionId,
    status: session.status,
    startTime: session.startTime,
    stats: session.stats,
    positions: Array.from(session.portfolio.positions.values()),
    recentDecisions: session.decisions.slice(-10),
    circuitBreakerTriggered: session.circuitBreakerTriggered
  };
}

/**
 * Main trading loop
 * @param {string} userId - User identifier
 */
async function startTradingLoop(userId) {
  const session = sessions.get(userId);
  if (!session) return;

  // Sync portfolio with Alpaca
  await syncPortfolio(userId);

  // Trading interval (check every 30 seconds)
  const interval = setInterval(async () => {
    const currentSession = sessions.get(userId);

    if (!currentSession || currentSession.status !== 'running') {
      clearInterval(interval);
      return;
    }

    // Check if market is open
    if (!isMarketOpen()) {
      // Send status update
      websocketServer.sendAlert(userId, {
        type: 'info',
        title: 'Market Closed',
        message: 'Waiting for market to open...',
        severity: 'low'
      });
      return;
    }

    // Check circuit breaker
    if (currentSession.circuitBreakerTriggered) {
      return;
    }

    try {
      // Analyze watchlist and make decisions
      await analyzeAndTrade(userId);
    } catch (error) {
      console.error(`[AI Engine] Error in trading loop:`, error);
      websocketServer.sendAlert(userId, {
        type: 'error',
        title: 'Trading Error',
        message: error.message,
        severity: 'high'
      });
    }
  }, 30000); // 30-second intervals

  // Store interval reference for cleanup
  session.intervalId = interval;
}

/**
 * Check if market is currently open
 * @returns {boolean}
 */
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();

  // Weekend check
  if (day === 0 || day === 6) return false;

  // Convert to Eastern Time (approximate)
  const utcHours = now.getUTCHours();
  const etOffset = -5; // EST (adjust for DST as needed)
  const etHours = (utcHours + etOffset + 24) % 24;
  const minutes = now.getMinutes();
  const totalMinutes = etHours * 60 + minutes;

  const marketOpenMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  return totalMinutes >= marketOpenMinutes && totalMinutes < marketCloseMinutes;
}

/**
 * Sync portfolio with Alpaca account
 * @param {string} userId - User identifier
 */
async function syncPortfolio(userId) {
  const session = sessions.get(userId);
  if (!session) return;

  try {
    const account = await alpacaClient.getAccount();
    const positions = await alpacaClient.getPositions();

    session.portfolio.cash = parseFloat(account.cash);
    session.portfolio.initialValue = parseFloat(account.portfolio_value);
    session.stats.peakValue = Math.max(
      session.stats.peakValue,
      parseFloat(account.portfolio_value)
    );

    // Update positions
    session.portfolio.positions.clear();
    positions.forEach((pos) => {
      session.portfolio.positions.set(pos.symbol, {
        symbol: pos.symbol,
        quantity: parseInt(pos.qty),
        averageCost: parseFloat(pos.avg_entry_price),
        currentPrice: parseFloat(pos.current_price),
        marketValue: parseFloat(pos.market_value),
        unrealizedPnL: parseFloat(pos.unrealized_pl),
        unrealizedPnLPercent: parseFloat(pos.unrealized_plpc) * 100,
        side: pos.side
      });
    });

    console.log(
      `[AI Engine] Portfolio synced: $${session.portfolio.cash.toFixed(2)} cash, ${session.portfolio.positions.size} positions`
    );
  } catch (error) {
    console.error('[AI Engine] Failed to sync portfolio:', error);
  }
}

/**
 * Analyze watchlist and execute trades
 * @param {string} userId - User identifier
 */
async function analyzeAndTrade(userId) {
  const session = sessions.get(userId);
  if (!session) return;

  const { watchlist, maxPositions, minConfidence } = session.config;

  // Get current positions
  const currentPositions = Array.from(session.portfolio.positions.keys());

  // First, check existing positions for exit signals
  for (const symbol of currentPositions) {
    const exitDecision = await evaluateExit(userId, symbol);
    if (exitDecision.shouldExit) {
      await executeExit(userId, symbol, exitDecision);
    }
  }

  // Then, look for entry opportunities if we have capacity
  if (currentPositions.length < maxPositions) {
    for (const symbol of watchlist) {
      if (currentPositions.includes(symbol)) continue;

      const entryDecision = await evaluateEntry(userId, symbol);
      if (entryDecision.shouldEnter && entryDecision.confidence >= minConfidence) {
        await executeEntry(userId, symbol, entryDecision);

        // Don't exceed max positions
        if (session.portfolio.positions.size >= maxPositions) break;
      }
    }
  }
}

/**
 * Evaluate entry conditions for a symbol
 * @param {string} userId - User identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Entry decision
 */
async function evaluateEntry(userId, symbol) {
  const session = sessions.get(userId);
  if (!session) return { shouldEnter: false };

  try {
    // Get recent candles (5-minute for intraday)
    const candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date()
    });

    if (!candles || candles.length < 50) {
      return { shouldEnter: false, reason: 'Insufficient data' };
    }

    // Calculate all indicators
    const indicators = technicalIndicators.getAllIndicators(candles);
    const signals = indicators.signals;

    // Decision factors
    const factors = [];
    let score = 0;

    // RSI conditions
    if (indicators.rsi.value >= 30 && indicators.rsi.value <= 70) {
      score += 10;
      factors.push('RSI in neutral zone');
    }
    if (indicators.rsi.value < 35) {
      score += 15;
      factors.push('RSI approaching oversold');
    }
    if (indicators.rsi.divergence?.bullish) {
      score += 20;
      factors.push('Bullish RSI divergence detected');
    }

    // MACD conditions
    if (indicators.macd.bullish) {
      score += 10;
      factors.push('MACD bullish');
    }
    if (indicators.macd.crossover) {
      score += 20;
      factors.push('MACD bullish crossover');
    }

    // Bollinger Band conditions
    if (indicators.bollingerBands.percentB < 0.2) {
      score += 15;
      factors.push('Near lower Bollinger Band');
    }
    if (indicators.bollingerBands.squeeze) {
      score += 10;
      factors.push('Bollinger squeeze (volatility expansion expected)');
    }

    // VWAP conditions
    if (indicators.vwap.pricePosition > 0) {
      score += 10;
      factors.push('Price above VWAP');
    }

    // ADX trend strength
    if (indicators.adx.trending && indicators.adx.bullishDI) {
      score += 15;
      factors.push('Strong bullish trend (ADX)');
    }

    // Volume confirmation
    if (indicators.volume.aboveAverage) {
      score += 15;
      factors.push('High volume confirmation');
    }

    // EMA alignment
    if (
      indicators.trend.shortTerm === 'bullish' &&
      indicators.trend.mediumTerm === 'bullish'
    ) {
      score += 15;
      factors.push('EMA alignment bullish');
    }

    // Stochastic conditions
    if (indicators.stochastic.oversold && indicators.stochastic.bullishCross) {
      score += 15;
      factors.push('Stochastic oversold with bullish cross');
    }

    // Calculate confidence
    const confidence = Math.min(score, 100);
    const shouldEnter = confidence >= session.config.minConfidence;

    // Calculate position size and targets
    const currentPrice = candles[candles.length - 1].close;
    const atr = indicators.atr.value || currentPrice * 0.02;
    const profitTarget = currentPrice + atr * session.config.profitTargetMultiplier;
    const stopLoss = currentPrice - atr * session.config.stopLossMultiplier;

    // Calculate adaptive profit target based on volatility
    const volatilityMultiplier = indicators.bollingerBands.bandwidth > 0.05 ? 1.5 : 1.0;
    const adaptiveProfitTarget = currentPrice + atr * session.config.profitTargetMultiplier * volatilityMultiplier;

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons: factors,
      currentPrice,
      profitTarget: adaptiveProfitTarget,
      stopLoss,
      atr,
      indicators: {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        bbPercentB: indicators.bollingerBands.percentB,
        adx: indicators.adx.value,
        volumeRatio: indicators.volume.ratio
      },
      timestamp: new Date()
    };

    // Log decision
    logDecision(userId, decision);

    // Send to websocket
    if (shouldEnter) {
      websocketServer.sendAIDecision(userId, decision);
    }

    return decision;
  } catch (error) {
    console.error(`[AI Engine] Error evaluating entry for ${symbol}:`, error);
    return { shouldEnter: false, reason: error.message };
  }
}

/**
 * Evaluate exit conditions for a position
 * @param {string} userId - User identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Exit decision
 */
async function evaluateExit(userId, symbol) {
  const session = sessions.get(userId);
  if (!session) return { shouldExit: false };

  const position = session.portfolio.positions.get(symbol);
  if (!position) return { shouldExit: false };

  try {
    // Get recent candles
    const candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date()
    });

    if (!candles || candles.length < 50) {
      return { shouldExit: false };
    }

    const indicators = technicalIndicators.getAllIndicators(candles);
    const currentPrice = candles[candles.length - 1].close;
    const pnlPercent = position.unrealizedPnLPercent;

    const factors = [];
    let exitScore = 0;
    let exitReason = '';

    // Profit target hit (adaptive)
    const atr = indicators.atr.value || currentPrice * 0.02;
    const profitTargetPercent = (atr / position.averageCost) * 100 * session.config.profitTargetMultiplier;

    if (pnlPercent >= profitTargetPercent) {
      exitScore += 50;
      exitReason = 'Profit target reached';
      factors.push(`Profit target ${profitTargetPercent.toFixed(1)}% reached`);
    }

    // Stop loss hit
    const stopLossPercent = (atr / position.averageCost) * 100 * session.config.stopLossMultiplier * -1;
    if (pnlPercent <= stopLossPercent) {
      exitScore += 50;
      exitReason = 'Stop loss triggered';
      factors.push(`Stop loss ${stopLossPercent.toFixed(1)}% triggered`);
    }

    // RSI overbought
    if (indicators.rsi.value > 75) {
      exitScore += 20;
      factors.push('RSI overbought');
    }

    // Bearish RSI divergence
    if (indicators.rsi.divergence?.bearish) {
      exitScore += 25;
      factors.push('Bearish RSI divergence');
    }

    // MACD bearish crossover
    if (indicators.macd.histogram < 0 && indicators.macd.histogram < indicators.macd.signal * -0.1) {
      exitScore += 15;
      factors.push('MACD bearish momentum');
    }

    // Price below VWAP
    if (indicators.vwap.pricePosition < -1) {
      exitScore += 10;
      factors.push('Price significantly below VWAP');
    }

    // End of day exit (for day trading)
    const now = new Date();
    const etHour = (now.getUTCHours() - 5 + 24) % 24;
    if (etHour >= 15 && now.getMinutes() >= 55) {
      if (session.config.timeframes.includes('dayTrading') && pnlPercent > 0) {
        exitScore += 30;
        factors.push('End of day profit taking');
      }
    }

    // Volume declining while price rising (distribution)
    if (pnlPercent > 0 && indicators.volume.ratio < 0.7) {
      exitScore += 10;
      factors.push('Low volume on advance (distribution)');
    }

    // Stochastic overbought
    if (indicators.stochastic.overbought && !indicators.stochastic.bullishCross) {
      exitScore += 15;
      factors.push('Stochastic overbought');
    }

    // AI discretion for loss handling
    if (pnlPercent < 0 && pnlPercent > stopLossPercent) {
      // Pattern suggests recovery
      if (indicators.rsi.value < 35 && indicators.volume.aboveAverage) {
        factors.push('AI holding: oversold with volume support');
        exitScore -= 20; // Reduce exit pressure
      }
      // Trend still intact
      if (indicators.adx.trending && indicators.adx.bullishDI) {
        factors.push('AI holding: trend still bullish');
        exitScore -= 15;
      }
    }

    const shouldExit = exitScore >= 40;

    const decision = {
      shouldExit,
      symbol,
      action: 'SELL',
      exitScore,
      reasons: factors,
      exitReason: exitReason || factors[0] || 'Multiple factors',
      currentPrice,
      pnlPercent,
      pnl: position.unrealizedPnL,
      quantity: position.quantity,
      indicators: {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        adx: indicators.adx.value
      },
      timestamp: new Date()
    };

    // Log decision
    if (factors.length > 0) {
      logDecision(userId, decision);
    }

    if (shouldExit) {
      websocketServer.sendAIDecision(userId, decision);
    }

    return decision;
  } catch (error) {
    console.error(`[AI Engine] Error evaluating exit for ${symbol}:`, error);
    return { shouldExit: false, reason: error.message };
  }
}

/**
 * Execute entry trade
 * @param {string} userId - User identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Entry decision
 */
async function executeEntry(userId, symbol, decision) {
  const session = sessions.get(userId);
  if (!session) return;

  // Check if auto-trade is enabled
  if (!session.config.autoTrade) {
    websocketServer.sendAlert(userId, {
      type: 'info',
      title: 'Trade Signal',
      message: `BUY signal for ${symbol} (${decision.confidence}% confidence). Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true
    });
    return;
  }

  try {
    // Calculate position size
    const portfolioValue = session.portfolio.cash +
      Array.from(session.portfolio.positions.values()).reduce((sum, p) => sum + p.marketValue, 0);
    const maxPositionValue = portfolioValue * (session.config.maxPositionSizePercent / 100);
    const riskAmount = portfolioValue * (session.config.riskPerTradePercent / 100);

    // Position size based on ATR/risk
    const riskPerShare = decision.currentPrice - decision.stopLoss;
    const sharesFromRisk = Math.floor(riskAmount / riskPerShare);
    const sharesFromMaxSize = Math.floor(maxPositionValue / decision.currentPrice);
    const quantity = Math.min(sharesFromRisk, sharesFromMaxSize);

    if (quantity < 1) {
      console.log(`[AI Engine] Position size too small for ${symbol}`);
      return;
    }

    // Place order via Alpaca
    const order = await alpacaClient.placeOrder({
      symbol,
      qty: quantity,
      side: 'buy',
      type: 'market',
      time_in_force: 'day'
    });

    console.log(`[AI Engine] Entry order placed: ${quantity} ${symbol} @ market`);

    // Send notification
    websocketServer.sendTradeExecution(userId, {
      tradeId: order.id,
      symbol,
      side: 'buy',
      quantity,
      price: decision.currentPrice,
      totalValue: quantity * decision.currentPrice,
      status: 'submitted'
    });

    // Update stats
    session.stats.totalTrades++;

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(userId), 2000);
  } catch (error) {
    console.error(`[AI Engine] Failed to execute entry for ${symbol}:`, error);
    websocketServer.sendAlert(userId, {
      type: 'error',
      title: 'Order Failed',
      message: `Failed to buy ${symbol}: ${error.message}`,
      severity: 'high'
    });
  }
}

/**
 * Execute exit trade
 * @param {string} userId - User identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Exit decision
 */
async function executeExit(userId, symbol, decision) {
  const session = sessions.get(userId);
  if (!session) return;

  // Check if auto-trade is enabled
  if (!session.config.autoTrade) {
    websocketServer.sendAlert(userId, {
      type: 'warning',
      title: 'Exit Signal',
      message: `SELL signal for ${symbol}: ${decision.exitReason}. Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true
    });
    return;
  }

  try {
    // Close position via Alpaca
    const result = await alpacaClient.closePosition(symbol);

    console.log(`[AI Engine] Exit order placed for ${symbol}`);

    // Update stats
    if (decision.pnl > 0) {
      session.stats.wins++;
      session.stats.consecutiveLosses = 0;
    } else {
      session.stats.losses++;
      session.stats.consecutiveLosses++;

      // Check circuit breaker
      if (session.stats.consecutiveLosses >= session.config.consecutiveLossLimit) {
        triggerCircuitBreaker(userId, 'Consecutive loss limit reached');
      }
    }
    session.stats.totalPnL += decision.pnl;

    // Check daily loss limit
    const dailyPnLPercent = (session.stats.totalPnL / session.portfolio.initialValue) * 100;
    if (dailyPnLPercent <= -session.config.dailyLossLimitPercent) {
      triggerCircuitBreaker(userId, 'Daily loss limit reached');
    }

    // Send notification
    websocketServer.sendTradeExecution(userId, {
      tradeId: result.id || uuidv4(),
      symbol,
      side: 'sell',
      quantity: decision.quantity,
      price: decision.currentPrice,
      totalValue: decision.quantity * decision.currentPrice,
      pnl: decision.pnl,
      status: 'submitted'
    });

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(userId), 2000);
  } catch (error) {
    console.error(`[AI Engine] Failed to execute exit for ${symbol}:`, error);
    websocketServer.sendAlert(userId, {
      type: 'error',
      title: 'Exit Failed',
      message: `Failed to sell ${symbol}: ${error.message}`,
      severity: 'high'
    });
  }
}

/**
 * Trigger circuit breaker
 * @param {string} userId - User identifier
 * @param {string} reason - Reason for triggering
 */
function triggerCircuitBreaker(userId, reason) {
  const session = sessions.get(userId);
  if (!session) return;

  session.circuitBreakerTriggered = true;
  session.status = 'paused';

  console.log(`[AI Engine] Circuit breaker triggered for ${userId}: ${reason}`);

  websocketServer.sendAlert(userId, {
    type: 'error',
    title: 'Circuit Breaker Triggered',
    message: `Trading paused: ${reason}. Review positions and resume manually.`,
    severity: 'critical',
    actionRequired: true
  });
}

/**
 * Log decision for audit trail
 * @param {string} userId - User identifier
 * @param {object} decision - Decision to log
 */
function logDecision(userId, decision) {
  const session = sessions.get(userId);
  if (!session) return;

  session.decisions.push({
    ...decision,
    id: uuidv4(),
    timestamp: new Date()
  });

  // Keep only last 1000 decisions
  if (session.decisions.length > 1000) {
    session.decisions = session.decisions.slice(-1000);
  }

  // Also store in decision history
  const history = decisionHistory.get(session.sessionId) || [];
  history.push(decision);
  decisionHistory.set(session.sessionId, history);
}

/**
 * Get decision history for a session
 * @param {string} sessionId - Session identifier
 * @param {number} limit - Maximum number of decisions to return
 * @returns {Array} Decision history
 */
function getDecisionHistory(sessionId, limit = 100) {
  const history = decisionHistory.get(sessionId) || [];
  return history.slice(-limit);
}

/**
 * Update session configuration
 * @param {string} userId - User identifier
 * @param {object} newConfig - New configuration
 */
function updateConfig(userId, newConfig) {
  const session = sessions.get(userId);
  if (!session) return;

  session.config = { ...session.config, ...newConfig };
  console.log(`[AI Engine] Config updated for ${userId}`);
}

/**
 * Manual trade override
 * @param {string} userId - User identifier
 * @param {string} symbol - Stock symbol
 * @param {string} action - 'buy' or 'sell'
 * @param {number} quantity - Quantity to trade
 */
async function manualOverride(userId, symbol, action, quantity) {
  const session = sessions.get(userId);
  if (!session) return { error: 'No active session' };

  try {
    if (action === 'buy') {
      const order = await alpacaClient.placeOrder({
        symbol,
        qty: quantity,
        side: 'buy',
        type: 'market',
        time_in_force: 'day'
      });

      logDecision(userId, {
        symbol,
        action: 'MANUAL_BUY',
        quantity,
        timestamp: new Date()
      });

      return { success: true, orderId: order.id };
    } else if (action === 'sell') {
      const result = await alpacaClient.closePosition(symbol);

      logDecision(userId, {
        symbol,
        action: 'MANUAL_SELL',
        quantity,
        timestamp: new Date()
      });

      return { success: true, orderId: result.id };
    }
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get daily performance summary
 * @param {string} userId - User identifier
 * @returns {object} Performance summary
 */
function getDailySummary(userId) {
  const session = sessions.get(userId);
  if (!session) return null;

  const winRate =
    session.stats.totalTrades > 0
      ? ((session.stats.wins / session.stats.totalTrades) * 100).toFixed(1)
      : 0;

  return {
    totalTrades: session.stats.totalTrades,
    wins: session.stats.wins,
    losses: session.stats.losses,
    winRate: parseFloat(winRate),
    totalPnL: session.stats.totalPnL,
    totalPnLPercent: (session.stats.totalPnL / session.portfolio.initialValue) * 100,
    maxDrawdown: session.stats.maxDrawdown,
    positions: Array.from(session.portfolio.positions.values())
  };
}

module.exports = {
  startSession,
  stopSession,
  pauseSession,
  resumeSession,
  getSessionStatus,
  evaluateEntry,
  evaluateExit,
  updateConfig,
  manualOverride,
  getDailySummary,
  getDecisionHistory,
  isMarketOpen,
  syncPortfolio
};
