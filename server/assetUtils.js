/**
 * Asset Utilities - Helper functions for asset type detection and symbol formatting
 *
 * This module provides utilities for handling different asset types (stocks, crypto)
 * with proper symbol formatting and validation for each API.
 *
 * Asset Types:
 * - 'stocks' (default): Traditional equities, ETFs - subject to PDT rules
 * - 'crypto': Cryptocurrencies - no PDT rules, 24/7 trading
 */

// Supported asset types
const ASSET_TYPES = {
  STOCKS: 'stocks',
  CRYPTO: 'crypto',
};

// Common crypto pairs supported by Alpaca
// Format: Alpaca uses 'BTC/USD', Polygon uses 'X:BTCUSD'
const SUPPORTED_CRYPTO = [
  'BTC/USD',
  'ETH/USD',
  'LTC/USD',
  'BCH/USD',
  'LINK/USD',
  'UNI/USD',
  'AAVE/USD',
  'AVAX/USD',
  'BAT/USD',
  'CRV/USD',
  'DOGE/USD',
  'DOT/USD',
  'GRT/USD',
  'MKR/USD',
  'SHIB/USD',
  'SOL/USD',
  'SUSHI/USD',
  'USDC/USD',
  'USDT/USD',
  'XTZ/USD',
  'YFI/USD',
];

// Map of base symbols to full crypto pairs (for user convenience)
const CRYPTO_BASE_TO_PAIR = {
  BTC: 'BTC/USD',
  ETH: 'ETH/USD',
  LTC: 'LTC/USD',
  BCH: 'BCH/USD',
  LINK: 'LINK/USD',
  UNI: 'UNI/USD',
  AAVE: 'AAVE/USD',
  AVAX: 'AVAX/USD',
  BAT: 'BAT/USD',
  CRV: 'CRV/USD',
  DOGE: 'DOGE/USD',
  DOT: 'DOT/USD',
  GRT: 'GRT/USD',
  MKR: 'MKR/USD',
  SHIB: 'SHIB/USD',
  SOL: 'SOL/USD',
  SUSHI: 'SUSHI/USD',
  USDC: 'USDC/USD',
  USDT: 'USDT/USD',
  XTZ: 'XTZ/USD',
  YFI: 'YFI/USD',
};

/**
 * Validate asset type
 * @param {string} assetType - Asset type to validate
 * @returns {boolean} True if valid
 */
function isValidAssetType(assetType) {
  return Object.values(ASSET_TYPES).includes(assetType);
}

/**
 * Get default asset type
 * @returns {string} Default asset type ('stocks')
 */
function getDefaultAssetType() {
  return ASSET_TYPES.STOCKS;
}

/**
 * Check if asset type is crypto
 * @param {string} assetType - Asset type to check
 * @returns {boolean} True if crypto
 */
function isCrypto(assetType) {
  return assetType === ASSET_TYPES.CRYPTO;
}

/**
 * Check if asset type is stocks
 * @param {string} assetType - Asset type to check
 * @returns {boolean} True if stocks
 */
function isStocks(assetType) {
  return assetType === ASSET_TYPES.STOCKS || !assetType;
}

/**
 * Normalize crypto symbol to Alpaca format (BTC/USD)
 * Handles various input formats: BTC, BTCUSD, BTC/USD, btc
 * @param {string} symbol - Input symbol
 * @returns {string} Normalized symbol in Alpaca format (e.g., 'BTC/USD')
 */
function normalizeForAlpacaCrypto(symbol) {
  if (!symbol) return symbol;

  const upper = symbol.toUpperCase().trim();

  // Already in correct format
  if (upper.includes('/USD')) {
    return upper;
  }

  // Handle BTCUSD format
  if (upper.endsWith('USD') && upper.length > 3) {
    const base = upper.slice(0, -3);
    return `${base}/USD`;
  }

  // Handle bare symbol (BTC -> BTC/USD)
  if (CRYPTO_BASE_TO_PAIR[upper]) {
    return CRYPTO_BASE_TO_PAIR[upper];
  }

  // Return as-is with /USD appended if it looks like a crypto base
  if (upper.length <= 5 && /^[A-Z]+$/.test(upper)) {
    return `${upper}/USD`;
  }

  return upper;
}

/**
 * Normalize crypto symbol to Polygon format (X:BTCUSD)
 * Handles various input formats: BTC, BTCUSD, BTC/USD, btc, X:BTCUSD
 * @param {string} symbol - Input symbol
 * @returns {string} Normalized symbol in Polygon format (e.g., 'X:BTCUSD')
 */
function normalizeForPolygonCrypto(symbol) {
  if (!symbol) return symbol;

  let upper = symbol.toUpperCase().trim();

  // Already in Polygon format with USD
  if (upper.startsWith('X:') && upper.endsWith('USD')) {
    return upper;
  }

  // Remove X: prefix if present but missing USD
  if (upper.startsWith('X:')) {
    upper = upper.slice(2);
  }

  // Remove slash if present (BTC/USD -> BTCUSD)
  const withoutSlash = upper.replace('/', '');

  // Add USD suffix if not present
  const withUSD = withoutSlash.endsWith('USD') ? withoutSlash : `${withoutSlash}USD`;

  // Add X: prefix
  return `X:${withUSD}`;
}

/**
 * Normalize stock symbol (just uppercase, trim)
 * @param {string} symbol - Input symbol
 * @returns {string} Normalized stock symbol
 */
function normalizeStockSymbol(symbol) {
  if (!symbol) return symbol;
  return symbol.toUpperCase().trim();
}

