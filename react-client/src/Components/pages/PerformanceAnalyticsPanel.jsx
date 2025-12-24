/**
 * PerformanceAnalyticsPanel - Embeddable Analytics for Portfolio Page
 *
 * A streamlined version of the full PerformanceAnalytics page,
 * designed to be embedded within the Portfolio page as a tab.
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
  Filler,
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

const PerformanceAnalyticsPanel = () => {
  const [timeRange, setTimeRange] = useState('all');
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const tradesRes = await fetch('/api/import/schwab/default_user');
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades(data.trades || data || []);
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

    return trades.filter(t => new Date(t.exitDate) >= cutoff);
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
        streaks: { maxWin: 0, maxLoss: 0 },
      };
    }

    const wins = filteredTrades.filter(t => t.isWin);
    const losses = filteredTrades.filter(t => !t.isWin);

    const totalPnL = filteredTrades.reduce((s, t) => s + t.profit, 0);
    const avgWin =
      wins.length > 0
        ? wins.reduce((s, t) => s + t.profit, 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length)
        : 0;

    let maxWinStreak = 0;
    let maxLossStreak = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    filteredTrades.forEach(t => {
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
      largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.profit)) : 0,
      largestLoss:
        losses.length > 0 ? Math.min(...losses.map(t => t.profit)) : 0,
      avgHoldingDays:
        filteredTrades.reduce((s, t) => s + t.holdingDays, 0) /
        filteredTrades.length,
      streaks: { maxWin: maxWinStreak, maxLoss: maxLossStreak },
    };
  }, [filteredTrades]);

  // Equity curve data
  const equityCurveData = useMemo(() => {
    if (filteredTrades.length === 0) return null;

    const sorted = [...filteredTrades].sort(
      (a, b) => new Date(a.exitDate) - new Date(b.exitDate)
    );

    let cumulative = 0;
    const data = sorted.map(trade => {
      cumulative += trade.profit;
      return {
        date: new Date(trade.exitDate).toLocaleDateString(),
        value: cumulative,
      };
    });

    return {
      labels: data.map(d => d.date),
      datasets: [
        {
          label: 'Cumulative P&L',
          data: data.map(d => d.value),
          borderColor: theme.colors.primary,
          backgroundColor: theme.colors.primary + '20',
          fill: true,
          tension: 0.3,
        },
      ],
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
          backgroundColor: [theme.colors.success, theme.colors.error],
        },
      ],
    };
  }, [filteredTrades, metrics]);

  // Top symbols
  const topSymbols = useMemo(() => {
    if (filteredTrades.length === 0) return [];

    const bySymbol = {};
    filteredTrades.forEach(t => {
      if (!bySymbol[t.symbol]) {
        bySymbol[t.symbol] = { trades: 0, wins: 0, pnl: 0 };
      }
      bySymbol[t.symbol].trades++;
      if (t.isWin) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].pnl += t.profit;
    });

    return Object.entries(bySymbol)
      .sort((a, b) => b[1].pnl - a[1].pnl)
      .slice(0, 5)
      .map(([symbol, data]) => ({
        symbol,
        ...data,
        winRate: (data.wins / data.trades) * 100,
      }));
  }, [filteredTrades]);

  const formatCurrency = value => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  if (loading) {
    return (
      <div
        style={{
          padding: theme.spacing.xl,
          textAlign: 'center',
          color: theme.colors.gray500,
        }}
      >
        Loading analytics...
      </div>
    );
  }

  if (filteredTrades.length === 0) {
    return (
      <Card style={{ textAlign: 'center', padding: theme.spacing.xl }}>
        <h3 style={{ marginTop: 0 }}>No Trade Data Available</h3>
        <p style={{ color: theme.colors.gray500 }}>
          Import your Schwab trades or start live trading to see analytics.
        </p>
        <Button onClick={() => (window.location.href = '/import-trades')}>
          Import Trades
        </Button>
      </Card>
    );
  }

  return (
    <>
      {/* Time Range Filter */}
      <div
        style={{
          display: 'flex',
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.lg,
        }}
      >
        {['week', 'month', 'quarter', 'year', 'all'].map(range => (
          <Button
            key={range}
            variant={timeRange === range ? 'primary' : 'ghost'}
            size="small"
            onClick={() => setTimeRange(range)}
          >
            {range === 'all'
              ? 'All Time'
              : range.charAt(0).toUpperCase() + range.slice(1)}
          </Button>
        ))}
        <span style={{ marginLeft: 'auto', color: theme.colors.gray500 }}>
          {filteredTrades.length} trades analyzed
        </span>
      </div>

      {/* Key Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.lg,
        }}
      >
        <MetricCard label="Total Trades" value={metrics.totalTrades} />
        <MetricCard
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          subtext={`${metrics.wins}W / ${metrics.losses}L`}
          variant={metrics.winRate >= 50 ? 'success' : 'error'}
        />
        <MetricCard
          label="Total P&L"
          value={formatCurrency(metrics.totalPnL)}
          variant={metrics.totalPnL >= 0 ? 'success' : 'error'}
        />
        <MetricCard
          label="Profit Factor"
          value={metrics.profitFactor.toFixed(2)}
          variant={metrics.profitFactor >= 1 ? 'success' : 'error'}
        />
        <MetricCard
          label="Avg Win"
          value={formatCurrency(metrics.avgWin)}
          variant="success"
        />
        <MetricCard
          label="Avg Loss"
          value={formatCurrency(metrics.avgLoss)}
          variant="error"
        />
      </div>

      {/* Charts Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: theme.spacing.lg,
          marginBottom: theme.spacing.lg,
        }}
      >
        {/* Equity Curve */}
        <Card>
          <h3 style={{ marginTop: 0 }}>Equity Curve</h3>
          <div style={{ height: 250 }}>
            {equityCurveData && (
              <Line data={equityCurveData} options={chartOptions} />
            )}
          </div>
        </Card>

        {/* Win/Loss Distribution */}
        <Card>
          <h3 style={{ marginTop: 0 }}>Win/Loss Ratio</h3>
          <div
            style={{
              height: 250,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {winLossData && (
              <Doughnut
                data={winLossData}
                options={{
                  ...chartOptions,
                  cutout: '60%',
                }}
              />
            )}
          </div>
        </Card>
      </div>

      {/* Stats & Top Symbols Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 2fr',
          gap: theme.spacing.lg,
        }}
      >
        {/* Trade Statistics */}
        <Card>
          <h3 style={{ marginTop: 0 }}>Trade Statistics</h3>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: theme.spacing.sm,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Largest Win</span>
              <span
                style={{
                  color: theme.colors.success,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {formatCurrency(metrics.largestWin)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Largest Loss</span>
              <span
                style={{
                  color: theme.colors.error,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
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
              <span
                style={{
                  color: theme.colors.success,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {metrics.streaks.maxWin}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Max Loss Streak</span>
              <span
                style={{
                  color: theme.colors.error,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {metrics.streaks.maxLoss}
              </span>
            </div>
          </div>
        </Card>

        {/* Top Symbols */}
        <Card>
          <h3 style={{ marginTop: 0 }}>Top Performing Symbols</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${theme.colors.gray200}`,
                  }}
                >
                  <th style={{ textAlign: 'left', padding: theme.spacing.sm }}>
                    Symbol
                  </th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                    Trades
                  </th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                    Win Rate
                  </th>
                  <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                    P&L
                  </th>
                </tr>
              </thead>
              <tbody>
                {topSymbols.map((sym, i) => (
                  <tr
                    key={sym.symbol}
                    style={{
                      borderBottom: `1px solid ${theme.colors.gray100}`,
                    }}
                  >
                    <td style={{ padding: theme.spacing.sm }}>
                      <span
                        style={{
                          color: theme.colors.gray400,
                          marginRight: theme.spacing.sm,
                        }}
                      >
                        #{i + 1}
                      </span>
                      <strong>{sym.symbol}</strong>
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                      }}
                    >
                      {sym.trades}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                      }}
                    >
                      {sym.winRate.toFixed(1)}%
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        padding: theme.spacing.sm,
                        color:
                          sym.pnl >= 0
                            ? theme.colors.success
                            : theme.colors.error,
                        fontWeight: theme.typography.fontWeight.bold,
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
    </>
  );
};

export default PerformanceAnalyticsPanel;
