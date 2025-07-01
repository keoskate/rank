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
 * DEFAULT WEIGHT STRATEGY:
 * - Value-oriented approach with 40% weight on discount from 52-week high
 * - Financial health screening (45% total): debt ratios, beta, liquidity
 * - Income component (5%): dividend yield
 * - Total active weights: 100%
 */

/**
 * DEFAULT WEIGHTS CONFIGURATION
 * 
 * These are the original, tested weight allocations that create a balanced
 * value investing strategy. Use this for resetting weights or as reference.
 * 
 * STRATEGY BREAKDOWN:
 * - Discount (40%): Primary value indicator - stocks trading below 52-week high
 * - Debt/EBITDA (15%): Leverage risk assessment 
 * - Net Debt (15%): Absolute debt burden
 * - Beta (15%): Volatility/risk adjustment
 * - Quick Ratio (10%): Liquidity health check
 * - Dividend (5%): Income generation bonus
 * 
 * Total: 100% (perfectly balanced)
 */
export const DEFAULT_WEIGHTS = {
  discount: 0.4,      // 40% - Primary value signal
  debtEbitda: 0.15,   // 15% - Leverage assessment  
  netDebt: 0.15,      // 15% - Debt burden
  beta: 0.15,         // 15% - Risk adjustment
  quickRatio: 0.1,    // 10% - Liquidity check
  dividend: 0.05,     // 5%  - Income component
  // All other metrics: 0% (display only)
};

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
    type: '',
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
    type: '',
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
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },
  // "cap": {
  //   label: 'Cap',
  //   type: '',
  //   size: COLUMN_SIZE.large,
  //   weight: 0,
  //   multiplier: 1,
  //   average: undefined,
  //   stdDev: undefined
  // },

  // "shortDebt": {
  //     label: 'Short Term Debt',
  //     type: 'money',
  //     size: COLUMN_SIZE.medium,
  //     weight: 0,
  //     multiplier: 1,
  //     average: undefined,
  //     stdDev: undefined
  // },
  // "sectorTrend": {
  //     label: 'Sector Trend',
  //     type: '',
  //     size: COLUMN_SIZE.large,
  //     weight: 0,
  //     multiplier: 1,
  //     average: undefined,
  //     stdDev: undefined
  // },
  // "peRatio": {
  //     label: 'PE Ratio',
  //     type: '',
  //     size: COLUMN_SIZE.large,
  //     weight: 0,
  //     multiplier: 1,
  //     average: undefined,
  //     stdDev: undefined
  // },
};

/**
 * WEIGHT MANAGEMENT UTILITIES
 */

/**
 * Reset all weights to default values
 * @param {Object} currentParams - Current parameter configuration
 * @returns {Object} Updated parameters with default weights
 */
export const resetToDefaultWeights = (currentParams) => {
  const updatedParams = { ...currentParams };
  
  // Reset all weights to 0 first
  Object.keys(updatedParams).forEach(key => {
    if (updatedParams[key].weight !== undefined) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: 0
      };
    }
  });
  
  // Apply default weights
  Object.entries(DEFAULT_WEIGHTS).forEach(([key, weight]) => {
    if (updatedParams[key]) {
      updatedParams[key] = {
        ...updatedParams[key],
        weight: weight
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
export const getCurrentTotalWeight = (currentParams) => {
  return Object.values(currentParams).reduce((total, param) => {
    return total + (param.weight || 0);
  }, 0);
};

/**
 * Validate if current weights match default configuration
 * @param {Object} currentParams - Current parameter configuration
 * @returns {boolean} True if weights match defaults
 */
export const isUsingDefaultWeights = (currentParams) => {
  return Object.entries(DEFAULT_WEIGHTS).every(([key, defaultWeight]) => {
    const currentWeight = currentParams[key]?.weight || 0;
    return Math.abs(currentWeight - defaultWeight) < 0.001; // Account for floating point precision
  });
};