/**
 * Normalize symbol based on asset type and target API
 * @param {string} symbol - Input symbol
 * @param {string} assetType - 'stocks' or 'crypto'
 * @param {string} targetApi - 'alpaca' or 'polygon'
 * @returns {string} Normalized symbol
 */
function normalizeSymbol(symbol, assetType, targetApi = 'alpaca') {
  if (isStocks(assetType)) {
    return normalizeStockSymbol(symbol);
  }

  if (isCrypto(assetType)) {
    if (targetApi === 'polygon') {
      return normalizeForPolygonCrypto(symbol);
    }
    return normalizeForAlpacaCrypto(symbol);
  }

  return symbol;
}

/**
 * Validate crypto symbol
 * @param {string} symbol - Symbol to validate
 * @returns {object} { valid: boolean, normalized: string, error?: string }
 */
function validateCryptoSymbol(symbol) {
  const normalized = normalizeForAlpacaCrypto(symbol);

  if (SUPPORTED_CRYPTO.includes(normalized)) {
    return { valid: true, normalized };
  }

  // Check if it looks like a valid crypto format even if not in our list
  if (/^[A-Z]{2,5}\/USD$/.test(normalized)) {
    return {
      valid: true,
      normalized,
      warning: `${normalized} is not in the known supported list - may not be available`,
    };
  }

  return {
    valid: false,
    normalized,
    error: `Invalid crypto symbol format: ${symbol}. Expected format: BTC, BTC/USD, or BTCUSD`,
  };
}

/**
 * Validate stock symbol (basic validation)
 * @param {string} symbol - Symbol to validate
 * @returns {object} { valid: boolean, normalized: string, error?: string }
 */
function validateStockSymbol(symbol) {
  const normalized = normalizeStockSymbol(symbol);

  // Basic stock symbol validation (1-5 uppercase letters, sometimes with dots for class)
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(normalized)) {
    return { valid: true, normalized };
  }

  return {
    valid: false,
    normalized,
    error: `Invalid stock symbol format: ${symbol}. Expected 1-5 letters (e.g., AAPL, MSFT)`,
  };
}

/**
 * Validate symbol based on asset type
 * @param {string} symbol - Symbol to validate
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {object} { valid: boolean, normalized: string, error?: string }
 */
function validateSymbol(symbol, assetType) {
  if (isCrypto(assetType)) {
    return validateCryptoSymbol(symbol);
  }
  return validateStockSymbol(symbol);
}

/**
 * Validate a watchlist of symbols
 * @param {Array<string>} watchlist - Array of symbols
 * @param {string} assetType - 'stocks' or 'crypto'
 * @returns {object} { valid: boolean, normalized: Array, errors: Array }
 */
function validateWatchlist(watchlist, assetType) {
  if (!Array.isArray(watchlist)) {
    return { valid: false, normalized: [], errors: ['Watchlist must be an array'] };
  }

  const normalized = [];
  const errors = [];
  const warnings = [];

  for (const symbol of watchlist) {
    const result = validateSymbol(symbol, assetType);
    if (result.valid) {
      normalized.push(result.normalized);
      if (result.warning) {
        warnings.push(result.warning);
      }
    } else {
      errors.push(result.error);
    }
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors,
    warnings,
  };
}

/**
 * Get display name for asset type
 * @param {string} assetType - Asset type
 * @returns {string} Human-readable name
 */
function getAssetTypeDisplayName(assetType) {
  switch (assetType) {
    case ASSET_TYPES.CRYPTO:
      return 'Cryptocurrency';
    case ASSET_TYPES.STOCKS:
    default:
      return 'Stocks & ETFs';
  }
}

/**
 * Check if PDT rules apply to this asset type
 * @param {string} assetType - Asset type
 * @returns {boolean} True if PDT rules apply
 */
function pdtApplies(assetType) {
  // PDT only applies to stocks/ETFs, not crypto
  return isStocks(assetType);
}

/**
 * Check if market hours apply to this asset type
 * @param {string} assetType - Asset type
 * @returns {boolean} True if market hours apply
 */
function marketHoursApply(assetType) {
  // Market hours only apply to stocks, crypto trades 24/7
  return isStocks(assetType);
}

/**
 * Get minimum order requirements for asset type
 * @param {string} assetType - Asset type
 * @returns {object} { minQty, supportsNotional, supportsFractional }
 */
function getOrderRequirements(assetType) {
  if (isCrypto(assetType)) {
    return {
      minQty: 0.0001, // Crypto supports very small quantities
      supportsNotional: true, // Can order by dollar amount
      supportsFractional: true, // Fractional crypto is standard
    };
  }

  return {
    minQty: 1, // Stocks require whole shares (unless fractional enabled)
    supportsNotional: true, // Alpaca supports notional orders for stocks too
    supportsFractional: false, // Depends on account settings
  };
}

module.exports = {
  // Constants
  ASSET_TYPES,
  SUPPORTED_CRYPTO,
  CRYPTO_BASE_TO_PAIR,

  // Type checking
  isValidAssetType,
  getDefaultAssetType,
  isCrypto,
  isStocks,

  // Symbol normalization
  normalizeSymbol,
  normalizeForAlpacaCrypto,
  normalizeForPolygonCrypto,
  normalizeStockSymbol,

  // Validation
  validateSymbol,
  validateCryptoSymbol,
  validateStockSymbol,
  validateWatchlist,

  // Display helpers
  getAssetTypeDisplayName,

  // Trading rules
  pdtApplies,
  marketHoursApply,
  getOrderRequirements,
};
