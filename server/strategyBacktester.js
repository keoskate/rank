/**
 * Strategy Backtester - Multi-day validation system
 *
 * Tests a trading strategy across multiple days to:
 * 1. Validate consistency (not just one lucky day)
 * 2. Calculate risk-adjusted metrics (Sharpe, Sortino)
 * 3. Compare to buy-and-hold baseline
 * 4. Identify regime-specific performance
 */

const technicalIndicators = require('./technicalIndicatorsService');

class StrategyBacktester {
  constructor(polygonClient, regimeDetector) {
    this.polygonClient = polygonClient;
    this.regimeDetector = regimeDetector;
  }

  /**
   * Run backtest across multiple days
   * @param {string} symbol - Stock symbol
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @param {object} config - Trading config to test
   * @returns {object} Backtest results with statistics
   */
  async runBacktest(symbol, startDate, endDate, config) {
    console.log(`[Backtester] Running backtest for ${symbol} from ${startDate} to ${endDate}`);

    // Get list of trading days
    const tradingDays = await this.getTradingDays(symbol, startDate, endDate);
    console.log(`[Backtester] Found ${tradingDays.length} trading days`);

    if (tradingDays.length === 0) {
      return { error: 'No trading days found in date range' };
    }

    // Run simulation for each day
    const dailyResults = [];
    let totalTrades = 0;
    let totalWins = 0;
    let totalLosses = 0;

    for (const date of tradingDays) {
      try {
        const dayResult = await this.simulateDay(symbol, date, config);
        if (dayResult) {
          dailyResults.push(dayResult);
          totalTrades += dayResult.trades;
          totalWins += dayResult.wins;
          totalLosses += dayResult.losses;
        }
      } catch (error) {
        console.error(`[Backtester] Error on ${date}:`, error.message);
        // Continue with other days
      }
    }

    if (dailyResults.length === 0) {
      return { error: 'No valid results from any trading day' };
    }

    // Calculate aggregate statistics
    const stats = this.calculateStatistics(dailyResults, totalTrades, totalWins, totalLosses);

    // Calculate buy-and-hold comparison
    const buyAndHold = await this.calculateBuyAndHold(symbol, startDate, endDate);

    // Identify regime-specific performance
    const regimeBreakdown = this.analyzeByRegime(dailyResults);

    return {
      symbol,
      dateRange: { start: startDate, end: endDate },
      config,
      daysAnalyzed: dailyResults.length,
      dailyResults,
      statistics: stats,
      buyAndHold,
      regimeBreakdown,
      verdict: this.generateVerdict(stats, buyAndHold),
    };
  }

  /**
   * Get list of trading days in range
   */
  async getTradingDays(symbol, startDate, endDate) {
    try {
      const candles = await this.polygonClient.getHistoricalAggregates(
        symbol,
        startDate,
        endDate,
        'day'
      );

      if (!candles || candles.length === 0) return [];

      // Extract unique dates
      const dates = candles.map(c => {
        const ts = c.timestamp || c.t;
        return new Date(ts).toISOString().split('T')[0];
      });

      return [...new Set(dates)].sort();
    } catch (error) {
      console.error('[Backtester] Error getting trading days:', error);
      return [];
    }
  }

  /**
   * Simulate a single trading day
   */
  async simulateDay(symbol, date, config) {
    try {
      // Fetch intraday data
      const candles = await this.polygonClient.getHistoricalAggregates(
        symbol,
        date,
        date,
        'minute'
      );

      if (!candles || candles.length < 50) {
        console.log(`[Backtester] Insufficient data for ${date}`);
        return null;
      }

      // Filter to market hours (9:30 AM - 4:00 PM EST)
      const marketCandles = candles.filter(c => {
        const ts = c.timestamp || c.t;
        const hour = this.getEstHour(ts);
        return hour >= 9.5 && hour < 16;
      });

      if (marketCandles.length < 30) {
        return null;
      }

      // Get daily regime
      const dailyCandles = await this.polygonClient.getHistoricalAggregates(
        symbol,
        this.subtractDays(date, 90),
        date,
        'day'
      ).catch(() => []);

      let regime = 'unknown';
      if (dailyCandles && dailyCandles.length >= 50 && this.regimeDetector) {
        const regimeResult = this.regimeDetector.detectRegime(dailyCandles);
        regime = regimeResult.regime;
      }

      // Run the trading simulation
      const result = this.runDaySimulation(marketCandles, config);

      return {
        date,
        regime,
        ...result,
      };
    } catch (error) {
      console.error(`[Backtester] Error simulating ${date}:`, error);
      return null;
    }
  }

