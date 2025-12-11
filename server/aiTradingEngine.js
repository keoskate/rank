/**
 * AI Trading Engine
 *
 * Core autonomous trading system that makes buy/sell decisions based on
 * technical indicators, pattern recognition, and adaptive strategies.
 */

const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const {
  differenceInMinutes,
  format,
  isWithinInterval,
  parseISO,
} = require('date-fns');
const technicalIndicators = require('./technicalIndicatorsService');
const alpacaClient = require('./alpacaClient');
const polygonClient = require('./polygonClient');
const websocketServer = require('./websocketServer');

// Session persistence file
const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Active trading sessions
const sessions = new Map();

// Decision history for audit
const decisionHistory = new Map();

/**
 * Save sessions to file for persistence
 */
function saveSessions() {
  try {
    const sessionsData = {};
    sessions.forEach((session, sessionId) => {
      // Exclude intervalId (Timeout reference) to avoid circular JSON
      const { intervalId, ...sessionWithoutInterval } = session;
      sessionsData[sessionId] = {
        ...sessionWithoutInterval,
        portfolio: {
          ...session.portfolio,
          positions: Array.from(session.portfolio.positions.entries()),
        },
      };
    });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionsData, null, 2));
  } catch (err) {
    console.error('[AI Engine] Failed to save sessions:', err.message);
  }
}

/**
 * Load sessions from file on startup
 */
function loadSessions() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      Object.entries(data).forEach(([sessionId, session]) => {
        // Restore Map from array
        session.portfolio.positions = new Map(
          session.portfolio.positions || []
        );
        // Convert dates
        session.startTime = new Date(session.startTime);
        if (session.endTime) session.endTime = new Date(session.endTime);
        sessions.set(sessionId, session);

        // Restart trading loop if session was running
        if (session.status === 'running') {
          console.log(
            `[AI Engine] Restoring running session "${session.name}" (${sessionId})`
          );
          startTradingLoop(sessionId);
        }
      });
      console.log(`[AI Engine] Loaded ${sessions.size} session(s) from disk`);
    }
  } catch (err) {
    console.error('[AI Engine] Failed to load sessions:', err.message);
  }
}

// Load sessions on module initialization
loadSessions();

// Trading hours (Eastern Time)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Default configuration
const DEFAULT_CONFIG = {
  name: 'Default Strategy',
  timeframes: ['scalping', 'dayTrading', 'swing'],
  maxPositions: 5,
  maxPositionSizePercent: 10,
  riskPerTradePercent: 2,
  dailyLossLimitPercent: 5,
  consecutiveLossLimit: 3,
  profitTargetMultiplier: 2, // 2x ATR
  stopLossMultiplier: 1.5, // 1.5x ATR
  minConfidence: 40, // Lower threshold for paper trading
  watchlist: [],
  autoTrade: true, // Enable auto-trading by default for paper account
  simulationMode: true, // Tracks virtual P&L without real trades
  // Exit settings (percentage-based):
  // takeProfitPercent: 2,     // Take profit at +2% (default)
  // stopLossPercent: 1,       // Stop loss at -1% (default)
  // trailingStopPercent: 0,   // Trailing stop disabled by default (set to e.g. 0.5 to enable)
};

/**
 * Initialize a new trading session
 * Now supports multiple sessions per user by using sessionId as the key
 * @param {string} userId - User identifier
 * @param {object} config - Session configuration
 * @returns {object} Session info
 */
function startSession(userId, config = {}) {
  const sessionId = uuidv4();
  const sessionConfig = { ...DEFAULT_CONFIG, ...config };

  // Generate a unique name if not provided
  if (!sessionConfig.name || sessionConfig.name === 'Default Strategy') {
    const existingSessions = getAllUserSessions(userId);
    sessionConfig.name = `Strategy ${existingSessions.length + 1}`;
  }

  const session = {
    sessionId,
    userId,
    name: sessionConfig.name,
    status: 'running',
    startTime: new Date(),
    config: sessionConfig,
    portfolio: {
      cash: 100000, // Virtual cash for simulation
      positions: new Map(),
      initialValue: 100000,
    },
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      consecutiveLosses: 0,
      peakValue: 100000,
      maxDrawdown: 0,
      winRate: 0,
    },
    decisions: [],
    alerts: [],
    circuitBreakerTriggered: false,
  };

  // Use sessionId as the key to allow multiple sessions
  sessions.set(sessionId, session);
  decisionHistory.set(sessionId, []);

  console.log(
    `[AI Engine] Session "${sessionConfig.name}" started for user ${userId}: ${sessionId}`
  );

  // Save to disk for persistence
  saveSessions();

  // Start the trading loop
  startTradingLoop(sessionId);

  return {
    sessionId,
    name: sessionConfig.name,
    status: 'running',
    config: sessionConfig,
    startTime: session.startTime,
  };
}

