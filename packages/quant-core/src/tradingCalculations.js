/**
 * Trading Calculations — Pure functions extracted from aiTradingEngine.js
 *
 * All functions here are pure (no async, no side effects, no external deps)
 * making them safe to unit test in isolation.
 */

// --- ETF Constants ---

const BULLISH_ETFS = ['SOXL', 'QBTX', 'PLTU', 'TQQQ', 'SPXL', 'UPRO', 'TECL', 'FNGU'];
const BEARISH_ETFS = ['SOXS', 'QBTZ', 'SQQQ', 'SPXS', 'TECS', 'FNGD'];

const ETF_LEVERAGE = {
  'SOXL': 3, 'SOXS': 3, 'QBTX': 3, 'QBTZ': 3,
  'TQQQ': 3, 'SQQQ': 3, 'SPXL': 3, 'SPXS': 3,
  'TECL': 3, 'TECS': 3, 'FNGU': 3, 'FNGD': 3,
  'PLTU': 2, 'PLTZ': 2,
};

const ETF_PAIRS = {
  'SOXL': 'SOXS', 'SOXS': 'SOXL',
  'QBTX': 'QBTZ', 'QBTZ': 'QBTX',
  'TQQQ': 'SQQQ', 'SQQQ': 'TQQQ',
  'SPXL': 'SPXS', 'SPXS': 'SPXL',
  'TECL': 'TECS', 'TECS': 'TECL',
  'FNGU': 'FNGD', 'FNGD': 'FNGU',
};

// --- Market Hours Constants ---

const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;
const PREMARKET_OPEN_MINUTES = 4 * 60;   // 240
const PREMARKET_CLOSE_MINUTES = 9 * 60 + 30; // 570
const AFTERHOURS_OPEN_MINUTES = 16 * 60; // 960
const AFTERHOURS_CLOSE_MINUTES = 20 * 60; // 1200

// --- ETF Functions ---

function getEtfLeverage(symbol) {
  return ETF_LEVERAGE[symbol.toUpperCase()] || 1;
}

function getOppositeEtf(symbol) {
  return ETF_PAIRS[symbol.toUpperCase()] || null;
}

// --- DST / Timezone ---

function isDST(date) {
  const year = date.getUTCFullYear();
  const mar1 = new Date(Date.UTC(year, 2, 1));
  const marDST = new Date(Date.UTC(year, 2, 14 - mar1.getUTCDay(), 7));
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const novDST = new Date(Date.UTC(year, 10, 7 - nov1.getUTCDay() || 7, 6));
  return date >= marDST && date < novDST;
}

function getEasternOffset(now) {
  if (!now) now = new Date();
  const month = now.getMonth();
  const dayOfMonth = now.getDate();

  if (month === 2) {
    const secondSunday = 14 - new Date(now.getFullYear(), 2, 1).getDay();
    if (dayOfMonth >= secondSunday) return -4;
    return -5;
  }
  if (month === 10) {
    let firstSunday = 7 - new Date(now.getFullYear(), 10, 1).getDay();
    if (firstSunday === 0) firstSunday = 7;
    if (dayOfMonth < firstSunday) return -4;
    return -5;
  }
  if (month >= 3 && month <= 9) return -4;
  return -5;
}

function getEasternMinutes(now) {
  if (!now) now = new Date();
  const utcHours = now.getUTCHours();
  const etOffset = getEasternOffset(now);
  const etHours = (utcHours + etOffset + 24) % 24;
  const minutes = now.getUTCMinutes();
  return etHours * 60 + minutes;
}

// --- Market Hours ---

function getMarketHolidays(year) {
  const holidays = new Set();

  holidays.add(`${year}-01-01`);
  holidays.add(`${year}-07-04`);
  holidays.add(`${year}-12-25`);

  const mlk = new Date(year, 0, 1);
  mlk.setDate(1 + ((8 - mlk.getDay()) % 7) + 14);
  holidays.add(mlk.toISOString().split('T')[0]);

  const presidents = new Date(year, 1, 1);
  presidents.setDate(1 + ((8 - presidents.getDay()) % 7) + 14);
  holidays.add(presidents.toISOString().split('T')[0]);

  const goodFridays = {
    2024: '2024-03-29', 2025: '2025-04-18', 2026: '2026-04-03',
    2027: '2027-03-26', 2028: '2028-04-14', 2029: '2029-03-30'
  };
  if (goodFridays[year]) holidays.add(goodFridays[year]);

  const memorial = new Date(year, 4, 31);
  memorial.setDate(31 - ((memorial.getDay() + 6) % 7));
  holidays.add(memorial.toISOString().split('T')[0]);

  holidays.add(`${year}-06-19`);

  const labor = new Date(year, 8, 1);
  labor.setDate(1 + ((8 - labor.getDay()) % 7));
  holidays.add(labor.toISOString().split('T')[0]);

  const thanksgiving = new Date(year, 10, 1);
  thanksgiving.setDate(1 + ((11 - thanksgiving.getDay()) % 7) + 21);
  holidays.add(thanksgiving.toISOString().split('T')[0]);

  return holidays;
}

