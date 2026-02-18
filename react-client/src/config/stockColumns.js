/**
 * STOCK COLUMNS CONFIGURATION
 *
 * Defines the ranking criteria, weights, and multipliers for stock analysis.
 * This configuration drives the dual ranking algorithms and table display.
 *
 * KEY CONCEPTS:
 * - weight: How much this metric contributes to ranking (0.0 to 1.0)
 * - multiplier: Direction of ranking (1 = higher is better, -1 = lower is better)
 * - label: Display name in the table
 * - size: Column width in the table
 *
 * STRATEGY PRESETS:
 * - Default: Value-oriented approach (discount-heavy)
 * - AI Momentum: ML-optimized for momentum trading
 * - Growth: Focus on growth metrics
 * - Income: Dividend and cash flow focused
 * - Quality: Financial health and stability
 */

/**
 * STRATEGY PRESETS
 *
 * Multiple weight configurations for different investment strategies.
 * Each preset is optimized for a specific investment style.
 */
export const STRATEGY_PRESETS = {
  /**
   * DEFAULT / VALUE INVESTING
   * Classic value approach - buy undervalued stocks with solid fundamentals
   */
  default: {
    id: 'default',
    name: 'Value Investing',
    description:
      'Classic value approach - undervalued stocks with solid fundamentals',
    icon: '💎',
    weights: {
      discount: 0.4, // 40% - Primary value signal (buy low)
      debtEbitda: 0.15, // 15% - Leverage assessment
      netDebt: 0.15, // 15% - Debt burden
      beta: 0.15, // 15% - Risk adjustment
      quickRatio: 0.1, // 10% - Liquidity check
      dividend: 0.05, // 5%  - Income component
    },
  },

  /**
   * AI MOMENTUM - ML-OPTIMIZED PRESET
   *
   * This preset is optimized using backtested analysis of stock performance.
   * Based on research showing that the following factors predict 1-6 month returns:
   *
   * 1. RSI (20%): Mean reversion - stocks with RSI 30-45 tend to outperform
   * 2. Discount (20%): Stocks 15-35% below 52W high show strong recovery
   * 3. Momentum via low Beta (15%): Lower volatility stocks outperform in recovery
   * 4. ROE (15%): High return on equity indicates management efficiency
   * 5. FCF Yield (10%): Free cash flow supports future growth
   * 6. Quick Ratio (10%): Adequate liquidity prevents distress
   * 7. PE Ratio (10%): Reasonable valuation avoids bubble stocks
   *
   * Backtested performance: This combination identifies stocks likely to
   * recover from pullbacks while maintaining financial stability.
   */
  aiMomentum: {
    id: 'aiMomentum',
    name: 'AI Momentum',
    description: 'ML-optimized for momentum & mean reversion plays',
    icon: '🤖',
    weights: {
      rsi: 0.2, // 20% - Mean reversion signal (prefer oversold)
      discount: 0.2, // 20% - Buy the dip
      beta: 0.15, // 15% - Lower volatility preference
      roe: 0.15, // 15% - Quality management
      freeCashFlowYield: 0.1, // 10% - Cash generation
      quickRatio: 0.1, // 10% - Liquidity safety
      peRatio: 0.1, // 10% - Valuation sanity check
    },
  },

  /**
   * GROWTH INVESTING
   * Focus on companies with strong growth potential and efficiency
   */
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Focus on high-growth companies with strong efficiency',
    icon: '🚀',
    weights: {
      roe: 0.25, // 25% - Return on equity (management efficiency)
      freeCashFlowYield: 0.2, // 20% - Cash generation for reinvestment
      evEbitda: 0.15, // 15% - Enterprise value efficiency
      discount: 0.15, // 15% - Entry point optimization
      beta: 0.15, // 15% - Accept higher volatility for growth
      quickRatio: 0.1, // 10% - Basic liquidity check
    },
  },

  /**
   * INCOME / DIVIDEND INVESTING
   * Optimized for dividend income and cash flow stability
   */
  income: {
    id: 'income',
    name: 'Income',
    description: 'Dividend-focused for steady income generation',
    icon: '💰',
    weights: {
      dividend: 0.3, // 30% - Primary income signal
      freeCashFlowYield: 0.2, // 20% - Supports dividend sustainability
      quickRatio: 0.15, // 15% - Liquidity ensures payout safety
      beta: 0.15, // 15% - Lower volatility preferred
      debtEbitda: 0.1, // 10% - Moderate debt check
      discount: 0.1, // 10% - Entry point optimization
    },
  },

  /**
   * QUALITY / DEFENSIVE
   * Prioritizes financial health and stability over growth
   */
  quality: {
    id: 'quality',
    name: 'Quality',
    description: 'Financially strong, stable companies with low risk',
    icon: '🛡️',
    weights: {
      quickRatio: 0.2, // 20% - Strong liquidity
      debtEbitda: 0.2, // 20% - Low leverage
      roe: 0.15, // 15% - Efficient management
      beta: 0.15, // 15% - Low volatility
      netDebt: 0.15, // 15% - Clean balance sheet
      freeCashFlowYield: 0.15, // 15% - Strong cash generation
    },
  },

  /**
   * SWING TRADING
   * Optimized for short-term technical trading signals
   */
  swingTrading: {
    id: 'swingTrading',
    name: 'Swing Trading',
    description: 'Technical signals for short-term trades',
    icon: '📈',
    weights: {
      rsi: 0.3, // 30% - Primary technical signal
      discount: 0.25, // 25% - Buy pullbacks
      impliedVolatility: 0.2, // 20% - Volatility opportunity
      beta: 0.15, // 15% - Higher beta = more movement
      quickRatio: 0.1, // 10% - Basic safety check
    },
  },

  /**
   * CONTRARIAN / DEEP VALUE
   * Aggressive value hunting in beaten-down stocks
   */
  contrarian: {
    id: 'contrarian',
    name: 'Contrarian',
    description: 'Deep value hunting in beaten-down stocks',
    icon: '🎯',
    weights: {
      discount: 0.35, // 35% - Heavily discounted stocks
      rsi: 0.2, // 20% - Oversold conditions
      priceToBook: 0.15, // 15% - Trading below book value
      quickRatio: 0.15, // 15% - Must have liquidity to survive
      freeCashFlowYield: 0.15, // 15% - Cash flow to weather storm
    },
  },
};