/**
 * Get all sessions for a user
 * @param {string} userId - User identifier
 * @returns {Array} Array of session summaries
 */
function getAllUserSessions(userId) {
  const userSessions = [];
  sessions.forEach((session, sessionId) => {
    if (session.userId === userId) {
      // Get recent decisions (last 3) for preview
      const recentDecisions = (session.decisions || [])
        .slice(-3)
        .map(d => ({
          action: d.action,
          symbol: d.symbol,
          reason: d.reason,
          timestamp: d.timestamp,
        }));

      userSessions.push({
        sessionId,
        name: session.name || session.config?.name || 'Unnamed',
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        lastActivity: session.lastActivity || session.endTime || session.startTime,
        stats: session.stats,
        config: session.config,
        watchlist: session.config?.watchlist || [],
        watchlistCount: session.config?.watchlist?.length || 0,
        positionCount: session.portfolio?.positions?.size || 0,
        totalDecisions: (session.decisions || []).length,
        recentDecisions,
      });
    }
  });
  return userSessions;
}

/**
 * Stop a trading session
 * @param {string} sessionId - Session identifier (or legacy userId)
 * @returns {object} Session summary
 */
function stopSession(sessionId) {
  // Support both sessionId and legacy userId lookup
  let session = sessions.get(sessionId);
  if (!session) {
    // Try to find by userId for backwards compatibility
    sessions.forEach((s, id) => {
      if (s.userId === sessionId && s.status !== 'stopped') {
        session = s;
        sessionId = id;
      }
    });
  }

  if (!session) {
    return { error: 'No active session found' };
  }

  session.status = 'stopped';
  session.endTime = new Date();

  const summary = {
    sessionId: session.sessionId,
    name: session.name,
    duration: differenceInMinutes(session.endTime, session.startTime),
    stats: session.stats,
    totalDecisions: session.decisions.length,
    finalPositions: Array.from(session.portfolio.positions.values()),
  };

  console.log(`[AI Engine] Session "${session.name}" stopped: ${sessionId}`);

  // Save to disk
  saveSessions();

  return summary;
}

/**
 * Delete a trading session permanently
 * @param {string} sessionId - Session identifier
 * @returns {object} Deletion result
 */
function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { error: 'Session not found', sessionId };
  }

  const sessionName = session.name;

  // Remove from memory
  sessions.delete(sessionId);
  decisionHistory.delete(sessionId);

  // Save to disk
  saveSessions();

  console.log(`[AI Engine] Session "${sessionName}" deleted: ${sessionId}`);

  return {
    success: true,
    sessionId,
    name: sessionName,
    message: `Session "${sessionName}" has been permanently deleted`,
  };
}

/**
 * Pause a trading session
 * @param {string} sessionId - Session identifier
 */
function pauseSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = 'paused';
    console.log(`[AI Engine] Session "${session.name}" paused: ${sessionId}`);
    saveSessions();
  }
}

/**
 * Resume a trading session
 * @param {string} sessionId - Session identifier
 */
function resumeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.status === 'paused') {
    session.status = 'running';
    session.circuitBreakerTriggered = false;
    session.stats.consecutiveLosses = 0;
    console.log(`[AI Engine] Session "${session.name}" resumed: ${sessionId}`);
    saveSessions();
    // Restart trading loop
    startTradingLoop(sessionId);
  }
}

/**
 * Get session status - supports both sessionId and userId
 * @param {string} id - Session ID or User ID
 * @returns {object} Session status or array of sessions
 */