  /**
   * Run trading simulation for a single day
   * Includes circuit breaker logic to match live trading behavior
   */
  runDaySimulation(candles, config) {
    const initialCapital = config.allocatedCapital || 25000;
    let cash = initialCapital;
    let position = null;
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let realizedPnL = 0;
    const tradeLog = [];

    // Circuit breaker state (matches aiTradingEngine)
    let consecutiveLosses = 0;
    const consecutiveLossLimit = config.consecutiveLossLimit || 3;
    const dailyLossLimitPercent = config.dailyLossLimitPercent || 5;
    let circuitBreakerTriggered = false;
    let circuitBreakerReason = null;

    // Calculate day's price range for reference
    const dayOpen = candles[0].open ?? candles[0].o;
    const dayClose = candles[candles.length - 1].close ?? candles[candles.length - 1].c;
    const dayReturn = ((dayClose - dayOpen) / dayOpen) * 100;

    // Simple strategy simulation
    for (let i = 20; i < candles.length; i++) {
      const candle = candles[i];
      const price = candle.close ?? candle.c;
      const estHour = this.getEstHour(candle.timestamp || candle.t);

      // Check circuit breaker before trading
      if (circuitBreakerTriggered) {
        // If in position, still allow exits but no new entries
        if (!position) continue;
      }

      // Calculate indicators
      const indicators = this.calculateIndicators(candles, i);

      if (!position && !circuitBreakerTriggered) {
        // Check for BUY signal (only if circuit breaker not triggered)
        const buySignal = this.checkBuySignal(indicators, config);
        if (buySignal.shouldBuy && buySignal.confidence >= (config.minConfidence || 60)) {
          const positionSize = cash * (config.maxPositionSizePercent || 15) / 100;
          const shares = Math.floor(positionSize / price);
          if (shares > 0) {
            position = {
              shares,
              entryPrice: price,
              entryIndex: i,
            };
            cash -= shares * price;
          }
        }
      } else if (position) {
        // Check for SELL signal
        const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;
        const holdTime = i - position.entryIndex;

        const sellSignal = this.checkSellSignal(indicators, config, pnlPercent, estHour, holdTime);
        if (sellSignal.shouldSell) {
          const proceeds = position.shares * price;
          const tradePnL = proceeds - (position.shares * position.entryPrice);

          realizedPnL += tradePnL;
          cash += proceeds;
          trades++;

          if (tradePnL > 0) {
            wins++;
            consecutiveLosses = 0; // Reset on win
          } else {
            losses++;
            consecutiveLosses++;

            // Check consecutive loss circuit breaker
            if (consecutiveLosses >= consecutiveLossLimit) {
              circuitBreakerTriggered = true;
              circuitBreakerReason = `Consecutive loss limit (${consecutiveLosses})`;
            }
          }

          tradeLog.push({
            entry: position.entryPrice,
            exit: price,
            pnl: tradePnL,
            pnlPercent,
            holdCandles: holdTime,
            reason: sellSignal.reason,
          });

          position = null;

          // Check daily loss limit circuit breaker
          const dailyPnLPercent = (realizedPnL / initialCapital) * 100;
          if (dailyPnLPercent <= -dailyLossLimitPercent) {
            circuitBreakerTriggered = true;
            circuitBreakerReason = `Daily loss limit (${dailyPnLPercent.toFixed(2)}%)`;
          }
        }
      }

      // End of day liquidation
      if (estHour >= 15.75 && position) {
        const proceeds = position.shares * price;
        const tradePnL = proceeds - (position.shares * position.entryPrice);

        realizedPnL += tradePnL;
        cash += proceeds;
        trades++;

        if (tradePnL > 0) {
          wins++;
          consecutiveLosses = 0;
        } else {
          losses++;
          consecutiveLosses++;
        }

        tradeLog.push({
          entry: position.entryPrice,
          exit: price,
          pnl: tradePnL,
          pnlPercent: ((price - position.entryPrice) / position.entryPrice) * 100,
          holdCandles: i - position.entryIndex,
          reason: 'EOD',
        });

        position = null;
      }
    }

    const finalValue = cash + (position ? position.shares * (candles[candles.length - 1].close ?? candles[candles.length - 1].c) : 0);
    const returnPercent = ((finalValue - initialCapital) / initialCapital) * 100;

    return {
      initialCapital,
      finalValue,
      returnPercent,
      realizedPnL,
      trades,
      wins,
      losses,
      winRate: trades > 0 ? (wins / trades * 100) : 0,
      dayReturn, // Buy and hold return for this day
      alpha: returnPercent - dayReturn, // Strategy return minus buy-and-hold
      tradeLog,
      circuitBreakerTriggered,
      circuitBreakerReason,
    };
  }

