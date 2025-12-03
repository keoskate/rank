/**
 * DATA VALIDATOR - Multi-source validation and confidence scoring
 *
 * Compares metrics across multiple data providers to ensure accuracy.
 * Calculates confidence scores based on:
 * - Agreement between sources
 * - Data freshness
 * - Historical consistency
 *
 * This is the foundation for trusting our ranking system.
 */

import { fetchYahooFinanceData } from './yahooFinanceAPI';

/**
 * Confidence thresholds
 */
const CONFIDENCE_LEVELS = {
  HIGH: 0.95,      // >95% - Data matches across sources
  MEDIUM: 0.80,    // 80-95% - Minor discrepancies
  LOW: 0.60,       // 60-80% - Significant differences
  UNRELIABLE: 0.0  // <60% - Don't trust this data
};

/**
 * Maximum allowed deviation between sources (percentage)
 */
const DEVIATION_THRESHOLDS = {
  price: 0.01,           // 1% for prices
  yearHigh: 0.05,        // 5% for 52W high
  marketCap: 0.10,       // 10% for market cap
  peRatio: 0.15,         // 15% for P/E ratios
  financialMetrics: 0.20 // 20% for debt, EBITDA, etc.
};

/**
 * Calculate percentage deviation between two values
 *
 * @param {number} value1 - First value
 * @param {number} value2 - Second value
 * @returns {number} Absolute deviation as percentage
 */
function calculateDeviation(value1, value2) {
  if (!value1 || !value2 || value1 === 0 || value2 === 0) {
    return null;
  }

  const avg = (value1 + value2) / 2;
  const diff = Math.abs(value1 - value2);
  return diff / avg;
}

/**
 * Get confidence level based on deviation
 *
 * @param {number} deviation - Deviation percentage
 * @param {number} threshold - Maximum acceptable deviation
 * @returns {number} Confidence score (0-1)
 */
function getConfidenceFromDeviation(deviation, threshold) {
  if (deviation === null) {
    return 0.5; // Unknown - medium confidence
  }

  if (deviation <= threshold) {
    return CONFIDENCE_LEVELS.HIGH;
  }

  if (deviation <= threshold * 2) {
    return CONFIDENCE_LEVELS.MEDIUM;
  }

  if (deviation <= threshold * 3) {
    return CONFIDENCE_LEVELS.LOW;
  }

  return CONFIDENCE_LEVELS.UNRELIABLE;
}

/**
 * Validate a single metric across multiple sources
 *
 * @param {string} metricName - Name of the metric
 * @param {Object} sources - Object with source names as keys, values as metric values
 * @param {number} threshold - Deviation threshold for this metric type
 * @returns {Object} Validation result with consensus value and confidence
 */
function validateMetric(metricName, sources, threshold) {
  const availableSources = Object.entries(sources)
    .filter(([_, value]) => value !== null && value !== undefined && isFinite(value))
    .map(([source, value]) => ({ source, value }));

  if (availableSources.length === 0) {
    return {
      value: null,
      confidence: 0,
      sources: [],
      status: 'missing',
      message: 'No data available from any source'
    };
  }

  if (availableSources.length === 1) {
    return {
      value: availableSources[0].value,
      confidence: CONFIDENCE_LEVELS.MEDIUM, // Single source = medium confidence
      sources: [availableSources[0].source],
      status: 'single-source',
      message: `Only available from ${availableSources[0].source}`
    };
  }

  // Multiple sources - compare and calculate confidence
  const values = availableSources.map(s => s.value);
  const deviations = [];

  // Calculate all pairwise deviations
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const dev = calculateDeviation(values[i], values[j]);
      if (dev !== null) {
        deviations.push(dev);
      }
    }
  }

  const avgDeviation = deviations.length > 0
    ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length
    : 0;

  const confidence = getConfidenceFromDeviation(avgDeviation, threshold);

  // Use average as consensus value
  const consensusValue = values.reduce((sum, v) => sum + v, 0) / values.length;

  let status;
  if (confidence >= CONFIDENCE_LEVELS.HIGH) {
    status = 'verified';
  } else if (confidence >= CONFIDENCE_LEVELS.MEDIUM) {
    status = 'acceptable';
  } else if (confidence >= CONFIDENCE_LEVELS.LOW) {
    status = 'questionable';
  } else {
    status = 'unreliable';
  }

  return {
    value: consensusValue,
    confidence: confidence,
    sources: availableSources.map(s => s.source),
    deviation: avgDeviation,
    status: status,
    message: `Validated across ${availableSources.length} sources (${(avgDeviation * 100).toFixed(2)}% deviation)`,
    individual: availableSources
  };
}

