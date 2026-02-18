/**
 * SimulatorChart Component
 *
 * SVG mini chart for the trading simulator showing price action,
 * buy/sell markers, and trade positions.
 */

import theme from '../../theme';
import { getCandle } from '../../utils/tradingLogic';

const SimulatorChart = ({
  candles,
  currentCandleIndex,
  currentPrice,
  dayOpen,
  portfolio,
}) => {
  if (candles.length === 0) return null;

  const visibleCandles = candles.slice(0, currentCandleIndex + 1);
  if (visibleCandles.length === 0) return null;

  // Use viewBox for responsive scaling
  const width = 450;
  const height = 160;
  const padding = 35;

  const prices = visibleCandles
    .map(c => getCandle(c)?.close || 0)
    .filter(p => p > 0);
  if (prices.length === 0) return null;

  const minPrice = Math.min(...prices) * 0.999;
  const maxPrice = Math.max(...prices) * 1.001;

  const xScale = i => padding + (i / candles.length) * (width - padding * 2);
  const yScale = p =>
    height -
    padding -
    ((p - minPrice) / (maxPrice - minPrice)) * (height - padding * 2);

  const pathPoints = visibleCandles
    .map((candle, i) => {
      const c = getCandle(candle);
      if (!c) return null;
      const x = xScale(i);
      const y = yScale(c.close);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .filter(Boolean)
    .join(' ');

  const buyTrades = portfolio.trades.filter(t => t.type === 'BUY');
  const sellTrades = portfolio.trades.filter(t => t.type === 'SELL');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        width: '100%',
        height: 'auto',
        maxHeight: '160px',
        backgroundColor: theme.colors.gray50,
        borderRadius: theme.borderRadius.sm,
      }}
    >
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(pct => (
        <line
          key={pct}
          x1={padding}
          y1={height - padding - pct * (height - padding * 2)}
          x2={width - padding}
          y2={height - padding - pct * (height - padding * 2)}
          stroke={theme.colors.gray200}
          strokeDasharray="2,2"
        />
      ))}

      {/* Y-axis labels */}
      <text x={5} y={padding} fontSize={10} fill={theme.colors.gray500}>
        ${maxPrice.toFixed(2)}
      </text>
      <text
        x={5}
        y={height - padding}
        fontSize={10}
        fill={theme.colors.gray500}
      >
        ${minPrice.toFixed(2)}
      </text>

      {/* Price line */}
      <path
        d={pathPoints}
        fill="none"
        stroke={
          currentPrice >= dayOpen ? theme.colors.success : theme.colors.error
        }
        strokeWidth={2}
      />

      {/* Current price dot */}
      {visibleCandles.length > 0 && (
        <circle
          cx={xScale(visibleCandles.length - 1)}
          cy={yScale(currentPrice)}
          r={4}
          fill={
            currentPrice >= dayOpen
              ? theme.colors.success
              : theme.colors.error
          }
        />
      )}

      {/* Buy markers (green triangles pointing up) */}
      {buyTrades.map((trade, i) => {
        const tradeIndex = candles.findIndex(
          c => (c.timestamp || c.t) >= trade.timestamp
        );
        if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
        return (
          <polygon
            key={`buy-${i}`}
            points={`${xScale(tradeIndex)},${yScale(trade.price) + 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) + 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) + 16}`}
            fill={theme.colors.success}
          />
        );
      })}

      {/* Sell markers (red triangles pointing down) */}
      {sellTrades.map((trade, i) => {
        const tradeIndex = candles.findIndex(
          c => (c.timestamp || c.t) >= trade.timestamp
        );
        if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
        return (
          <polygon
            key={`sell-${i}`}
            points={`${xScale(tradeIndex)},${yScale(trade.price) - 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) - 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) - 16}`}
            fill={theme.colors.error}
          />
        );
      })}

      {/* X-axis labels */}
      <text
        x={padding}
        y={height - 5}
        fontSize={10}
        fill={theme.colors.gray500}
      >
        9:30
      </text>
      <text
        x={width / 2}
        y={height - 5}
        fontSize={10}
        fill={theme.colors.gray500}
        textAnchor="middle"
      >
        12:00
      </text>
      <text
        x={width - padding}
        y={height - 5}
        fontSize={10}
        fill={theme.colors.gray500}
        textAnchor="end"
      >
        4:00
      </text>
    </svg>
  );
};

export default SimulatorChart;
