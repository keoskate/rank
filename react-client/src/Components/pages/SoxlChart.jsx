import { useEffect, useRef, useState, memo } from 'react';
import { createChart } from 'lightweight-charts';
import theme from '../../theme';
import Card from '../common/Card';

const TIMEFRAMES = [
  { label: '5m',  multiplier: 5,  timespan: 'minute', limit: 78,  lookbackDays: 3 },
  { label: '15m', multiplier: 15, timespan: 'minute', limit: 130, lookbackDays: 5 },
  { label: '1H',  multiplier: 1,  timespan: 'hour',   limit: 140, lookbackDays: 14 },
  { label: '1D',  multiplier: 1,  timespan: 'day',    limit: 90,  lookbackDays: 180 },
];

const REFRESH_MS = 60000;

const SoxlChart = ({ symbol = 'SOXL' }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeRef = useRef(null);
  const [tf, setTf] = useState(TIMEFRAMES[0]);
  const [loading, setLoading] = useState(true);
  const [lastClose, setLastClose] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        backgroundColor: theme.colors.surface,
        textColor: theme.colors.gray700,
      },
      grid: {
        vertLines: { color: theme.colors.gray100 },
        horzLines: { color: theme.colors.gray100 },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: theme.colors.gray200 },
      timeScale: {
        borderColor: theme.colors.gray200,
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: 320,
    });
    const candles = chart.addCandlestickSeries({
      upColor: theme.colors.success,
      downColor: theme.colors.error,
      borderUpColor: theme.colors.success,
      borderDownColor: theme.colors.error,
      wickUpColor: theme.colors.success,
      wickDownColor: theme.colors.error,
    });
    const volume = chart.addHistogramSeries({
      color: theme.colors.gray300,
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    chartRef.current = chart;
    seriesRef.current = candles;
    volumeRef.current = volume;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchBars = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - tf.lookbackDays * 86400000);
        const fromStr = from.toISOString().slice(0, 10);
        const toStr = now.toISOString().slice(0, 10);
        const url = `/api/polygon/bars/${symbol}/${tf.multiplier}/${tf.timespan}?from=${fromStr}&to=${toStr}&limit=${tf.limit * 2}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const bars = (json.bars || []).slice(-tf.limit);
        if (cancelled || !seriesRef.current || !volumeRef.current) return;
        const candleData = bars.map(b => ({
          time: Math.floor(b.timestamp / 1000),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })).filter(b => Number.isFinite(b.open));
        const volumeData = bars.map(b => ({
          time: Math.floor(b.timestamp / 1000),
          value: b.volume ?? 0,
          color: b.close >= b.open ? theme.colors.successLight : theme.colors.errorLight,
        })).filter(b => b.value > 0);
        seriesRef.current.setData(candleData);
        volumeRef.current.setData(volumeData);
        if (candleData.length > 0) {
          setLastClose(candleData[candleData.length - 1].close);
        }
        chartRef.current?.timeScale().fitContent();
      } catch (err) {
        if (!cancelled) setErrorMsg(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBars();
    const id = setInterval(fetchBars, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, tf]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.sm }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: theme.typography.fontSize.md, fontWeight: theme.typography.fontWeight.bold }}>
            {symbol}
          </h3>
          {lastClose != null && (
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: theme.colors.gray700 }}>
              ${Number(lastClose).toFixed(2)}
            </span>
          )}
          {loading && (
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>loading…</span>
          )}
          {errorMsg && (
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.error }}>{errorMsg}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TIMEFRAMES.map(t => {
            const active = tf.label === t.label;
            return (
              <button
                key={t.label}
                onClick={() => setTf(t)}
                style={{
                  padding: '4px 10px',
                  fontSize: theme.typography.fontSize.xs,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#fff' : theme.colors.gray700,
                  background: active ? theme.colors.primary : theme.colors.gray100,
                  border: 'none',
                  borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 320 }} />
    </Card>
  );
};

export default memo(SoxlChart);
