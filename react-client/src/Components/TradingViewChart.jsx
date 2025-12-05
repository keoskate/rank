/**
 * TradingView Chart Component
 *
 * Professional candlestick charts using TradingView Lightweight Charts.
 * Features: OHLCV display, indicator overlays, trade markers, multi-timeframe.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTradingViewChart } from '../hooks/useTradingViewChart';
import Button from './common/Button';
import Card from './common/Card';
import theme from '../theme';

const TIMEFRAMES = [
  { label: '1m', value: '1', multiplier: 1 },
  { label: '5m', value: '5', multiplier: 5 },
  { label: '15m', value: '15', multiplier: 15 },
  { label: '1H', value: '60', multiplier: 60 },
  { label: '4H', value: '240', multiplier: 240 },
  { label: '1D', value: 'day', multiplier: 1440 }
];

const INDICATORS = [
  { id: 'ema9', label: 'EMA 9', color: '#2196F3', enabled: false },
  { id: 'ema21', label: 'EMA 21', color: '#4CAF50', enabled: false },
  { id: 'ema50', label: 'EMA 50', color: '#FF9800', enabled: false },
  { id: 'ema200', label: 'EMA 200', color: '#9C27B0', enabled: false },
  { id: 'vwap', label: 'VWAP', color: '#E91E63', enabled: true },
  { id: 'bollinger', label: 'Bollinger Bands', color: '#9C27B0', enabled: false }
];

const TradingViewChart = ({
  symbol,
  candles = [],
  indicators = {},
  trades = [],
  height = 500,
  onTimeframeChange,
  showControls = true,
  showLegend = true,
  showToolbar = true,
  title
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('5');
  const [activeIndicators, setActiveIndicators] = useState(
    INDICATORS.reduce((acc, ind) => ({ ...acc, [ind.id]: ind.enabled }), {})
  );
  const [crosshairData, setCrosshairData] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    chartContainerRef,
    isReady,
    setCandlestickData,
    updateCandle,
    addEMALine,
    addBollingerBands,
    addVWAP,
    setTradeMarkers,
    removeIndicator,
    clearIndicators,
    subscribeCrosshairMove,
    fitContent,
    takeScreenshot,
    setTheme
  } = useTradingViewChart({ height: isFullscreen ? window.innerHeight - 150 : height });

  // Set candle data when available
  useEffect(() => {
    if (isReady && candles.length > 0) {
      setCandlestickData(candles);
    }
  }, [isReady, candles, setCandlestickData]);

  // Handle indicator toggles
  useEffect(() => {
    if (!isReady || !indicators) return;

    // EMA indicators
    ['ema9', 'ema21', 'ema50', 'ema200'].forEach((emaId) => {
      const period = parseInt(emaId.replace('ema', ''));
      if (activeIndicators[emaId] && indicators[emaId]) {
        const indicatorConfig = INDICATORS.find((i) => i.id === emaId);
        addEMALine(emaId, indicators[emaId], {
          color: indicatorConfig?.color || '#2196F3',
          title: `EMA ${period}`
        });
      } else {
        removeIndicator(emaId);
      }
    });

    // VWAP
    if (activeIndicators.vwap && indicators.vwap) {
      addVWAP(indicators.vwap);
    } else {
      removeIndicator('vwap');
    }

    // Bollinger Bands
    if (activeIndicators.bollinger && indicators.bollingerBands) {
      addBollingerBands(indicators.bollingerBands);
    } else {
      removeIndicator('bb_upper');
      removeIndicator('bb_middle');
      removeIndicator('bb_lower');
    }
  }, [
    isReady,
    activeIndicators,
    indicators,
    addEMALine,
    addVWAP,
    addBollingerBands,
    removeIndicator
  ]);

  // Set trade markers
  useEffect(() => {
    if (isReady && trades.length > 0) {
      setTradeMarkers(trades);
    }
  }, [isReady, trades, setTradeMarkers]);

  // Subscribe to crosshair movement
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = subscribeCrosshairMove((param) => {
      if (param.time) {
        const data = param.seriesData.get(param.series);
        if (data) {
          setCrosshairData({
            time: param.time,
            ...data
          });
        }
      } else {
        setCrosshairData(null);
      }
    });

    return unsubscribe;
  }, [isReady, subscribeCrosshairMove]);

  // Handle timeframe change
  const handleTimeframeChange = useCallback(
    (tf) => {
      setSelectedTimeframe(tf);
      if (onTimeframeChange) {
        onTimeframeChange(tf);
      }
    },
    [onTimeframeChange]
  );

  // Toggle indicator
  const toggleIndicator = useCallback((indicatorId) => {
    setActiveIndicators((prev) => ({
      ...prev,
      [indicatorId]: !prev[indicatorId]
    }));
  }, []);

  // Handle screenshot
  const handleScreenshot = useCallback(() => {
    const dataUrl = takeScreenshot();
    if (dataUrl) {
      const link = document.createElement('a');
      link.download = `${symbol}_chart_${new Date().toISOString()}.png`;
      link.href = dataUrl;
      link.click();
    }
  }, [symbol, takeScreenshot]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Format OHLCV for legend display
  const formatPrice = (price) => {
    if (price === undefined || price === null) return '-';
    return price.toFixed(2);
  };

  const formatVolume = (volume) => {
    if (volume === undefined || volume === null) return '-';
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(2)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(2)}K`;
    return volume.toString();
  };

  // Current candle data (from crosshair or last candle)
  const displayData = useMemo(() => {
    if (crosshairData) return crosshairData;
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      return {
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume
      };
    }
    return null;
  }, [crosshairData, candles]);

  const priceChange = displayData
    ? displayData.close - displayData.open
    : 0;
  const priceChangePercent = displayData?.open
    ? ((priceChange / displayData.open) * 100).toFixed(2)
    : 0;

  const containerStyle = isFullscreen
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: '#1a1a2e',
        padding: theme.spacing.md
      }
    : {};

  return (
    <div style={containerStyle}>
      <Card padding="none" style={{ overflow: 'hidden' }}>
        {/* Header */}
        {(showControls || title) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: theme.spacing.sm,
              borderBottom: `1px solid ${theme.colors.gray200}`,
              backgroundColor: theme.colors.gray50
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md }}>
              {title && (
                <span
                  style={{
                    fontSize: theme.typography.fontSize.lg,
                    fontWeight: theme.typography.fontWeight.bold
                  }}
                >
                  {title || symbol}
                </span>
              )}

              {/* Timeframe selector */}
              {showControls && (
                <div style={{ display: 'flex', gap: theme.spacing.xs }}>
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => handleTimeframeChange(tf.value)}
                      style={{
                        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                        border: 'none',
                        borderRadius: theme.borderRadius.sm,
                        backgroundColor:
                          selectedTimeframe === tf.value
                            ? theme.colors.primary
                            : 'transparent',
                        color:
                          selectedTimeframe === tf.value
                            ? '#fff'
                            : theme.colors.gray600,
                        cursor: 'pointer',
                        fontSize: theme.typography.fontSize.sm,
                        fontWeight: theme.typography.fontWeight.medium
                      }}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Toolbar buttons */}
            {showToolbar && (
              <div style={{ display: 'flex', gap: theme.spacing.xs }}>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={fitContent}
                  title="Fit to screen"
                >
                  Fit
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={handleScreenshot}
                  title="Take screenshot"
                >
                  Screenshot
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? 'Exit' : 'Fullscreen'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* OHLCV Legend */}
        {showLegend && displayData && (
          <div
            style={{
              display: 'flex',
              gap: theme.spacing.lg,
              padding: theme.spacing.sm,
              backgroundColor: '#1a1a2e',
              color: '#d1d4dc',
              fontSize: theme.typography.fontSize.sm,
              fontFamily: 'monospace'
            }}
          >
            <span>
              O:{' '}
              <span style={{ color: '#fff' }}>{formatPrice(displayData.open)}</span>
            </span>
            <span>
              H:{' '}
              <span style={{ color: '#26a69a' }}>{formatPrice(displayData.high)}</span>
            </span>
            <span>
              L:{' '}
              <span style={{ color: '#ef5350' }}>{formatPrice(displayData.low)}</span>
            </span>
            <span>
              C:{' '}
              <span
                style={{ color: priceChange >= 0 ? '#26a69a' : '#ef5350' }}
              >
                {formatPrice(displayData.close)}
              </span>
            </span>
            <span
              style={{ color: priceChange >= 0 ? '#26a69a' : '#ef5350' }}
            >
              {priceChange >= 0 ? '+' : ''}
              {formatPrice(priceChange)} ({priceChangePercent}%)
            </span>
            {displayData.volume && (
              <span>
                Vol: <span style={{ color: '#fff' }}>{formatVolume(displayData.volume)}</span>
              </span>
            )}
          </div>
        )}

        {/* Chart container */}
        <div
          ref={chartContainerRef}
          style={{
            width: '100%',
            height: isFullscreen ? window.innerHeight - 200 : height
          }}
        />

        {/* Indicator toggles */}
        {showControls && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: theme.spacing.sm,
              padding: theme.spacing.sm,
              borderTop: `1px solid ${theme.colors.gray200}`,
              backgroundColor: theme.colors.gray50
            }}
          >
            {INDICATORS.map((indicator) => (
              <button
                key={indicator.id}
                onClick={() => toggleIndicator(indicator.id)}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                  border: `1px solid ${activeIndicators[indicator.id] ? indicator.color : theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm,
                  backgroundColor: activeIndicators[indicator.id]
                    ? `${indicator.color}20`
                    : 'transparent',
                  color: activeIndicators[indicator.id]
                    ? indicator.color
                    : theme.colors.gray600,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.xs,
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.xs
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: indicator.color,
                    opacity: activeIndicators[indicator.id] ? 1 : 0.3
                  }}
                />
                {indicator.label}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default TradingViewChart;