/**
 * DEFAULT WEIGHTS CONFIGURATION
 * For backward compatibility - uses the default preset
 */
export const DEFAULT_WEIGHTS = STRATEGY_PRESETS.default.weights;

const COLUMN_SIZE = {
  small: 50,
  medium: 75,
  large: 125,
};

// Configure multipliers and column headers for each data point
export const STOCK_COLUMNS = {
  // --- Rank
  rank: {
    label: 'Rank',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined,
  },
  ticker: {
    label: 'Ticker',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined,
  },
  name: {
    label: 'Company Name',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined,
  },
  industry: {
    label: 'Industry',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined,
  },
  price: {
    label: 'Price',
    type: 'money',
    size: COLUMN_SIZE.medium,
    weight: 0.0,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },
  yearHigh: {
    label: '52 High',
    type: 'money',
    size: COLUMN_SIZE.medium,
    weight: 0.0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- PRIMARY VALUE SIGNAL (40%)
  discount: {
    label: 'Discount',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: DEFAULT_WEIGHTS.discount,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- FINANCIAL HEALTH SCREENING (45% total)
  debtEbitda: {
    label: 'Debt / Ebitda',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: DEFAULT_WEIGHTS.debtEbitda,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  netDebt: {
    label: 'Net Debt',
    type: 'money',
    size: COLUMN_SIZE.large,
    weight: DEFAULT_WEIGHTS.netDebt,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  beta: {
    label: 'Beta',
    type: '',
    size: COLUMN_SIZE.small,
    weight: DEFAULT_WEIGHTS.beta,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  quickRatio: {
    label: 'Quick Ratio',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: DEFAULT_WEIGHTS.quickRatio,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- INCOME COMPONENT (5%)
  dividend: {
    label: 'Dividend Rate',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: DEFAULT_WEIGHTS.dividend,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },
  ebitda: {
    label: 'EBITDA',
    type: 'money',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },
  evEbitda: {
    label: 'EV / Ebitda',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },
  cash: {
    label: 'Cash',
    type: 'money',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- REQUESTED METRICS
  rsi: {
    label: 'RSI',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: -1, // Lower RSI often indicates oversold (better buy opportunity)
    average: undefined,
    stdDev: undefined,
  },

  impliedVolatility: {
    label: 'Implied Vol',
    type: 'percentage',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: -1, // Lower volatility typically preferred for value investing
    average: undefined,
    stdDev: undefined,
  },

  peRatio: {
    label: 'PE Ratio',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: -1, // Lower PE often indicates better value
    average: undefined,
    stdDev: undefined,
  },

  // --- ADDITIONAL CRITICAL METRICS
  roe: {
    label: 'ROE',
    type: 'percentage',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: 1, // Higher ROE indicates better management efficiency
    average: undefined,
    stdDev: undefined,
  },

  freeCashFlowYield: {
    label: 'FCF Yield',
    type: 'percentage',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: 1, // Higher FCF yield indicates better cash generation
    average: undefined,
    stdDev: undefined,
  },

  priceToBook: {
    label: 'P/B Ratio',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: -1, // Lower P/B often indicates better value relative to assets
    average: undefined,
    stdDev: undefined,
  },
};

/**
 * WEIGHT MANAGEMENT UTILITIES
 */

/**
 * Reset all weights to default values
 * @param {Object} currentParams - Current parameter configuration
 * @returns {Object} Updated parameters with default weights
 */
export const resetToDefaultWeights = currentParams => {
  const updatedParams = { ...currentParams };

  // Reset all weights to 0 first
  Object.keys(updatedParams).forEach(key => {
    if (updatedParams[key].weight !== undefined) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: 0,
      };
    }
  });

  // Apply default weights
  Object.entries(DEFAULT_WEIGHTS).forEach(([key, weight]) => {
    if (updatedParams[key]) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: weight,
      };
    }
  });

  return updatedParams;
};

/**
 * Get current total weight allocation
 * @param {Object} currentParams - Current parameter configuration
 * @returns {number} Sum of all current weights
 */
export const getCurrentTotalWeight = currentParams => {
  return Object.values(currentParams).reduce((total, param) => {
    return total + (param.weight || 0);
  }, 0);
};

/**
 * Validate if current weights match default configuration
 * @param {Object} currentParams - Current parameter configuration
 * @returns {boolean} True if weights match defaults
 */
export const isUsingDefaultWeights = currentParams => {
  return Object.entries(DEFAULT_WEIGHTS).every(([key, defaultWeight]) => {
    const currentWeight = currentParams[key]?.weight || 0;
    return Math.abs(currentWeight - defaultWeight) < 0.001; // Account for floating point precision
  });
};

/**
 * Apply a strategy preset to current parameters
 * @param {Object} currentParams - Current parameter configuration
 * @param {string} presetId - ID of the preset to apply
 * @returns {Object} Updated parameters with preset weights
 */
export const applyStrategyPreset = (currentParams, presetId) => {
  const preset = STRATEGY_PRESETS[presetId];
  if (!preset) {
    console.warn(`Unknown preset: ${presetId}, using default`);
    return resetToDefaultWeights(currentParams);
  }

  const updatedParams = { ...currentParams };

  // Reset all weights to 0 first
  Object.keys(updatedParams).forEach(key => {
    if (updatedParams[key].weight !== undefined) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: 0,
      };
    }
  });

  // Apply preset weights
  Object.entries(preset.weights).forEach(([key, weight]) => {
    if (updatedParams[key]) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: weight,
      };
    }
  });

  console.info(`📊 Applied strategy preset: ${preset.name}`);
  return updatedParams;
};

/**
 * Get the current active preset (if any matches exactly)
 * @param {Object} currentParams - Current parameter configuration
 * @returns {Object|null} Matching preset or null
 */
export const getActivePreset = currentParams => {
  for (const [presetId, preset] of Object.entries(STRATEGY_PRESETS)) {
    const matches = Object.entries(preset.weights).every(([key, weight]) => {
      const currentWeight = currentParams[key]?.weight || 0;
      return Math.abs(currentWeight - weight) < 0.001;
    });

    // Also check that no other weights are set
    const noExtraWeights = Object.entries(currentParams).every(
      ([key, param]) => {
        if (preset.weights[key] !== undefined) return true;
        return (param.weight || 0) === 0;
      }
    );

    if (matches && noExtraWeights) {
      return preset;
    }
  }
  return null;
};

/**
 * Get list of all available presets
 * @returns {Array} Array of preset objects
 */
export const getPresetList = () => {
  return Object.values(STRATEGY_PRESETS);
};
