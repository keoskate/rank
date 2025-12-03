/**
 * STOCK DETAIL PAGE - Comprehensive individual stock analysis
 *
 * Features:
 * - Complete stock metrics with color-coded relative ranking
 * - Interactive price charts with multiple timeframes
 * - Historical timeline for key metrics
 * - Professional financial analysis layout
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStockData } from './StockDataProvider';
import { getCacheInfo } from '../utils/cacheManager';
import {
  loadChartPreferences,
  updateChartPreference,
} from '../utils/chartPreferences';
import { getStockHistoricalData } from './StockUtils';
import {
  calculateRSI,
  calculateIntradayRSI,
  getCurrentRSI,
  validateRSI,
} from '../utils/technicalIndicators';
import DataQualityBadge from './DataQualityBadge';
import { getValidatedStockData } from '../api/unifiedAPI';
import MetricCorrelationChart from './MetricCorrelationChart';

// Mini chart component for metric cards
const MiniChart = ({ data, selectedTimeframe, metricKey, isRealData }) => {
  if (!data || data.length === 0) return null;

  const width = 120;
  const height = 40;
  const padding = 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1;

  // Generate path for the mini line
  const pathData = data.map((value, index) => {
    const x =
      padding +
      (data.length > 1
        ? (index / (data.length - 1)) * plotWidth
        : plotWidth / 2);
    const y = padding + (1 - (value - minValue) / range) * plotHeight;
    return { x, y, value };
  });

  const pathString = pathData
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  // Determine if trend is positive
  const isPositive = data[data.length - 1] > data[0];
  const strokeColor = isPositive ? '#28a745' : '#dc3545';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        margin: '8px 0',
      }}
    >
      <svg
        width={width}
        height={height}
        style={{
          backgroundColor: 'rgba(255,255,255,0.9)',
          borderRadius: '4px',
          border: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        {/* Mini line chart */}
        <path
          d={pathString}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.5"
          opacity="0.8"
        />

        {/* Start and end points */}
        <circle
          cx={pathData[0]?.x}
          cy={pathData[0]?.y}
          r="1.5"
          fill={strokeColor}
          opacity="0.6"
        />
        <circle
          cx={pathData[pathData.length - 1]?.x}
          cy={pathData[pathData.length - 1]?.y}
          r="1.5"
          fill={strokeColor}
        />

        {/* Real data indicator */}
        {isRealData && (
          <circle
            cx={width - 8}
            cy={8}
            r="3"
            fill="#007bff"
            opacity="0.8"
            title="Real historical data"
          />
        )}
      </svg>
    </div>
  );
};

