/**
 * Shared Trading Logic
 *
 * Core buy/sell decision logic used by both the TradingSimulator and ConfigOptimizer.
 * This ensures 100% parity between predicted and actual results.
 *
 * IMPORTANT: Any changes to this file affect both simulation and live trading logic.
 * The backend aiTradingEngine.js should be kept in sync with these calculations.
 */

// Simulation constants
export const MARKET_OPEN_HOUR = 9.5; // 9:30 AM EST
export const MARKET_CLOSE_HOUR = 16; // 4:00 PM EST

// Common crypto symbols for detection
const CRYPTO_SYMBOLS = ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'UNI', 'AAVE', 'AVAX', 'BAT', 'CRV', 'DOGE', 'DOT', 'GRT', 'MKR', 'SHIB', 'SOL', 'SUSHI', 'USDC', 'USDT', 'XTZ', 'YFI'];

/**
 * Check if symbol is a cryptocurrency
 */
export const isCryptoSymbol = (sym) => {
  if (!sym) return false;
  const upper = sym.toUpperCase();
  return CRYPTO_SYMBOLS.includes(upper) ||
         upper.includes('/USD') ||
         upper.startsWith('X:');
};

/**
 * Convert timestamp to EST hour (handles timezone correctly)
 */
export const getEstHour = timestamp => {
  const date = new Date(timestamp);
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  let estHours = utcHours - 5;
  if (estHours < 0) estHours += 24;
  return estHours + utcMinutes / 60;
};

/**
 * Helper for boolean config values (handles "Yes"/"No" strings)
 */
export const toBool = val => val === true || val === 'Yes' || val === 'yes';

/**
 * Calculate indicators from candle data
 * MUST match full simulation's calculations EXACTLY
 *
 * @param {number} index - Current candle index
 * @param {Array} allCandles - Array of all candles
 * @returns {Object} Calculated indicators { rsi, vwap, ma20, volumeRatio, priceChange }
 */
export const calculateIndicators = (index, allCandles) => {
  // Helper to safely get candle values
  const getVal = (c, field) => c?.[field] ?? c?.[field[0]] ?? 0;
  const getClose = c => getVal(c, 'close') || getVal(c, 'c') || 0;
  const getHigh = c => getVal(c, 'high') || getVal(c, 'h') || 0;
  const getLow = c => getVal(c, 'low') || getVal(c, 'l') || 0;
  const getVolume = c => getVal(c, 'volume') || getVal(c, 'v') || 0;

  // RSI calculation - MATCHES full simulation exactly
  const lookback = Math.min(14, index);
  let gains = 0, losses = 0;
  for (let i = index - lookback; i < index; i++) {
    if (i > 0 && allCandles[i] && allCandles[i - 1]) {
      const currClose = getClose(allCandles[i]);
      const prevClose = getClose(allCandles[i - 1]);
      if (prevClose > 0) {
        const change = currClose - prevClose;
        if (change > 0) gains += change;
        else losses -= change;
      }
    }
  }
  const avgGain = lookback > 0 ? gains / lookback : 0;
  const avgLoss = lookback > 0 ? losses / lookback : 0.001;
  const rs = avgGain / Math.max(avgLoss, 0.001);
  const rsi = 100 - 100 / (1 + rs);

  // VWAP calculation - MATCHES full simulation exactly
  let cumulativeTPV = 0, cumulativeVol = 0;
  for (let i = 0; i <= index; i++) {
    const c = allCandles[i];
    const vol = getVolume(c);
    if (vol > 0) {
      const tp = (getHigh(c) + getLow(c) + getClose(c)) / 3;
      cumulativeTPV += tp * vol;
      cumulativeVol += vol;
    }
  }
  const price = getClose(allCandles[index]);
  const vwap = cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : price;

  // MA20 calculation - MATCHES full simulation exactly
  let ma20Sum = 0;
  const ma20Lookback = Math.min(20, index + 1);
  for (let i = index - ma20Lookback + 1; i <= index; i++) {
    if (i >= 0 && allCandles[i]) {
      ma20Sum += getClose(allCandles[i]);
    }
  }
  const ma20 = ma20Lookback > 0 ? ma20Sum / ma20Lookback : price;

  // Volume ratio - MATCHES full simulation exactly (uses 10 candles)
  const volLookback = Math.min(10, index);
  let totalVol = 0;
  for (let i = index - volLookback; i < index; i++) {
    if (i >= 0 && allCandles[i]) {
      totalVol += getVolume(allCandles[i]);
    }
  }
  const avgVolume = volLookback > 0 ? totalVol / volLookback : 1;
  const currentVol = getVolume(allCandles[index]);
  const volumeRatio = avgVolume > 0 ? currentVol / avgVolume : 1;

  // Price change from previous candle
  const prevPrice = index > 0 ? getClose(allCandles[index - 1]) : price;
  const priceChange = prevPrice > 0 ? (price - prevPrice) / prevPrice : 0;

  return { rsi, vwap, ma20, volumeRatio, priceChange };
};

