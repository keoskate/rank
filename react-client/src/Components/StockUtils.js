// Stonk Utils

export const API_ENDPOINT__GET_DETAIL = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/get-detail?region=US&lang=en&symbol=';

export const API_ENDPOINT__GET_FINANCIALS = 'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v2/get-financials?symbol=';

/**
 * Get the Yahoo finance data for a given stock.
 * This is where we make the network request to fetch a given stock
 * from our Yahoo Finance API (provided by RapidAPI).
 * 
 * Note: $0 for 500 requests / month, $10 for 10,000
 * 
 * @param {string} stock - The Stock Ticker
 * @param {string} retry - By default request will try again after failing
 */
export async function getStockData(stock, fetchFinancials = false, retry = true) {
  const endPoint = API_ENDPOINT__GET_DETAIL;
  const altEndPoint = API_ENDPOINT__GET_FINANCIALS;
  console.info('Fetching Financial Data for: ' + stock);

  try {
    const results = await Promise.all([
      fetch(`${endPoint}${stock}`, {
        "method": "GET",
        "headers": {
          "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
          "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
        }
      }),
      // This will get us additional financial data, but at the cost of another network request
      // Each time we fetch we double the amount of requests... eeek!
      fetchFinancials ? fetch(`${altEndPoint}${stock}`, {
        "method": "GET",
        "headers": {
          "x-rapidapi-host": "apidojo-yahoo-finance-v1.p.rapidapi.com",
          "x-rapidapi-key": "511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b"
        }
      }) : null
    ]);


    const results1 = await results[0].json();
    const results2 = (fetchFinancials && results.length === 2) ? await results[0].json() : {};
    const mergedResults = Object.assign({}, results1, results2);
    return parseData(mergedResults);
  } catch (err) {
    if (retry) {
      // Try again...
      console.info('Error! Trying again...');
      return getStockData(stock, fetchFinancials, false);
    } else {
      console.info('(skiped) Oops there was an issue fetching this stock...');
      console.error(err);
      return [];
    }
  }
}

/** Example Data Object:
  "Rank": 0,
  "Ticker": "ZTS",
  "Company Name": "Zoetis Inc.",
  "Industry": "Medical - Drugs",
  "Price": 20.68,
  "52 Week Range": 94.02,
  "Debt / Ebitda": 0.32,
  "Net Debt": 483.86,
  "Beta": 0.97,
  "Quick Ratio": 40838.21,
  "Dividend Rate": 2699959,
  "EBITDA": 84.4,
  "EV / Ebitda": 85.97,
  "Cash": 59.73,
  "Short Term Debt": 94.02,
  "Sector Trend": 1.13,
  "PE Ratio": -1.18,
*/
export function parseData(data) {
  if (!data.quoteType || !data.quoteType.symbol) {
    return;
  }

  const formater = (value, percision) => {
    return value == null ? 0 : Number.parseFloat(value).toFixed(percision);
  };

  const formatValue = (value) => {
    return value == null ? 0 : value;
  };

  const calculateDebtEbitda = (totalDebt, ebitda) => {
    totalDebt = totalDebt == null ? 0 : totalDebt;
    ebitda = ebitda == null ? 0 : ebitda;
    const value = (totalDebt == 0 || ebitda == 0) ? 0 : totalDebt / ebitda;
    if (value == 'NaN' || value == null || value == NaN) {
      return 0;
    } else {
      return Number.parseFloat(value).toFixed(2);
    }
  };

  const calculateYearRange = () => {
    const high = data.summaryDetail.fiftyTwoWeekHigh.raw;
    const low = data.summaryDetail.fiftyTwoWeekLow.raw;

    return Number.parseFloat((high - low) / high).toFixed(2)
  };

  const calculateDiscount = () => {
    const high = data.summaryDetail.fiftyTwoWeekHigh.raw;
    const low = Number.parseFloat(data.price.regularMarketPrice.raw).toFixed(2);

    return Number.parseFloat((high - low) / high).toFixed(2)
  };

  const formatData = {
    rank: 0,

    ticker: data.quoteType.symbol,

    name: data.quoteType.shortName,

    industry: data.summaryProfile.industry,

    price: Number.parseFloat(data.price.regularMarketPrice.raw).toFixed(2),

    yearHigh: data.summaryDetail.fiftyTwoWeekHigh.raw,

    // yearRange: calculateYearRange(),

    discount: calculateDiscount(),

    debtEbitda: calculateDebtEbitda(data.financialData.totalDebt.raw, data.financialData.ebitda.raw),

    netDebt: formater(formatValue(data.financialData.totalDebt.raw) - formatValue(data.financialData.totalCash.raw), 0) || 0,

    beta: Number.parseFloat(data.summaryDetail.beta.raw || 0).toFixed(2) || 0,

    quickRatio: Number.parseFloat(data.financialData.quickRatio.raw || 0).toFixed(2) || 0,

    dividend: data.summaryDetail.dividendRate.raw || 0,

    ebitda: formater(data.financialData.ebitda.raw, 0) || 0,

    evEbitda: formater(data.defaultKeyStatistics.enterpriseToEbitda.raw, 0) || 0,

    cash: data.financialData.totalCash.raw || 0,

    // shortDebt: data.balanceSheetHistoryQuarterly.shortLongTermDebt,
    // sectorTrend: data.sectorTrend.PeRatio.raw.reduce((acc, next) => acc + next) / data.sectorTrend.PeRatio.raw.length
  };

  console.info(formatData);
  return formatData;
};



