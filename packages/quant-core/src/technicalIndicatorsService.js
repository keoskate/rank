/**
 * Technical Indicators Service
 *
 * Comprehensive technical analysis using the technicalindicators library.
 * Provides calculations for RSI, MACD, Bollinger Bands, ATR, EMA, VWAP, etc.
 */

const ti = require('technicalindicators');

// Cache for computed indicators (30-minute TTL)
const indicatorCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Calculate RSI (Relative Strength Index)
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - RSI period (default 14)
 * @returns {number[]} RSI values
 */
function calculateRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) {
    return [];
  }

  const rsi = ti.RSI.calculate({
    values: closes,
    period: period,
  });

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param {number[]} closes - Array of closing prices
 * @param {object} options - MACD parameters
 * @returns {object[]} MACD values with signal and histogram
 */
function calculateMACD(
  closes,
  { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = {}
) {
  if (!closes || closes.length < slowPeriod + signalPeriod) {
    return [];
  }

  const macd = ti.MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  return macd;
}

/**
 * Calculate Bollinger Bands
 * @param {number[]} closes - Array of closing prices
 * @param {object} options - Bollinger parameters
 * @returns {object[]} Upper, middle, lower bands and %B
 */
function calculateBollingerBands(closes, { period = 20, stdDev = 2 } = {}) {
  if (!closes || closes.length < period) {
    return [];
  }

  const bb = ti.BollingerBands.calculate({
    period,
    values: closes,
    stdDev,
  });

  // Add %B calculation (position within bands)
  return bb.map((band, i) => {
    const price = closes[closes.length - bb.length + i];
    const percentB =
      band.upper !== band.lower
        ? (price - band.lower) / (band.upper - band.lower)
        : 0.5;

    return {
      ...band,
      percentB,
      bandwidth: (band.upper - band.lower) / band.middle,
    };
  });
}

/**
 * Calculate ATR (Average True Range)
 * @param {object[]} candles - OHLC candles
 * @param {number} period - ATR period (default 14)
 * @returns {number[]} ATR values
 */
function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) {
    return [];
  }

  const atr = ti.ATR.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });

  return atr;
}

/**
 * Calculate EMA (Exponential Moving Average)
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - EMA period
 * @returns {number[]} EMA values
 */
function calculateEMA(closes, period) {
  if (!closes || closes.length < period) {
    return [];
  }

  const ema = ti.EMA.calculate({
    values: closes,
    period,
  });

  return ema;
}

/**
 * Calculate SMA (Simple Moving Average)
 * @param {number[]} closes - Array of closing prices
 * @param {number} period - SMA period
 * @returns {number[]} SMA values
 */
function calculateSMA(closes, period) {
  if (!closes || closes.length < period) {
    return [];
  }

  const sma = ti.SMA.calculate({
    values: closes,
    period,
  });

  return sma;
}

/**
 * The Eastern-time calendar day for a candle, used to reset VWAP each session.
 */