/**
 * Determine if a BUY signal should be triggered
 *
 * @param {number} price - Current price
 * @param {Object} indicators - Calculated indicators from calculateIndicators()
 * @param {Object} cfg - Trading configuration
 * @param {Object|null} position - Current position (null if no position)
 * @returns {Object} { shouldBuy, signals, reasons, confidence, meetsRequirements }
 */
export const shouldBuy = (price, indicators, cfg, position) => {
  if (position) return { shouldBuy: false, signals: 0, reasons: [] };

  const strategy = cfg.entryStrategy || 'balanced';
  const rsiOversold = cfg.rsiOversold || 30;
  const vwapDeviation = (cfg.vwapDeviationPercent || 0.5) / 100;
  const volumeMultiplier = cfg.volumeMultiplier || 1.5;
  const minSignalsRequired = cfg.minSignalsRequired || 2;
  const minConfidence = cfg.minConfidence || 70;
  const requireVolumeSpike = toBool(cfg.requireVolumeSpike);
  const requireTrendAlign = toBool(cfg.requireTrendAlignment) || toBool(cfg.requireTrendAlign);
  const requireRsiSignal = toBool(cfg.requireRsiSignal);

  let signals = 0;
  const reasons = [];
  let hasRsiSignal = false;
  let hasTrendSignal = false;
  let hasVolumeSpike = false;

  const { rsi, vwap, ma20, volumeRatio, priceChange } = indicators;

  // DIP SIGNALS (for: dip, balanced, conservative)
  if (strategy === 'dip' || strategy === 'balanced' || strategy === 'conservative') {
    if (rsi < rsiOversold) {
      signals++;
      hasRsiSignal = true;
      reasons.push(`RSI oversold (${Math.round(rsi)})`);
    }
    if (price < vwap * (1 - vwapDeviation)) {
      signals++;
      hasTrendSignal = true;
      reasons.push(`Below VWAP by ${(vwapDeviation * 100).toFixed(1)}%`);
    }
    if (priceChange < -0.005 && priceChange > -0.02 && price > ma20) {
      signals++;
      hasTrendSignal = true;
      reasons.push('Pullback in uptrend');
    }
  }

  // MOMENTUM SIGNALS (for: momentum, balanced, aggressive)
  if (strategy === 'momentum' || strategy === 'balanced' || strategy === 'aggressive') {
    if (rsi > 50 && rsi < 65) {
      signals++;
      hasRsiSignal = true;
      reasons.push(`RSI momentum (${Math.round(rsi)})`);
    }
    if (price > vwap * (1 + vwapDeviation) && priceChange > 0) {
      signals++;
      hasTrendSignal = true;
      reasons.push(`Breakout above VWAP (+${((price/vwap - 1) * 100).toFixed(1)}%)`);
    }
    if (price > ma20 * 1.005) {
      signals++;
      hasTrendSignal = true;
      reasons.push('Above MA20 uptrend');
    }
  }

  // VOLUME SPIKE (applies to all strategies)
  if (volumeRatio > volumeMultiplier) {
    signals++;
    hasVolumeSpike = true;
    reasons.push(`Volume spike (${volumeRatio.toFixed(1)}x)`);
  }

  // Check requirements
  let meetsRequirements = true;
  if (requireRsiSignal && !hasRsiSignal) meetsRequirements = false;
  if (requireVolumeSpike && !hasVolumeSpike) meetsRequirements = false;
  if (requireTrendAlign && !hasTrendSignal) meetsRequirements = false;

  // Calculate confidence (aligned with backend aiTradingEngine.js)
  const confidence = Math.min(95, 50 + signals * 15);

  const buy = signals >= minSignalsRequired && meetsRequirements && confidence >= minConfidence;

  return { shouldBuy: buy, signals, reasons, confidence, meetsRequirements };
};

