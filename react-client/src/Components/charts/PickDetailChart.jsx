import { useEffect, useRef, useState, memo } from 'react';
import { createChart, LineStyle } from '../../utils/lightweightChartsShim';
import theme from '../../theme';

/**
 * Why a pick won or lost, visually: stock daily candles with the card's
 * levels (entry spot, target, stop, breakeven) and exit markers, plus the
 * option's own price path below on its own scale (a $3 option doesn't
 * belong on a $500 stock axis). Confidence dots from pick.history when the
 * daily loop has collected them.
 */
const PickDetailChart = ({ pickId }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const stockRef = useRef(null);
  const optionRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/scanner/options/pick/${encodeURIComponent(pickId)}/history`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [pickId]);

  useEffect(() => {
    if (!data || !stockRef.current) return undefined;
    const { pick, underlyingBars, optionBars } = data;
    const card = pick.card;
    const toTime = ms => Math.floor(ms / 1000);
    const charts = [];

    const baseOpts = width => ({
      width,
      layout: { backgroundColor: theme.colors.paper, textColor: theme.colors.gray700, fontSize: 10 },
      grid: { vertLines: { color: theme.colors.gray100 }, horzLines: { color: theme.colors.gray100 } },
      rightPriceScale: { borderColor: theme.colors.gray200 },
      timeScale: { borderColor: theme.colors.gray200 },
    });

    // ── Stock chart with levels + exit markers
    const stockChart = createChart(stockRef.current, { ...baseOpts(stockRef.current.clientWidth), height: 260 });
    charts.push(stockChart);
    const candles = stockChart.addCandlestickSeries({
      upColor: theme.colors.successMuted,
      downColor: theme.colors.errorMuted,
      borderUpColor: theme.colors.successMuted,
      borderDownColor: theme.colors.errorMuted,
      wickUpColor: theme.colors.successMuted,
      wickDownColor: theme.colors.errorMuted,
    });
    candles.setData(underlyingBars.map(b => ({
      time: toTime(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close,
    })));

    const level = (price, title, color, style = LineStyle?.Dashed ?? 2) =>
      candles.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true });
    level(card.underlyingPrice, 'entry spot', theme.colors.gray500, LineStyle?.Solid ?? 0);
    level(card.targetPrice, 'target', theme.colors.successMuted);
    level(card.stopPrice, 'stop', theme.colors.errorMuted);
    level(card.breakeven, 'breakeven', theme.colors.warningMuted);

    const markers = [{
      time: toTime(Date.parse(pick.recordedAt)),
      position: 'belowBar',
      color: theme.colors.charcoal,
      shape: 'arrowUp',
      text: 'pick',
    }];
    if (pick.exit) {
      markers.push({
        time: toTime(Date.parse(`${pick.exit.exitDate}T12:00:00Z`)),
        position: 'aboveBar',
        color: pick.exit.win ? theme.colors.successMuted : theme.colors.errorMuted,
        shape: 'arrowDown',
        text: `exit (${pick.exit.exitReason})`,
      });
    }
    candles.setMarkers(markers.sort((a, b) => a.time - b.time));
    stockChart.timeScale().fitContent();

    // ── Option price path on its own scale
    if (optionRef.current && optionBars.length) {
      const optChart = createChart(optionRef.current, { ...baseOpts(optionRef.current.clientWidth), height: 140 });
      charts.push(optChart);
      const line = optChart.addLineSeries({ color: theme.colors.charcoal, lineWidth: 2 });
      line.setData(optionBars.map(b => ({ time: toTime(Date.parse(b.t)), value: b.c })));
      line.createPriceLine({
        price: card.entryDebit,
        title: 'you paid',
        color: theme.colors.gray500,
        lineWidth: 1,
        lineStyle: LineStyle?.Dashed ?? 2,
        axisLabelVisible: true,
      });
      // Daily loop confidence/bid snapshots, when collected
      if ((pick.history || []).length) {
        const bidLine = optChart.addLineSeries({ color: theme.colors.warningMuted, lineWidth: 1, lineStyle: LineStyle?.Dotted ?? 1 });
        bidLine.setData(pick.history.map(h => ({ time: toTime(Date.parse(`${h.date}T20:00:00Z`)), value: h.bid })));
      }
      optChart.timeScale().fitContent();
    }

    const onResize = () => charts.forEach((c, i) =>
      c.applyOptions({ width: (i === 0 ? stockRef : optionRef).current?.clientWidth || 600 }));
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      charts.forEach(c => c.remove());
    };
  }, [data]);

  if (error) return <div style={{ padding: theme.spacing.md, color: theme.colors.errorMuted, fontSize: '0.78rem' }}>Chart unavailable: {error}</div>;
  if (!data) return <div style={{ padding: theme.spacing.md, color: theme.colors.gray500, fontSize: '0.78rem' }}>Loading price history…</div>;

  return (
    <div style={{ padding: `${theme.spacing.sm} 0` }}>
      <div ref={stockRef} />
      <div style={{ fontSize: '0.64rem', color: theme.colors.gray500, margin: '6px 0 2px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        The option itself (close per day vs what you paid)
      </div>
      <div ref={optionRef} />
    </div>
  );
};

export default memo(PickDetailChart);
