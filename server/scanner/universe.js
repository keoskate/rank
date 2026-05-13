/**
 * Built-in symbol universe for the probability scanner.
 *
 * Mirrors the union of STOCK_LISTS from
 * react-client/src/config/stockLists.js (server can't read localStorage
 * for custom lists, so the client posts those when present).
 *
 * Keep this in rough sync with the client config. If the lists diverge
 * the scanner just won't include the missing symbols — no crash.
 */

const BUILT_IN_LISTS = {
  COVID_19:        ['WM', 'ADSK', 'NKE', 'LSCC', 'DIS', 'LRCX', 'XRAY', 'RTX', 'YETI', 'ENPH', 'TEVA', 'MGNI', 'RUN', 'DAL', 'LRMR', 'RCL', 'SHOP', 'HIMX', 'PI', 'PENN'],
  TECH_GIANTS:     ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'NFLX', 'CRM', 'ORCL'],
  BLUE_CHIPS:      ['JNJ', 'PG', 'KO', 'PFE', 'WMT', 'JPM', 'V', 'MA', 'HD', 'MCD', 'VZ', 'T'],
  GROWTH_STOCKS:   ['ZM', 'ROKU', 'SQ', 'PYPL', 'SNAP', 'UBER', 'LYFT', 'DOCU', 'CRWD', 'OKTA'],
  ENERGY_SECTOR:   ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'OXY', 'KMI', 'WMB', 'PSX', 'VLO'],
  CUSTOM_WATCHLIST: ['AAPL', 'TSLA', 'DIS', 'SHOP', 'NVDA', 'PENN', 'ENPH', 'NKE'],
  ROBOTICS_AI:     ['RR', 'NVDA', 'PATH', 'IONQ', 'RGTI', 'QBTS', 'PLTR'],
  SEMICONDUCTOR_LEVERAGED: ['SOXX', 'SOXL', 'SOXS'],
  SEMICONDUCTOR_FULL: ['SOXX', 'SOXL', 'SOXS', 'NVDA', 'AMD', 'INTC', 'TSM', 'AVGO', 'QCOM', 'MU', 'ASML'],
};

function getDefaultUniverse() {
  const seen = new Set();
  for (const list of Object.values(BUILT_IN_LISTS)) {
    for (const symbol of list) seen.add(symbol.toUpperCase());
  }
  return Array.from(seen);
}

module.exports = {
  BUILT_IN_LISTS,
  getDefaultUniverse,
};
