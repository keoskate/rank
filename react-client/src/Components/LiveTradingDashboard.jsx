/**
 * Live Trading Dashboard
 *
 * Main page for autonomous AI trading simulation.
 * Features: Start/Stop controls, active positions, AI decision feed,
 * performance metrics, TradingView charts, and strategy configuration.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import TradingViewChart from './TradingViewChart';
import Button from './common/Button';
import Card from './common/Card';
import MetricCard from './common/MetricCard';
import theme from '../theme';

// Socket connection
let socket = null;

const LiveTradingDashboard = () => {
  // Session state
  const [sessionStatus, setSessionStatus] = useState('stopped'); // 'running', 'paused', 'stopped'
  const [sessionId, setSessionId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  // Portfolio state
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [selectedPosition, setSelectedPosition] = useState(null);

  // AI state
  const [decisions, setDecisions] = useState([]);
  const [alerts, setAlerts] = useState([]);

  // Performance state
  const [stats, setStats] = useState({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnL: 0,
    totalPnLPercent: 0
  });

  // Chart state
  const [chartData, setChartData] = useState([]);
  const [chartSymbol, setChartSymbol] = useState('');
  const [chartIndicators, setChartIndicators] = useState({});

  // Configuration state
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState({
    watchlist: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'],
    maxPositions: 5,
    maxPositionSizePercent: 10,
    riskPerTradePercent: 2,
    dailyLossLimitPercent: 5,
    minConfidence: 70,
    autoTrade: false,
    timeframes: ['dayTrading']
  });

  // Loading states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const decisionsEndRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    socket = io('http://localhost:8080', {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      socket.emit('authenticate', { userId: 'default_user' });
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
    });

    socket.on('authenticated', (data) => {
      console.log('Authenticated:', data);
    });

    socket.on('simulation_started', (data) => {
      setSessionId(data.sessionId);
      setSessionStatus('running');
      addAlert('success', 'Trading Started', 'AI trading simulation is now active');
    });

    socket.on('simulation_stopped', () => {
      setSessionStatus('stopped');
      addAlert('info', 'Trading Stopped', 'AI trading simulation has been stopped');
    });

    socket.on('simulation_paused', () => {
      setSessionStatus('paused');
      addAlert('warning', 'Trading Paused', 'AI trading simulation is paused');
    });

    socket.on('simulation_resumed', () => {
      setSessionStatus('running');
      addAlert('success', 'Trading Resumed', 'AI trading simulation resumed');
    });

    socket.on('ai_decision', (decision) => {
      setDecisions((prev) => [...prev.slice(-49), decision]);
    });

    socket.on('position_update', (position) => {
      setPositions((prev) => {
        const idx = prev.findIndex((p) => p.symbol === position.symbol);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = position;
          return updated;
        }
        return [...prev, position];
      });
    });

    socket.on('trade_executed', (trade) => {
      addAlert(
        trade.status === 'filled' ? 'success' : 'info',
        `Trade ${trade.side.toUpperCase()}`,
        `${trade.quantity} ${trade.symbol} @ $${trade.price.toFixed(2)}`
      );
      // Refresh positions
      fetchPositions();
    });

    socket.on('alert', (alert) => {
      addAlert(alert.type, alert.title, alert.message);
    });

    socket.on('daily_summary', (summary) => {
      setStats(summary);
    });

    socket.on('price_update', (data) => {
      // Update chart if it's the selected symbol
      if (data.symbol === chartSymbol) {
        // Update last candle
      }
    });

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [chartSymbol]);

  // Fetch initial data
  useEffect(() => {
    fetchAccount();
    fetchPositions();
    fetchSessionStatus();
  }, []);

  // Auto-scroll decisions
  useEffect(() => {
    decisionsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [decisions]);

  const fetchAccount = async () => {
    try {
      const res = await fetch('/api/alpaca/account');
      const data = await res.json();
      if (res.ok) {
        setAccount(data);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    }
  };

  const fetchPositions = async () => {
    try {
      const res = await fetch('/api/alpaca/positions');
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setPositions(data);
      } else if (res.ok) {
        // API returned OK but data is not an array (could be empty object or error)
        console.warn('Positions data is not an array:', data);
        setPositions([]);
      }
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    }
  };

  const fetchSessionStatus = async () => {
    try {
      const res = await fetch('/api/ai/session/default_user');
      const data = await res.json();
      if (res.ok && data) {
        setSessionStatus(data.status);
        setSessionId(data.sessionId);
        setStats(data.stats || stats);
        if (data.recentDecisions) {
          setDecisions(data.recentDecisions);
        }
      }
    } catch (err) {
      console.error('Failed to fetch session:', err);
    }
  };

  const addAlert = (type, title, message) => {
    const alert = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: new Date()
    };
    setAlerts((prev) => [...prev.slice(-9), alert]);
  };

  const startTrading = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'default_user',
          config
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start trading');
      }

      // Also notify via socket
      socket?.emit('start_simulation', { userId: 'default_user', config });
    } catch (err) {
      setError(err.message);
      addAlert('error', 'Start Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const stopTrading = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/ai/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default_user' })
      });

      if (res.ok) {
        socket?.emit('stop_simulation', { userId: 'default_user' });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pauseTrading = async () => {
    socket?.emit('pause_simulation', { userId: 'default_user' });
    setSessionStatus('paused');
  };

  const resumeTrading = async () => {
    socket?.emit('resume_simulation', { userId: 'default_user' });
    setSessionStatus('running');
  };

  const fetchChartData = async (symbol) => {
    try {
      const res = await fetch(`/api/indicators/${symbol}`);
      const data = await res.json();

      if (res.ok) {
        setChartData(data.candles || []);
        setChartIndicators(data.indicators || {});
        setChartSymbol(symbol);
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err);
    }
  };

  const selectPosition = (position) => {
    setSelectedPosition(position);
    fetchChartData(position.symbol);
  };

  const closePosition = async (symbol) => {
    try {
      const res = await fetch(`/api/alpaca/positions/${symbol}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        addAlert('success', 'Position Closed', `Closed position in ${symbol}`);
        fetchPositions();
      }
    } catch (err) {
      addAlert('error', 'Close Failed', err.message);
    }
  };

  const updateConfig = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfig = async () => {
    try {
      const res = await fetch('/api/ai/session/default_user/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (res.ok) {
        addAlert('success', 'Config Saved', 'Trading configuration updated');
        socket?.emit('update_config', { userId: 'default_user', config });
        setShowConfig(false);
      }
    } catch (err) {
      addAlert('error', 'Save Failed', err.message);
    }
  };

  const getStatusColor = () => {
    switch (sessionStatus) {
      case 'running':
        return theme.colors.success;
      case 'paused':
        return theme.colors.warning;
      default:
        return theme.colors.gray400;
    }
  };

  const formatCurrency = (value) => {
    if (value === undefined || value === null) return '$0.00';
    return `$${parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatPercent = (value) => {
    if (value === undefined || value === null) return '0.00%';
    const sign = value >= 0 ? '+' : '';
    return `${sign}${parseFloat(value).toFixed(2)}%`;
  };

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
            AI Live Trading
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xs }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: getStatusColor(),
                animation: sessionStatus === 'running' ? 'pulse 2s infinite' : 'none'
              }}
            />
            <span style={{ color: theme.colors.gray600, textTransform: 'capitalize' }}>
              {sessionStatus}
            </span>
            {isConnected && (
              <span style={{ color: theme.colors.success, fontSize: theme.typography.fontSize.sm }}>
                Connected
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
          {sessionStatus === 'stopped' && (
            <Button onClick={startTrading} disabled={loading}>
              {loading ? 'Starting...' : 'Start Trading'}
            </Button>
          )}
          {sessionStatus === 'running' && (
            <>
              <Button variant="outline" onClick={pauseTrading}>
                Pause
              </Button>
              <Button variant="danger" onClick={stopTrading}>
                Stop
              </Button>
            </>
          )}
          {sessionStatus === 'paused' && (
            <>
              <Button onClick={resumeTrading}>Resume</Button>
              <Button variant="danger" onClick={stopTrading}>
                Stop
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setShowConfig(!showConfig)}>
            Config
          </Button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: theme.spacing.md,
            backgroundColor: theme.colors.error + '20',
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.borderRadius.md,
            marginBottom: theme.spacing.md,
            color: theme.colors.error
          }}
        >
          {error}
        </div>
      )}

      {/* Configuration Panel */}
      {showConfig && (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <h3 style={{ marginTop: 0 }}>Trading Configuration</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: theme.spacing.md
            }}
          >
            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Watchlist (comma-separated)
              </label>
              <input
                type="text"
                value={config.watchlist.join(', ')}
                onChange={(e) =>
                  updateConfig(
                    'watchlist',
                    e.target.value.split(',').map((s) => s.trim().toUpperCase())
                  )
                }
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Max Positions
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={config.maxPositions}
                onChange={(e) => updateConfig('maxPositions', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Max Position Size %
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={config.maxPositionSizePercent}
                onChange={(e) => updateConfig('maxPositionSizePercent', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Risk Per Trade %
              </label>
              <input
                type="number"
                min="0.5"
                max="10"
                step="0.5"
                value={config.riskPerTradePercent}
                onChange={(e) => updateConfig('riskPerTradePercent', parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Daily Loss Limit %
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={config.dailyLossLimitPercent}
                onChange={(e) => updateConfig('dailyLossLimitPercent', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium }}>
                Min Confidence %
              </label>
              <input
                type="number"
                min="50"
                max="95"
                value={config.minConfidence}
                onChange={(e) => updateConfig('minConfidence', parseInt(e.target.value))}
                style={{
                  width: '100%',
                  padding: theme.spacing.sm,
                  border: `1px solid ${theme.colors.gray300}`,
                  borderRadius: theme.borderRadius.sm
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  marginTop: theme.spacing.md,
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={config.autoTrade}
                  onChange={(e) => updateConfig('autoTrade', e.target.checked)}
                />
                <span style={{ fontWeight: theme.typography.fontWeight.medium }}>
                  Auto-Trade (execute orders automatically)
                </span>
              </label>
              {config.autoTrade && (
                <span style={{ color: theme.colors.warning, fontSize: theme.typography.fontSize.sm }}>
                  Warning: AI will execute real trades on your paper account
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}>
            <Button onClick={saveConfig}>Save Configuration</Button>
            <Button variant="ghost" onClick={() => setShowConfig(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Performance Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.lg
        }}
      >
        <MetricCard
          title="Portfolio Value"
          value={formatCurrency(account?.portfolio_value)}
          subtitle={account?.buying_power ? `Buying Power: ${formatCurrency(account.buying_power)}` : ''}
        />
        <MetricCard
          title="Today's P&L"
          value={formatCurrency(stats.totalPnL)}
          subtitle={formatPercent(stats.totalPnLPercent)}
          variant={stats.totalPnL >= 0 ? 'success' : 'error'}
        />
        <MetricCard title="Total Trades" value={stats.totalTrades} />
        <MetricCard
          title="Win Rate"
          value={`${stats.winRate || 0}%`}
          subtitle={`${stats.wins}W / ${stats.losses}L`}
          variant={stats.winRate >= 50 ? 'success' : stats.winRate > 0 ? 'warning' : 'default'}
        />
        <MetricCard
          title="Open Positions"
          value={positions.length}
          subtitle={`Max: ${config.maxPositions}`}
        />
      </div>

      {/* Main Content Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 350px',
          gap: theme.spacing.lg
        }}
      >
        {/* Left Column - Chart and Positions */}
        <div>
          {/* Chart */}
          {chartSymbol ? (
            <TradingViewChart
              symbol={chartSymbol}
              candles={chartData}
              indicators={chartIndicators}
              height={400}
              title={chartSymbol}
              showControls={true}
              showLegend={true}
            />
          ) : (
            <Card style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: theme.colors.gray500 }}>
                Select a position to view chart
              </span>
            </Card>
          )}

          {/* Active Positions */}
          <Card style={{ marginTop: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>Active Positions</h3>
            {positions.length === 0 ? (
              <p style={{ color: theme.colors.gray500 }}>No open positions</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}>
                      <th style={{ textAlign: 'left', padding: theme.spacing.sm }}>Symbol</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Qty</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Avg Cost</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>Current</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>P&L</th>
                      <th style={{ textAlign: 'right', padding: theme.spacing.sm }}>P&L %</th>
                      <th style={{ textAlign: 'center', padding: theme.spacing.sm }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(positions) ? positions : []).map((pos) => (
                      <tr
                        key={pos.symbol}
                        onClick={() => selectPosition(pos)}
                        style={{
                          cursor: 'pointer',
                          backgroundColor:
                            selectedPosition?.symbol === pos.symbol
                              ? theme.colors.gray100
                              : 'transparent',
                          borderBottom: `1px solid ${theme.colors.gray100}`
                        }}
                      >
                        <td style={{ padding: theme.spacing.sm, fontWeight: theme.typography.fontWeight.bold }}>
                          {pos.symbol}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {pos.qty}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {formatCurrency(pos.avg_entry_price)}
                        </td>
                        <td style={{ textAlign: 'right', padding: theme.spacing.sm }}>
                          {formatCurrency(pos.current_price)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            padding: theme.spacing.sm,
                            color: parseFloat(pos.unrealized_pl) >= 0 ? theme.colors.success : theme.colors.error
                          }}
                        >
                          {formatCurrency(pos.unrealized_pl)}
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            padding: theme.spacing.sm,
                            color: parseFloat(pos.unrealized_plpc) >= 0 ? theme.colors.success : theme.colors.error
                          }}
                        >
                          {formatPercent(parseFloat(pos.unrealized_plpc) * 100)}
                        </td>
                        <td style={{ textAlign: 'center', padding: theme.spacing.sm }}>
                          <Button
                            size="small"
                            variant="danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              closePosition(pos.symbol);
                            }}
                          >
                            Close
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column - AI Decisions and Alerts */}
        <div>
          {/* AI Decision Feed */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>AI Decision Feed</h3>
            <div
              style={{
                height: 300,
                overflowY: 'auto',
                fontSize: theme.typography.fontSize.sm
              }}
            >
              {decisions.length === 0 ? (
                <p style={{ color: theme.colors.gray500 }}>
                  No decisions yet. Start trading to see AI analysis.
                </p>
              ) : (
                decisions.map((decision, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: theme.spacing.sm,
                      marginBottom: theme.spacing.sm,
                      backgroundColor:
                        decision.action === 'BUY'
                          ? theme.colors.success + '10'
                          : decision.action === 'SELL'
                            ? theme.colors.error + '10'
                            : theme.colors.gray100,
                      borderRadius: theme.borderRadius.sm,
                      borderLeft: `3px solid ${
                        decision.action === 'BUY'
                          ? theme.colors.success
                          : decision.action === 'SELL'
                            ? theme.colors.error
                            : theme.colors.gray300
                      }`
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: theme.typography.fontWeight.bold }}>
                        {decision.symbol}
                      </span>
                      <span
                        style={{
                          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                          backgroundColor:
                            decision.action === 'BUY'
                              ? theme.colors.success
                              : decision.action === 'SELL'
                                ? theme.colors.error
                                : theme.colors.gray400,
                          color: '#fff',
                          borderRadius: theme.borderRadius.sm,
                          fontSize: theme.typography.fontSize.xs
                        }}
                      >
                        {decision.action}
                      </span>
                    </div>
                    <div style={{ marginTop: theme.spacing.xs, color: theme.colors.gray600 }}>
                      Confidence: {decision.confidence}%
                    </div>
                    {decision.reasons && decision.reasons.length > 0 && (
                      <ul
                        style={{
                          margin: `${theme.spacing.xs} 0 0 0`,
                          paddingLeft: theme.spacing.md,
                          color: theme.colors.gray600
                        }}
                      >
                        {decision.reasons.slice(0, 3).map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    <div
                      style={{
                        marginTop: theme.spacing.xs,
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray400
                      }}
                    >
                      {new Date(decision.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
              <div ref={decisionsEndRef} />
            </div>
          </Card>

          {/* Alerts */}
          <Card>
            <h3 style={{ marginTop: 0 }}>Alerts</h3>
            <div style={{ maxHeight: 250, overflowY: 'auto' }}>
              {alerts.length === 0 ? (
                <p style={{ color: theme.colors.gray500 }}>No alerts</p>
              ) : (
                alerts
                  .slice()
                  .reverse()
                  .map((alert) => (
                    <div
                      key={alert.id}
                      style={{
                        padding: theme.spacing.sm,
                        marginBottom: theme.spacing.sm,
                        backgroundColor:
                          alert.type === 'error'
                            ? theme.colors.error + '10'
                            : alert.type === 'success'
                              ? theme.colors.success + '10'
                              : alert.type === 'warning'
                                ? theme.colors.warning + '10'
                                : theme.colors.info + '10',
                        borderRadius: theme.borderRadius.sm,
                        borderLeft: `3px solid ${
                          alert.type === 'error'
                            ? theme.colors.error
                            : alert.type === 'success'
                              ? theme.colors.success
                              : alert.type === 'warning'
                                ? theme.colors.warning
                                : theme.colors.info
                        }`
                      }}
                    >
                      <div style={{ fontWeight: theme.typography.fontWeight.medium }}>
                        {alert.title}
                      </div>
                      <div style={{ fontSize: theme.typography.fontSize.sm, color: theme.colors.gray600 }}>
                        {alert.message}
                      </div>
                      <div
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          color: theme.colors.gray400,
                          marginTop: theme.spacing.xs
                        }}
                      >
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </Card>

          {/* Quick Stats */}
          <Card style={{ marginTop: theme.spacing.lg }}>
            <h3 style={{ marginTop: 0 }}>Market Status</h3>
            <div style={{ fontSize: theme.typography.fontSize.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
                <span>Market Hours</span>
                <span style={{ color: theme.colors.gray600 }}>9:30 AM - 4:00 PM ET</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
                <span>Watchlist</span>
                <span style={{ color: theme.colors.gray600 }}>{config.watchlist.length} symbols</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Auto-Trade</span>
                <span style={{ color: config.autoTrade ? theme.colors.success : theme.colors.gray400 }}>
                  {config.autoTrade ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default LiveTradingDashboard;
