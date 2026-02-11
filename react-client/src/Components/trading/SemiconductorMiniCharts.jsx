/**
 * Semiconductor Mini Charts
 *
 * Displays SOXX, SOXL, SOXS price charts in a row with key metrics.
 * Uses lightweight-charts library for rendering.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

const SYMBOLS = [
  { symbol: 'SOXX', name: 'iShares Semiconductor', type: 'reference', color: '#6366f1' },
  { symbol: 'SOXL', name: '3x Bull Semiconductor', type: 'bullish', color: '#00c853' },
  { symbol: 'SOXS', name: '3x Bear Semiconductor', type: 'bearish', color: '#ff5252' },
];

const styles = {
  container: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
    marginBottom: '20px',
  },
  chartCard: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  chartHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  symbolInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  symbolDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  symbolName: {
    fontWeight: '600',
    fontSize: '14px',
    color: '#fff',
  },
  symbolType: {
    fontSize: '10px',
    color: '#888',
    textTransform: 'uppercase',
  },
  priceInfo: {
    textAlign: 'right',
  },
  price: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
  },
  change: {
    fontSize: '12px',
  },
  chartContainer: {
    height: '120px',
    padding: '0 8px 8px',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid #333',
    backgroundColor: '#151525',
  },
  metric: {
    textAlign: 'center',
  },
  metricLabel: {
    fontSize: '9px',
    color: '#666',
    textTransform: 'uppercase',
    marginBottom: '2px',
  },
  metricValue: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#fff',
  },
  loading: {
    height: '120px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    fontSize: '12px',
  },
  error: {
    height: '120px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ff5252',
    fontSize: '12px',
    padding: '0 16px',
    textAlign: 'center',
  },
};

// Individual chart component
const MiniChart = ({ symbol, name, type, color }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch price data - Alpaca for real-time, Polygon for historical
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch intraday bars from Alpaca (real-time) and daily history from Polygon
      const [intradayRes, dailyRes] = await Promise.all([
        fetch(`/api/alpaca/bars/${symbol}/5Min?limit=100`),
        fetch(`/api/polygon/aggregates/${symbol}?multiplier=1&timespan=day&limit=10`),
      ]);

      let currentPrice = null;
      let prevClose = null;
      let todayOpen = null;
      let todayHigh = -Infinity;
      let todayLow = Infinity;
      let todayVolume = 0;
      let chartData = [];

      // Get today's date at midnight for filtering
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // PRIMARY: Use Alpaca intraday bars for real-time data
      if (intradayRes.ok) {
        const intradayData = await intradayRes.json();
        const bars = intradayData.bars || intradayData.results || [];

        if (bars.length > 0) {
          // Filter to today's bars only
          const todayBars = bars
            .filter(bar => {
              const barTime = new Date(bar.t || bar.timestamp);
              return barTime >= todayStart;
            })
            .sort((a, b) => (a.t || a.timestamp) - (b.t || b.timestamp));

          if (todayBars.length > 0) {
            // Calculate today's OHLC from intraday bars
            todayOpen = todayBars[0].o || todayBars[0].open;
            currentPrice = todayBars[todayBars.length - 1].c || todayBars[todayBars.length - 1].close;

            todayBars.forEach(bar => {
              const high = bar.h || bar.high;
              const low = bar.l || bar.low;
              const vol = bar.v || bar.volume || 0;
              if (high > todayHigh) todayHigh = high;
              if (low < todayLow) todayLow = low;
              todayVolume += vol;
            });

            // Build chart data from today's bars
            chartData = todayBars.map(bar => ({
              time: Math.floor((bar.t || bar.timestamp) / 1000),
              value: bar.c || bar.close,
            }));
          }
        }
      }

      // Get previous day's close from Polygon for % change calculation
      if (dailyRes.ok) {
        const dailyData = await dailyRes.json();
        if (dailyData.results && dailyData.results.length > 0) {
          // Sort by date descending to find most recent trading days
          const sorted = dailyData.results.sort((a, b) => b.timestamp - a.timestamp);

          // Find yesterday's close (the day before today)
          const todayDateStr = now.toISOString().split('T')[0];
          for (const day of sorted) {
            if (day.date && day.date !== todayDateStr) {
              prevClose = day.close;
              break;
            }
          }

          // If no prevClose yet, use the second most recent
          if (!prevClose && sorted.length > 1) {
            prevClose = sorted[1].close;
          }
        }
      }

      // Handle edge cases
      if (todayHigh === -Infinity) todayHigh = currentPrice;
      if (todayLow === Infinity) todayLow = currentPrice;

      if (!currentPrice) {
        throw new Error('No price data available');
      }

      // Calculate change from previous close
      const change = prevClose && prevClose !== currentPrice
        ? ((currentPrice - prevClose) / prevClose) * 100
        : 0;

      setData({
        chartData,
        currentPrice,
        change,
        high: todayHigh,
        low: todayLow,
        volume: todayVolume,
        open: todayOpen || currentPrice,
        prevClose,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Initial fetch
  useEffect(() => {
    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Initialize/update chart
  useEffect(() => {
    if (!data?.chartData || !chartContainerRef.current) return;

    // Check if lightweight-charts is available
    if (typeof window.LightweightCharts === 'undefined') {
      console.error('LightweightCharts not loaded');
      return;
    }

    // Create chart if it doesn't exist
    if (!chartRef.current) {
      chartRef.current = window.LightweightCharts.createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 120,
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: '#666',
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: '#222', style: 1 },
        },
        crosshair: {
          mode: 0, // Normal mode
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        timeScale: {
          visible: false,
          borderVisible: false,
        },
        rightPriceScale: {
          visible: true,
          borderVisible: false,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        handleScroll: false,
        handleScale: false,
      });

      // Create area series
      seriesRef.current = chartRef.current.addAreaSeries({
        lineColor: color,
        topColor: `${color}40`,
        bottomColor: `${color}05`,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
    }

    // Update data
    if (seriesRef.current) {
      seriesRef.current.setData(data.chartData);
      chartRef.current.timeScale().fitContent();
    }

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [data, color]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  const changeColor = data?.change >= 0 ? '#00c853' : '#ff5252';

  return (
    <div style={styles.chartCard}>
      {/* Header */}
      <div style={styles.chartHeader}>
        <div style={styles.symbolInfo}>
          <div style={{ ...styles.symbolDot, backgroundColor: color }} />
          <div>
            <div style={styles.symbolName}>{symbol}</div>
            <div style={styles.symbolType}>{type}</div>
          </div>
        </div>
        <div style={styles.priceInfo}>
          {data && (
            <>
              <div style={styles.price}>${data.currentPrice.toFixed(2)}</div>
              <div style={{ ...styles.change, color: changeColor }}>
                {data.change >= 0 ? '+' : ''}{data.change.toFixed(2)}%
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chart */}
      <div style={styles.chartContainer}>
        {loading && !data && <div style={styles.loading}>Loading...</div>}
        {error && <div style={styles.error}>{error}</div>}
        <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Metrics */}
      {data && (
        <div style={styles.metrics}>
          <div style={styles.metric}>
            <div style={styles.metricLabel}>Open</div>
            <div style={styles.metricValue}>${data.open.toFixed(2)}</div>
          </div>
          <div style={styles.metric}>
            <div style={styles.metricLabel}>High</div>
            <div style={{ ...styles.metricValue, color: '#00c853' }}>${data.high.toFixed(2)}</div>
          </div>
          <div style={styles.metric}>
            <div style={styles.metricLabel}>Low</div>
            <div style={{ ...styles.metricValue, color: '#ff5252' }}>${data.low.toFixed(2)}</div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main component
const SemiconductorMiniCharts = () => {
  return (
    <div style={styles.container}>
      {SYMBOLS.map(({ symbol, name, type, color }) => (
        <MiniChart
          key={symbol}
          symbol={symbol}
          name={name}
          type={type}
          color={color}
        />
      ))}
    </div>
  );
};

export default SemiconductorMiniCharts;