// ******** Helpers  ********** //

export function revertSortFunc(a, b, order, sortField) {   // order is desc or asc
  if (order === 'desc') {
    return a[sortField] - b[sortField];
  } else {
    return b[sortField] - a[sortField];
  }
}

export function wait(ms) {
  var start = new Date().getTime();
  var end = start;
  while (end < start + ms) {
    end = new Date().getTime();
  }
}


// ******** COLUMNS / STOCK PARAMS  ********** //

const COLUMN_SIZE = {
  small: 50,
  medium: 75,
  large: 125
};

// Configure multipliers and column headers for each data point
export const STOCK_COLUMNS = {
  // --- Rank
  "rank": {
    label: 'Rank',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined
  },
  "ticker": {
    label: 'Ticker',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined
  },
  "name": {
    label: 'Company Name',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined
  },
  "industry": {
    label: 'Industry',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 0,
    average: undefined,
    stdDev: undefined
  },
  "price": {
    label: 'Price',
    type: 'money',
    size: COLUMN_SIZE.medium,
    weight: 0.0,
    multiplier: -1,
    average: undefined,
    stdDev: undefined
  },
  "yearHigh": {
    label: '52 High',
    type: 'money',
    size: COLUMN_SIZE.medium,
    weight: 0.0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },

  // --- Year range = 0.4
  "discount": {
    label: 'Discount',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.4,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },

  // --- Debt / Ebitda = 0.15
  "debtEbitda": {
    label: 'Debt / Ebitda',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined
  },

  // --- NET DEBT = 0.15
  "netDebt": {
    label: 'Net Debt',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined
  },

  // --- BETA = 0.15
  "beta": {
    label: 'Beta',
    type: '',
    size: COLUMN_SIZE.small,
    weight: 0.15,
    multiplier: -1,
    average: undefined,
    stdDev: undefined
  },

  // --- QUICK RATIO = 0.1
  "quickRatio": {
    label: 'Quick Ratio',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.1,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },

  // --- DIV = 0.05
  "dividend": {
    label: 'Dividend Rate',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0.05,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },
  "ebitda": {
    label: 'EBITDA',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },
  "evEbitda": {
    label: 'EV / Ebitda',
    type: '',
    size: COLUMN_SIZE.medium,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },
  "cash": {
    label: 'Cash',
    type: '',
    size: COLUMN_SIZE.large,
    weight: 0,
    multiplier: 1,
    average: undefined,
    stdDev: undefined
  },
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