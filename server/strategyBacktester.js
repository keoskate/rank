/**
 * Strategy Backtester - Multi-day validation system
 *
 * Tests a trading strategy across multiple days to:
 * 1. Validate consistency (not just one lucky day)
 * 2. Calculate risk-adjusted metrics (Sharpe, Sortino)
 * 3. Compare to buy-and-hold baseline
 * 4. Identify regime-specific performance
 */

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

    // Calculate day's price range for reference
    const dayOpen = candles[0].open ?? candles[0].o;
    const dayClose = candles[candles.length - 1].close ?? candles[candles.length - 1].c;
    const dayReturn = ((dayClose - dayOpen) / dayOpen) * 100;

    // Simple strategy simulation
    for (let i = 20; i < candles.length; i++) {
      const candle = candles[i];
      const price = candle.close ?? candle.c;
      const estHour = this.getEstHour(candle.timestamp || candle.t);

      // Calculate indicators
      const indicators = this.calculateIndicators(candles, i);

      if (!position) {
        // Check for BUY signal
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
      } else {
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

          if (tradePnL > 0) wins++;
          else losses++;

          tradeLog.push({
            entry: position.entryPrice,
            exit: price,
            pnl: tradePnL,
            pnlPercent,
            holdCandles: holdTime,
            reason: sellSignal.reason,
          });

          position = null;
        }
      }

      // End of day liquidation
      if (estHour >= 15.75 && position) {
        const proceeds = position.shares * price;
        const tradePnL = proceeds - (position.shares * position.entryPrice);

        realizedPnL += tradePnL;
        cash += proceeds;
        trades++;

        if (tradePnL > 0) wins++;
        else losses++;

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
    };
  }

  /**
   * Calculate technical indicators
   */
  calculateIndicators(candles, index) {
    const lookback = Math.min(14, index);
    const recentCandles = candles.slice(index - lookback, index + 1);

    // RSI
    let gains = 0, losses = 0;
    for (let i = 1; i < recentCandles.length; i++) {
      const change = (recentCandles[i].close ?? recentCandles[i].c) -
                     (recentCandles[i-1].close ?? recentCandles[i-1].c);
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const avgGain = gains / lookback;
    const avgLoss = losses / lookback;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    // VWAP
    let vwapSum = 0, volumeSum = 0;
    for (let i = 0; i <= index; i++) {
      const c = candles[i];
      const typical = ((c.high ?? c.h) + (c.low ?? c.l) + (c.close ?? c.c)) / 3;
      const vol = c.volume ?? c.v ?? 1;
      vwapSum += typical * vol;
      volumeSum += vol;
    }
    const vwap = vwapSum / volumeSum;

    const price = candles[index].close ?? candles[index].c;
    const priceVsVwap = ((price - vwap) / vwap) * 100;

    // Volume ratio
    const avgVolume = candles.slice(Math.max(0, index - 10), index)
      .reduce((sum, c) => sum + (c.volume ?? c.v ?? 0), 0) / 10;
    const currentVolume = candles[index].volume ?? candles[index].v ?? 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

    // Price change
    const prevPrice = index > 0 ? (candles[index - 1].close ?? candles[index - 1].c) : price;
    const priceChange = ((price - prevPrice) / prevPrice) * 100;

    return { rsi, vwap, priceVsVwap, volumeRatio, priceChange, price };
  }

  /**
   * Check for buy signal
   */
  checkBuySignal(indicators, config) {
    const { rsi, priceVsVwap, volumeRatio } = indicators;
    const strategy = config.entryStrategy || 'balanced';
    let signals = 0;
    const reasons = [];

    // RSI oversold
    if (rsi <= (config.rsiOversold || 30)) {
      signals++;
      reasons.push(`RSI oversold (${Math.round(rsi)})`);
    }

    // Below VWAP (for dip strategy)
    if (priceVsVwap < -0.5 && (strategy === 'dip' || strategy === 'balanced')) {
      signals++;
      reasons.push(`Below VWAP (${priceVsVwap.toFixed(2)}%)`);
    }

    // RSI momentum (for momentum strategy)
    if (rsi >= 50 && rsi <= 65 && (strategy === 'momentum' || strategy === 'balanced')) {
      signals++;
      reasons.push(`RSI momentum zone (${Math.round(rsi)})`);
    }

    // Volume spike
    if (volumeRatio >= (config.volumeMultiplier || 1.5)) {
      signals++;
      reasons.push(`Volume spike (${volumeRatio.toFixed(1)}x)`);
    }

    const minSignals = config.minSignalsRequired || 2;
    const shouldBuy = signals >= minSignals;
    const confidence = Math.min(95, 50 + signals * 15);

    return { shouldBuy, signals, confidence, reasons };
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
