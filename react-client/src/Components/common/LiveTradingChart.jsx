/**
 * LiveTradingChart - Real-time intraday chart for live trading
 *
 * Displays live price data with buy/sell trade markers, similar to
 * the TradingSimulator but connected to real market data.
 *
 * Features:
 * - Real-time 1-minute candle updates
 * - Buy/sell trade markers from active session
 * - Current position P&L display
 * - Intraday regime detection
 * - Auto-scroll to latest price
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Card from './Card';
import theme from '../../theme';

// Market hours (EST)
const MARKET_OPEN_HOUR = 9.5; // 9:30 AM
const MARKET_CLOSE_HOUR = 16; // 4:00 PM

// Format time for display
const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

// Get EST hour from timestamp
const getEstHour = (timestamp) => {
  const date = new Date(timestamp);
  const estTime = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return estTime.getHours() + estTime.getMinutes() / 60;
};

// Check if market is open
const isMarketOpen = () => {
  const now = new Date();
  const estHour = getEstHour(now);
  const day = now.getDay();
  return day >= 1 && day <= 5 && estHour >= MARKET_OPEN_HOUR && estHour < MARKET_CLOSE_HOUR;
};

// Timeframe options
const TIMEFRAMES = [
  { key: '1D', label: '1D', days: 1 },
  { key: '1W', label: '1W', days: 7 },
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1Y', label: '1Y', days: 365 },
];

const LiveTradingChart = ({
  symbol = 'NVDA',
  sessionId = null,
  sessionStatus = 'stopped', // 'running', 'paused', 'stopped'
  trades = [],
  positions = [],
  height = 200,
  refreshInterval = 5000, // 5 second default refresh
  onPriceUpdate = null,
}) => {
  const [candles, setCandles] = useState([]);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [marketStatus, setMarketStatus] = useState(isMarketOpen() ? 'open' : 'closed');
  const [timeframe, setTimeframe] = useState('1D'); // Default to current day
  const refreshTimerRef = useRef(null);
  const containerRef = useRef(null);

  // Get date range for the selected timeframe
  const getDateRange = () => {
    const today = new Date();
    const fromDate = new Date();
    const tf = TIMEFRAMES.find(t => t.key === timeframe) || TIMEFRAMES[0];
    fromDate.setDate(today.getDate() - tf.days);

    return {
      from: fromDate.toISOString().split('T')[0],
      to: today.toISOString().split('T')[0],
    };
  };

  // Determine multiplier and timespan based on timeframe
  const getAggregateParams = () => {
    switch (timeframe) {
      case '1D':
        return { multiplier: 1, timespan: 'minute' };
      case '1W':
        return { multiplier: 5, timespan: 'minute' };
      case '3M':
      case '6M':
        return { multiplier: 1, timespan: 'day' };
      case '1Y':
        return { multiplier: 1, timespan: 'day' };
      default:
        return { multiplier: 1, timespan: 'minute' };
    }
  };

  // Main fetch logic
  const fetchCandles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { from, to } = getDateRange();
      const { multiplier, timespan } = getAggregateParams();

      const response = await fetch(
        `/api/polygon/aggregates/${symbol}/${multiplier}/${timespan}?from=${from}&to=${to}`
      );

      // Handle non-JSON responses gracefully
      const contentType = response.headers.get('content-type');
      if (!response.ok || !contentType || !contentType.includes('application/json')) {
        // No data available - show empty chart, don't error
        setCandles([]);
        setLoading(false);
        return;
      }

      const data = await response.json();
      const bars = data.results || data.candles || [];

      if (bars.length > 0) {
        let processedCandles = bars;

        // For 1D view, filter to market hours only
        if (timeframe === '1D') {
          processedCandles = bars.filter(c => {
            const hour = getEstHour(c.timestamp || c.t);
            return hour >= MARKET_OPEN_HOUR && hour < MARKET_CLOSE_HOUR;
          });
        }

        setCandles(processedCandles);

        // Set day open from first candle
        if (processedCandles.length > 0) {
          const firstCandle = processedCandles[0];
          setDayOpen(firstCandle.open || firstCandle.o);

          // Set current price from latest candle
          const lastCandle = processedCandles[processedCandles.length - 1];
          const price = lastCandle.close || lastCandle.c;
          setCurrentPrice(price);
          setLastUpdate(new Date());

          if (onPriceUpdate) {
            onPriceUpdate(price);
          }
        }
      } else {
        // No data - show empty chart (market may be closed with no data yet)
        setCandles([]);
      }
    } catch (err) {
      console.error('Error fetching candles:', err);
      // Don't show error to user - just show empty chart
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, onPriceUpdate]);

  // Also fetch current quote for more real-time price
  const fetchQuote = useCallback(async () => {
    try {
      const response = await fetch(`/api/quote/${symbol}`);
      if (response.ok) {
        const data = await response.json();
        if (data.price) {
          setCurrentPrice(data.price);
          setLastUpdate(new Date());
          if (onPriceUpdate) {
            onPriceUpdate(data.price);
          }
        }
      }
    } catch (err) {
      // Silent fail for quote - candles are primary
    }
  }, [symbol, onPriceUpdate]);

  // Initial fetch and setup refresh
  useEffect(() => {
    fetchCandles();

    // Update market status
    const checkMarket = () => {
      setMarketStatus(isMarketOpen() ? 'open' : 'closed');
    };
    checkMarket();

    // Setup refresh interval - only refresh when on 1D view and session is running
    refreshTimerRef.current = setInterval(() => {
      checkMarket();
      if (timeframe === '1D' && sessionStatus === 'running' && isMarketOpen()) {
        fetchCandles();
        fetchQuote();
      }
    }, refreshInterval);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [fetchCandles, fetchQuote, refreshInterval, sessionStatus, timeframe]);

  // Refetch when symbol or timeframe changes
  useEffect(() => {
    setLoading(true);
    setCandles([]);
    setCurrentPrice(null);
    setDayOpen(null);
    fetchCandles();
  }, [symbol, timeframe]);

  // Calculate P&L for current position
  const calculatePositionPnL = useCallback(() => {
    if (!positions || positions.length === 0 || !currentPrice) return null;

    const position = positions[0];
    const avgCost = position.averageCost || position.avg_entry_price || position.entryPrice;
    const qty = position.quantity || position.qty;

    if (!avgCost || !qty) return null;

    const pnl = (currentPrice - avgCost) * qty;
    const pnlPercent = ((currentPrice - avgCost) / avgCost) * 100;

    return { pnl, pnlPercent, qty, avgCost };
  }, [positions, currentPrice]);

  // Render the chart
  const renderChart = () => {
    if (candles.length === 0) {
      return (
        <div
          style={{
            height: height - 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: theme.colors.textMuted,
            fontSize: theme.typography.fontSize.sm,
          }}
        >
          {loading ? 'Loading chart data...' : (
            <span>
              No data available yet
              {timeframe === '1D' && marketStatus === 'closed' && (
                <span style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}>
                  Market is closed - chart will update when market opens
                </span>
              )}
            </span>
          )}
        </div>
      );
    }

    const width = 600;
    const chartHeight = height - 60;
    const padding = 40;

    // Get price range
    const prices = candles.map(c => c.close || c.c).filter(p => p > 0);
    const minPrice = Math.min(...prices) * 0.999;
    const maxPrice = Math.max(...prices) * 1.001;

    // Scale functions
    const xScale = (i) => padding + (i / candles.length) * (width - padding * 2);
    const yScale = (p) => chartHeight - padding - ((p - minPrice) / (maxPrice - minPrice)) * (chartHeight - padding * 2);

    // Build price path
    const pathPoints = candles
      .map((candle, i) => {
        const price = candle.close || candle.c;
        const x = xScale(i);
        const y = yScale(price);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');

    // Filter trades for this symbol
    const symbolTrades = trades.filter(t =>
      t.symbol === symbol || t.symbol?.toUpperCase() === symbol.toUpperCase()
    );
    const buyTrades = symbolTrades.filter(t =>
      t.side === 'buy' || t.type === 'BUY' || t.action === 'BUY'
    );
    const sellTrades = symbolTrades.filter(t =>
      t.side === 'sell' || t.type === 'SELL' || t.action === 'SELL'
    );

    // Find trade candle indices
    const findTradeIndex = (tradeTime) => {
      const tradeTimestamp = new Date(tradeTime).getTime();
      return candles.findIndex(c => {
        const candleTime = c.timestamp || c.t;
        return candleTime >= tradeTimestamp;
      });
    };

    // Calculate position line if we have a position
    const positionInfo = calculatePositionPnL();
    const hasPosition = positionInfo !== null;

    return (
      <svg
        viewBox={`0 0 ${width} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: '100%',
          height: 'auto',
          maxHeight: `${chartHeight}px`,
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.sm,
        }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line
            key={pct}
            x1={padding}
            y1={chartHeight - padding - pct * (chartHeight - padding * 2)}
            x2={width - padding}
            y2={chartHeight - padding - pct * (chartHeight - padding * 2)}
            stroke={theme.colors.gray200}
            strokeDasharray="2,2"
          />
        ))}

        {/* Price labels */}
        <text x={5} y={padding} fontSize={10} fill={theme.colors.gray500}>
          ${maxPrice.toFixed(2)}
        </text>
        <text x={5} y={chartHeight - padding} fontSize={10} fill={theme.colors.gray500}>
          ${minPrice.toFixed(2)}
        </text>

        {/* Day open reference line */}
        {dayOpen && (
          <>
            <line
              x1={padding}
              y1={yScale(dayOpen)}
              x2={width - padding}
              y2={yScale(dayOpen)}
              stroke={theme.colors.gray400}
              strokeDasharray="4,4"
              strokeWidth={1}
            />
            <text
              x={width - padding + 5}
              y={yScale(dayOpen) + 3}
              fontSize={9}
              fill={theme.colors.gray500}
            >
              Open
            </text>
          </>
        )}

        {/* Position entry line */}
        {hasPosition && positionInfo.avgCost >= minPrice && positionInfo.avgCost <= maxPrice && (
          <>
            <line
              x1={padding}
              y1={yScale(positionInfo.avgCost)}
              x2={width - padding}
              y2={yScale(positionInfo.avgCost)}
              stroke={theme.colors.primary}
              strokeDasharray="4,2"
              strokeWidth={1.5}
            />
            <text
              x={width - padding + 5}
              y={yScale(positionInfo.avgCost) + 3}
              fontSize={9}
              fill={theme.colors.primary}
            >
              Entry
            </text>
          </>
        )}

        {/* Price line */}
        <path
          d={pathPoints}
          fill="none"
          stroke={currentPrice >= dayOpen ? theme.colors.success : theme.colors.error}
          strokeWidth={2}
        />

        {/* Current price dot */}
        {currentPrice && candles.length > 0 && (
          <circle
            cx={xScale(candles.length - 1)}
            cy={yScale(currentPrice)}
            r={5}
            fill={currentPrice >= dayOpen ? theme.colors.success : theme.colors.error}
          />
        )}

        {/* Buy trade markers (green triangles pointing up) */}
        {buyTrades.map((trade, i) => {
          const tradeIndex = findTradeIndex(trade.timestamp || trade.created_at || trade.filled_at);
          if (tradeIndex < 0) return null;
          const tradePrice = trade.price || trade.filled_avg_price;
          if (!tradePrice) return null;

          return (
            <g key={`buy-${i}`}>
              <polygon
                points={`${xScale(tradeIndex)},${yScale(tradePrice) + 8} ${xScale(tradeIndex) - 6},${yScale(tradePrice) + 18} ${xScale(tradeIndex) + 6},${yScale(tradePrice) + 18}`}
                fill={theme.colors.success}
              />
              <text
                x={xScale(tradeIndex)}
                y={yScale(tradePrice) + 30}
                fontSize={8}
                fill={theme.colors.success}
                textAnchor="middle"
              >
                BUY
              </text>
            </g>
          );
        })}

        {/* Sell trade markers (red triangles pointing down) */}
        {sellTrades.map((trade, i) => {
          const tradeIndex = findTradeIndex(trade.timestamp || trade.created_at || trade.filled_at);
          if (tradeIndex < 0) return null;
          const tradePrice = trade.price || trade.filled_avg_price;
          if (!tradePrice) return null;

          return (
            <g key={`sell-${i}`}>
              <polygon
                points={`${xScale(tradeIndex)},${yScale(tradePrice) - 8} ${xScale(tradeIndex) - 6},${yScale(tradePrice) - 18} ${xScale(tradeIndex) + 6},${yScale(tradePrice) - 18}`}
                fill={theme.colors.error}
              />
              <text
                x={xScale(tradeIndex)}
                y={yScale(tradePrice) - 22}
                fontSize={8}
                fill={theme.colors.error}
                textAnchor="middle"
              >
                SELL
              </text>
            </g>
          );
        })}

        {/* Time labels */}
        <text x={padding} y={chartHeight - 5} fontSize={10} fill={theme.colors.gray500}>
          9:30
        </text>
        <text x={width / 2} y={chartHeight - 5} fontSize={10} fill={theme.colors.gray500} textAnchor="middle">
          12:30
        </text>
        <text x={width - padding} y={chartHeight - 5} fontSize={10} fill={theme.colors.gray500} textAnchor="end">
          16:00
        </text>
      </svg>
    );
  };

  // Calculate day change
  const dayChange = currentPrice && dayOpen ? currentPrice - dayOpen : 0;
  const dayChangePercent = dayOpen ? (dayChange / dayOpen) * 100 : 0;
  const positionInfo = calculatePositionPnL();

  return (
    <Card>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.sm,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
          <h3
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <span style={{ fontSize: '20px' }}>📈</span>
            {symbol} Live Chart
          </h3>

          {/* Market status badge */}
          <span
            style={{
              fontSize: theme.typography.fontSize.xs,
              padding: '2px 8px',
              borderRadius: theme.borderRadius.sm,
              backgroundColor: marketStatus === 'open' ? '#dcfce7' : '#fee2e2',
              color: marketStatus === 'open' ? '#166534' : '#991b1b',
              fontWeight: 'bold',
            }}
          >
            {marketStatus === 'open' ? '● LIVE' : '○ CLOSED'}
          </span>

          {/* Timeframe toggles */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.key}
                onClick={() => setTimeframe(tf.key)}
                style={{
                  padding: '2px 8px',
                  fontSize: theme.typography.fontSize.xs,
                  border: 'none',
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  backgroundColor: timeframe === tf.key ? theme.colors.primary : theme.colors.gray100,
                  color: timeframe === tf.key ? '#fff' : theme.colors.textMuted,
                  fontWeight: timeframe === tf.key ? 'bold' : 'normal',
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price and P&L */}
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.lg }}>
          {/* Current price */}
          {currentPrice && (
            <div style={{ textAlign: 'right' }}>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: 'bold',
                  color: dayChange >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                ${currentPrice.toFixed(2)}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: dayChange >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)} ({dayChangePercent >= 0 ? '+' : ''}{dayChangePercent.toFixed(2)}%)
              </div>
            </div>
          )}

          {/* Position P&L */}
          {positionInfo && (
            <div
              style={{
                textAlign: 'right',
                padding: theme.spacing.sm,
                backgroundColor: positionInfo.pnl >= 0 ? '#dcfce7' : '#fee2e2',
                borderRadius: theme.borderRadius.sm,
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.textMuted,
                }}
              >
                Position ({positionInfo.qty} shares)
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.md,
                  fontWeight: 'bold',
                  color: positionInfo.pnl >= 0 ? '#166534' : '#991b1b',
                }}
              >
                {positionInfo.pnl >= 0 ? '+' : ''}{positionInfo.pnl.toFixed(2)} ({positionInfo.pnlPercent >= 0 ? '+' : ''}{positionInfo.pnlPercent.toFixed(2)}%)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef}>
        {error ? (
          <div
            style={{
              height: height - 60,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.colors.error,
            }}
          >
            Error: {error}
          </div>
        ) : (
          renderChart()
        )}
      </div>

      {/* Footer with last update time */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: theme.spacing.sm,
          fontSize: theme.typography.fontSize.xs,
          color: theme.colors.textMuted,
        }}
      >
        <span>
          {trades.length > 0 && `${trades.filter(t => t.symbol === symbol).length} trades today`}
        </span>
        <span>
          {lastUpdate && `Updated: ${formatTime(lastUpdate)}`}
        </span>
      </div>
    </Card>
  );
};

export default LiveTradingChart;
