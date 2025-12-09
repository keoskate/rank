/**
 * Transaction Cost Model
 *
 * Models realistic trading costs including slippage, spread, and commissions.
 * Critical for accurate backtesting - a strategy that looks profitable without
 * costs may be unprofitable when real execution is considered.
 *
 * Research-based defaults:
 * - Liquid ETFs (SPY, QQQ): ~0.02% round-trip
 * - Leveraged ETFs (SOXL, SOXS): ~0.16% round-trip
 * - Low-volume ETFs (QBTX, QBTZ): ~0.35% round-trip
 */

class TransactionCostModel {
  constructor() {
    // Cost profiles by instrument type
    this.costProfiles = {
      // Large-cap, highly liquid ETFs (SPY, QQQ, IWM)
      liquid: {
        slippagePercent: 0.01, // 0.01% slippage per side
        spreadPercent: 0.01, // Very tight spreads
        commission: 0, // Most brokers are commission-free
        description: 'Highly liquid ETFs with tight spreads',
      },

      // Leveraged ETFs (SOXL, SOXS, TQQQ, SQQQ)
      leveraged: {
        slippagePercent: 0.05, // 0.05% slippage per side
        spreadPercent: 0.03, // Wider spreads due to volatility
        commission: 0,
        description: 'Leveraged ETFs with moderate spreads',
      },

      // New or low-volume ETFs (QBTX, QBTZ)
      lowVolume: {
        slippagePercent: 0.15, // 0.15% slippage - significant!
        spreadPercent: 0.05, // Wide spreads
        commission: 0,
        description: 'Low-volume ETFs with wide spreads - costs matter!',
      },

      // Small-cap stocks
      smallCap: {
        slippagePercent: 0.25, // Can be very high
        spreadPercent: 0.10, // Wide spreads
        commission: 0,
        description: 'Small-cap stocks - high execution costs',
      },

      // Default for unknown symbols
      default: {
        slippagePercent: 0.10,
        spreadPercent: 0.05,
        commission: 0,
        description: 'Default profile for unknown symbols',
      },
    };

    // Map specific symbols to their cost profiles
    this.symbolProfiles = {
      // Highly liquid
      SPY: 'liquid',
      QQQ: 'liquid',
      IWM: 'liquid',
      AAPL: 'liquid',
      MSFT: 'liquid',
      AMZN: 'liquid',
      GOOGL: 'liquid',
      META: 'liquid',
      NVDA: 'liquid',
      TSLA: 'liquid',

      // Leveraged ETFs
      SOXL: 'leveraged',
      SOXS: 'leveraged',
      TQQQ: 'leveraged',
      SQQQ: 'leveraged',
      UPRO: 'leveraged',
      SPXU: 'leveraged',
      LABU: 'leveraged',
      LABD: 'leveraged',
      FNGU: 'leveraged',
      FNGD: 'leveraged',
      TNA: 'leveraged',
      TZA: 'leveraged',

      // Low-volume / New ETFs
      QBTX: 'lowVolume',
      QBTZ: 'lowVolume',
      QBTS: 'lowVolume', // Underlying for QBTX/QBTZ
    };
  }

  /**
   * Get the cost profile for a symbol
   * @param {string} symbol - Stock/ETF symbol
   * @returns {Object} Cost profile with slippage, spread, commission
   */
  getProfile(symbol) {
    const profileName = this.symbolProfiles[symbol?.toUpperCase()] || 'default';
    return {
      ...this.costProfiles[profileName],
      profileName,
    };
  }

  /**
   * Calculate realistic execution price after costs
   *
   * @param {string} symbol - Stock/ETF symbol
   * @param {number} price - Quoted/mid price
   * @param {string} side - 'BUY' or 'SELL'
   * @param {number} shares - Number of shares (for market impact estimation)
   * @returns {number} Actual expected execution price
   */
  getExecutionPrice(symbol, price, side, shares = 100) {
    const profile = this.getProfile(symbol);

    // Slippage always works against you
    const slippage = price * (profile.slippagePercent / 100);

    // Spread: you buy at ask (higher), sell at bid (lower)
    const spreadImpact = price * (profile.spreadPercent / 100) / 2;

    // Market impact for larger orders (simplified model)
    // Impact increases with sqrt of order size relative to typical volume
    const marketImpact = shares > 1000 ? price * 0.001 * Math.sqrt(shares / 1000) : 0;

    if (side === 'BUY' || side === 'buy') {
      return price + slippage + spreadImpact + marketImpact;
    } else {
      return price - slippage - spreadImpact - marketImpact;
    }
  }

  /**
   * Calculate total round-trip cost (buy + sell)
   *
   * @param {string} symbol - Stock/ETF symbol
   * @param {number} price - Price per share (for dollar amount calculation)
   * @returns {Object} Round-trip cost details
   */
  getRoundTripCost(symbol, price = 100) {
    const profile = this.getProfile(symbol);

    // Round-trip = 2x slippage + 1x spread (paid on both sides)
    const totalPercent = profile.slippagePercent * 2 + profile.spreadPercent;
    const dollarsPerShare = price * (totalPercent / 100);

    return {
      percent: totalPercent,
      dollarsPerShare,
      profile: profile.profileName,
      breakdown: {
        slippage: profile.slippagePercent * 2,
        spread: profile.spreadPercent,
        commission: profile.commission,
      },
      message: `Round-trip cost for ${symbol}: ${totalPercent.toFixed(3)}% ($${dollarsPerShare.toFixed(3)}/share at $${price})`,
    };
  }

