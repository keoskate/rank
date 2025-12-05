/**
 * Performance Analytics Dashboard
 *
 * Comprehensive trading performance analysis with charts,
 * metrics, and insights.
 */

import { useState, useEffect, useMemo } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import theme from '../../theme';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const PerformanceAnalytics = () => {
  const [timeRange, setTimeRange] = useState('all');
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sessionStats, setSessionStats] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch trades from Schwab import
      const tradesRes = await fetch('/api/import/schwab/default_user');
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades(data.trades || data || []);
      }

      // Fetch current session stats if available
      const sessionRes = await fetch('/api/ai/session/default_user');
      if (sessionRes.ok) {
        const data = await sessionRes.json();
        setSessionStats(data);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filter trades by time range
  const filteredTrades = useMemo(() => {
    if (timeRange === 'all') return trades;

    const now = new Date();
    const cutoff = new Date();

    switch (timeRange) {
      case 'week':
        cutoff.setDate(now.getDate() - 7);
        break;
      case 'month':
        cutoff.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        cutoff.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        cutoff.setFullYear(now.getFullYear() - 1);
        break;
      default:
        return trades;
    }

    return trades.filter((t) => new Date(t.exitDate) >= cutoff);
  }, [trades, timeRange]);

  // Calculate metrics
  const metrics = useMemo(() => {
    if (filteredTrades.length === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnL: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        largestWin: 0,
        largestLoss: 0,
        avgHoldingDays: 0,
        streaks: { maxWin: 0, maxLoss: 0 }
      };
    }

    const wins = filteredTrades.filter((t) => t.isWin);
    const losses = filteredTrades.filter((t) => !t.isWin);

    const totalPnL = filteredTrades.reduce((s, t) => s + t.profit, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length) : 0;

    // Calculate streaks
    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    filteredTrades.forEach((t) => {
      if (t.isWin) {
        currentWinStreak++;
        currentLossStreak = 0;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else {
        currentLossStreak++;
        currentWinStreak = 0;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      }
    });

    return {
      totalTrades: filteredTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (wins.length / filteredTrades.length) * 100,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.profit)) : 0,
      largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.profit)) : 0,
      avgHoldingDays: filteredTrades.reduce((s, t) => s + t.holdingDays, 0) / filteredTrades.length,
      streaks: { maxWin: maxWinStreak, maxLoss: maxLossStreak }
    };
  }, [filteredTrades]);

  // Equity curve data
  const equityCurveData = useMemo(() => {
    if (filteredTrades.length === 0) return null;

    const sorted = [...filteredTrades].sort(
      (a, b) => new Date(a.exitDate) - new Date(b.exitDate)
    );

    let cumulative = 0;
    const data = sorted.map((trade) => {
      cumulative += trade.profit;
      return {
        date: new Date(trade.exitDate).toLocaleDateString(),
        value: cumulative
      };
    });

    return {
      labels: data.map((d) => d.date),
      datasets: [
        {
          label: 'Cumulative P&L',
          data: data.map((d) => d.value),
          borderColor: theme.colors.primary,
          backgroundColor: theme.colors.primary + '20',
          fill: true,
          tension: 0.3
        }
      ]
    };
  }, [filteredTrades]);

  // Daily P&L data
  const dailyPnLData = useMemo(() => {
    if (filteredTrades.length === 0) return null;

    // Group by date
    const byDate = {};
    filteredTrades.forEach((trade) => {
      const date = new Date(trade.exitDate).toLocaleDateString();
      if (!byDate[date]) byDate[date] = 0;
      byDate[date] += trade.profit;
    });

    const dates = Object.keys(byDate).sort((a, b) => new Date(a) - new Date(b));

    return {
      labels: dates,
      datasets: [
        {
          label: 'Daily P&L',
          data: dates.map((d) => byDate[d]),
          backgroundColor: dates.map((d) =>
            byDate[d] >= 0 ? theme.colors.success : theme.colors.error
          )
        }
      ]
    };
  }, [filteredTrades]);

  // Win/Loss distribution
  const winLossData = useMemo(() => {
    if (filteredTrades.length === 0) return null;

    return {
      labels: ['Wins', 'Losses'],
      datasets: [
        {
          data: [metrics.wins, metrics.losses],
          backgroundColor: [theme.colors.success, theme.colors.error]
        }
      ]
    };
  }, [filteredTrades, metrics]);

  // P&L distribution by trading style
  const styleData = useMemo(() => {
    if (filteredTrades.length === 0) return null;

    const byStyle = {
      scalping: filteredTrades.filter((t) => t.tradingStyle === 'scalping'),
      dayTrading: filteredTrades.filter((t) => t.tradingStyle === 'dayTrading'),
      swing: filteredTrades.filter((t) => t.tradingStyle === 'swing')
    };

    return {
      labels: ['Scalping', 'Day Trading', 'Swing'],
      datasets: [
        {
          label: 'Trades',
          data: [byStyle.scalping.length, byStyle.dayTrading.length, byStyle.swing.length],
          backgroundColor: theme.colors.info
        },
        {
          label: 'P&L',
          data: [
            byStyle.scalping.reduce((s, t) => s + t.profit, 0),
            byStyle.dayTrading.reduce((s, t) => s + t.profit, 0),
            byStyle.swing.reduce((s, t) => s + t.profit, 0)
          ],
          backgroundColor: theme.colors.success
        }
      ]
    };
  }, [filteredTrades]);

  // Top symbols
  const topSymbols = useMemo(() => {
    if (filteredTrades.length === 0) return [];

    const bySymbol = {};
    filteredTrades.forEach((t) => {
      if (!bySymbol[t.symbol]) {
        bySymbol[t.symbol] = { trades: 0, wins: 0, pnl: 0 };
      }
      bySymbol[t.symbol].trades++;
      if (t.isWin) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].pnl += t.profit;
    });

    return Object.entries(bySymbol)
      .sort((a, b) => b[1].pnl - a[1].pnl)
      .slice(0, 10)
      .map(([symbol, data]) => ({
        symbol,
        ...data,
        winRate: (data.wins / data.trades) * 100
      }));
  }, [filteredTrades]);

  const formatCurrency = (value) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top'
      }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };

  if (loading) {
    return (
      <div
        style={{
          padding: theme.spacing.lg,
          textAlign: 'center',
          color: theme.colors.gray500
        }}
      >
        Loading analytics...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: theme.typography.fontSize.xxl }}>
            Performance Analytics
          </h1>
          <p style={{ color: theme.colors.gray600, marginTop: theme.spacing.xs }}>
            {filteredTrades.length} trades analyzed
          </p>
        </div>

        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
          {['week', 'month', 'quarter', 'year', 'all'].map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? 'primary' : 'ghost'}
              size="small"
              onClick={() => setTimeRange(range)}
            >
              {range === 'all' ? 'All Time' : range.charAt(0).toUpperCase() + range.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {filteredTrades.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: theme.spacing.xl }}>
          <h3>No Trade Data Available</h3>
          <p style={{ color: theme.colors.gray500 }}>
            Import your Schwab trades or start live trading to see analytics.
          </p>
          <Button onClick={() => (window.location.href = '/import-trades')}>
            Import Trades
          </Button>
        </Card>
      ) : (
        <>
          {/* Key Metrics */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: theme.spacing.md,
              marginBottom: theme.spacing.lg
            }}
          >
            <MetricCard title="Total Trades" value={metrics.totalTrades} />
            <MetricCard
              title="Win Rate"
              value={`${metrics.winRate.toFixed(1)}%`}
              subtitle={`${metrics.wins}W / ${metrics.losses}L`}
              variant={metrics.winRate >= 50 ? 'success' : 'error'}
            />
            <MetricCard
              title="Total P&L"
              value={formatCurrency(metrics.totalPnL)}
              variant={metrics.totalPnL >= 0 ? 'success' : 'error'}
            />
            <MetricCard
              title="Profit Factor"
              value={metrics.profitFactor.toFixed(2)}
              variant={metrics.profitFactor >= 1 ? 'success' : 'error'}
            />
            <MetricCard
              title="Avg Win"
              value={formatCurrency(metrics.avgWin)}
              variant="success"
            />
            <MetricCard
              title="Avg Loss"
              value={formatCurrency(metrics.avgLoss)}
              variant="error"
            />
          </div>

          {/* Charts Row 1 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.lg
            }}
          >
            {/* Equity Curve */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Equity Curve</h3>
              <div style={{ height: 300 }}>
                {equityCurveData && (
                  <Line data={equityCurveData} options={chartOptions} />
                )}
              </div>
            </Card>

            {/* Win/Loss Distribution */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Win/Loss Ratio</h3>
              <div style={{ height: 300, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {winLossData && (
                  <Doughnut
                    data={winLossData}
                    options={{
                      ...chartOptions,
                      cutout: '60%'
                    }}
                  />
                )}
              </div>
            </Card>
          </div>

          {/* Charts Row 2 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.lg
            }}
          >
            {/* Daily P&L */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Daily P&L</h3>
              <div style={{ height: 250 }}>
                {dailyPnLData && <Bar data={dailyPnLData} options={chartOptions} />}
              </div>
            </Card>

            {/* By Trading Style */}
            <Card>
              <h3 style={{ marginTop: 0 }}>Performance by Style</h3>
              <div style={{ height: 250 }}>
                {styleData && <Bar data={styleData} options={chartOptions} />}
              </div>
            </Card>
          </div>

          {/* Additional Metrics & Streaks */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: theme.spacing.lg,
              marginBottom: theme.spacing.lg
            }}
          >
            <Card>
              <h3 style={{ marginTop: 0 }}>Trade Statistics</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.sm }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Largest Win</span>
                  <span style={{ color: theme.colors.success, fontWeight: theme.typography.fontWeight.bold }}>
                    {formatCurrency(metrics.largestWin)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Largest Loss</span>
                  <span style={{ color: theme.colors.error, fontWeight: theme.typography.fontWeight.bold }}>
                    {formatCurrency(metrics.largestLoss)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Avg Holding Days</span>
                  <span style={{ fontWeight: theme.typography.fontWeight.bold }}>
                    {metrics.avgHoldingDays.toFixed(1)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Max Win Streak</span>
                  <span style={{ color: theme.colors.success, fontWeight: theme.typography.fontWeight.bold }}>
                    {metrics.streaks.maxWin}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Max Loss Streak</span>
                  <span style={{ color: theme.colors.error, fontWeight: theme.typography.fontWeight.bold }}>
                    {metrics.streaks.maxLoss}
                  </span>
                </div>
              </div>
            </Card>

            {/* Top Symbols */}
            <Card style={{ gridColumn: 'span 2' }}>
              <h3 style={{ marginTop: 0 }}>Top Performing Symbols</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}>
                      <th style={{ textAlign: 'left', padding: theme.spacing.sm }}>Symbol</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Trades</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Win Rate</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSymbols.map((sym, i) => (
                      <tr key={sym.symbol} style={{ borderBottom: `1px solid ${theme.colors.gray100}` }}>
                        <td style={{ padding: theme.spacing.sm }}>
                          <span style={{ color: theme.colors.gray400, marginRight: theme.spacing.sm }}>
                            #{i + 1}
                          </span>
                          <strong>{sym.symbol}</strong>
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {sym.trades}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {sym.winRate.toFixed(1)}%
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            padding: theme.spacing.sm,
                            color: sym.pnl >= 0 ? theme.colors.success : theme.colors.error,
                            fontWeight: theme.typography.fontWeight.bold
                          }}
                        >
                          {formatCurrency(sym.pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* AI Session Stats (if available) */}
          {sessionStats && (
            <Card>
              <h3 style={{ marginTop: 0 }}>Live Trading Session</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: theme.spacing.md
                }}
              >
                <div>
                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                    Status
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.bold,
                      color:
                        sessionStats.status === 'running'
                          ? theme.colors.success
                          : theme.colors.gray500,
                      textTransform: 'capitalize'
                    }}
                  >
                    {sessionStats.status}
                  </div>
                </div>
                <div>
                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                    Today's Trades
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.bold
                    }}
                  >
                    {sessionStats.stats?.totalTrades || 0}
                  </div>
                </div>
                <div>
                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                    Today's P&L
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.bold,
                      color:
                        (sessionStats.stats?.totalPnL || 0) >= 0
                          ? theme.colors.success
                          : theme.colors.error
                    }}
                  >
                    {formatCurrency(sessionStats.stats?.totalPnL || 0)}
                  </div>
                </div>
                <div>
                  <div style={{ color: theme.colors.gray500, fontSize: theme.typography.fontSize.sm }}>
                    Open Positions
                  </div>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.bold
                    }}
                  >
                    {sessionStats.positions?.length || 0}
                  </div>
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default PerformanceAnalytics;
