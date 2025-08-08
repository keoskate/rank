/**
 * STOCK LISTS CONFIGURATION
 *
 * Simple, clean configuration for different stock lists.
 * Add new lists here and they'll automatically appear in the UI selector.
 */

// Individual stock lists
export const STOCK_LISTS = {
  COVID_19: {
    name: 'COVID-19 Recovery Stocks',
    description: '20 stocks from March 2020 analysis',
    stocks: [
      'WM',
      'ADSK',
      'NKE',
      'LSCC',
      'DIS',
      'LRCX',
      'XRAY',
      'RTX',
      'YETI',
      'ENPH',
      'TEVA',
      'MGNI',
      'RUN',
      'DAL',
      'LRMR',
      'RCL',
      'SHOP',
      'HIMX',
      'PI',
      'PENN',
    ],
    color: '#e74c3c', // Red
  },

  TECH_GIANTS: {
    name: 'Tech Giants',
    description: 'Major technology companies',
    stocks: [
      'AAPL',
      'MSFT',
      'GOOGL',
      'AMZN',
      'META',
      'TSLA',
      'NVDA',
      'NFLX',
      'CRM',
      'ORCL',
    ],
    color: '#3498db', // Blue
  },

  BLUE_CHIPS: {
    name: 'Blue Chip Stocks',
    description: 'Large-cap, established companies',
    stocks: [
      'JNJ',
      'PG',
      'KO',
      'PFE',
      'WMT',
      'JPM',
      'V',
      'MA',
      'HD',
      'MCD',
      'VZ',
      'T',
    ],
    color: '#2ecc71', // Green
  },

  GROWTH_STOCKS: {
    name: 'Growth Stocks',
    description: 'High-growth potential companies',
    stocks: [
      'ZM',
      'ROKU',
      'SQ',
      'PYPL',
      'SNAP',
      'UBER',
      'LYFT',
      'DOCU',
      'CRWD',
      'OKTA',
    ],
    color: '#9b59b6', // Purple
  },

  ENERGY_SECTOR: {
    name: 'Energy Sector',
    description: 'Oil, gas, and renewable energy',
    stocks: [
      'XOM',
      'CVX',
      'COP',
      'EOG',
      'SLB',
      'OXY',
      'KMI',
      'WMB',
      'PSX',
      'VLO',
    ],
    color: '#f39c12', // Orange
  },

  CUSTOM_WATCHLIST: {
    name: 'Custom Watchlist',
    description: 'User-defined custom selection',
    stocks: ['AAPL', 'TSLA', 'DIS', 'SHOP', 'NVDA', 'PENN', 'ENPH', 'NKE'],
    color: '#1abc9c', // Teal
  },
};

// Default stock list (can be changed)
export const DEFAULT_STOCK_LIST = 'COVID_19';

// Storage key for custom lists
const CUSTOM_STOCK_LISTS_KEY = 'keo_stonks_custom_stock_lists';

// Get custom lists from localStorage
const getCustomLists = () => {
  try {
    const saved = localStorage.getItem(CUSTOM_STOCK_LISTS_KEY);
    if (saved) {
      const customLists = JSON.parse(saved);
      return customLists.reduce((acc, list) => {
        acc[list.id] = {
          name: list.name,
          description: list.description,
          stocks: list.stocks,
          color: list.color,
          isCustom: true
        };
        return acc;
      }, {});
    }
  } catch (error) {
    console.error('Failed to load custom lists:', error);
  }
  return {};
};

// Helper functions
export const getStockList = listId => {
  // Check built-in lists first
  if (STOCK_LISTS[listId]) {
    return STOCK_LISTS[listId];
  }
  
  // Check custom lists
  const customLists = getCustomLists();
  if (customLists[listId]) {
    return customLists[listId];
  }
  
  return STOCK_LISTS[DEFAULT_STOCK_LIST];
};

export const getAllStockListIds = () => {
  const customLists = getCustomLists();
  return [...Object.keys(STOCK_LISTS), ...Object.keys(customLists)];
};

export const getAllStockLists = () => {
  const customLists = getCustomLists();
  return { ...STOCK_LISTS, ...customLists };
};

export const getStockListNames = () => {
  const allLists = getAllStockLists();
  return Object.entries(allLists).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description,
    count: config.stocks.length,
    color: config.color,
    isCustom: config.isCustom || false
  }));
};

// Validation
export const isValidStockListId = listId => {
  if (listId && Object.prototype.hasOwnProperty.call(STOCK_LISTS, listId)) {
    return true;
  }
  
  const customLists = getCustomLists();
  return listId && Object.prototype.hasOwnProperty.call(customLists, listId);
};
