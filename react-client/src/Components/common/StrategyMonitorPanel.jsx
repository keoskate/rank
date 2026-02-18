/**
 * StrategyMonitorPanel - Real-time strategy performance monitoring
 *
 * Shows:
 * - Live performance metrics (win rate, P/L, drawdown)
 * - Rolling window stats (10, 30, 100 trades)
 * - Alerts when performance degrades
 * - Option to auto-pause when thresholds breached
 */

import { useState, useEffect, useCallback } from 'react';
import Card from './Card';
import Button from './Button';
import theme from '../../theme';

const StrategyMonitorPanel = ({ symbol, versionId, onAlert, sessionStats }) => {
  const [monitor, setMonitor] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Use session stats if provided (from live trading dashboard)
  const useSessionStats = sessionStats && Object.keys(sessionStats).length > 0;

  // Fetch monitor data
  const fetchMonitor = useCallback(async () => {
    if (!symbol || !versionId) return;

    try {
      const response = await fetch(`/api/monitors/${symbol}/${versionId}`);
      if (response.ok) {
        const data = await response.json();
        setMonitor(data);
        setIsMonitoring(data?.status === 'active');
      } else if (response.status === 404) {
        setMonitor(null);
        setIsMonitoring(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, versionId]);

  // Fetch alerts
  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch(`/api/monitors/alerts?symbol=${symbol}&versionId=${versionId}`);
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts || []);
        if (data.alerts?.length > 0 && onAlert) {
          onAlert(data.alerts);
        }
      }
    } catch (err) {
      console.error('Error fetching alerts:', err);
    }
  }, [symbol, versionId, onAlert]);

  // Start monitoring
  const startMonitoring = async () => {
    try {
      const response = await fetch(`/api/monitors/${symbol}/${versionId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thresholds: {
            minWinRate: 40,
            minExpectancy: 0,
            maxDrawdown: 15,
            maxConsecutiveLosses: 5,
          },
        }),
      });
      if (response.ok) {
        setIsMonitoring(true);
        fetchMonitor();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Stop monitoring
  const stopMonitoring = async () => {
    try {
      const response = await fetch(`/api/monitors/${symbol}/${versionId}/stop`, {
        method: 'POST',
      });
      if (response.ok) {
        setIsMonitoring(false);
        fetchMonitor();
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Acknowledge alert
  const acknowledgeAlert = async (alertId) => {
    try {
      await fetch(`/api/monitors/${symbol}/${versionId}/alerts/${alertId}/acknowledge`, {
        method: 'POST',
      });
      fetchAlerts();
    } catch (err) {
      console.error('Error acknowledging alert:', err);
    }
  };

  // Poll for updates
  useEffect(() => {
    fetchMonitor();
    fetchAlerts();

    const interval = setInterval(() => {
      if (isMonitoring) {
        fetchMonitor();
        fetchAlerts();
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [fetchMonitor, fetchAlerts, isMonitoring]);

  if (!symbol || !versionId) {
    return (
      <Card title="Strategy Monitor">
        <p style={{ color: theme.colors.textMuted }}>
          Select a symbol and strategy version to start monitoring.
        </p>
      </Card>
    );
  }

  // Derive metrics from session stats or monitor data
  const metrics = useSessionStats ? {
    winRate: sessionStats.winRate,
    totalPnL: sessionStats.totalPnL,
    maxDrawdown: sessionStats.maxDrawdown,
    totalTrades: sessionStats.totalTrades,
    consecutiveLosses: sessionStats.consecutiveLosses || 0,
    profitFactor: sessionStats.profitFactor,
  } : (monitor?.metrics?.current || {});
  const rolling = monitor?.metrics?.rolling || {};

  const getStatusColor = (value, threshold, inverse = false) => {
    if (value === null || value === undefined) return theme.colors.textMuted;
    const pass = inverse ? value <= threshold : value >= threshold;
    return pass ? theme.colors.success : theme.colors.error;
  };

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm }}>
          <span>Strategy Monitor</span>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: (isMonitoring || useSessionStats) ? theme.colors.success : theme.colors.textMuted,
            }}
          />
          {useSessionStats && (
            <span style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.primary,
              backgroundColor: `${theme.colors.primary}20`,
              padding: '2px 6px',
              borderRadius: theme.borderRadius.sm,
            }}>
              LIVE
            </span>
          )}
        </div>
      }
    >
      {/* Status & Controls - hide button when using session stats */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.md,
        paddingBottom: theme.spacing.sm,
        borderBottom: `1px solid ${theme.colors.border}`,
      }}>
        <div>
          <span style={{ color: theme.colors.textSecondary, fontSize: theme.typography.fontSize.sm }}>
            {useSessionStats ? 'Live Trading Session' : `${symbol} • ${versionId?.slice(0, 8)}`}
          </span>
        </div>
        {!useSessionStats && (
          <Button
            variant={isMonitoring ? 'secondary' : 'primary'}
            size="small"
            onClick={isMonitoring ? stopMonitoring : startMonitoring}
          >
            {isMonitoring ? 'Stop Monitor' : 'Start Monitor'}
          </Button>
        )}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{
          backgroundColor: `${theme.colors.error}20`,
          border: `1px solid ${theme.colors.error}`,
          borderRadius: theme.borderRadius.md,
          padding: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}>
          <div style={{ fontWeight: 'bold', color: theme.colors.error, marginBottom: theme.spacing.xs }}>
            Active Alerts ({alerts.length})
          </div>
          {alerts.slice(0, 3).map((alert, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: theme.typography.fontSize.sm,
              padding: `${theme.spacing.xs} 0`,
            }}>
              <span>{alert.message}</span>
              <Button size="small" variant="ghost" onClick={() => acknowledgeAlert(alert.id)}>
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Metrics Grid */}
      {loading && !useSessionStats ? (
        <p style={{ color: theme.colors.textMuted }}>Loading...</p>
      ) : !isMonitoring && !monitor && !useSessionStats ? (
        <p style={{ color: theme.colors.textMuted }}>
          Start monitoring to track performance metrics.
        </p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: theme.spacing.sm,
        }}>
          {/* Current Metrics */}
          <MetricBox
            label="Win Rate"
            value={metrics.winRate != null ? `${metrics.winRate.toFixed(1)}%` : '--'}
            threshold="40%"
            color={getStatusColor(metrics.winRate, 40)}
          />
          <MetricBox
            label="Total P/L"
            value={metrics.totalPnL != null ? `$${metrics.totalPnL.toFixed(0)}` : '--'}
            color={metrics.totalPnL >= 0 ? theme.colors.success : theme.colors.error}
          />
          <MetricBox
            label="Drawdown"
            value={metrics.maxDrawdown != null ? `${metrics.maxDrawdown.toFixed(1)}%` : '--'}
            threshold="15%"
            color={getStatusColor(metrics.maxDrawdown, 15, true)}
          />
          <MetricBox
            label="Trades"
            value={metrics.totalTrades || '0'}
            color={theme.colors.text}
          />
          <MetricBox
            label="Consec. Losses"
            value={metrics.consecutiveLosses || '0'}
            threshold="5"
            color={getStatusColor(5 - (metrics.consecutiveLosses || 0), 0)}
          />
          <MetricBox
            label="Profit Factor"
            value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : '--'}
            threshold="1.2"
            color={getStatusColor(metrics.profitFactor, 1.2)}
          />
        </div>
      )}

      {/* Rolling Windows */}
      {rolling && Object.keys(rolling).length > 0 && (
        <div style={{ marginTop: theme.spacing.md }}>
          <div style={{
            fontSize: theme.typography.fontSize.xs,
            color: theme.colors.textMuted,
            textTransform: 'uppercase',
            marginBottom: theme.spacing.xs,
          }}>
            Rolling Performance
          </div>
          <div style={{
            display: 'flex',
            gap: theme.spacing.sm,
            fontSize: theme.typography.fontSize.sm,
          }}>
            {['short', 'medium', 'long'].map(period => (
              rolling[period] && (
                <div key={period} style={{
                  flex: 1,
                  padding: theme.spacing.xs,
                  backgroundColor: theme.colors.background,
                  borderRadius: theme.borderRadius.sm,
                  textAlign: 'center',
                }}>
                  <div style={{ color: theme.colors.textMuted, fontSize: '10px' }}>
                    {period === 'short' ? '10' : period === 'medium' ? '30' : '100'} trades
                  </div>
                  <div style={{
                    color: getStatusColor(rolling[period]?.winRate, 40),
                    fontWeight: 'bold',
                  }}>
                    {rolling[period]?.winRate?.toFixed(0)}%
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: theme.colors.error, fontSize: theme.typography.fontSize.sm, marginTop: theme.spacing.sm }}>
          {error}
        </p>
      )}
    </Card>
  );
};

// Helper component for metric display
const MetricBox = ({ label, value, threshold, color }) => (
  <div style={{
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    textAlign: 'center',
  }}>
    <div style={{
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.textMuted,
      marginBottom: '2px',
    }}>
      {label}
    </div>
    <div style={{
      fontSize: theme.typography.fontSize.lg,
      fontWeight: 'bold',
      color,
    }}>
      {value}
    </div>
    {threshold && (
      <div style={{ fontSize: '10px', color: theme.colors.textMuted }}>
        min: {threshold}
      </div>
    )}
  </div>
);

export default StrategyMonitorPanel;
