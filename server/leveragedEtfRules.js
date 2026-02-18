/**
 * Leveraged ETF Rules Engine
 *
 * Enforces critical trading rules for leveraged ETFs to prevent decay losses.
 *
 * Key insight from research:
 * - SOXL decays approximately -10.29% annually from volatility drag
 * - SOXS decays approximately -28.77% annually (inverse decay faster)
 * - Holding overnight = guaranteed decay that compounds against you
 *
 * Rules enforced:
 * 1. No new positions after 3:30 PM (not enough time to manage)
 * 2. Force exit by 3:55 PM (avoid overnight hold)
 * 3. Warn on overnight positions (should never happen)
 * 4. Reduce position size in high volatility
 */

class LeveragedEtfRules {
  constructor() {
    // Comprehensive database of leveraged ETFs
    this.leveragedEtfs = {
      // 3x Semiconductor
      SOXL: {
        leverage: 3,
        direction: 'bull',
        underlying: 'SOXX',
        annualDecayRate: -0.1029, // -10.29% annual decay
        description: '3x Semiconductor Bull',
      },
      SOXS: {
        leverage: 3,
        direction: 'bear',
        underlying: 'SOXX',
        annualDecayRate: -0.2877, // -28.77% annual decay (inverse decays faster)
        description: '3x Semiconductor Bear',
      },

      // 3x NASDAQ
      TQQQ: {
        leverage: 3,
        direction: 'bull',
        underlying: 'QQQ',
        annualDecayRate: -0.08,
        description: '3x NASDAQ-100 Bull',
      },
      SQQQ: {
        leverage: 3,
        direction: 'bear',
        underlying: 'QQQ',
        annualDecayRate: -0.15,
        description: '3x NASDAQ-100 Bear',
      },

      // 3x S&P 500
      UPRO: {
        leverage: 3,
        direction: 'bull',
        underlying: 'SPY',
        annualDecayRate: -0.06,
        description: '3x S&P 500 Bull',
      },
      SPXU: {
        leverage: 3,
        direction: 'bear',
        underlying: 'SPY',
        annualDecayRate: -0.12,
        description: '3x S&P 500 Bear',
      },

      // 3x Russell 2000
      TNA: {
        leverage: 3,
        direction: 'bull',
        underlying: 'IWM',
        annualDecayRate: -0.12,
        description: '3x Russell 2000 Bull',
      },
      TZA: {
        leverage: 3,
        direction: 'bear',
        underlying: 'IWM',
        annualDecayRate: -0.20,
        description: '3x Russell 2000 Bear',
      },

      // 3x Biotech
      LABU: {
        leverage: 3,
        direction: 'bull',
        underlying: 'XBI',
        annualDecayRate: -0.15,
        description: '3x Biotech Bull',
      },
      LABD: {
        leverage: 3,
        direction: 'bear',
        underlying: 'XBI',
        annualDecayRate: -0.25,
        description: '3x Biotech Bear',
      },

      // 3x FANG+
      FNGU: {
        leverage: 3,
        direction: 'bull',
        underlying: 'NYFANG',
        annualDecayRate: -0.10,
        description: '3x FANG+ Bull',
      },
      FNGD: {
        leverage: 3,
        direction: 'bear',
        underlying: 'NYFANG',
        annualDecayRate: -0.18,
        description: '3x FANG+ Bear',
      },

      // 2x Quantum Computing (newer, less decay)
      QBTX: {
        leverage: 2,
        direction: 'bull',
        underlying: 'QBTS',
        annualDecayRate: -0.05,
        description: '2x Quantum Computing Bull',
        isNew: true, // Launched April 2025
        launchDate: '2025-04-01',
      },
      QBTZ: {
        leverage: 2,
        direction: 'bear',
        underlying: 'QBTS',
        annualDecayRate: -0.10,
        description: '2x Quantum Computing Bear',
        isNew: true,
        launchDate: '2025-04-01',
      },
    };

    // Trading time constraints
    this.timeRules = {
      noNewPositionsAfter: 15.5, // 3:30 PM (15:30)
      forceExitBy: 15.917, // 3:55 PM (15:55)
      marketClose: 16, // 4:00 PM
      marketOpen: 9.5, // 9:30 AM
    };

    // Volatility-based position sizing
    this.volatilityRules = {
      highVolThreshold: 30, // VIX above 30 = high volatility
      extremeVolThreshold: 40, // VIX above 40 = extreme
      highVolPositionMultiplier: 0.5, // Cut position size in half
      extremeVolPositionMultiplier: 0.25, // Cut to 25%
    };
  }

