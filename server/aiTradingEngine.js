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
const tradingLogger = require('./tradingLogger');
const assetUtils = require('./assetUtils');
const { sentimentEngine, phaseTracker } = require('./semiconductorSentiment');
const { aiAnalyst } = require('./aiSemiconductorAnalyst');

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

// Cooldown tracking - prevents rapid re-entry after selling
// Map structure: sessionId -> Map(symbol -> lastSellTimestamp)
const tradeCooldowns = new Map();

// Cooldown period in minutes - must wait this long after selling before buying same symbol again
const TRADE_COOLDOWN_MINUTES = 15;

// Error throttling - prevents spam logging of repeated errors
// Map structure: errorKey -> { lastLogged: timestamp, count: number }
const errorThrottle = new Map();
const ERROR_THROTTLE_MINUTES = 5; // Only log same error once per 5 minutes

// Pending orders tracking - prevents duplicate orders during race conditions
// Map structure: sessionId -> Map(symbol -> { orderId, timestamp })
const pendingOrders = new Map();
const PENDING_ORDER_TIMEOUT_MS = 60000; // Clear stale pending orders after 60s

// Sentiment-based session switch throttle - prevents log spam from 10s loop
// Map structure: sessionId -> timestamp of last switch action
const lastSentimentSwitch = new Map();
const SENTIMENT_SWITCH_COOLDOWN_MS = 60000; // 60 second cooldown

// Regime engine registry - reusable sentiment engines keyed by reference symbol
// Allows non-semiconductor sessions to use regime gating (e.g., QQQ for QBTX/QBTZ)
const regimeEngines = new Map();
function getOrCreateRegimeEngine(referenceSymbol) {
  const key = referenceSymbol.toUpperCase();
  if (!regimeEngines.has(key)) {
    const { SemiconductorSentimentEngine } = require('./semiconductorSentiment');
    regimeEngines.set(key, new SemiconductorSentimentEngine({ referenceSymbol: key }));
    console.log(`[AI Engine] Created regime engine for ${key}`);
  }
  return regimeEngines.get(key);
}
// Pre-populate with the existing SOXX singleton
regimeEngines.set('SOXX', sentimentEngine);

// PDT (Pattern Day Trader) state cache
// Cached account info to avoid API spam when checking PDT limits
let pdtStateCache = {
  daytradeCount: 0,
  daytradingBuyingPower: 0,
  isPDT: false,
  lastChecked: null,
  cacheValidMinutes: 1, // Re-check every minute
};

// Entry context tracking for ML learning - stores entry conditions to correlate with outcomes
// Map structure: sessionId -> Map(symbol -> entryContext)
// This enables ML models to learn which entry conditions lead to successful trades
const entryContexts = new Map();

// Leveraged ETF classification for regime-aware trading
// Bullish ETFs profit in up markets, Bearish ETFs profit in down markets
const BULLISH_ETFS = ['SOXL', 'QBTX', 'PLTU', 'TQQQ', 'SPXL', 'UPRO', 'TECL', 'FNGU'];
const BEARISH_ETFS = ['SOXS', 'QBTZ', 'SQQQ', 'SPXS', 'TECS', 'FNGD'];

// Leverage multiplier for leveraged ETFs - used to scale stop-losses appropriately
// A 1% stop on a 3x ETF triggers from a 0.33% underlying move (noise), so we scale by leverage
const ETF_LEVERAGE = {
  'SOXL': 3, 'SOXS': 3, 'QBTX': 3, 'QBTZ': 3,
  'TQQQ': 3, 'SQQQ': 3, 'SPXL': 3, 'SPXS': 3,
  'TECL': 3, 'TECS': 3, 'FNGU': 3, 'FNGD': 3,
  'PLTU': 2, 'PLTZ': 2,
};
function getEtfLeverage(symbol) {
  return ETF_LEVERAGE[symbol.toUpperCase()] || 1;
}

// Bull/Bear ETF pair mapping - used for cross-session conflict detection
const ETF_PAIRS = {
  'SOXL': 'SOXS', 'SOXS': 'SOXL',
  'QBTX': 'QBTZ', 'QBTZ': 'QBTX',
  'TQQQ': 'SQQQ', 'SQQQ': 'TQQQ',
  'SPXL': 'SPXS', 'SPXS': 'SPXL',
  'TECL': 'TECS', 'TECS': 'TECL',
  'FNGU': 'FNGD', 'FNGD': 'FNGU',
};
function getOppositeEtf(symbol) {
  return ETF_PAIRS[symbol.toUpperCase()] || null;
}

// Global position size limits - prevents any single position from dominating portfolio
const GLOBAL_MAX_POSITION_PERCENT = 10;     // No single position > 10% of portfolio
const GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT = 40; // Total across all sessions < 40% of portfolio

/**
 * Detect asset type from watchlist symbols
 * If any symbol in the watchlist is a crypto symbol, return 'crypto'
 * @param {Array<string>} watchlist - List of symbols
 * @returns {string} 'crypto' or 'stocks'
 */
function detectAssetTypeFromWatchlist(watchlist) {
  if (!watchlist || watchlist.length === 0) {
    return assetUtils.ASSET_TYPES.STOCKS;
  }

  // Check if any symbol is a crypto symbol
  for (const symbol of watchlist) {
    const upperSymbol = symbol.toUpperCase();
    if (
      assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
      upperSymbol.includes('/USD') ||
      upperSymbol.startsWith('X:')
    ) {
      return assetUtils.ASSET_TYPES.CRYPTO;
    }
  }

  return assetUtils.ASSET_TYPES.STOCKS;
}

/**
 * Determine ETF type for regime-aware trading
 * @param {string} symbol - Stock symbol
 * @returns {string} 'bullish', 'bearish', or 'neutral'
 */
function getEtfType(symbol) {
  const upperSymbol = symbol.toUpperCase();
  if (BULLISH_ETFS.includes(upperSymbol)) return 'bullish';
  if (BEARISH_ETFS.includes(upperSymbol)) return 'bearish';
  return 'neutral';
}

/**
 * Check if position is counter-trend (e.g., bullish ETF in bear market)
 * @param {string} etfType - 'bullish', 'bearish', or 'neutral'
 * @param {string} marketRegime - 'bull', 'bear', or 'sideways'
 * @returns {boolean} True if position is counter-trend
 */
function isCounterTrend(etfType, marketRegime) {
  if (etfType === 'bullish' && marketRegime === 'bear') return true;
  if (etfType === 'bearish' && marketRegime === 'bull') return true;
  return false;
}

/**
 * Check if position aligns with market regime
 * @param {string} etfType - 'bullish', 'bearish', or 'neutral'
 * @param {string} marketRegime - 'bull', 'bear', or 'sideways'
 * @returns {boolean} True if position aligns with regime
 */
function isRegimeAligned(etfType, marketRegime) {
  if (etfType === 'bullish' && marketRegime === 'bull') return true;
  if (etfType === 'bearish' && marketRegime === 'bear') return true;
  if (etfType === 'neutral') return true;
  return false;
}

/**
 * Check if an error should be throttled (not logged again within window)
 * @param {string} sessionId - Session ID
 * @param {string} errorMessage - Error message to check
 * @returns {boolean} True if error should be throttled (not logged)
 */
function shouldThrottleError(sessionId, errorMessage) {
  const errorKey = `${sessionId}:${errorMessage}`;
  const now = Date.now();
  const throttleMs = ERROR_THROTTLE_MINUTES * 60 * 1000;

  const existing = errorThrottle.get(errorKey);
  if (existing) {
    if (now - existing.lastLogged < throttleMs) {
      existing.count++;
      return true; // Throttle - don't log again yet
    }
    // Window expired, reset
    existing.lastLogged = now;
    const suppressedCount = existing.count;
    existing.count = 0;
    if (suppressedCount > 0) {
      console.log(
        `[AI Engine] (${suppressedCount} similar errors suppressed in last ${ERROR_THROTTLE_MINUTES}m)`
      );
    }
    return false;
  }

  // First occurrence
  errorThrottle.set(errorKey, { lastLogged: now, count: 0 });
  return false;
}

/**
 * Update PDT state cache from Alpaca account info
 * @param {string} tradingMode - 'live' or 'paper'
 * @returns {Promise<object>} PDT state info
 */
async function updatePDTStateCache(tradingMode) {
  const now = Date.now();
  const cacheValidMs = pdtStateCache.cacheValidMinutes * 60 * 1000;

  // Return cached if still valid
  if (pdtStateCache.lastChecked && now - pdtStateCache.lastChecked < cacheValidMs) {
    return pdtStateCache;
  }

  try {
    const account = await alpacaClient.getAccount(tradingMode);
    pdtStateCache = {
      daytradeCount: parseInt(account.daytrade_count || 0, 10),
      daytradingBuyingPower: parseFloat(account.daytrading_buying_power || 0),
      equity: parseFloat(account.equity || 0),
      isPDT: account.pattern_day_trader === true,
      lastChecked: now,
      cacheValidMinutes: 1,
    };

    // Non-PDT accounts under $25k with 3+ day trades are blocked
    pdtStateCache.atPDTLimit =
      !pdtStateCache.isPDT &&
      pdtStateCache.equity < 25000 &&
      pdtStateCache.daytradeCount >= 3;

    return pdtStateCache;
  } catch (err) {
    console.error('[AI Engine] Failed to check PDT status:', err.message);
    return pdtStateCache; // Return stale cache on error
  }
}

/**
 * Check if a new day trade is allowed based on PDT rules
 * @param {string} tradingMode - 'live' or 'paper'
 * @param {object} sessionConfig - Session config with pdtProtection setting
 * @returns {Promise<{allowed: boolean, reason: string|null}>}
 */
