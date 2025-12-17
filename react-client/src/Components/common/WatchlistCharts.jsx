/**
 * WatchlistCharts - Displays a chart for each symbol in the watchlist
 *
 * Shows real-time charts with buy/sell trade markers for live trading,
 * similar to how the TradingSimulator shows simulated trades.
 */

import React, { useState, useEffect, useCallback } from 'react';
import TradingViewChart from './TradingViewChart';
import Card from './Card';
import theme from '../../theme';

// Available timeframes
const TIMEFRAMES = [
  { label: '1m', value: '1', unit: 'minute' },
  { label: '5m', value: '5', unit: 'minute' },
  { label: '15m', value: '15', unit: 'minute' },
  { label: '30m', value: '30', unit: 'minute' },
  { label: '1H', value: '1', unit: 'hour' },
  { label: '1D', value: '1', unit: 'day' },
];

const WatchlistCharts = ({
  watchlist = [],
  trades = [],
  positions = [],
  height = 300,
  refreshInterval = 30000, // 30 second default refresh
  maxCharts = 5, // Limit charts to prevent performance issues
}) => {
  // Store chart data for each symbol (keyed by symbol:timeframe)
  const [chartDataBySymbol, setChartDataBySymbol] = useState({});
  const [loadingSymbols, setLoadingSymbols] = useState(new Set());
  const [expandedSymbol, setExpandedSymbol] = useState(null);
  // Global timeframe state (all charts use the same timeframe)
  const [selectedTimeframe, setSelectedTimeframe] = useState(TIMEFRAMES[1]); // Default 5m

  // Generate cache key for symbol + timeframe
  const getCacheKey = (symbol, tf) => `${symbol}:${tf.value}:${tf.unit}`;

  // Fetch chart data for a symbol with specific timeframe
  const fetchChartData = useCallback(async (symbol, timeframe = selectedTimeframe) => {
    const cacheKey = getCacheKey(symbol, timeframe);
    if (loadingSymbols.has(cacheKey)) return;

    setLoadingSymbols(prev => new Set([...prev, cacheKey]));

    try {
      const res = await fetch(
        `/api/indicators/${symbol}?timeframe=${timeframe.value}&unit=${timeframe.unit}`
      );
      const data = await res.json();

      if (res.ok && data.candles && data.candles.length > 0) {
        setChartDataBySymbol(prev => ({
          ...prev,
          [cacheKey]: data.candles,
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch chart data for ${symbol}:`, err);
    } finally {
      setLoadingSymbols(prev => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  }, [loadingSymbols, selectedTimeframe]);

  // Fetch data for all watchlist symbols on mount and periodically
  useEffect(() => {
    const symbolsToFetch = watchlist.slice(0, maxCharts);

    // Initial fetch for current timeframe
    symbolsToFetch.forEach(symbol => {
      const cacheKey = getCacheKey(symbol, selectedTimeframe);
      if (!chartDataBySymbol[cacheKey]) {
        fetchChartData(symbol, selectedTimeframe);
      }
    });

    // Periodic refresh
    const interval = setInterval(() => {
      symbolsToFetch.forEach(symbol => fetchChartData(symbol, selectedTimeframe));
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [watchlist, maxCharts, refreshInterval, selectedTimeframe]);

  // Handle timeframe change
  const handleTimeframeChange = (newTimeframe) => {
    setSelectedTimeframe(newTimeframe);
    // Fetch data for all symbols with new timeframe
    watchlist.slice(0, maxCharts).forEach(symbol => {
      fetchChartData(symbol, newTimeframe);
    });
  };

  // Get trades for a specific symbol
  const getTradesForSymbol = (symbol) => {
    return trades.filter(t =>
      t.symbol?.toUpperCase() === symbol.toUpperCase()
    );
  };

  // Get position for a specific symbol
  const getPositionForSymbol = (symbol) => {
    return positions.find(p =>
      p.symbol?.toUpperCase() === symbol.toUpperCase()
    ) || null;
  };

  // Symbols to display (limited)
  const displaySymbols = watchlist.slice(0, maxCharts);

  if (displaySymbols.length === 0) {
    return (
      <Card>
        <p style={{ color: theme.colors.textMuted, textAlign: 'center' }}>
          No symbols in watchlist. Add symbols to see charts.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.md }}>
      {/* Timeframe Selector - Global for all charts */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.md,
      }}>
        <span style={{
          fontSize: theme.typography.fontSize.sm,
          color: theme.colors.textMuted,
          fontWeight: theme.typography.fontWeight.medium,
        }}>
          Watchlist Charts ({displaySymbols.length})
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.label}
              onClick={() => handleTimeframeChange(tf)}
              style={{
                padding: '4px 10px',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: selectedTimeframe.label === tf.label
                  ? theme.typography.fontWeight.bold
                  : theme.typography.fontWeight.medium,
                backgroundColor: selectedTimeframe.label === tf.label
                  ? theme.colors.primary
                  : 'transparent',
                color: selectedTimeframe.label === tf.label
                  ? '#fff'
                  : theme.colors.textMuted,
                border: `1px solid ${selectedTimeframe.label === tf.label
                  ? theme.colors.primary
                  : theme.colors.gray300}`,
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {displaySymbols.map(symbol => {
        const cacheKey = getCacheKey(symbol, selectedTimeframe);
        const candles = chartDataBySymbol[cacheKey] || [];
        const symbolTrades = getTradesForSymbol(symbol);
        const position = getPositionForSymbol(symbol);
        const isLoading = loadingSymbols.has(cacheKey);
        const isExpanded = expandedSymbol === symbol;
        const chartHeight = isExpanded ? 500 : height;

        return (
          <Card key={symbol} style={{ padding: theme.spacing.sm }}>
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: theme.spacing.xs,
                cursor: 'pointer',
              }}
              onClick={() => setExpandedSymbol(isExpanded ? null : symbol)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
                <span style={{ fontWeight: 'bold', fontSize: theme.typography.fontSize.md }}>
                  {symbol}
                </span>
                {position && (
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      padding: '2px 6px',
                      borderRadius: theme.borderRadius.sm,
                      backgroundColor: parseFloat(position.unrealizedPL || position.unrealized_pl || 0) >= 0 ? '#dcfce7' : '#fee2e2',
                      color: parseFloat(position.unrealizedPL || position.unrealized_pl || 0) >= 0 ? '#166534' : '#991b1b',
                    }}
                  >
                    {parseFloat(position.quantity || position.qty || 0)} shares | {parseFloat(position.unrealizedPL || position.unrealized_pl || 0) >= 0 ? '+' : ''}
                    ${parseFloat(position.unrealizedPL || position.unrealized_pl || 0).toFixed(2)}
                  </span>
                )}
                {symbolTrades.length > 0 && (
                  <span
                    style={{
                      fontSize: theme.typography.fontSize.xs,
                      color: theme.colors.textMuted,
                    }}
                  >
                    {symbolTrades.length} trade{symbolTrades.length !== 1 ? 's' : ''} today
                  </span>
                )}
              </div>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: theme.colors.textMuted,
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            </div>

            {/* Chart */}
            {isLoading && candles.length === 0 ? (
              <div
                style={{
                  height: chartHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.colors.textMuted,
                  backgroundColor: theme.colors.gray50,
                  borderRadius: theme.borderRadius.sm,
                }}
              >
                Loading {selectedTimeframe.label} chart...
              </div>
            ) : candles.length === 0 ? (
              <div
                style={{
                  height: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.colors.textMuted,
                  backgroundColor: theme.colors.gray50,
                  borderRadius: theme.borderRadius.sm,
                }}
              >
                No data available for {symbol}
              </div>
            ) : (
              <TradingViewChart
                symbol={symbol}
                candles={candles}
                currentCandleIndex={candles.length - 1}
                trades={symbolTrades}
                currentPosition={position}
                dayOpen={candles[0]?.open || 0}
                height={chartHeight}
                showRSI={isExpanded}
              />
            )}
          </Card>
        );
      })}

      {watchlist.length > maxCharts && (
        <p style={{
          color: theme.colors.textMuted,
          fontSize: theme.typography.fontSize.sm,
          textAlign: 'center',
        }}>
          Showing {maxCharts} of {watchlist.length} symbols.
          Remove symbols from watchlist to see others.
        </p>
      )}
    </div>
  );
};

export default WatchlistCharts;
