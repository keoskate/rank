/**
 * RunPriceChart - candlesticks + trade markers for a backtest run artifact.
 *
 * Renders the artifact's own OHLC bars and trade log (run.json) — the exact
 * bars the sim saw and the exact trades it took. No fetching, no derived
 * data: if it's on this chart, it's in the artifact.
 *
 * Optional artifact overlays (extra.levels / extra.avwap), plotted VERBATIM —
 * the viewer never recomputes them:
 *   levels - per-day volume-profile levels [{date, poc, vah, val, naked}]
 *   avwap  - anchored VWAP {anchor, points: [{date, value}]}
 */

import { useEffect } from 'react';
import { useTradingViewChart } from '../../hooks/useTradingViewChart';

const toUnix = date =>
  Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);

const RunPriceChart = ({
  bars = [],
  trades = [],
  symbol,
  height = 380,
  levels = null,
  avwap = null,
}) => {
  const {
    chartContainerRef,
    isReady,
    setCandlestickData,
    setTradeMarkers,
    addEMALine,
    removeIndicator,
  } = useTradingViewChart({ height });

  useEffect(() => {
    if (!isReady || !bars.length) return;

    setCandlestickData(
      bars.map(b => ({
        time: toUnix(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
      }))
    );

    const symbolTrades = trades
      .filter(t => t.symbol === symbol)
      .map(t => ({
        time: toUnix(t.date),
        side: t.side,
        price: t.price,
      }));
    setTradeMarkers(symbolTrades);
  }, [isReady, bars, trades, symbol, setCandlestickData, setTradeMarkers]);

  // Per-day POC/VAH/VAL step lines straight from the artifact's extra.levels
  useEffect(() => {
    if (isReady && Array.isArray(levels) && levels.length) {
      const line = key =>
        levels
          .filter(l => l[key] != null)
          .map(l => ({ time: toUnix(l.date), value: l[key] }));
      addEMALine('poc-level', line('poc'), {
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: 0,
        title: 'POC',
      });
      addEMALine('vah-level', line('vah'), {
        color: '#f59e0b80',
        lineWidth: 1,
        lineStyle: 2,
        title: 'VAH',
        showLabel: false,
      });
      addEMALine('val-level', line('val'), {
        color: '#f59e0b80',
        lineWidth: 1,
        lineStyle: 2,
        title: 'VAL',
        showLabel: false,
      });
    }
    return () => {
      removeIndicator('poc-level');
      removeIndicator('vah-level');
      removeIndicator('val-level');
    };
  }, [isReady, levels, addEMALine, removeIndicator]);

  // Anchored VWAP overlay straight from the artifact's extra.avwap
  useEffect(() => {
    if (
      isReady &&
      avwap &&
      Array.isArray(avwap.points) &&
      avwap.points.length
    ) {
      addEMALine(
        'avwap-overlay',
        avwap.points
          .filter(p => p.value != null)
          .map(p => ({ time: toUnix(p.date), value: p.value })),
        { color: '#e879f9', lineWidth: 2, title: 'AVWAP' }
      );
    }
    return () => removeIndicator('avwap-overlay');
  }, [isReady, avwap, addEMALine, removeIndicator]);

  const hasLevels = Array.isArray(levels) && levels.length > 0;
  const hasAvwap = Boolean(avwap && avwap.points && avwap.points.length);

  return (
    <div>
      <div ref={chartContainerRef} style={{ height }} />
      {(hasLevels || hasAvwap) && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
          {hasLevels && (
            <span style={{ color: '#f59e0b' }}>
              — POC &nbsp;┄ VAH/VAL&nbsp;{' '}
            </span>
          )}
          {hasAvwap && (
            <span style={{ color: '#e879f9' }}>
              — AVWAP (anchor {avwap.anchor})&nbsp;
            </span>
          )}
          <span>· overlay values read verbatim from the artifact</span>
        </div>
      )}
    </div>
  );
};

export default RunPriceChart;
