/**
 * PortfolioPage - Consolidated portfolio view
 *
 * Shows positions, P&L, trade history, and quick actions
 */

import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import theme from '../../theme';
import Card from '../common/Card';
import Button from '../common/Button';
import MetricCard from '../common/MetricCard';

const PortfolioPage = () => {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [aiSession, setAiSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPortfolioData();
    const interval = setInterval(fetchPortfolioData, 10000); // Refresh every 10s for live updates
    return () => clearInterval(interval);
  }, []);

  const fetchPortfolioData = async () => {
    try {
      const [accountRes, positionsRes, ordersRes, sessionRes] =
        await Promise.all([
          fetch('/api/alpaca/account'),
          fetch('/api/alpaca/positions'),
          fetch('/api/alpaca/orders?status=all&limit=10'),
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

  const totalPnL = positions.reduce(
    (sum, pos) => sum + parseFloat(pos.unrealizedPL || pos.unrealized_pl || 0),
    0
  );

  // Handle both camelCase and snake_case for account fields
  const equity = parseFloat(account?.equity || account?.portfolio_value || 0);
  const lastEquity = parseFloat(
    account?.last_equity || account?.lastEquity || 0
  );
  const totalPnLPercent =
    equity && lastEquity ? (equity - lastEquity) / lastEquity : 0;

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
            Paper Trading Account
          </p>
        </div>
      </div>

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
          value={formatCurrency(totalPnL)}
          subtext={formatPercent(totalPnLPercent)}
          variant={totalPnL >= 0 ? 'success' : 'error'}
        />
      </div>

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
                    ) * 100;
                  const qty = pos.quantity || pos.qty;
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
    </div>
  );
};

export default PortfolioPage;
