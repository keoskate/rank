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
const LeveragedEtfStrategy = require('./leveragedEtfStrategy');
const alpacaStream = require('./alpacaStreamClient');
const signalEvaluator = require('./signalEvaluator');
const orderExecutor = require('./orderExecutor');
const simulatedExecutor = require('./brokers/simulatedExecutor');
const entropyGate = require('./strategies/entropyGate');
const macroRegimeGate = require('./strategies/macroRegimeGate');

// Leveraged ETF strategy instance for flow sentiment analysis
const leveragedEtfStrategy = new LeveragedEtfStrategy();

// Options flow data cache path
const FLOW_CACHE_FILE = path.join(
  __dirname,
  '../data/cheddarflow-data-cache.json'
);

/**
 * Get cached CheddarFlow data for a symbol.
 * Maps leveraged ETFs to their base symbol (SOXL/SOXS → SOXX, QBTX/QBTZ → QBTS).
 * Returns null if no recent data available.
 */
function getCachedFlowData(symbol) {
  try {
    if (!fs.existsSync(FLOW_CACHE_FILE)) return null;

    // Map leveraged ETF to base symbol
    const family = leveragedEtfStrategy.getFamily(symbol);
    const baseSymbol = family ? family.base : symbol.toUpperCase();

    const cacheRaw = fs.readFileSync(FLOW_CACHE_FILE, 'utf-8');
    const cache = JSON.parse(cacheRaw);

    // Find the most recent entry for this base symbol
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .split('T')[0];

    // Try today first, then yesterday
    const todayKey = `${baseSymbol}-${today}`;
    const yesterdayKey = `${baseSymbol}-${yesterday}`;

    const entry = cache[todayKey] || cache[yesterdayKey];
    if (!entry || !entry.data) return null;

    // Check staleness (data older than 24h is stale)
    const dataAge = Date.now() - (entry.timestamp || 0);
    const isStale = dataAge > 24 * 60 * 60 * 1000;

    return { ...entry.data, isStale };
  } catch (err) {
    return null;
  }
}

// Timestamped logging helper — prefixes all AI Engine logs with ISO timestamp
// Makes server.log filterable by date (previously had 417K lines with no dates)
function aiLog(...args) {
  const ts = new Date().toISOString();
  if (typeof args[0] === 'string') {
    args[0] = `[${ts}] ${args[0]}`;
  } else {
    args.unshift(`[${ts}]`);
  }
  console.log(...args);
}
function aiError(...args) {
  const ts = new Date().toISOString();
  if (typeof args[0] === 'string') {
    args[0] = `[${ts}] ${args[0]}`;
  } else {
    args.unshift(`[${ts}]`);
  }
  console.error(...args);
}
function aiWarn(...args) {
  const ts = new Date().toISOString();
  if (typeof args[0] === 'string') {
    args[0] = `[${ts}] ${args[0]}`;
  } else {
    args.unshift(`[${ts}]`);
  }
  console.warn(...args);
}

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
const TRADE_COOLDOWN_MINUTES = 5;

// Error throttling - prevents spam logging of repeated errors
// Map structure: errorKey -> { lastLogged: timestamp, count: number }
const errorThrottle = new Map();
const ERROR_THROTTLE_MINUTES = 5; // Only log same error once per 5 minutes

// Pending orders tracking - prevents duplicate orders during race conditions
// Map structure: sessionId -> Map(symbol -> { orderId, timestamp })
const pendingOrders = new Map();
const PENDING_ORDER_TIMEOUT_MS = 60000; // Clear stale pending orders after 60s

// Global entry locks - prevents multiple sessions piling into the same symbol
// Map structure: symbol -> { sessionId, sessionName, timestamp }
const globalEntryLocks = new Map();
const ENTRY_LOCK_TIMEOUT_MS = 30000; // Lock expires after 30s (covers eval + order)

// Global exit locks - prevents race condition where multiple sessions try to
// SELL the same Alpaca position in the same tick ("insufficient qty available").
// Map structure: symbol -> { sessionId, timestamp }
const globalExitLocks = new Map();
const EXIT_LOCK_TIMEOUT_MS = 5000;

// Exit evaluation failure tracking. A dead price feed must NEVER trigger a
// blind liquidation — after this many consecutive failures the evaluator HOLDS
// and escalates a risk alert (see signalEvaluator catch block), and the counter
// resets automatically when the feed recovers.
// Map structure: `${sessionId}:${symbol}` -> consecutiveFailures
const exitEvalFailCounts = new Map();
const EXIT_EVAL_MAX_FAILURES = 3;

// Maximum aggregate exposure per symbol across ALL sessions (% of equity)
// Prevents position piling from consuming >25% of portfolio in one bet
const MAX_AGGREGATE_EXPOSURE_PCT = 25;

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
    const {
      SemiconductorSentimentEngine,
    } = require('./semiconductorSentiment');
    regimeEngines.set(
      key,
      new SemiconductorSentimentEngine({ referenceSymbol: key })
    );
    tradingLogger.logInfo(`[AI Engine] Created regime engine for ${key}`);
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
const BULLISH_ETFS = [
  'SOXL',
  'QBTX',
  'PLTU',
  'TQQQ',
  'SPXL',
  'UPRO',
  'TECL',
  'FNGU',
];
const BEARISH_ETFS = ['SOXS', 'QBTZ', 'SQQQ', 'SPXS', 'TECS', 'FNGD'];

// Leverage multiplier for leveraged ETFs - used to scale stop-losses appropriately
// A 1% stop on a 3x ETF triggers from a 0.33% underlying move (noise), so we scale by leverage
const ETF_LEVERAGE = {
  SOXL: 3,
  SOXS: 3,
  QBTX: 3,
  QBTZ: 3,
  TQQQ: 3,
  SQQQ: 3,
  SPXL: 3,
  SPXS: 3,
  TECL: 3,
  TECS: 3,
  FNGU: 3,
  FNGD: 3,
  PLTU: 2,
  PLTZ: 2,
};
function getEtfLeverage(symbol) {
  return ETF_LEVERAGE[symbol.toUpperCase()] || 1;
}

// Bull/Bear ETF pair mapping - used for cross-session conflict detection
const ETF_PAIRS = {
  SOXL: 'SOXS',
  SOXS: 'SOXL',
  QBTX: 'QBTZ',
  QBTZ: 'QBTX',
  TQQQ: 'SQQQ',
  SQQQ: 'TQQQ',
  SPXL: 'SPXS',
  SPXS: 'SPXL',
  TECL: 'TECS',
  TECS: 'TECL',
  FNGU: 'FNGD',
  FNGD: 'FNGU',
};
function getOppositeEtf(symbol) {
  return ETF_PAIRS[symbol.toUpperCase()] || null;
}

// US Eastern DST detection (2nd Sunday Mar – 1st Sunday Nov)
function isDST(date) {
  const year = date.getUTCFullYear();
  // March: 2nd Sunday (day 8-14)
  const mar1 = new Date(Date.UTC(year, 2, 1));
  const marDST = new Date(Date.UTC(year, 2, 14 - mar1.getUTCDay(), 7)); // 2am ET = 7am UTC
  // November: 1st Sunday (day 1-7)
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const novDST = new Date(Date.UTC(year, 10, 7 - nov1.getUTCDay() || 7, 6)); // 2am ET = 6am UTC (EST)
  return date >= marDST && date < novDST;
}

/**
 * Calendar day key in US Eastern time (YYYY-MM-DD).
 * Day-based risk resets (daily profit target, daily loss limit) must roll at ET
 * midnight — NOT UTC midnight, which is 7-8pm ET and can land inside an
 * after-hours session, resetting the day's P&L mid-session.
 * @param {Date} [date] - defaults to now
 * @returns {string} e.g. "2026-07-07"
 */
function etDayKey(date = new Date()) {
  const offsetHours = isDST(date) ? 4 : 5; // EDT = UTC-4, EST = UTC-5
  return new Date(date.getTime() - offsetHours * 3600 * 1000)
    .toISOString()
    .split('T')[0];
}

// Global position size limits - prevents any single position from dominating portfolio
const GLOBAL_MAX_POSITION_PERCENT = 25; // No single position > 25% of portfolio
const GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT = 65; // Total across all sessions < 65% of portfolio

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
 * Get raw market regime from sentiment/regime engines or price trend.
 * Extracted to share between evaluateEntry and evaluateExit.
 */
function getRawMarketRegime(session, indicators) {
  const trend = indicators?.trend || {};
  const cfg = session.config;
  if (
    cfg.semiconductorMode &&
    sentimentEngine &&
    sentimentEngine.sentimentCache
  ) {
    const dir = sentimentEngine.sentimentCache.direction;
    if (dir === 'bullish') return 'bull';
    if (dir === 'bearish') return 'bear';
    return 'sideways';
  } else if (cfg.regimeGateEnabled && cfg.regimeReferenceSymbol) {
    const regEng = regimeEngines.get(cfg.regimeReferenceSymbol.toUpperCase());
    if (regEng && regEng.sentimentCache) {
      const dir = regEng.sentimentCache.direction;
      if (dir === 'bullish') return 'bull';
      if (dir === 'bearish') return 'bear';
    }
    return 'sideways';
  } else {
    if (trend.shortTerm === 'bullish' && trend.mediumTerm === 'bullish')
      return 'bull';
    if (trend.shortTerm === 'bearish' && trend.mediumTerm === 'bearish')
      return 'bear';
    return 'sideways';
  }
}

/**
 * Regime hysteresis: prevents flip-flopping by requiring a regime to persist
 * for regimeHysteresisMinutes before confirming the switch.
 * Stores state on session.regimeState.
 */
function getStableRegime(session, rawRegime) {
  const hysteresisMinutes = session.config.regimeHysteresisMinutes || 10;

  // Initialize regime state on first call
  if (!session.regimeState) {
    session.regimeState = {
      confirmedRegime: rawRegime,
      pendingRegime: null,
      pendingSince: null,
    };
    return rawRegime;
  }

  const state = session.regimeState;

  // Raw matches confirmed — no change needed, cancel any pending
  if (rawRegime === state.confirmedRegime) {
    if (state.pendingRegime) {
      tradingLogger.logInfo(
        `[AI Engine] Regime pending ${state.pendingRegime} cancelled — reverted to ${state.confirmedRegime}`
      );
    }
    state.pendingRegime = null;
    state.pendingSince = null;
    return state.confirmedRegime;
  }

  // Raw differs from confirmed — start or continue pending
  if (state.pendingRegime !== rawRegime) {
    // New pending regime
    state.pendingRegime = rawRegime;
    state.pendingSince = Date.now();
    tradingLogger.logInfo(
      `[AI Engine] Regime pending: ${rawRegime} (need ${hysteresisMinutes} min to confirm, current: ${state.confirmedRegime})`
    );
    return state.confirmedRegime;
  }

  // Same pending regime — check if enough time has passed
  const pendingMinutes = (Date.now() - state.pendingSince) / (1000 * 60);
  if (pendingMinutes >= hysteresisMinutes) {
    tradingLogger.logConfig('Regime confirmed', {
      field: 'regime',
      oldValue: state.confirmedRegime,
      newValue: rawRegime,
    });
    state.confirmedRegime = rawRegime;
    state.pendingRegime = null;
    state.pendingSince = null;
    return rawRegime;
  }

  // Still waiting for hysteresis
  return state.confirmedRegime;
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
      tradingLogger.logInfo(
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
  if (
    pdtStateCache.lastChecked &&
    now - pdtStateCache.lastChecked < cacheValidMs
  ) {
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
    tradingLogger.logError('[AI Engine] Failed to check PDT status', {
      error: err.message,
    });
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
    tradingLogger.logInfo(
      `[AI Engine] Cleared stale position state for ${symbol}`,
      { sessionId, sessionName: session.name, symbol }
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
  // Dry-run mode (CLI harness): keep the engine inert — never touch the
  // persisted ai-sessions.json from a throwaway evaluation process.
  if (process.env.AI_ENGINE_DRY_RUN) return;
  try {
    const sessionsData = {};
    sessions.forEach((session, sessionId) => {
      // Exclude intervalId/tickTimeoutId (Timeout reference) to avoid circular JSON
      const { intervalId, tickTimeoutId, ...sessionWithoutInterval } = session;
      sessionsData[sessionId] = {
        ...sessionWithoutInterval,
        portfolio: {
          ...session.portfolio,
          positions: Array.from(session.portfolio.positions.entries()),
        },
      };
    });

    const jsonData = JSON.stringify(sessionsData, null, 2);

    // Rotate rolling backups before writing
    const bak3 = SESSION_FILE + '.bak3';
    const bak2 = SESSION_FILE + '.bak2';
    const bak1 = SESSION_FILE + '.bak1';
    try {
      if (fs.existsSync(bak2)) fs.renameSync(bak2, bak3);
      if (fs.existsSync(bak1)) fs.renameSync(bak1, bak2);
      if (fs.existsSync(SESSION_FILE)) fs.copyFileSync(SESSION_FILE, bak1);
    } catch (backupErr) {
      tradingLogger.logError('[AI Engine] Backup rotation failed', {
        error: backupErr.message,
      });
    }

    // Atomic write: write to .tmp then rename (atomic on POSIX)
    const tmpFile = SESSION_FILE + '.tmp';
    fs.writeFileSync(tmpFile, jsonData);
    fs.renameSync(tmpFile, SESSION_FILE);
  } catch (err) {
    tradingLogger.logError('[AI Engine] Failed to save sessions', {
      error: err.message,
    });
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
          session.stats.winRate =
            session.stats.totalTrades > 0
              ? parseFloat(
                  ((wins / session.stats.totalTrades) * 100).toFixed(1)
                )
              : 0;
        }

        sessions.set(sessionId, session);

        // Restart trading loop if session was running
        if (session.status === 'running') {
          tradingLogger.logInfo(
            `[AI Engine] Restoring running session "${session.name}"`,
            { sessionId, sessionName: session.name }
          );
          startTradingLoop(sessionId);
        }
      });
      tradingLogger.logInfo(
        `[AI Engine] Loaded ${sessions.size} session(s) from disk`
      );
      if (cleanedDecisions > 0) {
        tradingLogger.logInfo(
          `[AI Engine] Cleaned ${cleanedDecisions} non-actionable decisions from history`
        );
        saveSessions(); // Save the cleaned data
      }
    }
  } catch (err) {
    tradingLogger.logError('[AI Engine] Failed to load sessions', {
      error: err.message,
    });
  }
}