  /**
   * Check if a symbol is a leveraged ETF
   */
  isLeveraged(symbol) {
    return symbol?.toUpperCase() in this.leveragedEtfs;
  }

  /**
   * Get detailed info about a leveraged ETF
   */
  getInfo(symbol) {
    return this.leveragedEtfs[symbol?.toUpperCase()] || null;
  }

  /**
   * Get the leverage multiplier for a symbol
   */
  getLeverage(symbol) {
    const info = this.getInfo(symbol);
    return info ? info.leverage : 1;
  }

  /**
   * Convert time to decimal format (e.g., 3:30 PM = 15.5)
   */
  timeToDecimal(date) {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    return date.getHours() + date.getMinutes() / 60;
  }

  /**
   * Apply leveraged ETF constraints to a trading decision
   *
   * @param {string} symbol - The symbol being traded
   * @param {Object} decision - The proposed trading decision { action, confidence, reason }
   * @param {Date|string} currentTime - Current timestamp
   * @param {Object|null} currentPosition - Current position if any
   * @param {number} vix - Current VIX level (optional, for volatility adjustment)
   * @returns {Object} Modified decision with constraints applied
   */
  applyConstraints(symbol, decision, currentTime, currentPosition = null, vix = null) {
    if (!this.isLeveraged(symbol)) {
      // Not a leveraged ETF, no constraints needed
      return decision;
    }

    const info = this.getInfo(symbol);
    const timeDecimal = this.timeToDecimal(currentTime);
    const constraints = [];
    let modifiedDecision = { ...decision };

    // RULE 1: No new positions after 3:30 PM
    if (decision.action === 'BUY' && timeDecimal >= this.timeRules.noNewPositionsAfter) {
      modifiedDecision = {
        ...decision,
        action: 'HOLD',
        reason: `Too close to market close for leveraged ETF entry (after ${this.formatTime(this.timeRules.noNewPositionsAfter)})`,
        originalAction: decision.action,
        constraintApplied: 'NO_LATE_ENTRY',
      };
      constraints.push({
        rule: 'NO_LATE_ENTRY',
        message: `Blocked BUY: No new ${symbol} positions after 3:30 PM`,
      });
    }

    // RULE 2: Force exit by 3:55 PM
    if (currentPosition && timeDecimal >= this.timeRules.forceExitBy) {
      modifiedDecision = {
        action: 'SELL',
        reason: `Mandatory end-of-day exit for leveraged ETF ${symbol}`,
        confidence: 100,
        forced: true,
        originalAction: decision.action,
        constraintApplied: 'FORCED_EXIT',
      };
      constraints.push({
        rule: 'FORCED_EXIT',
        message: `Forced SELL: Must exit ${symbol} before market close to avoid decay`,
        urgency: 'CRITICAL',
      });
    }

    // RULE 3: Warn about overnight positions
    if (currentPosition && this.isOvernight(currentPosition.entryTime, currentTime)) {
      constraints.push({
        rule: 'OVERNIGHT_WARNING',
        message: `WARNING: ${symbol} position held overnight! Expected decay: ${(info.annualDecayRate / 252 * 100).toFixed(3)}% per day`,
        urgency: 'HIGH',
      });
    }

    // RULE 4: Adjust position size based on volatility (if VIX provided)
    if (vix !== null && decision.action === 'BUY') {
      let positionMultiplier = 1;
      let volWarning = null;

      if (vix >= this.volatilityRules.extremeVolThreshold) {
        positionMultiplier = this.volatilityRules.extremeVolPositionMultiplier;
        volWarning = `Extreme volatility (VIX=${vix}): Position size reduced to ${positionMultiplier * 100}%`;
      } else if (vix >= this.volatilityRules.highVolThreshold) {
        positionMultiplier = this.volatilityRules.highVolPositionMultiplier;
        volWarning = `High volatility (VIX=${vix}): Position size reduced to ${positionMultiplier * 100}%`;
      }

      if (volWarning) {
        modifiedDecision.positionMultiplier = positionMultiplier;
        constraints.push({
          rule: 'VOLATILITY_ADJUSTMENT',
          message: volWarning,
        });
      }
    }

    // Add constraints to the decision
    modifiedDecision.constraints = constraints;
    modifiedDecision.isLeveraged = true;
    modifiedDecision.leverageInfo = info;

    return modifiedDecision;
  }