/**
 * Determine if a SELL signal should be triggered
 *
 * @param {number} price - Current price
 * @param {number} entryPrice - Entry price of position
 * @param {Object} indicators - Calculated indicators from calculateIndicators()
 * @param {Object} cfg - Trading configuration
 * @param {number} candleIndex - Current candle index
 * @param {number} entryIndex - Candle index when position was entered
 * @param {number} timestamp - Current candle timestamp
 * @param {number} highWaterMark - Highest price since entry (for trailing stop)
 * @returns {Object} { shouldSell, sellScore, reasons, confidence, pnlPercent }
 */
export const shouldSell = (price, entryPrice, indicators, cfg, candleIndex, entryIndex, timestamp, highWaterMark) => {
  const pnlPercent = ((price - entryPrice) / entryPrice) * 100;
  const minConfidence = cfg.minConfidence || 70;
  const rsiOverbought = cfg.rsiOverbought || 70;
  const profitTargetPercent = cfg.takeProfitPercent || 2;
  const stopLossPercent = cfg.stopLossPercent || 1;
  // Trailing stop is now a % of gains to lock in (e.g., 50 means lock in 50% of gains from high)
  const trailingStopOfTP = cfg.trailingStopPercent || 0; // 0-100, represents % of gains to protect

  const estHour = getEstHour(timestamp);
  const { rsi, vwap, priceChange } = indicators;

  // Minimum hold time (5 candles, except stop loss, trailing stop, or EOD)
  const candlesSinceEntry = candleIndex - (entryIndex || 0);
  const minHoldCandles = 5;

  // Score-based sell system (aligned with backend aiTradingEngine.js)
  let sellScore = 0;
  const reasons = [];

  // Profit target hit - 30 points
  if (pnlPercent >= profitTargetPercent) {
    sellScore += 30;
    reasons.push(`Profit target hit (+${pnlPercent.toFixed(2)}%)`);
  }

  // Stop loss hit - 40 points (immediate exit)
  if (pnlPercent <= -stopLossPercent) {
    sellScore += 40;
    reasons.push(`Stop loss triggered (${pnlPercent.toFixed(2)}%)`);
  }

  // Trailing stop - 35 points
  // trailingStopOfTP is 0-100: e.g., 50 means "lock in 50% of gains" (sell if price drops 50% back toward entry)
  let trailingStopTriggered = false;
  if (trailingStopOfTP > 0 && highWaterMark && highWaterMark > entryPrice && pnlPercent > 0) {
    const gainFromEntry = highWaterMark - entryPrice;
    const allowedDropFromHigh = gainFromEntry * (100 - trailingStopOfTP) / 100;
    const triggerPrice = highWaterMark - allowedDropFromHigh;
    const lockedInGainPercent = ((triggerPrice - entryPrice) / entryPrice) * 100;

    if (price <= triggerPrice) {
      sellScore += 35;
      trailingStopTriggered = true;
      reasons.push(`Trailing stop (locked in ${lockedInGainPercent.toFixed(2)}% of ${((highWaterMark - entryPrice) / entryPrice * 100).toFixed(2)}% gain)`);
    }
  }

  // RSI overbought - 20 points
  if (rsi > rsiOverbought) {
    sellScore += 20;
    reasons.push(`RSI overbought (${Math.round(rsi)} > ${rsiOverbought})`);
  }

  // Momentum fading - 15 points
  if (price > vwap * 1.01 && priceChange < 0) {
    sellScore += 15;
    reasons.push('Momentum fading above VWAP');
  }

  // End of day - 50 points (highest priority)
  if (estHour >= 15.75) {
    sellScore += 50;
    reasons.push('End of day liquidation');
  }

  // Hold time exempt conditions: stop loss, trailing stop, or EOD
  const holdTimeExempt = pnlPercent <= -stopLossPercent || trailingStopTriggered || estHour >= 15.75;

  // Exit threshold: 50 points (aligned with backend aiTradingEngine.js)
  const confidence = Math.min(95, 50 + sellScore);
  const canSell = (candlesSinceEntry >= minHoldCandles || holdTimeExempt) &&
                  (sellScore >= 50 || estHour >= 15.75);

  return { shouldSell: canSell, sellScore, reasons, confidence, pnlPercent };
};