function _candleDay(c) {
  const t =
    c.timestamp ?? c.time ?? c.t ?? (c.date ? Date.parse(c.date) : null);
  if (t == null) return 'na';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/**
 * Calculate VWAP (Volume Weighted Average Price), RESET each trading day.
 * Library VWAP is cumulative; run over a multi-session window (the engine passes
 * ~24h / ~2 days of 5-min bars) it anchors to a prior day's open and becomes a
 * meaningless intraday reference by day 2 — which corrupts the mandatory
 * `belowVwap` entry gate. Segment by ET calendar day and reset per session.
 * @param {object[]} candles - OHLCV candles (chronological)
 * @returns {number[]} VWAP values, aligned 1:1 with input
 */
function calculateVWAP(candles) {
  if (!candles || candles.length === 0) {
    return [];
  }

  const out = [];
  let i = 0;
  while (i < candles.length) {
    const day = _candleDay(candles[i]);
    let j = i;
    while (j < candles.length && _candleDay(candles[j]) === day) j++;
    const seg = candles.slice(i, j);
    const segVwap = ti.VWAP.calculate({
      high: seg.map(c => c.high),
      low: seg.map(c => c.low),
      close: seg.map(c => c.close),
      volume: seg.map(c => c.volume),
    });
    // Keep 1:1 alignment with input even if the library warms up.
    for (let k = 0; k < seg.length - segVwap.length; k++) out.push(undefined);
    for (const v of segVwap) out.push(v);
    i = j;
  }
  return out;
}

/**
 * Calculate Stochastic Oscillator
 * @param {object[]} candles - OHLC candles
 * @param {object} options - Stochastic parameters
 * @returns {object[]} %K and %D values
 */
function calculateStochastic(candles, { period = 14, signalPeriod = 3 } = {}) {
  if (!candles || candles.length < period + signalPeriod) {
    return [];
  }

  const stoch = ti.Stochastic.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
    signalPeriod,
  });

  return stoch;
}

/**
 * Calculate ADX (Average Directional Index)
 * @param {object[]} candles - OHLC candles
 * @param {number} period - ADX period (default 14)
 * @returns {object[]} ADX, +DI, -DI values
 */
function calculateADX(candles, period = 14) {
  if (!candles || candles.length < period * 2) {
    return [];
  }

  const adx = ti.ADX.calculate({
    high: candles.map(c => c.high),
    low: candles.map(c => c.low),
    close: candles.map(c => c.close),
    period,
  });

  return adx;
}

/**
 * Calculate OBV (On-Balance Volume)
 * @param {object[]} candles - OHLCV candles
 * @returns {number[]} OBV values
 */
function calculateOBV(candles) {
  if (!candles || candles.length < 2) {
    return [];
  }

  const obv = ti.OBV.calculate({
    close: candles.map(c => c.close),
    volume: candles.map(c => c.volume),
  });

  return obv;
}

/**
 * Calculate Volume Profile (simplified)
 * @param {object[]} candles - OHLCV candles
 * @param {number} zones - Number of price zones
 * @returns {object[]} Volume by price zone
 */