  /**
   * Check if a position was held overnight
   */
  isOvernight(entryTime, currentTime) {
    if (!entryTime) return false;

    const entryDate = new Date(entryTime);
    const currentDate = new Date(currentTime);

    // Different calendar day
    return entryDate.toDateString() !== currentDate.toDateString();
  }

  /**
   * Get the appropriate underlying symbol for backtesting
   * (Since some leveraged ETFs are new and lack history)
   */
  getBacktestProxy(symbol) {
    const info = this.getInfo(symbol);
    if (!info) {
      return { useProxy: false, proxySymbol: symbol };
    }

    // For new ETFs, use underlying and simulate leverage
    if (info.isNew) {
      return {
        useProxy: true,
        proxySymbol: info.underlying,
        simulateLeverage: info.leverage,
        direction: info.direction,
        launchDate: info.launchDate,
        message: `${symbol} is new (launched ${info.launchDate}). Using ${info.underlying} with ${info.leverage}x simulated leverage.`,
      };
    }

    return { useProxy: false, proxySymbol: symbol };
  }

  /**
   * Calculate expected decay for holding a leveraged ETF
   *
   * @param {string} symbol - Leveraged ETF symbol
   * @param {number} days - Number of days holding
   * @returns {Object} Expected decay information
   */
  calculateExpectedDecay(symbol, days = 1) {
    const info = this.getInfo(symbol);
    if (!info) {
      return null;
    }

    // Annual decay spread over trading days (252)
    const dailyDecay = info.annualDecayRate / 252;
    const totalDecay = dailyDecay * days;

    return {
      symbol,
      leverage: info.leverage,
      direction: info.direction,
      dailyDecayPercent: (dailyDecay * 100).toFixed(4),
      totalDecayPercent: (totalDecay * 100).toFixed(4),
      annualDecayPercent: (info.annualDecayRate * 100).toFixed(2),
      message: `Holding ${symbol} for ${days} day(s) expects ${(totalDecay * 100).toFixed(4)}% decay from volatility drag`,
      recommendation:
        days > 1
          ? 'AVOID: Do not hold leveraged ETFs overnight'
          : 'OK for day trading only',
    };
  }

  /**
   * Check if we're within trading hours
   */
  isMarketHours(currentTime) {
    const timeDecimal = this.timeToDecimal(currentTime);
    return timeDecimal >= this.timeRules.marketOpen && timeDecimal < this.timeRules.marketClose;
  }

  /**
   * Get time remaining until forced exit
   */
  getTimeUntilForcedExit(currentTime) {
    const timeDecimal = this.timeToDecimal(currentTime);

    if (timeDecimal >= this.timeRules.forceExitBy) {
      return { minutes: 0, message: 'FORCED EXIT NOW' };
    }

    const minutesRemaining = (this.timeRules.forceExitBy - timeDecimal) * 60;

    return {
      minutes: Math.floor(minutesRemaining),
      message:
        minutesRemaining <= 30
          ? `WARNING: ${Math.floor(minutesRemaining)} minutes until forced exit`
          : `${Math.floor(minutesRemaining)} minutes until forced exit`,
    };
  }

  /**
   * Format decimal time to readable format
   */
  formatTime(decimalTime) {
    const hours = Math.floor(decimalTime);
    const minutes = Math.round((decimalTime - hours) * 60);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  /**
   * Get all leveraged ETFs with their details
   */
  getAllLeveragedEtfs() {
    return Object.entries(this.leveragedEtfs).map(([symbol, info]) => ({
      symbol,
      ...info,
      dailyDecayPercent: ((info.annualDecayRate / 252) * 100).toFixed(4) + '%',
    }));
  }

  /**
   * Get summary of rules for UI display
   */
  getRulesSummary() {
    return {
      entryDeadline: this.formatTime(this.timeRules.noNewPositionsAfter),
      forcedExitTime: this.formatTime(this.timeRules.forceExitBy),
      marketClose: this.formatTime(this.timeRules.marketClose),
      rules: [
        'No new positions after 3:30 PM',
        'All positions force-exited at 3:55 PM',
        'Never hold overnight (decay compounds)',
        'Reduce position size when VIX > 30',
        'Reduce position size to 25% when VIX > 40',
      ],
      reasoning: 'Leveraged ETFs use daily rebalancing which causes decay over time. This decay accelerates with volatility.',
    };
  }
}

module.exports = LeveragedEtfRules;