// Professional time series chart component
const TimeSeriesChart = ({ data, labels, title, selectedMetric, onHover }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  if (!data || !labels || data.length === 0 || labels.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fa',
          border: '1px solid #dee2e6',
          borderRadius: '4px',
        }}
      >
        <div style={{ textAlign: 'center', color: '#6c757d' }}>
          <div>📊</div>
          <div>No chart data available</div>
        </div>
      </div>
    );
  }

  // Filter out invalid data points
  const validData = data.filter(
    d => d !== null && d !== undefined && isFinite(d)
  );
  if (validData.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fa',
          border: '1px solid #dee2e6',
          borderRadius: '4px',
        }}
      >
        <div style={{ textAlign: 'center', color: '#6c757d' }}>
          <div>⚠️</div>
          <div>Invalid chart data</div>
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...validData);
  const minValue = Math.min(...validData);
  const range = maxValue - minValue || Math.abs(maxValue) * 0.1 || 1; // Prevent division by zero
  const padding = { top: 20, right: 40, bottom: 40, left: 60 };
  const chartWidth = 800;
  const chartHeight = 300;
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Calculate path for the line with validation
  const pathData = data
    .map((value, index) => {
      // Ensure value is valid for calculations
      const safeValue =
        value !== null && value !== undefined && isFinite(value)
          ? value
          : (minValue + maxValue) / 2;

      const x =
        padding.left + (index / Math.max(1, data.length - 1)) * plotWidth;
      const y = padding.top + (1 - (safeValue - minValue) / range) * plotHeight;
      return {
        x: isFinite(x) ? x : padding.left,
        y: isFinite(y) ? y : padding.top + plotHeight / 2,
        value: safeValue,
        label: labels[index] || new Date().toISOString(),
        index,
      };
    })
    .filter(
      point => point.x >= padding.left && point.x <= chartWidth - padding.right
    );

  // Create a smooth curve using bezier curves
  const createSmoothPath = points => {
    if (points.length < 2) return '';

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      if (i === 1) {
        // First segment - use quadratic curve
        const cpx = prev.x + (curr.x - prev.x) * 0.5;
        const cpy = prev.y;
        path += ` Q ${cpx} ${cpy} ${curr.x} ${curr.y}`;
      } else {
        // Smooth cubic bezier curves
        const prevPrev = points[i - 2];
        const next = points[i + 1] || curr;

        // Control points for smooth curve
        const cp1x = prev.x + (curr.x - prevPrev.x) * 0.2;
        const cp1y = prev.y + (curr.y - prevPrev.y) * 0.2;
        const cp2x = curr.x - (next.x - prev.x) * 0.2;
        const cp2y = curr.y - (next.y - prev.y) * 0.2;

        path += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${curr.x} ${curr.y}`;
      }
    }

    return path;
  };

  const pathString = createSmoothPath(pathData);

  const handleMouseMove = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    setMousePosition({ x: event.clientX, y: event.clientY });

    // Find closest point
    const closestPoint = pathData.reduce((closest, point) => {
      const distance = Math.abs(point.x - mouseX);
      return distance < Math.abs(closest.x - mouseX) ? point : closest;
    });

    setHoveredPoint(closestPoint);
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  // Format value based on metric type with robust error handling
  const formatValue = value => {
    if (value === null || value === undefined || value === '') {
      return 'N/A';
    }

    const numValue = Number(value);

    if (isNaN(numValue) || !isFinite(numValue)) {
      return 'N/A';
    }

    // Handle extremely small numbers that might display as 0
    if (Math.abs(numValue) < 0.0001 && numValue !== 0) {
      return numValue.toExponential(2);
    }

    if (selectedMetric === 'price') {
      return `$${numValue.toFixed(2)}`;
    }

    if (selectedMetric.includes('Ratio') || selectedMetric === 'beta') {
      return numValue.toFixed(2);
    }

    if (
      selectedMetric.includes('percentage') ||
      selectedMetric === 'roe' ||
      selectedMetric === 'impliedVolatility'
    ) {
      return `${(numValue * 100).toFixed(2)}%`;
    }

    if (typeof numValue === 'number' && numValue > 1000) {
      return numValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    return numValue.toFixed(2);
  };

  // Generate grid lines
  const gridLines = [];
  const numGridLines = 5;
  for (let i = 0; i <= numGridLines; i++) {
    const y = padding.top + (i / numGridLines) * plotHeight;
    const value = maxValue - (i / numGridLines) * range;
    gridLines.push({ y, value });
  }

  return (
    <div style={{ width: '100%', height: '400px', position: 'relative' }}>
      <h4
        style={{ textAlign: 'center', margin: '0 0 20px 0', color: '#2c3e50' }}
      >
        {title}
      </h4>

      <svg
        width={chartWidth}
        height={chartHeight}
        style={{
          border: '1px solid #e0e6ed',
          backgroundColor: '#ffffff',
          borderRadius: '4px',
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Grid lines */}
        {gridLines.map((line, index) => (
          <g key={index}>
            <line
              x1={padding.left}
              y1={line.y}
              x2={chartWidth - padding.right}
              y2={line.y}
              stroke="#f1f3f4"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={line.y + 4}
              fontSize="11"
              fill="#6c757d"
              textAnchor="end"
            >
              {formatValue(line.value)}
            </text>
          </g>
        ))}

        {/* X-axis */}
        <line
          x1={padding.left}
          y1={chartHeight - padding.bottom}
          x2={chartWidth - padding.right}
          y2={chartHeight - padding.bottom}
          stroke="#dee2e6"
          strokeWidth="1"
        />

        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={chartHeight - padding.bottom}
          stroke="#dee2e6"
          strokeWidth="1"
        />

        {/* Area fill under the line */}
        <path
          d={`${pathString} L ${chartWidth - padding.right} ${chartHeight - padding.bottom} L ${padding.left} ${chartHeight - padding.bottom} Z`}
          fill="url(#gradient)"
          opacity="0.3"
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#007bff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#007bff" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Main line */}
        <path
          d={pathString}
          fill="none"
          stroke="#007bff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Invisible overlay for hover detection */}
        <rect
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
        />

        {/* Hovered point highlight */}
        {hoveredPoint && (
          <>
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="6"
              fill="#007bff"
              stroke="#ffffff"
              strokeWidth="3"
            />
            <line
              x1={hoveredPoint.x}
              y1={padding.top}
              x2={hoveredPoint.x}
              y2={chartHeight - padding.bottom}
              stroke="#007bff"
              strokeWidth="1"
              strokeDasharray="4,4"
              opacity="0.5"
            />
          </>
        )}

        {/* X-axis labels */}
        {pathData
          .filter((_, index) => index % Math.ceil(pathData.length / 6) === 0)
          .map((point, index) => (
            <text
              key={index}
              x={point.x}
              y={chartHeight - padding.bottom + 15}
              fontSize="11"
              fill="#6c757d"
              textAnchor="middle"
            >
              {new Date(point.label).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </text>
          ))}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: 'fixed',
            left: mousePosition.x + 10,
            top: mousePosition.y - 10,
            backgroundColor: '#2c3e50',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: '500',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '200px',
          }}
        >
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>
            {new Date(hoveredPoint.label).toLocaleDateString()}
          </div>
          <div>
            {selectedMetric === 'price' ? 'Price' : selectedMetric}:{' '}
            {formatValue(hoveredPoint.value)}
          </div>
        </div>
      )}
    </div>
  );
};

const StockDetailPage = () => {
  const {
    stockData: allStockData,
    stockColumns,
    currentStockList,
    isLoading,
  } = useStockData();
  const { ticker } = useParams();
  const navigate = useNavigate();

  // Define which metrics are time-series appropriate (change daily/frequently)
  // vs. static/quarterly metrics that shouldn't be plotted over time
  const TIME_SERIES_METRICS = ['price', 'rsi', 'impliedVolatility'];
  const STATIC_METRICS = [
    'yearHigh', 'yearLow', 'discount', // 52W data - staircase pattern
    'peRatio', 'roe', 'priceToBook', // Quarterly updates
    'debtEbitda', 'netDebt', 'quickRatio', 'evEbitda', // Quarterly financials
    'freeCashFlowYield', 'ebitda', 'cash', // Quarterly financials
    'beta', 'dividend', 'marketCap' // Slow-moving or quarterly
  ];

  // Load saved chart preferences
  const savedPreferences = loadChartPreferences();
  const [selectedTimeframe, setSelectedTimeframe] = useState(
    savedPreferences.timeframe
  );
  const [selectedMetricChart, setSelectedMetricChart] = useState(
    savedPreferences.metric
  );
  const [loading, setLoading] = useState(true);
  const [historicalData, setHistoricalData] = useState(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [validatedStockData, setValidatedStockData] = useState(null);
  const [validationLoading, setValidationLoading] = useState(false);

  // Get cache info for data freshness
  const cacheInfo = getCacheInfo();
  const dataAge = cacheInfo?.lastFetched
    ? new Date(cacheInfo.lastFetched)
    : null;
  const isDataStale = dataAge
    ? Date.now() - dataAge.getTime() > 30 * 60 * 1000
    : false; // 30 minutes

  // Find the current stock data from cache (fallback)
  const cachedStockData = useMemo(() => {
    return allStockData.find(stock => stock.ticker === ticker);
  }, [allStockData, ticker]);

  // Fetch validated stock data when ticker changes
  useEffect(() => {
    if (!ticker) return;

    const fetchValidatedData = async () => {
      setValidationLoading(true);
      try {
        console.log(`🔍 Fetching validated data for ${ticker}...`);
        const validated = await getValidatedStockData(ticker);
        if (validated) {
          console.log(`✅ Validated data loaded for ${ticker}`);
          setValidatedStockData(validated);
        }
      } catch (error) {
        console.error(`❌ Error fetching validated data for ${ticker}:`, error);
      } finally {
        setValidationLoading(false);
      }
    };

    fetchValidatedData();
  }, [ticker]);

  // Use validated data if available, otherwise fall back to cached data
  const stockData = validatedStockData || cachedStockData;

  // Use real company data from stockData
  const companyMetadata = useMemo(() => {
    if (!ticker || !stockData) return {};

    // Use the actual company name from the stock data
    const companyName = stockData.name || ticker;

    // Get sector and industry from stock data or use defaults
    const sector = stockData.sector || stockData.industry || 'Technology';
    const industry = stockData.subIndustry || stockData.industry || 'Software';

    // Calculate founded year from list date if available
    const foundedYear = stockData?.listDate
      ? new Date(stockData.listDate).getFullYear()
      : null;

    // Generate reasonable earnings date (next quarter) - this is always estimated
    const nextEarnings = new Date();
    const currentQuarter = Math.floor((nextEarnings.getMonth() + 3) / 3);
    const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
    const nextYear =
      currentQuarter === 4
        ? nextEarnings.getFullYear() + 1
        : nextEarnings.getFullYear();
    nextEarnings.setFullYear(nextYear);
    nextEarnings.setMonth((nextQuarter - 1) * 3 + 1); // Set to middle month of quarter
    nextEarnings.setDate(15); // Mid-month

    // Determine exchange from ticker (basic heuristics)
    const getExchange = ticker => {
      // Some basic patterns - this is still estimated since exchange isn't in API
      if (ticker.length > 4) return 'NASDAQ';
      if (
        [
          'AAPL',
          'MSFT',
          'GOOGL',
          'GOOG',
          'AMZN',
          'TSLA',
          'META',
          'NVDA',
        ].includes(ticker)
      )
        return 'NASDAQ';
      return 'NYSE'; // Default assumption
    };

    return {
      name: companyName,
      sector: sector,
      industry: industry,
      earningsDate: nextEarnings,
      // Use REAL data from API when available, null when not available (no fake data!)
      marketCap: stockData?.marketCap || null,
      employees: stockData?.employees || null,
      founded: foundedYear,
      exchange: getExchange(ticker), // Still estimated, but using better heuristics
      description: stockData?.description || null,
    };
  }, [ticker, stockData]);

  // Calculate relative rankings for color coding
  const relativeRankings = useMemo(() => {
    if (!stockData || allStockData.length === 0) return {};

    const rankings = {};

    Object.keys(stockColumns).forEach(key => {
      if (
        stockColumns[key].multiplier !== 0 &&
        key !== 'rank' &&
        key !== 'ticker'
      ) {
        const values = allStockData
          .map(stock => stock[key])
          .filter(val => val !== null && val !== undefined && !isNaN(val))
          .sort((a, b) => (stockColumns[key].multiplier === 1 ? b - a : a - b));

        const stockValue = stockData[key];
        if (
          stockValue !== null &&
          stockValue !== undefined &&
          !isNaN(stockValue)
        ) {
          const rank = values.indexOf(stockValue) + 1;
          const percentile = ((values.length - rank + 1) / values.length) * 100;

          rankings[key] = {
            rank,
            percentile,
            total: values.length,
            isGood:
              stockColumns[key].multiplier === 1
                ? percentile > 50
                : percentile < 50,
          };
        }
      }
    });

    return rankings;
  }, [stockData, allStockData, stockColumns]);

  // Generate realistic historical data that works backwards from current real values
  const generateHistoricalData = useMemo(() => {
    if (!stockData) return null;

    // Calculate trading days (excluding weekends)
    const getTradingDays = timeframe => {
      const tradingDaysPerWeek = 5; // Monday-Friday
      const totalWeeks = {
        '1W': 1,
        '1M': 4.33, // ~4.33 weeks in a month
        '3M': 13, // ~13 weeks in 3 months
        '6M': 26, // ~26 weeks in 6 months
        '52W': 52, // 52 weeks in a year
        YTD: Math.floor(
          (new Date() - new Date(new Date().getFullYear(), 0, 1)) /
            (1000 * 60 * 60 * 24 * 7)
        ),
      };

      return Math.floor(totalWeeks[timeframe] * tradingDaysPerWeek);
    };

    const tradingDays = getTradingDays(selectedTimeframe);
    const currentValue = stockData[selectedMetricChart] || stockData.price;

    // Safety checks for invalid data
    if (!currentValue || !isFinite(currentValue) || currentValue <= 0) {
      console.warn('Invalid current value for chart generation:', currentValue);
      return { labels: [], data: [] };
    }

    if (!tradingDays || tradingDays <= 0) {
      console.warn('Invalid trading days for chart generation:', tradingDays);
      return { labels: [], data: [] };
    }

    // Industry-standard Geometric Brownian Motion (GBM) parameters
    const getGBMParameters = (timeframe, metricType) => {
      // Base parameters for different timeframes (annualized)
      const baseParams = {
        '1W': { mu: 0.0, sigma: 0.15 }, // Weekly: neutral drift, moderate volatility
        '1M': { mu: 0.05, sigma: 0.2 }, // Monthly: slight upward bias
        '3M': { mu: 0.08, sigma: 0.25 }, // Quarterly: moderate upward bias
        '6M': { mu: 0.1, sigma: 0.3 }, // Semi-annual: higher volatility
        '52W': { mu: 0.12, sigma: 0.35 }, // Annual: strong trend potential
        YTD: { mu: 0.08, sigma: 0.25 }, // YTD: moderate parameters
      };

      const params = baseParams[timeframe] || baseParams['3M'];

      // Adjust parameters based on metric type
      if (metricType === 'price') {
        // Price data: standard GBM parameters
        return params;
      } else if (metricType === 'rsi') {
        // RSI: mean-reverting with bounds
        return { mu: 0.0, sigma: 0.1 };
      } else if (metricType === 'impliedVolatility') {
        // IV: high volatility with spikes
        return { mu: 0.0, sigma: 0.4 };
      } else {
        // Other financial metrics: lower volatility
        return { mu: params.mu * 0.5, sigma: params.sigma * 0.6 };
      }
    };

    const { mu, sigma } = getGBMParameters(
      selectedTimeframe,
      selectedMetricChart
    );

    // Generate deterministic but realistic random sequence
    const tickerHash = ticker
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const metricHash = selectedMetricChart
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seed = (tickerHash + metricHash) % 10000;

    // Linear Congruential Generator for deterministic randomness
    let randomSeed = seed;
    const nextRandom = () => {
      randomSeed = (randomSeed * 9301 + 49297) % 233280;
      return randomSeed / 233280;
    };

    // Box-Muller transform for normal distribution
    let hasSpareGaussian = false;
    let spareGaussian = 0;

    const generateGaussian = () => {
      if (hasSpareGaussian) {
        hasSpareGaussian = false;
        return spareGaussian;
      }

      hasSpareGaussian = true;

      const u = nextRandom();
      const v = nextRandom();

      const mag = sigma * Math.sqrt(-2.0 * Math.log(u));
      spareGaussian = mag * Math.cos(2.0 * Math.PI * v);

      return mag * Math.sin(2.0 * Math.PI * v);
    };

    // Calculate time step (dt) in years
    const timeframeDays = {
      '1W': 7,
      '1M': 30,
      '3M': 90,
      '6M': 180,
      '52W': 365,
      YTD: Math.floor(
        (new Date() - new Date(new Date().getFullYear(), 0, 1)) /
          (1000 * 60 * 60 * 24)
      ),
    };

    const totalDays = timeframeDays[selectedTimeframe] || 90;
    const dt = totalDays / 365.0 / tradingDays; // Time step in years

    // Calculate starting value (reasonable historical range)
    const getStartingValue = (currentVal, timeframe) => {
      const typicalRanges = {
        '1W': [0.95, 1.05], // ±5% for 1 week
        '1M': [0.9, 1.1], // ±10% for 1 month
        '3M': [0.85, 1.15], // ±15% for 3 months
        '6M': [0.8, 1.25], // ±20% for 6 months
        '52W': [0.7, 1.4], // ±30% for 1 year
        YTD: [0.85, 1.15], // ±15% for YTD
      };

      const [minFactor, maxFactor] = typicalRanges[timeframe] || [0.85, 1.15];
      const randomFactor = minFactor + nextRandom() * (maxFactor - minFactor);
      return currentVal * randomFactor;
    };

    const startingValue = getStartingValue(currentValue, selectedTimeframe);

    // Generate data using Geometric Brownian Motion
    const data = [];
    const labels = [];

    let currentPrice = startingValue;

    for (let day = 0; day < tradingDays; day++) {
      // Calculate date for this trading day
      const daysAgo = tradingDays - day - 1;
      const currentDate = new Date();
      const tradingDate = new Date(currentDate);
      let skippedDays = 0;

      for (let i = 0; i < daysAgo + skippedDays; i++) {
        tradingDate.setDate(tradingDate.getDate() - 1);
        // Skip weekends
        while (tradingDate.getDay() === 0 || tradingDate.getDay() === 6) {
          tradingDate.setDate(tradingDate.getDate() - 1);
          skippedDays++;
        }
      }

      if (selectedMetricChart === 'price' || selectedMetricChart === 'rsi') {
        // For price data and RSI, generate open and close prices
        const z1 = generateGaussian();
        const z2 = generateGaussian();

        // Geometric Brownian Motion: S(t+dt) = S(t) * exp((mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*z)
        const drift = (mu - 0.5 * sigma * sigma) * dt;
        const diffusion = sigma * Math.sqrt(dt) * z1;
        const priceChange = Math.exp(drift + diffusion);

        currentPrice = currentPrice * priceChange;

        // Generate intraday variation for open/close
        const intradayVol = sigma * 0.1; // Much smaller intraday volatility
        const openAdjustment = Math.exp(intradayVol * Math.sqrt(dt) * z2);

        const openPrice = currentPrice * openAdjustment;
        const closePrice = currentPrice;

        // Opening timestamp (9:30 AM)
        const openTimestamp = new Date(tradingDate);
        openTimestamp.setHours(9, 30, 0, 0);

        // Closing timestamp (4:00 PM)
        const closeTimestamp = new Date(tradingDate);
        closeTimestamp.setHours(16, 0, 0, 0);

        data.push(openPrice);
        labels.push(openTimestamp.toISOString());

        data.push(closePrice);
        labels.push(closeTimestamp.toISOString());
      } else {
        // For non-price, non-RSI metrics, generate single daily value
        tradingDate.setHours(16, 0, 0, 0);

        let dataPoint;

        if (selectedMetricChart === 'impliedVolatility') {
          // IV: GBM with occasional volatility spikes
          const z = generateGaussian();
          const drift = (mu - 0.5 * sigma * sigma) * dt;
          const diffusion = sigma * Math.sqrt(dt) * z;

          // Add volatility spikes (5% chance per day)
          const spike = nextRandom() > 0.95 ? 0.05 : 0;

          currentPrice = currentPrice * Math.exp(drift + diffusion + spike);
          currentPrice = Math.max(0.05, Math.min(1.0, currentPrice)); // Bound IV between 5% and 100%
          dataPoint = currentPrice;
        } else {
          // Other financial metrics: Modified GBM with bounds
          const z = generateGaussian();
          const drift = (mu - 0.5 * sigma * sigma) * dt;
          const diffusion = sigma * Math.sqrt(dt) * z;

          currentPrice = currentPrice * Math.exp(drift + diffusion);

          // Apply reasonable bounds based on starting value
          const maxBound = startingValue * 3.0;
          const minBound = startingValue * 0.3;
          currentPrice = Math.max(minBound, Math.min(maxBound, currentPrice));

          dataPoint = currentPrice;
        }

        data.push(dataPoint);
        labels.push(tradingDate.toISOString());
      }
    }

    // Calculate RSI from generated price data if RSI metric is selected
    if (selectedMetricChart === 'rsi') {
      console.log('📊 Calculating RSI from generated price data...');
      const rsiValues = calculateIntradayRSI(data, labels, 14);
      const validRSI = validateRSI(rsiValues);

      // Replace price data with RSI data
      return { labels, data: validRSI };
    }

    // REMOVED: No more forced ending values - charts end naturally where GBM leads
    // This eliminates the artificial drop-off issue

    return { labels, data };
  }, [stockData, selectedTimeframe, selectedMetricChart, ticker]);

  // Fetch real historical data when ticker, timeframe, or metric changes
  useEffect(() => {
    let isCancelled = false;

    const fetchHistoricalData = async () => {
      if (!ticker || selectedMetricChart !== 'price') {
        // Only fetch historical data for price charts
        // For other metrics, continue using generated data (for now)
        setHistoricalData(null);
        return;
      }

      setHistoricalLoading(true);
      try {
        console.log(
          `🔄 Fetching real historical data for ${ticker} (${selectedTimeframe})`
        );
        const data = await getStockHistoricalData(ticker, selectedTimeframe);

        if (!isCancelled) {
          if (data && data.labels && data.data && data.data.length > 0) {
            console.log(
              `✅ Loaded ${data.data.length} historical data points for ${ticker}`
            );
            setHistoricalData(data);
          } else {
            console.warn(
              `⚠️ No historical data available for ${ticker}, using generated data`
            );
            setHistoricalData(null);
          }
        }
      } catch (error) {
        if (!isCancelled) {
          console.error(
            `❌ Failed to fetch historical data for ${ticker}:`,
            error
          );
          setHistoricalData(null);
        }
      } finally {
        if (!isCancelled) {
          setHistoricalLoading(false);
        }
      }
    };

    if (ticker) {
      fetchHistoricalData();
    }

    // Cleanup function to cancel pending requests
    return () => {
      isCancelled = true;
    };
  }, [ticker, selectedTimeframe, selectedMetricChart]);

  // Use real historical data for price charts, calculated RSI from real prices, or generated data
  const chartData = useMemo(() => {
    if (selectedMetricChart === 'price' && historicalData) {
      // Use real historical price data
      return historicalData;
    } else if (
      selectedMetricChart === 'rsi' &&
      historicalData &&
      historicalData.data &&
      historicalData.data.length > 15
    ) {
      // Calculate RSI from real historical price data
      console.log('📊 Calculating RSI from real historical price data...');
      const rsiValues = calculateIntradayRSI(
        historicalData.data,
        historicalData.labels,
        14
      );
      const validRSI = validateRSI(rsiValues);
      return {
        labels: historicalData.labels,
        data: validRSI,
      };
    } else {
      // Use generated data for other metrics or when real data unavailable
      return generateHistoricalData;
    }
  }, [selectedMetricChart, historicalData, generateHistoricalData]);

  // Smart mini chart data - real data for price and RSI, generated for others
  const getMiniChartInfo = metricKey => {
    try {
      if (
        metricKey === 'price' &&
        historicalData &&
        historicalData.data &&
        historicalData.data.length > 0
      ) {
        // Use real historical data for price mini charts, but sample it down for performance
        const realData = historicalData.data.filter(
          val =>
            val !== null && val !== undefined && isFinite(val) && !isNaN(val)
        );

        if (realData.length === 0) {
          return { data: generateMiniChartData(metricKey), isRealData: false };
        }

        let sampledData;
        if (realData.length <= 30) {
          sampledData = realData;
        } else {
          // Sample down to ~20-25 points for mini chart performance
          const step = Math.max(1, Math.floor(realData.length / 20));
          sampledData = realData.filter((_, index) => index % step === 0);
        }
        return { data: sampledData, isRealData: true };
      } else if (
        metricKey === 'rsi' &&
        historicalData &&
        historicalData.data &&
        historicalData.data.length > 15
      ) {
        // Calculate RSI from real historical price data for mini chart
        const rsiValues = calculateRSI(historicalData.data, 14);
        const validRSI = validateRSI(rsiValues).filter(val => val !== null);

        if (validRSI.length === 0) {
          return { data: generateMiniChartData(metricKey), isRealData: false };
        }

        // Sample down if needed
        let sampledData;
        if (validRSI.length <= 30) {
          sampledData = validRSI;
        } else {
          const step = Math.max(1, Math.floor(validRSI.length / 20));
          sampledData = validRSI.filter((_, index) => index % step === 0);
        }
        return { data: sampledData, isRealData: true };
      } else {
        // Use generated data for other metrics or when real data unavailable
        const generatedData = generateMiniChartData(metricKey);
        return { data: generatedData || [], isRealData: false };
      }
    } catch (error) {
      console.error(
        `Error generating mini chart data for ${metricKey}:`,
        error
      );
      return { data: [], isRealData: false };
    }
  };

  // Get color based on percentile ranking
  const getMetricColor = key => {
    const ranking = relativeRankings[key];
    if (!ranking) return '#ffffff';

    const percentile = ranking.percentile;
    const isGood = ranking.isGood;

    if (isGood) {
      if (percentile >= 80) return '#67c279'; // Bright green
      if (percentile >= 60) return '#a5d3a5'; // Green
      if (percentile >= 40) return '#b1e1b0'; // Light green
      return '#c5f1c6'; // Very light green
    } else {
      if (percentile >= 80) return '#fd7979'; // Bright red
      if (percentile >= 60) return '#fda4a4'; // Red
      if (percentile >= 40) return '#fdc2c2'; // Light red
      return '#ffe1e1'; // Very light red
    }
  };

  // Format values for display with proper units and no unnecessary cents
  const formatValue = (value, type = '') => {
    if (value === null || value === undefined) return 'N/A';

    if (type === 'money' || type === 'currency') {
      const num = Number(value);
      if (num >= 1000000000) {
        return `$${(num / 1000000000).toFixed(1)}B`;
      } else if (num >= 1000000) {
        return `$${(num / 1000000).toFixed(0)}M`;
      } else if (num >= 1000) {
        return `$${(num / 1000).toFixed(0)}K`;
      } else {
        return `$${Math.round(num).toLocaleString()}`;
      }
    }
    if (type === 'percentage') {
      return `${(Number(value) * 100).toFixed(2)}%`;
    }
    if (typeof value === 'number') {
      // For large numbers, add proper formatting
      const num = Number(value);
      if (num >= 1000000000) {
        return `${(num / 1000000000).toFixed(1)}B`;
      } else if (num >= 1000000) {
        return `${(num / 1000000).toFixed(0)}M`;
      } else if (num >= 1000) {
        return num.toLocaleString();
      } else {
        return Math.round(num).toLocaleString();
      }
    }
    return value;
  };

  useEffect(() => {
    if (stockData && generateHistoricalData) {
      setLoading(false);
    }
  }, [stockData, generateHistoricalData]);

  // Show loading only if data is being fetched AND we don't have any existing data
  if (isLoading && allStockData.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <h2>Loading Stock Data...</h2>
        <p>No cached data found. Loading fresh data for {ticker}...</p>
        <button
          onClick={() => navigate('/')}
          style={{
            marginTop: '16px',
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Go to Home Page
        </button>
      </div>
    );
  }

  // Show not found only after loading is complete and stock is still not found
  if (!isLoading && !stockData) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <h2>Stock Not Found</h2>
        <p>
          The stock ticker &quot;{ticker}&quot; was not found in the current
          dataset.
        </p>
        <button
          onClick={() => navigate(-1)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  const timeframes = ['1W', '1M', '3M', '6M', '52W', 'YTD'];

  // Get chart title based on selected metric
  const getChartTitle = () => {
    if (selectedMetricChart === 'price') {
      return 'Price Performance';
    }
    const metricLabel = stockColumns[selectedMetricChart]?.label;
    return metricLabel || selectedMetricChart;
  };

  // Generate realistic mini chart data that matches the selected timeframe
  const generateMiniChartData = metricKey => {
    if (!stockData) return [];

    const currentValue = stockData[metricKey] || stockData.price;

    // Use scaled-down version of selected timeframe for mini charts
    const getMiniTradingDays = timeframe => {
      const tradingDaysMap = {
        '1W': 5, // 1 week
        '1M': 10, // 2 weeks of selected 1M
        '3M': 15, // 3 weeks of selected 3M
        '6M': 20, // 4 weeks of selected 6M
        '52W': 30, // 6 weeks of selected 52W
        YTD: 25, // 5 weeks of selected YTD
      };
      return tradingDaysMap[timeframe] || 10;
    };

    const tradingDays = getMiniTradingDays(selectedTimeframe);

    // Create deterministic seed
    const tickerHash = ticker
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const metricHash = metricKey
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seed = (tickerHash + metricHash) % 10000;

    // Simple random generator for mini charts
    let randomSeed = seed;
    const nextRandom = () => {
      randomSeed = (randomSeed * 9301 + 49297) % 233280;
      return randomSeed / 233280;
    };

    // Create realistic progression that ends at current value, scaled to timeframe
    const getMiniTrend = timeframe => {
      const trendMap = {
        '1W': metricKey === 'price' ? 0.01 : 0.003, // 1% for 1 week
        '1M': metricKey === 'price' ? 0.02 : 0.006, // 2% for 2 weeks
        '3M': metricKey === 'price' ? 0.03 : 0.01, // 3% for 3 weeks
        '6M': metricKey === 'price' ? 0.04 : 0.013, // 4% for 4 weeks
        '52W': metricKey === 'price' ? 0.06 : 0.02, // 6% for 6 weeks
        YTD: metricKey === 'price' ? 0.05 : 0.016, // 5% for 5 weeks
      };
      return trendMap[timeframe] || 0.03;
    };

    const miniTrend = getMiniTrend(selectedTimeframe);
    const startValue =
      metricKey === 'price'
        ? currentValue / (1 + miniTrend)
        : currentValue * (0.97 + nextRandom() * 0.06); // Smaller variation for non-price

    const prices = [];

    // Generate realistic market movements for mini charts
    let currentPrice = startValue;
    const totalReturnNeeded = (currentValue - startValue) / startValue;
    const avgDailyReturn = totalReturnNeeded / tradingDays;

    for (let day = 0; day < tradingDays; day++) {
      let dataPoint;

      if (metricKey === 'price' || metricKey === 'rsi') {
        // For both price and RSI, generate realistic price data
        // (RSI will be calculated from prices after the loop)
        const random1 = nextRandom();
        const random2 = nextRandom();
        const normalRandom =
          Math.sqrt(-2 * Math.log(random1)) * Math.cos(2 * Math.PI * random2);

        const dailyVol = 0.015; // 1.5% daily volatility for mini charts
        const trendComponent = avgDailyReturn;
        const randomComponent = normalRandom * dailyVol;

        const momentum =
          day > 0
            ? (prices[day - 1] / (day > 1 ? prices[day - 2] : startValue) - 1) *
              0.03
            : 0;
        const dailyReturn = trendComponent + randomComponent + momentum;

        currentPrice = currentPrice * (1 + dailyReturn);
        dataPoint = currentPrice;
      } else if (metricKey === 'impliedVolatility') {
        // IV with occasional spikes
        if (day === 0) {
          dataPoint = Math.max(0.1, Math.min(0.6, startValue));
        } else {
          const prevIV = prices[day - 1];
          let ivChange = (nextRandom() - 0.5) * 0.02; // Normal daily IV change

          // Occasional volatility spikes
          if (nextRandom() > 0.9) {
            ivChange += (nextRandom() - 0.5) * 0.05;
          }

          const trendToTarget = (currentValue - prevIV) * 0.03;
          dataPoint = prevIV + ivChange + trendToTarget;
          dataPoint = Math.max(0.1, Math.min(0.6, dataPoint));
        }
      } else {
        // Other financial metrics with realistic movement
        if (day === 0) {
          dataPoint = startValue;
        } else {
          const prevValue = prices[day - 1];
          const dailyChange =
            (nextRandom() - 0.5) * Math.abs(currentValue) * 0.01; // 1% daily change
          const trendToTarget = (currentValue - prevValue) * 0.04;

          dataPoint = prevValue + dailyChange + trendToTarget;

          if (currentValue > 0) {
            dataPoint = Math.max(
              currentValue * 0.7,
              Math.min(currentValue * 1.3, dataPoint)
            );
          }
        }
      }

      prices.push(dataPoint);
    }

    // REMOVED: No more forced ending values or adjustment periods
    // Mini charts now end naturally where the GBM process leads
    // This eliminates artificial drop-offs and creates more realistic chart behavior

    // Calculate RSI from generated prices if needed
    if (metricKey === 'rsi') {
      const rsiValues = calculateRSI(prices, 14);
      const validRSI = validateRSI(rsiValues);
      // Filter out null values from the beginning (RSI needs 14+ periods)
      return validRSI.filter(val => val !== null);
    }

    return prices;
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8f9fa',
      }}
    >
      <div
        style={{
          padding: '24px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '30px',
            borderBottom: '2px solid #e0e6ed',
            paddingBottom: '20px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                marginBottom: '12px',
              }}
            >
              <div>
                <h1 style={{ margin: '0 0 4px 0', color: '#2c3e50' }}>
                  {stockData.ticker}
                </h1>
                <h2
                  style={{
                    margin: '0',
                    fontWeight: '400',
                    color: '#6c757d',
                    fontSize: '18px',
                  }}
                >
                  {companyMetadata.name}
                </h2>
              </div>
              <span
                style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#2c3e50',
                }}
              >
                ${stockData.price?.toLocaleString()}
              </span>
              <span
                style={{
                  fontSize: '14px',
                  color: '#6c757d',
                  backgroundColor: '#f8f9fa',
                  padding: '4px 8px',
                  borderRadius: '4px',
                }}
              >
                Rank #{stockData.rank} of {allStockData.length}
              </span>
            </div>

            {/* Company Metadata */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                marginBottom: '12px',
                padding: '12px',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                border: '1px solid #e9ecef',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  SECTOR
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.sector}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  INDUSTRY
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.industry}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  EXCHANGE
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.exchange}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  NEXT EARNINGS
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.earningsDate?.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  MARKET CAP
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.marketCap
                    ? formatValue(companyMetadata.marketCap, 'money')
                    : 'N/A'}
                </div>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    fontWeight: '500',
                  }}
                >
                  EMPLOYEES
                </span>
                <div
                  style={{
                    fontSize: '14px',
                    color: '#2c3e50',
                    fontWeight: '600',
                  }}
                >
                  {companyMetadata.employees
                    ? formatValue(companyMetadata.employees)
                    : 'N/A'}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  color: currentStockList.color,
                  fontWeight: '500',
                  backgroundColor: 'rgba(255,255,255,0.8)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${currentStockList.color}`,
                }}
              >
                {currentStockList.name}
              </span>

              {/* Validation status indicator */}
              {stockData._validation && (
                <DataQualityBadge
                  confidence={stockData._validation.overallConfidence}
                  status={stockData._validation.status}
                  sources={[]}
                  showLabel={true}
                  size="medium"
                  style={{ fontSize: '11px' }}
                />
              )}

              {/* Data freshness indicator */}
              {dataAge && (
                <span
                  style={{
                    fontSize: '11px',
                    color: isDataStale ? '#dc3545' : '#28a745',
                    fontWeight: '500',
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    padding: '3px 6px',
                    borderRadius: '3px',
                    border: `1px solid ${isDataStale ? '#dc3545' : '#28a745'}`,
                  }}
                  title={`Data last updated: ${dataAge.toLocaleString()}`}
                >
                  {isDataStale ? '⚠️ ' : '✓ '}
                  Data: {dataAge.toLocaleDateString()}{' '}
                  {dataAge.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {isDataStale && ' (Stale)'}
                </span>
              )}

              {isLoading && (
                <span
                  style={{
                    fontSize: '11px',
                    color: '#007bff',
                    fontWeight: '500',
                    backgroundColor: 'rgba(255,255,255,0.9)',
                    padding: '3px 6px',
                    borderRadius: '3px',
                    border: '1px solid #007bff',
                  }}
                >
                  🔄 Refreshing...
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ← Back to Rankings
          </button>
        </div>

        {/* Price Chart */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e0e6ed',
            padding: '20px',
            marginBottom: '30px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <h3 style={{ margin: 0, color: '#2c3e50' }}>{getChartTitle()}</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {timeframes.map(tf => (
                <button
                  key={tf}
                  onClick={() => {
                    setSelectedTimeframe(tf);
                    updateChartPreference('timeframe', tf);
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor:
                      selectedTimeframe === tf ? '#007bff' : '#f8f9fa',
                    color: selectedTimeframe === tf ? 'white' : '#495057',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '500',
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: '400px' }}>
            {historicalLoading && selectedMetricChart === 'price' ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6c757d',
                  fontSize: '16px',
                }}
              >
                📈 Loading real historical data for {ticker}...
              </div>
            ) : chartData && !loading ? (
              <TimeSeriesChart
                data={chartData.data}
                labels={chartData.labels}
                title={`${ticker} - ${selectedTimeframe} ${selectedMetricChart === 'price' && historicalData ? '(Real Data)' : '(Generated Data)'}`}
                selectedMetric={selectedMetricChart}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#6c757d',
                }}
              >
                Loading chart data...
              </div>
            )}
          </div>
        </div>

        {/* Metric Correlation Analysis - Only for time-series appropriate metrics */}
        {historicalData && chartData && (() => {
          // Calculate RSI from full dataset (including warmup periods)
          const fullRSI = calculateIntradayRSI(historicalData.data, historicalData.labels, 14);

          // Trim warmup data: RSI needs 14 periods, so first 14 values are invalid
          // We added 20 warmup days, so we want to skip first 20 data points to show clean data
          const RSI_WARMUP_DAYS = 20;
          const skipPoints = Math.min(RSI_WARMUP_DAYS, Math.floor(historicalData.data.length * 0.3)); // Max 30% of data

          // Create trimmed arrays (skip warmup periods)
          const trimmedPrice = historicalData.data.slice(skipPoints);
          const trimmedRSI = fullRSI.slice(skipPoints);
          const trimmedLabels = historicalData.labels.slice(skipPoints);
          const trimmedVolume = historicalData.volume ? historicalData.volume.slice(skipPoints) : null;

          // Calculate derived metrics from trimmed data

          // 1. Daily Price Change % (percent change from previous day)
          const priceChange = trimmedPrice.map((price, i) => {
            if (i === 0) return 0; // First day has no previous day
            return ((price - trimmedPrice[i - 1]) / trimmedPrice[i - 1]) * 100;
          });

          // 2. 20-day Simple Moving Average
          const calculateSMA = (data, period) => {
            return data.map((_, i) => {
              if (i < period - 1) return null; // Not enough data yet
              const slice = data.slice(i - period + 1, i + 1);
              const sum = slice.reduce((a, b) => a + b, 0);
              return sum / period;
            });
          };
          const sma20 = calculateSMA(trimmedPrice, 20);

          // 3. 50-day Simple Moving Average
          const sma50 = calculateSMA(trimmedPrice, 50);

          // 4. Volatility (rolling 20-day standard deviation of daily returns)
          const calculateVolatility = (prices, period = 20) => {
            return prices.map((_, i) => {
              if (i < period) return null; // Not enough data yet

              // Calculate daily returns for the period
              const returns = [];
              for (let j = i - period + 1; j <= i; j++) {
                if (j > 0) {
                  returns.push((prices[j] - prices[j - 1]) / prices[j - 1]);
                }
              }

              // Calculate standard deviation
              const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
              const variance = returns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / returns.length;
              const stdDev = Math.sqrt(variance);

              // Annualize (multiply by sqrt of trading days per year)
              return stdDev * Math.sqrt(252) * 100; // Express as percentage
            });
          };
          const volatility = calculateVolatility(trimmedPrice, 20);

          console.log(`📊 Correlation data: ${historicalData.data.length} total → ${trimmedPrice.length} visible (skipped ${skipPoints} warmup)`);
          console.log(`📊 Calculated metrics: Volume=${trimmedVolume ? 'Yes' : 'No'}, PriceChange=${priceChange.length}, SMA20=${sma20.filter(v => v !== null).length}, SMA50=${sma50.filter(v => v !== null).length}, Volatility=${volatility.filter(v => v !== null).length}`);

          // Find first valid index where ALL metrics have non-null values
          // This removes leading gaps in charts for metrics with warmup periods
          let firstValidIndex = 0;
          for (let i = 0; i < trimmedPrice.length; i++) {
            const allValid = sma20[i] !== null && sma50[i] !== null && volatility[i] !== null;
            if (allValid) {
              firstValidIndex = i;
              break;
            }
          }

          // Trim all metrics to start from first valid index
          const cleanPrice = trimmedPrice.slice(firstValidIndex);
          const cleanRSI = trimmedRSI.slice(firstValidIndex);
          const cleanPriceChange = priceChange.slice(firstValidIndex);
          const cleanSMA20 = sma20.slice(firstValidIndex);
          const cleanSMA50 = sma50.slice(firstValidIndex);
          const cleanVolatility = volatility.slice(firstValidIndex);
          const cleanLabels = trimmedLabels.slice(firstValidIndex);
          const cleanVolume = trimmedVolume ? trimmedVolume.slice(firstValidIndex) : null;

          console.log(`📊 Cleaned data: Removed ${firstValidIndex} leading null values → ${cleanPrice.length} data points`);

          // Prepare metrics data object
          const metricsData = {
            price: cleanPrice,
            rsi: cleanRSI,
            priceChange: cleanPriceChange,
            sma20: cleanSMA20,
            sma50: cleanSMA50,
            volatility: cleanVolatility
          };

          // Add volume if available
          if (cleanVolume) {
            metricsData.volume = cleanVolume;
          }

          const availableMetrics = {
            price: 'Price ($)',
            rsi: 'RSI (14-period)',
            priceChange: 'Daily Change (%)',
            sma20: '20-Day SMA ($)',
            sma50: '50-Day SMA ($)',
            volatility: 'Volatility (20-day, %)'
          };

          // Add volume if available
          if (trimmedVolume) {
            availableMetrics.volume = 'Volume';
          }

          return (
            <div style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e0e6ed',
              padding: '20px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '30px'
            }}>
              <MetricCorrelationChart
                metricsData={metricsData}
                labels={cleanLabels}
                availableMetrics={availableMetrics}
                title={`${ticker} - Metric Correlation Analysis (${selectedTimeframe}) - Daily Metrics Only`}
              />
              <div style={{
                marginTop: '10px',
                padding: '10px',
                backgroundColor: '#f8f9fa',
                borderRadius: '4px',
                fontSize: '12px',
                color: '#6c757d',
                fontStyle: 'italic'
              }}>
                ℹ️ <strong>Note:</strong> Only metrics that change daily are shown here.
                Quarterly metrics (P/E, Debt/EBITDA, ROE) and static metrics (52W high/low)
                require Phase 2 (ranking snapshots) for meaningful time-series analysis.
                <br />
                💡 <strong>Available Metrics:</strong> Price, RSI, Daily Change %, 20-Day SMA, 50-Day SMA, Volatility{trimmedVolume ? ', Volume' : ''}.
                Select multiple metrics to see correlations!
              </div>
            </div>
          );
        })()}

        {/* Metrics Grid */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e0e6ed',
            padding: '20px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <h3 style={{ margin: '0', color: '#2c3e50' }}>
              Financial Metrics
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: '400',
                  color: '#6c757d',
                  marginLeft: '12px',
                }}
              >
                Color-coded vs. {currentStockList.name} peers
              </span>
            </h3>
            <div style={{ fontSize: '12px', color: '#6c757d' }}>
              Click any metric to view its timeline in the chart above
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '16px',
            }}
          >
            {Object.entries(stockColumns)
              .filter(
                ([key, param]) =>
                  param.multiplier !== 0 &&
                  key !== 'rank' &&
                  key !== 'ticker' &&
                  stockData[key] !== null &&
                  stockData[key] !== undefined
              )
              .map(([key, param]) => {
                const ranking = relativeRankings[key];
                const color = getMetricColor(key);
                const chartInfo = getMiniChartInfo(key); // Calculate once per metric

                return (
                  <div
                    key={key}
                    onClick={() => {
                      setSelectedMetricChart(key);
                      updateChartPreference('metric', key);
                    }}
                    style={{
                      backgroundColor: color,
                      border:
                        selectedMetricChart === key
                          ? '2px solid #007bff'
                          : '1px solid #e9ecef',
                      borderRadius: '6px',
                      padding: '16px',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                      transform:
                        selectedMetricChart === key
                          ? 'scale(1.02)'
                          : 'scale(1)',
                      boxShadow:
                        selectedMetricChart === key
                          ? '0 4px 12px rgba(0,123,255,0.2)'
                          : '0 2px 4px rgba(0,0,0,0.1)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: '#2c3e50',
                          }}
                        >
                          {param.label}
                        </span>
                        {/* Show validation badge if data is validated */}
                        {stockData._validation?.metrics?.[key] && (
                          <DataQualityBadge
                            confidence={
                              stockData._validation.metrics[key].confidence
                            }
                            status={stockData._validation.metrics[key].status}
                            sources={stockData._validation.metrics[key].sources}
                            size="small"
                          />
                        )}
                      </div>
                      {ranking && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: '#6c757d',
                            backgroundColor: 'rgba(255,255,255,0.7)',
                            padding: '2px 6px',
                            borderRadius: '10px',
                          }}
                        >
                          #{ranking.rank}/{ranking.total}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: '#2c3e50',
                        marginBottom: '4px',
                      }}
                    >
                      {formatValue(stockData[key], param.type)}
                    </div>

                    {/* Mini chart for the metric - only show for time-series appropriate metrics */}
                    {TIME_SERIES_METRICS.includes(key) ? (
                      <MiniChart
                        data={chartInfo.data}
                        selectedTimeframe={selectedTimeframe}
                        metricKey={key}
                        isRealData={chartInfo.isRealData}
                      />
                    ) : (
                      <div style={{
                        fontSize: '11px',
                        color: '#6c757d',
                        fontStyle: 'italic',
                        marginTop: '4px',
                        textAlign: 'center'
                      }}>
                        {STATIC_METRICS.includes(key) ? '(Snapshot value)' : '(Updated quarterly)'}
                      </div>
                    )}

                    {ranking && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: '#495057',
                        }}
                      >
                        {ranking.percentile.toFixed(0)}th percentile
                        {ranking.isGood ? ' (Good)' : ' (Needs Improvement)'}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function for day of year calculation
Date.prototype.getDayOfYear = function () {
  const start = new Date(this.getFullYear(), 0, 0);
  const diff = this - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

export default StockDetailPage;