// Load sessions on module initialization.
// Skipped in dry-run mode so requiring the engine from a CLI harness doesn't
// restore live sessions or start their trading loops.
if (!process.env.AI_ENGINE_DRY_RUN) {
  loadSessions();
}

/**
 * Get the trading mode for a session based on its config
 * @param {object} session - Session object
 * @returns {string} 'paper' or 'live'
 */
function getSessionTradingMode(session) {
  // 'live' (real money) requires an EXPLICIT opt-in. The `tradingMode` field —
  // set by tier transitions (transitionToPaperTier => 'paper') and brokerSchema
  // — is authoritative. The legacy `paperTradeOnly` flag is only a fallback.
  // BUG THIS FIXES: brokerSchema sets paperTradeOnly=false for non-paper-tier
  // brokers, which the old `paperTradeOnly === false ? 'live'` read as LIVE — so
  // promoting a broker to PAPER routed it at the real-money account (it synced
  // the near-empty live account, $1.1k, not the $75k paper account). Default to
  // paper for safety; only ever return 'live' when tradingMode is explicitly set.
  if (session.config.tradingMode === 'live') return 'live';
  if (session.config.tradingMode === 'paper') return 'paper';
  return session.config.paperTradeOnly === false ? 'live' : 'paper';
}

// Trading hours (Eastern Time)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Extended hours trading windows (Eastern Time)
// Pre-market: 4:00 AM - 9:30 AM ET
// After-hours: 4:00 PM - 8:00 PM ET
const PREMARKET_OPEN_MINUTES = 4 * 60; // 240
const PREMARKET_CLOSE_MINUTES = 9 * 60 + 30; // 570
const AFTERHOURS_OPEN_MINUTES = 16 * 60; // 960
const AFTERHOURS_CLOSE_MINUTES = 20 * 60; // 1200

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
  // Daily profit target - pause session after hitting +N% day (null = disabled)
  // When hit: closes open positions and pauses session until next trading day
  dailyProfitTargetPercent: null,
  // Portfolio drawdown circuit breaker (opt-in, halt-only; null = disabled).
  // When set, a session whose equity falls this % below its high-water mark
  // (peakValue) is paused via triggerCircuitBreaker — entries blocked, exits
  // still allowed, no liquidation. Armed per-broker via risk.maxPortfolioDrawdown.
  maxPortfolioDrawdownPercent: null,
  // Winner-trim / partial profit-take (opt-in; null = disabled). When set, the
  // trend/momentum plugins trim a winner once after unrealized P&L >= this %.
  // partialExitPercent is the trim fraction (0..100) the executors size with.
  trimAtProfitPercent: null,
  partialExitPercent: 50,
  // Risk management - stop losses execute even when autoTrade is off
  allowStopLossExit: true, // CRITICAL: Allow stop loss to execute regardless of autoTrade
  // Semiconductor Strategy Settings
  semiconductorMode: false, // Enable semiconductor-specific logic (SOXX-based sentiment)
  marketGate: null, // null | 'bullish' | 'bearish' | 'any' - direction gate for entry
  marketGateMinConfidence: 60, // Minimum sentiment confidence to pass gate
  aiSentimentEnabled: false, // Use Claude for sentiment analysis boost
  maxSoxsHoldMinutes: 120, // Max hold time for SOXS positions (decay protection)
  allowDirectionSwitch: true, // Allow switching direction mid-day if confidence is high
  // Regime Gate Settings (for non-semiconductor sessions)
  regimeGateEnabled: false, // Enable macro regime gating via a reference symbol
  regimeReferenceSymbol: null, // Reference symbol for regime engine (e.g., 'QQQ', 'SPY')
  // Hold time settings (prevents whipsaw exits)
  minHoldMinutes: 30, // Minimum hold time before any exit (except stop loss)
  counterTrendMinHoldMinutes: 15, // Minimum hold for counter-trend positions
  // Regime hysteresis (prevents flip-flopping)
  regimeHysteresisMinutes: 10, // Regime must persist this long before switching
};

// ============================================================
// SEMICONDUCTOR STRATEGY PRESETS
// ============================================================
// Pre-configured strategies for SOXL/SOXS semiconductor momentum trading

