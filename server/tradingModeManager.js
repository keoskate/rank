/**
 * TRADING MODE MANAGER - Paper vs Live Trading Configuration
 *
 * Manages switching between paper trading (safe testing) and live trading (real money).
 * Ensures proper credentials are used and adds safety confirmations for live trades.
 *
 * Features:
 * - Environment-based mode selection
 * - Separate API credentials for paper/live
 * - Safety checks and confirmations
 * - Account verification
 */

// Trading mode configuration
const TRADING_MODES = {
  PAPER: 'paper',
  LIVE: 'live',
};

// Current trading mode (default to PAPER for safety)
let currentMode = process.env.TRADING_MODE || TRADING_MODES.PAPER;

// Alpaca API endpoints
const ALPACA_ENDPOINTS = {
  [TRADING_MODES.PAPER]: 'https://paper-api.alpaca.markets', // https://paper-api.alpaca.markets/v2
  [TRADING_MODES.LIVE]: 'https://api.alpaca.markets',
};

// API Credentials - Must be set via environment variables
// See .env.example for setup instructions
const CREDENTIALS = {
  [TRADING_MODES.PAPER]: {
    apiKey: process.env.ALPACA_PAPER_API_KEY,
    secretKey: process.env.ALPACA_PAPER_SECRET_KEY,
    expectedAccountNumber: process.env.ALPACA_PAPER_ACCOUNT || 'PA3Q8Y2RHTID',
  },
  [TRADING_MODES.LIVE]: {
    apiKey: process.env.ALPACA_LIVE_API_KEY,
    secretKey: process.env.ALPACA_LIVE_SECRET_KEY,
    expectedAccountNumber: process.env.ALPACA_LIVE_ACCOUNT || '',
  },
};

/**
 * Get current trading mode
 */
function getCurrentMode() {
  return currentMode;
}

/**
 * Get base URL for current mode
 */
function getBaseURL() {
  return ALPACA_ENDPOINTS[currentMode];
}

/**
 * Get API credentials for current mode
 */
function getCredentials() {
  const creds = CREDENTIALS[currentMode];

  if (!creds.apiKey || !creds.secretKey) {
    throw new Error(`Missing API credentials for ${currentMode} mode`);
  }

  return {
    apiKey: creds.apiKey,
    secretKey: creds.secretKey,
  };
}

/**
 * Set trading mode (with safety checks)
 */
function setTradingMode(mode) {
  if (!Object.values(TRADING_MODES).includes(mode)) {
    throw new Error(`Invalid trading mode: ${mode}. Must be 'paper' or 'live'`);
  }

  const previousMode = currentMode;
  currentMode = mode;

  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `⚠️  TRADING MODE CHANGED: ${previousMode.toUpperCase()} → ${mode.toUpperCase()}`
  );
  console.log(`${'='.repeat(60)}`);

  if (mode === TRADING_MODES.LIVE) {
    console.log(`🔴 LIVE TRADING MODE ACTIVE - REAL MONEY AT RISK`);
    console.log(
      `   Account: ${CREDENTIALS[TRADING_MODES.LIVE].expectedAccountNumber}`
    );
  } else {
    console.log(`🟢 PAPER TRADING MODE - Safe testing environment`);
    console.log(
      `   Account: ${CREDENTIALS[TRADING_MODES.PAPER].expectedAccountNumber}`
    );
  }
  console.log(`${'='.repeat(60)}\n`);

  return {
    previousMode,
    currentMode,
    isLive: mode === TRADING_MODES.LIVE,
  };
}

/**
 * Check if currently in live trading mode
 */
function isLiveMode() {
  return currentMode === TRADING_MODES.LIVE;
}

/**
 * Check if currently in paper trading mode
 */
function isPaperMode() {
  return currentMode === TRADING_MODES.PAPER;
}

/**
 * Verify account matches expected account number for current mode
 */
function verifyAccount(accountNumber) {
  const expected = CREDENTIALS[currentMode].expectedAccountNumber;
  const matches = accountNumber === expected;

  if (!matches) {
    console.warn(`⚠️  Account mismatch in ${currentMode} mode!`);
    console.warn(`   Expected: ${expected}`);
    console.warn(`   Got: ${accountNumber}`);
  }

  return {
    matches,
    expected,
    actual: accountNumber,
    mode: currentMode,
  };
}

/**
 * Get safety configuration for current mode
 */
function getSafetyConfig() {
  if (isLiveMode()) {
    return {
      requireConfirmation: true,
      maxOrderValue: 10000, // Max $10k per order in live mode
      maxDailyTrades: 50,
      requireDoubleConfirm: true,
      warningMessage: '⚠️ LIVE TRADING - REAL MONEY WILL BE USED',
      confirmationText: 'I understand this is LIVE trading with real money',
    };
  }

  return {
    requireConfirmation: false,
    maxOrderValue: Infinity,
    maxDailyTrades: Infinity,
    requireDoubleConfirm: false,
    warningMessage: '✅ Paper Trading - Simulated money only',
    confirmationText: null,
  };
}

/**
 * Validate order before execution (safety checks)
 */
function validateOrder(orderParams, accountValue) {
  const safety = getSafetyConfig();
  const errors = [];
  const warnings = [];

  // Calculate order value
  const orderValue =
    (orderParams.qty || 0) *
    (orderParams.limit_price || orderParams.market_price || 0);

  // Check max order value in live mode
  if (isLiveMode() && orderValue > safety.maxOrderValue) {
    errors.push(
      `Order value ($${orderValue.toFixed(2)}) exceeds maximum allowed ($${safety.maxOrderValue}) in live mode`
    );
  }

  // Warn if order is large relative to account
  if (accountValue && orderValue > accountValue * 0.25) {
    warnings.push(
      `Order represents ${((orderValue / accountValue) * 100).toFixed(1)}% of account value`
    );
  }

  // Live mode warnings
  if (isLiveMode()) {
    warnings.push('🔴 LIVE MODE: This order will execute with real money');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    orderValue,
    requiresConfirmation: safety.requireConfirmation,
    safetyConfig: safety,
  };
}

/**
 * Get mode information for display
 */
function getModeInfo() {
  const creds = CREDENTIALS[currentMode];
  const safety = getSafetyConfig();

  return {
    mode: currentMode,
    isLive: isLiveMode(),
    isPaper: isPaperMode(),
    baseURL: getBaseURL(),
    accountNumber: creds.expectedAccountNumber,
    safetyConfig: safety,
    statusEmoji: isLiveMode() ? '🔴' : '🟢',
    statusText: isLiveMode() ? 'LIVE TRADING' : 'PAPER TRADING',
    description: isLiveMode()
      ? 'Real money trading - All orders execute with actual funds'
      : 'Simulated trading - Safe testing environment with virtual money',
  };
}

module.exports = {
  TRADING_MODES,
  getCurrentMode,
  setTradingMode,
  isLiveMode,
  isPaperMode,
  getBaseURL,
  getCredentials,
  verifyAccount,
  getSafetyConfig,
  validateOrder,
  getModeInfo,
};
