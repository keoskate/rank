/**
 * STOCK LISTS CONFIGURATION
 * 
 * Simple, clean configuration for different stock lists.
 * Add new lists here and they'll automatically appear in the UI selector.
 */

// Individual stock lists
export const STOCK_LISTS = {
  COVID_19: {
    name: "COVID-19 Recovery Stocks",
    description: "20 stocks from March 2020 analysis",
    stocks: [
      'WM', 'ADSK', 'NKE', 'LSCC', 'DIS', 'LRCX', 'XRAY', 'RTX', 'YETI', 'ENPH',
      'TEVA', 'MGNI', 'RUN', 'DAL', 'LRMR', 'RCL', 'SHOP', 'HIMX', 'PI', 'PENN'
    ],
    color: '#e74c3c' // Red
  },
  
  TECH_GIANTS: {
    name: "Tech Giants",
    description: "Major technology companies",
    stocks: [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'NFLX', 'CRM', 'ORCL'
    ],
    color: '#3498db' // Blue
  },
  
  BLUE_CHIPS: {
    name: "Blue Chip Stocks",
    description: "Large-cap, established companies",
    stocks: [
      'JNJ', 'PG', 'KO', 'PFE', 'WMT', 'JPM', 'V', 'MA', 'HD', 'MCD', 'VZ', 'T'
    ],
    color: '#2ecc71' // Green
  },
  
  GROWTH_STOCKS: {
    name: "Growth Stocks",
    description: "High-growth potential companies",
    stocks: [
      'ZM', 'ROKU', 'SQ', 'PYPL', 'SNAP', 'UBER', 'LYFT', 'DOCU', 'CRWD', 'OKTA'
    ],
    color: '#9b59b6' // Purple
  },
  
  ENERGY_SECTOR: {
    name: "Energy Sector",
    description: "Oil, gas, and renewable energy",
    stocks: [
      'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY', 'KMI', 'WMB', 'PSX', 'VLO'
    ],
    color: '#f39c12' // Orange
  },
  
  CUSTOM_WATCHLIST: {
    name: "Custom Watchlist",
    description: "User-defined custom selection",
    stocks: [
      'AAPL', 'TSLA', 'DIS', 'SHOP', 'NVDA', 'PENN', 'ENPH', 'NKE'
    ],
    color: '#1abc9c' // Teal
  }
};

// Default stock list (can be changed)
export const DEFAULT_STOCK_LIST = 'COVID_19';

// Helper functions
export const getStockList = (listId) => {
  return STOCK_LISTS[listId] || STOCK_LISTS[DEFAULT_STOCK_LIST];
};

export const getAllStockListIds = () => {
  return Object.keys(STOCK_LISTS);
};

export const getAllStockLists = () => {
  return STOCK_LISTS;
};

export const getStockListNames = () => {
  return Object.entries(STOCK_LISTS).map(([id, config]) => ({
    id,
    name: config.name,
    description: config.description,
    count: config.stocks.length,
    color: config.color
  }));
};

// Validation
export const isValidStockListId = (listId) => {
  return listId && STOCK_LISTS.hasOwnProperty(listId);
};