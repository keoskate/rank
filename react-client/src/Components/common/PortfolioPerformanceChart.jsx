import { useState, useEffect, useRef, useMemo } from 'react';
import { Chart, registerables } from 'chart.js';
import theme from '../../theme';
import Card from './Card';

Chart.register(...registerables);

// Create a stable key from orders to prevent unnecessary re-renders
const getOrdersKey = (orders) => {
  if (!orders?.length) return '';
  return orders
    .filter(o => o.status === 'filled')
    .map(o => o.id)
    .sort()
    .join(',');
};

// Alpaca API timeframe constraints:
// - 1Min/5Min/15Min: only valid for periods <= 7 days
// - 1H: only valid for periods <= 30 days
// - 1D: valid for all periods
const PERIOD_OPTIONS = [
  { label: '1D', value: '1D', timeframe: '5Min' },
  { label: '1W', value: '1W', timeframe: '15Min' },
  { label: '1M', value: '1M', timeframe: '1D' },
  { label: '3M', value: '3M', timeframe: '1D' },
  { label: '1Y', value: '1A', timeframe: '1D' },
];

const PortfolioPerformanceChart = ({
  tradingMode = 'live',
  orders = [],
  height = 300,
}) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [selectedPeriod, setSelectedPeriod] = useState(PERIOD_OPTIONS[2]); // Default 1M
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);

  // Fetch portfolio history when period or mode changes
  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          mode: tradingMode,
          period: selectedPeriod.value,
          timeframe: selectedPeriod.timeframe,
        });

        const res = await fetch(`/api/alpaca/portfolio-history?${params}`);
        if (!res.ok) throw new Error('Failed to fetch portfolio history');

        const data = await res.json();
        setHistoryData(data);
      } catch (err) {
        console.error('Portfolio history error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [tradingMode, selectedPeriod]);

  // Track previous orders key to prevent unnecessary chart re-renders
  const prevOrdersKeyRef = useRef('');
  const ordersKey = getOrdersKey(orders);

  // Process orders into trade markers - only when ordersKey actually changes
  const tradeMarkers = useMemo(() => {
    if (!historyData?.timestamp?.length || !orders?.length) return { buys: [], sells: [] };

    const buys = [];
    const sells = [];

    orders.forEach(order => {
      if (order.status !== 'filled') return;

      const orderTime = new Date(order.filledAt || order.filled_at || order.createdAt || order.created_at).getTime() / 1000;

      // Find closest timestamp in history data
      let closestIdx = 0;
      let minDiff = Infinity;
      historyData.timestamp.forEach((ts, idx) => {
        const diff = Math.abs(ts - orderTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });

      // Only include if within reasonable time range (1 hour for intraday, 1 day for daily)
      const maxDiff = selectedPeriod.timeframe === '1D' ? 86400 : 3600;
      if (minDiff < maxDiff) {
        const marker = {
          x: closestIdx,
          y: historyData.equity[closestIdx],
          symbol: order.symbol,
          qty: order.filledQty || order.filled_qty || order.quantity || order.qty,
          price: order.filledAvgPrice || order.filled_avg_price,
        };

        if (order.side === 'buy') {
          buys.push(marker);
        } else {
          sells.push(marker);
        }
      }
    });

    // Update previous key ref
    prevOrdersKeyRef.current = ordersKey;

    return { buys, sells };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyData, ordersKey, selectedPeriod]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!historyData?.equity?.length) return null;

    const validEquity = historyData.equity.filter(e => e !== null);
    if (validEquity.length === 0) return null;

    const startEquity = validEquity[0];
    const endEquity = validEquity[validEquity.length - 1];
    const totalChange = endEquity - startEquity;
    const totalChangePercent = startEquity ? (totalChange / startEquity) * 100 : 0;

    const maxEquity = Math.max(...validEquity);
    const minEquity = Math.min(...validEquity);

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = validEquity[0];
    validEquity.forEach(equity => {
      if (equity > peak) peak = equity;
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    return {
      startEquity,
      endEquity,
      totalChange,
      totalChangePercent,
      maxEquity,
      minEquity,
      maxDrawdown,
    };
  }, [historyData]);

  // Render chart
  useEffect(() => {
    if (!chartRef.current || !historyData?.timestamp?.length) return;

    // Destroy existing chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    const ctx = chartRef.current.getContext('2d');

    // Prepare data points
    const dataPoints = historyData.timestamp.map((ts, idx) => ({
      x: idx,
      y: historyData.equity[idx],
      timestamp: ts,
      pnl: historyData.profitLoss[idx],
      pnlPct: historyData.profitLossPct[idx],
    })).filter(d => d.y !== null);

    const isPositive = stats && stats.totalChange >= 0;
    const lineColor = isPositive ? theme.colors.success : theme.colors.error;

    // Create gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, chartRef.current.height);
    if (isPositive) {
      gradient.addColorStop(0, 'rgba(40, 167, 69, 0.25)');
      gradient.addColorStop(1, 'rgba(40, 167, 69, 0.02)');
    } else {
      gradient.addColorStop(0, 'rgba(220, 53, 69, 0.25)');
      gradient.addColorStop(1, 'rgba(220, 53, 69, 0.02)');
    }

    const startEquityValue = stats?.startEquity;

    const datasets = [
      {
        label: 'Portfolio Value',
        data: dataPoints,
        borderColor: lineColor,
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.1,
      },
    ];

    // Starting balance reference line
    if (startEquityValue && dataPoints.length >= 2) {
      datasets.push({
        label: 'Period Start',
        data: [
          { x: dataPoints[0].x, y: startEquityValue },
          { x: dataPoints[dataPoints.length - 1].x, y: startEquityValue },
        ],
        borderColor: theme.colors.gray300,
        borderWidth: 1,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
      });
    }

    // Add trade markers only when toggled on
    if (showTrades && tradeMarkers.buys.length > 0) {
      datasets.push({
        label: 'Buy',
        data: tradeMarkers.buys,
        borderColor: theme.colors.success,
        backgroundColor: theme.colors.success,
        pointRadius: 6,
        pointStyle: 'triangle',
        showLine: false,
        order: 0,
      });
    }

    if (showTrades && tradeMarkers.sells.length > 0) {
      datasets.push({
        label: 'Sell',
        data: tradeMarkers.sells,
        borderColor: theme.colors.error,
        backgroundColor: theme.colors.error,
        pointRadius: 6,
        pointStyle: 'triangle',
        rotation: 180,
        showLine: false,
        order: 0,
      });
    }

    chartInstance.current = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title: items => {
                const item = items[0];
                if (item?.raw?.timestamp) {
                  return new Date(item.raw.timestamp * 1000).toLocaleString();
                }
                if (item?.raw?.symbol) {
                  return `${item.dataset.label}: ${item.raw.symbol}`;
                }
                return '';
              },
              label: context => {
                if (context.raw?.symbol) {
                  return `${context.raw.qty} @ $${context.raw.price?.toFixed(2) || '--'}`;
                }
                const value = context.parsed.y;
                return `Value: $${value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '--'}`;
              },
              afterLabel: context => {
                if (context.raw?.pnl !== undefined) {
                  const pnl = context.raw.pnl;
                  const pnlPct = context.raw.pnlPct;
                  return `P&L: ${pnl >= 0 ? '+' : ''}$${pnl?.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100)?.toFixed(2)}%)`;
                }
                return null;
              },
            },
            backgroundColor: '#fff',
            titleColor: theme.colors.gray900,
            bodyColor: theme.colors.gray700,
            borderColor: theme.colors.gray200,
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            type: 'linear',
            display: true,
            grid: {
              display: false,
            },
            ticks: {
              display: false,
            },
          },
          y: {
            type: 'linear',
            position: 'right',
            grid: {
              color: theme.colors.gray100,
            },
            ticks: {
              color: theme.colors.gray500,
              font: { size: 10 },
              callback: value => `$${(value / 1000).toFixed(1)}k`,
            },
          },
        },
      },
    });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [historyData, tradeMarkers, stats, showTrades]);

  const formatCurrency = value => {
    if (!value && value !== 0) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  return (
    <Card style={{ marginBottom: theme.spacing.lg }}>
      {/* Balance Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: theme.spacing.md,
          flexWrap: 'wrap',
          gap: theme.spacing.sm,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm }}>
            <span
              style={{
                fontSize: '28px',
                fontWeight: theme.typography.fontWeight.bold,
                color: theme.colors.gray900,
                letterSpacing: '-0.5px',
              }}
            >
              {stats ? formatCurrency(stats.endEquity) : '--'}
            </span>
            {stats && (
              <span
                style={{
                  fontSize: theme.typography.fontSize.base,
                  fontWeight: theme.typography.fontWeight.medium,
                  color: stats.totalChange >= 0 ? theme.colors.success : theme.colors.error,
                }}
              >
                {stats.totalChange >= 0 ? '+' : ''}
                {formatCurrency(stats.totalChange)} ({stats.totalChangePercent >= 0 ? '+' : ''}
                {stats.totalChangePercent.toFixed(2)}%)
              </span>
            )}
          </div>
          {stats && (
            <div
              style={{
                display: 'flex',
                gap: theme.spacing.md,
                marginTop: theme.spacing.xs,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              <span>
                Return: <span style={{
                  color: stats.totalChange >= 0 ? theme.colors.success : theme.colors.error,
                  fontWeight: theme.typography.fontWeight.medium,
                }}>
                  {stats.totalChangePercent >= 0 ? '+' : ''}{stats.totalChangePercent.toFixed(2)}%
                </span>
              </span>
              <span>
                Max DD: <span style={{
                  color: theme.colors.error,
                  fontWeight: theme.typography.fontWeight.medium,
                }}>
                  -{stats.maxDrawdown.toFixed(2)}%
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Period Selector */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
          {(tradeMarkers.buys.length > 0 || tradeMarkers.sells.length > 0) && (
            <button
              onClick={() => setShowTrades(prev => !prev)}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                border: showTrades ? `1px solid ${theme.colors.gray400}` : '1px solid transparent',
                backgroundColor: showTrades ? theme.colors.gray100 : 'transparent',
                color: theme.colors.gray600,
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                marginRight: theme.spacing.sm,
              }}
            >
              Trades {showTrades ? 'ON' : 'OFF'}
            </button>
          )}
          {PERIOD_OPTIONS.map(period => (
            <button
              key={period.label}
              onClick={() => setSelectedPeriod(period)}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                border:
                  selectedPeriod.label === period.label
                    ? `1px solid ${theme.colors.primary}`
                    : '1px solid transparent',
                backgroundColor:
                  selectedPeriod.label === period.label
                    ? `${theme.colors.primary}15`
                    : 'transparent',
                color:
                  selectedPeriod.label === period.label
                    ? theme.colors.primary
                    : theme.colors.gray600,
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                fontSize: theme.typography.fontSize.xs,
                fontWeight:
                  selectedPeriod.label === period.label
                    ? theme.typography.fontWeight.bold
                    : theme.typography.fontWeight.medium,
              }}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative', height }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
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
              color: theme.colors.error,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && !historyData?.timestamp?.length && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: theme.colors.gray500,
              textAlign: 'center',
            }}
          >
            No portfolio history available
          </div>
        )}
        <canvas ref={chartRef} />
      </div>

      {/* Trade Legend - only when trades are shown */}
      {showTrades && (tradeMarkers.buys.length > 0 || tradeMarkers.sells.length > 0) && (
        <div
          style={{
            marginTop: theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTop: `1px solid ${theme.colors.gray100}`,
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.gray500,
            display: 'flex',
            gap: theme.spacing.md,
          }}
        >
          {tradeMarkers.buys.length > 0 && (
            <span>
              <span style={{ color: theme.colors.success }}>&#9650;</span> {tradeMarkers.buys.length} Buy{tradeMarkers.buys.length > 1 ? 's' : ''}
            </span>
          )}
          {tradeMarkers.sells.length > 0 && (
            <span>
              <span style={{ color: theme.colors.error }}>&#9660;</span> {tradeMarkers.sells.length} Sell{tradeMarkers.sells.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </Card>
  );
};

export default PortfolioPerformanceChart;