function getSessionStatus(id) {
  // First try to get by sessionId
  let session = sessions.get(id);

  // If not found, try to find first active session for userId (backwards compatibility)
  if (!session) {
    sessions.forEach(s => {
      if (s.userId === id && s.status !== 'stopped' && !session) {
        session = s;
      }
    });
  }

  if (!session) return null;

  return {
    sessionId: session.sessionId,
    name: session.name,
    status: session.status,
    startTime: session.startTime,
    config: session.config,
    stats: session.stats,
    positions: Array.from(session.portfolio.positions.values()),
    recentDecisions: session.decisions.slice(-10),
    circuitBreakerTriggered: session.circuitBreakerTriggered,
    alerts: session.alerts.slice(-10),
  };
}

/**
 * Get specific session by ID
 * @param {string} sessionId - Session identifier
 * @returns {object} Session status
 */
function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return {
    sessionId: session.sessionId,
    name: session.name,
    userId: session.userId,
    status: session.status,
    startTime: session.startTime,
    config: session.config,
    stats: session.stats,
    positions: Array.from(session.portfolio.positions.values()),
    recentDecisions: session.decisions.slice(-10),
    circuitBreakerTriggered: session.circuitBreakerTriggered,
    alerts: session.alerts.slice(-10),
  };
}

/**
 * Main trading loop
 * @param {string} sessionId - Session identifier
 */
