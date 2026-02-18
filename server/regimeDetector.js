/**
 * Market Regime Detector
 *
 * Classifies market conditions as BULL, BEAR, or SIDEWAYS.
 * Different regimes require different strategy parameters:
 *
 * BULL: Momentum works, wider profit targets, can be more aggressive
 * BEAR: Counter-trend, tighter stops, more selective entries
 * SIDEWAYS: Mean reversion, very tight targets, very selective
 *
 * Detection uses:
 * - Price vs Moving Average (trend direction)
 * - ADX (trend strength)
 * - Volatility (market uncertainty)
 */

class RegimeDetector {
  constructor(options = {}) {
    // Configuration with sensible defaults
    this.config = {
      maPeriod: options.maPeriod || 50, // 50-day MA for trend
      adxPeriod: options.adxPeriod || 14, // ADX period
      adxTrendThreshold: options.adxTrendThreshold || 20, // Below this = sideways
      adxStrongTrendThreshold: options.adxStrongTrendThreshold || 30, // Above this = strong trend
      volatilityLookback: options.volatilityLookback || 20, // Days for volatility calc
      ...options,
    };
  }

  /**
   * Detect market regime for a given set of candles
   *
   * @param {Array} candles - Array of { open, high, low, close, volume, date/timestamp }
   * @param {Object} options - Override default config
   * @returns {Object} Regime classification with confidence
   */
  detectRegime(candles, options = {}) {
    const config = { ...this.config, ...options };

    // Need enough data for calculations
    const minDataPoints = Math.max(config.maPeriod, config.adxPeriod * 2);
    if (!candles || candles.length < minDataPoints) {
      return {
        regime: 'unknown',
        confidence: 0,
        reason: `Insufficient data: need ${minDataPoints} candles, have ${candles?.length || 0}`,
      };
    }

    // Calculate indicators
    const closes = candles.map(c => c.close);
    const ma = this.calculateSMA(closes, config.maPeriod);
    const adx = this.calculateADX(candles, config.adxPeriod);
    const volatility = this.calculateVolatility(closes, config.volatilityLookback);

    // Current values
    const currentPrice = closes[closes.length - 1];
    const currentMA = ma[ma.length - 1];
    const currentADX = adx[adx.length - 1];
    const priceToMA = ((currentPrice - currentMA) / currentMA) * 100;

    // Calculate short-term momentum (5-day and 10-day returns)
    const fiveDayReturn = closes.length >= 5
      ? ((closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5]) * 100
      : 0;
    const tenDayReturn = closes.length >= 10
      ? ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100
      : 0;

    // Calculate short-term MA (20-day) for faster signals
    const shortMA = this.calculateSMA(closes, Math.min(20, closes.length));
    const currentShortMA = shortMA[shortMA.length - 1];
    const priceToShortMA = ((currentPrice - currentShortMA) / currentShortMA) * 100;

    // Classify regime using multiple signals
    let regime, confidence, description;
    let signals = { bullish: 0, bearish: 0, sideways: 0 };

    // Signal 1: ADX trend strength
    if (currentADX < config.adxTrendThreshold) {
      signals.sideways += 2;
    } else if (currentADX >= config.adxStrongTrendThreshold) {
      // Strong trend - weight direction signals more
      if (currentPrice > currentMA) signals.bullish += 2;
      else signals.bearish += 2;
    } else {
      // Moderate trend
      if (currentPrice > currentMA) signals.bullish += 1;
      else signals.bearish += 1;
    }

    // Signal 2: Price vs 50-day MA
    if (priceToMA > 5) signals.bullish += 2;
    else if (priceToMA > 2) signals.bullish += 1;
    else if (priceToMA < -5) signals.bearish += 2;
    else if (priceToMA < -2) signals.bearish += 1;
    else signals.sideways += 1;

    // Signal 3: Short-term momentum (5-day return)
    if (fiveDayReturn > 5) signals.bullish += 2;
    else if (fiveDayReturn > 2) signals.bullish += 1;
    else if (fiveDayReturn < -5) signals.bearish += 2;
    else if (fiveDayReturn < -2) signals.bearish += 1;
    else signals.sideways += 1;

    // Signal 4: Price vs short-term MA (faster signal)
    if (priceToShortMA > 3) signals.bullish += 1;
    else if (priceToShortMA < -3) signals.bearish += 1;
    else signals.sideways += 1;

    // Determine regime from signal weights
    const maxSignal = Math.max(signals.bullish, signals.bearish, signals.sideways);
    if (signals.bullish === maxSignal && signals.bullish > signals.bearish) {
      regime = 'bull';
      confidence = Math.min(95, 40 + signals.bullish * 10 + Math.abs(priceToMA) + Math.abs(fiveDayReturn));
      description = `Bullish: ${priceToMA > 0 ? '+' : ''}${priceToMA.toFixed(1)}% vs MA, ${fiveDayReturn > 0 ? '+' : ''}${fiveDayReturn.toFixed(1)}% 5d momentum`;
    } else if (signals.bearish === maxSignal && signals.bearish > signals.bullish) {
      regime = 'bear';
      confidence = Math.min(95, 40 + signals.bearish * 10 + Math.abs(priceToMA) + Math.abs(fiveDayReturn));
      description = `Bearish: ${priceToMA.toFixed(1)}% vs MA, ${fiveDayReturn.toFixed(1)}% 5d momentum`;
    } else {
      regime = 'sideways';
      confidence = Math.min(95, 40 + signals.sideways * 10);
      description = `Sideways: Mixed signals (ADX: ${currentADX.toFixed(1)}, 5d: ${fiveDayReturn > 0 ? '+' : ''}${fiveDayReturn.toFixed(1)}%)`;
    }

    // Determine trend strength
    let trendStrength;
    if (currentADX >= config.adxStrongTrendThreshold || Math.abs(fiveDayReturn) > 10) {
      trendStrength = 'strong';
    } else if (currentADX >= config.adxTrendThreshold || Math.abs(fiveDayReturn) > 5) {
      trendStrength = 'moderate';
    } else {
      trendStrength = 'weak';
    }

    // Generate leveraged ETF recommendation for QBTS family
    const leveragedRecommendation = this.getLeveragedETFRecommendation(regime, trendStrength, confidence);

    return {
      regime,
      confidence: Math.round(confidence),
      trendStrength,
      description,
      indicators: {
        price: currentPrice,
        ma: currentMA,
        priceToMA: priceToMA.toFixed(2) + '%',
        priceVs50MA: priceToMA,
        adx: currentADX.toFixed(2),
        volatility: (volatility * 100).toFixed(2) + '%',
        fiveDayReturn: fiveDayReturn.toFixed(2) + '%',
        tenDayReturn: tenDayReturn.toFixed(2) + '%',
        signals,
      },
      recommendedStrategy: this.getStrategyRecommendation(regime, trendStrength, volatility),
      leveragedRecommendation,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get leveraged ETF recommendation based on regime
   * For QBTS family: QBTS (base), QBTX (2x bull), QBTZ (2x bear)
   */
  getLeveragedETFRecommendation(regime, trendStrength, confidence) {
    if (regime === 'bull') {
      return {
        symbol: 'QBTX',
        name: 'T-Rex 2X Long MSTR Daily Target ETF',
        direction: 'long',
        leverage: '2x',
        reason: `Bullish regime detected (${confidence}% confidence). Use leveraged bull ETF to maximize gains.`,
        riskLevel: trendStrength === 'strong' ? 'moderate' : 'high',
        tips: [
          'Best for strong uptrend days',
          'Consider position sizing based on confidence',
          trendStrength === 'strong' ? 'Full position OK' : 'Reduce position size due to weaker trend',
        ],
      };
    } else if (regime === 'bear') {
      return {
        symbol: 'QBTZ',
        name: 'T-Rex 2X Inverse MSTR Daily Target ETF',
        direction: 'short',
        leverage: '2x',
        reason: `Bearish regime detected (${confidence}% confidence). Use inverse ETF to profit from decline.`,
        riskLevel: trendStrength === 'strong' ? 'moderate' : 'high',
        tips: [
          'Best for strong downtrend days',
          'Consider hedging with small QBTX position',
          trendStrength === 'strong' ? 'Full position OK' : 'Reduce position size due to weaker trend',
        ],
      };
    } else {
      return {
        symbol: 'CASH',
        name: 'Stay in Cash',
        direction: 'neutral',
        leverage: 'none',
        reason: `Sideways/choppy regime (${confidence}% confidence). Leveraged ETFs lose value in chop due to decay.`,
        riskLevel: 'low',
        tips: [
          'Avoid leveraged ETFs in sideways markets',
          'If must trade, use base stock (QBTS/MSTR) with tight stops',
          'Wait for clearer trend signal',
        ],
      };
    }
  }

  /**
   * Get regime timeline for a date range
   * Useful for backtesting and visualization
   *
   * @param {Array} candles - Full candle history
   * @returns {Array} Array of { date, regime, confidence, indicators }
   */
  getRegimeTimeline(candles) {
    if (!candles || candles.length < this.config.maPeriod + this.config.adxPeriod) {
      return [];
    }

    const timeline = [];
    const startIndex = Math.max(this.config.maPeriod, this.config.adxPeriod * 2);

    for (let i = startIndex; i < candles.length; i++) {
      const windowCandles = candles.slice(0, i + 1);
      const result = this.detectRegime(windowCandles);

      timeline.push({
        date: candles[i].date || candles[i].timestamp,
        price: candles[i].close,
        regime: result.regime,
        confidence: result.confidence,
        adx: result.indicators?.adx,
        priceToMA: result.indicators?.priceToMA,
      });
    }

    return timeline;
  }

  /**
   * Analyze regime distribution and transitions
   *
   * @param {Array} timeline - Regime timeline from getRegimeTimeline()
   * @returns {Object} Analysis of regime patterns
   */
  analyzeRegimes(timeline) {
    if (!timeline || timeline.length === 0) {
      return null;
    }

    // Count regime occurrences
    const counts = { bull: 0, bear: 0, sideways: 0 };
    timeline.forEach(t => {
      if (counts[t.regime] !== undefined) {
        counts[t.regime]++;
      }
    });

    const total = timeline.length;

    // Count regime transitions
    const transitions = {
      bull_to_bear: 0,
      bull_to_sideways: 0,
      bear_to_bull: 0,
      bear_to_sideways: 0,
      sideways_to_bull: 0,
      sideways_to_bear: 0,
    };

    for (let i = 1; i < timeline.length; i++) {
      const prev = timeline[i - 1].regime;
      const curr = timeline[i].regime;
      if (prev !== curr) {
        const key = `${prev}_to_${curr}`;
        if (transitions[key] !== undefined) {
          transitions[key]++;
        }
      }
    }

    // Calculate regime streaks
    let currentStreak = 1;
    let maxBullStreak = 0,
      maxBearStreak = 0,
      maxSidewaysStreak = 0;

    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].regime === timeline[i - 1].regime) {
        currentStreak++;
      } else {
        // Record the streak
        const prevRegime = timeline[i - 1].regime;
        if (prevRegime === 'bull') maxBullStreak = Math.max(maxBullStreak, currentStreak);
        if (prevRegime === 'bear') maxBearStreak = Math.max(maxBearStreak, currentStreak);
        if (prevRegime === 'sideways') maxSidewaysStreak = Math.max(maxSidewaysStreak, currentStreak);
        currentStreak = 1;
      }
    }

