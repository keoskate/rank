import { useEffect, useRef, useState, memo } from 'react';
import { createChart } from 'lightweight-charts';
import theme from '../../theme';
import Card from '../common/Card';
import TradingViewChart from '../common/TradingViewChart';

// Canonical day-trading timeframes. alpacaToken maps to /api/alpaca/bars'
// timeframe param (5→5Min, 15→15Min, 60→1Hour, day→1Day) — the real-time IEX
// feed the engine trades on, not delayed Polygon. indTf/indUnit map the same
// timeframe onto the /api/indicators endpoint used by the advanced chart.
const TIMEFRAMES = [
  { label: '5m',  alpacaToken: '5',   indTf: '5',  indUnit: 'minute', limit: 78,  lookbackDays: 3 },
  { label: '15m', alpacaToken: '15',  indTf: '15', indUnit: 'minute', limit: 130, lookbackDays: 5 },
  { label: '1H',  alpacaToken: '60',  indTf: '1',  indUnit: 'hour',   limit: 140, lookbackDays: 14 },
  { label: '1D',  alpacaToken: 'day', indTf: '1',  indUnit: 'day',    limit: 90,  lookbackDays: 180 },
];

const REFRESH_MS = 60000;

const SoxlChart = ({ symbol = 'SOXL', height = 320 }) => {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeRef = useRef(null);
  const [tf, setTf] = useState(TIMEFRAMES[0]);
  const [loading, setLoading] = useState(true);
  const [lastClose, setLastClose] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  // Simple (built-in candles+volume) vs Advanced (full TradingViewChart with
  // VWAP / MA / EMA / RSI / vol-profile toolbar, same as the live-trading page).
  const [advanced, setAdvanced] = useState(false);
  const [advCandles, setAdvCandles] = useState([]);
  const [prevClose, setPrevClose] = useState(null);

  // Simple chart: create the lightweight-charts instance. Skipped in advanced
  // mode (TradingViewChart owns its own chart); re-inits when toggled back.
  useEffect(() => {
    if (advanced || !containerRef.current) return;
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
      height,
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
  }, [advanced]);

  useEffect(() => {
    let cancelled = false;
    const fetchBars = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const now = new Date();
        const from = new Date(now.getTime() - tf.lookbackDays * 86400000);
        const fromStr = from.toISOString().slice(0, 10);
        // Alpaca's range is [start, end), so 'to' must be tomorrow or today's
        // intraday bars get excluded.
        const toStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
        // Alpaca returns bars oldest-first and a small limit truncates to the
        // OLDEST bars in the window (never reaching today). Fetch the whole
        // lookback (1000 covers every timeframe here) and display the tail.
        const url = `/api/alpaca/bars/${symbol}/${tf.alpacaToken}?from=${fromStr}&to=${toStr}&limit=1000`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const bars = (json.results || json.bars || []).slice(-tf.limit);
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
    // Advanced mode pulls the same OHLCV the live-trading charts use, so
    // TradingViewChart can compute VWAP/MA/EMA/RSI/vol-profile client-side.
    const fetchAdvanced = async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`/api/indicators/${symbol}?timeframe=${tf.indTf}&unit=${tf.indUnit}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const c = Array.isArray(data.candles) ? data.candles : [];
        setAdvCandles(c);
        if (data.prevClose != null) setPrevClose(data.prevClose);
        if (c.length > 0) setLastClose(c[c.length - 1].close);
      } catch (err) {
        if (!cancelled) setErrorMsg(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const run = advanced ? fetchAdvanced : fetchBars;
    run();
    const id = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol, tf, advanced]);

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', border: `1px solid ${theme.colors.gray200}`, borderRadius: 12, overflow: 'hidden' }}>
            {[{ label: 'Simple', adv: false }, { label: 'Advanced', adv: true }].map(m => {
              const active = advanced === m.adv;
              return (
                <button
                  key={m.label}
                  onClick={() => setAdvanced(m.adv)}
                  title={m.adv ? 'Full chart: VWAP, MA/EMA, RSI, volume profile' : 'Simple candles + volume'}
                  style={{
                    padding: '4px 10px',
                    fontSize: theme.typography.fontSize.xs,
                    fontWeight: active ? 700 : 500,
                    color: active ? '#fff' : theme.colors.gray700,
                    background: active ? theme.colors.primary : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              );
            })}
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
      </div>
      {advanced ? (
        advCandles.length === 0 ? (
          <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
            {errorMsg || 'Loading advanced chart…'}
          </div>
        ) : (
          <TradingViewChart
            symbol={symbol}
            candles={advCandles}
            currentCandleIndex={advCandles.length - 1}
            trades={[]}
            currentPosition={null}
            dayOpen={advCandles[0]?.open || 0}
            prevClose={prevClose}
            height={height}
            showRSI={height >= 300}
            hideHeader
          />
        )
      ) : (
        <div ref={containerRef} style={{ width: '100%', height }} />
      )}
    </Card>
  );
};

export default memo(SoxlChart);