async function canExecuteDayTrade(tradingMode, sessionConfig) {
  // Paper trading has no PDT restrictions
  if (tradingMode === 'paper') {
    return { allowed: true, reason: null };
  }

  // If PDT protection is disabled in config, allow all trades
  if (sessionConfig?.pdtProtection === false) {
    return { allowed: true, reason: null };
  }

  const pdtState = await updatePDTStateCache(tradingMode);

  // PDT-flagged accounts have unlimited day trades
  if (pdtState.isPDT) {
    return { allowed: true, reason: null };
  }

  // Non-PDT under $25k with 3+ day trades - blocked
  if (pdtState.atPDTLimit) {
    return {
      allowed: false,
      reason: `PDT limit reached (${pdtState.daytradeCount}/3 day trades, $${pdtState.equity.toFixed(0)} equity)`,
    };
  }

  // Check day trading buying power
  if (pdtState.daytradingBuyingPower <= 0) {
    return {
      allowed: false,
      reason: `No day trading buying power ($0)`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Clear stale position state when Alpaca confirms position doesn't exist
 * @param {string} sessionId - Session ID
 * @param {string} symbol - Symbol to clear
 */
function clearStalePositionState(sessionId, symbol) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const hadPosition = session.portfolio.positions.has(symbol);
  if (hadPosition) {
    session.portfolio.positions.delete(symbol);
    saveSessions();
    console.log(
      `[AI Engine] Cleared stale position state for ${symbol} in session "${session.name}"`
    );

    // Also clear entry context
    const sessionContexts = entryContexts.get(sessionId);
    if (sessionContexts) {
      sessionContexts.delete(symbol);
    }
  }
}

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
      let cleanedDecisions = 0;
      Object.entries(data).forEach(([sessionId, session]) => {
        // Restore Map from array
        session.portfolio.positions = new Map(
          session.portfolio.positions || []
        );
        // Convert dates
        session.startTime = new Date(session.startTime);
        if (session.endTime) session.endTime = new Date(session.endTime);

        // Clean up non-actionable decisions (shouldEnter=false and shouldExit=false)
        // These were logged in older versions but clutter the decision feed
        if (session.decisions && session.decisions.length > 0) {
          const before = session.decisions.length;
          session.decisions = session.decisions.filter(
            d => d.shouldEnter === true || d.shouldExit === true
          );
          cleanedDecisions += before - session.decisions.length;
        }

        // Recalculate derived stats from source-of-truth fields (wins/losses)
        // This fixes winRate=0 bug from older versions that didn't persist winRate
        if (session.stats) {
          const wins = session.stats.wins || 0;
          const losses = session.stats.losses || 0;
          session.stats.totalTrades = wins + losses;
          session.stats.winRate = session.stats.totalTrades > 0
            ? parseFloat(((wins / session.stats.totalTrades) * 100).toFixed(1))
            : 0;
        }

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
      if (cleanedDecisions > 0) {
        console.log(
          `[AI Engine] Cleaned ${cleanedDecisions} non-actionable decisions from history`
        );
        saveSessions(); // Save the cleaned data
      }
    }
  } catch (err) {
    console.error('[AI Engine] Failed to load sessions:', err.message);
  }
}

// Load sessions on module initialization
loadSessions();

/**
 * Get the trading mode for a session based on its config
 * @param {object} session - Session object
 * @returns {string} 'paper' or 'live'
 */
function getSessionTradingMode(session) {
  // paperTradeOnly: true = paper mode, false = live mode
  // Default to paper for safety
  return session.config.paperTradeOnly === false ? 'live' : 'paper';
}

// Trading hours (Eastern Time)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Default configuration
// Note: Field names align with frontend TradingConfigContext.jsx for seamless import
const DEFAULT_CONFIG = {
  name: 'Default Strategy',
  assetType: 'stocks', // 'stocks' or 'crypto' - determines API routing and PDT rules
  timeframes: ['dayTrading'],
  maxPositions: 5,
  maxPositionSizePercent: 10,
  riskPerTradePercent: 2,
  dailyLossLimitPercent: 5,
  maxConsecutiveLosses: 3, // Renamed from consecutiveLossLimit to match frontend
  minConfidence: 70, // Match frontend default
  watchlist: [],
  autoTrade: true, // Default ON - the whole point is automated trading
  manageAllPositions: false, // Only manage positions in watchlist (prevents session conflicts)
  // Entry settings
  entryStrategy: 'balanced',
  requireVolumeSpike: true,
  requireTrendAlignment: true,
  requireRsiSignal: true,
  minSignalsRequired: 3,
  rsiOversold: 30,
  rsiOverbought: 70,
  volumeMultiplier: 1.5,
  // Exit settings (percentage-based)
  takeProfitPercent: 2.0,
  stopLossPercent: 1.0,
  trailingStopPercent: 0,
  useAdaptiveTargets: true,
  exitOnRsiExtreme: true,
  // Risk management - stop losses execute even when autoTrade is off
  allowStopLossExit: true,  // CRITICAL: Allow stop loss to execute regardless of autoTrade
  // Semiconductor Strategy Settings
  semiconductorMode: false,          // Enable semiconductor-specific logic (SOXX-based sentiment)
  marketGate: null,                  // null | 'bullish' | 'bearish' | 'any' - direction gate for entry
  marketGateMinConfidence: 60,       // Minimum sentiment confidence to pass gate
  aiSentimentEnabled: false,         // Use Claude for sentiment analysis boost
  maxSoxsHoldMinutes: 120,           // Max hold time for SOXS positions (decay protection)
  allowDirectionSwitch: true,        // Allow switching direction mid-day if confidence is high
  // Regime Gate Settings (for non-semiconductor sessions)
  regimeGateEnabled: false,            // Enable macro regime gating via a reference symbol
  regimeReferenceSymbol: null,         // Reference symbol for regime engine (e.g., 'QQQ', 'SPY')
};

// ============================================================
// SEMICONDUCTOR STRATEGY PRESETS
// ============================================================
// Pre-configured strategies for SOXL/SOXS semiconductor momentum trading

const STRATEGY_PRESETS = {
  SOXL_MOMENTUM: {
    name: 'SOXL Bullish Momentum',
    description: 'Trades SOXL on bullish semiconductor days. Uses AI sentiment analysis.',
    watchlist: ['SOXL'],
    semiconductorMode: true,
    marketGate: 'bullish',
    marketGateMinConfidence: 65,
    entryStrategy: 'momentum',
    takeProfitPercent: 3.0,      // Wider target for 3x leverage
    stopLossPercent: 1.5,        // Tighter stop for leverage
    minSignalsRequired: 2,
    maxPositions: 1,
    maxPositionSizePercent: 30,
    aiSentimentEnabled: true,
    autoTrade: false,            // Require explicit opt-in
  },

  SOXS_HEDGE: {
    name: 'SOXS Bearish Hedge',
    description: 'Trades SOXS as a hedge on bearish semiconductor days. Auto-exits to avoid decay.',
    watchlist: ['SOXS'],
    semiconductorMode: true,
    marketGate: 'bearish',
    marketGateMinConfidence: 70, // Higher confidence for inverse ETF
    entryStrategy: 'conservative',
    takeProfitPercent: 2.0,      // Quicker profit taking (decay)
    stopLossPercent: 1.0,        // Tight stop
    minSignalsRequired: 2,
    maxSoxsHoldMinutes: 120,     // Max 2 hour hold
    maxPositions: 1,
    maxPositionSizePercent: 20,  // Smaller size for hedge
    aiSentimentEnabled: true,
    autoTrade: false,
  },

  SOXL_SOXS_COMBO: {
    name: 'SOXL/SOXS Dynamic',
    description: 'Dynamically trades SOXL or SOXS based on semiconductor sentiment. AI-powered direction.',
    watchlist: ['SOXL', 'SOXS'],
    semiconductorMode: true,
    marketGate: 'any',           // Trades both directions
    marketGateMinConfidence: 60,
    entryStrategy: 'balanced',
    takeProfitPercent: 2.5,
    stopLossPercent: 1.2,
    minSignalsRequired: 2,
    maxSoxsHoldMinutes: 90,      // Shorter hold for SOXS
    maxPositions: 1,             // One at a time
    maxPositionSizePercent: 25,
    aiSentimentEnabled: true,
    allowDirectionSwitch: true,
    autoTrade: false,
  },

  QBTX_QBTZ_COMBO: {
    name: 'QBTX/QBTZ Dynamic',
    description: 'Dynamically trades QBTX or QBTZ based on QQQ regime sentiment. Macro-aware direction.',
    watchlist: ['QBTX', 'QBTZ'],
    semiconductorMode: false,
    regimeGateEnabled: true,
    regimeReferenceSymbol: 'QQQ',
    marketGate: 'any',
    marketGateMinConfidence: 60,
    entryStrategy: 'balanced',
    takeProfitPercent: 2.5,
    stopLossPercent: 1.0,        // Auto-scaled to 3% by leverage-aware stops
    minSignalsRequired: 2,
    maxPositions: 1,
    maxPositionSizePercent: 10,
    allowDirectionSwitch: true,
    autoTrade: false,
  },
};

/**
 * Get a strategy preset by name
 * @param {string} presetName - Name of the preset (e.g., 'SOXL_MOMENTUM')
 * @returns {Object|null} Preset configuration or null if not found
 */
function getStrategyPreset(presetName) {
  return STRATEGY_PRESETS[presetName] || null;
}

/**
 * List all available strategy presets
 * @returns {Array} Array of preset summaries
 */
function listStrategyPresets() {
  return Object.entries(STRATEGY_PRESETS).map(([key, preset]) => ({
    id: key,
    name: preset.name,
    description: preset.description,
    watchlist: preset.watchlist,
    marketGate: preset.marketGate,
    aiEnabled: preset.aiSentimentEnabled,
  }));
}

// ============================================================
// SEMICONDUCTOR SENTIMENT HELPERS
// ============================================================

/**
 * Check if market gate condition is met for a session
 * @param {Object} session - Trading session
 * @param {Object} sentiment - Current semiconductor sentiment from sentimentEngine
 * @returns {Object} { allowed: boolean, reason: string|null }
 */
async function checkMarketGate(session, sentiment) {
  const { marketGate, marketGateMinConfidence } = session.config;

  // No gate configured = always allow
  if (!marketGate) {
    return { allowed: true, reason: null };
  }

  if (!sentiment) {
    return { allowed: false, reason: 'No sentiment data available' };
  }

  // For 'any' gate: allow trading in EITHER direction, just need sufficient confidence.
  // Symbol alignment filtering (bull vs bear) happens later via checkSymbolSentimentAlignment.
  // Use a lower confidence floor (45%) to prevent dead zones where both directions are blocked.
  if (marketGate === 'any') {
    const minConf = marketGateMinConfidence || 60;
    const floorConf = Math.min(minConf, 45); // Never require more than 45% for 'any' gate
    if (sentiment.confidence < floorConf) {
      return {
        allowed: false,
        reason: `Low confidence (${sentiment.confidence}% < ${floorConf}% floor)`,
      };
    }
    return { allowed: true, reason: null };
  }

  // Directional gates: check direction match
  if (marketGate === 'bullish' && sentiment.direction !== 'bullish') {
    return {
      allowed: false,
      reason: `Gate requires bullish sentiment, current: ${sentiment.direction} (${sentiment.confidence}%)`,
    };
  }

  if (marketGate === 'bearish' && sentiment.direction !== 'bearish') {
    return {
      allowed: false,
      reason: `Gate requires bearish sentiment, current: ${sentiment.direction} (${sentiment.confidence}%)`,
    };
  }

  // Check confidence threshold
  if (sentiment.confidence < (marketGateMinConfidence || 60)) {
    return {
      allowed: false,
      reason: `Confidence ${sentiment.confidence}% < required ${marketGateMinConfidence}%`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Auto-switch semiconductor sessions based on sentiment direction.
 * When a session is gate-blocked, find complementary sessions (same semiconductorMode,
 * opposite gate direction) and resume the one matching current sentiment.
 * Auto-pauses the blocked session if it has no open positions.
 * @param {Object} blockedSession - The session that was gate-blocked
 * @param {Object} sentiment - Current sentiment { direction, confidence }
 */
function handleSentimentSessionSwitch(blockedSession, sentiment) {
  if (!sentiment || !sentiment.direction || sentiment.direction === 'neutral') return;
  if (!blockedSession.config.semiconductorMode) return;

  // Throttle: skip if we switched for this session recently
  const lastSwitch = lastSentimentSwitch.get(blockedSession.sessionId);
  if (lastSwitch && Date.now() - lastSwitch < SENTIMENT_SWITCH_COOLDOWN_MS) return;

  const blockedGate = blockedSession.config.marketGate;
  if (!blockedGate || blockedGate === 'any') return; // Only switch directional sessions

  let didSwitch = false;

  // Scan all sessions for complementary semiconductor sessions
  for (const [sid, session] of sessions) {
    if (sid === blockedSession.sessionId) continue;
    if (!session.config.semiconductorMode) continue;
    if (session.status === 'stopped') continue;

    const gate = session.config.marketGate;
    if (!gate || gate === 'any') continue;

    // Resume paused sessions whose gate matches current sentiment
    if (session.status === 'paused' && gate === sentiment.direction) {
      console.log(
        `[AI Engine] Auto-resuming "${session.name}" - sentiment is ${sentiment.direction} (${sentiment.confidence}%)`
      );
      resumeSession(sid);
      didSwitch = true;

      websocketServer.broadcastToAll('trading_alert', {
        id: `${Date.now()}-autoswitch-resume-${sid}`,
        level: 'INFO',
        category: 'SENTIMENT_SWITCH',
        message: `Auto-resumed "${session.name}" — ${sentiment.direction} sentiment (${sentiment.confidence}%)`,
        sessionId: sid,
        sessionName: session.name,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Auto-pause the blocked session if it has no open positions
  if (didSwitch && blockedSession.status === 'running' && blockedSession.portfolio.positions.size === 0) {
    console.log(
      `[AI Engine] Auto-pausing "${blockedSession.name}" - no positions, sentiment favors ${sentiment.direction}`
    );
    pauseSession(blockedSession.sessionId);

    websocketServer.broadcastToAll('trading_alert', {
      id: `${Date.now()}-autoswitch-pause-${blockedSession.sessionId}`,
      level: 'INFO',
      category: 'SENTIMENT_SWITCH',
      message: `Auto-paused "${blockedSession.name}" — no positions, sentiment is ${sentiment.direction}`,
      sessionId: blockedSession.sessionId,
      sessionName: blockedSession.name,
      timestamp: new Date().toISOString(),
    });
  }

  if (didSwitch) {
    lastSentimentSwitch.set(blockedSession.sessionId, Date.now());
  }
}

/**
 * Auto-switch regime-gated sessions based on sentiment direction.
 * Same pattern as handleSentimentSessionSwitch but matches on regimeReferenceSymbol.
 * @param {Object} blockedSession - The session that was regime-gate-blocked
 * @param {Object} sentiment - Current sentiment { direction, confidence }
 */
function handleRegimeSessionSwitch(blockedSession, sentiment) {
  if (!sentiment || !sentiment.direction || sentiment.direction === 'neutral') return;
  if (!blockedSession.config.regimeGateEnabled) return;

  const lastSwitch = lastSentimentSwitch.get(blockedSession.sessionId);
  if (lastSwitch && Date.now() - lastSwitch < SENTIMENT_SWITCH_COOLDOWN_MS) return;

  const blockedGate = blockedSession.config.marketGate;
  if (!blockedGate || blockedGate === 'any') return;

  const refSymbol = blockedSession.config.regimeReferenceSymbol;
  let didSwitch = false;

  for (const [sid, session] of sessions) {
    if (sid === blockedSession.sessionId) continue;
    if (!session.config.regimeGateEnabled) continue;
    if (session.config.regimeReferenceSymbol !== refSymbol) continue;
    if (session.status === 'stopped') continue;

    const gate = session.config.marketGate;
    if (!gate || gate === 'any') continue;

    if (session.status === 'paused' && gate === sentiment.direction) {
      console.log(`[AI Engine] Regime auto-resuming "${session.name}" - ${refSymbol} sentiment is ${sentiment.direction} (${sentiment.confidence}%)`);
      resumeSession(sid);
      didSwitch = true;

      websocketServer.broadcastToAll('trading_alert', {
        id: `${Date.now()}-regime-resume-${sid}`,
        level: 'INFO',
        category: 'REGIME_SWITCH',
        message: `Regime auto-resumed "${session.name}" — ${refSymbol} ${sentiment.direction} (${sentiment.confidence}%)`,
        sessionId: sid,
        sessionName: session.name,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (didSwitch && blockedSession.status === 'running' && blockedSession.portfolio.positions.size === 0) {
    console.log(`[AI Engine] Regime auto-pausing "${blockedSession.name}" - no positions, ${refSymbol} favors ${sentiment.direction}`);
    pauseSession(blockedSession.sessionId);

    websocketServer.broadcastToAll('trading_alert', {
      id: `${Date.now()}-regime-pause-${blockedSession.sessionId}`,
      level: 'INFO',
      category: 'REGIME_SWITCH',
      message: `Regime auto-paused "${blockedSession.name}" — no positions, ${refSymbol} is ${sentiment.direction}`,
      sessionId: blockedSession.sessionId,
      sessionName: blockedSession.name,
      timestamp: new Date().toISOString(),
    });
  }

  if (didSwitch) {
    lastSentimentSwitch.set(blockedSession.sessionId, Date.now());
  }
}

// ============================================================
// CROSS-SESSION POSITION AWARENESS
// ============================================================

/**
 * Scan all running/paused sessions for their current positions.
 * Returns a map of symbols to the sessions holding them with market value.
 * @returns {{ heldSymbols: Set<string>, positionsBySymbol: Map<string, Array> }}
 */
function getGlobalPositionExposure() {
  const heldSymbols = new Set();
  const positionsBySymbol = new Map();

  for (const [sid, session] of sessions) {
    if (session.status !== 'running' && session.status !== 'paused') continue;
    for (const [symbol, position] of session.portfolio.positions) {
      const upper = symbol.toUpperCase();
      heldSymbols.add(upper);
      if (!positionsBySymbol.has(upper)) positionsBySymbol.set(upper, []);
      positionsBySymbol.get(upper).push({
        sessionId: sid,
        sessionName: session.name,
        quantity: position.quantity || 0,
        marketValue: position.marketValue || (position.quantity * (position.currentPrice || 0)),
      });
    }
  }
  return { heldSymbols, positionsBySymbol };
}

/**
 * Check if a new entry is allowed globally (cross-session awareness).
 * Blocks: (a) same symbol already held by another session, (b) opposing ETF held.
 * @param {string} sessionId - Session requesting entry
 * @param {string} symbol - Symbol to enter
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function canEnterGlobally(sessionId, symbol) {
  const { heldSymbols, positionsBySymbol } = getGlobalPositionExposure();
  const upper = symbol.toUpperCase();

  // Check if another session already holds this symbol
  const holders = positionsBySymbol.get(upper);
  if (holders) {
    const otherSessionHolders = holders.filter(h => h.sessionId !== sessionId);
    if (otherSessionHolders.length > 0) {
      return {
        allowed: false,
        reason: `Cross-session block: ${symbol} already held by "${otherSessionHolders[0].sessionName}"`,
      };
    }
  }

  // Check if any session holds the opposing ETF
  const opposite = getOppositeEtf(symbol);
  if (opposite && heldSymbols.has(opposite.toUpperCase())) {
    const oppositeHolders = positionsBySymbol.get(opposite.toUpperCase()) || [];
    return {
      allowed: false,
      reason: `Cross-session block: opposing ETF ${opposite} held by "${oppositeHolders[0]?.sessionName || 'unknown'}"`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Check if a symbol should be filtered based on sentiment direction
 * For semiconductor mode, only trade symbols that align with current sentiment
 * @param {string} symbol - Symbol to check
 * @param {Object} sentiment - Current sentiment
 * @returns {Object} { allowed: boolean, reason: string|null }
 */
function checkSymbolSentimentAlignment(symbol, sentiment) {
  if (!sentiment || sentiment.direction === 'neutral') {
    return { allowed: false, reason: 'Sentiment is neutral - waiting for direction' };
  }

  const etfType = getEtfType(symbol);

  // SOXL should only trade when bullish
  if (etfType === 'bullish' && sentiment.direction !== 'bullish') {
    return {
      allowed: false,
      reason: `${symbol} requires bullish sentiment, current: ${sentiment.direction}`,
    };
  }

  // SOXS should only trade when bearish
  if (etfType === 'bearish' && sentiment.direction !== 'bearish') {
    return {
      allowed: false,
      reason: `${symbol} requires bearish sentiment, current: ${sentiment.direction}`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Check if SOXS position has exceeded max hold time
 * @param {Object} position - Position data
 * @param {number} maxHoldMinutes - Maximum hold time in minutes
 * @returns {Object} { shouldExit: boolean, reason: string|null }
 */
function checkSoxsHoldTime(position, maxHoldMinutes) {
  if (!position || !position.entryTime || !maxHoldMinutes) {
    return { shouldExit: false, reason: null };
  }

  const holdMinutes = differenceInMinutes(new Date(), new Date(position.entryTime));

  if (holdMinutes >= maxHoldMinutes) {
    return {
      shouldExit: true,
      reason: `SOXS max hold time exceeded (${holdMinutes} min >= ${maxHoldMinutes} min limit)`,
    };
  }

  return { shouldExit: false, reason: null };
}

// ============================================================
// ASSET TYPE-AWARE API ROUTING
// ============================================================
// These helper functions route API calls to the correct endpoints
// based on the session's assetType (stocks vs crypto)

/**
 * Get aggregates (price bars) for a symbol, routing to correct API based on asset type
 * @param {string} symbol - Symbol to fetch
 * @param {number} multiplier - Timespan multiplier
 * @param {string} timespan - minute, hour, day, etc.
 * @param {Object} options - { from, to, limit }
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Array} - Array of OHLCV bars
 */
async function getAggregatesForAsset(symbol, multiplier, timespan, options, assetType) {
  if (assetUtils.isCrypto(assetType)) {
    return polygonClient.getCryptoAggregates(symbol, multiplier, timespan, options);
  }
  return polygonClient.getAggregates(symbol, multiplier, timespan, options);
}

/**
 * Get latest quote for a symbol, routing to correct API based on asset type
 * @param {string} symbol - Symbol to fetch
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Object} - Quote data
 */
async function getLatestQuoteForAsset(symbol, assetType) {
  if (assetUtils.isCrypto(assetType)) {
    return alpacaClient.getCryptoLatestQuote(symbol);
  }
  return alpacaClient.getLatestQuote(symbol);
}

/**
 * Place an order, routing to correct API based on asset type
 * @param {Object} orderParams - Order parameters
 * @param {string} tradingMode - 'live' or 'paper'
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Object} - Order result
 */
async function placeOrderForAsset(orderParams, tradingMode, assetType) {
  if (assetUtils.isCrypto(assetType)) {
    return alpacaClient.placeCryptoOrder(orderParams, tradingMode);
  }
  return alpacaClient.placeOrder(orderParams, tradingMode);
}

/**
 * Get positions, routing to correct API based on asset type
 * @param {string} tradingMode - 'live' or 'paper'
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Array} - Array of positions
 */
async function getPositionsForAsset(tradingMode, assetType) {
  if (assetUtils.isCrypto(assetType)) {
    return alpacaClient.getCryptoPositions(tradingMode);
  }
  return alpacaClient.getPositions(tradingMode);
}

/**
 * Close a position, routing to correct API based on asset type
 * @param {string} symbol - Symbol to close
 * @param {string} tradingMode - 'live' or 'paper'
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Object} - Close result
 */
async function closePositionForAsset(symbol, tradingMode, assetType) {
  if (assetUtils.isCrypto(assetType)) {
    return alpacaClient.closeCryptoPosition(symbol, tradingMode);
  }
  return alpacaClient.closePosition(symbol, tradingMode);
}

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
    tradingLog: [], // Persistent trade history for session
    circuitBreakerTriggered: false,
  };

  // Use sessionId as the key to allow multiple sessions
  sessions.set(sessionId, session);
  decisionHistory.set(sessionId, []);

  console.log(
    `[AI Engine] Session "${sessionConfig.name}" started for user ${userId}: ${sessionId}`
  );

  // Log session start with config summary
  tradingLogger.logConfig('Session started', {
    sessionId,
    sessionName: sessionConfig.name,
    config: {
      watchlist:
        sessionConfig.watchlist?.slice(0, 5).join(', ') +
        (sessionConfig.watchlist?.length > 5 ? '...' : ''),
      watchlistCount: sessionConfig.watchlist?.length || 0,
      entryStrategy: sessionConfig.entryStrategy,
      takeProfitPercent: sessionConfig.takeProfitPercent,
      stopLossPercent: sessionConfig.stopLossPercent,
      minConfidence: sessionConfig.minConfidence,
      autoTrade: sessionConfig.autoTrade,
      maxPositions: sessionConfig.maxPositions,
    },
  });

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
      // Get recent decisions (last 3) for preview - include price/pnl data
      const recentDecisions = (session.decisions || []).slice(-3).map(d => ({
        action: d.action,
        symbol: d.symbol,
        reason: d.exitReason || (d.reasons && d.reasons[0]) || d.reason || null,
        reasons: d.reasons || [],
        currentPrice: d.currentPrice,
        confidence: d.confidence,
        pnl: d.pnl,
        pnlPercent: d.pnlPercent,
        quantity: d.quantity,
        timestamp: d.timestamp,
      }));

      // Calculate unrealized P&L from open positions
      let unrealizedPnL = 0;
      const openPositions = [];
      if (session.portfolio?.positions) {
        session.portfolio.positions.forEach((pos) => {
          unrealizedPnL += pos.unrealizedPnL || 0;
          openPositions.push({
            symbol: pos.symbol,
            quantity: pos.quantity,
            averageCost: pos.averageCost,
            currentPrice: pos.currentPrice,
            unrealizedPnL: pos.unrealizedPnL || 0,
            unrealizedPnLPercent: pos.unrealizedPnLPercent || 0,
          });
        });
      }

      // Get recent trades from tradingLog for richer display
      const recentTrades = (session.tradingLog || []).slice(-5).map(t => ({
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        pnl: t.pnl,
        timestamp: t.timestamp,
      }));

      userSessions.push({
        sessionId,
        name: session.name || session.config?.name || 'Unnamed',
        status: session.status,
        startTime: session.startTime,
        endTime: session.endTime,
        lastActivity:
          session.lastActivity || session.endTime || session.startTime,
        stats: {
          ...session.stats,
          // Always recalculate winRate from source-of-truth (wins/losses)
          winRate: (session.stats?.wins + session.stats?.losses) > 0
            ? parseFloat(((session.stats.wins / (session.stats.wins + session.stats.losses)) * 100).toFixed(1))
            : 0,
          totalTrades: (session.stats?.wins || 0) + (session.stats?.losses || 0),
          unrealizedPnL,
          totalPnLWithUnrealized: (session.stats?.totalPnL || 0) + unrealizedPnL,
        },
        config: session.config,
        watchlist: session.config?.watchlist || [],
        watchlistCount: session.config?.watchlist?.length || 0,
        positionCount: session.portfolio?.positions?.size || 0,
        openPositions,
        totalDecisions: (session.decisions || []).length,
        recentDecisions,
        recentTrades,
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
 * @param {object} options - Deletion options
 * @param {boolean} options.closePositions - Whether to sell all positions first (panic sell)
 * @returns {object} Deletion result
 */
async function deleteSession(sessionId, options = {}) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { error: 'Session not found', sessionId };
  }

  const sessionName = session.name;
  const closedPositions = [];
  const errors = [];

  // If closePositions is enabled, sell all positions first (panic sell)
  if (options.closePositions) {
    const tradingMode = getSessionTradingMode(session);
    const positions = Array.from(session.portfolio.positions.values());

    console.log(
      `[AI Engine] PANIC SELL: Closing ${positions.length} positions for session "${sessionName}" (${tradingMode.toUpperCase()})`
    );

    // Get asset type for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';

    for (const position of positions) {
      if (position.quantity > 0) {
        try {
          const order = await placeOrderForAsset(
            {
              symbol: position.symbol,
              qty: position.quantity,
              side: 'sell',
              type: 'market',
              time_in_force: 'day',
            },
            tradingMode,
            sessionAssetType
          );

          closedPositions.push({
            symbol: position.symbol,
            quantity: position.quantity,
            orderId: order.id,
            estimatedLoss: position.unrealizedPnL,
          });

          tradingLogger.logExecution('PANIC_SELL', position.symbol, {
            quantity: position.quantity,
            price: position.currentPrice,
            orderId: order.id,
            sessionId,
            sessionName,
            reason: 'Session deleted - panic sell',
            pnl: position.unrealizedPnL,
            pnlPercent: position.unrealizedPnLPercent,
          });

          console.log(
            `[AI Engine] Panic sold ${position.quantity} ${position.symbol} (P/L: $${position.unrealizedPnL?.toFixed(2) || '?'})`
          );
        } catch (err) {
          console.error(
            `[AI Engine] Failed to panic sell ${position.symbol}:`,
            err.message
          );
          errors.push({
            symbol: position.symbol,
            error: err.message,
          });
        }
      }
    }
  }

  // Stop the session first if it's running
  if (session.status === 'running') {
    stopSession(sessionId);
  }

  // Remove from memory
  sessions.delete(sessionId);
  decisionHistory.delete(sessionId);
  entryContexts.delete(sessionId);
  tradeCooldowns.delete(sessionId);

  // Save to disk
  saveSessions();

  console.log(`[AI Engine] Session "${sessionName}" deleted: ${sessionId}`);

  return {
    success: true,
    sessionId,
    name: sessionName,
    message: `Session "${sessionName}" has been permanently deleted`,
    closedPositions: closedPositions.length > 0 ? closedPositions : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Panic sell - immediately close all positions for a session
 * @param {string} sessionId - Session identifier
 * @returns {object} Result with closed positions
 */
async function panicSell(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { error: 'Session not found', sessionId };
  }

  const sessionName = session.name;
  const tradingMode = getSessionTradingMode(session);
  const closedPositions = [];
  const errors = [];

  // Get all positions (from session AND from Alpaca for the watchlist)
  const sessionPositions = Array.from(session.portfolio.positions.values());
  const watchlistSymbols = session.config.watchlist || [];

  console.log(
    `[AI Engine] PANIC SELL initiated for session "${sessionName}" (${tradingMode.toUpperCase()})`
  );

  // Also check actual Alpaca positions for watchlist symbols
  const assetType = session.config.assetType || 'stocks';
  try {
    const alpacaPositions = await getPositionsForAsset(tradingMode, assetType);
    const watchlistPositions = alpacaPositions.filter(p =>
      watchlistSymbols.includes(p.symbol)
    );

    // Merge with session positions, preferring Alpaca data for accuracy
    const positionsToClose = new Map();

    // Add session positions
    for (const pos of sessionPositions) {
      positionsToClose.set(pos.symbol, {
        symbol: pos.symbol,
        quantity: pos.quantity,
        currentPrice: pos.currentPrice,
        unrealizedPnL: pos.unrealizedPnL,
      });
    }

    // Override with Alpaca positions (more accurate)
    for (const pos of watchlistPositions) {
      positionsToClose.set(pos.symbol, {
        symbol: pos.symbol,
        quantity: parseFloat(pos.qty),
        currentPrice: parseFloat(pos.current_price),
        unrealizedPnL: parseFloat(pos.unrealized_pl),
      });
    }

    // Close each position
    // Get asset type for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';

    for (const [symbol, position] of positionsToClose) {
      if (position.quantity > 0) {
        try {
          const order = await placeOrderForAsset(
            {
              symbol: position.symbol,
              qty: position.quantity,
              side: 'sell',
              type: 'market',
              time_in_force: 'day',
            },
            tradingMode,
            sessionAssetType
          );

          closedPositions.push({
            symbol: position.symbol,
            quantity: position.quantity,
            orderId: order.id,
            estimatedLoss: position.unrealizedPnL,
          });

          tradingLogger.logExecution('PANIC_SELL', position.symbol, {
            quantity: position.quantity,
            price: position.currentPrice,
            orderId: order.id,
            sessionId,
            sessionName,
            reason: 'Manual panic sell',
            pnl: position.unrealizedPnL,
          });

          console.log(
            `[AI Engine] Panic sold ${position.quantity} ${position.symbol}`
          );
        } catch (err) {
          console.error(
            `[AI Engine] Failed to panic sell ${position.symbol}:`,
            err.message
          );
          errors.push({
            symbol: position.symbol,
            error: err.message,
          });
        }
      }
    }
  } catch (err) {
    console.error('[AI Engine] Failed to fetch Alpaca positions:', err.message);
    errors.push({ error: err.message });
  }

  // Clear session positions
  session.portfolio.positions.clear();
  saveSessions();

  // Sync portfolio after panic sell
  setTimeout(() => syncPortfolio(sessionId), 2000);

  return {
    success: true,
    sessionId,
    sessionName,
    closedPositions,
    errors: errors.length > 0 ? errors : undefined,
    message: `Panic sell completed: ${closedPositions.length} positions closed`,
  };
}

/**
 * Clone a trading session with a new name
 * Copies all configuration but starts fresh (no trades/stats)
 * @param {string} sessionId - Source session to clone
 * @param {object} options - Clone options (name, paperTrading)
 * @returns {object} New session info
 */
function cloneSession(sessionId, options = {}) {
  const sourceSession = sessions.get(sessionId);
  if (!sourceSession) {
    return { error: 'Source session not found', sessionId };
  }

  // Deep clone the config
  const clonedConfig = JSON.parse(JSON.stringify(sourceSession.config));

  // Apply overrides from options
  if (options.name) {
    clonedConfig.name = options.name;
  } else {
    clonedConfig.name = `${sourceSession.name} (Copy)`;
  }

  // Set paper trading mode if specified
  if (typeof options.paperTrading === 'boolean') {
    clonedConfig.paperTrading = options.paperTrading;
  }

  // Create new session with cloned config (starts paused so user can review)
  const newSessionId = uuidv4();
  const newSession = {
    sessionId: newSessionId,
    userId: sourceSession.userId,
    name: clonedConfig.name,
    status: 'paused', // Start paused so user can review before running
    startTime: new Date(),
    config: clonedConfig,
    portfolio: {
      cash: 100000,
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
    tradingLog: [], // Persistent trade history for session
    circuitBreakerTriggered: false,
    clonedFrom: sessionId, // Track lineage
  };

  sessions.set(newSessionId, newSession);
  decisionHistory.set(newSessionId, []);

  console.log(
    `[AI Engine] Session "${clonedConfig.name}" cloned from "${sourceSession.name}": ${newSessionId}`
  );

  saveSessions();

  return {
    success: true,
    sessionId: newSessionId,
    name: clonedConfig.name,
    status: 'paused',
    config: clonedConfig,
    clonedFrom: {
      sessionId: sessionId,
      name: sourceSession.name,
    },
    message: `Session cloned successfully. Review settings and resume when ready.`,
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
    recentDecisions: session.decisions.slice(-50),
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
    recentDecisions: session.decisions.slice(-50),
    circuitBreakerTriggered: session.circuitBreakerTriggered,
    alerts: (session.alerts || []).slice(-100), // Return last 100 alerts
    tradingLog: (session.tradingLog || []).slice(-100), // Return last 100 trades
  };
}

/**
 * Add an alert to a session's persistent alerts array
 * @param {string} sessionId - Session identifier
 * @param {object} alert - Alert object { type, title, message, timestamp }
 */
function addSessionAlert(sessionId, alert) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Ensure alerts array exists
  if (!session.alerts) session.alerts = [];

  // Add alert with timestamp if not provided
  session.alerts.push({
    ...alert,
    timestamp: alert.timestamp || new Date().toISOString(),
  });

  // Keep only last 100 alerts to prevent unbounded growth
  if (session.alerts.length > 100) {
    session.alerts = session.alerts.slice(-100);
  }

  // Save session state
  saveSessions();
}

/**
 * Add a trade to a session's persistent trading log
 * @param {string} sessionId - Session identifier
 * @param {object} trade - Trade object { symbol, side, quantity, price, pnl, timestamp }
 */
function addSessionTrade(sessionId, trade) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Ensure tradingLog array exists
  if (!session.tradingLog) session.tradingLog = [];

  // Add trade with timestamp if not provided
  session.tradingLog.push({
    ...trade,
    timestamp: trade.timestamp || new Date().toISOString(),
  });

  // Keep only last 100 trades to prevent unbounded growth
  if (session.tradingLog.length > 100) {
    session.tradingLog = session.tradingLog.slice(-100);
  }

  // Save session state
  saveSessions();
}

/**
 * Main trading loop
 * @param {string} sessionId - Session identifier
 */
async function startTradingLoop(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Sync portfolio with Alpaca
  try {
    await syncPortfolio(sessionId);
  } catch (error) {
    console.error(
      `[AI Engine] Portfolio sync failed for "${session.name}":`,
      error.message
    );
  }

  // Trading interval (check every 10 seconds for faster entry/exit)
  console.log(`[AI Engine] Trading loop started for "${session.name}" (10s interval)`);
  const interval = setInterval(async () => {
    const currentSession = sessions.get(sessionId);

    if (!currentSession || currentSession.status !== 'running') {
      clearInterval(interval);
      return;
    }

    // Check if market is open (skip for crypto - trades 24/7)
    // Auto-detect asset type from watchlist if not explicitly set
    const sessionAssetType = currentSession.config?.assetType ||
      detectAssetTypeFromWatchlist(currentSession.config?.watchlist || []);

    if (assetUtils.marketHoursApply(sessionAssetType) && !isMarketOpen()) {
      // Send status update (only once per hour to avoid spam)
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
      // END-OF-DAY EXIT: Close all positions before market close
      // This prevents overnight exposure for day trading strategies
      const exitBeforeClose = currentSession.config.exitBeforeClose !== false; // Default true
      const exitBeforeCloseMinutes = currentSession.config.exitBeforeCloseMinutes || 15;
      const minutesUntilClose = getMinutesUntilClose();

      if (exitBeforeClose && minutesUntilClose > 0 && minutesUntilClose <= exitBeforeCloseMinutes) {
        const positions = Array.from(currentSession.portfolio.positions.keys());
        if (positions.length > 0) {
          console.log(
            `[AI Engine] ${currentSession.name}: EOD EXIT - ${minutesUntilClose.toFixed(0)} min until close, closing ${positions.length} position(s)`
          );

          for (const symbol of positions) {
            const position = currentSession.portfolio.positions.get(symbol);
            await executeExit(sessionId, symbol, {
              shouldExit: true,
              exitReason: `End-of-day exit (${minutesUntilClose.toFixed(0)} min until close)`,
              reason: `End-of-day exit`,
              currentPrice: position?.currentPrice || 0,
              pnlPercent: position?.unrealizedPnLPercent || 0,
              pnl: position?.unrealizedPnL || 0,
              quantity: position?.quantity || 0,
            });
          }
          return; // Skip normal analysis during EOD exit
        }
      }

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
  }, 10000); // 10-second intervals for faster responsiveness

  // Store interval reference for cleanup
  session.intervalId = interval;
}

/**
 * Get US stock market holidays for a given year
 * @param {number} year - Year to get holidays for
 * @returns {Set<string>} Set of holiday dates in YYYY-MM-DD format
 */
function getMarketHolidays(year) {
  const holidays = new Set();

  // Fixed holidays (adjusted for weekends by market)
  holidays.add(`${year}-01-01`); // New Year's Day
  holidays.add(`${year}-07-04`); // Independence Day
  holidays.add(`${year}-12-25`); // Christmas Day

  // MLK Day (3rd Monday of January)
  const mlk = new Date(year, 0, 1);
  mlk.setDate(1 + ((8 - mlk.getDay()) % 7) + 14);
  holidays.add(mlk.toISOString().split('T')[0]);

  // Presidents Day (3rd Monday of February)
  const presidents = new Date(year, 1, 1);
  presidents.setDate(1 + ((8 - presidents.getDay()) % 7) + 14);
  holidays.add(presidents.toISOString().split('T')[0]);

  // Good Friday (Friday before Easter - approximate)
  // Easter calculation is complex, using fixed dates for known years
  const goodFridays = {
    2024: '2024-03-29', 2025: '2025-04-18', 2026: '2026-04-03',
    2027: '2027-03-26', 2028: '2028-04-14', 2029: '2029-03-30'
  };
  if (goodFridays[year]) holidays.add(goodFridays[year]);

  // Memorial Day (last Monday of May)
  const memorial = new Date(year, 4, 31);
  memorial.setDate(31 - ((memorial.getDay() + 6) % 7));
  holidays.add(memorial.toISOString().split('T')[0]);

  // Juneteenth (June 19)
  holidays.add(`${year}-06-19`);

  // Labor Day (1st Monday of September)
  const labor = new Date(year, 8, 1);
  labor.setDate(1 + ((8 - labor.getDay()) % 7));
  holidays.add(labor.toISOString().split('T')[0]);

  // Thanksgiving (4th Thursday of November)
  const thanksgiving = new Date(year, 10, 1);
  thanksgiving.setDate(1 + ((11 - thanksgiving.getDay()) % 7) + 21);
  holidays.add(thanksgiving.toISOString().split('T')[0]);

  return holidays;
}

/**
 * Get current Eastern Time offset accounting for DST
 * EST = UTC-5 (Nov-Mar), EDT = UTC-4 (Mar-Nov)
 * @returns {number} UTC offset in hours (-5 for EST, -4 for EDT)
 */
function getEasternOffset() {
  // Use Intl to determine if DST is active in US Eastern timezone
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const janOffset = jan.getTimezoneOffset();
  const julOffset = jul.getTimezoneOffset();

  // If the system is in the US Eastern timezone, use its offset directly
  // Otherwise, calculate based on DST rules
  // DST in US: 2nd Sunday in March to 1st Sunday in November
  const month = now.getMonth(); // 0-indexed
  const dayOfMonth = now.getDate();
  const dayOfWeek = now.getDay(); // 0=Sunday

  // March: DST starts 2nd Sunday
  if (month === 2) {
    const secondSunday = 14 - new Date(now.getFullYear(), 2, 1).getDay();
    if (dayOfMonth >= secondSunday) return -4; // EDT
    return -5; // EST
  }
  // November: DST ends 1st Sunday
  if (month === 10) {
    const firstSunday = 7 - new Date(now.getFullYear(), 10, 1).getDay();
    if (firstSunday === 0) firstSunday === 7;
    if (dayOfMonth < firstSunday) return -4; // EDT
    return -5; // EST
  }
  // Apr-Oct: EDT
  if (month >= 3 && month <= 9) return -4;
  // Nov-Feb: EST
  return -5;
}

/**
 * Get current time in Eastern Time as total minutes since midnight
 * @returns {number} Minutes since midnight ET
 */
function getEasternMinutes() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const etOffset = getEasternOffset();
  const etHours = (utcHours + etOffset + 24) % 24;
  const minutes = now.getUTCMinutes();
  return etHours * 60 + minutes;
}

/**
 * Get minutes until market close
 * @returns {number} Minutes until close (negative if market is closed)
 */
function getMinutesUntilClose() {
  const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return marketCloseMinutes - getEasternMinutes();
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

  // Holiday check
  const dateStr = now.toISOString().split('T')[0];
  const holidays = getMarketHolidays(now.getFullYear());
  if (holidays.has(dateStr)) {
    return false;
  }

  const totalMinutes = getEasternMinutes();
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
    // Get the trading mode for this session (paper or live)
    const tradingMode = getSessionTradingMode(session);
    const assetType = session.config.assetType || 'stocks';
    const account = await alpacaClient.getAccount(tradingMode);
    const positions = await getPositionsForAsset(tradingMode, assetType);
    // DEBUG: Log positions from Alpaca with session name
    console.log(`[AI Engine] "${session.name}" synced: ${positions.length} positions (${assetType}, ${tradingMode})`);

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
      const currentPrice =
        pos.currentPrice || parseFloat(pos.current_price) || 0;
      const avgEntryPrice =
        pos.avgEntryPrice || parseFloat(pos.avg_entry_price) || 0;

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
      `[AI Engine] Portfolio synced (${tradingMode.toUpperCase()}): $${session.portfolio.cash.toFixed(2)} cash, ${session.portfolio.positions.size} positions`
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

  // CRITICAL: Sync portfolio from Alpaca before analyzing
  // This ensures we know about all positions for stop loss checks
  await syncPortfolio(sessionId);

  const { watchlist, maxPositions, minConfidence } = session.config;

  // Log only when there are symbols to analyze
  if (watchlist?.length > 0) {
    console.log(
      `[AI Engine] Analyzing ${watchlist.length} symbols for "${session.name}"`
    );
  }

  // ============================================================
  // SEMICONDUCTOR MODE: Get sentiment and check market gates
  // ============================================================
  let sentiment = null;
  let aiAnalysis = null;

  if (session.config.semiconductorMode) {
    // Get current semiconductor sentiment
    sentiment = await sentimentEngine.getSentiment();

    // Check if AI analysis should be triggered (phase transitions, direction changes)
    const aiTrigger = sentimentEngine.shouldTriggerAIAnalysis(sentiment);
    if (aiTrigger.shouldTrigger && session.config.aiSentimentEnabled) {
      console.log(`[AI Engine] ${session.name}: AI analysis triggered - ${aiTrigger.reason}`);
      aiAnalysis = await aiAnalyst.analyze(sentiment, aiTrigger.trigger);

      // Apply AI confidence adjustment
      if (aiAnalysis && aiAnalysis.confidenceAdjustment) {
        const originalConfidence = sentiment.confidence;
        sentiment.confidence = Math.max(0, Math.min(100,
          sentiment.confidence + aiAnalysis.confidenceAdjustment
        ));
        sentiment.aiEnhanced = true;
        sentiment.aiAnalysis = aiAnalysis;
        console.log(
          `[AI Engine] ${session.name}: AI adjusted confidence ${originalConfidence}% -> ${sentiment.confidence}% (${aiAnalysis.confidenceAdjustment > 0 ? '+' : ''}${aiAnalysis.confidenceAdjustment})`
        );
      }
    }

    // Check market gate before proceeding
    const gateCheck = await checkMarketGate(session, sentiment);
    if (!gateCheck.allowed) {
      console.log(`[AI Engine] ${session.name}: Market gate blocked - ${gateCheck.reason}`);

      // Broadcast gate status to frontend
      websocketServer.broadcastToAll('trading_log', {
        id: `${Date.now()}-gate-${session.sessionId}`,
        level: 'INFO',
        category: 'MARKET_GATE',
        message: `Market gate: ${gateCheck.reason}`,
        sessionId: session.sessionId,
        sessionName: session.name,
        sentiment: sentiment ? {
          direction: sentiment.direction,
          confidence: sentiment.confidence,
        } : null,
        timestamp: new Date().toISOString(),
      });

      // Still check existing positions for exit signals even when gate is blocked
      // Filter to watchlist positions only (unless manageAllPositions is set)
      const gateBlockedPositions = Array.from(session.portfolio.positions.keys());
      const watchlistUpperCaseGate = watchlist.map(s => s.toUpperCase());
      const positionsToCheck = session.config.manageAllPositions === true
        ? gateBlockedPositions
        : gateBlockedPositions.filter(symbol => watchlistUpperCaseGate.includes(symbol.toUpperCase()));

      for (const symbol of positionsToCheck) {
        // Check for SOXS hold time limit
        if (symbol.toUpperCase() === 'SOXS' && session.config.maxSoxsHoldMinutes) {
          const position = session.portfolio.positions.get(symbol);
          const holdCheck = checkSoxsHoldTime(position, session.config.maxSoxsHoldMinutes);
          if (holdCheck.shouldExit) {
            console.log(`[AI Engine] ${session.name}: ${holdCheck.reason}`);
            await executeExit(sessionId, symbol, { shouldExit: true, reason: holdCheck.reason });
            continue;
          }
        }

        // Check market phase for force exit
        const forceExitCheck = sentimentEngine.shouldForceExit(symbol);
        if (forceExitCheck.shouldExit) {
          console.log(`[AI Engine] ${session.name}: ${forceExitCheck.reason}`);
          await executeExit(sessionId, symbol, { shouldExit: true, reason: forceExitCheck.reason });
          continue;
        }

        // Regular exit evaluation
        const exitDecision = await evaluateExit(sessionId, symbol);
        if (exitDecision.shouldExit) {
          await executeExit(sessionId, symbol, exitDecision);
        }
      }

      // Auto-switch: resume complementary sessions, pause this one if empty
      handleSentimentSessionSwitch(session, sentiment);

      return; // Skip entry analysis when gate is blocked
    }

    // Check market phase for entry permission
    const phase = sentimentEngine.getMarketPhase();
    if (!phase.tradingAllowed) {
      console.log(`[AI Engine] ${session.name}: Phase ${phase.phase} - no new entries allowed`);
      return;
    }

    // Broadcast sentiment status to frontend
    websocketServer.broadcastToAll('semiconductor_sentiment', {
      sessionId: session.sessionId,
      sessionName: session.name,
      sentiment: {
        direction: sentiment.direction,
        confidence: sentiment.confidence,
        intradayChange: sentiment.intradayChange,
        phase: sentiment.phase,
        thresholds: sentiment.thresholds,
        signals: sentiment.signals,
        aiEnhanced: sentiment.aiEnhanced,
      },
      aiAnalysis: aiAnalysis ? {
        direction: aiAnalysis.direction,
        confidenceAdjustment: aiAnalysis.confidenceAdjustment,
        reasoning: aiAnalysis.reasoning,
        riskLevel: aiAnalysis.riskLevel,
      } : null,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================
  // REGIME GATE: For non-semiconductor sessions with regime gating
  // ============================================================
  if (!session.config.semiconductorMode && session.config.regimeGateEnabled && session.config.regimeReferenceSymbol) {
    const regimeEngine = getOrCreateRegimeEngine(session.config.regimeReferenceSymbol);
    sentiment = await regimeEngine.getSentiment();
    const gateCheck = await checkMarketGate(session, sentiment);
    if (!gateCheck.allowed) {
      console.log(`[AI Engine] ${session.name}: Regime gate blocked (${session.config.regimeReferenceSymbol}) - ${gateCheck.reason}`);

      websocketServer.broadcastToAll('trading_log', {
        id: `${Date.now()}-regime-gate-${session.sessionId}`,
        level: 'INFO',
        category: 'REGIME_GATE',
        message: `Regime gate (${session.config.regimeReferenceSymbol}): ${gateCheck.reason}`,
        sessionId: session.sessionId,
        sessionName: session.name,
        sentiment: sentiment ? { direction: sentiment.direction, confidence: sentiment.confidence } : null,
        timestamp: new Date().toISOString(),
      });

      // Still evaluate exits for held positions (same pattern as semiconductor block)
      const positions = Array.from(session.portfolio.positions.keys());
      const wlUpper = watchlist.map(s => s.toUpperCase());
      const toCheck = session.config.manageAllPositions
        ? positions : positions.filter(s => wlUpper.includes(s.toUpperCase()));
      for (const sym of toCheck) {
        const exitDecision = await evaluateExit(sessionId, sym);
        if (exitDecision.shouldExit) await executeExit(sessionId, sym, exitDecision);
      }
      handleRegimeSessionSwitch(session, sentiment);
      return;
    }

    // Check market phase for entry permission
    const regimePhase = regimeEngine.getMarketPhase();
    if (!regimePhase.tradingAllowed) {
      console.log(`[AI Engine] ${session.name}: Regime phase ${regimePhase.phase} - no new entries allowed`);
      return;
    }
  }

  // Get current positions (now synced from Alpaca)
  const currentPositions = Array.from(session.portfolio.positions.keys());

  // Filter positions to only those in this session's watchlist (unless manageAllPositions is true)
  // This prevents multiple sessions from trying to manage the same positions
  const manageAllPositions = session.config.manageAllPositions === true;
  const watchlistUpperCase = watchlist.map(s => s.toUpperCase());
  const positionsToManage = manageAllPositions
    ? currentPositions
    : currentPositions.filter(symbol => watchlistUpperCase.includes(symbol.toUpperCase()));

  if (currentPositions.length > 0 && positionsToManage.length === 0 && !manageAllPositions) {
    // Log once per session when we're skipping all positions (they're outside our watchlist)
    if (Math.random() < 0.01) { // Log rarely to avoid spam
      console.log(`[AI Engine] ${session.name}: Skipping ${currentPositions.length} positions (none in watchlist: ${watchlist.join(', ')})`);
    }
  }

  // First, check existing positions for exit signals
  for (const symbol of positionsToManage) {
    // SEMICONDUCTOR MODE: Check SOXS hold time limit
    if (session.config.semiconductorMode && symbol.toUpperCase() === 'SOXS' && session.config.maxSoxsHoldMinutes) {
      const position = session.portfolio.positions.get(symbol);
      const holdCheck = checkSoxsHoldTime(position, session.config.maxSoxsHoldMinutes);
      if (holdCheck.shouldExit) {
        console.log(`[AI Engine] ${session.name}: ${holdCheck.reason}`);
        await executeExit(sessionId, symbol, { shouldExit: true, reason: holdCheck.reason });
        continue;
      }
    }

    // SEMICONDUCTOR MODE: Check market phase for force exit
    if (session.config.semiconductorMode) {
      const forceExitCheck = sentimentEngine.shouldForceExit(symbol);
      if (forceExitCheck.shouldExit) {
        console.log(`[AI Engine] ${session.name}: ${forceExitCheck.reason}`);
        await executeExit(sessionId, symbol, { shouldExit: true, reason: forceExitCheck.reason });
        continue;
      }
    }

    const exitDecision = await evaluateExit(sessionId, symbol);
    if (exitDecision.shouldExit) {
      await executeExit(sessionId, symbol, exitDecision);
    }
  }

  // Then, look for entry opportunities if we have capacity
  if (currentPositions.length < maxPositions) {
    // For crypto sessions, normalize position symbols for comparison
    // Alpaca returns positions like "BTCUSD" but watchlist may have "BTC"
    const sessionAssetType = session.config.assetType || 'stocks';
    const normalizedPositions = assetUtils.isCrypto(sessionAssetType)
      ? currentPositions.map(pos => assetUtils.getBaseSymbol(pos))
      : currentPositions;

    for (const symbol of watchlist) {
      // For crypto, compare base symbols (BTC vs BTC, not BTC vs BTCUSD)
      const watchlistBase = assetUtils.isCrypto(sessionAssetType)
        ? assetUtils.getBaseSymbol(symbol)
        : symbol;

      if (normalizedPositions.includes(watchlistBase)) {
        // Already own this asset
        continue;
      }

      // PAIR GUARD: Don't enter if we already hold the opposing ETF in this session
      const opposite = getOppositeEtf(symbol);
      if (opposite && normalizedPositions.map(s => s.toUpperCase()).includes(opposite.toUpperCase())) {
        continue;
      }

      // SEMICONDUCTOR MODE: Check if symbol aligns with current sentiment direction
      if (session.config.semiconductorMode && sentiment) {
        const alignmentCheck = checkSymbolSentimentAlignment(symbol, sentiment);
        if (!alignmentCheck.allowed) {
          // Log but don't spam - only log occasionally
          if (Math.random() < 0.1) { // Log ~10% of the time
            console.log(`[AI Engine] ${session.name}: Skipping ${symbol} - ${alignmentCheck.reason}`);
          }
          continue;
        }

        // Check market phase entry permission for this specific symbol
        const entryCheck = sentimentEngine.canEnterPosition(symbol);
        if (!entryCheck.allowed) {
          console.log(`[AI Engine] ${session.name}: Cannot enter ${symbol} - ${entryCheck.reason}`);
          continue;
        }
      }

      // REGIME GATE: Check symbol alignment for regime-gated sessions
      if (!session.config.semiconductorMode && session.config.regimeGateEnabled && sentiment) {
        const alignmentCheck = checkSymbolSentimentAlignment(symbol, sentiment);
        if (!alignmentCheck.allowed) {
          if (Math.random() < 0.1) {
            console.log(`[AI Engine] ${session.name}: Regime skipping ${symbol} - ${alignmentCheck.reason}`);
          }
          continue;
        }
      }

      // CROSS-SESSION: Block if another session holds this symbol or its opposing ETF
      const globalCheck = canEnterGlobally(sessionId, symbol);
      if (!globalCheck.allowed) {
        if (Math.random() < 0.05) {
          console.log(`[AI Engine] ${session.name}: ${globalCheck.reason}`);
        }
        continue;
      }

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

  // Check cooldown - prevent re-entry too soon after selling
  const sessionCooldowns = tradeCooldowns.get(sessionId);
  if (sessionCooldowns) {
    const lastSellTime = sessionCooldowns.get(symbol);
    if (lastSellTime) {
      const minutesSinceSell = (Date.now() - lastSellTime) / (1000 * 60);
      if (minutesSinceSell < TRADE_COOLDOWN_MINUTES) {
        console.log(
          `[AI Engine] ${symbol}: Cooldown active (${minutesSinceSell.toFixed(1)} of ${TRADE_COOLDOWN_MINUTES} min)`
        );
        return {
          shouldEnter: false,
          reason: `Cooldown: ${(TRADE_COOLDOWN_MINUTES - minutesSinceSell).toFixed(0)} min remaining`,
          cooldownRemaining: TRADE_COOLDOWN_MINUTES - minutesSinceSell,
        };
      }
    }
  }

  try {
    // Get recent candles (5-minute for intraday)
    // Use asset-type-aware helper for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';
    const candles = await getAggregatesForAsset(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    }, sessionAssetType);

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

    // Regime-aware trading: determine market regime and ETF type
    const etfType = getEtfType(symbol);
    const trend = indicators.trend || {};

    // Determine overall market regime from short and medium term trends
    let marketRegime = 'sideways';
    if (trend.shortTerm === 'bullish' && trend.mediumTerm === 'bullish') {
      marketRegime = 'bull';
    } else if (trend.shortTerm === 'bearish' && trend.mediumTerm === 'bearish') {
      marketRegime = 'bear';
    }

    // Check if this trade would be counter-trend
    const isTradeCounterTrend = isCounterTrend(etfType, marketRegime);
    const isTradeAligned = isRegimeAligned(etfType, marketRegime);

    // Decision factors
    const factors = [];
    let signalCount = 0;

    // Current price and VWAP
    const currentPrice = candles[candles.length - 1].close;
    // Note: indicators service returns vwap.value, not vwap.price
    const vwapValue = indicators.vwap?.value || indicators.vwap?.price;
    const priceVsVwap = vwapValue
      ? ((currentPrice - vwapValue) / vwapValue) * 100
      : 0;
    const belowVwap = priceVsVwap < 0;
    const volumeRatio = indicators.volume?.ratio || 1;
    const hasVolumeSpike = volumeRatio >= volumeMultiplier;

    // Strategy-specific signal checks (matching TradingSimulator)
    let strategyMatch = false;

    // Debug logging for every evaluation (helps diagnose why entries aren't triggering)
    console.log(
      `[AI Engine] ${symbol}: Evaluating entry - RSI=${indicators.rsi.value.toFixed(1)}, ` +
      `VWAP=${vwapValue ? vwapValue.toFixed(2) : 'N/A'} (price ${priceVsVwap > 0 ? 'above' : 'below'} by ${Math.abs(priceVsVwap).toFixed(2)}%), ` +
      `Vol=${volumeRatio.toFixed(2)}x, Trend=${indicators.trend?.shortTerm || 'unknown'}, ` +
      `MACD=${indicators.macd.bullish ? 'bullish' : 'bearish'}${indicators.macd.crossover ? ' (crossover)' : ''}, ` +
      `Strategy=${entryStrategy}`
    );

    if (entryStrategy === 'dip' || entryStrategy === 'conservative') {
      // Buy the dip: RSI below threshold + below VWAP
      // For "dip" strategy, use rsiOversold + 15 (e.g., 30 + 15 = 45) for reasonable entries
      // For "conservative" strategy, use strict rsiOversold threshold
      const dipThreshold = entryStrategy === 'dip'
        ? (rsiOversold || 30) + 15  // More lenient: RSI < 45
        : rsiOversold;              // Strict: RSI < 30

      if (indicators.rsi.value < dipThreshold && belowVwap) {
        strategyMatch = true;
        signalCount++;
        signalCount++; // Two signals for meeting both conditions
        factors.push(
          `RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP`
        );
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
      // Balanced: RSI < 45 + below VWAP (matching backtester logic)
      const balancedRsiThreshold = (rsiOversold || 30) + 15; // Default 45
      if (indicators.rsi.value < balancedRsiThreshold && belowVwap) {
        strategyMatch = true;
        signalCount++; // Signal 1: RSI dip
        signalCount++; // Signal 2: Below VWAP (matching backtester - these are two conditions)
        factors.push(
          `RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP`
        );
      }

      // NEW: Momentum bounce - RSI rising from oversold with bullish MACD
      // This captures the "RSI spike" scenario the user described
      if (indicators.rsi.value > rsiOversold &&
          indicators.rsi.value < 55 &&
          (indicators.macd.bullish || indicators.macd.crossover)) {
        strategyMatch = true;
        signalCount++;
        signalCount++;
        factors.push(
          `RSI momentum (${indicators.rsi.value.toFixed(1)}) + bullish MACD`
        );
      }

      // Balanced also gets signal for moderate RSI (not overbought) - matching backtester
      if (indicators.rsi.value < 60) {
        signalCount++;
        factors.push(`RSI neutral (${indicators.rsi.value.toFixed(1)})`);
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
      factors.push(
        indicators.macd.crossover ? 'MACD bullish crossover' : 'MACD bullish'
      );
    }

    // Bollinger Band oversold
    if (indicators.bollingerBands.percentB < 0.2) {
      signalCount++;
      factors.push('Near lower Bollinger Band');
    }

    // Calculate base confidence based on signals (aligned with simulator: 50 + signals * 15, capped at 95)
    let confidence = Math.min(50 + signalCount * 15, 95);

    // REGIME-AWARE CONFIDENCE ADJUSTMENTS
    // Favor trades that align with market regime, penalize counter-trend trades
    if (etfType !== 'neutral') {
      if (isTradeAligned) {
        // Bonus for regime-aligned trades (e.g., bearish ETF in bear market)
        signalCount++;
        confidence = Math.min(confidence + 10, 95);
        factors.push(`Regime-aligned: ${etfType} ETF in ${marketRegime} market`);
      } else if (isTradeCounterTrend) {
        // Penalty for counter-trend trades (e.g., bullish ETF in bear market)
        // Require much higher signals to overcome the disadvantage
        confidence = Math.max(confidence - 20, 0);
        factors.push(`⚠️ Counter-trend: ${etfType} ETF in ${marketRegime} market`);

        // For counter-trend trades, require extra confirmation
        if (signalCount < minSignalsRequired + 1) {
          console.log(
            `[AI Engine] ${symbol}: Counter-trend trade blocked - need ${minSignalsRequired + 1} signals, have ${signalCount}`
          );
          return {
            shouldEnter: false,
            reason: `Counter-trend trade: ${etfType} ETF in ${marketRegime} market requires extra confirmation`,
            etfType,
            marketRegime,
            counterTrend: true,
          };
        }
      }
    }

    // Entry requirements: strategy match + minimum signals + confidence threshold
    const meetsSignalRequirement = signalCount >= minSignalsRequired;
    const meetsConfidenceRequirement = confidence >= cfg.minConfidence;
    const shouldEnter =
      strategyMatch && meetsSignalRequirement && meetsConfidenceRequirement;

    // Only log when there's a potential trade signal
    if (strategyMatch) {
      console.log(
        `[AI Engine] ${symbol}: strategyMatch! RSI=${indicators.rsi.value.toFixed(1)}, VWAP=${priceVsVwap > 0 ? 'above' : 'below'}, signals=${signalCount}, confidence=${confidence}%, regime=${marketRegime}, etfType=${etfType}, shouldEnter=${shouldEnter}`
      );
    }

    // Calculate position size and targets using config percentages
    const atr = indicators.atr?.value || currentPrice * 0.02;
    // Scale stop/target for leveraged ETFs: a 1% stop on 3x ETF = 0.33% underlying move (noise)
    const leverage = getEtfLeverage(symbol);
    const rawTakeProfit = cfg.takeProfitPercent || 2;
    const rawStopLoss = cfg.stopLossPercent || 1;
    const takeProfitPercent = leverage > 1 ? Math.max(rawTakeProfit, rawTakeProfit * leverage) : rawTakeProfit;
    const stopLossPercent = leverage > 1 ? Math.max(rawStopLoss, rawStopLoss * leverage) : rawStopLoss;

    // Use percentage-based targets (matching simulator)
    const profitTarget = currentPrice * (1 + takeProfitPercent / 100);
    const stopLoss = currentPrice * (1 - stopLossPercent / 100);

    // Adaptive targets based on volatility (if enabled)
    const useAdaptiveTargets = cfg.useAdaptiveTargets !== false;
    const volatilityMultiplier =
      useAdaptiveTargets && indicators.bollingerBands?.bandwidth > 0.05
        ? 1.2
        : 1.0;
    const adaptiveProfitTarget =
      currentPrice * (1 + (takeProfitPercent * volatilityMultiplier) / 100);

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

    // Only log decisions that will actually execute (shouldEnter = true)
    // This keeps the decision feed clean and aligned with actual trades
    if (shouldEnter) {
      logDecision(sessionId, decision);
    }

    // ALWAYS send verbose trading log to frontend (regardless of shouldEnter)
    // This gives visibility into what the AI is "thinking"
    // Broadcast to all connected clients so the Trading Log panel can display it
    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldEnter ? 'SIGNAL' : 'INFO',
      category: 'ENTRY_ANALYSIS',
      symbol,
      message: shouldEnter
        ? `BUY signal: ${confidence}% confidence, ${signalCount} signals`
        : `Watching: RSI=${indicators.rsi.value.toFixed(1)}, signals=${signalCount}/${cfg.minSignalCount || 3}, conf=${confidence}%`,
      sessionId: session.sessionId,
      sessionName: session.name,
      data: {
        shouldEnter,
        confidence,
        signalCount,
        minSignalCount: cfg.minSignalCount || 3,
        price: currentPrice,
        indicators: {
          rsi: indicators.rsi.value.toFixed(1),
          macd: indicators.macd.histogram.toFixed(3),
          bbPercentB: (indicators.bollingerBands.percentB * 100).toFixed(1),
          adx: indicators.adx.value.toFixed(1),
          volumeRatio: indicators.volume.ratio.toFixed(2),
        },
        reasons: factors,
        regime: marketRegime,
      },
    });

    // Log to trading logger
    if (shouldEnter) {
      tradingLogger.logSignal('ENTRY', symbol, {
        sessionId,
        sessionName: session.name,
        confidence,
        reasons: factors,
        currentPrice,
        profitTarget: adaptiveProfitTarget,
        stopLoss,
        shouldEnter,
      });

      // Also log indicators for context
      tradingLogger.logIndicators(
        symbol,
        {
          rsi: indicators.rsi.value,
          macd: indicators.macd.histogram,
          adx: indicators.adx.value,
          volumeRatio: indicators.volume.ratio,
          bbPercentB: indicators.bollingerBands.percentB,
        },
        { sessionId, sessionName: session.name }
      );
    }

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
    tradingLogger.logError(`Entry evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
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

  try {
    // Get recent candles first (needed for regime detection)
    // Use asset-type-aware helper for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';
    const candles = await getAggregatesForAsset(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    }, sessionAssetType);

    if (!candles || candles.length < 50) {
      return { shouldExit: false };
    }

    const indicators = technicalIndicators.getAllIndicators(candles);

    // Determine regime for dynamic hold time
    const etfType = getEtfType(symbol);
    const trend = indicators.trend || {};
    let marketRegime = 'sideways';
    if (trend.shortTerm === 'bullish' && trend.mediumTerm === 'bullish') {
      marketRegime = 'bull';
    } else if (trend.shortTerm === 'bearish' && trend.mediumTerm === 'bearish') {
      marketRegime = 'bear';
    }
    const isPositionCounterTrend = isCounterTrend(etfType, marketRegime);

    // Minimum hold time - use session config (default: 10 min normal, 5 min counter-trend)
    // Use || to ensure 0 falls back to default (0 min hold is dangerous)
    const configMinHold = session.config.minHoldMinutes || 10;
    const configCounterTrendHold = session.config.counterTrendMinHoldMinutes || 5;
    const MIN_HOLD_MINUTES = isPositionCounterTrend ? configCounterTrendHold : configMinHold;
    const entryTime = position.entryTime || position.createdAt;
    if (entryTime) {
      const holdDuration = Date.now() - new Date(entryTime).getTime();
      const holdMinutes = holdDuration / (1000 * 60);
      if (holdMinutes < MIN_HOLD_MINUTES) {
        console.log(
          `[AI Engine] ${symbol}: Holding for ${holdMinutes.toFixed(1)} min (min: ${MIN_HOLD_MINUTES} min${isPositionCounterTrend ? ' [counter-trend]' : ''})`
        );
        return { shouldExit: false, reason: 'Minimum hold time not reached' };
      }
    }

    const currentPrice = candles[candles.length - 1].close;
    const pnlPercent = position.unrealizedPnLPercent;

    const factors = [];
    let exitScore = 0;
    let exitReason = '';

    // Get config with defaults - scale for leveraged ETFs
    const cfg = session.config;
    const leverage = getEtfLeverage(symbol);
    const rawTakeProfit = cfg.takeProfitPercent || 2;
    const rawStopLoss = cfg.stopLossPercent || 1;
    const takeProfitPercent = leverage > 1 ? Math.max(rawTakeProfit, rawTakeProfit * leverage) : rawTakeProfit;
    const stopLossPercent = leverage > 1 ? Math.max(rawStopLoss, rawStopLoss * leverage) : rawStopLoss;
    const exitOnRsiExtreme = cfg.exitOnRsiExtreme !== false;
    const rsiOverbought = cfg.rsiOverbought || 70;

    // Exit point values aligned with simulator:
    // - Stop loss: 40 pts (was 50)
    // - Profit target: 30 pts (was 50) - should be confirmed with other signals
    // - Trailing stop: 35 pts (was 45)
    // - RSI overbought: 20 pts (same)
    // - EOD: 50 pts (same as simulator)

    // Profit target hit (using percentage config)
    // If TP is very low (< 0.5%), treat it as aggressive scalping - immediate exit
    // Otherwise needs confirmation from other signals
    if (pnlPercent >= takeProfitPercent) {
      const isAggressiveScalp = takeProfitPercent < 0.5;
      exitScore += isAggressiveScalp ? 100 : 30;  // Immediate exit for scalp mode
      exitReason = 'Profit target reached';
      factors.push(
        `Profit target +${takeProfitPercent}% reached (at +${pnlPercent.toFixed(2)}%)${isAggressiveScalp ? ' [SCALP]' : ''}`
      );
    }

    // Stop loss hit (using percentage config) - IMMEDIATE EXIT (must exceed threshold alone)
    // This is a critical risk management rule - stop loss should ALWAYS trigger exit
    if (pnlPercent <= -stopLossPercent) {
      exitScore += 100; // Guarantee exit - stop loss is non-negotiable
      exitReason = 'Stop loss triggered';
      factors.push(
        `STOP LOSS -${stopLossPercent}% triggered (at ${pnlPercent.toFixed(2)}%)`
      );
    }

    // Trailing stop - now a % of gains to lock in (e.g., 50 means lock in 50% of gains)
    // 0 = disabled, values 0-100 represent % of gains to protect
    // IMPORTANT: Only activates after minimum profit threshold to prevent premature exits
    const trailingStopOfTP = cfg.trailingStopPercent || 0;
    const trailingStopMinProfitPercent = cfg.trailingStopMinProfitPercent || 2; // Default 2% min before trailing activates
    const entryPrice = position.averageCost;
    const highWaterMarkPnlPercent = position.highWaterMark
      ? ((position.highWaterMark - entryPrice) / entryPrice) * 100
      : 0;

    if (
      trailingStopOfTP > 0 &&
      position.highWaterMark &&
      position.highWaterMark > entryPrice &&
      pnlPercent > 0 &&
      highWaterMarkPnlPercent >= trailingStopMinProfitPercent // Only activate after meaningful gain
    ) {
      const gainFromEntry = position.highWaterMark - entryPrice;
      const allowedDropFromHigh =
        (gainFromEntry * (100 - trailingStopOfTP)) / 100;
      const triggerPrice = position.highWaterMark - allowedDropFromHigh;
      const lockedInGainPercent =
        ((triggerPrice - entryPrice) / entryPrice) * 100;

      if (currentPrice <= triggerPrice) {
        exitScore += 35;
        exitReason = 'Trailing stop triggered';
        factors.push(
          `Trailing stop (locked ${lockedInGainPercent.toFixed(2)}% of ${highWaterMarkPnlPercent.toFixed(2)}% gain)`
        );
      }
    } else if (trailingStopOfTP > 0 && pnlPercent > 0 && highWaterMarkPnlPercent < trailingStopMinProfitPercent) {
      // Log that trailing stop is waiting for minimum profit
      factors.push(`Trailing stop waiting (need ${trailingStopMinProfitPercent}% gain, have ${highWaterMarkPnlPercent.toFixed(2)}%)`);
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

    // End of day exit - uses proper timezone calculation
    const minutesUntilClose = getMinutesUntilClose();
    const exitBeforeCloseMinutes = cfg.exitBeforeCloseMinutes || 15;
    const exitBeforeClose = cfg.exitBeforeClose !== false; // Default true

    if (exitBeforeClose && minutesUntilClose > 0 && minutesUntilClose <= exitBeforeCloseMinutes) {
      // Force exit regardless of P&L when approaching market close
      exitScore += 100; // Guaranteed exit - don't hold overnight
      exitReason = `End-of-day exit (${minutesUntilClose.toFixed(0)} min until close)`;
      factors.push(`EOD EXIT: ${minutesUntilClose.toFixed(0)} min until close`);
    } else if (exitBeforeClose && minutesUntilClose > 0 && minutesUntilClose <= 30) {
      // Strong signal to exit within 30 min of close
      exitScore += 50;
      factors.push(`Approaching market close (${minutesUntilClose.toFixed(0)} min)`);
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

    // REGIME-AWARE EXIT PRESSURE
    // Counter-trend positions (e.g., bullish ETF in bear market) get extra exit pressure
    if (isPositionCounterTrend && etfType !== 'neutral') {
      // Add exit pressure for counter-trend positions
      exitScore += 25;
      factors.push(`⚠️ Counter-trend position: ${etfType} ETF in ${marketRegime} market`);

      // If losing on a counter-trend position, increase pressure significantly
      if (pnlPercent < 0) {
        exitScore += 15;
        factors.push('Counter-trend position showing loss - urgent exit');
      }

      // Even small profits should be taken quickly on counter-trend trades
      if (pnlPercent > 0.5) {
        exitScore += 20;
        exitReason = exitReason || 'Taking quick profit on counter-trend trade';
        factors.push('Quick scalp profit on counter-trend trade');
      }
    }

    // MINIMUM PROFIT PROTECTION: Don't exit with tiny profits due to weak signals
    // If profit is positive but under minimum threshold, require MUCH higher exit score
    // (Stop loss at 100 pts still works, but technical signals alone won't trigger exit)
    const minProfitForExit = cfg.minProfitForExitPercent || 1.5; // Default 1.5% minimum
    const isProfitTooSmall = pnlPercent > 0 && pnlPercent < minProfitForExit;
    const effectiveExitThreshold = isProfitTooSmall ? 95 : 50; // 95 threshold for small profits (only stop loss triggers)

    if (isProfitTooSmall && exitScore >= 50 && exitScore < 95) {
      factors.push(`⏳ Holding - profit ${pnlPercent.toFixed(2)}% too small (need ${minProfitForExit}% or stop loss)`);
    }

    // Exit threshold aligned with simulator (was 40, now 50 to match simulator logic)
    // This prevents premature exits from weak signals
    const shouldExit = exitScore >= effectiveExitThreshold;

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

    // Only log decisions that will actually execute (shouldExit = true)
    // This keeps the decision feed clean and aligned with actual trades
    if (shouldExit) {
      logDecision(sessionId, decision);
    }

    // Log to trading logger
    if (shouldExit) {
      tradingLogger.logSignal('EXIT', symbol, {
        sessionId,
        sessionName: session.name,
        exitScore,
        reasons: factors,
        currentPrice,
        shouldExit,
        pnlPercent,
      });
    }

    if (shouldExit) {
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    // ALWAYS log exit evaluation to trading log (verbose mode)
    // This helps debug why positions aren't selling
    const pnlSign = pnlPercent >= 0 ? '+' : '';
    const exitStatus = shouldExit ? 'WILL SELL' : 'HOLDING';
    const thresholdNote = `score ${exitScore}/50`;

    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-exit-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldExit ? 'SIGNAL' : 'INFO',
      symbol,
      sessionId,
      sessionName: session.name,
      message: `EXIT EVAL: ${exitStatus} | P/L: ${pnlSign}${pnlPercent?.toFixed(2)}% | ${thresholdNote} | TP:${takeProfitPercent}% SL:${stopLossPercent}%${factors.length > 0 ? ' | ' + factors.slice(0, 2).join(', ') : ''}`,
      timestamp: new Date().toISOString(),
    });

    return decision;
  } catch (error) {
    console.error(`[AI Engine] Error evaluating exit for ${symbol}:`, error);
    tradingLogger.logError(`Exit evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
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
    // Get the trading mode for this session (needed for all Alpaca calls)
    const tradingMode = getSessionTradingMode(session);

    // PDT PROTECTION: Check if we can day trade before buying in live mode
    // This prevents buying stocks we won't be able to sell same-day due to PDT rules
    // NOTE: PDT rules do NOT apply to crypto (crypto is commodity, not security)
    const assetType = session.config.assetType || 'stocks';
    if (tradingMode === 'live' && assetUtils.pdtApplies(assetType)) {
      try {
        const pdtStatus = await alpacaClient.getPDTStatus('live');

        // If we can't day trade, log risk warning and either block or proceed with caution
        if (!pdtStatus.canDayTrade) {
          tradingLogger.logRisk('PDT LIMIT REACHED', {
            sessionId,
            sessionName: session.name,
            reason: `Day trade limit reached (${pdtStatus.daytradeCount}/${pdtStatus.daytradeLimit})`,
            value: pdtStatus.daytradeCount,
            threshold: pdtStatus.daytradeLimit,
            action: 'Blocking day trade entry - position would need overnight hold',
          });

          websocketServer.sendAlert(session.userId, {
            type: 'warning',
            title: 'PDT Protection',
            message: `[${session.name}] Skipping ${symbol} buy - PDT limit reached (${pdtStatus.daytradeCount}/3). Any new position must be held overnight.`,
            severity: 'high',
            sessionId: session.sessionId,
            sessionName: session.name,
          });

          console.log(
            `[AI Engine] PDT Protection: Blocking ${symbol} buy - day trade limit reached (${pdtStatus.daytradeCount}/3)`
          );

          // Block the trade - can't day trade
          return;
        }

        // Warn if we're getting close to PDT limit
        if (pdtStatus.pdtWarning) {
          tradingLogger.logRisk('PDT WARNING', {
            sessionId,
            sessionName: session.name,
            reason: `Low day trades remaining (${pdtStatus.daytradesRemaining} left)`,
            value: pdtStatus.daytradeCount,
            threshold: pdtStatus.daytradeLimit,
            action: 'Proceeding with caution - consider swing trading',
          });

          websocketServer.sendAlert(session.userId, {
            type: 'warning',
            title: 'PDT Warning',
            message: `[${session.name}] Only ${pdtStatus.daytradesRemaining} day trade(s) remaining. Consider swing trading.`,
            severity: 'medium',
            sessionId: session.sessionId,
            sessionName: session.name,
          });
        }
      } catch (pdtError) {
        // Log but don't block - PDT check is advisory
        console.warn(`[AI Engine] PDT check failed: ${pdtError.message}`);
      }
    }

    // Calculate position size (guard against NaN from corrupted position data)
    const positionsMarketValue = Array.from(session.portfolio.positions.values()).reduce(
      (sum, p) => sum + (parseFloat(p.marketValue) || 0),
      0
    );
    const portfolioValue = (parseFloat(session.portfolio.cash) || 0) + positionsMarketValue;

    // Ensure we have valid portfolio value (fetch from Alpaca if needed)
    let effectivePortfolioValue = portfolioValue;
    if (!effectivePortfolioValue || effectivePortfolioValue < 1000) {
      // Fallback: fetch from Alpaca directly using session-specific mode
      try {
        const account = await alpacaClient.getAccount(tradingMode);
        effectivePortfolioValue =
          parseFloat(account.equity) ||
          parseFloat(account.portfolio_value) ||
          100000;
        session.portfolio.cash = parseFloat(account.cash) || 0;
        console.log(
          `[AI Engine] Fetched account value (${tradingMode.toUpperCase()}): $${effectivePortfolioValue.toFixed(2)}`
        );
      } catch (e) {
        effectivePortfolioValue = 100000; // Default fallback
        console.warn(`[AI Engine] Using default portfolio value: $100,000`);
      }
    }

    // Cap per-position size at the global maximum
    const sessionMaxPercent = session.config.maxPositionSizePercent || 10;
    const effectiveMaxPercent = Math.min(sessionMaxPercent, GLOBAL_MAX_POSITION_PERCENT);
    let maxPositionValue = effectivePortfolioValue * (effectiveMaxPercent / 100);

    if (sessionMaxPercent > GLOBAL_MAX_POSITION_PERCENT) {
      console.log(`[AI Engine] Position size capped: ${sessionMaxPercent}% -> ${effectiveMaxPercent}% for ${symbol}`);
    }

    // Check total exposure across all sessions
    const { positionsBySymbol } = getGlobalPositionExposure();
    let totalExposure = 0;
    for (const [, holders] of positionsBySymbol) {
      for (const h of holders) {
        const mv = h.marketValue || 0;
        if (!isNaN(mv)) totalExposure += mv;
      }
    }
    const totalExposurePercent = effectivePortfolioValue > 0
      ? (totalExposure / effectivePortfolioValue) * 100
      : 0;
    if (totalExposurePercent >= GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT) {
      console.log(`[AI Engine] Total exposure ${totalExposurePercent.toFixed(1)}% >= ${GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT}% cap - blocking ${symbol} entry`);
      return;
    }
    // Reduce max position value if approaching total exposure limit
    const remainingCapacity = (GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT - totalExposurePercent) / 100 * effectivePortfolioValue;
    if (remainingCapacity > 0) {
      maxPositionValue = Math.min(maxPositionValue, remainingCapacity);
    }

    // Guard: ensure maxPositionValue is a valid positive number
    if (!maxPositionValue || isNaN(maxPositionValue) || maxPositionValue <= 0) {
      console.log(`[AI Engine] Invalid maxPositionValue ($${maxPositionValue}) for ${symbol} - portfolioValue=$${effectivePortfolioValue.toFixed(2)}, exposure=${totalExposurePercent.toFixed(1)}%`);
      return;
    }

    const riskAmount =
      effectivePortfolioValue * ((session.config.riskPerTradePercent || 2) / 100);

    // Position size based on ATR/risk (with fallback if stopLoss not set)
    let quantity;
    const currentPrice = parseFloat(decision.currentPrice);
    const isCrypto = assetUtils.isCrypto(assetType);

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
      if (isCrypto) {
        // Crypto supports fractional shares - use precise calculation
        const sharesFromRisk = riskAmount / riskPerShare;
        const sharesFromMaxSize = maxPositionValue / currentPrice;
        quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
      } else {
        const sharesFromRisk = Math.floor(riskAmount / riskPerShare);
        const sharesFromMaxSize = Math.floor(maxPositionValue / currentPrice);
        quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
      }
    } else {
      // Fallback: simple max position size based sizing
      if (isCrypto) {
        // Crypto supports fractional shares
        quantity = maxPositionValue / currentPrice;
      } else {
        quantity = Math.floor(maxPositionValue / currentPrice);
      }
    }

    // For crypto, allow fractional quantities (round to 8 decimal places for precision)
    // For stocks, ensure minimum of 1 share, maximum reasonable amount
    if (isCrypto) {
      // Round to 8 decimal places (standard for crypto)
      quantity = Math.round(quantity * 100000000) / 100000000;
      // Ensure we have at least $10 worth of the asset (Alpaca minimum)
      const minQuantity = 10 / currentPrice;
      if (quantity < minQuantity) {
        console.log(
          `[AI Engine] Position too small for ${symbol}: $${(quantity * currentPrice).toFixed(2)} (min $10)`
        );
        return;
      }
    } else {
      quantity = Math.max(1, Math.min(quantity, 1000));
    }

    if (quantity <= 0 || isNaN(quantity)) {
      console.log(
        `[AI Engine] Invalid position size for ${symbol}: ${quantity}`
      );
      return;
    }

    // Format quantity for logging (crypto shows decimals, stocks show whole numbers)
    const qtyDisplay = isCrypto ? quantity.toFixed(6) : quantity;
    const orderValue = quantity * currentPrice;
    console.log(
      `[AI Engine] Calculated position: ${qtyDisplay} ${isCrypto ? 'units' : 'shares'} of ${symbol} @ $${currentPrice.toFixed(2)} (max value: $${maxPositionValue.toFixed(2)}, mode: ${tradingMode.toUpperCase()})`
    );

    // Pre-check buying power to avoid Alpaca rejection
    // Paper mode: use regular buying_power (not daytrading_buying_power which may be $0)
    // Live mode: use daytrading_buying_power for intraday trades
    try {
      const account = await alpacaClient.getAccount(tradingMode);
      const availableBuyingPower = tradingMode === 'paper'
        ? parseFloat(account.buying_power) || 0
        : parseFloat(account.daytrading_buying_power) || parseFloat(account.buying_power) || 0;

      if (orderValue > availableBuyingPower) {
        console.log(
          `[AI Engine] Insufficient buying power for ${symbol}: need $${orderValue.toFixed(2)}, have $${availableBuyingPower.toFixed(2)} (${tradingMode})`
        );
        // Reduce quantity to fit available buying power
        const maxAffordableQty = isCrypto
          ? availableBuyingPower / currentPrice
          : Math.floor(availableBuyingPower / currentPrice);

        if (maxAffordableQty < 1 || (isCrypto && maxAffordableQty * currentPrice < 10)) {
          console.log(`[AI Engine] Cannot afford minimum position for ${symbol}, skipping`);
          return;
        }

        quantity = maxAffordableQty;
        console.log(`[AI Engine] Reduced position to ${quantity} ${isCrypto ? 'units' : 'shares'} to fit buying power`);
      }
    } catch (bpError) {
      console.warn(`[AI Engine] Buying power check failed: ${bpError.message}, proceeding anyway`);
    }

    // Check for pending order to prevent duplicate buys during race conditions
    if (!pendingOrders.has(sessionId)) {
      pendingOrders.set(sessionId, new Map());
    }
    const sessionPending = pendingOrders.get(sessionId);
    const existingPending = sessionPending.get(symbol);
    if (existingPending) {
      const elapsed = Date.now() - existingPending.timestamp;
      if (elapsed < PENDING_ORDER_TIMEOUT_MS) {
        console.log(
          `[AI Engine] Skipping duplicate BUY for ${symbol} - order ${existingPending.orderId.slice(0, 8)} pending (${(elapsed / 1000).toFixed(1)}s ago)`
        );
        return;
      }
      // Clear stale pending order
      sessionPending.delete(symbol);
    }

    // Mark order as pending before placing
    sessionPending.set(symbol, { orderId: 'pending', timestamp: Date.now() });

    // Place order via Alpaca with session-specific trading mode
    // Use asset-type-aware helper for crypto/stock routing
    let order;
    try {
      order = await placeOrderForAsset(
        {
          symbol,
          qty: quantity,
          side: 'buy',
          type: 'market',
          time_in_force: 'day',
        },
        tradingMode,
        assetType
      );
      // Update pending order with actual order ID
      sessionPending.set(symbol, { orderId: order.id, timestamp: Date.now() });
    } catch (orderError) {
      // Clear pending on failure
      sessionPending.delete(symbol);
      throw orderError;
    }

    console.log(
      `[AI Engine] Entry order placed: ${quantity} ${symbol} @ market (${tradingMode.toUpperCase()})`
    );

    // Poll for actual fill price (market orders fill quickly)
    let filledPrice = decision.currentPrice; // fallback to signal price
    let filledOrder = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500)); // wait 500ms
      try {
        filledOrder = await alpacaClient.getOrderById(order.id, tradingMode);
        if (filledOrder.status === 'filled' && filledOrder.filledAvgPrice) {
          filledPrice = filledOrder.filledAvgPrice;
          // Clear pending order now that it's filled
          sessionPending.delete(symbol);
          console.log(
            `[AI Engine] Order filled: ${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (signal was $${decision.currentPrice.toFixed(2)})`
          );
          break;
        }
      } catch (err) {
        // Order might not be ready yet, continue polling
      }
    }

    // Log execution to trading logger with actual fill price
    tradingLogger.logExecution('BUY', symbol, {
      quantity,
      price: filledPrice,
      signalPrice: decision.currentPrice,
      orderId: order.id,
      sessionId,
      sessionName: session.name,
      reason: decision.reasons?.slice(0, 2).join(', '),
    });

    // Store entry context for ML learning - correlate entry conditions with trade outcomes
    if (!entryContexts.has(sessionId)) {
      entryContexts.set(sessionId, new Map());
    }
    entryContexts.get(sessionId).set(symbol, {
      entryTime: new Date().toISOString(),
      entryPrice: filledPrice, // Use actual fill price
      signalPrice: decision.currentPrice,
      quantity,
      confidence: decision.confidence,
      reasons: decision.reasons || [],
      indicators: decision.indicators || {},
      profitTarget: decision.profitTarget,
      stopLoss: decision.stopLoss,
      regime: decision.regime,
      tradingMode,
    });

    // Send notification with actual fill price
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: order.id,
      symbol,
      side: 'buy',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      status: filledOrder?.status === 'filled' ? 'filled' : 'submitted',
      sessionName: session.name,
      sessionId: session.sessionId,
    });

    // Store alert and trade in session for persistence with actual fill price
    addSessionAlert(session.sessionId, {
      type: 'success',
      title: 'Trade BUY',
      message: `${quantity} ${symbol} @ $${filledPrice.toFixed(2)}`,
    });
    addSessionTrade(session.sessionId, {
      symbol,
      side: 'buy',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
    });

    // Update stats
    session.stats.totalTrades++;

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(sessionId), 2000);
  } catch (error) {
    const errorMsg = error.message || '';

    // Identify PDT/buying power errors for throttling
    const isPDTError = errorMsg.includes('day trading') ||
                       errorMsg.includes('buying power') ||
                       errorMsg.includes('insufficient');

    // Throttle repeated PDT errors to avoid log spam
    if (isPDTError) {
      if (!shouldThrottleError(sessionId, `pdt_error_${symbol}`)) {
        console.error(`[AI Engine] PDT/Buying power issue for ${symbol}:`, errorMsg);
        tradingLogger.logError(`BUY order blocked (PDT) for ${symbol}`, {
          sessionId,
          sessionName: session.name,
          symbol,
          error: errorMsg,
        });
        websocketServer.sendAlert(session.userId, {
          type: 'warning',
          title: 'PDT Limit',
          message: `[${session.name}] Cannot buy ${symbol}: ${errorMsg}`,
          severity: 'medium',
        });
      }
    } else {
      // Non-PDT errors always log (but still throttle if repeated)
      if (!shouldThrottleError(sessionId, errorMsg)) {
        console.error(`[AI Engine] Failed to execute entry for ${symbol}:`, error);
        tradingLogger.logError(`BUY order failed for ${symbol}`, {
          sessionId,
          sessionName: session.name,
          symbol,
          error: errorMsg,
        });
        websocketServer.sendAlert(session.userId, {
          type: 'error',
          title: 'Order Failed',
          message: `[${session.name}] Failed to buy ${symbol}: ${errorMsg}`,
          severity: 'high',
        });
      }
    }
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

  // Determine if this is a stop loss exit (critical risk management)
  const isStopLoss = decision.exitReason?.toLowerCase().includes('stop loss') ||
                     decision.reason?.toLowerCase().includes('stop loss') ||
                     (decision.reasons && decision.reasons.some(f => f.toLowerCase().includes('stop loss')));

  // Determine if this is an end-of-day exit
  const isEodExit = decision.exitReason?.toLowerCase().includes('end-of-day') ||
                    decision.reason?.toLowerCase().includes('end-of-day');

  // Check if auto-trade is enabled (or if stop loss/EOD override is allowed)
  const allowStopLossExit = session.config.allowStopLossExit !== false; // Default true
  const allowEodExit = session.config.exitBeforeClose !== false; // Default true
  const isEmergencyExit = (isStopLoss && allowStopLossExit) || (isEodExit && allowEodExit);
  if (!session.config.autoTrade && !isEmergencyExit) {
    websocketServer.sendAlert(session.userId, {
      type: 'warning',
      title: 'Exit Signal',
      message: `SELL signal for ${symbol}: ${decision.exitReason || decision.reason}. Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true,
    });
    return;
  }

  // If executing emergency exit with autoTrade off, send critical alert
  if (isEmergencyExit && !session.config.autoTrade) {
    const exitType = isStopLoss ? 'STOP LOSS' : 'END-OF-DAY';
    console.log(`[AI Engine] EMERGENCY ${exitType} executing for ${symbol} (autoTrade is off)`);
    websocketServer.sendAlert(session.userId, {
      type: 'error',
      title: `EMERGENCY ${exitType}`,
      message: `Executing ${exitType.toLowerCase()} for ${symbol}: ${decision.exitReason || decision.reason}`,
      severity: 'critical',
      actionRequired: false,
    });
  }

  try {
    // Get the trading mode for this session (needed for all Alpaca calls)
    const tradingMode = getSessionTradingMode(session);
    const assetType = session.config.assetType || 'stocks';

    // Normalize symbol for the asset type
    const normalizedSymbol = assetUtils.normalizeSymbol(symbol, assetType, 'alpaca');

    // Get the actual position from Alpaca to get accurate quantity
    let quantity = decision.quantity;
    if (!quantity || quantity <= 0) {
      // Fetch position from Alpaca directly using session-specific mode
      try {
        const alpacaPosition = await alpacaClient.getPosition(
          normalizedSymbol,
          tradingMode
        );
        quantity =
          parseFloat(alpacaPosition.qty) || parseFloat(alpacaPosition.quantity);
      } catch (e) {
        // Check if this is a "position not found" error - means local state is stale
        const errorMsg = e.message || '';
        if (errorMsg.includes('position') && errorMsg.includes('not found')) {
          // Clear stale position state to prevent repeated errors
          clearStalePositionState(sessionId, symbol);
          if (!shouldThrottleError(sessionId, `no_position_${symbol}`)) {
            console.log(
              `[AI Engine] Position ${symbol} not found in Alpaca - cleared stale local state`
            );
          }
        } else if (!shouldThrottleError(sessionId, errorMsg)) {
          console.error(
            `[AI Engine] Could not get position for ${normalizedSymbol} (${tradingMode}):`,
            e.message
          );
        }
        return;
      }
    }

    if (!quantity || quantity <= 0) {
      console.log(`[AI Engine] No valid quantity to sell for ${normalizedSymbol}`);
      return;
    }

    // Close position via Alpaca with session-specific trading mode
    const result = await closePositionForAsset(normalizedSymbol, tradingMode, assetType);

    console.log(
      `[AI Engine] Exit order placed for ${symbol} (${quantity} shares, ${tradingMode.toUpperCase()})`
    );

    // Poll for actual fill price (market orders fill quickly)
    let filledPrice = decision.currentPrice; // fallback to signal price
    let filledOrder = null;
    if (result.id) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500)); // wait 500ms
        try {
          filledOrder = await alpacaClient.getOrderById(result.id, tradingMode);
          if (filledOrder.status === 'filled' && filledOrder.filledAvgPrice) {
            filledPrice = filledOrder.filledAvgPrice;
            console.log(
              `[AI Engine] Exit filled: ${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (signal was $${decision.currentPrice.toFixed(2)})`
            );
            break;
          }
        } catch (err) {
          // Order might not be ready yet, continue polling
        }
      }
    }

    // Set cooldown for this symbol to prevent rapid re-entry
    if (!tradeCooldowns.has(sessionId)) {
      tradeCooldowns.set(sessionId, new Map());
    }
    tradeCooldowns.get(sessionId).set(symbol, Date.now());
    console.log(
      `[AI Engine] ${symbol}: Cooldown started (${TRADE_COOLDOWN_MINUTES} min)`
    );

    // Recalculate P&L with actual fill price
    const entryContext = entryContexts.get(sessionId)?.get(symbol) || null;
    const entryPrice = entryContext?.entryPrice || decision.entryPrice || 0;
    const actualPnl = entryPrice > 0 ? (filledPrice - entryPrice) * quantity : (decision.pnl || 0);
    const pnl = actualPnl;

    // Log execution to trading logger with actual fill price
    tradingLogger.logExecution('SELL', symbol, {
      quantity,
      price: filledPrice,
      signalPrice: decision.currentPrice,
      orderId: result.id,
      sessionId,
      sessionName: session.name,
      reason: decision.exitReason,
      pnl,
      pnlPercent: entryPrice > 0 ? ((filledPrice - entryPrice) / entryPrice * 100) : decision.pnlPercent,
    });

    // Log complete trade outcome for ML learning
    const holdingPeriodMinutes = entryContext?.entryTime
      ? differenceInMinutes(new Date(), parseISO(entryContext.entryTime))
      : null;

    tradingLogger.logTradeOutcome(symbol, {
      sessionId,
      sessionName: session.name,
      entryContext,
      exitReason: decision.exitReason,
      pnl,
      pnlPercent: decision.pnlPercent,
      holdingPeriodMinutes,
      successful: pnl > 0,
      tradingMode,
    });

    // Clear entry context after trade completes
    if (entryContexts.has(sessionId)) {
      entryContexts.get(sessionId).delete(symbol);
    }

    if (pnl > 0) {
      session.stats.wins++;
      session.stats.consecutiveLosses = 0;
    } else {
      session.stats.losses++;
      session.stats.consecutiveLosses++;

      // Check circuit breaker (support both field names for backwards compatibility)
      const consecutiveLimit =
        session.config.maxConsecutiveLosses ||
        session.config.consecutiveLossLimit ||
        3;
      if (session.stats.consecutiveLosses >= consecutiveLimit) {
        triggerCircuitBreaker(sessionId, 'Consecutive loss limit reached');
      }
    }
    session.stats.totalTrades = session.stats.wins + session.stats.losses;
    session.stats.totalPnL += pnl;

    // Recalculate win rate
    session.stats.winRate = session.stats.totalTrades > 0
      ? parseFloat(((session.stats.wins / session.stats.totalTrades) * 100).toFixed(1))
      : 0;

    // Check daily loss limit
    const dailyPnLPercent =
      (session.stats.totalPnL / session.portfolio.initialValue) * 100;
    if (dailyPnLPercent <= -session.config.dailyLossLimitPercent) {
      triggerCircuitBreaker(sessionId, 'Daily loss limit reached');
    }

    // Send notification with actual fill price
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: result.id || uuidv4(),
      symbol,
      side: 'sell',
      quantity: quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      pnl: pnl,
      status: filledOrder?.status === 'filled' ? 'filled' : 'submitted',
      sessionName: session.name,
      sessionId: session.sessionId,
    });

    // Store alert and trade in session for persistence with actual fill price
    const pnlSign = pnl >= 0 ? '+' : '';
    addSessionAlert(session.sessionId, {
      type: 'success',
      title: 'Trade SELL',
      message: `${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (${pnlSign}$${pnl.toFixed(2)})`,
    });
    addSessionTrade(session.sessionId, {
      symbol,
      side: 'sell',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      pnl,
    });

    // Sync portfolio after trade
    setTimeout(() => syncPortfolio(sessionId), 2000);
  } catch (error) {
    console.error(`[AI Engine] Failed to execute exit for ${symbol}:`, error);
    tradingLogger.logError(`SELL order failed for ${symbol}`, {
      sessionId,
      sessionName: session.name,
      symbol,
      error: error.message,
    });
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

  // Log to trading logger
  tradingLogger.logRisk('CIRCUIT BREAKER', {
    sessionId,
    sessionName: session.name,
    reason,
    action: 'Trading paused',
    value: session.stats.consecutiveLosses,
    threshold:
      session.config.maxConsecutiveLosses ||
      session.config.consecutiveLossLimit ||
      3,
  });

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

  // Also store in decision history (in-memory cache)
  const history = decisionHistory.get(sessionId) || [];
  history.push(decision);
  decisionHistory.set(sessionId, history);

  // Persist to disk so decisions survive page refresh/server restart
  saveSessions();
}

/**
 * Get decision history for a session
 * @param {string} sessionId - Session identifier
 * @param {number} limit - Maximum number of decisions to return
 * @returns {Array} Decision history
 */
function getDecisionHistory(sessionId, limit = 100) {
  // Use session.decisions as primary source (persisted to disk)
  // Fall back to in-memory decisionHistory for backwards compatibility
  const session = sessions.get(sessionId);
  if (session && session.decisions && session.decisions.length > 0) {
    return session.decisions.slice(-limit);
  }
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

  // Exclude 'name' from config updates to prevent accidental session name overwrites.
  // Session names should only be changed explicitly via a dedicated rename endpoint.
  const { name: _excludedName, ...configWithoutName } = newConfig;
  session.config = { ...session.config, ...configWithoutName };

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

  const assetType = session.config.assetType || 'stocks';
  const tradingMode = session.config.tradingMode || 'paper';

  // Normalize symbol for the asset type
  const normalizedSymbol = assetUtils.normalizeSymbol(symbol, assetType, 'alpaca');

  try {
    if (action === 'buy') {
      const order = await placeOrderForAsset({
        symbol: normalizedSymbol,
        qty: quantity,
        side: 'buy',
        type: 'market',
        time_in_force: assetUtils.isCrypto(assetType) ? 'gtc' : 'day',
      }, tradingMode, assetType);

      logDecision(sessionId, {
        symbol: normalizedSymbol,
        action: 'MANUAL_BUY',
        quantity,
        timestamp: new Date(),
      });

      return { success: true, orderId: order.id };
    } else if (action === 'sell') {
      const result = await closePositionForAsset(normalizedSymbol, tradingMode, assetType);

      logDecision(sessionId, {
        symbol: normalizedSymbol,
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
  cloneSession,
  pauseSession,
  resumeSession,
  panicSell, // Emergency sell all positions for a session
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
  getMinutesUntilClose,
  syncPortfolio,
  // Semiconductor strategy exports
  getStrategyPreset,
  listStrategyPresets,
  STRATEGY_PRESETS,
};
