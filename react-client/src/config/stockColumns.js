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
 */

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

  // --- Year range = 0.4
  discount: {
    label: 'Discount',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.4,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- Debt / Ebitda = 0.15
  debtEbitda: {
    label: 'Debt / Ebitda',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  // --- NET DEBT = 0.15
  netDebt: {
    label: 'Net Debt',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  // --- BETA = 0.15
  beta: {
    label: 'Beta',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined,
  },

  // --- QUICK RATIO = 0.1
  quickRatio: {
    label: 'Quick Ratio',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.1,
    multiplier: 1,
    average: undefined,
    stdDev: undefined,
  },

  // --- DIV = 0.05
  dividend: {
    label: 'Dividend Rate',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.05,
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