/**
 * Detect intraday regime based on price action
 *
 * @param {Array} candleData - All candle data
 * @param {number} currentIdx - Current candle index
 * @param {number} openPrice - Day's open price
 * @returns {Object|null} Regime detection result
 */
export const detectIntradayRegime = (candleData, currentIdx, openPrice) => {
  if (!candleData || currentIdx < 10 || !openPrice) return null;

  const recentCandles = candleData.slice(Math.max(0, currentIdx - 30), currentIdx + 1);
  const currentCandle = candleData[currentIdx];
  const price = currentCandle.close ?? currentCandle.c;

  // Calculate metrics
  const priceVsOpen = ((price - openPrice) / openPrice) * 100;

  // Calculate trend from recent highs/lows
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = 5; i < recentCandles.length; i++) {
    const prevHigh = recentCandles[i - 5].high ?? recentCandles[i - 5].h;
    const currHigh = recentCandles[i].high ?? recentCandles[i].h;
    const prevLow = recentCandles[i - 5].low ?? recentCandles[i - 5].l;
    const currLow = recentCandles[i].low ?? recentCandles[i].l;

    if (currHigh > prevHigh) higherHighs++;
    if (currLow < prevLow) lowerLows++;
  }

  // Calculate VWAP for comparison
  let vwapSum = 0;
  let volumeSum = 0;
  for (let i = 0; i <= currentIdx; i++) {
    const c = candleData[i];
    const typical = ((c.high ?? c.h) + (c.low ?? c.l) + (c.close ?? c.c)) / 3;
    const vol = c.volume ?? c.v ?? 1;
    vwapSum += typical * vol;
    volumeSum += vol;
  }
  const vwap = vwapSum / volumeSum;
  const priceVsVwap = ((price - vwap) / vwap) * 100;

  // Calculate 20-candle momentum
  const momentum20 = currentIdx >= 20
    ? ((price - (candleData[currentIdx - 20].close ?? candleData[currentIdx - 20].c)) /
       (candleData[currentIdx - 20].close ?? candleData[currentIdx - 20].c)) * 100
    : 0;

  // Determine trend direction
  let trend = 'flat';
  if (higherHighs > lowerLows + 3) trend = 'uptrend';
  else if (lowerLows > higherHighs + 3) trend = 'downtrend';

  // Determine regime based on multiple signals
  let bullSignals = 0;
  let bearSignals = 0;

  // Signal 1: Price vs Open
  if (priceVsOpen > 2) bullSignals += 2;
  else if (priceVsOpen > 0.5) bullSignals += 1;
  else if (priceVsOpen < -2) bearSignals += 2;
  else if (priceVsOpen < -0.5) bearSignals += 1;

  // Signal 2: Price vs VWAP
  if (priceVsVwap > 1) bullSignals += 2;
  else if (priceVsVwap > 0.3) bullSignals += 1;
  else if (priceVsVwap < -1) bearSignals += 2;
  else if (priceVsVwap < -0.3) bearSignals += 1;

  // Signal 3: Trend
  if (trend === 'uptrend') bullSignals += 2;
  else if (trend === 'downtrend') bearSignals += 2;

  // Signal 4: Recent momentum
  if (momentum20 > 1) bullSignals += 1;
  else if (momentum20 < -1) bearSignals += 1;

  // Determine regime
  let regime = 'sideways';
  let confidence = 50;

  if (bullSignals >= bearSignals + 3) {
    regime = 'bull';
    confidence = Math.min(95, 60 + (bullSignals - bearSignals) * 5);
  } else if (bearSignals >= bullSignals + 3) {
    regime = 'bear';
    confidence = Math.min(95, 60 + (bearSignals - bullSignals) * 5);
  } else {
    regime = 'sideways';
    confidence = 50 + Math.abs(bullSignals - bearSignals) * 5;
  }

  return {
    regime,
    confidence,
    priceVsOpen: priceVsOpen.toFixed(2),
    priceVsVwap: priceVsVwap.toFixed(2),
    momentum20: momentum20.toFixed(2),
    trend,
    bullSignals,
    bearSignals,
    timestamp: currentCandle.timestamp || currentCandle.t,
  };
};

