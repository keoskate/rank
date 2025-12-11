import React, { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';
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
// Default indicator visibility settings
const DEFAULT_INDICATORS = {
  vwap: true,
  vwapBands: false, // StdDev bands off by default (can be noisy)
  ma20: true,
  ema9: true,
  volume: true,
  rsi: true,
};

// Load indicator preferences from localStorage
const loadIndicatorPrefs = () => {
  try {
    const saved = localStorage.getItem('chart-indicators');
    if (saved) {
      return { ...DEFAULT_INDICATORS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load indicator preferences:', e);
  }
  return DEFAULT_INDICATORS;
};

const TradingViewChart = ({
  candles = [],
  currentCandleIndex = 0,
  trades = [],
  currentPosition = null,
  dayOpen = 0,
  symbol = '',
  height = 400,
  showRSI = true, // Show RSI panel by default
  rsiHeight = 120,
}) => {
  const chartContainerRef = useRef(null);
  const rsiContainerRef = useRef(null);
  const chartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const vwapSeriesRef = useRef(null);
  const ma20SeriesRef = useRef(null);
  const ema9SeriesRef = useRef(null);
  const rsiSeriesRef = useRef(null);
  const rsiSignalSeriesRef = useRef(null);
  // VWAP StdDev Bands refs
  const vwapBandU1Ref = useRef(null);
  const vwapBandD1Ref = useRef(null);
  const vwapBandU2Ref = useRef(null);
  const vwapBandD2Ref = useRef(null);
  const vwapBandU3Ref = useRef(null);
  const vwapBandD3Ref = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [chartError, setChartError] = useState(null);

  // Indicator visibility state with localStorage persistence
  const [indicators, setIndicators] = useState(loadIndicatorPrefs);

  // Save indicator preferences to localStorage
  const toggleIndicator = (key) => {
    setIndicators(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('chart-indicators', JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save indicator preferences:', e);
      }
      return updated;
    });
  };

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Get createChart from library - handle various export formats
    const createChart = LightweightCharts.createChart ||
                        (LightweightCharts.default && LightweightCharts.default.createChart);

    if (typeof createChart !== 'function') {
      console.error('lightweight-charts createChart not found. Available exports:', Object.keys(LightweightCharts));
      setChartError('Chart library failed to load');
      return;
    }

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

    // Create VWAP line series (blue dotted)
    const vwapSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: 2, // Dashed
      title: 'VWAP',
    });

    // Create 20-period MA line series (orange)
    const ma20Series = chart.addLineSeries({
      color: '#f97316',
      lineWidth: 1,
      title: 'MA20',
    });

    // Create 9-period EMA line series (purple, for momentum)
    const ema9Series = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 1,
      title: 'EMA9',
    });

    // Create VWAP StdDev Bands (semi-transparent for visual clarity)
    // Band 1: ±1.28 StdDev (gray, closest to VWAP)
    const vwapBandU1 = chart.addLineSeries({
      color: 'rgba(156, 163, 175, 0.6)', // gray
      lineWidth: 1,
      lineStyle: 2, // Dashed
      title: 'VWAP +1σ',
    });
    const vwapBandD1 = chart.addLineSeries({
      color: 'rgba(156, 163, 175, 0.6)',
      lineWidth: 1,
      lineStyle: 2,
      title: 'VWAP -1σ',
    });

    // Band 2: ±2.01 StdDev (red/green for overbought/oversold zones)
    const vwapBandU2 = chart.addLineSeries({
      color: 'rgba(239, 68, 68, 0.5)', // red
      lineWidth: 1,
      title: 'VWAP +2σ',
    });
    const vwapBandD2 = chart.addLineSeries({
      color: 'rgba(34, 197, 94, 0.5)', // green
      lineWidth: 1,
      title: 'VWAP -2σ',
    });

    // Band 3: ±2.51 StdDev (stronger red/green for extreme zones)
    const vwapBandU3 = chart.addLineSeries({
      color: 'rgba(220, 38, 38, 0.6)', // darker red
      lineWidth: 1,
      title: 'VWAP +3σ',
    });
    const vwapBandD3 = chart.addLineSeries({
      color: 'rgba(22, 163, 74, 0.6)', // darker green
      lineWidth: 1,
      title: 'VWAP -3σ',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    vwapSeriesRef.current = vwapSeries;
    ma20SeriesRef.current = ma20Series;
    ema9SeriesRef.current = ema9Series;
    vwapBandU1Ref.current = vwapBandU1;
    vwapBandD1Ref.current = vwapBandD1;
    vwapBandU2Ref.current = vwapBandU2;
    vwapBandD2Ref.current = vwapBandD2;
    vwapBandU3Ref.current = vwapBandU3;
    vwapBandD3Ref.current = vwapBandD3;

    // Create RSI chart if enabled and container exists
    let rsiChart = null;
    let rsiSeries = null;
    let rsiSignalSeries = null;

    if (showRSI && rsiContainerRef.current) {
      rsiChart = createChart(rsiContainerRef.current, {
        layout: {
          backgroundColor: '#ffffff',
          textColor: '#333',
        },
        grid: {
          vertLines: { color: '#f0f0f0' },
          horzLines: { color: '#f5f5f5' },
        },
        crosshair: {
          mode: 1,
          vertLine: { width: 1, color: '#9B9B9B', style: 2 },
          horzLine: { width: 1, color: '#9B9B9B', style: 2 },
        },
        rightPriceScale: {
          borderColor: '#e0e0e0',
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: '#e0e0e0',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      });

      // RSI line series with dynamic coloring
      rsiSeries = rsiChart.addLineSeries({
        color: '#9ca3af', // Default gray, will be overridden per-point
        lineWidth: 2,
        title: 'RSI',
        priceFormat: { type: 'custom', formatter: (price) => price.toFixed(1) },
      });

      // Signal line (EMA of RSI)
      rsiSignalSeries = rsiChart.addLineSeries({
        color: '#ff5d00',
        lineWidth: 1,
        title: 'Signal',
      });

      rsiChartRef.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;
      rsiSignalSeriesRef.current = rsiSignalSeries;
    }

    setIsReady(true);

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
      if (rsiChart && rsiContainerRef.current) {
        rsiChart.applyOptions({
          width: rsiContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    // Sync time scales between main chart and RSI
    if (rsiChart) {
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && rsiChart) {
          rsiChart.timeScale().setVisibleLogicalRange(range);
        }
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && chart) {
          chart.timeScale().setVisibleLogicalRange(range);
        }
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      if (rsiChart) rsiChart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
      vwapSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ema9SeriesRef.current = null;
      vwapBandU1Ref.current = null;
      vwapBandD1Ref.current = null;
      vwapBandU2Ref.current = null;
      vwapBandD2Ref.current = null;
      vwapBandU3Ref.current = null;
      vwapBandD3Ref.current = null;
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
      rsiSignalSeriesRef.current = null;
      setIsReady(false);
    };
  }, [showRSI]);

  // Helper functions for calculating indicators
  const calculateSMA = (data, period) => {
    if (!Array.isArray(data) || data.length === 0) return [];

    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].close;
      }
      result.push({ time: data[i].time, value: sum / period });
    }
    return result;
  };

  const calculateEMA = (data, period) => {
    if (!Array.isArray(data) || data.length === 0) return [];

    const result = [];
    const multiplier = 2 / (period + 1);

    // Start with SMA for first value
    let sum = 0;
    for (let i = 0; i < period && i < data.length; i++) {
      sum += data[i].close;
    }
    let ema = sum / Math.min(period, data.length);

    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        // Not enough data yet, skip
        continue;
      } else if (i === period - 1) {
        result.push({ time: data[i].time, value: ema });
      } else {
        ema = (data[i].close - ema) * multiplier + ema;
        result.push({ time: data[i].time, value: ema });
      }
    }
    return result;
  };

  const calculateVWAP = (data, volumeData) => {
    if (!Array.isArray(data) || data.length === 0) return [];

    const result = [];
    let cumulativeTPV = 0; // Cumulative (Typical Price * Volume)
    let cumulativeVolume = 0;

    for (let i = 0; i < data.length; i++) {
      const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
      const volume = volumeData[i]?.value || 0;

      cumulativeTPV += typicalPrice * volume;
      cumulativeVolume += volume;

      if (cumulativeVolume > 0) {
        result.push({ time: data[i].time, value: cumulativeTPV / cumulativeVolume });
      }
    }
    return result;
  };

  /**
   * Calculate VWAP with Standard Deviation Bands
   * Based on Pine Script: VWAP Stdev Bands v2
   *
   * VWAP = Cumulative(TypicalPrice * Volume) / Cumulative(Volume)
   * StdDev = sqrt(Cumulative(Volume * TP^2) / Cumulative(Volume) - VWAP^2)
   *
   * Bands at various sigma levels:
   * - Band 1: ±1.28σ (80% confidence)
   * - Band 2: ±2.01σ (95% confidence)
   * - Band 3: ±2.51σ (99% confidence)
   */
  const calculateVWAPWithBands = (data, volumeData) => {
    if (!Array.isArray(data) || data.length === 0) {
      return { vwap: [], bandU1: [], bandD1: [], bandU2: [], bandD2: [], bandU3: [], bandD3: [] };
    }

    const vwap = [];
    const bandU1 = [], bandD1 = [];
    const bandU2 = [], bandD2 = [];
    const bandU3 = [], bandD3 = [];

    // Standard deviation multipliers (from Pine Script)
    const dev1 = 1.28;
    const dev2 = 2.01;
    const dev3 = 2.51;

    let cumulativeTPV = 0;    // Sum of (TP * Volume)
    let cumulativeVolume = 0; // Sum of Volume
    let cumulativeV2 = 0;     // Sum of (Volume * TP^2)

    for (let i = 0; i < data.length; i++) {
      const high = data[i].high;
      const low = data[i].low;
      const close = data[i].close;
      const tp = (high + low) / 2; // hl2 in Pine Script
      const volume = volumeData[i]?.value || 0;

      if (volume <= 0) continue;

      cumulativeTPV += tp * volume;
      cumulativeVolume += volume;
      cumulativeV2 += volume * tp * tp;

      if (cumulativeVolume > 0) {
        const vwapValue = cumulativeTPV / cumulativeVolume;
        // Variance = E[X^2] - E[X]^2
        const variance = Math.max(0, cumulativeV2 / cumulativeVolume - vwapValue * vwapValue);
        const stdDev = Math.sqrt(variance);

        const time = data[i].time;
        vwap.push({ time, value: vwapValue });

        // Calculate bands at each sigma level
        bandU1.push({ time, value: vwapValue + dev1 * stdDev });
        bandD1.push({ time, value: vwapValue - dev1 * stdDev });
        bandU2.push({ time, value: vwapValue + dev2 * stdDev });
        bandD2.push({ time, value: vwapValue - dev2 * stdDev });
        bandU3.push({ time, value: vwapValue + dev3 * stdDev });
        bandD3.push({ time, value: vwapValue - dev3 * stdDev });
      }
    }

    return { vwap, bandU1, bandD1, bandU2, bandD2, bandU3, bandD3 };
  };

  // Calculate RMA (Relative Moving Average / Wilder's Smoothing)
  const calculateRMA = (values, period) => {
    const result = [];
    let rma = 0;
    const alpha = 1 / period;

    for (let i = 0; i < values.length; i++) {
      if (i < period - 1) {
        // Build up initial average
        rma += values[i] / period;
        if (i === period - 2) {
          rma += values[i + 1] / period;
        }
      } else if (i === period - 1) {
        result.push(rma);
      } else {
        rma = alpha * values[i] + (1 - alpha) * rma;
        result.push(rma);
      }
    }
    return result;
  };

  /**
   * Calculate Ultimate RSI (LuxAlgo-style)
   * Based on Pine Script from TradingView
   *
   * Uses range-based calculation:
   * - If upper range expands: diff = range (bullish)
   * - If lower range expands: diff = -range (bearish)
   * - Otherwise: diff = price change
   *
   * Returns both RSI and signal line values
   */
  const calculateUltimateRSI = (data, length = 14, signalLength = 14) => {
    if (!Array.isArray(data) || data.length < length + 1) return { rsi: [], signal: [] };

    // Extract close prices and calculate ranges
    const closes = data.map(d => d.close);
    const highs = data.map(d => d.high);
    const lows = data.map(d => d.low);

    // Calculate rolling highest high and lowest low
    const upper = [];
    const lower = [];
    for (let i = 0; i < data.length; i++) {
      if (i < length - 1) {
        upper.push(null);
        lower.push(null);
      } else {
        let maxHigh = highs[i];
        let minLow = lows[i];
        for (let j = 1; j < length; j++) {
          maxHigh = Math.max(maxHigh, highs[i - j]);
          minLow = Math.min(minLow, lows[i - j]);
        }
        upper.push(maxHigh);
        lower.push(minLow);
      }
    }

    // Calculate diff based on range expansion
    const diff = [];
    for (let i = 0; i < data.length; i++) {
      if (i < length || upper[i] === null) {
        diff.push(0);
      } else {
        const range = upper[i] - lower[i];
        const priceChange = closes[i] - closes[i - 1];
        const prevUpper = upper[i - 1];
        const prevLower = lower[i - 1];

        if (upper[i] > prevUpper) {
          diff.push(range); // Bullish expansion
        } else if (lower[i] < prevLower) {
          diff.push(-range); // Bearish expansion
        } else {
          diff.push(priceChange); // Normal price change
        }
      }
    }

    // Calculate RMA of diff (numerator) and RMA of abs(diff) (denominator)
    const diffSlice = diff.slice(length);
    const absDiffSlice = diffSlice.map(d => Math.abs(d));

    const numRMA = calculateRMA(diffSlice, length);
    const denRMA = calculateRMA(absDiffSlice, length);

    // Calculate Ultimate RSI: (num/den) * 50 + 50
    const rsiValues = [];
    for (let i = 0; i < numRMA.length; i++) {
      const den = denRMA[i] || 0.0001; // Avoid division by zero
      const rsiValue = (numRMA[i] / den) * 50 + 50;
      rsiValues.push(Math.max(0, Math.min(100, rsiValue))); // Clamp to 0-100
    }

    // Calculate signal line (EMA of RSI)
    const signalValues = [];
    if (rsiValues.length >= signalLength) {
      const multiplier = 2 / (signalLength + 1);
      let ema = rsiValues.slice(0, signalLength).reduce((a, b) => a + b, 0) / signalLength;

      for (let i = 0; i < rsiValues.length; i++) {
        if (i < signalLength - 1) {
          signalValues.push(null);
        } else if (i === signalLength - 1) {
          signalValues.push(ema);
        } else {
          ema = (rsiValues[i] - ema) * multiplier + ema;
          signalValues.push(ema);
        }
      }
    }

    // Build result arrays with timestamps
    const startIndex = length + length - 1; // Account for both lookback periods
    const rsiResult = [];
    const signalResult = [];

    for (let i = 0; i < rsiValues.length; i++) {
      const dataIndex = startIndex + i;
      if (dataIndex < data.length) {
        rsiResult.push({
          time: data[dataIndex].time,
          value: rsiValues[i],
        });

        if (signalValues[i] !== null && signalValues[i] !== undefined) {
          signalResult.push({
            time: data[dataIndex].time,
            value: signalValues[i],
          });
        }
      }
    }

    return { rsi: rsiResult, signal: signalResult };
  };

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

    // Set candlestick data (always shown)
    candlestickSeriesRef.current.setData(candleData);

    // Set volume data (respects indicator toggle)
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(indicators.volume ? volumeData : []);
    }

    // Calculate and set technical indicators (respecting visibility toggles)
    if (candleData.length >= 3) {
      // VWAP with StdDev Bands - resets daily
      const vwapBands = calculateVWAPWithBands(candleData, volumeData);

      // VWAP line
      if (vwapSeriesRef.current) {
        vwapSeriesRef.current.setData(indicators.vwap ? vwapBands.vwap : []);
      }

      // VWAP bands (separate toggle)
      if (vwapBandU1Ref.current) {
        const bandData = indicators.vwapBands ? vwapBands : { bandU1: [], bandD1: [], bandU2: [], bandD2: [], bandU3: [], bandD3: [] };
        vwapBandU1Ref.current.setData(bandData.bandU1);
        vwapBandD1Ref.current.setData(bandData.bandD1);
        vwapBandU2Ref.current.setData(bandData.bandU2);
        vwapBandD2Ref.current.setData(bandData.bandD2);
        vwapBandU3Ref.current.setData(bandData.bandU3);
        vwapBandD3Ref.current.setData(bandData.bandD3);
      }

      // 20-period MA (or less if not enough data)
      const ma20Period = Math.min(20, Math.floor(candleData.length / 2));
      if (ma20Period >= 3 && ma20SeriesRef.current) {
        const ma20Data = calculateSMA(candleData, ma20Period);
        ma20SeriesRef.current.setData(indicators.ma20 ? ma20Data : []);
      }

      // 9-period EMA (or less if not enough data)
      const ema9Period = Math.min(9, Math.floor(candleData.length / 2));
      if (ema9Period >= 3 && ema9SeriesRef.current) {
        const ema9Data = calculateEMA(candleData, ema9Period);
        ema9SeriesRef.current.setData(indicators.ema9 ? ema9Data : []);
      }

      // Calculate and update Ultimate RSI (respects both showRSI prop and indicator toggle)
      if (showRSI && indicators.rsi && rsiSeriesRef.current && candleData.length >= 30) {
        const { rsi, signal } = calculateUltimateRSI(candleData, 14, 14);
        if (rsi.length > 0) {
          rsiSeriesRef.current.setData(rsi);
        }
        if (signal.length > 0 && rsiSignalSeriesRef.current) {
          rsiSignalSeriesRef.current.setData(signal);
        }

        // Fit RSI chart content
        if (rsiChartRef.current) {
          rsiChartRef.current.timeScale().fitContent();
        }
      } else if (rsiSeriesRef.current) {
        // Clear RSI data if disabled
        rsiSeriesRef.current.setData([]);
        if (rsiSignalSeriesRef.current) {
          rsiSignalSeriesRef.current.setData([]);
        }
      }
    }

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

    // Fit content and scroll to show latest candle on right side
    if (candleData.length > 0) {
      chartRef.current.timeScale().fitContent();
    }

  }, [candles, currentCandleIndex, trades, isReady, indicators]);

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

  // Show error state if chart failed to load
  if (chartError) {
    return (
      <div style={{
        width: '100%',
        height: height,
        backgroundColor: '#fff',
        borderRadius: theme.borderRadius.lg,
        border: `1px solid ${theme.colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.colors.textMuted,
      }}>
        <span>📊 {chartError}</span>
      </div>
    );
  }

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

      {/* Indicator Toggle Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.xs,
        padding: `${theme.spacing.xs} ${theme.spacing.md}`,
        borderBottom: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.gray50,
        fontSize: '11px',
        flexWrap: 'wrap',
      }}>
        <span style={{ color: theme.colors.textMuted, marginRight: theme.spacing.xs }}>Indicators:</span>
        {[
          { key: 'vwap', label: 'VWAP', color: '#3b82f6' },
          { key: 'vwapBands', label: 'VWAP Bands', color: '#9ca3af' },
          { key: 'ma20', label: 'MA20', color: '#f97316' },
          { key: 'ema9', label: 'EMA9', color: '#8b5cf6' },
          { key: 'volume', label: 'Volume', color: '#26a69a' },
          { key: 'rsi', label: 'RSI', color: '#6366f1' },
        ].map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggleIndicator(key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              border: `1px solid ${indicators[key] ? color : theme.colors.gray300}`,
              borderRadius: theme.borderRadius.sm,
              backgroundColor: indicators[key] ? `${color}15` : 'transparent',
              color: indicators[key] ? color : theme.colors.textMuted,
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: indicators[key] ? 'bold' : 'normal',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '2px',
              backgroundColor: indicators[key] ? color : 'transparent',
              border: `1px solid ${color}`,
            }} />
            {label}
          </button>
        ))}
      </div>

      {/* TradingView Chart */}
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height: height,
        }}
      />

      {/* RSI Panel */}
      {showRSI && (
        <div style={{ borderTop: `1px solid ${theme.colors.border}` }}>
          {/* RSI Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${theme.spacing.xs} ${theme.spacing.md}`,
            backgroundColor: theme.colors.gray50,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.textMuted,
            }}>
              <span style={{ fontWeight: 'bold' }}>Ultimate RSI</span>
              <span style={{ color: '#9ca3af' }}>14</span>
              <span>|</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: 12, height: 2, backgroundColor: '#ff5d00' }}></span>
                Signal 14
              </span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.md,
              fontSize: theme.typography.fontSize.xs,
            }}>
              <span style={{ color: '#089981' }}>OB 80</span>
              <span style={{ color: theme.colors.textMuted }}>50</span>
              <span style={{ color: '#f23645' }}>OS 20</span>
            </div>
          </div>
          {/* RSI Chart */}
          <div
            ref={rsiContainerRef}
            style={{
              width: '100%',
              height: rsiHeight,
            }}
          />
        </div>
      )}

      {/* Chart Footer - Legend */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: theme.spacing.md,
        padding: theme.spacing.sm,
        borderTop: `1px solid ${theme.colors.border}`,
        backgroundColor: theme.colors.gray50,
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.textMuted,
      }}>
        {/* Indicators */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 16, height: 2, backgroundColor: '#3b82f6', borderStyle: 'dashed' }}></span>
          VWAP
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 16, height: 2, backgroundColor: '#f97316' }}></span>
          MA20
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 16, height: 2, backgroundColor: '#8b5cf6' }}></span>
          EMA9
        </span>
        <span style={{ borderLeft: '1px solid #ddd', paddingLeft: theme.spacing.md, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '8px solid #22c55e' }}></span>
          Buy
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '8px solid #ef4444' }}></span>
          Sell
        </span>
      </div>
    </div>
  );
};

export default TradingViewChart;