async function startTradingLoop(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Sync portfolio with Alpaca
  await syncPortfolio(sessionId);

  // Trading interval (check every 30 seconds)
  const interval = setInterval(async () => {
    const currentSession = sessions.get(sessionId);

    if (!currentSession || currentSession.status !== 'running') {
      clearInterval(interval);
      return;
    }

    // Check if market is open
    if (!isMarketOpen()) {
      // Send status update
      websocketServer.sendAlert(currentSession.userId, {
        type: 'info',
        title: 'Market Closed',
        message: `[${currentSession.name}] Waiting for market to open...`,
        severity: 'low',
      });
      return;
    }

    // Check circuit breaker
    if (currentSession.circuitBreakerTriggered) {
      return;
    }

    try {
      // Analyze watchlist and make decisions
      await analyzeAndTrade(sessionId);
    } catch (error) {
      console.error(`[AI Engine] Error in trading loop:`, error);
      websocketServer.sendAlert(currentSession.userId, {
        type: 'error',
        title: 'Trading Error',
        message: `[${currentSession.name}] ${error.message}`,
        severity: 'high',
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
 * @param {string} sessionId - Session identifier
 */
async function syncPortfolio(sessionId) {
  const session = sessions.get(sessionId);
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

    // Update positions (preserve entryTime and highWaterMark from existing positions if available)
    // Note: alpacaClient.getPositions() returns camelCase fields (quantity, avgEntryPrice, etc.)
    const existingPositions = new Map(session.portfolio.positions);
    session.portfolio.positions.clear();
    positions.forEach(pos => {
      const existing = existingPositions.get(pos.symbol);
      const currentPrice = pos.currentPrice || parseFloat(pos.current_price) || 0;
      const avgEntryPrice = pos.avgEntryPrice || parseFloat(pos.avg_entry_price) || 0;

      // Track high water mark for trailing stop - update if current price is higher
      const existingHighWaterMark = existing?.highWaterMark || avgEntryPrice;
      const highWaterMark = Math.max(existingHighWaterMark, currentPrice);

      session.portfolio.positions.set(pos.symbol, {
        symbol: pos.symbol,
        quantity: pos.quantity || parseInt(pos.qty) || 0,
        averageCost: avgEntryPrice,
        currentPrice: currentPrice,
        marketValue: pos.marketValue || parseFloat(pos.market_value) || 0,
        unrealizedPnL: pos.unrealizedPL || parseFloat(pos.unrealized_pl) || 0,
        unrealizedPnLPercent:
          pos.unrealizedPLPercent || parseFloat(pos.unrealized_plpc) * 100 || 0,
        side: pos.side,
        // Preserve entry time from previous sync, or use created_at from Alpaca
        entryTime:
          existing?.entryTime || pos.created_at || new Date().toISOString(),
        // Track highest price for trailing stop
        highWaterMark: highWaterMark,
      });
    });

    console.log(
      `[AI Engine] Portfolio synced: $${session.portfolio.cash.toFixed(2)} cash, ${session.portfolio.positions.size} positions`
    );

    // Periodically save session state
    saveSessions();
  } catch (error) {
    console.error('[AI Engine] Failed to sync portfolio:', error);
  }
}

/**
 * Analyze watchlist and execute trades
 * @param {string} sessionId - Session identifier
 */
async function analyzeAndTrade(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { watchlist, maxPositions, minConfidence } = session.config;

  // Get current positions
  const currentPositions = Array.from(session.portfolio.positions.keys());

  // First, check existing positions for exit signals
  for (const symbol of currentPositions) {
    const exitDecision = await evaluateExit(sessionId, symbol);
    if (exitDecision.shouldExit) {
      await executeExit(sessionId, symbol, exitDecision);
    }
  }

  // Then, look for entry opportunities if we have capacity
  if (currentPositions.length < maxPositions) {
    for (const symbol of watchlist) {
      if (currentPositions.includes(symbol)) continue;

      const entryDecision = await evaluateEntry(sessionId, symbol);
      if (
        entryDecision.shouldEnter &&
        entryDecision.confidence >= minConfidence
      ) {
        await executeEntry(sessionId, symbol, entryDecision);

        // Don't exceed max positions
        if (session.portfolio.positions.size >= maxPositions) break;
      }
    }
  }
}

/**
 * Evaluate entry conditions for a symbol
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Entry decision
 */
async function evaluateEntry(sessionId, symbol) {
  const session = sessions.get(sessionId);
  if (!session) return { shouldEnter: false };

  try {
    // Get recent candles (5-minute for intraday)
    const candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    });

    if (!candles || candles.length < 50) {
      return { shouldEnter: false, reason: 'Insufficient data' };
    }

    // Calculate all indicators
    const indicators = technicalIndicators.getAllIndicators(candles);
    const signals = indicators.signals;

    // Get config with defaults
    const cfg = session.config;
    const entryStrategy = cfg.entryStrategy || 'balanced';
    const rsiOversold = cfg.rsiOversold || 30;
    const rsiOverbought = cfg.rsiOverbought || 70;
    const volumeMultiplier = cfg.volumeMultiplier || 1.5;
    const minSignalsRequired = cfg.minSignalsRequired || 2;
    const requireVolumeSpike = cfg.requireVolumeSpike !== false;
    const requireTrendAlignment = cfg.requireTrendAlignment !== false;
    const requireRsiSignal = cfg.requireRsiSignal !== false;

    // Decision factors
    const factors = [];
    let signalCount = 0;

    // Current price and VWAP
    const currentPrice = candles[candles.length - 1].close;
    const priceVsVwap = indicators.vwap?.price
      ? ((currentPrice - indicators.vwap.price) / indicators.vwap.price) * 100
      : 0;
    const belowVwap = priceVsVwap < 0;
    const volumeRatio = indicators.volume?.ratio || 1;
    const hasVolumeSpike = volumeRatio >= volumeMultiplier;

    // Strategy-specific signal checks (matching TradingSimulator)
    let strategyMatch = false;

    if (entryStrategy === 'dip' || entryStrategy === 'conservative') {
      // Buy the dip: RSI oversold + below VWAP
      if (indicators.rsi.value < rsiOversold && belowVwap) {
        strategyMatch = true;
        signalCount++;
        factors.push(`RSI oversold (${indicators.rsi.value.toFixed(1)}) + below VWAP`);
      }
    }

    if (entryStrategy === 'momentum' || entryStrategy === 'aggressive') {
      // Momentum: RSI between 50-65 with volume or rising
      if (indicators.rsi.value > 50 && indicators.rsi.value < 65) {
        strategyMatch = true;
        signalCount++;
        factors.push(`RSI momentum zone (${indicators.rsi.value.toFixed(1)})`);
      }
      // Aggressive also catches momentum fading
      if (entryStrategy === 'aggressive' && indicators.rsi.value < 70) {
        strategyMatch = true;
        signalCount++;
        factors.push(`Aggressive entry (RSI < 70)`);
      }
    }

    if (entryStrategy === 'balanced') {
      // Balanced: RSI < 45 + below VWAP
      if (indicators.rsi.value < 45 && belowVwap) {
        strategyMatch = true;
        signalCount++;
        factors.push(`RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP`);
      }
    }

    // Additional confirming signals (configurable)
    if (requireVolumeSpike && hasVolumeSpike) {
      signalCount++;
      factors.push(`Volume spike (${volumeRatio.toFixed(2)}x)`);
    }

    if (requireTrendAlignment && indicators.trend?.shortTerm === 'bullish') {
      signalCount++;
      factors.push('Bullish trend alignment');
    }

    if (requireRsiSignal) {
      if (indicators.rsi.divergence?.bullish) {
        signalCount++;
        factors.push('Bullish RSI divergence');
      } else if (indicators.rsi.value < 40) {
        signalCount++;
        factors.push('RSI oversold zone');
      }
    }

    // MACD confirmation
    if (indicators.macd.bullish || indicators.macd.crossover) {
      signalCount++;
      factors.push(indicators.macd.crossover ? 'MACD bullish crossover' : 'MACD bullish');
    }

    // Bollinger Band oversold
    if (indicators.bollingerBands.percentB < 0.2) {
      signalCount++;
      factors.push('Near lower Bollinger Band');
    }

    // Calculate confidence based on signals
    const confidence = Math.min(15 + signalCount * 15, 100);

    // Entry requirements: strategy match + minimum signals + confidence threshold
    const meetsSignalRequirement = signalCount >= minSignalsRequired;
    const meetsConfidenceRequirement = confidence >= cfg.minConfidence;
    const shouldEnter = strategyMatch && meetsSignalRequirement && meetsConfidenceRequirement;

    // Calculate position size and targets using config percentages
    const atr = indicators.atr?.value || currentPrice * 0.02;
    const takeProfitPercent = cfg.takeProfitPercent || 2;
    const stopLossPercent = cfg.stopLossPercent || 1;

    // Use percentage-based targets (matching simulator)
    const profitTarget = currentPrice * (1 + takeProfitPercent / 100);
    const stopLoss = currentPrice * (1 - stopLossPercent / 100);

    // Adaptive targets based on volatility (if enabled)
    const useAdaptiveTargets = cfg.useAdaptiveTargets !== false;
    const volatilityMultiplier =
      useAdaptiveTargets && indicators.bollingerBands?.bandwidth > 0.05 ? 1.2 : 1.0;
    const adaptiveProfitTarget = currentPrice * (1 + (takeProfitPercent * volatilityMultiplier) / 100);

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
        volumeRatio: indicators.volume.ratio,
      },
      timestamp: new Date(),
    };

    // Log decision
    logDecision(sessionId, decision);

    // Send to websocket (use userId for notifications)
    if (shouldEnter) {
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    return decision;
  } catch (error) {
    console.error(`[AI Engine] Error evaluating entry for ${symbol}:`, error);
    return { shouldEnter: false, reason: error.message };
  }
}

/**
 * Evaluate exit conditions for a position
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Exit decision
 */
async function evaluateExit(sessionId, symbol) {
  const session = sessions.get(sessionId);
  if (!session) return { shouldExit: false };

  const position = session.portfolio.positions.get(symbol);
  if (!position) return { shouldExit: false };

  // Minimum hold time - don't evaluate exit within first 5 minutes of entry
  const MIN_HOLD_MINUTES = 5;
  const entryTime = position.entryTime || position.createdAt;
  if (entryTime) {
    const holdDuration = Date.now() - new Date(entryTime).getTime();
    const holdMinutes = holdDuration / (1000 * 60);
    if (holdMinutes < MIN_HOLD_MINUTES) {
      console.log(
        `[AI Engine] ${symbol}: Holding for ${holdMinutes.toFixed(1)} min (min: ${MIN_HOLD_MINUTES} min)`
      );
      return { shouldExit: false, reason: 'Minimum hold time not reached' };
    }
  }

  try {
    // Get recent candles
    const candles = await polygonClient.getAggregates(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
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

    // Get config with defaults
    const cfg = session.config;
    const takeProfitPercent = cfg.takeProfitPercent || 2;
    const stopLossPercent = cfg.stopLossPercent || 1;
    const exitOnRsiExtreme = cfg.exitOnRsiExtreme !== false;
    const rsiOverbought = cfg.rsiOverbought || 70;

    // Profit target hit (using percentage config)
    if (pnlPercent >= takeProfitPercent) {
      exitScore += 50;
      exitReason = 'Profit target reached';
      factors.push(`Profit target +${takeProfitPercent}% reached (at +${pnlPercent.toFixed(2)}%)`);
    }

    // Stop loss hit (using percentage config)
    if (pnlPercent <= -stopLossPercent) {
      exitScore += 50;
      exitReason = 'Stop loss triggered';
      factors.push(`Stop loss -${stopLossPercent}% triggered (at ${pnlPercent.toFixed(2)}%)`);
    }

    // Trailing stop - now a % of gains to lock in (e.g., 50 means lock in 50% of gains)
    // 0 = disabled, values 0-100 represent % of gains to protect
    const trailingStopOfTP = cfg.trailingStopPercent || 0;
    const entryPrice = position.averageCost;
    if (trailingStopOfTP > 0 && position.highWaterMark && position.highWaterMark > entryPrice && pnlPercent > 0) {
      const gainFromEntry = position.highWaterMark - entryPrice;
      const allowedDropFromHigh = gainFromEntry * (100 - trailingStopOfTP) / 100;
      const triggerPrice = position.highWaterMark - allowedDropFromHigh;
      const lockedInGainPercent = ((triggerPrice - entryPrice) / entryPrice) * 100;

      if (currentPrice <= triggerPrice) {
        exitScore += 45;
        exitReason = 'Trailing stop triggered';
        factors.push(`Trailing stop (locked ${lockedInGainPercent.toFixed(2)}% of ${((position.highWaterMark - entryPrice) / entryPrice * 100).toFixed(2)}% gain)`);
      }
    }

    // RSI overbought (configurable)
    if (exitOnRsiExtreme && indicators.rsi.value > rsiOverbought) {
      exitScore += 20;
      factors.push('RSI overbought');
    }

    // Bearish RSI divergence
    if (indicators.rsi.divergence?.bearish) {
      exitScore += 25;
      factors.push('Bearish RSI divergence');
    }

    // MACD bearish crossover
    if (
      indicators.macd.histogram < 0 &&
      indicators.macd.histogram < indicators.macd.signal * -0.1
    ) {
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
    if (
      indicators.stochastic.overbought &&
      !indicators.stochastic.bullishCross
    ) {
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
        adx: indicators.adx.value,
      },
      timestamp: new Date(),
    };

    // Log decision
    if (factors.length > 0) {
      logDecision(sessionId, decision);
    }

    if (shouldExit) {
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    return decision;
  } catch (error) {
    console.error(`[AI Engine] Error evaluating exit for ${symbol}:`, error);
    return { shouldExit: false, reason: error.message };
  }
}

/**
 * Execute entry trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Entry decision
 */
async function executeEntry(sessionId, symbol, decision) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Check if auto-trade is enabled
  if (!session.config.autoTrade) {
    websocketServer.sendAlert(session.userId, {
      type: 'info',
      title: 'Trade Signal',
      message: `[${session.name}] BUY signal for ${symbol} (${decision.confidence}% confidence). Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true,
    });
    return;
  }

  try {
    // Calculate position size
    const portfolioValue =
      session.portfolio.cash +
      Array.from(session.portfolio.positions.values()).reduce(
        (sum, p) => sum + p.marketValue,
        0
      );

    // Ensure we have valid portfolio value (fetch from Alpaca if needed)
    let effectivePortfolioValue = portfolioValue;
    if (!effectivePortfolioValue || effectivePortfolioValue < 1000) {
      // Fallback: fetch from Alpaca directly
      try {
        const account = await alpacaClient.getAccount();
        effectivePortfolioValue =
          parseFloat(account.equity) ||
          parseFloat(account.portfolio_value) ||
          100000;
        session.portfolio.cash = parseFloat(account.cash) || 0;
        console.log(
          `[AI Engine] Fetched account value: $${effectivePortfolioValue.toFixed(2)}`
        );
      } catch (e) {
        effectivePortfolioValue = 100000; // Default fallback
        console.warn(`[AI Engine] Using default portfolio value: $100,000`);
      }
    }

    const maxPositionValue =
      effectivePortfolioValue * (session.config.maxPositionSizePercent / 100);
    const riskAmount =
      effectivePortfolioValue * (session.config.riskPerTradePercent / 100);

    // Position size based on ATR/risk (with fallback if stopLoss not set)
    let quantity;
    const currentPrice = parseFloat(decision.currentPrice);

    if (!currentPrice || currentPrice <= 0) {
      console.log(
        `[AI Engine] Invalid price for ${symbol}: ${decision.currentPrice}`
      );
      return;
    }

    if (
      decision.stopLoss &&
      decision.stopLoss > 0 &&
      decision.stopLoss < currentPrice
    ) {
      // Risk-based position sizing
      const riskPerShare = currentPrice - decision.stopLoss;
      const sharesFromRisk = Math.floor(riskAmount / riskPerShare);
      const sharesFromMaxSize = Math.floor(maxPositionValue / currentPrice);
      quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
    } else {
      // Fallback: simple max position size based sizing
      quantity = Math.floor(maxPositionValue / currentPrice);
    }

    // Ensure minimum of 1 share, maximum reasonable amount
    quantity = Math.max(1, Math.min(quantity, 1000));

    if (quantity < 1 || isNaN(quantity)) {
      console.log(
        `[AI Engine] Invalid position size for ${symbol}: ${quantity}`
      );
      return;
    }

    console.log(
      `[AI Engine] Calculated position: ${quantity} shares of ${symbol} @ $${currentPrice.toFixed(2)} (max value: $${maxPositionValue.toFixed(2)})`
    );

    // Place order via Alpaca
    const order = await alpacaClient.placeOrder({
      symbol,
      qty: quantity,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });

    console.log(
      `[AI Engine] Entry order placed: ${quantity} ${symbol} @ market`
    );

    // Send notification
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: order.id,
      symbol,
      side: 'buy',
      quantity,
      price: decision.currentPrice,
      totalValue: quantity * decision.currentPrice,
      status: 'submitted',
      sessionName: session.name,
    });

    // Update stats
    session.stats.totalTrades++;

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(sessionId), 2000);
  } catch (error) {
    console.error(`[AI Engine] Failed to execute entry for ${symbol}:`, error);
    websocketServer.sendAlert(session.userId, {
      type: 'error',
      title: 'Order Failed',
      message: `[${session.name}] Failed to buy ${symbol}: ${error.message}`,
      severity: 'high',
    });
  }
}

/**
 * Execute exit trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Exit decision
 */
async function executeExit(sessionId, symbol, decision) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Check if auto-trade is enabled
  if (!session.config.autoTrade) {
    websocketServer.sendAlert(session.userId, {
      type: 'warning',
      title: 'Exit Signal',
      message: `SELL signal for ${symbol}: ${decision.exitReason}. Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true,
    });
    return;
  }

  try {
    // Get the actual position from Alpaca to get accurate quantity
    let quantity = decision.quantity;
    if (!quantity || quantity <= 0) {
      // Fetch position from Alpaca directly
      try {
        const alpacaPosition = await alpacaClient.getPosition(symbol);
        quantity =
          parseInt(alpacaPosition.qty) || parseInt(alpacaPosition.quantity);
      } catch (e) {
        console.error(
          `[AI Engine] Could not get position for ${symbol}:`,
          e.message
        );
        return;
      }
    }

    if (!quantity || quantity <= 0) {
      console.log(`[AI Engine] No valid quantity to sell for ${symbol}`);
      return;
    }

    // Close position via Alpaca
    const result = await alpacaClient.closePosition(symbol);

    console.log(
      `[AI Engine] Exit order placed for ${symbol} (${quantity} shares)`
    );

    // Update stats
    const pnl = decision.pnl || 0;
    if (pnl > 0) {
      session.stats.wins++;
      session.stats.consecutiveLosses = 0;
    } else {
      session.stats.losses++;
      session.stats.consecutiveLosses++;

      // Check circuit breaker
      if (
        session.stats.consecutiveLosses >= session.config.consecutiveLossLimit
      ) {
        triggerCircuitBreaker(sessionId, 'Consecutive loss limit reached');
      }
    }
    session.stats.totalPnL += pnl;

    // Check daily loss limit
    const dailyPnLPercent =
      (session.stats.totalPnL / session.portfolio.initialValue) * 100;
    if (dailyPnLPercent <= -session.config.dailyLossLimitPercent) {
      triggerCircuitBreaker(sessionId, 'Daily loss limit reached');
    }

    // Send notification
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: result.id || uuidv4(),
      symbol,
      side: 'sell',
      quantity: quantity,
      price: decision.currentPrice,
      totalValue: quantity * decision.currentPrice,
      pnl: pnl,
      status: 'submitted',
      sessionName: session.name,
    });

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(sessionId), 2000);
  } catch (error) {
    console.error(`[AI Engine] Failed to execute exit for ${symbol}:`, error);
    websocketServer.sendAlert(session.userId, {
      type: 'error',
      title: 'Exit Failed',
      message: `[${session.name}] Failed to sell ${symbol}: ${error.message}`,
      severity: 'high',
    });
  }
}

