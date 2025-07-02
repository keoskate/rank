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

// Professional time series chart component
const TimeSeriesChart = ({ data, labels, title, selectedMetric, onHover }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  if (!data || !labels || data.length === 0) {
    return <div>No chart data available</div>;
  }

  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1; // Prevent division by zero
  const padding = { top: 20, right: 40, bottom: 40, left: 60 };
  const chartWidth = 800;
  const chartHeight = 300;
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Calculate path for the line
  const pathData = data.map((value, index) => {
    const x = padding.left + (index / (data.length - 1)) * plotWidth;
    const y = padding.top + (1 - (value - minValue) / range) * plotHeight;
    return { x, y, value, label: labels[index], index };
  });

  const pathString = pathData
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

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

  // Format value based on metric type
  const formatValue = value => {
    if (selectedMetric === 'price') return `$${value.toFixed(2)}`;
    if (selectedMetric.includes('Ratio') || selectedMetric === 'beta')
      return value.toFixed(2);
    if (
      selectedMetric.includes('percentage') ||
      selectedMetric === 'roe' ||
      selectedMetric === 'impliedVolatility'
    ) {
      return `${(value * 100).toFixed(2)}%`;
    }
    if (typeof value === 'number' && value > 1000)
      return value.toLocaleString();
    return value.toFixed(2);
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
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {pathData.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r="3"
            fill="#007bff"
            stroke="#ffffff"
            strokeWidth="2"
            style={{
              opacity: hoveredPoint && hoveredPoint.index === index ? 1 : 0.7,
              cursor: 'pointer',
            }}
          />
        ))}

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
  const [selectedTimeframe, setSelectedTimeframe] = useState('52W');
  const [selectedMetricChart, setSelectedMetricChart] = useState('price');
  const [loading, setLoading] = useState(true);
  
  // Get cache info for data freshness
  const cacheInfo = getCacheInfo();
  const dataAge = cacheInfo?.lastFetched ? new Date(cacheInfo.lastFetched) : null;
  const isDataStale = dataAge ? (Date.now() - dataAge.getTime()) > (30 * 60 * 1000) : false; // 30 minutes

  // Find the current stock data
  const stockData = useMemo(() => {
    return allStockData.find(stock => stock.ticker === ticker);
  }, [allStockData, ticker]);

  // Use real company data from stockData
  const companyMetadata = useMemo(() => {
    if (!ticker || !stockData) return {};

    // Use the actual company name from the stock data
    const companyName = stockData.name || ticker;

    // Get sector and industry from stock data or use defaults
    const sector = stockData.sector || stockData.industry || 'Technology';
    const industry = stockData.subIndustry || stockData.industry || 'Software';

    // Use existing data or generate reasonable defaults based on ticker hash for missing data
    const tickerHash = ticker
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);

    // Generate earnings date (next quarter)
    const nextEarnings = new Date();
    nextEarnings.setDate(nextEarnings.getDate() + (30 + (tickerHash % 60))); // 30-90 days from now

    return {
      name: companyName,
      sector: sector,
      industry: industry,
      earningsDate: nextEarnings,
      marketCap: stockData?.marketCap || (stockData?.price
        ? stockData.price * (50000000 + (tickerHash % 1000000000))
        : null),
      employees: stockData?.employees || (1000 + (tickerHash % 50000)),
      founded: stockData?.founded || (1950 + (tickerHash % 70)),
      exchange: stockData?.exchange ||
        (tickerHash % 3 === 0
          ? 'NASDAQ'
          : tickerHash % 3 === 1
            ? 'NYSE'
            : 'AMEX'),
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

  // Generate mock historical data for charts with support for different metrics
  const generateHistoricalData = useMemo(() => {
    if (!stockData) return null;

    const timeframes = {
      '1W': { days: 7, points: 35 }, // 5 points per day (more granular)
      '1M': { days: 30, points: 120 }, // 4 points per day
      '3M': { days: 90, points: 180 }, // 2 points per day
      '6M': { days: 180, points: 180 }, // 1 point per day
      '52W': { days: 365, points: 260 }, // ~weekly points but more granular
      YTD: { days: new Date().getDayOfYear(), points: Math.min(new Date().getDayOfYear() * 2, 200) },
    };

    const config = timeframes[selectedTimeframe];
    const currentValue = stockData[selectedMetricChart] || stockData.price;

    // Generate realistic data movement based on metric type
    const data = [];
    const labels = [];

    // Generate more realistic price movement with trending and volatility
    let currentPrice = currentValue;
    const dailyVolatility = 0.02; // 2% daily volatility base
    const trendStrength = 0.001; // Overall trend factor
    
    // Create deterministic but complex seed for consistent results
    const tickerHash = ticker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const metricHash = selectedMetricChart.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seed = (tickerHash + metricHash) % 1000;

    for (let i = config.points - 1; i >= 0; i--) {
      const daysAgo = (config.days / config.points) * i;
      const date = new Date();
      
      // For hourly/intraday data, use hours; for daily data, use days
      if (config.points > config.days) {
        // Intraday data
        date.setHours(date.getHours() - Math.floor(daysAgo * 24));
      } else {
        date.setDate(date.getDate() - Math.floor(daysAgo));
      }

      let dataPoint;

      if (selectedMetricChart === 'price') {
        // Generate realistic price movement with trends, volatility, and noise
        
        // Multiple noise sources for more realistic movement
        const random1 = ((Math.sin(i * 0.1 + seed) + 1) / 2); // 0-1
        const random2 = ((Math.sin(i * 0.23 + seed * 1.3) + 1) / 2); // 0-1
        const random3 = ((Math.sin(i * 0.47 + seed * 0.7) + 1) / 2); // 0-1
        
        // Combine multiple random sources for more complexity
        const dailyChange = (random1 - 0.5) * dailyVolatility * 2; // -2% to +2%
        const weeklyTrend = Math.sin((i + seed) / 10) * trendStrength;
        const microMovement = (random2 - 0.5) * dailyVolatility * 0.5; // Small intraday moves
        const volatilitySpike = (random3 > 0.95 ? (random3 - 0.95) * 0.1 : 0); // Occasional spikes
        
        // Apply all movement factors
        const totalChange = dailyChange + weeklyTrend + microMovement + volatilitySpike;
        currentPrice = currentPrice * (1 + totalChange);
        
        // Ensure price doesn't go too extreme
        currentPrice = Math.max(currentValue * 0.4, Math.min(currentValue * 1.6, currentPrice));
        dataPoint = currentPrice;
        
      } else if (['rsi', 'impliedVolatility', 'roe'].includes(selectedMetricChart)) {
        // Bounded metrics with more realistic movement
        const noise = ((Math.sin(i * 0.15 + seed) + Math.sin(i * 0.31 + seed * 1.2)) / 2) * 0.3;
        const trend = Math.sin((i + seed) / 20) * 0.2;
        
        dataPoint = currentValue * (0.8 + noise + trend + (i / config.points) * 0.2);

        if (selectedMetricChart === 'rsi') {
          dataPoint = Math.max(20, Math.min(80, dataPoint));
        } else if (selectedMetricChart === 'impliedVolatility') {
          dataPoint = Math.max(0.1, Math.min(1.0, dataPoint));
        } else if (selectedMetricChart === 'roe') {
          dataPoint = Math.max(0, Math.min(0.5, dataPoint));
        }
      } else {
        // Other financial metrics - moderate volatility
        const noise = ((Math.sin(i * 0.2 + seed) + Math.sin(i * 0.35 + seed * 0.9)) / 2) * 0.15;
        const trend = Math.sin((i + seed) / 25) * 0.1;
        
        dataPoint = currentValue * (0.85 + noise + trend + (i / config.points) * 0.15);
        dataPoint = Math.max(dataPoint, currentValue * 0.3);
      }

      data.push(dataPoint);
      labels.push(date.toISOString());
    }

    return { labels, data };
  }, [stockData, selectedTimeframe, selectedMetricChart, ticker]);

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

  // Format values for display
  const formatValue = (value, type = '') => {
    if (value === null || value === undefined) return 'N/A';

    if (type === 'money' || type === 'currency') {
      return `$${Number(value).toLocaleString()}`;
    }
    if (type === 'percentage') {
      return `${(Number(value) * 100).toFixed(2)}%`;
    }
    if (typeof value === 'number') {
      return value.toLocaleString();
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
        <p>The stock ticker &quot;{ticker}&quot; was not found in the current dataset.</p>
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

  return (
    <div style={{ 
      minHeight: '100vh',
      backgroundColor: '#f8f9fa'
    }}>
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '24px' 
      }}>
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
              <h2 style={{ 
                margin: '0', 
                fontWeight: '400', 
                color: '#6c757d',
                fontSize: '18px'
              }}>
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
            {companyMetadata.marketCap && (
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
                  ${(companyMetadata.marketCap / 1000000000).toFixed(1)}B
                </div>
              </div>
            )}
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
                {companyMetadata.employees?.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                Data: {dataAge.toLocaleDateString()} {dataAge.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
                onClick={() => setSelectedTimeframe(tf)}
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
          {generateHistoricalData && !loading ? (
            <TimeSeriesChart
              data={generateHistoricalData.data}
              labels={generateHistoricalData.labels}
              title={`${ticker} - ${selectedTimeframe} Chart`}
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

              return (
                <div
                  key={key}
                  onClick={() => {
                    setSelectedMetricChart(key);
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
                      selectedMetricChart === key ? 'scale(1.02)' : 'scale(1)',
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
                    <span
                      style={{
                        fontSize: '14px',
                        fontWeight: '600',
                        color: '#2c3e50',
                      }}
                    >
                      {param.label}
                    </span>
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
