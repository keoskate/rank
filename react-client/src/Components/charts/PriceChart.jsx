/**
 * PriceChart - TradingView lightweight-charts wrapper
 * Professional candlestick chart with volume and indicators
 */

import { useState, useEffect, useCallback } from 'react';
import { useTradingViewChart } from '../../hooks/useTradingViewChart';
import theme from '../../theme';

const TIMEFRAMES = [
  { label: '1D', value: '1', unit: 'minute', days: 1 },
  { label: '1W', value: '5', unit: 'minute', days: 7 },
  { label: '1M', value: '15', unit: 'minute', days: 30 },
  { label: '3M', value: '1', unit: 'day', days: 90 },
  { label: '1Y', value: '1', unit: 'day', days: 365 },
];

const INDICATORS = [
  { id: 'ema9', label: 'EMA 9', color: '#2196F3' },
  { id: 'ema21', label: 'EMA 21', color: '#FF9800' },
  { id: 'ema50', label: 'EMA 50', color: '#9C27B0' },
  { id: 'vwap', label: 'VWAP', color: '#E91E63' },
  { id: 'bollinger', label: 'BB', color: '#00BCD4' },
  { id: 'rsi', label: 'RSI', color: '#4CAF50', subPane: true },
];

const PriceChart = ({
  symbol,
  height = 400,
  showControls = true,
  onPeriodChange,
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState(TIMEFRAMES[1]); // Default 1W
  const [activeIndicators, setActiveIndicators] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [rsiData, setRsiData] = useState([]);

  const {
    chartContainerRef,
    isReady,
    setCandlestickData,
    addEMALine,
    addVWAP,
    addBollingerBands,
    removeIndicator,
    fitContent,
  } = useTradingViewChart({ height });

  // Fetch chart data
  const fetchData = useCallback(async () => {
    if (!symbol || !isReady) return;

    setLoading(true);
    setError(null);

    try {
      const { value: multiplier, unit, days } = selectedTimeframe;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      // Fresh Alpaca IEX bars (Polygon aggregates are delayed on this tier).
      // Alpaca's range is [start, end) so 'to' must be tomorrow to include today.
      const token = unit === 'minute' ? String(multiplier) : unit;
      const toStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      const res = await fetch(
        `/api/alpaca/bars/${symbol}/${token}?` +
          `from=${startDate.toISOString().split('T')[0]}&to=${toStr}`
      );

      if (!res.ok) throw new Error('Failed to fetch chart data');

      const data = await res.json();

      if (data.results && data.results.length > 0) {
        const candles = data.results.map(bar => ({
          // Handle both raw Polygon format (t, o, h, l, c, v) and transformed format
          time: bar.time || Math.floor((bar.t || bar.timestamp) / 1000),
          open: bar.open ?? bar.o,
          high: bar.high ?? bar.h,
          low: bar.low ?? bar.l,
          close: bar.close ?? bar.c,
          volume: bar.volume ?? bar.v,
        }));

        setCandlestickData(candles);

        // Calculate period change for parent component
        if (onPeriodChange && candles.length > 0) {
          const firstCandle = candles[0];
          const lastCandle = candles[candles.length - 1];
          const periodOpen = firstCandle.open;
          const currentPrice = lastCandle.close;
          const change = currentPrice - periodOpen;
          const changePercent = periodOpen
            ? (change / periodOpen) * 100
            : 0;
          onPeriodChange({
            price: currentPrice,
            change,
            changePercent,
            periodLabel: selectedTimeframe.label,
          });
        }

        // Calculate and add active indicators
        if (activeIndicators.ema9)
          calculateAndAddEMA(candles, 9, 'ema9', '#2196F3');
        if (activeIndicators.ema21)
          calculateAndAddEMA(candles, 21, 'ema21', '#FF9800');
        if (activeIndicators.ema50)
          calculateAndAddEMA(candles, 50, 'ema50', '#9C27B0');
        if (activeIndicators.vwap) calculateAndAddVWAP(candles);
        if (activeIndicators.bollinger) calculateAndAddBollinger(candles);
        if (activeIndicators.rsi) calculateRSI(candles);

        fitContent();
      }
    } catch (err) {
      console.error('Chart data error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, selectedTimeframe, isReady, activeIndicators]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate EMA
  const calculateAndAddEMA = (candles, period, id, color) => {
    if (candles.length < period) return;

    const closes = candles.map(c => c.close);
    const multiplier = 2 / (period + 1);
    const ema = [];

    // First EMA is SMA
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += closes[i];
    }
    ema.push({ time: candles[period - 1].time, value: sum / period });

    // Calculate rest of EMA
    for (let i = period; i < closes.length; i++) {
      const value =
        (closes[i] - ema[ema.length - 1].value) * multiplier +
        ema[ema.length - 1].value;
      ema.push({ time: candles[i].time, value });
    }

    addEMALine(id, ema, { color, lineWidth: 1, title: `EMA ${period}` });
  };

  // Calculate VWAP
  const calculateAndAddVWAP = candles => {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    const vwapData = candles.map(candle => {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
      return {
        time: candle.time,
        value:
          cumulativeVolume > 0
            ? cumulativeTPV / cumulativeVolume
            : typicalPrice,
      };
    });

    addVWAP(vwapData);
  };

  // Calculate Bollinger Bands (20-period SMA with 2 standard deviations)
  const calculateAndAddBollinger = (candles, period = 20, stdDev = 2) => {
    if (candles.length < period) return;

    const closes = candles.map(c => c.close);
    const bbData = [];

    for (let i = period - 1; i < closes.length; i++) {
      // Calculate SMA for the period
      const slice = closes.slice(i - period + 1, i + 1);
      const sma = slice.reduce((sum, val) => sum + val, 0) / period;

      // Calculate standard deviation
      const squaredDiffs = slice.map(val => Math.pow(val - sma, 2));
      const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / period;
      const std = Math.sqrt(variance);

      bbData.push({
        time: candles[i].time,
        upper: sma + stdDev * std,
        middle: sma,
        lower: sma - stdDev * std,
      });
    }

    addBollingerBands(bbData);
  };

  // Calculate RSI (14-period by default)
  const calculateRSI = (candles, period = 14) => {
    if (candles.length < period + 1) return;

    const closes = candles.map(c => c.close);
    const rsi = [];
    let gains = 0;
    let losses = 0;

    // Calculate initial average gain/loss
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change >= 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // First RSI value
    const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push({
      time: candles[period].time,
      value: 100 - 100 / (1 + firstRS),
    });

    // Calculate remaining RSI values using smoothed averages
    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const currentGain = change >= 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push({
        time: candles[i].time,
        value: 100 - 100 / (1 + rs),
      });
    }

    // Store RSI data for display (could add to a separate pane in future)
    setRsiData(rsi);

    // For now, we'll display RSI as a line on the main chart (scaled to price range)
    // This is a simplified approach - ideally RSI would be in a separate pane
    if (candles.length > 0) {
      const prices = candles.map(c => c.close);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice;

      // Scale RSI (0-100) to fit within the lower portion of the chart
      const scaledRsi = rsi.map(r => ({
        time: r.time,
        value: minPrice + (r.value / 100) * priceRange * 0.3, // Scale to 30% of price range from bottom
      }));

      addEMALine('rsi', scaledRsi, {
        color: '#4CAF50',
        lineWidth: 1,
        title: 'RSI (scaled)',
      });
    }
  };

  // Toggle indicator
  const toggleIndicator = id => {
    setActiveIndicators(prev => {
      const newState = { ...prev, [id]: !prev[id] };
      if (!newState[id]) {
        // Bollinger bands creates multiple series
        if (id === 'bollinger') {
          removeIndicator('bb_upper');
          removeIndicator('bb_middle');
          removeIndicator('bb_lower');
        } else {
          removeIndicator(id);
        }
      }
      return newState;
    });
  };

  return (
    <div
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.borderRadius.lg,
        overflow: 'hidden',
        boxShadow: theme.shadows.sm,
      }}
    >
      {/* Controls */}
      {showControls && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: theme.spacing.sm,
            borderBottom: `1px solid ${theme.colors.gray200}`,
            backgroundColor: theme.colors.gray50,
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
          }}
        >
          {/* Timeframe Selector */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.label}
                onClick={() => setSelectedTimeframe(tf)}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                  border:
                    selectedTimeframe.label === tf.label
                      ? `1px solid ${theme.colors.primary}`
                      : '1px solid transparent',
                  backgroundColor:
                    selectedTimeframe.label === tf.label
                      ? `${theme.colors.primary}15`
                      : 'transparent',
                  color:
                    selectedTimeframe.label === tf.label
                      ? theme.colors.primary
                      : theme.colors.gray600,
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.sm,
                  fontWeight:
                    selectedTimeframe.label === tf.label
                      ? theme.typography.fontWeight.bold
                      : theme.typography.fontWeight.medium,
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Indicator Toggles */}
          <div
            style={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}
          >
            {INDICATORS.map(ind => (
              <button
                key={ind.id}
                onClick={() => toggleIndicator(ind.id)}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                  border: `1px solid ${activeIndicators[ind.id] ? ind.color : theme.colors.gray300}`,
                  backgroundColor: activeIndicators[ind.id]
                    ? `${ind.color}20`
                    : 'transparent',
                  color: activeIndicators[ind.id]
                    ? ind.color
                    : theme.colors.gray600,
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.xs,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                {ind.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chart Container */}
      <div style={{ position: 'relative' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
              color: theme.colors.gray500,
            }}
          >
            Loading...
          </div>
        )}

        {error && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 10,
              color: theme.colors.error,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}

        <div ref={chartContainerRef} style={{ height }} />
      </div>
    </div>
  );
};

export default PriceChart;