/**
 * Safe getter for candle properties (handles both naming conventions)
 */
export const getCandle = candle => {
  if (!candle) return null;
  return {
    close: candle.close ?? candle.c ?? 0,
    open: candle.open ?? candle.o ?? 0,
    high: candle.high ?? candle.h ?? 0,
    low: candle.low ?? candle.l ?? 0,
    volume: candle.volume ?? candle.v ?? 0,
    timestamp: candle.timestamp ?? candle.t ?? Date.now(),
  };
};

/**
 * Run a fast simulation with a given config (no UI updates)
 * Used by the optimizer to test many configurations quickly
 *
 * @param {Array} candleData - Array of candle data
 * @param {Object} testConfig - Configuration to test
 * @param {string} symbol - Optional symbol for crypto detection
 * @returns {Object} { totalPnL, returnPercent, winRate, numTrades, config }
 */
export const runFastSimulation = (candleData, testConfig, symbol = null) => {
  // Check if this is a crypto symbol
  const isCrypto = isCryptoSymbol(symbol);
  const initialCash = testConfig.allocatedCapital || 25000;
  let cash = initialCash;
  let position = null;
  let trades = [];

  // Process each candle (start at 20 for indicator warm-up)
  for (let i = 20; i < candleData.length; i++) {
    const candle = candleData[i];
    const price = candle.close || candle.c;
    const timestamp = candle.timestamp || candle.t;

    // Use shared indicator calculation
    const indicators = calculateIndicators(i, candleData);

    // BUY logic - use shared function
    if (!position) {
      const buyResult = shouldBuy(price, indicators, testConfig, null);
      if (buyResult.shouldBuy) {
        // Position sizing (same as full simulation)
        const maxPositionPercent = (testConfig.maxPositionSizePercent || 50) / 100;
        const maxPositionDollars = testConfig.maxPositionSize || cash;
        const positionValue = Math.min(cash * maxPositionPercent, maxPositionDollars);
        // Use fractional shares for crypto (high-priced assets), whole shares for stocks
        const positionSize = isCrypto
          ? positionValue / price  // Fractional for crypto
          : Math.floor(positionValue / price);  // Whole shares for stocks
        if (positionSize > 0) {
          position = { quantity: positionSize, entryPrice: price, entryIndex: i, highWaterMark: price };
          cash -= positionSize * price;
        }
      }
    }
    // SELL logic - use shared function
    else if (position) {
      // Update high water mark for trailing stop
      position.highWaterMark = Math.max(position.highWaterMark || position.entryPrice, price);

      const sellResult = shouldSell(price, position.entryPrice, indicators, testConfig, i, position.entryIndex, timestamp, position.highWaterMark);
      if (sellResult.shouldSell) {
        const pnl = position.quantity * (price - position.entryPrice);
        trades.push({ pnl, entryPrice: position.entryPrice, exitPrice: price });
        cash += position.quantity * price;
        position = null;
      }
    }
  }

  // Close any remaining position at end
  if (position && candleData.length > 0) {
    const lastPrice = candleData[candleData.length - 1].close || candleData[candleData.length - 1].c;
    const pnl = position.quantity * (lastPrice - position.entryPrice);
    trades.push({ pnl, entryPrice: position.entryPrice, exitPrice: lastPrice });
    cash += position.quantity * lastPrice;
  }

  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const returnPercent = ((cash - initialCash) / initialCash) * 100;
  const winRate = trades.length > 0 ? (trades.filter(t => t.pnl > 0).length / trades.length) * 100 : 0;

  return {
    totalPnL,
    returnPercent,
    winRate,
    numTrades: trades.length,
    config: testConfig,
  };
};