  /**
   * Calculate technical indicators
   * Uses the same technicalIndicatorsService as live trading for RSI parity
   */
  calculateIndicators(candles, index) {
    // Normalize candle format for technical indicators library
    const normalizedCandles = candles.slice(0, index + 1).map(c => ({
      open: c.open ?? c.o,
      high: c.high ?? c.h,
      low: c.low ?? c.l,
      close: c.close ?? c.c,
      volume: c.volume ?? c.v ?? 1,
    }));

    const closes = normalizedCandles.map(c => c.close);
    const price = closes[closes.length - 1];

    // RSI - Use the same Wilder's smoothing method as live trading
    let rsi = 50; // Default if not enough data
    if (closes.length >= 15) {
      const rsiValues = technicalIndicators.calculateRSI(closes, 14);
      if (rsiValues.length > 0) {
        rsi = rsiValues[rsiValues.length - 1];
      }
    }

    // VWAP - Use the same calculation as live trading
    let vwap = price; // Default to current price
    if (normalizedCandles.length > 0) {
      const vwapValues = technicalIndicators.calculateVWAP(normalizedCandles);
      if (vwapValues.length > 0) {
        vwap = vwapValues[vwapValues.length - 1];
      }
    }

    const priceVsVwap = ((price - vwap) / vwap) * 100;

    // Volume ratio
    const volumes = normalizedCandles.map(c => c.volume);
    const lookbackVols = volumes.slice(Math.max(0, volumes.length - 11), volumes.length - 1);
    const avgVolume = lookbackVols.length > 0
      ? lookbackVols.reduce((sum, v) => sum + v, 0) / lookbackVols.length
      : 1;
    const currentVolume = volumes[volumes.length - 1] || 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // Price change
    const prevPrice = closes.length > 1 ? closes[closes.length - 2] : price;
    const priceChange = ((price - prevPrice) / prevPrice) * 100;

    return { rsi, vwap, priceVsVwap, volumeRatio, priceChange, price };
  }

