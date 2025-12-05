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
  { label: '1Y', value: '1', unit: 'day', days: 365 }
];

const INDICATORS = [
  { id: 'ema9', label: 'EMA 9', color: '#2196F3' },
  { id: 'ema21', label: 'EMA 21', color: '#FF9800' },
  { id: 'ema50', label: 'EMA 50', color: '#9C27B0' },
  { id: 'vwap', label: 'VWAP', color: '#E91E63' }
];

const PriceChart = ({ symbol, height = 400, showControls = true }) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState(TIMEFRAMES[1]); // Default 1W
  const [activeIndicators, setActiveIndicators] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const {
    chartContainerRef,
    isReady,
    setCandlestickData,
    addEMALine,
    addVWAP,
    removeIndicator,
    fitContent
  } = useTradingViewChart({ height });

  // Fetch chart data
  const fetchData = useCallback(async () => {
    if (!symbol || !isReady) return;

    setLoading(true);
    setError(null);

    try {
      const { value: multiplier, unit, days } = selectedTimeframe;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const res = await fetch(
        `/api/polygon/aggregates/${symbol}/${multiplier}/${unit}?` +
        `from=${startDate.toISOString().split('T')[0]}&to=${endDate.toISOString().split('T')[0]}`
      );

      if (!res.ok) throw new Error('Failed to fetch chart data');

      const data = await res.json();

      if (data.results && data.results.length > 0) {
        const candles = data.results.map(bar => ({
          time: Math.floor(bar.t / 1000),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v
        }));

        setCandlestickData(candles);

        // Calculate and add active indicators
        if (activeIndicators.ema9) calculateAndAddEMA(candles, 9, 'ema9', '#2196F3');
        if (activeIndicators.ema21) calculateAndAddEMA(candles, 21, 'ema21', '#FF9800');
        if (activeIndicators.ema50) calculateAndAddEMA(candles, 50, 'ema50', '#9C27B0');
        if (activeIndicators.vwap) calculateAndAddVWAP(candles);

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
      const value = (closes[i] - ema[ema.length - 1].value) * multiplier + ema[ema.length - 1].value;
      ema.push({ time: candles[i].time, value });
    }

    addEMALine(id, ema, { color, lineWidth: 1, title: `EMA ${period}` });
  };

  // Calculate VWAP
  const calculateAndAddVWAP = (candles) => {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    const vwapData = candles.map(candle => {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeTPV += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
      return {
        time: candle.time,
        value: cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice
      };
    });

    addVWAP(vwapData);
  };

  // Toggle indicator
  const toggleIndicator = (id) => {
    setActiveIndicators(prev => {
      const newState = { ...prev, [id]: !prev[id] };
      if (!newState[id]) {
        removeIndicator(id);
      }
      return newState;
    });
  };

  return (
    <div style={{
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      overflow: 'hidden',
      boxShadow: theme.shadows.sm
    }}>
      {/* Controls */}
      {showControls && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: theme.spacing.sm,
          borderBottom: `1px solid ${theme.colors.gray200}`,
          backgroundColor: theme.colors.gray50,
          flexWrap: 'wrap',
          gap: theme.spacing.sm
        }}>
          {/* Timeframe Selector */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.label}
                onClick={() => setSelectedTimeframe(tf)}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                  border: 'none',
                  backgroundColor: selectedTimeframe.label === tf.label
                    ? theme.colors.primary
                    : 'transparent',
                  color: selectedTimeframe.label === tf.label
                    ? theme.colors.white
                    : theme.colors.gray600,
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.sm,
                  fontWeight: theme.typography.fontWeight.medium
                }}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Indicator Toggles */}
          <div style={{ display: 'flex', gap: theme.spacing.xs, flexWrap: 'wrap' }}>
            {INDICATORS.map(ind => (
              <button
                key={ind.id}
                onClick={() => toggleIndicator(ind.id)}
                style={{
                  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                  border: `1px solid ${activeIndicators[ind.id] ? ind.color : theme.colors.gray300}`,
                  backgroundColor: activeIndicators[ind.id] ? `${ind.color}20` : 'transparent',
                  color: activeIndicators[ind.id] ? ind.color : theme.colors.gray600,
                  borderRadius: theme.borderRadius.sm,
                  cursor: 'pointer',
                  fontSize: theme.typography.fontSize.xs,
                  fontWeight: theme.typography.fontWeight.medium
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
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            color: theme.colors.gray500
          }}>
            Loading...
          </div>
        )}

        {error && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            color: theme.colors.error,
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <div ref={chartContainerRef} style={{ height }} />
      </div>
    </div>
  );
};

export default PriceChart;
