/**
 * RunPriceChart - candlesticks + trade markers for a backtest run artifact.
 *
 * Renders the artifact's own OHLC bars and trade log (run.json) — the exact
 * bars the sim saw and the exact trades it took. No fetching, no derived
 * data: if it's on this chart, it's in the artifact.
 */

import { useEffect } from 'react';
import { useTradingViewChart } from '../../hooks/useTradingViewChart';

const RunPriceChart = ({ bars = [], trades = [], symbol, height = 380 }) => {
  const { chartContainerRef, isReady, setCandlestickData, setTradeMarkers } =
    useTradingViewChart({ height });

  useEffect(() => {
    if (!isReady || !bars.length) return;

    setCandlestickData(
      bars.map(b => ({
        time: Math.floor(new Date(`${b.date}T00:00:00Z`).getTime() / 1000),
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
        time: Math.floor(new Date(`${t.date}T00:00:00Z`).getTime() / 1000),
        side: t.side,
        price: t.price,
      }));
    setTradeMarkers(symbolTrades);
  }, [isReady, bars, trades, symbol, setCandlestickData, setTradeMarkers]);

  return <div ref={chartContainerRef} style={{ height }} />;
};

export default RunPriceChart;
