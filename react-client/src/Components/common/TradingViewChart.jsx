import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import theme from '../../theme';

/**
 * TradingView Lightweight Charts V2 Component
 *
 * Full-width interactive candlestick chart with:
 * - Real candlesticks (OHLC)
 * - Volume bars
 * - Buy/Sell markers
 * - Current position indicator
 * - Responsive sizing
 */
const TradingViewChart = ({
  candles = [],
  currentCandleIndex = 0,
  trades = [],
  currentPosition = null,
  dayOpen = 0,
  symbol = '',
  height = 400,
}) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        backgroundColor: '#ffffff',
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: {
        mode: 1, // Normal crosshair
        vertLine: {
          width: 1,
          color: '#9B9B9B',
          style: 2,
        },
        horzLine: {
          width: 1,
          color: '#9B9B9B',
          style: 2,
        },
      },
      rightPriceScale: {
        borderColor: '#e0e0e0',
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: '#e0e0e0',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // Create candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    // Create volume series
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    setIsReady(true);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      setIsReady(false);
    };
  }, []);

  // Update chart data when candles or currentCandleIndex change
  useEffect(() => {
    if (!isReady || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) return;

    const visibleCandles = candles.slice(0, currentCandleIndex + 1);
    if (visibleCandles.length === 0) return;

    // Convert candles to TradingView format
    const candleData = visibleCandles.map(candle => {
      const c = candle.c !== undefined ? candle : {
        o: candle.open,
        h: candle.high,
        l: candle.low,
        c: candle.close,
        v: candle.volume,
        t: candle.timestamp,
      };

      // Convert timestamp to seconds (TradingView expects Unix timestamp in seconds)
      const time = Math.floor(new Date(c.t || candle.timestamp).getTime() / 1000);

      return {
        time,
        open: c.o || c.open,
        high: c.h || c.high,
        low: c.l || c.low,
        close: c.c || c.close,
      };
    }).filter(c => c.open && c.high && c.low && c.close);

    const volumeData = visibleCandles.map(candle => {
      const c = candle.c !== undefined ? candle : {
        o: candle.open,
        c: candle.close,
        v: candle.volume,
        t: candle.timestamp,
      };

      const time = Math.floor(new Date(c.t || candle.timestamp).getTime() / 1000);
      const close = c.c || c.close;
      const open = c.o || c.open;

      return {
        time,
        value: c.v || c.volume || 0,
        color: close >= open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      };
    }).filter(v => v.value > 0);

    // Set data
    candlestickSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Add markers for trades
    const markers = [];

    trades.forEach((trade, index) => {
      const tradeTime = Math.floor(new Date(trade.timestamp).getTime() / 1000);

      // Find if this trade is visible
      const isVisible = candleData.some(c => Math.abs(c.time - tradeTime) < 300); // Within 5 min
      if (!isVisible) return;

      if (trade.type === 'BUY') {
        markers.push({
          time: tradeTime,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: `Buy $${trade.price.toFixed(2)}`,
        });
      } else if (trade.type === 'SELL') {
        markers.push({
          time: tradeTime,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: `Sell $${trade.price.toFixed(2)}`,
        });
      }
    });

    // Sort markers by time
    markers.sort((a, b) => a.time - b.time);
    candlestickSeriesRef.current.setMarkers(markers);

    // Scroll to show latest candle
    if (candleData.length > 0) {
      chartRef.current.timeScale().scrollToPosition(2, false);
    }

  }, [candles, currentCandleIndex, trades, isReady]);

  // Update chart height
  useEffect(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  // Calculate stats for header
  const getStats = () => {
    if (candles.length === 0 || currentCandleIndex < 0) {
      return { currentPrice: 0, change: 0, changePercent: 0 };
    }

    const currentCandle = candles[currentCandleIndex];
    const c = currentCandle?.c !== undefined ? currentCandle : currentCandle;
    const currentPrice = c?.c || c?.close || 0;
    const openPrice = dayOpen || (candles[0]?.o || candles[0]?.open || currentPrice);
    const change = currentPrice - openPrice;
    const changePercent = openPrice ? (change / openPrice) * 100 : 0;

    return { currentPrice, change, changePercent };
  };

  const stats = getStats();
  const isPositive = stats.change >= 0;

  return (
    <div style={{
      width: '100%',
      backgroundColor: '#fff',
      borderRadius: theme.borderRadius.lg,
      border: `1px solid ${theme.colors.border}`,
      overflow: 'hidden',
    }}>
      {/* Chart Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: theme.spacing.md,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.gray50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
          <span style={{
            fontSize: theme.typography.fontSize.lg,
            fontWeight: 'bold',
          }}>
            {symbol || 'Chart'}
          </span>
          <span style={{
            fontSize: theme.typography.fontSize.xl,
            fontWeight: 'bold',
            color: isPositive ? '#22c55e' : '#ef4444',
          }}>
            ${stats.currentPrice.toFixed(2)}
          </span>
          <span style={{
            fontSize: theme.typography.fontSize.md,
            color: isPositive ? '#22c55e' : '#ef4444',
          }}>
            {isPositive ? '+' : ''}{stats.change.toFixed(2)} ({isPositive ? '+' : ''}{stats.changePercent.toFixed(2)}%)
          </span>
        </div>

        {currentPosition && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.md}`,
            backgroundColor: '#dbeafe',
            borderRadius: theme.borderRadius.md,
            fontSize: theme.typography.fontSize.sm,
          }}>
            <span style={{ fontWeight: 'bold' }}>Position:</span>
            <span>{currentPosition.quantity} shares @ ${currentPosition.entryPrice?.toFixed(2)}</span>
            {stats.currentPrice > 0 && currentPosition.entryPrice && (
              <span style={{
                color: stats.currentPrice >= currentPosition.entryPrice ? '#22c55e' : '#ef4444',
                fontWeight: 'bold',
              }}>
                ({((stats.currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice * 100).toFixed(2)}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* TradingView Chart */}
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height: height,
        }}
      />

      {/* Chart Footer - Legend */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: theme.spacing.lg,
        padding: theme.spacing.sm,
        borderTop: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.gray50,
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.textMuted,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '8px solid #22c55e' }}></span>
          Buy Order
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '8px solid #ef4444' }}></span>
          Sell Order
        </span>
        <span>Scroll to zoom • Drag to pan</span>
      </div>
    </div>
  );
};

export default TradingViewChart;
