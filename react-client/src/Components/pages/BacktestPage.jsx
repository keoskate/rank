/**
 * Backtesting Page - Strategy testing and performance analysis
 *
 * Features:
 * - Strategy configuration (top N, rebalance frequency, date range)
 * - Run backtest button
 * - Results display (returns, win rate, Sharpe ratio, max drawdown)
 * - Trade history
 * - Performance charts
 */

import { useState, useEffect } from 'react';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import theme from '../../theme';

const BacktestPage = () => {
  // Strategy configuration
  const [topN, setTopN] = useState(5);
  const [rebalanceFrequency, setRebalanceFrequency] = useState('daily');
  const [days, setDays] = useState(90);
  const [initialCapital, setInitialCapital] = useState(100000);

  // State
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [snapshotsAvailable, setSnapshotsAvailable] = useState(false);

  // Check if snapshots are available
  useEffect(() => {
    checkSnapshots();
  }, []);

  const checkSnapshots = async () => {
    try {
      const response = await fetch('/api/snapshots/dates');
      const data = await response.json();
      setSnapshotsAvailable(data.count > 0);
    } catch (err) {
      console.error('Error checking snapshots:', err);
    }
  };

  // Generate synthetic historical data
  const generateHistory = async () => {
    if (generating) return;

    setGenerating(true);
    setError(null);

    try {
      console.log('Generating synthetic history...');

      // Send request with empty stocks array - server will use defaults
      const response = await fetch('/api/snapshots/generate-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stocks: [], // Server will use default mock stocks
          days,
          stockListName: 'default',
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate history');
      }

      console.log(`Generated ${data.snapshotsGenerated} snapshots`);
      setSnapshotsAvailable(true);
      alert(`✅ Generated ${days} days of synthetic historical data!`);
    } catch (err) {
      console.error('Error generating history:', err);
      setError('Failed to generate historical data: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Backfill REAL historical data from Polygon API
  const backfillRealData = async () => {
    if (generating) return;

    setGenerating(true);
    setError(null);

    try {
      console.log('Backfilling real historical data from Polygon API...');

      const response = await fetch('/api/snapshots/backfill-real-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: [], // Server will use default symbols
          days,
          stockListName: 'Real Data',
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to backfill real data');
      }

      console.log(
        `Backfilled ${data.snapshotsGenerated} snapshots from ${data.dataSource}`
      );
      setSnapshotsAvailable(true);
      alert(
        `✅ Fetched ${days} days of REAL market data from ${data.dataSource}!`
      );
    } catch (err) {
      console.error('Error backfilling real data:', err);
      setError('Failed to fetch real historical data: ' + err.message);
    } finally {
      setGenerating(false);
    }
  };

  // Run backtest
  const runBacktest = async () => {
    if (loading || !snapshotsAvailable) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      // Calculate date range
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      console.log(`Running backtest: ${startDate} to ${endDate}`);

      const response = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          topN,
          rebalanceFrequency,
          initialCapital,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Backtest failed');
      }

      setResults(data.results);
      console.log('Backtest completed:', data.results);
    } catch (err) {
      console.error('Error running backtest:', err);
      setError('Failed to run backtest: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        padding: theme.spacing.lg,
        maxWidth: theme.layout.maxWidthMedium,
        margin: '0 auto',
      }}
    >
      <h1
        style={{
          marginBottom: theme.spacing.sm,
          color: theme.colors.text,
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.bold,
        }}
      >
        📈 Strategy Backtesting
      </h1>
      <p
        style={{
          color: theme.colors.textLight,
          marginBottom: theme.spacing.xl,
          fontSize: theme.typography.fontSize.base,
        }}
      >
        Test your ranking strategies with historical data
      </p>

      {/* Setup Section */}
      {!snapshotsAvailable && (
        <Card variant="warning" style={{ marginBottom: theme.spacing.xl }}>
          <h3
            style={{
              margin: `0 0 ${theme.spacing.sm} 0`,
              color: theme.colors.warningDark,
              fontSize: theme.typography.fontSize.lg,
              fontWeight: theme.typography.fontWeight.medium,
            }}
          >
            ⚠️ No Historical Data Available
          </h3>
          <p
            style={{
              margin: `0 0 ${theme.spacing.md} 0`,
              color: theme.colors.warningDark,
              fontSize: theme.typography.fontSize.base,
            }}
          >
            Choose a data source to enable backtesting:
          </p>
          <div
            style={{ display: 'flex', gap: theme.spacing.md, flexWrap: 'wrap' }}
          >
            <Button
              variant="primary"
              size="large"
              onClick={generateHistory}
              disabled={generating}
              style={{ flex: '1', minWidth: '200px' }}
            >
              {generating
                ? '⏳ Generating...'
                : `🔄 Generate ${days} Days (Synthetic)`}
            </Button>
            <Button
              variant="success"
              size="large"
              onClick={backfillRealData}
              disabled={generating}
              style={{ flex: '1', minWidth: '200px' }}
            >
              {generating
                ? '⏳ Fetching...'
                : `📊 Fetch ${days} Days (Real Data)`}
            </Button>
          </div>
          <p
            style={{
              margin: `${theme.spacing.md} 0 0 0`,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.warningDark,
            }}
          >
            <strong>Synthetic:</strong> Fast, random walk simulation •{' '}
            <strong>Real Data:</strong> Actual market data from Polygon API (~2
            min)
          </p>
        </Card>
      )}

      {/* Strategy Configuration */}
      <Card style={{ marginBottom: theme.spacing.xl }}>
        <h2
          style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            color: theme.colors.text,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.medium,
          }}
        >
          Strategy Configuration
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: theme.spacing.lg,
            marginBottom: theme.spacing.lg,
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: theme.spacing.sm,
                fontWeight: theme.typography.fontWeight.medium,
                fontSize: theme.typography.fontSize.base,
                color: theme.colors.text,
              }}
            >
              Top N Stocks
            </label>
            <input
              type="number"
              value={topN}
              onChange={e => setTopN(parseInt(e.target.value))}
              min="1"
              max="20"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
                fontFamily: theme.typography.fontFamily,
              }}
            />
            <small
              style={{
                color: theme.colors.textLight,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              Buy the top {topN} ranked stocks
            </small>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: theme.spacing.sm,
                fontWeight: theme.typography.fontWeight.medium,
                fontSize: theme.typography.fontSize.base,
                color: theme.colors.text,
              }}
            >
              Rebalance Frequency
            </label>
            <select
              value={rebalanceFrequency}
              onChange={e => setRebalanceFrequency(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
                fontFamily: theme.typography.fontFamily,
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <small
              style={{
                color: theme.colors.textLight,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              How often to rebalance portfolio
            </small>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: theme.spacing.sm,
                fontWeight: theme.typography.fontWeight.medium,
                fontSize: theme.typography.fontSize.base,
                color: theme.colors.text,
              }}
            >
              Backtest Period (Days)
            </label>
            <input
              type="number"
              value={days}
              onChange={e => setDays(parseInt(e.target.value))}
              min="7"
              max="365"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
                fontFamily: theme.typography.fontFamily,
              }}
            />
            <small
              style={{
                color: theme.colors.textLight,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              Number of days to test
            </small>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                marginBottom: theme.spacing.sm,
                fontWeight: theme.typography.fontWeight.medium,
                fontSize: theme.typography.fontSize.base,
                color: theme.colors.text,
              }}
            >
              Initial Capital ($)
            </label>
            <input
              type="number"
              value={initialCapital}
              onChange={e => setInitialCapital(parseInt(e.target.value))}
              min="1000"
              step="1000"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
                fontFamily: theme.typography.fontFamily,
              }}
            />
            <small
              style={{
                color: theme.colors.textLight,
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              Starting portfolio value
            </small>
          </div>
        </div>

        <Button
          variant={snapshotsAvailable ? 'success' : 'primary'}
          size="large"
          onClick={runBacktest}
          disabled={loading || !snapshotsAvailable}
          style={{
            width: '100%',
            fontSize: theme.typography.fontSize.lg,
          }}
        >
          {loading ? '⏳ Running Backtest...' : '🧪 Run Backtest'}
        </Button>
      </Card>

      {/* Error Display */}
      {error && (
        <Card variant="error" style={{ marginBottom: theme.spacing.xl }}>
          <span
            style={{
              color: theme.colors.errorDark,
              fontSize: theme.typography.fontSize.base,
            }}
          >
            ❌ {error}
          </span>
        </Card>
      )}

      {/* Results Display */}
      {results && (
        <div>
          {/* Performance Summary */}
          <Card style={{ marginBottom: theme.spacing.xl }}>
            <h2
              style={{
                margin: `0 0 ${theme.spacing.lg} 0`,
                color: theme.colors.text,
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              📊 Performance Summary
            </h2>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: theme.spacing.lg,
              }}
            >
              <PerformanceMetricCard
                label="Total Return"
                value={`${results.performance.totalReturn >= 0 ? '+' : ''}${results.performance.totalReturn.toFixed(2)}%`}
                variant={
                  results.performance.totalReturn >= 0 ? 'success' : 'error'
                }
              />
              <PerformanceMetricCard
                label="Annualized Return"
                value={`${results.performance.annualizedReturn >= 0 ? '+' : ''}${results.performance.annualizedReturn.toFixed(2)}%`}
                variant={
                  results.performance.annualizedReturn >= 0
                    ? 'success'
                    : 'error'
                }
              />
              <PerformanceMetricCard
                label="Win Rate"
                value={`${results.trades.winRate.toFixed(1)}%`}
                variant={results.trades.winRate >= 50 ? 'success' : 'error'}
              />
              <PerformanceMetricCard
                label="Sharpe Ratio"
                value={results.risk.sharpeRatio.toFixed(2)}
                variant={
                  results.risk.sharpeRatio >= 1
                    ? 'success'
                    : results.risk.sharpeRatio >= 0.5
                      ? 'warning'
                      : 'error'
                }
              />
              <PerformanceMetricCard
                label="Max Drawdown"
                value={`-${results.risk.maxDrawdownPercent.toFixed(2)}%`}
                variant={
                  results.risk.maxDrawdownPercent <= 10
                    ? 'success'
                    : results.risk.maxDrawdownPercent <= 20
                      ? 'warning'
                      : 'error'
                }
              />
              <PerformanceMetricCard
                label="Total Trades"
                value={results.trades.sells.toString()}
                variant="info"
              />
            </div>
          </Card>

          {/* Trade Statistics */}
          <Card style={{ marginBottom: theme.spacing.xl }}>
            <h2
              style={{
                margin: `0 0 ${theme.spacing.lg} 0`,
                color: theme.colors.text,
                fontSize: theme.typography.fontSize.xl,
                fontWeight: theme.typography.fontWeight.medium,
              }}
            >
              💹 Trade Statistics
            </h2>

            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: theme.typography.fontSize.base,
              }}
            >
              <tbody>
                <tr
                  style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}
                >
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.text,
                    }}
                  >
                    Profitable Trades:
                  </td>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      color: theme.colors.success,
                    }}
                  >
                    {results.trades.profitableTrades}
                  </td>
                </tr>
                <tr
                  style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}
                >
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.text,
                    }}
                  >
                    Losing Trades:
                  </td>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      color: theme.colors.error,
                    }}
                  >
                    {results.trades.losingTrades}
                  </td>
                </tr>
                <tr
                  style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}
                >
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.text,
                    }}
                  >
                    Average Return per Trade:
                  </td>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      color: theme.colors.text,
                    }}
                  >
                    {results.trades.avgReturn.toFixed(2)}%
                  </td>
                </tr>
                <tr
                  style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}
                >
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.text,
                    }}
                  >
                    Average Profit per Trade:
                  </td>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      color: theme.colors.text,
                    }}
                  >
                    ${results.trades.avgProfit.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontWeight: theme.typography.fontWeight.medium,
                      color: theme.colors.text,
                    }}
                  >
                    Total Profit:
                  </td>
                  <td
                    style={{
                      padding: `${theme.spacing.sm} 0`,
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.medium,
                      color:
                        results.performance.totalProfit >= 0
                          ? theme.colors.success
                          : theme.colors.error,
                    }}
                  >
                    ${results.performance.totalProfit.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          {/* Trade History */}
          {results.allTrades && results.allTrades.length > 0 && (
            <Card style={{ marginBottom: theme.spacing.xl }}>
              <h2
                style={{
                  margin: `0 0 ${theme.spacing.lg} 0`,
                  color: theme.colors.text,
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.medium,
                }}
              >
                📋 Trade History
              </h2>
              <p
                style={{
                  margin: `0 0 ${theme.spacing.md} 0`,
                  color: theme.colors.textLight,
                  fontSize: theme.typography.fontSize.base,
                }}
              >
                Showing all {results.allTrades.length} transactions (
                {results.trades.buys} buys, {results.trades.sells} sells)
              </p>

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
                        backgroundColor: theme.colors.gray100,
                        borderBottom: `2px solid ${theme.colors.gray300}`,
                      }}
                    >
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'left',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Date
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'left',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Type
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'left',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Symbol
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'right',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Qty
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'right',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Price
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'right',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Amount
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'right',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        Return
                      </th>
                      <th
                        style={{
                          padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          textAlign: 'right',
                          fontWeight: theme.typography.fontWeight.medium,
                          color: theme.colors.text,
                        }}
                      >
                        P&L
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.allTrades.map((trade, index) => (
                      <tr
                        key={index}
                        style={{
                          borderBottom: `1px solid ${theme.colors.gray300}`,
                        }}
                      >
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            color: theme.colors.text,
                          }}
                        >
                          {trade.date}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                          }}
                        >
                          <span
                            style={{
                              padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                              borderRadius: theme.borderRadius.sm,
                              fontSize: theme.typography.fontSize.xs,
                              fontWeight: theme.typography.fontWeight.medium,
                              backgroundColor:
                                trade.side === 'buy'
                                  ? theme.colors.infoLight
                                  : theme.colors.errorLight,
                              color:
                                trade.side === 'buy'
                                  ? theme.colors.infoDark
                                  : theme.colors.errorDark,
                            }}
                          >
                            {trade.side.toUpperCase()}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.text,
                          }}
                        >
                          {trade.symbol}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            textAlign: 'right',
                            color: theme.colors.text,
                          }}
                        >
                          {trade.quantity.toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            textAlign: 'right',
                            color: theme.colors.text,
                          }}
                        >
                          ${trade.price.toFixed(2)}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            textAlign: 'right',
                            color: theme.colors.text,
                          }}
                        >
                          $
                          {trade.side === 'buy'
                            ? trade.cost.toFixed(2)
                            : trade.proceeds.toFixed(2)}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            textAlign: 'right',
                            color:
                              trade.side === 'sell'
                                ? trade.returnPct >= 0
                                  ? theme.colors.success
                                  : theme.colors.error
                                : theme.colors.textLight,
                          }}
                        >
                          {trade.side === 'sell'
                            ? `${trade.returnPct >= 0 ? '+' : ''}${trade.returnPct.toFixed(2)}%`
                            : '-'}
                        </td>
                        <td
                          style={{
                            padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                            textAlign: 'right',
                            fontWeight: theme.typography.fontWeight.medium,
                            color:
                              trade.side === 'sell'
                                ? trade.profit >= 0
                                  ? theme.colors.success
                                  : theme.colors.error
                                : theme.colors.textLight,
                          }}
                        >
                          {trade.side === 'sell'
                            ? `${trade.profit >= 0 ? '+' : ''}$${trade.profit.toFixed(2)}`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.sm,
                  backgroundColor: theme.colors.gray100,
                  borderRadius: theme.borderRadius.md,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.text,
                }}
              >
                <strong>Reading the table:</strong> BUY transactions show the
                cost, while SELL transactions show proceeds, return %, and
                profit/loss. Each sell is matched to its corresponding buy to
                calculate returns.
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

// Wrapper component for metric cards with border styling
const PerformanceMetricCard = ({ label, value, variant }) => (
  <div
    style={{
      border: `1px solid ${theme.colors.gray300}`,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.lg,
      textAlign: 'center',
    }}
  >
    <MetricCard label={label} value={value} variant={variant} />
  </div>
);

export default BacktestPage;