  /**
   * Check for buy signal
   * Aligned with aiTradingEngine's shouldBuy logic for parity
   */
  checkBuySignal(indicators, config) {
    const { rsi, priceVsVwap, volumeRatio } = indicators;
    const strategy = config.entryStrategy || 'balanced';
    const rsiOversold = config.rsiOversold || 30;
    const volumeMultiplier = config.volumeMultiplier || 1.5;
    const requireVolumeSpike = config.requireVolumeSpike !== false;
    const requireRsiSignal = config.requireRsiSignal !== false;

    let signalCount = 0;
    const reasons = [];
    let strategyMatch = false;

    const belowVwap = priceVsVwap < 0;

    // Strategy-specific signal checks (matching aiTradingEngine)
    if (strategy === 'dip' || strategy === 'conservative') {
      // Buy the dip: RSI oversold + below VWAP
      if (rsi < rsiOversold && belowVwap) {
        strategyMatch = true;
        signalCount++;
        reasons.push(`RSI oversold (${Math.round(rsi)}) + below VWAP`);
      }
    }

    if (strategy === 'momentum' || strategy === 'aggressive') {
      // Momentum: RSI between 50-65
      if (rsi > 50 && rsi < 65) {
        strategyMatch = true;
        signalCount++;
        reasons.push(`RSI momentum zone (${Math.round(rsi)})`);
      }
      // Aggressive: more lenient entry - RSI not overbought AND has some volume
      if (strategy === 'aggressive') {
        if (rsi < 70) {
          strategyMatch = true;
          signalCount++;
          reasons.push(`Aggressive entry (RSI ${Math.round(rsi)} < 70)`);
        }
        // Aggressive gets extra signal for any volume activity
        if (volumeRatio >= 1.0) {
          signalCount++;
          reasons.push(`Volume present (${volumeRatio.toFixed(1)}x)`);
        }
      }
    }

    if (strategy === 'balanced') {
      // Balanced: RSI below threshold + below VWAP
      // Use rsiOversold + 15 as the balanced threshold (default 45 if rsiOversold=30)
      const balancedRsiThreshold = (rsiOversold || 30) + 15;
      if (rsi < balancedRsiThreshold && belowVwap) {
        strategyMatch = true;
        signalCount++; // Signal 1: RSI dip
        signalCount++; // Signal 2: Below VWAP (these are two separate conditions)
        reasons.push(`RSI dip (${Math.round(rsi)}) + below VWAP`);
      }
      // Balanced also gets signal for moderate RSI (not overbought)
      if (rsi < 60) {
        signalCount++;
        reasons.push(`RSI neutral (${Math.round(rsi)})`);
      }
    }

    // Additional confirming signals
    if (requireVolumeSpike && volumeRatio >= volumeMultiplier) {
      signalCount++;
      reasons.push(`Volume spike (${volumeRatio.toFixed(1)}x)`);
    }

    if (requireRsiSignal && rsi < 40) {
      signalCount++;
      reasons.push('RSI oversold zone');
    }

    // Calculate confidence (matching aiTradingEngine)
    // Formula: base 20 + 20 per signal, so 3 signals = 80% confidence
    const confidence = Math.min(20 + signalCount * 20, 100);
    const minSignals = config.minSignalsRequired || 2;
    const minConfidence = config.minConfidence || 70;

    // Entry: strategy match + minimum signals + confidence threshold
    const meetsSignalRequirement = signalCount >= minSignals;
    const meetsConfidenceRequirement = confidence >= minConfidence;
    const shouldBuy = strategyMatch && meetsSignalRequirement && meetsConfidenceRequirement;

    return { shouldBuy, signals: signalCount, confidence, reasons };
  }

  /**
   * Check for sell signal
   */
  checkSellSignal(indicators, config, pnlPercent, estHour, holdTime) {
    const { rsi } = indicators;
    const minHoldCandles = 5;

    // Take profit
    if (pnlPercent >= (config.takeProfitPercent || 2)) {
      return { shouldSell: true, reason: `Take profit (${pnlPercent.toFixed(2)}%)` };
    }

    // Stop loss
    if (pnlPercent <= -(config.stopLossPercent || 1)) {
      return { shouldSell: true, reason: `Stop loss (${pnlPercent.toFixed(2)}%)` };
    }

    // RSI overbought (with min hold time)
    if (holdTime >= minHoldCandles && rsi >= (config.rsiOverbought || 70)) {
      return { shouldSell: true, reason: `RSI overbought (${Math.round(rsi)})` };
    }

    // EOD approaching
    if (estHour >= 15.75) {
      return { shouldSell: true, reason: 'EOD liquidation' };
    }

    return { shouldSell: false };
  }