function calculateVolumeProfile(candles, zones = 20) {
  if (!candles || candles.length === 0) {
    return [];
  }

  const prices = candles.map(c => c.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const zoneSize = (maxPrice - minPrice) / zones;

  const profile = Array(zones)
    .fill(0)
    .map((_, i) => ({
      priceMin: minPrice + i * zoneSize,
      priceMax: minPrice + (i + 1) * zoneSize,
      volume: 0,
    }));

  candles.forEach(candle => {
    const zoneIndex = Math.min(
      Math.floor((candle.close - minPrice) / zoneSize),
      zones - 1
    );
    if (zoneIndex >= 0 && zoneIndex < zones) {
      profile[zoneIndex].volume += candle.volume;
    }
  });

  // Find Point of Control (POC) - highest volume zone
  const pocIndex = profile.reduce(
    (maxIdx, zone, idx, arr) =>
      zone.volume > arr[maxIdx].volume ? idx : maxIdx,
    0
  );

  return {
    zones: profile,
    poc: profile[pocIndex],
    pocPrice: (profile[pocIndex].priceMin + profile[pocIndex].priceMax) / 2,
  };
}

/**
 * Detect RSI Divergence
 * @param {number[]} closes - Array of closing prices
 * @param {number[]} rsiValues - RSI values
 * @param {number} lookback - Number of bars to check
 * @returns {object} Divergence detection result
 */
function detectRSIDivergence(closes, rsiValues, lookback = 10) {
  if (!closes || !rsiValues || rsiValues.length < lookback) {
    return { bullish: false, bearish: false };
  }

  const recentPrices = closes.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  // Find local highs and lows
  const priceHigh = Math.max(...recentPrices);
  const priceLow = Math.min(...recentPrices);
  const rsiHigh = Math.max(...recentRSI);
  const rsiLow = Math.min(...recentRSI);

  const currentPrice = recentPrices[recentPrices.length - 1];
  const currentRSI = recentRSI[recentRSI.length - 1];

  // Divergence is only meaningful in a price range wide enough that
  // "near the low" and "near the high" mean different things. In a
  // tight intraday range (< 1% wide), price can be within 1% of BOTH
  // extremes — and the prior implementation flagged both bullish AND
  // bearish divergence simultaneously, which is logically incoherent.
  const rangePercent =
    priceLow > 0 ? ((priceHigh - priceLow) / priceLow) * 100 : 0;
  const RANGE_FLOOR = 1.0; // require >=1% range

  // Bullish divergence: price near recent low, RSI made higher low
  // Bearish divergence: price near recent high, RSI made lower high
  // Mutually exclusive: pick whichever extreme the current price is
  // closer to, so we never claim both at once.
  const distFromLow = currentPrice - priceLow;
  const distFromHigh = priceHigh - currentPrice;

  let bullishDivergence = false;
  let bearishDivergence = false;

  if (rangePercent >= RANGE_FLOOR) {
    if (distFromLow <= distFromHigh) {
      bullishDivergence =
        currentPrice <= priceLow * 1.01 && currentRSI > rsiLow * 1.05;
    } else {
      bearishDivergence =
        currentPrice >= priceHigh * 0.99 && currentRSI < rsiHigh * 0.95;
    }
  }

  return {
    bullish: bullishDivergence,
    bearish: bearishDivergence,
    currentRSI,
    rsiTrend: currentRSI > recentRSI[0] ? 'rising' : 'falling',
  };
}

/**
 * Get all technical indicators for a symbol
 * @param {object[]} candles - OHLCV candles (minimum 200 recommended)
 * @returns {object} All calculated indicators
 */
function getAllIndicators(candles) {
  if (!candles || candles.length < 50) {
    return { error: 'Insufficient data. Need at least 50 candles.' };
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  // Calculate all indicators
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const bb = calculateBollingerBands(closes);
  const atr = calculateATR(candles, 14);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = closes.length >= 200 ? calculateEMA(closes, 200) : [];
  const vwap = calculateVWAP(candles);
  const stoch = calculateStochastic(candles);
  const adx = calculateADX(candles);
  const obv = calculateOBV(candles);
  const volumeProfile = calculateVolumeProfile(candles);

  // Get latest values
  const latestIdx = candles.length - 1;
  const getLatest = (arr, offset = 0) =>
    arr.length > offset ? arr[arr.length - 1 - offset] : null;

  // Detect divergences
  const divergence = detectRSIDivergence(closes, rsi);

  // Volume analysis
  const avgVolume =
    volumes.slice(-20).reduce((a, b) => a + b, 0) /
    Math.min(20, volumes.length);
  const volumeRatio = volumes[latestIdx] / avgVolume;

  // Trend analysis
  const latestEMA9 = getLatest(ema9);
  const latestEMA21 = getLatest(ema21);
  const latestEMA50 = getLatest(ema50);
  const latestEMA200 = getLatest(ema200);
  const currentPrice = closes[latestIdx];

  const trend = {
    shortTerm: latestEMA9 > latestEMA21 ? 'bullish' : 'bearish',
    mediumTerm: latestEMA21 > latestEMA50 ? 'bullish' : 'bearish',
    longTerm: latestEMA200
      ? latestEMA50 > latestEMA200
        ? 'bullish'
        : 'bearish'
      : 'unknown',
    priceVsVWAP: getLatest(vwap)
      ? currentPrice > getLatest(vwap)
        ? 'above'
        : 'below'
      : 'unknown',
  };

  // Summary signal
  const latestMACD = getLatest(macd);
  const latestBB = getLatest(bb);
  const latestStoch = getLatest(stoch);
  const latestADX = getLatest(adx);
  const latestRSI = getLatest(rsi);

  return {
    timestamp: new Date().toISOString(),
    price: currentPrice,

    // Individual indicators
    rsi: {
      value: latestRSI,
      history: rsi.slice(-50),
      overbought: latestRSI > 70,
      oversold: latestRSI < 30,
      divergence,
    },

    macd: {
      value: latestMACD?.MACD,
      signal: latestMACD?.signal,
      histogram: latestMACD?.histogram,
      bullish: latestMACD?.histogram > 0,
      crossover:
        macd.length > 1
          ? macd[macd.length - 2]?.histogram < 0 && latestMACD?.histogram > 0
          : false,
      history: macd.slice(-50),
    },

    bollingerBands: {
      upper: latestBB?.upper,
      middle: latestBB?.middle,
      lower: latestBB?.lower,
      percentB: latestBB?.percentB,
      bandwidth: latestBB?.bandwidth,
      squeeze: latestBB?.bandwidth < 0.1,
      history: bb.slice(-50),
    },

    atr: {
      value: getLatest(atr),
      percent: getLatest(atr) ? (getLatest(atr) / currentPrice) * 100 : null,
      history: atr.slice(-50),
    },

    ema: {
      ema9: latestEMA9,
      ema21: latestEMA21,
      ema50: latestEMA50,
      ema200: latestEMA200,
      goldenCross: latestEMA50 && latestEMA200 && latestEMA50 > latestEMA200,
      deathCross: latestEMA50 && latestEMA200 && latestEMA50 < latestEMA200,
    },

    vwap: {
      value: getLatest(vwap),
      pricePosition: getLatest(vwap)
        ? ((currentPrice - getLatest(vwap)) / getLatest(vwap)) * 100
        : null,
    },

    stochastic: {
      k: latestStoch?.k,
      d: latestStoch?.d,
      overbought: latestStoch?.k > 80,
      oversold: latestStoch?.k < 20,
      bullishCross: latestStoch?.k > latestStoch?.d,
      history: stoch.slice(-50),
    },

    adx: {
      value: latestADX?.adx,
      pdi: latestADX?.pdi,
      mdi: latestADX?.mdi,
      trending: latestADX?.adx > 25,
      strongTrend: latestADX?.adx > 50,
      bullishDI: latestADX?.pdi > latestADX?.mdi,
      history: adx.slice(-50),
    },

    volume: {
      current: volumes[latestIdx],
      average: avgVolume,
      ratio: volumeRatio,
      aboveAverage: volumeRatio > 1.5,
      obv: getLatest(obv),
      profile: volumeProfile,
    },

    trend,

    // Summary signal generation
    signals: generateSignals({
      rsi: latestRSI,
      macd: latestMACD,
      bb: latestBB,
      stoch: latestStoch,
      adx: latestADX,
      trend,
      volumeRatio,
      divergence,
      currentPrice,
      vwap: getLatest(vwap),
    }),
  };
}

/**
 * Generate trading signals based on indicators
 * @param {object} indicators - Calculated indicator values
 * @returns {object} Signal summary
 */
function generateSignals(indicators) {
  const {
    rsi,
    macd,
    bb,
    stoch,
    adx,
    trend,
    volumeRatio,
    divergence,
    currentPrice,
    vwap,
  } = indicators;

  let bullishScore = 0;
  let bearishScore = 0;
  const reasons = [];

  // RSI signals
  if (rsi < 30) {
    bullishScore += 2;
    reasons.push('RSI oversold');
  } else if (rsi > 70) {
    bearishScore += 2;
    reasons.push('RSI overbought');
  } else if (rsi < 45) {
    bullishScore += 1;
  } else if (rsi > 55) {
    bearishScore += 1;
  }

  // MACD signals
  if (macd?.histogram > 0) {
    bullishScore += 1;
    if (macd.histogram > macd.signal * 0.1) {
      bullishScore += 1;
      reasons.push('MACD bullish momentum');
    }
  } else if (macd?.histogram < 0) {
    bearishScore += 1;
    if (Math.abs(macd.histogram) > Math.abs(macd.signal) * 0.1) {
      bearishScore += 1;
      reasons.push('MACD bearish momentum');
    }
  }

  // Bollinger Bands signals
  if (bb?.percentB < 0.2) {
    bullishScore += 2;
    reasons.push('Near lower Bollinger Band');
  } else if (bb?.percentB > 0.8) {
    bearishScore += 2;
    reasons.push('Near upper Bollinger Band');
  }

  // Stochastic signals
  if (stoch?.k < 20 && stoch?.d < 20) {
    bullishScore += 1;
    reasons.push('Stochastic oversold');
  } else if (stoch?.k > 80 && stoch?.d > 80) {
    bearishScore += 1;
    reasons.push('Stochastic overbought');
  }

  // ADX trend strength
  if (adx?.adx > 25) {
    if (adx?.pdi > adx?.mdi) {
      bullishScore += 2;
      reasons.push('Strong bullish trend (ADX)');
    } else {
      bearishScore += 2;
      reasons.push('Strong bearish trend (ADX)');
    }
  }

  // Trend alignment
  if (trend.shortTerm === 'bullish' && trend.mediumTerm === 'bullish') {
    bullishScore += 2;
    reasons.push('Aligned bullish trend');
  } else if (trend.shortTerm === 'bearish' && trend.mediumTerm === 'bearish') {
    bearishScore += 2;
    reasons.push('Aligned bearish trend');
  }

  // VWAP position
  if (vwap && currentPrice > vwap) {
    bullishScore += 1;
    reasons.push('Price above VWAP');
  } else if (vwap && currentPrice < vwap) {
    bearishScore += 1;
    reasons.push('Price below VWAP');
  }

  // Volume confirmation
  if (volumeRatio > 1.5) {
    reasons.push('High volume confirmation');
    // Volume confirms the direction
    if (bullishScore > bearishScore) bullishScore += 1;
    else bearishScore += 1;
  }

  // Divergence signals
  if (divergence.bullish) {
    bullishScore += 3;
    reasons.push('Bullish RSI divergence');
  }
  if (divergence.bearish) {
    bearishScore += 3;
    reasons.push('Bearish RSI divergence');
  }

  // Calculate final signal
  const totalScore = bullishScore + bearishScore;
  const netScore = bullishScore - bearishScore;
  const confidence = totalScore > 0 ? Math.abs(netScore) / totalScore : 0;

  let signal = 'HOLD';
  if (netScore >= 3 && confidence >= 0.3) signal = 'BUY';
  else if (netScore <= -3 && confidence >= 0.3) signal = 'SELL';

  return {
    signal,
    confidence: Math.round(confidence * 100),
    bullishScore,
    bearishScore,
    netScore,
    reasons,
  };
}

/**
 * Get cached indicators or calculate new ones
 * @param {string} symbol - Stock symbol
 * @param {object[]} candles - OHLCV candles
 * @returns {object} Indicators
 */
function getIndicatorsWithCache(symbol, candles) {
  const cacheKey = `${symbol}_${candles.length}_${candles[candles.length - 1]?.close}`;
  const cached = indicatorCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const indicators = getAllIndicators(candles);
  indicatorCache.set(cacheKey, {
    data: indicators,
    timestamp: Date.now(),
  });

  // Clean old cache entries
  for (const [key, value] of indicatorCache.entries()) {
    if (Date.now() - value.timestamp > CACHE_TTL) {
      indicatorCache.delete(key);
    }
  }

  return indicators;
}

module.exports = {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateEMA,
  calculateSMA,
  calculateVWAP,
  calculateStochastic,
  calculateADX,
  calculateOBV,
  calculateVolumeProfile,
  detectRSIDivergence,
  getAllIndicators,
  generateSignals,
  getIndicatorsWithCache,
};