  /**
   * Adjust strategy targets for transaction costs
   * This is critical - a 2% profit target may only yield 1.7% after costs
   *
   * @param {string} symbol - Stock/ETF symbol
   * @param {Object} config - Strategy configuration
   * @returns {Object} Adjusted config with effective targets
   */
  adjustTargetsForCosts(symbol, config) {
    const costs = this.getRoundTripCost(symbol, 100);

    const effectiveTakeProfit = config.takeProfitPercent - costs.percent;
    const effectiveStopLoss = config.stopLossPercent + costs.percent;

    // Calculate break-even win rate needed
    const rewardRiskRatio = effectiveTakeProfit / effectiveStopLoss;
    const breakEvenWinRate = 1 / (1 + rewardRiskRatio);

    // Warnings
    const warnings = [];

    if (effectiveTakeProfit <= 0) {
      warnings.push(
        `CRITICAL: Take profit (${config.takeProfitPercent}%) is less than costs (${costs.percent.toFixed(2)}%). Strategy cannot be profitable.`
      );
    }

    if (costs.percent > config.takeProfitPercent * 0.5) {
      warnings.push(
        `WARNING: Costs (${costs.percent.toFixed(2)}%) are more than half of take profit. Consider wider targets or more liquid instruments.`
      );
    }

    if (breakEvenWinRate > 0.6) {
      warnings.push(
        `WARNING: Break-even win rate is ${(breakEvenWinRate * 100).toFixed(1)}%. This is difficult to achieve consistently.`
      );
    }

    return {
      ...config,
      // Original targets
      takeProfitPercent: config.takeProfitPercent,
      stopLossPercent: config.stopLossPercent,

      // Effective targets after costs
      effectiveTakeProfit: Math.max(0, effectiveTakeProfit),
      effectiveStopLoss: effectiveStopLoss,

      // Cost analysis
      costs: {
        roundTripPercent: costs.percent,
        profile: costs.profile,
        breakdown: costs.breakdown,
      },

      // Risk/reward analysis
      analysis: {
        rewardRiskRatio: rewardRiskRatio > 0 ? rewardRiskRatio.toFixed(2) : 'N/A',
        breakEvenWinRate: (breakEvenWinRate * 100).toFixed(1) + '%',
        costImpact: `${((costs.percent / config.takeProfitPercent) * 100).toFixed(1)}% of profit eaten by costs`,
      },

      warnings,
      isViable: effectiveTakeProfit > 0 && warnings.filter(w => w.includes('CRITICAL')).length === 0,
    };
  }

  /**
   * Apply costs to a simulated trade
   * Use this in backtesting to get realistic P&L
   *
   * @param {Object} trade - Trade object with entry/exit prices
   * @param {string} symbol - Stock/ETF symbol
   * @returns {Object} Trade with adjusted prices and cost breakdown
   */
  applyToTrade(trade, symbol) {
    const { entryPrice, exitPrice, quantity, side = 'BUY' } = trade;

    // Calculate execution prices
    const actualEntryPrice = this.getExecutionPrice(symbol, entryPrice, side, quantity);
    const actualExitPrice = this.getExecutionPrice(
      symbol,
      exitPrice,
      side === 'BUY' ? 'SELL' : 'BUY',
      quantity
    );

    // Calculate P&L
    const grossPnL =
      side === 'BUY'
        ? (exitPrice - entryPrice) * quantity
        : (entryPrice - exitPrice) * quantity;

    const actualPnL =
      side === 'BUY'
        ? (actualExitPrice - actualEntryPrice) * quantity
        : (actualEntryPrice - actualExitPrice) * quantity;

    const totalCosts = grossPnL - actualPnL;

    return {
      ...trade,
      // Original prices
      quotedEntryPrice: entryPrice,
      quotedExitPrice: exitPrice,

      // Actual execution prices
      actualEntryPrice,
      actualExitPrice,

      // P&L breakdown
      grossPnL,
      costs: totalCosts,
      netPnL: actualPnL,

      // Cost impact
      costImpact: {
        percent: ((totalCosts / Math.abs(grossPnL || 1)) * 100).toFixed(2) + '%',
        message:
          grossPnL > 0
            ? `Costs reduced profit by $${totalCosts.toFixed(2)}`
            : `Costs increased loss by $${Math.abs(totalCosts).toFixed(2)}`,
      },
    };
  }

  /**
   * Get summary for all supported symbols
   * Useful for UI display
   */
  getAllSymbolCosts() {
    const results = {};

    for (const [symbol, profileName] of Object.entries(this.symbolProfiles)) {
      const costs = this.getRoundTripCost(symbol, 100);
      results[symbol] = {
        profile: profileName,
        roundTripPercent: costs.percent,
        breakdown: costs.breakdown,
      };
    }

    return results;
  }

  /**
   * Add or update a symbol's cost profile
   * @param {string} symbol - Symbol to add/update
   * @param {string} profileName - Profile name ('liquid', 'leveraged', 'lowVolume', 'smallCap')
   */
  setSymbolProfile(symbol, profileName) {
    if (!this.costProfiles[profileName]) {
      throw new Error(`Unknown profile: ${profileName}. Use: liquid, leveraged, lowVolume, smallCap`);
    }
    this.symbolProfiles[symbol.toUpperCase()] = profileName;
  }

  /**
   * Create a custom cost profile
   * @param {string} name - Profile name
   * @param {Object} costs - { slippagePercent, spreadPercent, commission, description }
   */
  addCustomProfile(name, costs) {
    this.costProfiles[name] = {
      slippagePercent: costs.slippagePercent || 0.1,
      spreadPercent: costs.spreadPercent || 0.05,
      commission: costs.commission || 0,
      description: costs.description || 'Custom profile',
    };
  }
}

module.exports = TransactionCostModel;
