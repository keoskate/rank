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
import { useStockData } from './StockDataProvider';

const BacktestPage = () => {
  const { stockData: allStockData, currentStockList } = useStockData();

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

      const response = await fetch('/api/snapshots/generate-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stocks: allStockData,
          days,
          stockListName: currentStockList.name
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to generate history');
      }

      console.log(`Generated ${data.snapshotsGenerated} snapshots`);
      setSnapshotsAvailable(true);
      alert(`✅ Generated ${days} days of historical data for backtesting!`);
    } catch (err) {
      console.error('Error generating history:', err);
      setError('Failed to generate historical data: ' + err.message);
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
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      console.log(`Running backtest: ${startDate} to ${endDate}`);

      const response = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          topN,
          rebalanceFrequency,
          initialCapital
        })
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
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '10px' }}>📈 Strategy Backtesting</h1>
      <p style={{ color: '#6c757d', marginBottom: '30px' }}>
        Test your ranking strategies with historical data
      </p>

      {/* Setup Section */}
      {!snapshotsAvailable && (
        <div style={{
          backgroundColor: '#fff3cd',
          border: '1px solid #ffc107',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '30px'
        }}>
          <h3 style={{ margin: '0 0 10px 0', color: '#856404' }}>
            ⚠️ No Historical Data Available
          </h3>
          <p style={{ margin: '0 0 15px 0', color: '#856404' }}>
            Generate synthetic historical snapshots to enable backtesting.
          </p>
          <button
            onClick={generateHistory}
            disabled={generating}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: generating ? 'not-allowed' : 'pointer',
              opacity: generating ? 0.6 : 1
            }}
          >
            {generating ? '⏳ Generating...' : `🔄 Generate ${days} Days of History`}
          </button>
        </div>
      )}

      {/* Strategy Configuration */}
      <div style={{
        backgroundColor: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #e0e6ed',
        padding: '30px',
        marginBottom: '30px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ margin: '0 0 20px 0' }}>Strategy Configuration</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Top N Stocks
            </label>
            <input
              type="number"
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value))}
              min="1"
              max="20"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            />
            <small style={{ color: '#6c757d' }}>Buy the top {topN} ranked stocks</small>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Rebalance Frequency
            </label>
            <select
              value={rebalanceFrequency}
              onChange={(e) => setRebalanceFrequency(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <small style={{ color: '#6c757d' }}>How often to rebalance portfolio</small>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Backtest Period (Days)
            </label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              min="7"
              max="365"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            />
            <small style={{ color: '#6c757d' }}>Number of days to test</small>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Initial Capital ($)
            </label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseInt(e.target.value))}
              min="1000"
              step="1000"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            />
            <small style={{ color: '#6c757d' }}>Starting portfolio value</small>
          </div>
        </div>

        <button
          onClick={runBacktest}
          disabled={loading || !snapshotsAvailable}
          style={{
            padding: '15px 40px',
            fontSize: '18px',
            backgroundColor: snapshotsAvailable ? '#28a745' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: (loading || !snapshotsAvailable) ? 'not-allowed' : 'pointer',
            opacity: (loading || !snapshotsAvailable) ? 0.6 : 1,
            fontWeight: '600',
            width: '100%'
          }}
        >
          {loading ? '⏳ Running Backtest...' : '🧪 Run Backtest'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '30px',
          color: '#721c24'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Results Display */}
      {results && (
        <div>
          {/* Performance Summary */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e0e6ed',
            padding: '30px',
            marginBottom: '30px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h2 style={{ margin: '0 0 20px 0' }}>📊 Performance Summary</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <MetricCard
                label="Total Return"
                value={`${results.performance.totalReturn >= 0 ? '+' : ''}${results.performance.totalReturn.toFixed(2)}%`}
                color={results.performance.totalReturn >= 0 ? '#28a745' : '#dc3545'}
              />
              <MetricCard
                label="Annualized Return"
                value={`${results.performance.annualizedReturn >= 0 ? '+' : ''}${results.performance.annualizedReturn.toFixed(2)}%`}
                color={results.performance.annualizedReturn >= 0 ? '#28a745' : '#dc3545'}
              />
              <MetricCard
                label="Win Rate"
                value={`${results.trades.winRate.toFixed(1)}%`}
                color={results.trades.winRate >= 50 ? '#28a745' : '#dc3545'}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={results.risk.sharpeRatio.toFixed(2)}
                color={results.risk.sharpeRatio >= 1 ? '#28a745' : results.risk.sharpeRatio >= 0.5 ? '#ffc107' : '#dc3545'}
              />
              <MetricCard
                label="Max Drawdown"
                value={`-${results.risk.maxDrawdownPercent.toFixed(2)}%`}
                color={results.risk.maxDrawdownPercent <= 10 ? '#28a745' : results.risk.maxDrawdownPercent <= 20 ? '#ffc107' : '#dc3545'}
              />
              <MetricCard
                label="Total Trades"
                value={results.trades.sells.toString()}
                color="#17a2b8"
              />
            </div>
          </div>

          {/* Trade Statistics */}
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #e0e6ed',
            padding: '30px',
            marginBottom: '30px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h2 style={{ margin: '0 0 20px 0' }}>💹 Trade Statistics</h2>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e0e6ed' }}>
                  <td style={{ padding: '12px 0', fontWeight: '600' }}>Profitable Trades:</td>
                  <td style={{ padding: '12px 0', color: '#28a745' }}>{results.trades.profitableTrades}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e0e6ed' }}>
                  <td style={{ padding: '12px 0', fontWeight: '600' }}>Losing Trades:</td>
                  <td style={{ padding: '12px 0', color: '#dc3545' }}>{results.trades.losingTrades}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e0e6ed' }}>
                  <td style={{ padding: '12px 0', fontWeight: '600' }}>Average Return per Trade:</td>
                  <td style={{ padding: '12px 0' }}>{results.trades.avgReturn.toFixed(2)}%</td>
                </tr>
                <tr style={{ borderBottom: '1px solid #e0e6ed' }}>
                  <td style={{ padding: '12px 0', fontWeight: '600' }}>Average Profit per Trade:</td>
                  <td style={{ padding: '12px 0' }}>${results.trades.avgProfit.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 0', fontWeight: '600' }}>Total Profit:</td>
                  <td style={{ padding: '12px 0', fontSize: '18px', fontWeight: '600', color: results.performance.totalProfit >= 0 ? '#28a745' : '#dc3545' }}>
                    ${results.performance.totalProfit.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Simple metric card component
const MetricCard = ({ label, value, color }) => (
  <div style={{
    border: '1px solid #e0e6ed',
    borderRadius: '6px',
    padding: '20px',
    textAlign: 'center'
  }}>
    <div style={{ fontSize: '14px', color: '#6c757d', marginBottom: '8px' }}>
      {label}
    </div>
    <div style={{ fontSize: '24px', fontWeight: '700', color }}>
      {value}
    </div>
  </div>
);

export default BacktestPage;
