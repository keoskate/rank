/**
 * PortfolioPage - Consolidated portfolio view
 *
 * Shows positions, P&L, trade history, and quick actions
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import theme from '../../theme';
import Card from '../common/Card';
import Button from '../common/Button';
import MetricCard from '../common/MetricCard';

const PortfolioPage = () => {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPortfolioData();
    const interval = setInterval(fetchPortfolioData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchPortfolioData = async () => {
    try {
      const [accountRes, positionsRes] = await Promise.all([
        fetch('/api/alpaca/account'),
        fetch('/api/alpaca/positions')
      ]);

      if (accountRes.ok) {
        const accountData = await accountRes.json();
        setAccount(accountData);
      }

      if (positionsRes.ok) {
        const positionsData = await positionsRes.json();
        setPositions(Array.isArray(positionsData) ? positionsData : []);
      }

      // TODO: Fetch recent trades from trade history API
    } catch (err) {
      console.error('Failed to fetch portfolio:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    if (!value && value !== 0) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  const formatPercent = (value) => {
    if (!value && value !== 0) return '--';
    const num = parseFloat(value) * 100;
    return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
  };

  const totalPnL = positions.reduce((sum, pos) =>
    sum + parseFloat(pos.unrealized_pl || 0), 0);

  const totalPnLPercent = account?.equity && account?.last_equity
    ? ((account.equity - account.last_equity) / account.last_equity)
    : 0;

  return (
    <div style={{
      padding: theme.spacing.lg,
      maxWidth: theme.layout.maxWidthWide,
      margin: '0 auto'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.lg
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: theme.typography.fontSize.xxl,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            Portfolio
          </h1>
          <p style={{
            margin: 0,
            marginTop: theme.spacing.xs,
            color: theme.colors.gray600
          }}>
            Paper Trading Account
          </p>
        </div>
      </div>

      {/* Account Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: theme.spacing.md,
        marginBottom: theme.spacing.lg
      }}>
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
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md
        }}>
          <h2 style={{
            margin: 0,
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            Positions ({positions.length})
          </h2>
        </div>

        {positions.length === 0 ? (
          <div style={{
            padding: theme.spacing.xl,
            textAlign: 'center',
            color: theme.colors.gray500
          }}>
            No open positions. Start trading from the Rankings page!
            <div style={{ marginTop: theme.spacing.md }}>
              <Button variant="primary" onClick={() => navigate('/')}>
                View Rankings
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: theme.typography.fontSize.sm
            }}>
              <thead>
                <tr style={{
                  borderBottom: `2px solid ${theme.colors.gray200}`,
                  textAlign: 'left'
                }}>
                  <th style={{ padding: theme.spacing.sm }}>Symbol</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Avg Cost</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Current</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>P&L</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>P&L %</th>
                  <th style={{ padding: theme.spacing.sm, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const pnl = parseFloat(pos.unrealized_pl || 0);
                  const pnlPercent = parseFloat(pos.unrealized_plpc || 0) * 100;
                  const isPositive = pnl >= 0;

                  return (
                    <tr
                      key={pos.symbol}
                      style={{
                        borderBottom: `1px solid ${theme.colors.gray100}`,
                        cursor: 'pointer'
                      }}
                      onClick={() => navigate(`/stock/${pos.symbol}`)}
                    >
                      <td style={{
                        padding: theme.spacing.sm,
                        fontWeight: theme.typography.fontWeight.bold
                      }}>
                        {pos.symbol}
                      </td>
                      <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                        {pos.qty}
                      </td>
                      <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                        {formatCurrency(pos.avg_entry_price)}
                      </td>
                      <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>
                        {formatCurrency(pos.current_price)}
                      </td>
                      <td style={{
                        padding: theme.spacing.sm,
                        textAlign: 'right',
                        color: isPositive ? theme.colors.success : theme.colors.error,
                        fontWeight: theme.typography.fontWeight.medium
                      }}>
                        {formatCurrency(pnl)}
                      </td>
                      <td style={{
                        padding: theme.spacing.sm,
                        textAlign: 'right',
                        color: isPositive ? theme.colors.success : theme.colors.error
                      }}>
                        {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                      </td>
                      <td style={{ padding: theme.spacing.sm, textAlign: 'center' }}>
                        <Button
                          variant="outline"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/stock/${pos.symbol}`);
                          }}
                        >
                          Trade
                        </Button>
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
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: theme.spacing.md
      }}>
        {/* Active Auto-Trades */}
        <Card>
          <h3 style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            Auto-Trading
          </h3>
          <div style={{
            padding: theme.spacing.lg,
            textAlign: 'center',
            color: theme.colors.gray500
          }}>
            No active auto-trades.
            <div style={{
              fontSize: theme.typography.fontSize.xs,
              marginTop: theme.spacing.sm
            }}>
              Enable auto-trading from any stock detail page.
            </div>
          </div>
        </Card>

        {/* Recent Activity */}
        <Card>
          <h3 style={{
            margin: 0,
            marginBottom: theme.spacing.md,
            fontSize: theme.typography.fontSize.md,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            Recent Activity
          </h3>
          <div style={{
            padding: theme.spacing.lg,
            textAlign: 'center',
            color: theme.colors.gray500
          }}>
            No recent trades.
          </div>
        </Card>
      </div>
    </div>
  );
};

export default PortfolioPage;