function getMinutesUntilClose(now) {
  const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return marketCloseMinutes - getEasternMinutes(now);
}

function isMarketOpen(now) {
  if (!now) now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;

  const dateStr = now.toISOString().split('T')[0];
  const holidays = getMarketHolidays(now.getFullYear());
  if (holidays.has(dateStr)) return false;

  const totalMinutes = getEasternMinutes(now);
  const marketOpenMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  return totalMinutes >= marketOpenMinutes && totalMinutes < marketCloseMinutes;
}

function isExtendedHoursOpen(now) {
  if (!now) now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;

  const dateStr = now.toISOString().split('T')[0];
  const holidays = getMarketHolidays(now.getFullYear());
  if (holidays.has(dateStr)) return false;

  const totalMinutes = getEasternMinutes(now);
  const inPreMarket = totalMinutes >= PREMARKET_OPEN_MINUTES && totalMinutes < PREMARKET_CLOSE_MINUTES;
  const inAfterHours = totalMinutes >= AFTERHOURS_OPEN_MINUTES && totalMinutes < AFTERHOURS_CLOSE_MINUTES;
  return inPreMarket || inAfterHours;
}

function canSessionTradeNow(session, now) {
  if (isMarketOpen(now)) return true;
  if (session?.config?.extendedHours === true && isExtendedHoursOpen(now)) return true;
  return false;
}

// --- Position Sizing ---

/**
 * Calculate position quantity from sizing parameters.
 * Returns null (not NaN) on any invalid input.
 *
 * @param {object} params
 * @param {number} params.maxPositionValue - Max dollar value for position
 * @param {number} params.currentPrice - Current share price
 * @param {number} params.riskAmount - Dollar risk per trade
 * @param {number|null} params.stopLoss - Stop loss price (null = use simple sizing)
 * @param {boolean} params.isCrypto - Fractional shares allowed
 * @returns {number|null} quantity, or null if invalid
 */
function calculateQuantity({ maxPositionValue, currentPrice, riskAmount, stopLoss, isCrypto }) {
  if (!currentPrice || currentPrice <= 0 || isNaN(currentPrice)) return null;
  if (!maxPositionValue || maxPositionValue <= 0 || isNaN(maxPositionValue)) return null;

  let quantity;

  if (stopLoss && stopLoss > 0 && stopLoss < currentPrice) {
    const riskPerShare = currentPrice - stopLoss;
    const sharesFromRisk = isCrypto ? riskAmount / riskPerShare : Math.floor(riskAmount / riskPerShare);
    const sharesFromMaxSize = isCrypto ? maxPositionValue / currentPrice : Math.floor(maxPositionValue / currentPrice);
    quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
  } else {
    quantity = isCrypto ? maxPositionValue / currentPrice : Math.floor(maxPositionValue / currentPrice);
  }

  if (isNaN(quantity) || !isFinite(quantity) || quantity <= 0) return null;

  if (isCrypto) {
    quantity = Math.round(quantity * 100000000) / 100000000;
    const minQuantity = 10 / currentPrice;
    if (quantity < minQuantity) return null;
  } else {
    quantity = Math.max(1, Math.min(quantity, 1000));
  }

  return quantity;
}

// --- Asset Type Detection ---

function detectAssetTypeFromWatchlist(watchlist, assetUtils) {
  if (!watchlist || watchlist.length === 0) {
    return assetUtils.ASSET_TYPES.STOCKS;
  }
  for (const symbol of watchlist) {
    const upperSymbol = symbol.toUpperCase();
    if (
      assetUtils.CRYPTO_BASE_TO_PAIR?.[upperSymbol] ||
      upperSymbol.includes('/USD') ||
      upperSymbol.endsWith('USD')
    ) {
      return assetUtils.ASSET_TYPES.CRYPTO;
    }
  }
  return assetUtils.ASSET_TYPES.STOCKS;
}

module.exports = {
  // ETF constants
  BULLISH_ETFS,
  BEARISH_ETFS,
  ETF_LEVERAGE,
  ETF_PAIRS,
  // Market hours constants
  MARKET_OPEN_HOUR,
  MARKET_OPEN_MINUTE,
  MARKET_CLOSE_HOUR,
  MARKET_CLOSE_MINUTE,
  PREMARKET_OPEN_MINUTES,
  PREMARKET_CLOSE_MINUTES,
  AFTERHOURS_OPEN_MINUTES,
  AFTERHOURS_CLOSE_MINUTES,
  // ETF functions
  getEtfLeverage,
  getOppositeEtf,
  // Time functions
  isDST,
  getEasternOffset,
  getEasternMinutes,
  // Market hours functions
  getMarketHolidays,
  getMinutesUntilClose,
  isMarketOpen,
  isExtendedHoursOpen,
  canSessionTradeNow,
  // Position sizing
  calculateQuantity,
  // Asset detection
  detectAssetTypeFromWatchlist,
};
