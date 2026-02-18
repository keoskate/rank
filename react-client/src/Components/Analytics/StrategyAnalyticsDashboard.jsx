import React, { useState, useMemo } from 'react';
import EquityCurveChart from './EquityCurveChart';
import MFEMAEChart from './MFEMAEChart';
import MonteCarloChart from './MonteCarloChart';
import TradeDistributionChart from './TradeDistributionChart';
import TimeHeatmapChart from './TimeHeatmapChart';
import { calculateMetrics, formatCurrency, formatPercent, chartColors } from './analyticsUtils';

/**
 * StrategyAnalyticsDashboard - Complete Analytics Suite
 *
 * Professional trading analytics dashboard that provides:
 * - Equity curve with drawdown analysis
 * - Monte Carlo simulation for risk assessment
 * - Trade distribution statistics
 * - MFE/MAE exit optimization
 * - Time-based performance patterns
 *
 * Props:
 * - trades: Array of trade objects with pnl, dates, and optional MFE/MAE data
 * - strategyName: Name of the strategy being analyzed
 * - startingCapital: Initial capital for equity calculations
 */
const StrategyAnalyticsDashboard = ({
  trades = [],
  strategyName = 'Strategy',
  startingCapital = 10000,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState('overview');

  // Calculate overall metrics
  const metrics = useMemo(() => {
    return calculateMetrics(trades);
  }, [trades]);

  // Calculate additional statistics
  const stats = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    const pnls = trades.map(t => t.pnl || 0);
    const sortedPnls = [...pnls].sort((a, b) => a - b);

    // Calculate Sharpe-like ratio (simplified)
    const avgPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((sum, pnl) => sum + Math.pow(pnl - avgPnl, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgPnl / stdDev) * Math.sqrt(252) : 0; // Annualized

    // Calculate consecutive wins/losses
    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;

    for (const trade of trades) {
      if (trade.pnl > 0) {
        currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
        maxLossStreak = Math.max(maxLossStreak, Math.abs(currentStreak));
      }
    }

    // Calculate average holding time if available
    let avgHoldingTime = null;
    const tradesWithDuration = trades.filter(t => t.entryDate && t.exitDate);
    if (tradesWithDuration.length > 0) {
      const totalMs = tradesWithDuration.reduce((sum, t) => {
        return sum + (new Date(t.exitDate) - new Date(t.entryDate));
      }, 0);
      avgHoldingTime = totalMs / tradesWithDuration.length / (1000 * 60); // minutes
    }

    return {
      totalPnl: metrics.totalPnl,
      avgPnl,
      sharpeRatio,
      maxWinStreak,
      maxLossStreak,
      largestWin: sortedPnls[sortedPnls.length - 1],
      largestLoss: sortedPnls[0],
      avgHoldingTime,
      profitFactor: metrics.profitFactor,
    };
  }, [trades, metrics]);

  const containerStyle = {
    backgroundColor: '#0a0f1a',
    minHeight: '100vh',
    padding: '24px',
    color: chartColors.textLight,
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: `1px solid ${chartColors.gridLine}`,
  };

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: chartColors.textLight,
    margin: 0,
  };

  const subtitleStyle = {
    fontSize: '14px',
    color: chartColors.text,
    marginTop: '4px',
  };

  const closeButtonStyle = {
    padding: '8px 16px',
    backgroundColor: 'transparent',
    border: `1px solid ${chartColors.gridLine}`,
    borderRadius: '6px',
    color: chartColors.text,
    cursor: 'pointer',
    fontSize: '14px',
  };

  const metricsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '16px',
    marginBottom: '24px',
  };

  const metricCardStyle = {
    padding: '16px',
    backgroundColor: '#111827',
    borderRadius: '8px',
    textAlign: 'center',
  };

  const metricLabelStyle = {
    color: chartColors.text,
    fontSize: '11px',
    textTransform: 'uppercase',
    marginBottom: '8px',
  };

  const metricValueStyle = (color) => ({
    color: color || chartColors.textLight,
    fontSize: '20px',
    fontWeight: '700',
  });

  const tabContainerStyle = {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: `1px solid ${chartColors.gridLine}`,
    paddingBottom: '8px',
  };

  const tabStyle = (isActive) => ({
    padding: '8px 16px',
    backgroundColor: isActive ? chartColors.primary : 'transparent',
    border: 'none',
    borderRadius: '6px',
    color: isActive ? '#fff' : chartColors.text,
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: isActive ? '600' : '400',
    transition: 'all 0.2s',
  });

  const gridTwoColumnStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginBottom: '16px',
  };

  const emptyStateStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    color: chartColors.text,
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'equity', label: 'Equity Curve' },
    { id: 'distribution', label: 'Distribution' },
    { id: 'montecarlo', label: 'Monte Carlo' },
    { id: 'mfemae', label: 'Exit Analysis' },
    { id: 'timing', label: 'Timing' },
  ];

  if (!trades || trades.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <div>
            <h1 style={titleStyle}>{strategyName} Analytics</h1>
            <div style={subtitleStyle}>No trade data available</div>
          </div>
          {onClose && (
            <button style={closeButtonStyle} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        <div style={emptyStateStyle}>
          <p style={{ fontSize: '18px', marginBottom: '8px' }}>No Trades to Analyze</p>
          <p>Import trades or run a backtest to see analytics</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>{strategyName} Analytics</h1>
          <div style={subtitleStyle}>
            {trades.length} trades | Starting Capital: {formatCurrency(startingCapital)}
          </div>
        </div>
        {onClose && (
          <button style={closeButtonStyle} onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {/* Key Metrics */}
      <div style={metricsGridStyle}>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Total P&L</div>
          <div style={metricValueStyle(stats?.totalPnl >= 0 ? chartColors.profit : chartColors.loss)}>
            {formatCurrency(stats?.totalPnl || 0)}
          </div>
        </div>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Win Rate</div>
          <div style={metricValueStyle(metrics.winRate >= 50 ? chartColors.profit : chartColors.loss)}>
            {formatPercent(metrics.winRate)}
          </div>
        </div>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Profit Factor</div>
          <div style={metricValueStyle(metrics.profitFactor >= 1.5 ? chartColors.profit : metrics.profitFactor >= 1 ? chartColors.tertiary : chartColors.loss)}>
            {metrics.profitFactor.toFixed(2)}
          </div>
        </div>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Max Drawdown</div>
          <div style={metricValueStyle(chartColors.loss)}>
            -{formatPercent(metrics.maxDrawdown)}
          </div>
        </div>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Avg Win</div>
          <div style={metricValueStyle(chartColors.profit)}>
            {formatCurrency(metrics.avgWin)}
          </div>
        </div>
        <div style={metricCardStyle}>
          <div style={metricLabelStyle}>Avg Loss</div>
          <div style={metricValueStyle(chartColors.loss)}>
            {formatCurrency(metrics.avgLoss)}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabContainerStyle}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            style={tabStyle(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <>
          <EquityCurveChart
            trades={trades}
            startingCapital={startingCapital}
            height={350}
          />
          <div style={gridTwoColumnStyle}>
            <TradeDistributionChart trades={trades} height={300} />
            <TimeHeatmapChart trades={trades} height={300} />
          </div>
        </>
      )}

      {activeTab === 'equity' && (
        <EquityCurveChart
          trades={trades}
          startingCapital={startingCapital}
          height={500}
          showDrawdown={true}
          showHighWaterMark={true}
        />
      )}

      {activeTab === 'distribution' && (
        <>
          <TradeDistributionChart trades={trades} bins={25} height={400} />
          {stats && (
            <div style={metricsGridStyle}>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Largest Win</div>
                <div style={metricValueStyle(chartColors.profit)}>
                  {formatCurrency(stats.largestWin)}
                </div>
              </div>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Largest Loss</div>
                <div style={metricValueStyle(chartColors.loss)}>
                  {formatCurrency(stats.largestLoss)}
                </div>
              </div>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Avg P&L</div>
                <div style={metricValueStyle(stats.avgPnl >= 0 ? chartColors.profit : chartColors.loss)}>
                  {formatCurrency(stats.avgPnl)}
                </div>
              </div>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Sharpe Ratio</div>
                <div style={metricValueStyle(stats.sharpeRatio >= 1 ? chartColors.profit : chartColors.loss)}>
                  {stats.sharpeRatio.toFixed(2)}
                </div>
              </div>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Max Win Streak</div>
                <div style={metricValueStyle(chartColors.profit)}>
                  {stats.maxWinStreak}
                </div>
              </div>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>Max Loss Streak</div>
                <div style={metricValueStyle(chartColors.loss)}>
                  {stats.maxLossStreak}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'montecarlo' && (
        <MonteCarloChart
          trades={trades}
          startingCapital={startingCapital}
          simulations={1000}
          height={500}
        />
      )}

      {activeTab === 'mfemae' && (
        <MFEMAEChart trades={trades} height={500} />
      )}

      {activeTab === 'timing' && (
        <TimeHeatmapChart trades={trades} height={500} />
      )}
    </div>
  );
};

export default StrategyAnalyticsDashboard;
