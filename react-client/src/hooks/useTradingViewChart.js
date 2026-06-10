/**
 * TradingView Lightweight Charts Hook
 *
 * React hook for initializing and managing TradingView charts
 * with candlestick data and technical indicators.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart } from '../utils/lightweightChartsShim';

const defaultChartOptions = {
  layout: {
    background: { type: 'solid', color: '#1a1a2e' },
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: '#2B2B43' },
    horzLines: { color: '#2B2B43' },
  },
  crosshair: {
    mode: 1, // Normal crosshair
    vertLine: {
      width: 1,
      color: '#758696',
      style: 2,
    },
    horzLine: {
      width: 1,
      color: '#758696',
      style: 2,
    },
  },
  rightPriceScale: {
    borderColor: '#2B2B43',
    scaleMargins: {
      top: 0.1,
      bottom: 0.2,
    },
  },
  timeScale: {
    borderColor: '#2B2B43',
    timeVisible: true,
    secondsVisible: false,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    mouseWheel: true,
    pinch: true,
  },
};

/**
 * Custom hook for TradingView Lightweight Charts
 * @param {object} options - Chart configuration options
 * @returns {object} Chart control methods and refs
 */
export function useTradingViewChart(options = {}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const indicatorSeriesRef = useRef({});
  const markersRef = useRef([]);
  const [isReady, setIsReady] = useState(false);

  // Initialize chart with retry logic for async library loading
  useEffect(() => {
    if (!chartContainerRef.current) return;

    let retryCount = 0;
    const maxRetries = 10;
    let timeoutId = null;

    const initChart = () => {
      // Check if lightweight-charts is loaded
      const lwc = typeof window !== 'undefined' && window.LightweightCharts;
      if (!lwc || typeof lwc.createChart !== 'function') {
        if (retryCount < maxRetries) {
          retryCount++;
          timeoutId = setTimeout(initChart, 200); // Retry after 200ms
        } else {
          console.error(
            'TradingView lightweight-charts failed to load after retries'
          );
        }
        return;
      }

      const chartOptions = {
        ...defaultChartOptions,
        width: chartContainerRef.current.clientWidth,
        height: options.height || 400,
        ...options.chartOptions,
      };

      try {
        // Create chart directly using window.LightweightCharts
        chartRef.current = lwc.createChart(
          chartContainerRef.current,
          chartOptions
        );

        // Create candlestick series (v3 API)
        candlestickSeriesRef.current = chartRef.current.addCandlestickSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });

        // Create volume series
        volumeSeriesRef.current = chartRef.current.addHistogramSeries({
          color: '#26a69a',
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          scaleMargins: { top: 0.8, bottom: 0 },
        });

        setIsReady(true);
      } catch (err) {
        console.error('Error initializing chart:', err);
      }
    };

    // Start initialization
    initChart();

    // Handle resize
    const handleResize = () => {
      if (chartRef.current && chartContainerRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [options.height]);

  /**
   * Set candlestick data
   * @param {Array} data - OHLCV candle data
   */
  const setCandlestickData = useCallback(data => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current) return;
    if (!Array.isArray(data) || data.length === 0) return;

    // Format data for lightweight-charts
    const candleData = data.map(candle => ({
      time:
        candle.time ||
        new Date(candle.date || candle.timestamp).getTime() / 1000,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const volumeData = data.map(candle => ({
      time:
        candle.time ||
        new Date(candle.date || candle.timestamp).getTime() / 1000,
      value: candle.volume,
      color: candle.close >= candle.open ? '#26a69a80' : '#ef535080',
    }));

    candlestickSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Fit content to view
    chartRef.current?.timeScale().fitContent();
  }, []);

  /**
   * Update with new candle (real-time)
   * @param {object} candle - Single candle data
   */
  const updateCandle = useCallback(candle => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current) return;

    const time =
      candle.time || new Date(candle.date || candle.timestamp).getTime() / 1000;

    candlestickSeriesRef.current.update({
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    volumeSeriesRef.current.update({
      time,
      value: candle.volume,
      color: candle.close >= candle.open ? '#26a69a80' : '#ef535080',
    });
  }, []);

  /**
   * Add EMA line indicator
   * @param {string} id - Unique identifier for this indicator
   * @param {Array} data - EMA values with timestamps
   * @param {object} options - Line styling options
   */
  const addEMALine = useCallback((id, data, lineOptions = {}) => {
    if (!chartRef.current) return;
    if (!Array.isArray(data) || data.length === 0) return;

    // Remove existing if present
    if (indicatorSeriesRef.current[id]) {
      chartRef.current.removeSeries(indicatorSeriesRef.current[id]);
    }

    const series = chartRef.current.addLineSeries({
      color: lineOptions.color || '#2196F3',
      lineWidth: lineOptions.lineWidth || 1,
      lineStyle: lineOptions.lineStyle || 0,
      title: lineOptions.title || id,
      priceLineVisible: false,
      lastValueVisible: lineOptions.showLabel !== false,
    });

    const formattedData = data.map(point => ({
      time:
        point.time || new Date(point.date || point.timestamp).getTime() / 1000,
      value: point.value,
    }));

    series.setData(formattedData);
    indicatorSeriesRef.current[id] = series;
  }, []);

  /**
   * Add Bollinger Bands
   * @param {Array} data - Bollinger band data
   */
  const addBollingerBands = useCallback(data => {
    if (!chartRef.current) return;
    if (!Array.isArray(data) || data.length === 0) return;

    // Remove existing
    ['bb_upper', 'bb_middle', 'bb_lower'].forEach(id => {
      if (indicatorSeriesRef.current[id]) {
        chartRef.current.removeSeries(indicatorSeriesRef.current[id]);
      }
    });

    // Upper band
    const upperSeries = chartRef.current.addLineSeries({
      color: '#9C27B0',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Upper',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Middle band (SMA)
    const middleSeries = chartRef.current.addLineSeries({
      color: '#9C27B0',
      lineWidth: 1,
      title: 'BB Middle',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Lower band
    const lowerSeries = chartRef.current.addLineSeries({
      color: '#9C27B0',
      lineWidth: 1,
      lineStyle: 2,
      title: 'BB Lower',
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const formatTime = point =>
      point.time || new Date(point.date || point.timestamp).getTime() / 1000;

    upperSeries.setData(
      data.map(d => ({ time: formatTime(d), value: d.upper }))
    );
    middleSeries.setData(
      data.map(d => ({ time: formatTime(d), value: d.middle }))
    );
    lowerSeries.setData(
      data.map(d => ({ time: formatTime(d), value: d.lower }))
    );

    indicatorSeriesRef.current['bb_upper'] = upperSeries;
    indicatorSeriesRef.current['bb_middle'] = middleSeries;
    indicatorSeriesRef.current['bb_lower'] = lowerSeries;
  }, []);

  /**
   * Add VWAP line
   * @param {Array} data - VWAP values with timestamps
   */
  const addVWAP = useCallback(
    data => {
      addEMALine('vwap', data, {
        color: '#FF9800',
        lineWidth: 2,
        title: 'VWAP',
      });
    },
    [addEMALine]
  );

  /**
   * Add trade entry/exit markers
   * @param {Array} trades - Array of trade markers
   */
  const setTradeMarkers = useCallback(trades => {
    if (!candlestickSeriesRef.current) return;

    const markers = trades.map(trade => ({
      time:
        trade.time || new Date(trade.date || trade.timestamp).getTime() / 1000,
      position: trade.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: trade.side === 'buy' ? '#26a69a' : '#ef5350',
      shape: trade.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: `${trade.side.toUpperCase()} @ $${trade.price.toFixed(2)}`,
    }));

    candlestickSeriesRef.current.setMarkers(markers);
    markersRef.current = markers;
  }, []);

  /**
   * Add a single marker (entry or exit point)
   * @param {object} marker - Marker data
   */
  const addMarker = useCallback(marker => {
    if (!candlestickSeriesRef.current) return;

    const newMarker = {
      time:
        marker.time ||
        new Date(marker.date || marker.timestamp).getTime() / 1000,
      position:
        marker.position || (marker.side === 'buy' ? 'belowBar' : 'aboveBar'),
      color: marker.color || (marker.side === 'buy' ? '#26a69a' : '#ef5350'),
      shape: marker.shape || (marker.side === 'buy' ? 'arrowUp' : 'arrowDown'),
      text: marker.text || '',
    };

    markersRef.current = [...markersRef.current, newMarker];
    candlestickSeriesRef.current.setMarkers(markersRef.current);
  }, []);

  /**
   * Clear all markers
   */
  const clearMarkers = useCallback(() => {
    if (!candlestickSeriesRef.current) return;
    markersRef.current = [];
    candlestickSeriesRef.current.setMarkers([]);
  }, []);

  /**
   * Add horizontal price line
   * @param {number} price - Price level
   * @param {object} options - Line options
   */
  const addPriceLine = useCallback((price, lineOptions = {}) => {
    if (!candlestickSeriesRef.current) return;

    return candlestickSeriesRef.current.createPriceLine({
      price,
      color: lineOptions.color || '#787B86',
      lineWidth: lineOptions.lineWidth || 1,
      lineStyle: lineOptions.lineStyle || 2,
      axisLabelVisible: lineOptions.axisLabelVisible !== false,
      title: lineOptions.title || '',
    });
  }, []);

  /**
   * Remove indicator
   * @param {string} id - Indicator identifier
   */
  const removeIndicator = useCallback(id => {
    if (!chartRef.current || !indicatorSeriesRef.current[id]) return;
    chartRef.current.removeSeries(indicatorSeriesRef.current[id]);
    delete indicatorSeriesRef.current[id];
  }, []);

  /**
   * Add VWAP standard-deviation bands as four dashed lines
   * @param {string} id - Base identifier (series become `${id}-u1`, `-l1`, `-u2`, `-l2`)
   * @param {object} bands - { upper1, lower1, upper2, lower2 } arrays of {time, value}
   * @param {object} bandOptions - Optional { innerColor, outerUpperColor, outerLowerColor, lineWidth, title }
   * @returns {Function} Remover that removeIndicator()s all four band series
   */
  const addVWAPBands = useCallback(
    (id, bands = {}, bandOptions = {}) => {
      const innerColor = bandOptions.innerColor || 'rgba(156, 163, 175, 0.6)';
      const baseTitle = bandOptions.title || 'VWAP';
      const specs = [
        { key: 'upper1', suffix: '-u1', color: innerColor, sigma: '+1σ' },
        { key: 'lower1', suffix: '-l1', color: innerColor, sigma: '-1σ' },
        {
          key: 'upper2',
          suffix: '-u2',
          color: bandOptions.outerUpperColor || 'rgba(239, 68, 68, 0.5)',
          sigma: '+2σ',
        },
        {
          key: 'lower2',
          suffix: '-l2',
          color: bandOptions.outerLowerColor || 'rgba(34, 197, 94, 0.5)',
          sigma: '-2σ',
        },
      ];

      const ids = [];
      specs.forEach(spec => {
        const data = bands[spec.key];
        if (!Array.isArray(data) || data.length === 0) return;
        const seriesId = `${id}${spec.suffix}`;
        addEMALine(seriesId, data, {
          color: spec.color,
          lineWidth: bandOptions.lineWidth || 1,
          lineStyle: 2, // Dashed
          title: `${baseTitle} ${spec.sigma}`,
          showLabel: false,
        });
        ids.push(seriesId);
      });

      return () => ids.forEach(seriesId => removeIndicator(seriesId));
    },
    [addEMALine, removeIndicator]
  );

  /**
   * Clear all indicators
   */
  const clearIndicators = useCallback(() => {
    if (!chartRef.current) return;
    Object.keys(indicatorSeriesRef.current).forEach(id => {
      chartRef.current.removeSeries(indicatorSeriesRef.current[id]);
    });
    indicatorSeriesRef.current = {};
  }, []);

  /**
   * Subscribe to crosshair move events
   * @param {Function} callback - Callback function
   */
  const subscribeCrosshairMove = useCallback(callback => {
    if (!chartRef.current) return;
    chartRef.current.subscribeCrosshairMove(callback);
    return () => chartRef.current?.unsubscribeCrosshairMove(callback);
  }, []);

  /**
   * Subscribe to click events
   * @param {Function} callback - Callback function
   */
  const subscribeClick = useCallback(callback => {
    if (!chartRef.current) return;
    chartRef.current.subscribeClick(callback);
    return () => chartRef.current?.unsubscribeClick(callback);
  }, []);

  /**
   * Fit content to view
   */
  const fitContent = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  /**
   * Set visible range
   * @param {object} range - Time range { from, to }
   */
  const setVisibleRange = useCallback(range => {
    chartRef.current?.timeScale().setVisibleRange(range);
  }, []);

  /**
   * Scroll to position
   * @param {number} position - Position to scroll to
   * @param {boolean} animated - Whether to animate
   */
  const scrollToPosition = useCallback((position, animated = true) => {
    chartRef.current?.timeScale().scrollToPosition(position, animated);
  }, []);

  /**
   * Take screenshot of chart
   * @returns {string} Data URL of chart image
   */
  const takeScreenshot = useCallback(() => {
    return chartRef.current?.takeScreenshot();
  }, []);

  /**
   * Apply new chart options
   * @param {object} newOptions - Chart options to apply
   */
  const applyOptions = useCallback(newOptions => {
    chartRef.current?.applyOptions(newOptions);
  }, []);

  /**
   * Change chart theme
   * @param {string} theme - 'dark' or 'light'
   */
  const setTheme = useCallback(theme => {
    if (!chartRef.current) return;

    if (theme === 'light') {
      chartRef.current.applyOptions({
        layout: {
          background: { type: 'solid', color: '#ffffff' },
          textColor: '#333333',
        },
        grid: {
          vertLines: { color: '#e1e1e1' },
          horzLines: { color: '#e1e1e1' },
        },
        rightPriceScale: { borderColor: '#e1e1e1' },
        timeScale: { borderColor: '#e1e1e1' },
      });
    } else {
      chartRef.current.applyOptions(defaultChartOptions);
    }
  }, []);

  return {
    chartContainerRef,
    chartRef,
    isReady,
    setCandlestickData,
    updateCandle,
    addEMALine,
    addBollingerBands,
    addVWAP,
    addVWAPBands,
    setTradeMarkers,
    addMarker,
    clearMarkers,
    addPriceLine,
    removeIndicator,
    clearIndicators,
    subscribeCrosshairMove,
    subscribeClick,
    fitContent,
    setVisibleRange,
    scrollToPosition,
    takeScreenshot,
    applyOptions,
    setTheme,
  };
}

export default useTradingViewChart;