  /**
   * Calculate aggregate statistics
   */
  calculateStatistics(dailyResults, totalTrades, totalWins, totalLosses) {
    const returns = dailyResults.map(d => d.returnPercent);
    const alphas = dailyResults.map(d => d.alpha);

    // Basic stats
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const avgAlpha = alphas.reduce((a, b) => a + b, 0) / alphas.length;

    // Standard deviation
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe Ratio (assuming 0% risk-free rate for simplicity)
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Win rate
    const profitableDays = dailyResults.filter(d => d.returnPercent > 0).length;
    const dayWinRate = (profitableDays / dailyResults.length) * 100;

    // Max drawdown (simplified - day-to-day)
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const day of dailyResults) {
      cumulative += day.returnPercent;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Profit factor
    const grossProfit = dailyResults.filter(d => d.realizedPnL > 0).reduce((sum, d) => sum + d.realizedPnL, 0);
    const grossLoss = Math.abs(dailyResults.filter(d => d.realizedPnL < 0).reduce((sum, d) => sum + d.realizedPnL, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Consistency score (% of days with positive alpha)
    const positiveAlphaDays = dailyResults.filter(d => d.alpha > 0).length;
    const consistencyScore = (positiveAlphaDays / dailyResults.length) * 100;

    return {
      totalDays: dailyResults.length,
      totalTrades,
      tradesPerDay: (totalTrades / dailyResults.length).toFixed(1),
      tradeWinRate: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0,
      dayWinRate: dayWinRate.toFixed(1),
      avgDailyReturn: avgReturn.toFixed(2),
      avgAlpha: avgAlpha.toFixed(2),
      stdDev: stdDev.toFixed(2),
      sharpeRatio: sharpeRatio.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      profitFactor: profitFactor === Infinity ? '∞' : profitFactor.toFixed(2),
      consistencyScore: consistencyScore.toFixed(1),
      bestDay: Math.max(...returns).toFixed(2),
      worstDay: Math.min(...returns).toFixed(2),
    };
  }

  /**
   * Calculate buy-and-hold returns for comparison
   */
  async calculateBuyAndHold(symbol, startDate, endDate) {
    try {
      const candles = await this.polygonClient.getHistoricalAggregates(
        symbol,
        startDate,
        endDate,
        'day'
      );

      if (!candles || candles.length < 2) return null;

      const startPrice = candles[0].open ?? candles[0].o;
      const endPrice = candles[candles.length - 1].close ?? candles[candles.length - 1].c;
      const returnPercent = ((endPrice - startPrice) / startPrice) * 100;

      return {
        startPrice,
        endPrice,
        returnPercent: returnPercent.toFixed(2),
        days: candles.length,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Analyze performance by regime
   */
  analyzeByRegime(dailyResults) {
    const byRegime = {
      bull: { days: 0, avgReturn: 0, avgAlpha: 0, winRate: 0 },
      bear: { days: 0, avgReturn: 0, avgAlpha: 0, winRate: 0 },
      sideways: { days: 0, avgReturn: 0, avgAlpha: 0, winRate: 0 },
      unknown: { days: 0, avgReturn: 0, avgAlpha: 0, winRate: 0 },
    };

    for (const day of dailyResults) {
      const regime = day.regime || 'unknown';
      if (!byRegime[regime]) byRegime[regime] = { days: 0, avgReturn: 0, avgAlpha: 0, winRate: 0 };

      byRegime[regime].days++;
      byRegime[regime].avgReturn += day.returnPercent;
      byRegime[regime].avgAlpha += day.alpha;
      if (day.returnPercent > 0) byRegime[regime].winRate++;
    }

    // Calculate averages
    for (const regime of Object.keys(byRegime)) {
      if (byRegime[regime].days > 0) {
        byRegime[regime].avgReturn = (byRegime[regime].avgReturn / byRegime[regime].days).toFixed(2);
        byRegime[regime].avgAlpha = (byRegime[regime].avgAlpha / byRegime[regime].days).toFixed(2);
        byRegime[regime].winRate = ((byRegime[regime].winRate / byRegime[regime].days) * 100).toFixed(1);
      }
    }

    return byRegime;
  }

  /**
   * Generate verdict based on statistics
   */
  generateVerdict(stats, buyAndHold) {
    const issues = [];
    const strengths = [];

    // Check Sharpe Ratio
    const sharpe = parseFloat(stats.sharpeRatio);
    if (sharpe < 0) {
      issues.push('Negative Sharpe Ratio - strategy loses money on risk-adjusted basis');
    } else if (sharpe < 1) {
      issues.push('Low Sharpe Ratio (<1) - poor risk-adjusted returns');
    } else if (sharpe >= 2) {
      strengths.push('Excellent Sharpe Ratio (≥2) - strong risk-adjusted returns');
    } else {
      strengths.push('Good Sharpe Ratio (1-2) - acceptable risk-adjusted returns');
    }

    // Check vs buy-and-hold
    if (buyAndHold) {
      const bhReturn = parseFloat(buyAndHold.returnPercent);
      const avgAlpha = parseFloat(stats.avgAlpha);
      if (avgAlpha < 0) {
        issues.push(`Negative alpha - strategy underperforms buy-and-hold by ${Math.abs(avgAlpha)}% per day`);
      } else if (avgAlpha > 0.2) {
        strengths.push(`Positive alpha (+${avgAlpha}% per day) - beats buy-and-hold`);
      }
    }

    // Check consistency
    const consistency = parseFloat(stats.consistencyScore);
    if (consistency < 50) {
      issues.push(`Low consistency (${consistency}%) - strategy beats market less than half the days`);
    } else if (consistency >= 60) {
      strengths.push(`Good consistency (${consistency}%) - beats market most days`);
    }

    // Check drawdown
    const drawdown = parseFloat(stats.maxDrawdown);
    if (drawdown > 10) {
      issues.push(`High max drawdown (${drawdown}%) - significant losing streaks`);
    }

    // Check trade win rate
    const winRate = parseFloat(stats.tradeWinRate);
    if (winRate < 40) {
      issues.push(`Low trade win rate (${winRate}%) - most trades lose money`);
    } else if (winRate >= 55) {
      strengths.push(`Good trade win rate (${winRate}%)`);
    }

    // Overall verdict
    let verdict = 'NEEDS_WORK';
    let confidence = 'LOW';

    if (issues.length === 0 && strengths.length >= 3) {
      verdict = 'READY_FOR_PAPER_TRADING';
      confidence = 'HIGH';
    } else if (issues.length <= 1 && strengths.length >= 2) {
      verdict = 'PROMISING_NEEDS_REFINEMENT';
      confidence = 'MEDIUM';
    } else if (issues.length >= 3) {
      verdict = 'NOT_READY';
      confidence = 'LOW';
    }

    return {
      verdict,
      confidence,
      issues,
      strengths,
      recommendation: this.getRecommendation(verdict, issues),
    };
  }

  /**
   * Get actionable recommendation
   */
  getRecommendation(verdict, issues) {
    if (verdict === 'READY_FOR_PAPER_TRADING') {
      return 'Strategy shows consistent positive results. Recommend 2-4 weeks of paper trading before live capital.';
    }
    if (verdict === 'PROMISING_NEEDS_REFINEMENT') {
      return `Strategy shows promise but has issues: ${issues.join(', ')}. Focus on fixing these before paper trading.`;
    }
    if (verdict === 'NEEDS_WORK') {
      return 'Strategy needs significant improvement. Review entry/exit logic and risk management.';
    }
    return 'Strategy is not ready. Consider different approach or parameters.';
  }

  /**
   * Helper: Get EST hour from timestamp
   */
  getEstHour(timestamp) {
    const date = new Date(timestamp);
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();
    // EST = UTC - 5 (simplified, ignoring DST)
    let estHour = utcHour - 5;
    if (estHour < 0) estHour += 24;
    return estHour + utcMinute / 60;
  }

  /**
   * Helper: Subtract days from date
   */
  subtractDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
}

module.exports = StrategyBacktester;
