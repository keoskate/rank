/**
 * PortfolioPage - Consolidated portfolio view
 *
 * Shows positions, P&L, trade history, quick actions, and analytics.
 * Analytics tab provides comprehensive trading performance analysis.
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import theme from '../../theme';
import Card from '../common/Card';
import Button from '../common/Button';
import MetricCard from '../common/MetricCard';
import PortfolioPerformanceChart from '../common/PortfolioPerformanceChart';
import PerformanceAnalyticsPanel from './PerformanceAnalyticsPanel';
import IntraDayCommandCenter from './IntraDayCommandCenter';

const PortfolioPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [allOrders, setAllOrders] = useState([]); // For debugging - more orders
  const [aiSession, setAiSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Active tab: 'overview' or 'analytics'
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'overview');
  // Persist trading mode to localStorage
  const [tradingMode, setTradingMode] = useState(() => {
    try {
      return localStorage.getItem('portfolio-trading-mode') || 'paper';
    } catch {
      return 'paper';
    }
  });
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab') || 'overview';
    if (tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'overview' ? {} : { tab });
  };

  // Persist tradingMode to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('portfolio-trading-mode', tradingMode);
    } catch {}
  }, [tradingMode]);

  useEffect(() => {
    fetchPortfolioData();
    const interval = setInterval(fetchPortfolioData, 10000); // Refresh every 10s for live updates
    return () => clearInterval(interval);
  }, [tradingMode]); // Re-fetch when mode changes

  const fetchPortfolioData = async () => {
    try {
      const modeParam = `mode=${tradingMode}`;
      const [accountRes, positionsRes, ordersRes, allOrdersRes, sessionRes] =
        await Promise.all([
          fetch(`/api/alpaca/account?${modeParam}`),
          fetch(`/api/alpaca/positions?${modeParam}`),
          fetch(`/api/alpaca/orders?status=all&limit=10&${modeParam}`),
          fetch(`/api/alpaca/orders?status=all&limit=50&${modeParam}`), // More orders for debugging
          fetch('/api/ai/session/default_user'),
        ]);

      if (accountRes.ok) {
        const data = await accountRes.json();
        setAccount(data.account || data);
      }

      if (positionsRes.ok) {
        const data = await positionsRes.json();
        const positionsArray = data.positions || data;
        setPositions(Array.isArray(positionsArray) ? positionsArray : []);
      }

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        const ordersArray = data.orders || data;
        setRecentOrders(Array.isArray(ordersArray) ? ordersArray : []);
      }

      if (allOrdersRes.ok) {
        const data = await allOrdersRes.json();
        const ordersArray = data.orders || data;
        setAllOrders(Array.isArray(ordersArray) ? ordersArray : []);
      }

      if (sessionRes.ok) {
        const data = await sessionRes.json();
        setAiSession(data);
      }
    } catch (err) {
      console.error('Failed to fetch portfolio:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = value => {
    if (!value && value !== 0) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  const formatPercent = value => {
    if (!value && value !== 0) return '--';
    const num = parseFloat(value) * 100;
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  const unrealizedPnL = positions.reduce(
    (sum, pos) => sum + parseFloat(pos.unrealizedPL || pos.unrealized_pl || 0),
    0
  );

  // Handle both camelCase and snake_case for account fields
  const equity = parseFloat(account?.equity || account?.portfolio_value || 0);
  const lastEquity = parseFloat(
    account?.last_equity || account?.lastEquity || 0
  );
  // Today's P&L is the difference between current equity and yesterday's closing equity
  const todaysPnL = equity && lastEquity ? equity - lastEquity : 0;
  const todaysPnLPercent = lastEquity ? todaysPnL / lastEquity : 0;

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthWide,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.xxl,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            Portfolio
          </h1>
          <p
            style={{
              margin: 0,
              marginTop: theme.spacing.xs,
              color: theme.colors.gray600,
            }}
          >
            {tradingMode === 'paper' ? 'Paper Trading Account' : 'Live Trading Account'}
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.md,
              padding: '2px',
              marginRight: theme.spacing.md,
            }}
          >
            <button
              onClick={() => handleTabChange('overview')}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: activeTab === 'overview' ? theme.typography.fontWeight.bold : theme.typography.fontWeight.medium,
                backgroundColor: activeTab === 'overview' ? theme.colors.primary : 'transparent',
                color: activeTab === 'overview' ? '#fff' : theme.colors.gray600,
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Overview
            </button>
            <button
              onClick={() => handleTabChange('analytics')}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: activeTab === 'analytics' ? theme.typography.fontWeight.bold : theme.typography.fontWeight.medium,
                backgroundColor: activeTab === 'analytics' ? theme.colors.primary : 'transparent',
                color: activeTab === 'analytics' ? '#fff' : theme.colors.gray600,
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Analytics
            </button>
            <button
              onClick={() => handleTabChange('command')}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: activeTab === 'command' ? theme.typography.fontWeight.bold : theme.typography.fontWeight.medium,
                backgroundColor: activeTab === 'command' ? theme.colors.primary : 'transparent',
                color: activeTab === 'command' ? '#fff' : theme.colors.gray600,
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Command Center
            </button>
          </div>

        {/* Account Mode Toggle */}
        <div style={{ display: 'flex', gap: theme.spacing.sm, alignItems: 'center' }}>
          <button
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            style={{
              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
              fontSize: theme.typography.fontSize.sm,
              backgroundColor: showDebugPanel ? theme.colors.gray200 : 'transparent',
              color: theme.colors.gray600,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              cursor: 'pointer',
            }}
          >
            {showDebugPanel ? 'Hide' : 'Show'} Debug
          </button>
          <div
            style={{
              display: 'flex',
              backgroundColor: theme.colors.gray100,
              borderRadius: theme.borderRadius.md,
              padding: '2px',
            }}
          >
            <button
              onClick={() => setTradingMode('paper')}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: tradingMode === 'paper' ? theme.typography.fontWeight.bold : theme.typography.fontWeight.medium,
                backgroundColor: tradingMode === 'paper' ? theme.colors.warning : 'transparent',
                color: tradingMode === 'paper' ? '#fff' : theme.colors.gray600,
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Paper
            </button>
            <button
              onClick={() => setTradingMode('live')}
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.md}`,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: tradingMode === 'live' ? theme.typography.fontWeight.bold : theme.typography.fontWeight.medium,
                backgroundColor: tradingMode === 'live' ? theme.colors.success : 'transparent',
                color: tradingMode === 'live' ? '#fff' : theme.colors.gray600,
                border: 'none',
                borderRadius: theme.borderRadius.sm,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Live
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Analytics Tab Content */}
      {activeTab === 'analytics' && (
        <PerformanceAnalyticsPanel />
      )}

      {/* Command Center Tab Content */}
      {activeTab === 'command' && (
        <IntraDayCommandCenter tradingMode={tradingMode} />
      )}

      {/* Overview Tab Content */}
      {activeTab === 'overview' && (
        <>
      {/* Account Summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.lg,
        }}
      >
        <MetricCard
          label="Portfolio Value"
          value={formatCurrency(account?.equity)}
          variant="default"
        />
        <MetricCard
          label="Cash Available"
          value={formatCurrency(account?.cash)}
          variant="default"
        />
        <MetricCard
          label="Buying Power"
          value={formatCurrency(account?.buying_power)}
          variant="default"
        />
        <MetricCard
          label="Today's P&L"
          value={formatCurrency(todaysPnL)}
          subtext={formatPercent(todaysPnLPercent)}
          variant={todaysPnL >= 0 ? 'success' : 'error'}
        />
      </div>

      {/* Performance Chart */}
      <PortfolioPerformanceChart
        tradingMode={tradingMode}
        orders={allOrders}
        height={280}
      />

      {/* Positions */}
      <Card style={{ marginBottom: theme.spacing.lg }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.spacing.md,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            Positions ({positions.length})
          </h2>
        </div>

        {positions.length === 0 ? (
          <div
            style={{
              padding: theme.spacing.xl,
              textAlign: 'center',
              color: theme.colors.gray500,
            }}
          >
            No open positions. Start trading from the Rankings page!
            <div style={{ marginTop: theme.spacing.md }}>
              <Button variant="primary" onClick={() => navigate('/')}>
                View Rankings
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: `2px solid ${theme.colors.gray200}`,
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: theme.spacing.sm }}>Symbol</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                    Qty
                  </th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                    Avg Cost
                  </th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                    Current
                  </th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                    P&L
                  </th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                    P&L %
                  </th>
                  <th
                    style={{ padding: theme.spacing.sm, textAlign: 'center' }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  // Handle both camelCase (API) and snake_case field names
                  const pnl = parseFloat(
                    pos.unrealizedPL || pos.unrealized_pl || 0
                  );
                  const pnlPercent =
                    parseFloat(
                      pos.unrealizedPLPercent || pos.unrealized_plpc || 0
                    );
                  const rawQty = pos.quantity || pos.qty;
                  // Detect if this is a crypto position (symbol contains USD or / like BTCUSD or BTC/USD)
                  const isCrypto = pos.symbol?.includes('USD') || pos.symbol?.includes('/') || pos.assetClass === 'crypto';
                  // Format qty: show 8 decimal places for crypto (fractional), whole numbers for stocks
                  const qty = isCrypto && rawQty < 1 ? rawQty.toFixed(8) : (Number.isInteger(rawQty) ? rawQty : rawQty.toFixed(4));
                  const avgPrice = pos.avgEntryPrice || pos.avg_entry_price;
                  const currentPrice = pos.currentPrice || pos.current_price;
                  const isPositive = pnl >= 0;

                  return (
                    <tr
                      key={pos.symbol}
                      style={{
                        borderBottom: `1px solid ${theme.colors.gray100}`,
                      }}
                    >
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          fontWeight: theme.typography.fontWeight.bold,
                        }}
                      >
                        <Link
                          to={`/stock/${pos.symbol}`}
                          style={{
                            color: theme.colors.primary,
                            textDecoration: 'none',
                            fontWeight: theme.typography.fontWeight.bold,
                          }}
                        >
                          {pos.symbol}
                        </Link>
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                        }}
                      >
                        {qty}
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                        }}
                      >
                        {formatCurrency(avgPrice)}
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                        }}
                      >
                        {formatCurrency(currentPrice)}
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                          color: isPositive
                            ? theme.colors.success
                            : theme.colors.error,
                          fontWeight: theme.typography.fontWeight.medium,
                        }}
                      >
                        {formatCurrency(pnl)}
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                          color: isPositive
                            ? theme.colors.success
                            : theme.colors.error,
                        }}
                      >
                        {pnlPercent >= 0 ? '+' : ''}
                        {pnlPercent.toFixed(2)}%
                      </td>
                      <td
                        style={{
                          padding: theme.spacing.sm,
                          textAlign: 'center',
                        }}
                      >
                        <Link to={`/stock/${pos.symbol}`}>
                          <Button variant="outline" size="small">
                            Trade
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Quick Stats */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: theme.spacing.md,
        }}
      >
        {/* AI Trading Session Status */}
        <Card>
          <h3
            style={{
              margin: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.md,
              fontWeight: theme.typography.fontWeight.bold,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>AI Trading</span>
            {aiSession && aiSession.status !== 'stopped' && (
              <span
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  padding: '2px 8px',
                  borderRadius: theme.borderRadius.sm,
                  backgroundColor:
                    aiSession.status === 'running'
                      ? theme.colors.success
                      : theme.colors.warning,
                  color: 'white',
                }}
              >
                {aiSession.status === 'running' ? 'Active' : 'Paused'}
              </span>
            )}
          </h3>
          {aiSession && aiSession.status !== 'stopped' ? (
            <div style={{ fontSize: theme.typography.fontSize.sm }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: theme.spacing.sm,
                  marginBottom: theme.spacing.md,
                }}
              >
                <div>
                  <div
                    style={{
                      color: theme.colors.gray500,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    Trades Today
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.bold }}>
                    {aiSession.stats?.totalTrades || 0}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      color: theme.colors.gray500,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    Win Rate
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.bold }}>
                    {aiSession.stats?.winRate?.toFixed(1) || 0}%
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      color: theme.colors.gray500,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    Session P&L
                  </div>
                  <div
                    style={{
                      fontWeight: theme.typography.fontWeight.bold,
                      color:
                        (aiSession.stats?.totalPnL || 0) >= 0
                          ? theme.colors.success
                          : theme.colors.error,
                    }}
                  >
                    {formatCurrency(aiSession.stats?.totalPnL || 0)}
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      color: theme.colors.gray500,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    Positions
                  </div>
                  <div style={{ fontWeight: theme.typography.fontWeight.bold }}>
                    {aiSession.positions?.length || 0}
                  </div>
                </div>
              </div>
              <Link to="/live-trading">
                <Button
                  variant="outline"
                  size="small"
                  style={{ width: '100%' }}
                >
                  View Trading Dashboard
                </Button>
              </Link>
            </div>
          ) : (
            <div
              style={{
                padding: theme.spacing.lg,
                textAlign: 'center',
                color: theme.colors.gray500,
              }}
            >
              No active AI trading session.
              <div style={{ marginTop: theme.spacing.md }}>
                <Link to="/live-trading">
                  <Button variant="primary" size="small">
                    Start AI Trading
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </Card>

        {/* Recent Orders */}
        <Card>
          <h3
            style={{
              margin: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.md,
              fontWeight: theme.typography.fontWeight.bold,
            }}
          >
            Recent Orders
          </h3>
          {recentOrders.length > 0 ? (
            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
              {recentOrders.slice(0, 8).map((order, idx) => (
                <div
                  key={order.id || idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: `${theme.spacing.sm} 0`,
                    borderBottom:
                      idx < recentOrders.length - 1
                        ? `1px solid ${theme.colors.gray100}`
                        : 'none',
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <span
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        padding: '2px 6px',
                        borderRadius: theme.borderRadius.sm,
                        backgroundColor:
                          order.side === 'buy'
                            ? theme.colors.success + '20'
                            : theme.colors.error + '20',
                        color:
                          order.side === 'buy'
                            ? theme.colors.success
                            : theme.colors.error,
                        fontWeight: theme.typography.fontWeight.medium,
                        textTransform: 'uppercase',
                      }}
                    >
                      {order.side}
                    </span>
                    <span
                      style={{ fontWeight: theme.typography.fontWeight.bold }}
                    >
                      {order.symbol}
                    </span>
                    <span style={{ color: theme.colors.gray500 }}>
                      x{order.quantity || order.qty}
                    </span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {/* P/L for sell orders */}
                    {order.side === 'sell' &&
                      order.pnl !== undefined &&
                      order.pnl !== null && (
                        <div
                          style={{
                            fontSize: theme.typography.fontSize.sm,
                            fontWeight: theme.typography.fontWeight.bold,
                            color:
                              parseFloat(order.pnl) >= 0
                                ? theme.colors.success
                                : theme.colors.error,
                            marginBottom: '2px',
                          }}
                        >
                          {parseFloat(order.pnl) >= 0 ? '+' : ''}
                          {formatCurrency(order.pnl)}
                        </div>
                      )}
                    <div
                      style={{
                        fontSize: theme.typography.fontSize.xs,
                        padding: '2px 6px',
                        borderRadius: theme.borderRadius.sm,
                        backgroundColor:
                          order.status === 'filled'
                            ? theme.colors.success + '20'
                            : order.status === 'canceled'
                              ? theme.colors.gray200
                              : theme.colors.warning + '20',
                        color:
                          order.status === 'filled'
                            ? theme.colors.success
                            : order.status === 'canceled'
                              ? theme.colors.gray500
                              : theme.colors.warning,
                      }}
                    >
                      {order.status}
                    </div>
                    {order.filledAvgPrice && (
                      <div
                        style={{
                          color: theme.colors.gray500,
                          fontSize: theme.typography.fontSize.xs,
                          marginTop: '2px',
                        }}
                      >
                        @ {formatCurrency(order.filledAvgPrice)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: theme.spacing.lg,
                textAlign: 'center',
                color: theme.colors.gray500,
              }}
            >
              No recent orders.
            </div>
          )}
        </Card>
      </div>

      {/* Debug Panel - Expanded Trade History */}
      {showDebugPanel && (
        <Card style={{ marginTop: theme.spacing.lg }}>
          <h3
            style={{
              margin: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.md,
              fontWeight: theme.typography.fontWeight.bold,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            Trade Activity Log
            <span
              style={{
                fontSize: theme.typography.fontSize.xs,
                padding: '2px 8px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor: tradingMode === 'paper' ? theme.colors.warning + '20' : theme.colors.success + '20',
                color: tradingMode === 'paper' ? theme.colors.warning : theme.colors.success,
              }}
            >
              {tradingMode.toUpperCase()}
            </span>
          </h3>

          {/* Summary Stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.md,
              marginBottom: theme.spacing.md,
            }}
          >
            <div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Total Orders
              </div>
              <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
                {allOrders.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Filled Orders
              </div>
              <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold }}>
                {allOrders.filter(o => o.status === 'filled').length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Buy Orders
              </div>
              <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.success }}>
                {allOrders.filter(o => o.side === 'buy').length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Sell Orders
              </div>
              <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.error }}>
                {allOrders.filter(o => o.side === 'sell').length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.gray500 }}>
                Canceled
              </div>
              <div style={{ fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold, color: theme.colors.gray500 }}>
                {allOrders.filter(o => o.status === 'canceled').length}
              </div>
            </div>
          </div>

          {/* Detailed Order List */}
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: theme.typography.fontSize.xs,
              }}
            >
              <thead>
                <tr style={{ borderBottom: `2px solid ${theme.colors.gray200}`, textAlign: 'left' }}>
                  <th style={{ padding: theme.spacing.xs, position: 'sticky', top: 0, backgroundColor: '#fff' }}>Time</th>
                  <th style={{ padding: theme.spacing.xs, position: 'sticky', top: 0, backgroundColor: '#fff' }}>Symbol</th>
                  <th style={{ padding: theme.spacing.xs, position: 'sticky', top: 0, backgroundColor: '#fff' }}>Side</th>
                  <th style={{ padding: theme.spacing.xs, textAlign: 'right', position: 'sticky', top: 0, backgroundColor: '#fff' }}>Qty</th>
                  <th style={{ padding: theme.spacing.xs, textAlign: 'right', position: 'sticky', top: 0, backgroundColor: '#fff' }}>Price</th>
                  <th style={{ padding: theme.spacing.xs, textAlign: 'right', position: 'sticky', top: 0, backgroundColor: '#fff' }}>Total</th>
                  <th style={{ padding: theme.spacing.xs, position: 'sticky', top: 0, backgroundColor: '#fff' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: theme.spacing.lg, textAlign: 'center', color: theme.colors.gray500 }}>
                      No orders found for this account
                    </td>
                  </tr>
                ) : (
                  allOrders.map((order, idx) => {
                    const filledAt = order.filledAt || order.filled_at;
                    const createdAt = order.createdAt || order.created_at;
                    const displayTime = filledAt || createdAt;
                    const qty = parseFloat(order.filledQty || order.filled_qty || order.qty || order.quantity || 0);
                    const price = parseFloat(order.filledAvgPrice || order.filled_avg_price || order.limitPrice || order.limit_price || 0);
                    const total = qty * price;

                    return (
                      <tr
                        key={order.id || idx}
                        style={{
                          borderBottom: `1px solid ${theme.colors.gray100}`,
                          backgroundColor: idx % 2 === 0 ? '#fff' : theme.colors.gray50,
                        }}
                      >
                        <td style={{ padding: theme.spacing.xs, fontFamily: 'monospace' }}>
                          {displayTime ? new Date(displayTime).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          }) : '--'}
                        </td>
                        <td style={{ padding: theme.spacing.xs, fontWeight: theme.typography.fontWeight.bold }}>
                          {order.symbol}
                        </td>
                        <td style={{ padding: theme.spacing.xs }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: theme.borderRadius.sm,
                              backgroundColor: order.side === 'buy' ? theme.colors.success + '20' : theme.colors.error + '20',
                              color: order.side === 'buy' ? theme.colors.success : theme.colors.error,
                              fontWeight: theme.typography.fontWeight.medium,
                              textTransform: 'uppercase',
                            }}
                          >
                            {order.side}
                          </span>
                        </td>
                        <td style={{ padding: theme.spacing.xs, textAlign: 'right', fontFamily: 'monospace' }}>
                          {qty > 0 ? qty : '--'}
                        </td>
                        <td style={{ padding: theme.spacing.xs, textAlign: 'right', fontFamily: 'monospace' }}>
                          {price > 0 ? formatCurrency(price) : '--'}
                        </td>
                        <td style={{ padding: theme.spacing.xs, textAlign: 'right', fontFamily: 'monospace', fontWeight: theme.typography.fontWeight.medium }}>
                          {total > 0 ? formatCurrency(total) : '--'}
                        </td>
                        <td style={{ padding: theme.spacing.xs }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: theme.borderRadius.sm,
                              fontSize: theme.typography.fontSize.xs,
                              backgroundColor:
                                order.status === 'filled' ? theme.colors.success + '20' :
                                order.status === 'canceled' ? theme.colors.gray200 :
                                order.status === 'new' || order.status === 'pending_new' ? theme.colors.primary + '20' :
                                theme.colors.warning + '20',
                              color:
                                order.status === 'filled' ? theme.colors.success :
                                order.status === 'canceled' ? theme.colors.gray500 :
                                order.status === 'new' || order.status === 'pending_new' ? theme.colors.primary :
                                theme.colors.warning,
                            }}
                          >
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Account Debug Info */}
          <div
            style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.md,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.md,
              fontFamily: 'monospace',
              fontSize: theme.typography.fontSize.xs,
            }}
          >
            <div style={{ marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.bold }}>
              Account Details ({tradingMode.toUpperCase()})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.spacing.sm }}>
              <div>Account ID: {account?.id || account?.accountNumber || '--'}</div>
              <div>Status: {account?.status || '--'}</div>
              <div>Equity: {formatCurrency(account?.equity)}</div>
              <div>Cash: {formatCurrency(account?.cash)}</div>
              <div>Buying Power: {formatCurrency(account?.buyingPower || account?.buying_power)}</div>
              <div>Day Trade Count: {account?.daytradeCount || account?.daytrade_count || 0}</div>
            </div>
          </div>
        </Card>
      )}
        </>
      )}
    </div>
  );
};

export default PortfolioPage;