/**
 * Trigger circuit breaker
 * @param {string} sessionId - Session identifier
 * @param {string} reason - Reason for triggering
 */
function triggerCircuitBreaker(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.circuitBreakerTriggered = true;
  session.status = 'paused';

  console.log(
    `[AI Engine] Circuit breaker triggered for ${session.name}: ${reason}`
  );

  websocketServer.sendAlert(session.userId, {
    type: 'error',
    title: 'Circuit Breaker Triggered',
    message: `[${session.name}] Trading paused: ${reason}. Review positions and resume manually.`,
    severity: 'critical',
    actionRequired: true,
  });

  saveSessions();
}

/**
 * Log decision for audit trail
 * @param {string} sessionId - Session identifier
 * @param {object} decision - Decision to log
 */
function logDecision(sessionId, decision) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const timestamp = new Date();
  session.decisions.push({
    ...decision,
    id: uuidv4(),
    timestamp,
  });

  // Track last activity for session
  session.lastActivity = timestamp;

  // Keep only last 1000 decisions
  if (session.decisions.length > 1000) {
    session.decisions = session.decisions.slice(-1000);
  }

  // Also store in decision history
  const history = decisionHistory.get(sessionId) || [];
  history.push(decision);
  decisionHistory.set(sessionId, history);
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
 * @param {string} sessionId - Session identifier
 * @param {object} newConfig - New configuration
 */
