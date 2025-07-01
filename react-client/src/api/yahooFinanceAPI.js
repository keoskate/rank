/**
 * YAHOO FINANCE API (LEGACY) - Deprecated Financial Data Integration
 * 
 * ⚠️ WARNING: This API is deprecated and should not be used for new development.
 * It's kept here for reference and potential fallback scenarios only.
 * 
 * ISSUES:
 * - Only 500 requests per month (vs 500 per day with Alpha Vantage)
 * - Frequent timeouts and reliability issues
 * - Complex stream reading required
 * - Hardcoded API keys (security risk)
 * - No longer actively maintained
 * 
 * USE: alphaVantageAPI.js instead for new development
 */

const API_ENDPOINT__GET_SUMMARY =
  'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v3/get-summary?region=US&lang=en&symbol=';

const API_ENDPOINT__GET_DETAIL =
  'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/get-detail?region=US&lang=en&symbol=';

const API_ENDPOINT__GET_FINANCIALS =
  'https://apidojo-yahoo-finance-v1.p.rapidapi.com/stock/v2/get-financials?symbol=';

/**
 * @deprecated Use alphaVantageAPI.getStockData() instead
 * 
 * Get the Yahoo finance data for a given stock.
 * This is where we make the network request to fetch a given stock
 * from our Yahoo Finance API (provided by RapidAPI).
 *
 * Note: $0 for 500 requests / month, $10 for 10,000
 *
 * @param {string} stock - The Stock Ticker
 * @param {string} retry - By default request will try again after failing
 */
export async function getStockDataLegacy(
  stock,
  fetchFinancials = false,
  retry = false
) {
  console.warn('⚠️ Using deprecated Yahoo Finance API. Consider switching to Alpha Vantage.');
  
  const endPoint = API_ENDPOINT__GET_SUMMARY;
  const altEndPoint = API_ENDPOINT__GET_FINANCIALS;
  console.info('Fetching Financial Data for: ' + stock);

  try {
    // Make API requests
    const results = await Promise.all([
      fetch(`${endPoint}${stock}`, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': 'apidojo-yahoo-finance-v1.p.rapidapi.com',
          'x-rapidapi-key': process.env.RAPIDAPI_KEY || '511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b',
        },
      }),
      fetchFinancials
        ? fetch(`${altEndPoint}${stock}`, {
            method: 'GET',
            headers: {
              'x-rapidapi-host': 'apidojo-yahoo-finance-v1.p.rapidapi.com',
              'x-rapidapi-key': process.env.RAPIDAPI_KEY || '511813387amsh6e1ae8b9aaa13a4p19b849jsnfafad5e8440b',
            },
          })
        : Promise.resolve(null),
    ]);

    // Get data from main endpoint
    let mainData = {};
    if (results[0] && results[0].ok) {
      try {
        // Try direct approach first with simple error handling
        const reader = results[0].body.getReader();
        let rawData = '';
        const decoder = new TextDecoder();

        // Read the stream chunk by chunk
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawData += decoder.decode(value, { stream: true });
        }
        // Final flush
        rawData += decoder.decode();

        // Handle empty response
        if (!rawData || rawData.trim() === '') {
          console.warn('Empty response from main endpoint');
        } else {
          try {
            mainData = JSON.parse(rawData);
          } catch (jsonError) {
            console.warn('Failed to parse main response JSON');
            // Return empty object in case of parse failure
          }
        }
      } catch (readError) {
        console.error('Error reading main response:', readError);
      }
    }

    // Get data from financial endpoint
    let financialData = {};
    if (fetchFinancials && results[1] && results[1].ok) {
      try {
        // Use the same stream reading approach for consistency
        const reader = results[1].body.getReader();
        let rawData = '';
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawData += decoder.decode(value, { stream: true });
        }
        // Final flush
        rawData += decoder.decode();

        if (!rawData || rawData.trim() === '') {
          console.warn('Empty response from financial endpoint');
        } else {
          try {
            financialData = JSON.parse(rawData);
          } catch (jsonError) {
            console.warn('Failed to parse financial response JSON');
          }
        }
      } catch (readError) {
        console.error('Error reading financial response:', readError);
      }
    }

    // Merge results and return
    const mergedResults = Object.assign({}, mainData, financialData);
    return parseDataLegacy(mergedResults);
  } catch (err) {
    if (retry) {
      // Try again only once
      console.info('Error! Trying again...');
      return getStockDataLegacy(stock, fetchFinancials, false);
    } else {
      console.info('(skipped) Oops there was an issue fetching this stock...');
      console.error(err);
      return [];
    }
  }
}

/**
 * @deprecated Use alphaVantageAPI.parseData() instead
 */
export function parseDataLegacy(data) {
  if (!data.quoteType || !data.quoteType.symbol) {
    return;
  }

  const formater = (value, percision) => {
    return value == null ? 0 : Number.parseFloat(value).toFixed(percision);
  };

  const formatValue = value => {
    return value == null ? 0 : value;
  };

  const calculateDebtEbitda = (totalDebt, ebitda) => {
    totalDebt = totalDebt == null ? 0 : totalDebt;
    ebitda = ebitda == null ? 0 : ebitda;
    const value = totalDebt == 0 || ebitda == 0 ? 0 : totalDebt / ebitda;
    if (value == 'NaN' || value == null || value == NaN) {
      return 0;
    } else {
      return Number.parseFloat(value).toFixed(2);
    }
  };

  const calculateYearRange = () => {
    const high = data.summaryDetail.fiftyTwoWeekHigh.raw;
    const low = data.summaryDetail.fiftyTwoWeekLow.raw;

    return Number.parseFloat((high - low) / high).toFixed(2);
  };

  const calculateDiscount = () => {
    const high = data.summaryDetail.fiftyTwoWeekHigh.raw;
    const low = Number.parseFloat(data.price.regularMarketPrice.raw).toFixed(2);

    return Number.parseFloat((high - low) / high).toFixed(2);
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

    debtEbitda: calculateDebtEbitda(
      data.financialData.totalDebt.raw,
      data.financialData.ebitda.raw
    ),

    netDebt:
      formater(
        formatValue(data.financialData.totalDebt.raw) -
          formatValue(data.financialData.totalCash.raw),
        0
      ) || 0,

    beta: Number.parseFloat(data.summaryDetail.beta.raw || 0).toFixed(2) || 0,

    quickRatio:
      Number.parseFloat(data.financialData.quickRatio.raw || 0).toFixed(2) || 0,

    dividend: data.summaryDetail.dividendRate.raw || 0,

    ebitda: formater(data.financialData.ebitda.raw, 0) || 0,

    evEbitda:
      formater(data.defaultKeyStatistics.enterpriseToEbitda.raw, 0) || 0,

    cash: data.financialData.totalCash.raw || 0,

    // cap: data.summaryDetail.marketCap.raw || 0,

    // shortDebt: data.balanceSheetHistoryQuarterly.shortLongTermDebt,
    // sectorTrend: data.sectorTrend.PeRatio.raw.reduce((acc, next) => acc + next) / data.sectorTrend.PeRatio.raw.length
  };

  console.info(formatData);
  return formatData;
}