const STRATEGY_PRESETS = {
  SOXL_MOMENTUM: {
    name: 'SOXL Bullish Momentum',
    description:
      'Trades SOXL on bullish semiconductor days. Uses AI sentiment analysis.',
    watchlist: ['SOXL'],
    semiconductorMode: true,
    marketGate: 'bullish',
    marketGateMinConfidence: 65,
    entryStrategy: 'momentum',
    takeProfitPercent: 3.0, // Wider target for 3x leverage
    stopLossPercent: 1.5, // Tighter stop for leverage
    trailingStopPercent: 50, // Lock in 50% of gains once activated
    trailingStopMinProfitPercent: 1.5, // Activate after 1.5% gain (reachable intraday for 3x)
    minSignalsRequired: 2,
    maxPositions: 1,
    maxPositionSizePercent: 30,
    aiSentimentEnabled: true,
    autoTrade: false, // Require explicit opt-in
  },

  SOXS_HEDGE: {
    name: 'SOXS Bearish Hedge',
    description:
      'Trades SOXS as a hedge on bearish semiconductor days. Auto-exits to avoid decay.',
    watchlist: ['SOXS'],
    semiconductorMode: true,
    marketGate: 'bearish',
    marketGateMinConfidence: 70, // Higher confidence for inverse ETF
    entryStrategy: 'conservative',
    takeProfitPercent: 2.0, // Quicker profit taking (decay)
    stopLossPercent: 1.0, // Tight stop
    trailingStopPercent: 50, // Lock in 50% of gains once activated
    trailingStopMinProfitPercent: 1.0, // Activate early — SOXS decays, take what you can
    minSignalsRequired: 2,
    maxSoxsHoldMinutes: 120, // Max 2 hour hold
    maxPositions: 1,
    maxPositionSizePercent: 20, // Smaller size for hedge
    aiSentimentEnabled: true,
    autoTrade: false,
  },

  SOXL_SOXS_COMBO: {
    name: 'SOXL/SOXS Dynamic',
    description:
      'Dynamically trades SOXL or SOXS based on semiconductor sentiment. AI-powered direction.',
    watchlist: ['SOXL', 'SOXS'],
    semiconductorMode: true,
    marketGate: 'any', // Trades both directions
    marketGateMinConfidence: 60,
    entryStrategy: 'balanced',
    takeProfitPercent: 2.5,
    stopLossPercent: 1.2,
    trailingStopPercent: 50, // Lock in 50% of gains once activated
    trailingStopMinProfitPercent: 1.5, // Activate after 1.5% gain
    minSignalsRequired: 2,
    maxSoxsHoldMinutes: 90, // Shorter hold for SOXS
    maxPositions: 1, // One at a time
    maxPositionSizePercent: 25,
    aiSentimentEnabled: true,
    allowDirectionSwitch: true,
    autoTrade: false,
  },

  QBTX_QBTZ_COMBO: {
    name: 'QBTX/QBTZ Dynamic',
    description:
      'Dynamically trades QBTX or QBTZ based on QQQ regime sentiment. Macro-aware direction.',
    watchlist: ['QBTX', 'QBTZ'],
    semiconductorMode: false,
    regimeGateEnabled: true,
    regimeReferenceSymbol: 'QQQ',
    marketGate: 'any',
    marketGateMinConfidence: 60,
    entryStrategy: 'balanced',
    takeProfitPercent: 2.5,
    stopLossPercent: 1.0, // Auto-scaled to 3% by leverage-aware stops
    trailingStopPercent: 50, // Lock in 50% of gains once activated
    trailingStopMinProfitPercent: 1.5, // Activate after 1.5% gain
    minSignalsRequired: 2,
    maxPositions: 1,
    maxPositionSizePercent: 10,
    allowDirectionSwitch: true,
    autoTrade: false,
  },

  INVESTIGATE_TRADER: {
    name: 'Investigate-Based Trader',
    description:
      'General-purpose trader for any symbol. Uses technical scoring for entry/exit.',
    watchlist: [], // Set at session start
    semiconductorMode: false,
    regimeGateEnabled: false,
    entryStrategy: 'balanced',
    takeProfitPercent: 2.5,
    stopLossPercent: 1.5,
    trailingStopPercent: 1.0,
    minSignalsRequired: 2,
    minConfidence: 65,
    maxPositions: 1,
    maxPositionSizePercent: 15,
    autoTrade: false, // User opts in explicitly
    exitBeforeClose: true,
    exitBeforeCloseMinutes: 15,
    minHoldMinutes: 15,
    dailyProfitTargetPercent: null, // Optional: e.g. 2.0 = pause after +2% day
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
  if (!sentiment || !sentiment.direction || sentiment.direction === 'neutral')
    return;
  if (!blockedSession.config.semiconductorMode) return;

  // Throttle: skip if we switched for this session recently
  const lastSwitch = lastSentimentSwitch.get(blockedSession.sessionId);
  if (lastSwitch && Date.now() - lastSwitch < SENTIMENT_SWITCH_COOLDOWN_MS)
    return;

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
      tradingLogger.logConfig('Auto-resuming session', {
        sessionId: sid,
        sessionName: session.name,
        field: 'status',
        oldValue: 'paused',
        newValue: 'running',
      });
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
  if (
    didSwitch &&
    blockedSession.status === 'running' &&
    blockedSession.portfolio.positions.size === 0
  ) {
    tradingLogger.logConfig('Auto-pausing session', {
      sessionId: blockedSession.sessionId,
      sessionName: blockedSession.name,
      field: 'status',
      oldValue: 'running',
      newValue: 'paused',
    });
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
  if (!sentiment || !sentiment.direction || sentiment.direction === 'neutral')
    return;
  if (!blockedSession.config.regimeGateEnabled) return;

  const lastSwitch = lastSentimentSwitch.get(blockedSession.sessionId);
  if (lastSwitch && Date.now() - lastSwitch < SENTIMENT_SWITCH_COOLDOWN_MS)
    return;

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
      tradingLogger.logConfig('Regime auto-resuming session', {
        sessionId: sid,
        sessionName: session.name,
        field: 'status',
        oldValue: 'paused',
        newValue: 'running',
      });
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

  if (
    didSwitch &&
    blockedSession.status === 'running' &&
    blockedSession.portfolio.positions.size === 0
  ) {
    tradingLogger.logConfig('Regime auto-pausing session', {
      sessionId: blockedSession.sessionId,
      sessionName: blockedSession.name,
      field: 'status',
      oldValue: 'running',
      newValue: 'paused',
    });
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
 * Scan all running sessions for their current positions.
 * Paused sessions are excluded because their portfolio data may be stale
 * (positions are only synced while a session is actively running).
 * Returns a map of symbols to the sessions holding them with market value.
 * @returns {{ heldSymbols: Set<string>, positionsBySymbol: Map<string, Array> }}
 */
function getGlobalPositionExposure() {
  const heldSymbols = new Set();
  const positionsBySymbol = new Map();

  for (const [sid, session] of sessions) {
    if (session.status !== 'running') continue; // Only running sessions have synced positions; paused sessions have stale data
    // Exclude SIMULATION sessions: their positions are VIRTUAL (separate $100k
    // pools), not on the shared real Alpaca account this cross-session exposure
    // logic guards. Including them summed sim market value into the real
    // account's exposure check (~$237k of sim positions / $80k paper equity =
    // 292%), which wrongly tripped the total-exposure cap and froze the paper
    // account flat — blocking every real entry. Real (paper/live) sessions only.
    if (session.config.simulationMode) continue;
    for (const [symbol, position] of session.portfolio.positions) {
      const upper = symbol.toUpperCase();
      heldSymbols.add(upper);
      if (!positionsBySymbol.has(upper)) positionsBySymbol.set(upper, []);
      positionsBySymbol.get(upper).push({
        sessionId: sid,
        sessionName: session.name,
        quantity: position.quantity || 0,
        marketValue:
          position.marketValue ||
          position.quantity * (position.currentPrice || 0),
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

  // Check if another session is currently evaluating entry for this symbol (lock held)
  const entryLock = globalEntryLocks.get(upper);
  if (entryLock && entryLock.sessionId !== sessionId) {
    const lockAge = Date.now() - entryLock.timestamp;
    if (lockAge < ENTRY_LOCK_TIMEOUT_MS) {
      return {
        allowed: false,
        reason: `Cross-session block: ${symbol} entry in progress by "${entryLock.sessionName}"`,
      };
    }
  }

  // Check aggregate exposure — block if total market value for this symbol exceeds cap
  const allHolders = positionsBySymbol.get(upper);
  if (allHolders && allHolders.length > 0 && pdtStateCache.equity > 0) {
    const totalExposure = allHolders.reduce(
      (sum, h) => sum + (h.marketValue || 0),
      0
    );
    const exposurePct = (totalExposure / pdtStateCache.equity) * 100;
    if (exposurePct >= MAX_AGGREGATE_EXPOSURE_PCT) {
      return {
        allowed: false,
        reason: `Aggregate cap: ${symbol} at ${exposurePct.toFixed(1)}% of equity ($${totalExposure.toFixed(0)}/$${pdtStateCache.equity.toFixed(0)}), max ${MAX_AGGREGATE_EXPOSURE_PCT}%`,
      };
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Check if a session can proceed with an exit order for a symbol.
 * Prevents multiple sessions from racing to SELL the same Alpaca position
 * in the same tick (causes "insufficient qty available" errors).
 * @param {string} symbol
 * @param {string} sessionId
 * @returns {{ allowed: boolean, blockedBy?: string }}
 */
function canExitGlobally(symbol, sessionId) {
  const upper = symbol.toUpperCase();
  const lock = globalExitLocks.get(upper);
  if (!lock) return { allowed: true };
  // Block same-session re-entry too: prevents two async paths within a single
  // session tick (e.g., hold-check exit + evaluateExit) from both firing SELL.
  if (Date.now() - lock.timestamp > EXIT_LOCK_TIMEOUT_MS) {
    globalExitLocks.delete(upper);
    return { allowed: true };
  }
  return { allowed: false, blockedBy: lock.sessionId };
}

function claimExitLock(symbol, sessionId) {
  globalExitLocks.set(symbol.toUpperCase(), {
    sessionId,
    timestamp: Date.now(),
  });
}

function releaseExitLock(symbol, sessionId) {
  const upper = symbol.toUpperCase();
  const lock = globalExitLocks.get(upper);
  if (lock && lock.sessionId === sessionId) globalExitLocks.delete(upper);
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
    return {
      allowed: false,
      reason: 'Sentiment is neutral - waiting for direction',
    };
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

  // Inverse/bearish ETFs require higher sentiment confidence (70%+)
  // These are inherently riskier — marginal bearish signals often reverse
  if (etfType === 'bearish' && sentiment.confidence < 70) {
    return {
      allowed: false,
      reason: `${symbol} requires high bearish confidence (${sentiment.confidence}% < 70% threshold)`,
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

  const holdMinutes = differenceInMinutes(
    new Date(),
    new Date(position.entryTime)
  );

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
async function getAggregatesForAsset(
  symbol,
  multiplier,
  timespan,
  options,
  assetType
) {
  if (assetUtils.isCrypto(assetType)) {
    return polygonClient.getCryptoAggregates(
      symbol,
      multiplier,
      timespan,
      options
    );
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
 * Place an order, routing to correct API based on asset type.
 * Auto-converts market orders to limit orders during extended hours (pre-market
 * and after-hours) when the caller passes `_sessionAllowsExtendedHours: true`
 * in orderParams. Alpaca requires LIMIT orders with extended_hours=true during
 * non-regular hours. An aggressive ±0.5% limit buffer is applied to ensure fills
 * in thin extended-hours books.
 *
 * Private meta-params (stripped before sending to Alpaca):
 *   _sessionAllowsExtendedHours - boolean, enables extended-hours conversion
 *   _referencePrice             - optional fallback price if quote fetch fails
 *
 * @param {Object} orderParams - Order parameters (plus optional meta-params above)
 * @param {string} tradingMode - 'live' or 'paper'
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {Object} - Order result
 */
async function placeOrderForAsset(orderParams, tradingMode, assetType) {
  const { _sessionAllowsExtendedHours, _referencePrice, ...cleanParams } =
    orderParams;

  // Extended hours path: only for stocks, only when enabled, only when outside regular hours
  if (
    _sessionAllowsExtendedHours === true &&
    !assetUtils.isCrypto(assetType) &&
    !isMarketOpen() &&
    isExtendedHoursOpen() &&
    cleanParams.type === 'market'
  ) {
    let refPrice = _referencePrice;
    try {
      const quote = await alpacaClient.getLatestQuote(cleanParams.symbol);
      if (cleanParams.side === 'buy' && quote.askPrice) {
        refPrice = quote.askPrice;
      } else if (cleanParams.side === 'sell' && quote.bidPrice) {
        refPrice = quote.bidPrice;
      }
    } catch (err) {
      tradingLogger.logError('[AI Engine] Extended hours quote fetch failed', {
        symbol: cleanParams.symbol,
        error: err.message,
      });
    }

    if (!refPrice || refPrice <= 0) {
      throw new Error(
        `Extended hours order requires a valid reference price for ${cleanParams.symbol}`
      );
    }

    // Aggressive buffer to ensure fills in thin pre-market books
    const buffer = cleanParams.side === 'buy' ? 1.005 : 0.995;
    const limitPrice = Number((refPrice * buffer).toFixed(2));

    tradingLogger.logExecution(
      `EXTENDED_HOURS_${cleanParams.side.toUpperCase()}`,
      cleanParams.symbol,
      {
        quantity: cleanParams.qty,
        price: limitPrice,
        reason: `Extended-hours limit order (ref $${Number(refPrice).toFixed(2)})`,
      }
    );

    return alpacaClient.placeOrder(
      {
        ...cleanParams,
        type: 'limit',
        limit_price: limitPrice,
        extended_hours: true,
        time_in_force: 'day',
      },
      tradingMode
    );
  }

  if (assetUtils.isCrypto(assetType)) {
    return alpacaClient.placeCryptoOrder(cleanParams, tradingMode);
  }
  return alpacaClient.placeOrder(cleanParams, tradingMode);
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

  // SAFETY: Enforce capital limits — prevent unbounded position sizing
  if (!sessionConfig.allocatedCapital || sessionConfig.allocatedCapital <= 0) {
    sessionConfig.allocatedCapital = 10000; // Safe default: $10k
    tradingLogger.logRisk('Missing allocatedCapital', {
      reason: 'No allocatedCapital set, defaulting to $10,000',
      value: 0,
      threshold: 10000,
      action: 'Using default $10,000',
    });
  }
  if (!sessionConfig.maxPositionSize || sessionConfig.maxPositionSize <= 0) {
    sessionConfig.maxPositionSize = Math.min(
      5000,
      sessionConfig.allocatedCapital * 0.5
    );
    tradingLogger.logRisk('Missing maxPositionSize', {
      reason: `No maxPositionSize set, defaulting to $${sessionConfig.maxPositionSize}`,
      value: 0,
      threshold: sessionConfig.maxPositionSize,
      action: 'Using calculated default',
    });
  }

  // Generate a unique name if not provided
  if (!sessionConfig.name || sessionConfig.name === 'Default Strategy') {
    const existingSessions = getAllUserSessions(userId);
    sessionConfig.name = `Strategy ${existingSessions.length + 1}`;
  }

  const startingCash =
    parseFloat(sessionConfig.initialCapital) ||
    parseFloat(sessionConfig.allocatedCapital) ||
    100000;
  const session = {
    sessionId,
    userId,
    name: sessionConfig.name,
    status: 'running',
    startTime: new Date(),
    config: sessionConfig,
    portfolio: {
      cash: startingCash,
      positions: new Map(),
      initialValue: startingCash,
    },
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      consecutiveLosses: 0,
      peakValue: startingCash,
      maxDrawdown: 0,
      winRate: 0,
      // Signal funnel: how many entry evaluations clear each stage.
      // evaluated = every evaluateEntry past the cooldown gate
      // passed    = decision.shouldEnter === true
      // entered   = an entry order actually executed
      signalsEvaluated: 0,
      signalsPassed: 0,
      signalsEntered: 0,
    },
    decisions: [],
    alerts: [],
    tradingLog: [], // Persistent trade history for session
    circuitBreakerTriggered: false,
  };

  // Use sessionId as the key to allow multiple sessions
  sessions.set(sessionId, session);
  decisionHistory.set(sessionId, []);

  tradingLogger.logInfo(
    `[AI Engine] Session "${sessionConfig.name}" started for user ${userId}`,
    { sessionId, sessionName: sessionConfig.name }
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

  // Update WS stream subscriptions for new watchlist
  _recalculateStreamSubscriptions();

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
        session.portfolio.positions.forEach(pos => {
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
          winRate:
            session.stats?.wins + session.stats?.losses > 0
              ? parseFloat(
                  (
                    (session.stats.wins /
                      (session.stats.wins + session.stats.losses)) *
                    100
                  ).toFixed(1)
                )
              : 0,
          totalTrades:
            (session.stats?.wins || 0) + (session.stats?.losses || 0),
          unrealizedPnL,
          totalPnLWithUnrealized:
            (session.stats?.totalPnL || 0) + unrealizedPnL,
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

  // Clear trading loop timeout
  if (session.tickTimeoutId) {
    clearTimeout(session.tickTimeoutId);
    session.tickTimeoutId = null;
  }

  const summary = {
    sessionId: session.sessionId,
    name: session.name,
    duration: differenceInMinutes(session.endTime, session.startTime),
    stats: session.stats,
    totalDecisions: session.decisions.length,
    finalPositions: Array.from(session.portfolio.positions.values()),
  };

  tradingLogger.logConfig('Session stopped', {
    sessionId,
    sessionName: session.name,
  });

  // Save to disk
  saveSessions();

  // Update WS stream subscriptions (may unsubscribe symbols no longer watched)
  _recalculateStreamSubscriptions();

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

    tradingLogger.logRisk('PANIC SELL', {
      sessionId,
      sessionName,
      reason: `Closing ${positions.length} positions (session delete)`,
      action: `${tradingMode.toUpperCase()} mode`,
    });

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

          tradingLogger.logInfo(
            `[AI Engine] Panic sold ${position.quantity} ${position.symbol}`,
            { sessionId, sessionName, symbol: position.symbol }
          );
        } catch (err) {
          tradingLogger.logError(
            `[AI Engine] Failed to panic sell ${position.symbol}`,
            {
              sessionId,
              sessionName,
              symbol: position.symbol,
              error: err.message,
            }
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

  tradingLogger.logConfig('Session deleted', { sessionId, sessionName });

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

  tradingLogger.logRisk('PANIC SELL', {
    sessionId,
    sessionName,
    reason: 'Manual panic sell initiated',
    action: `${tradingMode.toUpperCase()} mode`,
  });

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

          tradingLogger.logInfo(
            `[AI Engine] Panic sold ${position.quantity} ${position.symbol}`,
            { sessionId, sessionName, symbol: position.symbol }
          );
        } catch (err) {
          tradingLogger.logError(
            `[AI Engine] Failed to panic sell ${position.symbol}`,
            {
              sessionId,
              sessionName,
              symbol: position.symbol,
              error: err.message,
            }
          );
          errors.push({
            symbol: position.symbol,
            error: err.message,
          });
        }
      }
    }
  } catch (err) {
    tradingLogger.logError('[AI Engine] Failed to fetch Alpaca positions', {
      sessionId,
      sessionName,
      error: err.message,
    });
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

  tradingLogger.logConfig('Session cloned', {
    sessionId: newSessionId,
    sessionName: clonedConfig.name,
    field: 'clonedFrom',
    oldValue: sessionId,
    newValue: newSessionId,
  });

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
    // Clear trading loop timeout
    if (session.tickTimeoutId) {
      clearTimeout(session.tickTimeoutId);
      session.tickTimeoutId = null;
    }
    tradingLogger.logConfig('Session paused', {
      sessionId,
      sessionName: session.name,
    });
    saveSessions();
    _recalculateStreamSubscriptions();
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
    tradingLogger.logConfig('Session resumed', {
      sessionId,
      sessionName: session.name,
    });
    saveSessions();
    // Restart trading loop
    startTradingLoop(sessionId);
    _recalculateStreamSubscriptions();
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
    cash: session.portfolio?.cash,
    initialValue: session.portfolio?.initialValue,
    regimeState: session.regimeState || null,
    entropyRegimeState: session.entropyRegimeState || null,
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
    tradingLogger.logError(
      `[AI Engine] Portfolio sync failed for "${session.name}"`,
      { sessionId, sessionName: session.name, error: error.message }
    );
  }

  // Adaptive tick rate: 3s with leveraged positions, 5s with non-leveraged, 10s scanning
  tradingLogger.logInfo(
    `[AI Engine] Trading loop started for "${session.name}" (adaptive tick)`,
    { sessionId, sessionName: session.name }
  );

  async function tradingTick() {
    const currentSession = sessions.get(sessionId);

    if (!currentSession || currentSession.status !== 'running') {
      return; // Stop scheduling — session no longer running
    }

    // Heartbeat: record last tick time for stale session detection
    currentSession.lastTickTime = Date.now();

    // Check if market is open (skip for crypto - trades 24/7)
    // Auto-detect asset type from watchlist if not explicitly set
    const sessionAssetType =
      currentSession.config?.assetType ||
      detectAssetTypeFromWatchlist(currentSession.config?.watchlist || []);

    if (
      assetUtils.marketHoursApply(sessionAssetType) &&
      !canSessionTradeNow(currentSession)
    ) {
      // Market closed — schedule next check at slow rate and skip trading logic.
      // CRITICAL: We must NOT return without scheduling the next tick, or the
      // trading loop dies permanently and never restarts.
      const latestSess = sessions.get(sessionId);
      if (latestSess && latestSess.status === 'running') {
        latestSess.tickTimeoutId = setTimeout(tradingTick, 60000); // Check every 60s when market closed
      }
      return;
    }

    // Check circuit breaker — still schedule next tick so loop doesn't die
    if (currentSession.circuitBreakerTriggered) {
      const latestSess = sessions.get(sessionId);
      if (latestSess && latestSess.status === 'running') {
        latestSess.tickTimeoutId = setTimeout(tradingTick, 60000);
      }
      return;
    }

    try {
      // FIX 6a: STALE LEVERAGED POSITION GUARD
      // Force-exit any leveraged ETF positions from a previous trading day
      // Only runs during market hours (ACTIVE phase onward) to avoid pre-market forced exits
      // that miss gap-up opportunities
      const marketOpen = isMarketOpen();
      const minutesToClose = getMinutesUntilClose();
      const isDuringMarketHours = marketOpen && minutesToClose > 0;
      // Skip stale position guard for sessions with exitBeforeClose disabled
      // (they intentionally hold overnight to capture multi-day moves)
      const staleGuardEnabled = currentSession.config.exitBeforeClose !== false;
      if (isDuringMarketHours && staleGuardEnabled) {
        const positions = Array.from(currentSession.portfolio.positions.keys());
        for (const symbol of positions) {
          const leverage = getEtfLeverage(symbol);
          if (leverage <= 1) continue; // Only apply to leveraged ETFs
          const position = currentSession.portfolio.positions.get(symbol);
          const entryTime = position?.entryTime || position?.createdAt;
          if (!entryTime) continue;
          const entryDate = new Date(entryTime);
          const now = new Date();
          // Check if position was entered on a previous calendar day
          const isStale = entryDate.toDateString() !== now.toDateString();
          if (isStale) {
            tradingLogger.logRisk('Stale position guard', {
              sessionId,
              sessionName: currentSession.name,
              reason: `${symbol} (${leverage}x leveraged) held overnight from ${entryDate.toISOString()}`,
              action: 'Force exiting',
            });
            await executeExit(sessionId, symbol, {
              shouldExit: true,
              exitReason: `Stale position guard: ${leverage}x leveraged ETF held overnight`,
              reason: 'Stale overnight leveraged position',
              currentPrice: position?.currentPrice || 0,
              pnlPercent: position?.unrealizedPnLPercent || 0,
              pnl: position?.unrealizedPnL || 0,
              quantity: position?.quantity || 0,
            });
          }
        }
      }

      // END-OF-DAY EXIT: Close all positions before market close
      // This prevents overnight exposure for day trading strategies
      // Skip EOD exit for crypto sessions — crypto trades 24/7, no market close
      const isCryptoSession = currentSession.config.assetType === 'crypto';
      const exitBeforeClose =
        !isCryptoSession && currentSession.config.exitBeforeClose !== false; // Default true for stocks
      // FIX 6c: Leveraged ETFs get wider EOD window (at least 30 min before close)
      const hasLeveragedPositions = Array.from(
        currentSession.portfolio.positions.keys()
      ).some(sym => getEtfLeverage(sym) > 1);
      const configEodMinutes =
        currentSession.config.exitBeforeCloseMinutes || 15;
      const exitBeforeCloseMinutes = hasLeveragedPositions
        ? Math.max(configEodMinutes, 30)
        : configEodMinutes;
      const minutesUntilClose = getMinutesUntilClose();

      if (
        exitBeforeClose &&
        minutesUntilClose > 0 &&
        minutesUntilClose <= exitBeforeCloseMinutes
      ) {
        const positions = Array.from(currentSession.portfolio.positions.keys());
        if (positions.length > 0) {
          tradingLogger.logRisk('EOD EXIT', {
            sessionId,
            sessionName: currentSession.name,
            reason: `${minutesUntilClose.toFixed(0)} min until close, closing ${positions.length} position(s)`,
            action: 'Closing all positions',
          });

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
          // CRITICAL: Schedule next tick before returning so trading loop survives EOD exit
          const eodSess = sessions.get(sessionId);
          if (eodSess && eodSess.status === 'running') {
            eodSess.tickTimeoutId = setTimeout(tradingTick, 60000);
          }
          return; // Skip normal analysis during EOD exit
        }
      }

      // Analyze watchlist and make decisions
      await analyzeAndTrade(sessionId);
    } catch (error) {
      tradingLogger.logError('[AI Engine] Error in trading loop', {
        sessionId,
        sessionName: currentSession.name,
        error: error.message,
        stack: error.stack,
      });
      websocketServer.sendAlert(currentSession.userId, {
        type: 'error',
        title: 'Trading Error',
        message: `[${currentSession.name}] ${error.message}`,
        severity: 'high',
      });
    }

    // Schedule next tick with adaptive rate
    const latestSession = sessions.get(sessionId);
    if (latestSession && latestSession.status === 'running') {
      const positions = Array.from(latestSession.portfolio.positions.keys());
      const hasLeveraged = positions.some(sym => getEtfLeverage(sym) > 1);
      const hasPositions = positions.length > 0;
      const nearClose =
        getMinutesUntilClose() > 0 && getMinutesUntilClose() <= 30;

      let tickMs;
      if ((hasLeveraged || nearClose) && hasPositions) {
        tickMs = 3000; // 3s: leveraged positions or near close with positions
      } else if (hasPositions) {
        tickMs = 5000; // 5s: non-leveraged positions
      } else {
        tickMs = 10000; // 10s: scanning only
      }

      latestSession.tickTimeoutId = setTimeout(tradingTick, tickMs);
    }
  }

  // Start first tick immediately
  session.tickTimeoutId = setTimeout(tradingTick, 0);
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
    2024: '2024-03-29',
    2025: '2025-04-18',
    2026: '2026-04-03',
    2027: '2027-03-26',
    2028: '2028-04-14',
    2029: '2029-03-30',
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
 * Check if extended hours (pre-market or after-hours) session is currently open
 * Pre-market: 4:00 AM - 9:30 AM ET | After-hours: 4:00 PM - 8:00 PM ET
 * @returns {boolean}
 */
function isExtendedHoursOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;

  const dateStr = now.toISOString().split('T')[0];
  const holidays = getMarketHolidays(now.getFullYear());
  if (holidays.has(dateStr)) return false;

  const totalMinutes = getEasternMinutes();
  const inPreMarket =
    totalMinutes >= PREMARKET_OPEN_MINUTES &&
    totalMinutes < PREMARKET_CLOSE_MINUTES;
  const inAfterHours =
    totalMinutes >= AFTERHOURS_OPEN_MINUTES &&
    totalMinutes < AFTERHOURS_CLOSE_MINUTES;
  return inPreMarket || inAfterHours;
}

/**
 * Check if trading should be permitted for a session, accounting for extended hours
 * @param {Object} session - Trading session
 * @returns {boolean} true if the session may trade right now
 */
function canSessionTradeNow(session) {
  if (isMarketOpen()) return true;
  if (session?.config?.extendedHours === true && isExtendedHoursOpen()) {
    return true;
  }
  return false;
}

/**
 * Determine which symbols this session currently owns, based on its own
 * tradingLog. Used for attribution when allowDuplicatePositions=true so
 * sibling sessions don't double-claim the same broker position.
 *
 * Uses "most recent action wins" — if a symbol's most recent entry in the
 * tradingLog is a BUY, the session owns it; otherwise it doesn't. Net-quantity
 * approaches are unreliable because the log is capped at 100 entries and old
 * matching sells get truncated, leaving phantom open quantities.
 *
 * Known edge case: partial exits (BUY → SELL of < full qty) will report the
 * session as not owning the symbol, even though residual qty remains. Fine
 * for now since current strategies don't partial-exit; revisit if that changes.
 */
function getSessionOwnedSymbols(session) {
  const log = session.tradingLog || [];
  const lastAction = new Map();
  for (const entry of log) {
    if (!entry.symbol || !entry.side) continue;
    lastAction.set(entry.symbol, entry.side);
  }
  const owned = new Set();
  for (const [symbol, side] of lastAction) {
    if (side === 'buy') owned.add(symbol);
  }
  return owned;
}

/**
 * Sync portfolio with Alpaca account
 * @param {string} sessionId - Session identifier
 */
async function syncPortfolio(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // SIMULATION MODE: skip Alpaca calls; just mark-to-market existing positions.
  // The simulated executor owns cash + positions for these sessions.
  if (session.config.simulationMode) {
    try {
      await simulatedExecutor.markToMarket(session);
    } catch (err) {
      tradingLogger.logError('[Sim] markToMarket failed', {
        sessionId,
        sessionName: session.name,
        error: err.message,
      });
    }
    return;
  }

  try {
    // Get the trading mode for this session (paper or live)
    const tradingMode = getSessionTradingMode(session);
    const assetType = session.config.assetType || 'stocks';
    const account = await alpacaClient.getAccount(tradingMode);
    const positions = await getPositionsForAsset(tradingMode, assetType);
    // DEBUG: Log positions from Alpaca with session name
    tradingLogger.logInfo(
      `[AI Engine] "${session.name}" synced: ${positions.length} positions (${assetType}, ${tradingMode})`,
      { sessionId, sessionName: session.name }
    );

    session.portfolio.cash = parseFloat(account.cash);
    session.portfolio.initialValue = parseFloat(account.portfolio_value);
    session.stats.peakValue = Math.max(
      session.stats.peakValue,
      parseFloat(account.portfolio_value)
    );

    // Update positions (preserve entryTime and highWaterMark from existing positions if available)
    // Note: alpacaClient.getPositions() returns camelCase fields (quantity, avgEntryPrice, etc.)
    // Filter to watchlist symbols only (unless manageAllPositions) to prevent cross-session contamination
    const watchlistUpper = (session.config.watchlist || []).map(s =>
      s.toUpperCase()
    );
    const sessionAssetType =
      session.config.assetType ||
      detectAssetTypeFromWatchlist(session.config.watchlist || []);
    // For sessions that allow duplicate positions across siblings, additionally
    // attribute by tradingLog: a session only claims a broker position if its
    // own tradingLog has a net long in that symbol. Otherwise multiple sessions
    // double-claim the same broker position. Other sessions keep watchlist-only
    // filtering for backward compat.
    const sessionOwned = session.config.allowDuplicatePositions
      ? getSessionOwnedSymbols(session)
      : null;
    const filteredPositions = session.config.manageAllPositions
      ? positions
      : positions.filter(pos => {
          const posSymbol = (pos.symbol || '').toUpperCase();
          const normalizedSymbol = assetUtils.isCrypto(sessionAssetType)
            ? assetUtils.getBaseSymbol(posSymbol)
            : posSymbol;
          if (!watchlistUpper.includes(normalizedSymbol)) return false;
          if (sessionOwned && !sessionOwned.has(pos.symbol)) return false;
          return true;
        });
    // Atomic swap: build into temp Map, then replace — prevents partial state if forEach fails
    const existingPositions = new Map(session.portfolio.positions);
    const newPositions = new Map();
    filteredPositions.forEach(pos => {
      const existing = existingPositions.get(pos.symbol);
      const currentPrice =
        pos.currentPrice || parseFloat(pos.current_price) || 0;
      const avgEntryPrice =
        pos.avgEntryPrice || parseFloat(pos.avg_entry_price) || 0;

      // Track high water mark for trailing stop - update if current price is higher
      const existingHighWaterMark = existing?.highWaterMark || avgEntryPrice;
      const highWaterMark = Math.max(existingHighWaterMark, currentPrice);

      newPositions.set(pos.symbol, {
        symbol: pos.symbol,
        quantity: pos.quantity || parseInt(pos.qty) || 0,
        averageCost: avgEntryPrice,
        currentPrice: currentPrice,
        marketValue: pos.marketValue || parseFloat(pos.market_value) || 0,
        unrealizedPnL: pos.unrealizedPL || parseFloat(pos.unrealized_pl) || 0,
        unrealizedPnLPercent:
          pos.unrealizedPLPercent || parseFloat(pos.unrealized_plpc) * 100 || 0,
        side: pos.side,
        entryTime:
          existing?.entryTime || pos.created_at || new Date().toISOString(),
        highWaterMark: highWaterMark,
        partialExitDone: existing?.partialExitDone || false,
        partialExitPrice: existing?.partialExitPrice || null,
      });
    });
    session.portfolio.positions = newPositions;

    tradingLogger.logInfo(
      `[AI Engine] Portfolio synced (${tradingMode.toUpperCase()}): $${session.portfolio.cash.toFixed(2)} cash, ${session.portfolio.positions.size} positions`,
      { sessionId, sessionName: session.name }
    );

    // Periodically save session state
    saveSessions();
  } catch (error) {
    tradingLogger.logError('[AI Engine] Failed to sync portfolio', {
      sessionId,
      sessionName: session.name,
      error: error.message,
      stack: error.stack,
    });
  }
}

/**
 * Analyze watchlist and execute trades
 * @param {string} sessionId - Session identifier
 */
async function analyzeAndTrade(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // --- Daily profit target (Phase 4) ---
  // Reset day-tracking when the ET calendar day changes.
  const todayKey = etDayKey();
  if (session.lastDailyResetDate !== todayKey) {
    session.lastDailyResetDate = todayKey;
    session.dailyStartPnL = session.stats?.totalPnL || 0;
    session.dailyTargetHit = false;
    // Day-start equity is captured lazily post-sync (see the entry-risk gate),
    // so the daily-loss % uses a stable base rather than the ever-resynced
    // portfolio.initialValue.
    session.dailyStartEquity = null;
  }

  const dailyTarget = session.config.dailyProfitTargetPercent;
  if (dailyTarget && dailyTarget > 0 && !session.dailyTargetHit) {
    const todayPnL =
      (session.stats?.totalPnL || 0) - (session.dailyStartPnL || 0);
    const initialValue = session.portfolio?.initialValue || 100000;
    const dayPnLPct = (todayPnL / initialValue) * 100;

    if (dayPnLPct >= dailyTarget) {
      session.dailyTargetHit = true;
      tradingLogger.logRisk('Daily profit target hit', {
        sessionId,
        sessionName: session.name,
        reason: `+${dayPnLPct.toFixed(2)}% hit ${dailyTarget}% target`,
        value: dayPnLPct,
        threshold: dailyTarget,
        action: 'Closing positions and pausing',
      });

      // Close any open positions via the standard exit path
      const openSymbols = Array.from(session.portfolio.positions.keys());
      for (const symbol of openSymbols) {
        const position = session.portfolio.positions.get(symbol);
        await executeExit(sessionId, symbol, {
          shouldExit: true,
          exitReason: `Daily profit target ${dailyTarget}% hit`,
          reason: `Daily profit target ${dailyTarget}% hit`,
          currentPrice: position?.currentPrice || 0,
          pnlPercent: position?.unrealizedPnLPercent || 0,
          pnl: position?.unrealizedPnL || 0,
          quantity: position?.quantity || 0,
        });
      }

      websocketServer.sendAlert(session.userId, {
        type: 'success',
        title: 'Daily Profit Target Hit',
        message: `[${session.name}] +${dayPnLPct.toFixed(2)}% (target ${dailyTarget}%) — paused until next day`,
        severity: 'low',
      });

      pauseSession(sessionId);
      saveSessions();
      return;
    }
  }

  // CRITICAL: Sync portfolio from Alpaca before analyzing
  // This ensures we know about all positions for stop loss checks
  await syncPortfolio(sessionId);

  // --- Entry risk gate (opt-in soft halts) -----------------------------------
  // Block NEW entries when a risk limit trips, but keep exits + fast-path stops
  // flowing (session stays 'running'). No pause, no liquidation — the opposite
  // of triggerCircuitBreaker, which freezes the whole tick (including exits) and
  // would strand open positions with no stop-loss coverage. Each condition is
  // recomputed every tick, so entries auto-resume when it clears (drawdown
  // recovers, the ET day rolls over, or a win resets the loss streak).
  //
  // After syncPortfolio, sim (markToMarket) and paper/live (Alpaca) converge on
  // the same fields and session.stats.peakValue has just been re-maxed on both.
  let entriesHalted = false;
  let entryHaltReason = null;

  const positionsValue = [
    ...(session.portfolio?.positions?.values() || []),
  ].reduce((v, p) => v + (parseFloat(p.marketValue) || 0), 0);
  const currentEquity =
    (parseFloat(session.portfolio?.cash) || 0) + positionsValue;
  // Capture day-start equity once per ET day (post-sync) as a stable %-base,
  // rather than portfolio.initialValue which is re-synced to current equity.
  if (session.dailyStartEquity == null && currentEquity > 0) {
    session.dailyStartEquity = currentEquity;
  }

  // 1. Portfolio drawdown vs high-water mark (opt-in; null = off)
  const portDDLimit = session.config.maxPortfolioDrawdownPercent;
  if (portDDLimit != null && portDDLimit > 0) {
    const peak = session.stats?.peakValue || 0;
    if (peak > 0 && currentEquity > 0) {
      const ddPct = ((peak - currentEquity) / peak) * 100;
      if (ddPct >= portDDLimit) {
        entriesHalted = true;
        entryHaltReason =
          `Portfolio drawdown ${ddPct.toFixed(1)}% >= limit ${portDDLimit}% ` +
          `(equity $${currentEquity.toFixed(0)} vs peak $${peak.toFixed(0)})`;
      }
    }
  }

  // 2. Daily loss limit — realized day P&L vs day-start equity (opt-in; null = off)
  const dailyLossLimit = session.config.dailyLossLimitPercent;
  if (!entriesHalted && dailyLossLimit != null && dailyLossLimit > 0) {
    const todayPnL =
      (session.stats?.totalPnL || 0) - (session.dailyStartPnL || 0);
    const base =
      session.dailyStartEquity || session.portfolio?.initialValue || 100000;
    const dayLossPct = (todayPnL / base) * 100;
    if (dayLossPct <= -dailyLossLimit) {
      entriesHalted = true;
      entryHaltReason =
        `Daily loss ${dayLossPct.toFixed(2)}% <= -${dailyLossLimit}% ` +
        `(day P&L $${todayPnL.toFixed(0)} on $${base.toFixed(0)})`;
    }
  }

  // 3. Consecutive losses (opt-in; null = off). Auto-clears when a winning exit
  //    resets session.stats.consecutiveLosses in the executor.
  const rawLossLimit =
    session.config.maxConsecutiveLosses ?? session.config.consecutiveLossLimit;
  const consecLossLimit = rawLossLimit == null ? null : rawLossLimit;
  if (
    !entriesHalted &&
    consecLossLimit != null &&
    consecLossLimit > 0 &&
    (session.stats?.consecutiveLosses || 0) >= consecLossLimit
  ) {
    entriesHalted = true;
    entryHaltReason = `Consecutive losses ${session.stats.consecutiveLosses} >= limit ${consecLossLimit}`;
  }

  setEntriesHalted(sessionId, entriesHalted, entryHaltReason);

  const { watchlist, maxPositions, minConfidence } = session.config;

  // Log only when there are symbols to analyze
  if (watchlist?.length > 0) {
    tradingLogger.logInfo(
      `[AI Engine] Analyzing ${watchlist.length} symbols for "${session.name}"`,
      { sessionId, sessionName: session.name }
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
      tradingLogger.logInfo(
        `[AI Engine] ${session.name}: AI analysis triggered - ${aiTrigger.reason}`,
        { sessionId, sessionName: session.name }
      );
      aiAnalysis = await aiAnalyst.analyze(sentiment, aiTrigger.trigger);

      // Apply AI confidence adjustment
      if (aiAnalysis && aiAnalysis.confidenceAdjustment) {
        const originalConfidence = sentiment.confidence;
        sentiment.confidence = Math.max(
          0,
          Math.min(100, sentiment.confidence + aiAnalysis.confidenceAdjustment)
        );
        sentiment.aiEnhanced = true;
        sentiment.aiAnalysis = aiAnalysis;
        tradingLogger.logInfo(
          `[AI Engine] ${session.name}: AI adjusted confidence ${originalConfidence}% -> ${sentiment.confidence}%`,
          { sessionId, sessionName: session.name }
        );
      }
    }

    // Check market gate before proceeding
    const gateCheck = await checkMarketGate(session, sentiment);
    if (!gateCheck.allowed) {
      tradingLogger.logRisk('Market gate blocked', {
        sessionId,
        sessionName: session.name,
        reason: gateCheck.reason,
      });

      // Broadcast gate status to frontend
      websocketServer.broadcastToAll('trading_log', {
        id: `${Date.now()}-gate-${session.sessionId}`,
        level: 'INFO',
        category: 'MARKET_GATE',
        message: `Market gate: ${gateCheck.reason}`,
        sessionId: session.sessionId,
        sessionName: session.name,
        sentiment: sentiment
          ? {
              direction: sentiment.direction,
              confidence: sentiment.confidence,
            }
          : null,
        timestamp: new Date().toISOString(),
      });

      // Still check existing positions for exit signals even when gate is blocked
      // Filter to watchlist positions only (unless manageAllPositions is set)
      const gateBlockedPositions = Array.from(
        session.portfolio.positions.keys()
      );
      const watchlistUpperCaseGate = watchlist.map(s => s.toUpperCase());
      const positionsToCheck =
        session.config.manageAllPositions === true
          ? gateBlockedPositions
          : gateBlockedPositions.filter(symbol =>
              watchlistUpperCaseGate.includes(symbol.toUpperCase())
            );

      for (const symbol of positionsToCheck) {
        // Check for SOXS hold time limit
        if (
          symbol.toUpperCase() === 'SOXS' &&
          session.config.maxSoxsHoldMinutes
        ) {
          const position = session.portfolio.positions.get(symbol);
          const holdCheck = checkSoxsHoldTime(
            position,
            session.config.maxSoxsHoldMinutes
          );
          if (holdCheck.shouldExit) {
            tradingLogger.logRisk('SOXS hold time exceeded', {
              sessionId,
              sessionName: session.name,
              reason: holdCheck.reason,
              symbol,
              action: 'Force exiting',
            });
            await executeExit(sessionId, symbol, {
              shouldExit: true,
              reason: holdCheck.reason,
            });
            continue;
          }
        }

        // Check market phase for force exit
        const forceExitCheck = sentimentEngine.shouldForceExit(symbol);
        if (forceExitCheck.shouldExit) {
          tradingLogger.logRisk('Force exit', {
            sessionId,
            sessionName: session.name,
            reason: forceExitCheck.reason,
            symbol,
            action: 'Force exiting',
          });
          await executeExit(sessionId, symbol, {
            shouldExit: true,
            reason: forceExitCheck.reason,
          });
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
      tradingLogger.logInfo(
        `[AI Engine] ${session.name}: Phase ${phase.phase} - no new entries allowed`,
        { sessionId, sessionName: session.name }
      );
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
      aiAnalysis: aiAnalysis
        ? {
            direction: aiAnalysis.direction,
            confidenceAdjustment: aiAnalysis.confidenceAdjustment,
            reasoning: aiAnalysis.reasoning,
            riskLevel: aiAnalysis.riskLevel,
          }
        : null,
      timestamp: new Date().toISOString(),
    });
  }

  // ============================================================
  // REGIME GATE: For non-semiconductor sessions with regime gating
  // ============================================================
  if (
    !session.config.semiconductorMode &&
    session.config.regimeGateEnabled &&
    session.config.regimeReferenceSymbol
  ) {
    const regimeEngine = getOrCreateRegimeEngine(
      session.config.regimeReferenceSymbol
    );
    sentiment = await regimeEngine.getSentiment();
    const gateCheck = await checkMarketGate(session, sentiment);
    if (!gateCheck.allowed) {
      tradingLogger.logRisk('Regime gate blocked', {
        sessionId,
        sessionName: session.name,
        reason: `${session.config.regimeReferenceSymbol}: ${gateCheck.reason}`,
      });

      websocketServer.broadcastToAll('trading_log', {
        id: `${Date.now()}-regime-gate-${session.sessionId}`,
        level: 'INFO',
        category: 'REGIME_GATE',
        message: `Regime gate (${session.config.regimeReferenceSymbol}): ${gateCheck.reason}`,
        sessionId: session.sessionId,
        sessionName: session.name,
        sentiment: sentiment
          ? { direction: sentiment.direction, confidence: sentiment.confidence }
          : null,
        timestamp: new Date().toISOString(),
      });

      // Still evaluate exits for held positions (same pattern as semiconductor block)
      const positions = Array.from(session.portfolio.positions.keys());
      const wlUpper = watchlist.map(s => s.toUpperCase());
      const toCheck = session.config.manageAllPositions
        ? positions
        : positions.filter(s => wlUpper.includes(s.toUpperCase()));
      for (const sym of toCheck) {
        const exitDecision = await evaluateExit(sessionId, sym);
        if (exitDecision.shouldExit)
          await executeExit(sessionId, sym, exitDecision);
      }
      handleRegimeSessionSwitch(session, sentiment);
      return;
    }

    // Check market phase for entry permission
    const regimePhase = regimeEngine.getMarketPhase();
    if (!regimePhase.tradingAllowed) {
      tradingLogger.logInfo(
        `[AI Engine] ${session.name}: Regime phase ${regimePhase.phase} - no new entries allowed`,
        { sessionId, sessionName: session.name }
      );
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
    : currentPositions.filter(symbol =>
        watchlistUpperCase.includes(symbol.toUpperCase())
      );

  if (
    currentPositions.length > 0 &&
    positionsToManage.length === 0 &&
    !manageAllPositions
  ) {
    // Log once per session when we're skipping all positions (they're outside our watchlist)
    if (Math.random() < 0.01) {
      // Log rarely to avoid spam
      tradingLogger.logInfo(
        `[AI Engine] ${session.name}: Skipping ${currentPositions.length} positions (none in watchlist)`,
        { sessionId, sessionName: session.name }
      );
    }
  }

  // First, check existing positions for exit signals
  for (const symbol of positionsToManage) {
    // SEMICONDUCTOR MODE: Check SOXS hold time limit
    if (
      session.config.semiconductorMode &&
      symbol.toUpperCase() === 'SOXS' &&
      session.config.maxSoxsHoldMinutes
    ) {
      const position = session.portfolio.positions.get(symbol);
      const holdCheck = checkSoxsHoldTime(
        position,
        session.config.maxSoxsHoldMinutes
      );
      if (holdCheck.shouldExit) {
        tradingLogger.logRisk('SOXS hold time exceeded', {
          sessionId,
          sessionName: session.name,
          reason: holdCheck.reason,
          symbol,
          action: 'Force exiting',
        });
        await executeExit(sessionId, symbol, {
          shouldExit: true,
          reason: holdCheck.reason,
        });
        continue;
      }
    }

    // SEMICONDUCTOR MODE: Check market phase for force exit
    if (session.config.semiconductorMode) {
      const forceExitCheck = sentimentEngine.shouldForceExit(symbol);
      if (forceExitCheck.shouldExit) {
        tradingLogger.logRisk('Force exit (main loop)', {
          sessionId,
          sessionName: session.name,
          reason: forceExitCheck.reason,
          symbol,
          action: 'Force exiting',
        });
        await executeExit(sessionId, symbol, {
          shouldExit: true,
          reason: forceExitCheck.reason,
        });
        continue;
      }
    }

    const exitDecision = await evaluateExit(sessionId, symbol);
    if (exitDecision.shouldExit) {
      await executeExit(sessionId, symbol, exitDecision);
    }
  }

  // Then, look for entry opportunities if we have capacity (unless a risk gate
  // has halted new entries — exits above still ran this tick).
  if (!entriesHalted && currentPositions.length < maxPositions) {
    // For crypto sessions, normalize position symbols for comparison
    // Alpaca returns positions like "BTCUSD" but watchlist may have "BTC"
    const sessionAssetType = session.config.assetType || 'stocks';
    const normalizedPositions = assetUtils.isCrypto(sessionAssetType)
      ? currentPositions.map(pos => assetUtils.getBaseSymbol(pos))
      : currentPositions;

    // OPPORTUNITY RANKING: Evaluate all symbols first, then execute best by confidence
    const candidates = [];

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
      if (
        opposite &&
        normalizedPositions
          .map(s => s.toUpperCase())
          .includes(opposite.toUpperCase())
      ) {
        continue;
      }

      // SEMICONDUCTOR MODE: Check if symbol aligns with current sentiment direction
      if (session.config.semiconductorMode && sentiment) {
        const alignmentCheck = checkSymbolSentimentAlignment(symbol, sentiment);
        if (!alignmentCheck.allowed) {
          // Log but don't spam - only log occasionally
          if (Math.random() < 0.1) {
            // Log ~10% of the time
            tradingLogger.logInfo(
              `[AI Engine] ${session.name}: Skipping ${symbol} - ${alignmentCheck.reason}`,
              { sessionId, sessionName: session.name, symbol }
            );
          }
          continue;
        }

        // Check market phase entry permission for this specific symbol
        const entryCheck = sentimentEngine.canEnterPosition(symbol);
        if (!entryCheck.allowed) {
          tradingLogger.logInfo(
            `[AI Engine] ${session.name}: Cannot enter ${symbol} - ${entryCheck.reason}`,
            { sessionId, sessionName: session.name, symbol }
          );
          continue;
        }
      }

      // REGIME GATE: Check symbol alignment for regime-gated sessions
      if (
        !session.config.semiconductorMode &&
        session.config.regimeGateEnabled &&
        sentiment
      ) {
        const alignmentCheck = checkSymbolSentimentAlignment(symbol, sentiment);
        if (!alignmentCheck.allowed) {
          if (Math.random() < 0.1) {
            tradingLogger.logInfo(
              `[AI Engine] ${session.name}: Regime skipping ${symbol} - ${alignmentCheck.reason}`,
              { sessionId, sessionName: session.name, symbol }
            );
          }
          continue;
        }
      }

      // CROSS-SESSION: Block if another session holds this symbol or its opposing ETF
      // Skip for sessions running A/B experiments (allowDuplicatePositions)
      if (!session.config.allowDuplicatePositions) {
        const globalCheck = canEnterGlobally(sessionId, symbol);
        if (!globalCheck.allowed) {
          if (Math.random() < 0.05) {
            tradingLogger.logRisk('Cross-session block', {
              sessionId,
              sessionName: session.name,
              reason: globalCheck.reason,
              symbol,
            });
          }
          continue;
        }
      }

      // ENTRY LOCK: Prevent multiple sessions evaluating the same symbol simultaneously
      const lockKey = symbol.toUpperCase();
      const existingLock = globalEntryLocks.get(lockKey);
      if (existingLock && existingLock.sessionId !== sessionId) {
        const lockAge = Date.now() - existingLock.timestamp;
        if (lockAge < ENTRY_LOCK_TIMEOUT_MS) {
          tradingLogger.logInfo(
            `[AI Engine] ${session.name}: Skipping ${symbol} — entry lock held by "${existingLock.sessionName}"`,
            { sessionId, sessionName: session.name, symbol }
          );
          continue;
        }
        // Lock expired, clear it
        globalEntryLocks.delete(lockKey);
      }

      // Acquire lock before evaluating
      globalEntryLocks.set(lockKey, {
        sessionId,
        sessionName: session.name,
        timestamp: Date.now(),
      });
      try {
        const entryDecision = await evaluateEntry(sessionId, symbol);
        if (
          entryDecision.shouldEnter &&
          entryDecision.confidence >= minConfidence
        ) {
          candidates.push({ symbol, decision: entryDecision });
        }
      } finally {
        // Release lock (only if we still own it)
        const currentLock = globalEntryLocks.get(lockKey);
        if (currentLock && currentLock.sessionId === sessionId) {
          globalEntryLocks.delete(lockKey);
        }
      }
    }

    // Sort by confidence descending — best opportunity first
    candidates.sort((a, b) => b.decision.confidence - a.decision.confidence);

    // Execute top N candidates (up to remaining position capacity).
    // For broker sessions with entropyGateEnabled, run the Shannon-entropy
    // regime gate before each executeEntry — vetoes setups that don't match
    // the broker's preferred regime, and broadcasts the latest regime state.
    const slotsAvailable = maxPositions - session.portfolio.positions.size;
    for (const candidate of candidates.slice(0, slotsAvailable)) {
      if (session.config.entropyGateEnabled) {
        try {
          const gate = await entropyGate.checkEntropyGate(
            session,
            candidate.symbol
          );
          session.entropyRegimeState = {
            ...(gate.regime || {}),
            timestamp: new Date().toISOString(),
          };
          if (!gate.allow) {
            tradingLogger.logInfo(
              `[Entropy] ${session.name} blocked ${candidate.symbol}: ${gate.reason}`,
              {
                sessionId,
                sessionName: session.name,
                symbol: candidate.symbol,
                regime: gate.regime,
              }
            );
            continue;
          }
        } catch (err) {
          tradingLogger.logError(`[Entropy] gate check failed`, {
            sessionId,
            sessionName: session.name,
            symbol: candidate.symbol,
            error: err.message,
          });
          // Fail open: don't block on transient gate errors
        }
      }
      // Macro (FRED) risk-on/off overlay: force-flat veto in a credit-stress
      // regime, otherwise attach a position-size scalar (×1 risk-on, ×0.25
      // risk-off) that the executor applies. Inert unless the broker opts in AND
      // FRED_API_KEY is set.
      if (session.config.macroGateEnabled) {
        try {
          const mgate = await macroRegimeGate.checkMacroGate(session);
          session.macroRegimeState = {
            ...(mgate.regime || {}),
            timestamp: new Date().toISOString(),
          };
          if (!mgate.allow) {
            tradingLogger.logInfo(
              `[Macro] ${session.name} blocked ${candidate.symbol}: ${mgate.reason}`,
              {
                sessionId,
                sessionName: session.name,
                symbol: candidate.symbol,
                regime: mgate.regime,
              }
            );
            continue;
          }
          candidate.decision.macroSizeScalar = mgate.sizeScalar;
        } catch (err) {
          tradingLogger.logError(`[Macro] gate check failed`, {
            sessionId,
            sessionName: session.name,
            symbol: candidate.symbol,
            error: err.message,
          });
          // Fail open: don't block on transient gate errors
        }
      }
      await executeEntry(sessionId, candidate.symbol, candidate.decision);
      // Signal funnel: an entry order was actually placed for this candidate.
      if (session.stats) {
        session.stats.signalsEntered = (session.stats.signalsEntered || 0) + 1;
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
  return signalEvaluator.evaluateEntry(sessionId, symbol);
}

/**
 * Run a strategy's entry evaluation for a symbol against a throwaway session,
 * without touching the order path or persisting anything. Used by the
 * scripts/dry-run-strategy.js CLI to validate a plugin in isolation.
 *
 * The engine must be required with AI_ENGINE_DRY_RUN set so it stays inert
 * (no autostart, no persistence). The temp session is injected into the live
 * `sessions` map (the dispatcher reads it via ctx.sessions) and removed after.
 *
 * @param {object} config - a session config (e.g. from brokerToSessionConfig)
 * @param {string} symbol - Stock symbol to evaluate
 * @returns {object} the entry decision object
 */
async function dryRunEntry(config = {}, symbol) {
  const tempId = `dry-run-${symbol}-${Date.now()}`;
  const sessionConfig = { ...DEFAULT_CONFIG, ...config };
  const session = {
    sessionId: tempId,
    userId: 'dry-run',
    name: sessionConfig.name || `dry-run-${config.brokerSlug || 'broker'}`,
    status: 'running',
    startTime: new Date(),
    config: sessionConfig,
    portfolio: { cash: 100000, positions: new Map(), initialValue: 100000 },
    stats: { signalsEvaluated: 0, signalsPassed: 0, signalsEntered: 0 },
    decisions: [],
    alerts: [],
    tradingLog: [],
  };
  sessions.set(tempId, session);
  try {
    const decision = await signalEvaluator.evaluateEntry(tempId, symbol);
    return { decision, funnel: session.stats };
  } finally {
    sessions.delete(tempId);
    decisionHistory.delete(tempId);
  }
}

/**
 * Evaluate exit conditions for a position
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Exit decision
 */
async function evaluateExit(sessionId, symbol) {
  return signalEvaluator.evaluateExit(sessionId, symbol);
}

/**
 * Execute entry trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Entry decision
 */
async function executeEntry(sessionId, symbol, decision) {
  return orderExecutor.executeEntry(sessionId, symbol, decision);
}

/**
 * Execute exit trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Exit decision
 */
async function executeExit(sessionId, symbol, decision) {
  return orderExecutor.executeExit(sessionId, symbol, decision);
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

  // Log to trading logger
  tradingLogger.logRisk('CIRCUIT BREAKER', {
    sessionId,
    sessionName: session.name,
    reason,
    action: 'Trading paused',
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
 * Soft entry halt — blocks NEW entries while letting exits + fast-path stops
 * keep running (unlike triggerCircuitBreaker, which pauses the whole session and
 * would freeze stop-losses). Recomputed every tick by the entry-risk gate in
 * analyzeAndTrade; this only persists the surfaced state and emits a single
 * alert on each transition, so a risk trip never spams per-tick.
 * @param {string} sessionId
 * @param {boolean} halted
 * @param {?string} reason
 */
function setEntriesHalted(sessionId, halted, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const was = !!session.entriesHalted;
  session.entriesHalted = halted;
  session.entriesHaltReason = halted ? reason : null;
  if (halted === was) return; // no transition — stay quiet

  if (halted) {
    tradingLogger.logRisk('Entries halted', {
      sessionId,
      sessionName: session.name,
      reason,
      action: 'Blocking new entries; exits + stops still active',
    });
    websocketServer.sendAlert(session.userId, {
      type: 'warning',
      title: 'Entries Halted',
      message: `[${session.name}] ${reason}. New entries blocked; exits still active.`,
      severity: 'high',
      actionRequired: false,
    });
  } else {
    tradingLogger.logRisk('Entries resumed', {
      sessionId,
      sessionName: session.name,
      action: 'Risk gate cleared; entries re-enabled',
    });
    websocketServer.sendAlert(session.userId, {
      type: 'info',
      title: 'Entries Resumed',
      message: `[${session.name}] Risk gate cleared; entries re-enabled.`,
      severity: 'low',
    });
  }
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

  // Allow explicit name changes via config update
  if (newConfig.name) {
    session.name = newConfig.name;
  }
  const { name: _excludedName, ...configWithoutName } = newConfig;
  session.config = { ...session.config, ...configWithoutName };

  tradingLogger.logConfig('Config updated', {
    sessionId,
    sessionName: session.name,
  });
  saveSessions();
}

/**
 * Reset a session's portfolio to a fresh starting capital. Used by the broker
 * bridge when an agent's persona file changes its `capital` field, or when a
 * persisted session has drifted away from its broker's intended starting pool.
 * Only honored for simulated sessions to prevent accidental wipes on live paper.
 */
/**
 * Manually trigger a simulated entry on a session, bypassing the analyze loop.
 * Useful for testing end-to-end while markets are closed. Only works for
 * sessions in simulationMode — refuses to touch live/paper sessions.
 */
async function manualSimEntry(sessionId, symbol, decision = {}) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (!session.config.simulationMode)
    return { error: 'session not in simulationMode' };
  await simulatedExecutor.simulatedEntry(session, symbol.toUpperCase(), {
    confidence: decision.confidence || 75,
    reason: decision.reason || 'manual test trade',
  });
  return { ok: true };
}

/**
 * Manually trigger a simulated exit. Same constraints as manualSimEntry.
 */
async function manualSimExit(sessionId, symbol, decision = {}) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (!session.config.simulationMode)
    return { error: 'session not in simulationMode' };
  await simulatedExecutor.simulatedExit(session, symbol.toUpperCase(), {
    reason: decision.reason || 'manual test exit',
    exitReason: decision.exitReason || decision.reason || 'manual test exit',
  });
  return { ok: true };
}

/**
 * Test-only: seed a session's tradingLog and stats with N synthetic closed
 * trades drawn from a target win rate + payoff ratio. Used to demo the
 * tier-promotion engine and unblock Phase 6 dev before real history accumulates.
 *
 * Only honored for simulationMode sessions to prevent accidental tampering.
 */
function seedSyntheticTradeHistory(sessionId, opts = {}) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (!session.config.simulationMode)
    return { error: 'session not in simulationMode' };

  const n = Math.max(1, Math.min(500, parseInt(opts.trades) || 100));
  const winRate = Math.max(0, Math.min(1, parseFloat(opts.winRate) || 0.6));
  const avgWinPct = Math.max(0.01, parseFloat(opts.avgWinPct) || 1.5);
  const avgLossPct = Math.max(0.01, parseFloat(opts.avgLossPct) || 0.8);
  const daysBack = Math.max(1, parseInt(opts.daysBack) || 25);

  // Backdate the session start so promotion's "minDays" gate is satisfied
  session.startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  session.stats = session.stats || {};
  Object.assign(session.stats, {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    consecutiveLosses: 0,
    peakValue: session.portfolio?.initialValue || 100000,
    maxDrawdown: 0,
    winRate: 0,
  });
  session.tradingLog = [];

  let cumulativePnL = 0;
  const startCapital = session.portfolio?.initialValue || 100000;
  let peak = startCapital;
  let currentEquity = startCapital;
  const dollarRisk = startCapital * 0.05;

  for (let i = 0; i < n; i++) {
    const win = Math.random() < winRate;
    const pct = win
      ? avgWinPct * (0.6 + Math.random() * 0.8)
      : -avgLossPct * (0.6 + Math.random() * 0.8);
    const realizedPnL = dollarRisk * (pct / 100);
    const ts = new Date(
      Date.now() - ((n - i) * daysBack * 24 * 60 * 60 * 1000) / n
    ).toISOString();

    session.tradingLog.push({
      tradeId: `synthetic-${i}`,
      side: 'sell',
      symbol: 'SYNTH',
      quantity: 1,
      price: 100 + pct,
      realizedPnL,
      realizedPct: pct,
      exitReason: 'synthetic seed',
      entryPrice: 100,
      timestamp: ts,
      simulated: true,
    });

    if (win) {
      session.stats.wins++;
      session.stats.consecutiveLosses = 0;
    } else {
      session.stats.losses++;
      session.stats.consecutiveLosses++;
    }
    cumulativePnL += realizedPnL;
    currentEquity = startCapital + cumulativePnL;
    if (currentEquity > peak) peak = currentEquity;
    const drawdown = peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0;
    if (drawdown > session.stats.maxDrawdown)
      session.stats.maxDrawdown = drawdown;
  }

  session.stats.totalTrades = n;
  session.stats.totalPnL = cumulativePnL;
  session.stats.peakValue = peak;
  session.stats.winRate =
    n > 0 ? parseFloat(((session.stats.wins / n) * 100).toFixed(1)) : 0;

  saveSessions();
  return {
    ok: true,
    seeded: n,
    winRate: session.stats.winRate,
    totalPnL: cumulativePnL,
    maxDrawdown: session.stats.maxDrawdown,
    startTime: session.startTime,
  };
}

/**
 * Transition a broker session from simulated to paper (real Alpaca paper).
 * Preserves historical stats (wins, losses, totalPnL, peakValue, maxDrawdown,
 * winRate) so the tier-promotion engine still sees the broker's track record,
 * but resets the portfolio to the paper allocation since the broker is now
 * trading the shared paper account, not a virtual pool.
 *
 * Appends a marker entry to tradingLog so the audit trail captures the
 * tier change. Closes any open simulated positions first (they were virtual).
 */
function transitionToPaperTier(sessionId, paperAllocation) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (session.config.simulationMode === false) {
    return { error: 'session is already on real Alpaca path' };
  }
  // Wipe simulated positions — they were virtual; the real Alpaca account has
  // no such positions to match. Cash resets to the paper allocation.
  const previousPnL = session.stats?.totalPnL || 0;
  session.portfolio = {
    cash: paperAllocation,
    positions: new Map(),
    initialValue: paperAllocation,
  };
  session.config.simulationMode = false;
  session.config.tradingMode = 'paper';
  session.config.allocatedCapital = paperAllocation;
  session.config.initialCapital = paperAllocation;
  session.config.tier = 'paper';
  session.tradingLog = session.tradingLog || [];
  session.tradingLog.push({
    tradeId: `tier-promote-${Date.now()}`,
    side: 'meta',
    symbol: 'TIER',
    timestamp: new Date().toISOString(),
    note: `promoted simulated → paper (allocation=$${paperAllocation}, prior sim PnL=$${previousPnL.toFixed(2)})`,
  });
  // Reset peak AND drawdown so paper risk is measured from the new starting
  // capital, not the simulated history. Previously only peakValue was reset, so
  // a healthy broker promoted after a clean run was demoted/fired on its first
  // paper eval on a stale sim-era drawdown. Stats history (wins/losses) is kept.
  if (session.stats) {
    session.stats.peakValue = paperAllocation;
    session.stats.maxDrawdown = 0;
  }
  saveSessions();
  return { ok: true, paperAllocation, previousPnL };
}

/**
 * Demote: paper → simulated. Closes any open real positions (panic sell)
 * before resetting to a fresh simulated capital pool. Stats history preserved.
 */
async function transitionToSimulatedTier(sessionId, simCapital) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (session.config.simulationMode === true) {
    return { error: 'session is already simulated' };
  }
  // Close any open real positions first — we're walking away from this account
  try {
    await panicSell(sessionId);
  } catch (err) {
    tradingLogger.logError(
      `[Tier] panic-sell on demote failed for ${session.name}`,
      {
        sessionId,
        error: err.message,
      }
    );
  }
  session.portfolio = {
    cash: simCapital,
    positions: new Map(),
    initialValue: simCapital,
  };
  session.config.simulationMode = true;
  session.config.allocatedCapital = simCapital;
  session.config.initialCapital = simCapital;
  session.config.tier = 'simulated';
  session.tradingLog = session.tradingLog || [];
  session.tradingLog.push({
    tradeId: `tier-demote-${Date.now()}`,
    side: 'meta',
    symbol: 'TIER',
    timestamp: new Date().toISOString(),
    note: `demoted paper → simulated (new sim capital=$${simCapital})`,
  });
  if (session.stats) session.stats.peakValue = simCapital;
  saveSessions();
  return { ok: true, simCapital };
}

/**
 * Reset just the consecutive-losses counter and circuit-breaker flag without
 * touching cash, positions, or any other state. Useful after applying engine
 * fixes (e.g. new safety guards) so a broker doesn't immediately trip its
 * breaker on its pre-fix loss streak.
 */
function resetLossStreak(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return { error: 'no session' };
  if (!session.config.simulationMode) return { error: 'not in simulationMode' };
  const prev = session.stats?.consecutiveLosses || 0;
  if (session.stats) session.stats.consecutiveLosses = 0;
  session.circuitBreakerTriggered = false;
  saveSessions();
  return { ok: true, prevConsecutiveLosses: prev };
}

function resetSessionCapital(sessionId, capital) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (!session.config.simulationMode) return false;
  session.portfolio = {
    cash: capital,
    positions: new Map(),
    initialValue: capital,
  };
  session.stats = {
    ...(session.stats || {}),
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    unrealizedPnL: 0,
    totalPnLWithUnrealized: 0,
    consecutiveLosses: 0,
    peakValue: capital,
    maxDrawdown: 0,
    winRate: 0,
  };
  saveSessions();
  return true;
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
  const normalizedSymbol = assetUtils.normalizeSymbol(
    symbol,
    assetType,
    'alpaca'
  );

  try {
    if (action === 'buy') {
      const order = await placeOrderForAsset(
        {
          symbol: normalizedSymbol,
          qty: quantity,
          side: 'buy',
          type: 'market',
          time_in_force: assetUtils.isCrypto(assetType) ? 'gtc' : 'day',
        },
        tradingMode,
        assetType
      );

      logDecision(sessionId, {
        symbol: normalizedSymbol,
        action: 'MANUAL_BUY',
        quantity,
        timestamp: new Date(),
      });

      return { success: true, orderId: order.id };
    } else if (action === 'sell') {
      const result = await closePositionForAsset(
        normalizedSymbol,
        tradingMode,
        assetType
      );

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

// =============================================
// REAL-TIME WEBSOCKET PRICE STREAM (Fast-Path Exits)
// =============================================

/**
 * Recalculate which symbols need WS streaming based on all running sessions.
 * Subscribes to new symbols, unsubscribes removed ones.
 */
function _recalculateStreamSubscriptions() {
  // The Alpaca IEX real-time feed caps subscriptions at the data plan's symbol
  // limit (30); an over-limit subscribe is rejected wholesale (code=405) and
  // subscribes NOTHING, starving every symbol of real-time prices and pushing
  // exits onto the slower (and recently flaky) Polygon REST path — the root
  // cause of the data-failure exit losses. So we PRIORITIZE: symbols with open
  // positions first (they need fresh ticks for fast-path stop-loss/exit and
  // mark-to-market), then fill the remaining slots with watchlist entry
  // candidates (which tolerate Polygon REST for entries).
  const cap = alpacaStream.maxSymbols || 28;

  const seen = new Set();
  const positionSyms = [];
  const watchlistSyms = [];
  // Pass 1: open positions across all running sessions (highest priority).
  sessions.forEach(session => {
    if (session.status !== 'running') return;
    for (const sym of session.portfolio.positions.keys()) {
      if (!seen.has(sym)) {
        seen.add(sym);
        positionSyms.push(sym);
      }
    }
  });
  // Pass 2: remaining watchlist names (entry candidates).
  sessions.forEach(session => {
    if (session.status !== 'running') return;
    for (const sym of session.config.watchlist || []) {
      if (!seen.has(sym)) {
        seen.add(sym);
        watchlistSyms.push(sym);
      }
    }
  });

  // Positions always covered; fill the rest with watchlist up to the cap.
  const needed = [...positionSyms];
  for (const sym of watchlistSyms) {
    if (needed.length >= cap) break;
    needed.push(sym);
  }
  const neededSet = new Set(needed);

  if (positionSyms.length > cap) {
    tradingLogger.logRisk('STREAM SYMBOL CAP', {
      reason: `${positionSyms.length} open-position symbols exceed the stream cap (${cap})`,
      value: positionSyms.length,
      threshold: cap,
      action:
        'Lowest-priority held positions will rely on Polygon REST for exits',
    });
  }

  const current = new Set(alpacaStream.getStatus().subscribedSymbols);
  const toRemove = [...current].filter(s => !neededSet.has(s));
  // Preserve positions-first ordering so the client's ceiling, if ever hit,
  // drops watchlist tail rather than a held position.
  const toAdd = needed.filter(s => !current.has(s));

  // Unsubscribe BEFORE subscribe so freed slots are available under the cap
  // (e.g. a new position swapping in for a dropped watchlist name).
  if (toRemove.length > 0) alpacaStream.unsubscribe(toRemove);
  if (toAdd.length > 0) alpacaStream.subscribe(toAdd);
}

/**
 * Fast-path exit check — runs on every WS trade event.
 * Only checks stop-loss and trailing-stop (no indicators).
 * Reuses executeExit() which has globalExitLocks for race safety.
 */
function fastPathExitCheck(symbol, wsPrice) {
  sessions.forEach(session => {
    if (session.status !== 'running') return;

    const position = session.portfolio.positions.get(symbol);
    if (!position) return;

    // Update live price on position
    position.currentPrice = wsPrice;
    const entryPrice = position.avgEntryPrice || position.entryPrice;
    if (!entryPrice || entryPrice <= 0) return;

    const pnlPercent = ((wsPrice - entryPrice) / entryPrice) * 100;
    position.unrealizedPnL =
      (wsPrice - entryPrice) * (position.quantity || position.shares || 0);
    position.unrealizedPnLPercent = pnlPercent;

    // Update high water mark for trailing stop
    if (!position.highWaterMark || wsPrice > position.highWaterMark) {
      position.highWaterMark = wsPrice;
    }

    const cfg = session.config;
    const leverage = getEtfLeverage(symbol);
    const rawStopLoss = cfg.stopLossPercent || 1;
    const stopLossPercent =
      leverage > 1
        ? Math.max(rawStopLoss, rawStopLoss * leverage)
        : rawStopLoss;

    // 1. Hard stop-loss
    if (pnlPercent <= -stopLossPercent) {
      tradingLogger.logRisk('WS Fast-Path STOP LOSS', {
        sessionId: session.sessionId,
        sessionName: session.name,
        symbol,
        reason: `${pnlPercent.toFixed(2)}% <= -${stopLossPercent}%`,
        value: pnlPercent,
        threshold: -stopLossPercent,
        action: 'Triggering exit',
      });
      executeExit(session.sessionId, symbol, {
        exitReason: `WS Fast-Path Stop Loss (${pnlPercent.toFixed(2)}%)`,
        reason: 'stop loss',
        confidence: 100,
        factors: [
          `Real-time price $${wsPrice.toFixed(2)} hit stop loss at ${pnlPercent.toFixed(2)}%`,
        ],
      });
      return;
    }

    // 2. Trailing stop
    const trailingStopPercent = cfg.trailingStopPercent;
    if (trailingStopPercent && position.highWaterMark) {
      const dropFromHigh =
        ((position.highWaterMark - wsPrice) / position.highWaterMark) * 100;
      if (dropFromHigh >= trailingStopPercent) {
        tradingLogger.logRisk('WS Fast-Path TRAILING STOP', {
          sessionId: session.sessionId,
          sessionName: session.name,
          symbol,
          reason: `Dropped ${dropFromHigh.toFixed(2)}% from high $${position.highWaterMark.toFixed(2)}`,
          value: dropFromHigh,
          threshold: trailingStopPercent,
          action: 'Triggering exit',
        });
        executeExit(session.sessionId, symbol, {
          exitReason: `WS Fast-Path Trailing Stop (${dropFromHigh.toFixed(2)}% from high)`,
          reason: 'stop loss',
          confidence: 95,
          factors: [
            `Real-time price $${wsPrice.toFixed(2)} dropped ${dropFromHigh.toFixed(2)}% from high $${position.highWaterMark.toFixed(2)}`,
          ],
        });
      }
    }
  });
}

// Wire WS stream events
alpacaStream.on('trade', ({ symbol, price }) => {
  fastPathExitCheck(symbol, price);
  websocketServer.broadcastPriceUpdate(symbol, { price });
});

alpacaStream.on('authenticated', () => {
  tradingLogger.logInfo(
    '[AI Engine] Alpaca stream authenticated — syncing subscriptions'
  );
  _recalculateStreamSubscriptions();
});

alpacaStream.on('error', err => {
  tradingLogger.logError('[AI Engine] Alpaca stream error', {
    error: err.message,
  });
});

// Start the stream connection
alpacaStream.connect();

// --- Session Health Monitoring ---

const STALE_SESSION_THRESHOLD_MS = 120000; // 2 minutes

/**
 * Get health status for all running sessions
 * @returns {Array<{sessionId, name, status, lastTickTime, staleSeconds, isStale, positionCount}>}
 */
function getSessionHealth() {
  const health = [];
  const now = Date.now();
  sessions.forEach((session, sessionId) => {
    if (session.status !== 'running') return;
    const lastTick = session.lastTickTime || null;
    const staleMs = lastTick ? now - lastTick : null;
    const staleSeconds = staleMs !== null ? Math.round(staleMs / 1000) : null;
    health.push({
      sessionId,
      name: session.name,
      status: session.status,
      lastTickTime: lastTick ? new Date(lastTick).toISOString() : null,
      staleSeconds,
      isStale: staleMs !== null ? staleMs > STALE_SESSION_THRESHOLD_MS : true,
      positionCount: session.portfolio?.positions?.size || 0,
    });
  });
  return health;
}

// Background stale session monitor — checks every 60s, alerts via WebSocket.
// Disabled in dry-run mode so a CLI harness can exit cleanly.
const _staleMonitorInterval = process.env.AI_ENGINE_DRY_RUN
  ? null
  : setInterval(() => {
      const now = Date.now();
      sessions.forEach((session, sessionId) => {
        if (session.status !== 'running') return;
        const lastTick = session.lastTickTime;
        if (!lastTick) return; // Not yet started
        const staleMs = now - lastTick;
        if (staleMs > STALE_SESSION_THRESHOLD_MS) {
          const staleSeconds = Math.round(staleMs / 1000);
          tradingLogger.logRisk('SESSION STALE', {
            sessionId,
            sessionName: session.name,
            reason: `No tick for ${staleSeconds}s`,
            value: staleSeconds,
            threshold: Math.round(STALE_SESSION_THRESHOLD_MS / 1000),
            action: 'WebSocket alert sent',
          });
          websocketServer.sendAlert(session.userId, {
            type: 'error',
            title: 'Session Stale',
            message: `"${session.name}" has not ticked for ${staleSeconds}s — trading loop may have died`,
            severity: 'critical',
          });
        }
      });
    }, 60000);

// Periodic stream-subscription reconcile. _recalculateStreamSubscriptions only
// runs on session lifecycle events, but positions open/close mid-session — this
// makes sure a freshly-opened position claims a prioritized real-time slot
// within ~20s (and a closed one frees its slot). Cheap: only subscribe/
// unsubscribe deltas are sent; a no-change pass is a couple of set diffs.
const _streamReconcileInterval = process.env.AI_ENGINE_DRY_RUN
  ? null
  : setInterval(() => {
      try {
        _recalculateStreamSubscriptions();
      } catch (err) {
        tradingLogger.logError('Stream subscription reconcile failed', {
          error: err.message,
        });
      }
    }, 20000);

// Cleanup on process exit
process.on('beforeExit', () => {
  clearInterval(_staleMonitorInterval);
  if (_streamReconcileInterval) clearInterval(_streamReconcileInterval);
});

// --- Wire up extracted modules ---
// Build shared context for signalEvaluator and orderExecutor.
// All module-level state and helper functions that the extracted code needs
// are passed via this object so the modules don't require aiTradingEngine.js back.
const _sharedCtx = {
  // State maps
  sessions,
  tradeCooldowns,
  pendingOrders,
  globalEntryLocks,
  globalExitLocks,
  exitEvalFailCounts,
  entryContexts,
  decisionHistory,
  // Helper functions
  getEtfLeverage,
  getOppositeEtf,
  getEtfType,
  isCounterTrend,
  isRegimeAligned,
  getRawMarketRegime,
  getStableRegime,
  getGlobalPositionExposure,
  canEnterGlobally,
  canExitGlobally,
  claimExitLock,
  releaseExitLock,
  checkSymbolSentimentAlignment,
  checkSoxsHoldTime,
  getOrCreateRegimeEngine,
  handleSentimentSessionSwitch,
  handleRegimeSessionSwitch,
  checkMarketGate,
  canExecuteDayTrade,
  updatePDTStateCache,
  shouldThrottleError,
  clearStalePositionState,
  getAggregatesForAsset,
  getLatestQuoteForAsset,
  placeOrderForAsset,
  closePositionForAsset,
  getSessionTradingMode,
  detectAssetTypeFromWatchlist,
  addSessionAlert,
  addSessionTrade,
  logDecision,
  syncPortfolio,
  saveSessions,
  getMinutesUntilClose,
  triggerCircuitBreaker,
  getCachedFlowData,
  isDST,
  isMarketOpen,
  isExtendedHoursOpen,
  fastPathExitCheck,
  // Constants
  BULLISH_ETFS,
  BEARISH_ETFS,
  ETF_LEVERAGE,
  ETF_PAIRS,
  TRADE_COOLDOWN_MINUTES,
  PENDING_ORDER_TIMEOUT_MS,
  MAX_AGGREGATE_EXPOSURE_PCT,
  GLOBAL_MAX_POSITION_PERCENT,
  GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT,
  EXIT_EVAL_MAX_FAILURES,
};
signalEvaluator.init(_sharedCtx);
orderExecutor.init(_sharedCtx);
simulatedExecutor.init(_sharedCtx);

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
  dryRunEntry,
  updateConfig,
  resetSessionCapital,
  resetLossStreak,
  manualSimEntry,
  manualSimExit,
  seedSyntheticTradeHistory,
  transitionToPaperTier,
  transitionToSimulatedTier,
  manualOverride,
  getDailySummary,
  getDecisionHistory,
  isMarketOpen,
  isExtendedHoursOpen,
  canSessionTradeNow,
  getMinutesUntilClose,
  syncPortfolio,
  saveSessions, // Exposed for graceful shutdown
  getSessionHealth, // Health monitoring for /api/ai/health
  // Semiconductor strategy exports
  getStrategyPreset,
  listStrategyPresets,
  STRATEGY_PRESETS,
};