function updateConfig(sessionId, newConfig) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.config = { ...session.config, ...newConfig };
  if (newConfig.name) {
    session.name = newConfig.name;
  }
  console.log(`[AI Engine] Config updated for ${session.name}`);
  saveSessions();
}

/**
 * Manual trade override
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {string} action - 'buy' or 'sell'
 * @param {number} quantity - Quantity to trade
 */
async function manualOverride(sessionId, symbol, action, quantity) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'No active session' };

  try {
    if (action === 'buy') {
      const order = await alpacaClient.placeOrder({
        symbol,
        qty: quantity,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      });

      logDecision(sessionId, {
        symbol,
        action: 'MANUAL_BUY',
        quantity,
        timestamp: new Date(),
      });

      return { success: true, orderId: order.id };
    } else if (action === 'sell') {
      const result = await alpacaClient.closePosition(symbol);

      logDecision(sessionId, {
        symbol,
        action: 'MANUAL_SELL',
        quantity,
        timestamp: new Date(),
      });

      return { success: true, orderId: result.id };
    }
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Get daily performance summary
 * @param {string} sessionId - Session identifier
 * @returns {object} Performance summary
 */
function getDailySummary(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const winRate =
    session.stats.totalTrades > 0
      ? ((session.stats.wins / session.stats.totalTrades) * 100).toFixed(1)
      : 0;

  return {
    sessionId: session.sessionId,
    name: session.name,
    totalTrades: session.stats.totalTrades,
    wins: session.stats.wins,
    losses: session.stats.losses,
    winRate: parseFloat(winRate),
    totalPnL: session.stats.totalPnL,
    totalPnLPercent:
      (session.stats.totalPnL / session.portfolio.initialValue) * 100,
    maxDrawdown: session.stats.maxDrawdown,
    positions: Array.from(session.portfolio.positions.values()),
  };
}

module.exports = {
  startSession,
  stopSession,
  deleteSession,
  pauseSession,
  resumeSession,
  getSessionStatus,
  getSession,
  getAllUserSessions,
  evaluateEntry,
  evaluateExit,
  updateConfig,
  manualOverride,
  getDailySummary,
  getDecisionHistory,
  isMarketOpen,
  syncPortfolio,
};