    // Don't forget the last streak
    const lastRegime = timeline[timeline.length - 1].regime;
    if (lastRegime === 'bull') maxBullStreak = Math.max(maxBullStreak, currentStreak);
    if (lastRegime === 'bear') maxBearStreak = Math.max(maxBearStreak, currentStreak);
    if (lastRegime === 'sideways') maxSidewaysStreak = Math.max(maxSidewaysStreak, currentStreak);

    return {
      totalDays: total,
      distribution: {
        bull: {
          count: counts.bull,
          percent: ((counts.bull / total) * 100).toFixed(1) + '%',
        },
        bear: {
          count: counts.bear,
          percent: ((counts.bear / total) * 100).toFixed(1) + '%',
        },
        sideways: {
          count: counts.sideways,
          percent: ((counts.sideways / total) * 100).toFixed(1) + '%',
        },
      },
      dominantRegime: Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0],
      transitions,
      totalTransitions: Object.values(transitions).reduce((a, b) => a + b, 0),
      maxStreaks: {
        bull: maxBullStreak,
        bear: maxBearStreak,
        sideways: maxSidewaysStreak,
      },
      currentRegime: timeline[timeline.length - 1].regime,
      currentStreakLength: currentStreak,
    };
  }

  /**
   * Get strategy recommendations based on regime
   */
  getStrategyRecommendation(regime, trendStrength, volatility) {
    const isHighVol = volatility > 0.02; // > 2% daily vol

    const strategies = {
      bull: {
        approach: 'Trend-following / Momentum',
        takeProfitMultiplier: trendStrength === 'strong' ? 1.5 : 1.2,
        stopLossMultiplier: 1.0,
        confidenceThreshold: trendStrength === 'strong' ? 60 : 70,
        positionSizeMultiplier: isHighVol ? 0.7 : 1.0,
        description: 'Go with the trend, let winners run',
        tips: [
          'Buy dips to moving average',
          'Use wider profit targets',
          'Trail stops to lock in gains',
        ],
      },
      bear: {
        approach: 'Counter-trend / Defensive',
        takeProfitMultiplier: 0.8,
        stopLossMultiplier: 0.75,
        confidenceThreshold: 80,
        positionSizeMultiplier: isHighVol ? 0.5 : 0.7,
        description: 'Quick profits, tight risk management',
        tips: [
          'Take profits quickly',
          'Use tighter stops',
          'Consider inverse ETFs',
          'Reduce overall exposure',
        ],
      },
      sideways: {
        approach: 'Mean reversion / Range trading',
        takeProfitMultiplier: 0.6,
        stopLossMultiplier: 0.5,
        confidenceThreshold: 90,
        positionSizeMultiplier: isHighVol ? 0.3 : 0.5,
        description: 'Very selective, quick in and out',
        tips: [
          'Trade only at range extremes',
          'Very tight profit targets',
          'Be very selective - most setups fail in chop',
          'Consider sitting out',
        ],
      },
    };

    return strategies[regime] || strategies.sideways;
  }

  /**
   * Calculate Simple Moving Average
   */
  calculateSMA(values, period) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return result;
  }

  /**
   * Calculate Average Directional Index (ADX)
   * ADX measures trend strength regardless of direction
   */
  calculateADX(candles, period) {
    if (candles.length < period * 2) {
      return [0];
    }

    const tr = []; // True Range
    const plusDM = []; // +DM
    const minusDM = []; // -DM

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;
      const prevClose = candles[i - 1].close;

      // True Range
      tr.push(
        Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
      );

      // Directional Movement
      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // Smooth the values
    const smoothedTR = this.wilder(tr, period);
    const smoothedPlusDM = this.wilder(plusDM, period);
    const smoothedMinusDM = this.wilder(minusDM, period);

    // Calculate DI+ and DI-
    const dx = [];
    for (let i = 0; i < smoothedTR.length; i++) {
      if (smoothedTR[i] === 0) {
        dx.push(0);
        continue;
      }

      const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
      const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
      const diSum = plusDI + minusDI;

      if (diSum === 0) {
        dx.push(0);
      } else {
        dx.push((Math.abs(plusDI - minusDI) / diSum) * 100);
      }
    }

    // ADX is smoothed DX
    return this.wilder(dx, period);
  }

  /**
   * Wilder's smoothing (used in ADX calculation)
   */
  wilder(values, period) {
    if (values.length < period) {
      return [0];
    }

    const result = [];

    // First value is simple average
    let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
    result.push(sum / period);

    // Subsequent values use Wilder's smoothing
    for (let i = period; i < values.length; i++) {
      const smoothed = result[result.length - 1] * (period - 1) / period + values[i] / period;
      result.push(smoothed);
    }

    return result;
  }

  /**
   * Calculate historical volatility (annualized)
   */
  calculateVolatility(closes, period) {
    if (closes.length < period + 1) {
      return 0;
    }

    // Calculate daily returns
    const returns = [];
    for (let i = closes.length - period; i < closes.length; i++) {
      if (i > 0 && closes[i - 1] !== 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
    }

    if (returns.length === 0) return 0;

    // Standard deviation of returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const squaredDiffs = returns.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;

    return Math.sqrt(variance);
  }

  /**
   * Get regime-specific default config for a strategy
   * This integrates with the config store
   */
  getDefaultConfigForRegime(regime) {
    const defaults = {
      bull: {
        takeProfitPercent: 2.5,
        stopLossPercent: 1.0,
        minConfidence: 65,
        maxPositions: 3,
        positionSizePercent: 40,
        description: 'Bull regime: Momentum, wider targets, buy dips',
      },
      bear: {
        takeProfitPercent: 1.5,
        stopLossPercent: 0.75,
        minConfidence: 75,
        maxPositions: 2,
        positionSizePercent: 30,
        description: 'Bear regime: Counter-trend, tight risk, selective entries',
      },
      sideways: {
        takeProfitPercent: 1.0,
        stopLossPercent: 0.5,
        minConfidence: 85,
        maxPositions: 1,
        positionSizePercent: 20,
        description: 'Sideways: Mean reversion only, very selective, small size',
      },
    };

    return defaults[regime] || defaults.sideways;
  }
}

module.exports = RegimeDetector;