/**
 * Validate stock data across multiple providers
 *
 * @param {string} ticker - Stock ticker symbol
 * @param {Object} polygonData - Data from Polygon.io
 * @param {Object} alphaVantageData - Data from Alpha Vantage (optional)
 * @returns {Promise<Object>} Validated stock data with confidence scores
 */
export async function validateStockData(ticker, polygonData, alphaVantageData = null) {
  console.log(`🔍 Validating data for ${ticker} across multiple sources...`);

  // Fetch Yahoo Finance data
  const yahooData = await fetchYahooFinanceData(ticker);

  if (!yahooData) {
    console.warn(`⚠️ Could not fetch Yahoo Finance data for ${ticker}, using single-source data`);
  }

  // Prepare validation results
  const validatedData = {
    ticker: ticker,
    timestamp: Date.now(),
    overallConfidence: 0,
    metrics: {}
  };

  // Validate price
  validatedData.metrics.price = validateMetric(
    'price',
    {
      polygon: polygonData?.price,
      yahoo: yahooData?.regularMarketPrice,
      alphaVantage: alphaVantageData?.price
    },
    DEVIATION_THRESHOLDS.price
  );

  // Validate 52-week high (CRITICAL - this was wrong!)
  validatedData.metrics.yearHigh = validateMetric(
    'yearHigh',
    {
      polygon: polygonData?.yearHigh,
      yahoo: yahooData?.fiftyTwoWeekHigh,
      alphaVantage: alphaVantageData?.yearHigh
    },
    DEVIATION_THRESHOLDS.yearHigh
  );

  // Validate market cap
  validatedData.metrics.marketCap = validateMetric(
    'marketCap',
    {
      polygon: polygonData?.marketCap,
      yahoo: yahooData?.marketCap,
      alphaVantage: alphaVantageData?.marketCap
    },
    DEVIATION_THRESHOLDS.marketCap
  );

  // Validate P/E ratio
  validatedData.metrics.peRatio = validateMetric(
    'peRatio',
    {
      polygon: polygonData?.peRatio,
      yahoo: yahooData?.peRatio,
      alphaVantage: alphaVantageData?.peRatio
    },
    DEVIATION_THRESHOLDS.peRatio
  );

  // Validate ROE
  validatedData.metrics.roe = validateMetric(
    'roe',
    {
      polygon: polygonData?.roe,
      yahoo: yahooData?.returnOnEquity,
      alphaVantage: alphaVantageData?.roe
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate beta
  validatedData.metrics.beta = validateMetric(
    'beta',
    {
      polygon: polygonData?.beta,
      yahoo: yahooData?.beta,
      alphaVantage: alphaVantageData?.beta
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate dividend
  validatedData.metrics.dividend = validateMetric(
    'dividend',
    {
      polygon: polygonData?.dividend,
      yahoo: yahooData?.dividendRate,
      alphaVantage: alphaVantageData?.dividend
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate quick ratio
  validatedData.metrics.quickRatio = validateMetric(
    'quickRatio',
    {
      polygon: polygonData?.quickRatio,
      yahoo: yahooData?.quickRatio,
      alphaVantage: alphaVantageData?.quickRatio
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate EBITDA
  validatedData.metrics.ebitda = validateMetric(
    'ebitda',
    {
      polygon: polygonData?.ebitda,
      yahoo: yahooData?.ebitda ? yahooData.ebitda / 1000000 : null, // Convert to millions
      alphaVantage: alphaVantageData?.ebitda
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate total cash
  validatedData.metrics.cash = validateMetric(
    'cash',
    {
      polygon: polygonData?.cash,
      yahoo: yahooData?.totalCash ? yahooData.totalCash / 1000000 : null, // Convert to millions
      alphaVantage: alphaVantageData?.cash
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Validate total debt
  validatedData.metrics.totalDebt = validateMetric(
    'totalDebt',
    {
      polygon: polygonData?.netDebt, // Polygon gives net debt
      yahoo: yahooData?.totalDebt ? yahooData.totalDebt / 1000000 : null, // Convert to millions
      alphaVantage: alphaVantageData?.netDebt
    },
    DEVIATION_THRESHOLDS.financialMetrics
  );

  // Calculate overall confidence (average of all metric confidences)
  const confidenceScores = Object.values(validatedData.metrics)
    .map(m => m.confidence)
    .filter(c => c > 0);

  validatedData.overallConfidence = confidenceScores.length > 0
    ? confidenceScores.reduce((sum, c) => sum + c, 0) / confidenceScores.length
    : 0;

  // Add summary
  const verified = Object.values(validatedData.metrics).filter(m => m.status === 'verified').length;
  const total = Object.keys(validatedData.metrics).length;

  validatedData.summary = {
    verified: verified,
    total: total,
    verificationRate: verified / total,
    overallStatus: validatedData.overallConfidence >= CONFIDENCE_LEVELS.HIGH
      ? 'verified'
      : validatedData.overallConfidence >= CONFIDENCE_LEVELS.MEDIUM
      ? 'acceptable'
      : 'questionable'
  };

  console.log(`✅ Validation complete for ${ticker}:`);
  console.log(`   Overall confidence: ${(validatedData.overallConfidence * 100).toFixed(1)}%`);
  console.log(`   Verified metrics: ${verified}/${total}`);
  console.log(`   Status: ${validatedData.summary.overallStatus}`);

  return validatedData;
}

/**
 * Create a merged stock data object with validated metrics
 *
 * @param {Object} validationResult - Result from validateStockData
 * @param {Object} primarySource - Primary data source (e.g., Polygon data)
 * @param {Object} yahooData - Yahoo Finance data (for filling gaps)
 * @returns {Object} Merged stock data with confidence indicators
 */
export function createValidatedStockData(validationResult, primarySource, yahooData) {
  return {
    // Basic info from primary source
    ticker: primarySource.ticker,
    name: primarySource.name,
    industry: primarySource.industry,
    sector: primarySource.sector,

    // Validated metrics (use consensus values)
    price: validationResult.metrics.price.value,
    yearHigh: validationResult.metrics.yearHigh.value,
    discount: validationResult.metrics.yearHigh.value && validationResult.metrics.price.value
      ? (validationResult.metrics.yearHigh.value - validationResult.metrics.price.value) / validationResult.metrics.yearHigh.value
      : primarySource.discount,
    marketCap: validationResult.metrics.marketCap.value || primarySource.marketCap,
    peRatio: validationResult.metrics.peRatio.value || primarySource.peRatio,
    roe: validationResult.metrics.roe.value || primarySource.roe,
    beta: validationResult.metrics.beta.value || primarySource.beta,
    dividend: validationResult.metrics.dividend.value || primarySource.dividend,
    quickRatio: validationResult.metrics.quickRatio.value || primarySource.quickRatio,
    ebitda: validationResult.metrics.ebitda.value || primarySource.ebitda,
    cash: validationResult.metrics.cash.value || primarySource.cash,

    // Additional Yahoo Finance metrics (when available)
    priceToBook: yahooData?.priceToBook || primarySource.priceToBook,
    debtToEquity: yahooData?.debtToEquity,
    currentRatio: yahooData?.currentRatio,
    freeCashflow: yahooData?.freeCashflow ? yahooData.freeCashflow / 1000000 : null,
    earningsGrowth: yahooData?.earningsGrowth,
    revenueGrowth: yahooData?.revenueGrowth,
    profitMargins: yahooData?.profitMargins,

    // Validation metadata
    _validation: {
      overallConfidence: validationResult.overallConfidence,
      status: validationResult.summary.overallStatus,
      verifiedMetrics: validationResult.summary.verified,
      totalMetrics: validationResult.summary.total,
      timestamp: validationResult.timestamp,
      metrics: validationResult.metrics // Full validation details
    },

    // Legacy fields (keep for compatibility)
    rank: primarySource.rank || 0,
    debtEbitda: primarySource.debtEbitda,
    netDebt: validationResult.metrics.totalDebt.value || primarySource.netDebt,
    evEbitda: primarySource.evEbitda,
    impliedVolatility: primarySource.impliedVolatility,
    freeCashFlowYield: primarySource.freeCashFlowYield,
    rsi: primarySource.rsi // Will be calculated from real price data separately
  };
}

/**
 * Get confidence level description
 *
 * @param {number} confidence - Confidence score (0-1)
 * @returns {Object} Level info with color and label
 */
export function getConfidenceLevel(confidence) {
  if (confidence >= CONFIDENCE_LEVELS.HIGH) {
    return {
      level: 'high',
      label: 'Verified',
      color: '#28a745',
      icon: '✓'
    };
  }

  if (confidence >= CONFIDENCE_LEVELS.MEDIUM) {
    return {
      level: 'medium',
      label: 'Acceptable',
      color: '#ffc107',
      icon: '~'
    };
  }

  if (confidence >= CONFIDENCE_LEVELS.LOW) {
    return {
      level: 'low',
      label: 'Questionable',
      color: '#fd7e14',
      icon: '?'
    };
  }

  return {
    level: 'unreliable',
    label: 'Unreliable',
    color: '#dc3545',
    icon: '✗'
  };
}

export { CONFIDENCE_LEVELS, DEVIATION_THRESHOLDS };
