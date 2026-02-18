/**
 * Semiconductor Momentum Trading Dashboard
 *
 * Full-featured trading page for SOXL/SOXS momentum trading
 * with AI sentiment analysis and auto-trading.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import SemiconductorSentimentPanel from '../trading/SemiconductorSentimentPanel';
import SemiconductorMiniCharts from '../trading/SemiconductorMiniCharts';
import TradingLogPanel from '../common/TradingLogPanel';
import WatchlistCharts from '../common/WatchlistCharts';
import Card from '../common/Card';
import theme from '../../theme';

const SEMI_WATCHLIST = ['SOXL', 'SOXS', 'SOXX'];

const SemiconductorDemoPage = () => {
  // Auto-trader state
  const [autoTrader, setAutoTrader] = useState({ enabled: false, running: false });

  // Account and positions
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [allPositions, setAllPositions] = useState([]);

  // Live quotes data
  const [stockData, setStockData] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);

  // AI decisions feed
  const [decisions, setDecisions] = useState([]);

  // Alerts
  const [alerts, setAlerts] = useState([]);

  // Current session ID (from auto-trader)
  const [sessionId, setSessionId] = useState(null);

  // Selected chart symbol
  const [selectedSymbol, setSelectedSymbol] = useState('SOXL');

  // Fetch account data
  const fetchAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/alpaca/account');
      const data = await res.json();
      if (data.account) {
        setAccount(data.account);
      }
    } catch (err) {
      console.error('Failed to fetch account:', err);
    }
  }, []);

  // Fetch positions
  const fetchPositions = useCallback(async () => {
    try {
      const res = await fetch('/api/alpaca/positions');
      const data = await res.json();
      const allPos = data.positions || [];
      setAllPositions(allPos);
      // Filter to semiconductor symbols
      const semiPositions = allPos.filter(p =>
        ['SOXX', 'SOXL', 'SOXS'].includes(p.symbol)
      );
      setPositions(semiPositions);
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    }
  }, []);

  // Fetch stock data for live quotes
  const fetchStockData = useCallback(async () => {
    try {
      const data = {};
      for (const symbol of SEMI_WATCHLIST) {
        const res = await fetch(`/api/stock/${symbol}/analysis`);
        if (res.ok) {
          const analysis = await res.json();
          data[symbol] = analysis;
        }
      }
      setStockData(data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch stock data:', err);
    }
  }, []);

  // Fetch auto-trader status
  const fetchAutoTraderStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/semiconductor/auto-trader/status');
      const data = await res.json();
      setAutoTrader(data);

      // Update session ID from auto-trader
      if (data.currentSession?.id) {
        setSessionId(data.currentSession.id);
      }

      // Add recent activity to decisions feed
      if (data.recentActivity && data.recentActivity.length > 0) {
        setDecisions(data.recentActivity.slice(0, 20));
      }
    } catch (err) {
      console.error('Failed to fetch auto-trader status:', err);
    }
  }, []);

  // Toggle auto-trader
  const toggleAutoTrader = async () => {
    try {
      const endpoint = autoTrader.running
        ? '/api/semiconductor/auto-trader/stop'
        : '/api/semiconductor/auto-trader/start';

      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        fetchAutoTraderStatus();
      }
    } catch (err) {
      console.error('Error toggling auto-trader:', err);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchAccount();
    fetchPositions();
    fetchStockData();
    fetchAutoTraderStatus();

    // Poll every 5 seconds
    const interval = setInterval(() => {
      fetchAccount();
      fetchPositions();
      fetchStockData();
      fetchAutoTraderStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchAccount, fetchPositions, fetchStockData, fetchAutoTraderStatus]);

  // Calculate today's P&L from all positions
  const todayPnL = allPositions.reduce((sum, p) => sum + (parseFloat(p.unrealized_pl) || 0), 0);
  const todayPnLPct = account ? (todayPnL / parseFloat(account.equity)) * 100 : 0;

  // Get signal color
  const getSignalColor = (action) => {
    if (!action) return theme.colors.gray400;
    if (action.includes('Buy')) return theme.colors.success;
    if (action.includes('Sell')) return theme.colors.error;
    return theme.colors.warning;
  };

  // Get RSI background color
  const getRsiBackground = (rsi) => {
    if (!rsi) return '#fff';
    if (rsi <= 30) return '#dcfce7'; // Oversold - green tint
    if (rsi >= 70) return '#fee2e2'; // Overbought - red tint
    return '#fff';
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: theme.colors.background, padding: '20px' }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h1 style={{ color: theme.colors.text, margin: 0, fontSize: '24px' }}>Semiconductor Momentum Trading</h1>
            <p style={{ color: theme.colors.gray500, margin: '4px 0 0', fontSize: '14px' }}>
              SOXL/SOXS auto-trading with AI sentiment analysis
            </p>
          </div>

          {/* Auto-Trader Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: autoTrader.running ? '#dcfce7' : theme.colors.gray100,
              border: `1px solid ${autoTrader.running ? theme.colors.success : theme.colors.gray300}`,
              color: autoTrader.running ? theme.colors.success : theme.colors.gray500,
              fontSize: '12px',
              fontWeight: '600',
            }}>
              {autoTrader.running ? '● RUNNING' : '○ STOPPED'}
            </div>
            <button
              onClick={toggleAutoTrader}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: autoTrader.running ? theme.colors.error : theme.colors.success,
                color: '#fff',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              {autoTrader.running ? 'Stop Auto-Trading' : 'Start Auto-Trading'}
            </button>
          </div>
        </div>

        {/* Account Summary Bar */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <Card>
            <div style={{ color: theme.colors.gray500, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Account Equity</div>
            <div style={{ color: theme.colors.text, fontSize: '20px', fontWeight: '600' }}>
              ${account ? parseFloat(account.equity).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '---'}
            </div>
            <div style={{ color: theme.colors.gray500, fontSize: '11px' }}>
              Cash: ${account ? parseFloat(account.cash).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '---'}
            </div>
          </Card>

          <Card>
            <div style={{ color: todayPnL >= 0 ? theme.colors.success : theme.colors.error, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Today's P&L</div>
            <div style={{ color: todayPnL >= 0 ? theme.colors.success : theme.colors.error, fontSize: '20px', fontWeight: '600' }}>
              ${todayPnL >= 0 ? '+' : ''}{todayPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <div style={{ color: theme.colors.gray500, fontSize: '11px' }}>
              {todayPnLPct >= 0 ? '+' : ''}{todayPnLPct.toFixed(2)}% change
            </div>
          </Card>

          <Card>
            <div style={{ color: theme.colors.gray500, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Today's Orders</div>
            <div style={{ color: theme.colors.text, fontSize: '20px', fontWeight: '600' }}>0</div>
            <div style={{ color: theme.colors.gray500, fontSize: '11px' }}>0 buy / 0 sell</div>
          </Card>

          <Card>
            <div style={{ color: theme.colors.gray500, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Pending Orders</div>
            <div style={{ color: theme.colors.text, fontSize: '20px', fontWeight: '600' }}>0</div>
            <div style={{ color: theme.colors.gray500, fontSize: '11px' }}>None queued</div>
          </Card>

          <Card>
            <div style={{ color: theme.colors.success, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Open Positions</div>
            <div style={{ color: theme.colors.success, fontSize: '20px', fontWeight: '600' }}>{allPositions.length}</div>
            <div style={{ color: theme.colors.gray500, fontSize: '11px' }}>Limit: 5 max</div>
          </Card>
        </div>

        {/* Main Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '20px' }}>
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Live Quotes */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px' }}>Live Quotes</h3>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: autoTrader.running ? theme.colors.success : theme.colors.gray400,
                  }} />
                </div>
                <div style={{ fontSize: '12px', color: theme.colors.gray500 }}>
                  {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Loading...'}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {SEMI_WATCHLIST.map(symbol => {
                  const data = stockData[symbol];
                  const price = data?.price?.current;
                  const change = data?.price?.change24h;
                  const rsi = data?.technicals?.rsi;
                  const rec = data?.recommendation;
                  const changeVal = parseFloat(change) || 0;

                  return (
                    <div
                      key={symbol}
                      onClick={() => setSelectedSymbol(symbol)}
                      style={{
                        padding: '12px',
                        backgroundColor: getRsiBackground(rsi),
                        borderRadius: '8px',
                        cursor: 'pointer',
                        border: `2px solid ${selectedSymbol === symbol ? theme.colors.primary : theme.colors.gray200}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <Link
                          to={`/stock/${symbol}`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontWeight: '700', fontSize: '14px', color: theme.colors.text, textDecoration: 'none' }}
                        >
                          {symbol}
                        </Link>
                        <span style={{
                          padding: '2px 8px',
                          backgroundColor: getSignalColor(rec?.action),
                          color: '#fff',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: '700',
                        }}>
                          {rec?.action?.replace('Lean ', '').replace('Strong ', '') || 'Hold'}
                        </span>
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '600', color: theme.colors.text }}>
                        ${price ? parseFloat(price).toFixed(2) : '---'}
                      </div>
                      <div style={{ fontSize: '12px', color: changeVal >= 0 ? theme.colors.success : theme.colors.error }}>
                        {changeVal >= 0 ? '+' : ''}{changeVal.toFixed(2)}%
                      </div>
                      {rsi && (
                        <div style={{ fontSize: '11px', color: theme.colors.gray500, marginTop: '4px' }}>
                          RSI {rsi.toFixed(0)} • {rsi <= 30 ? 'Oversold' : rsi >= 70 ? 'Overbought' : 'Neutral'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: '11px', color: theme.colors.gray500, marginTop: '8px' }}>
                {SEMI_WATCHLIST.length} symbols • Live • 5s refresh
              </div>
            </Card>

            {/* Watchlist Chart */}
            <WatchlistCharts
              watchlist={[selectedSymbol]}
              positions={positions}
              height={350}
              refreshInterval={30000}
              maxCharts={1}
            />

            {/* Sentiment Panel */}
            <SemiconductorSentimentPanel />

            {/* Active Positions Table */}
            <Card title="Active Positions">
              {allPositions.length === 0 ? (
                <div style={{ color: theme.colors.gray500, textAlign: 'center', padding: '20px' }}>
                  No open positions
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${theme.colors.gray200}` }}>
                      <th style={{ textAlign: 'left', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>Symbol</th>
                      <th style={{ textAlign: 'right', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>Qty</th>
                      <th style={{ textAlign: 'right', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>Avg Cost</th>
                      <th style={{ textAlign: 'right', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>Current</th>
                      <th style={{ textAlign: 'right', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>P&L</th>
                      <th style={{ textAlign: 'right', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>P&L %</th>
                      <th style={{ textAlign: 'center', padding: '10px', color: theme.colors.gray500, fontSize: '12px', fontWeight: '600' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPositions.map(pos => {
                      const pnl = parseFloat(pos.unrealized_pl) || 0;
                      const pnlPct = parseFloat(pos.unrealized_plpc) * 100 || 0;
                      const isSemi = ['SOXX', 'SOXL', 'SOXS'].includes(pos.symbol);
                      return (
                        <tr key={pos.symbol} style={{
                          borderBottom: `1px solid ${theme.colors.gray100}`,
                          backgroundColor: isSemi ? '#f0f9ff' : 'transparent',
                        }}>
                          <td style={{ padding: '12px 10px', color: theme.colors.text, fontWeight: '600' }}>{pos.symbol}</td>
                          <td style={{ padding: '12px 10px', color: theme.colors.text, textAlign: 'right' }}>{pos.qty}</td>
                          <td style={{ padding: '12px 10px', color: theme.colors.gray500, textAlign: 'right' }}>${parseFloat(pos.avg_entry_price).toFixed(2)}</td>
                          <td style={{ padding: '12px 10px', color: theme.colors.text, textAlign: 'right' }}>${parseFloat(pos.current_price).toFixed(2)}</td>
                          <td style={{ padding: '12px 10px', textAlign: 'right', color: pnl >= 0 ? theme.colors.success : theme.colors.error, fontWeight: '500' }}>
                            ${pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                          </td>
                          <td style={{ padding: '12px 10px', textAlign: 'right', color: pnlPct >= 0 ? theme.colors.success : theme.colors.error, fontWeight: '500' }}>
                            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                          </td>
                          <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                            <button style={{
                              padding: '4px 12px',
                              backgroundColor: theme.colors.error,
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}>
                              Close
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            {/* Trading Log */}
            <TradingLogPanel
              sessionId={sessionId}
              autoRefresh={autoTrader.running}
              refreshInterval={5000}
              defaultCollapsed={false}
            />
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Current Direction */}
            {autoTrader.currentSession ? (
              <div style={{
                backgroundColor: autoTrader.currentSession.direction === 'bullish' ? '#dcfce7' : '#fee2e2',
                border: `2px solid ${autoTrader.currentSession.direction === 'bullish' ? theme.colors.success : theme.colors.error}`,
                borderRadius: '12px',
                padding: '20px',
                textAlign: 'center',
              }}>
                <div style={{ color: theme.colors.gray500, fontSize: '12px', marginBottom: '8px' }}>CURRENT DIRECTION</div>
                <div style={{
                  color: autoTrader.currentSession.direction === 'bullish' ? theme.colors.success : theme.colors.error,
                  fontSize: '24px',
                  fontWeight: '700',
                }}>
                  {autoTrader.currentSession.direction === 'bullish' ? '🐂 BULLISH' : '🐻 BEARISH'}
                </div>
                <div style={{ color: theme.colors.text, fontSize: '14px', marginTop: '8px' }}>
                  Trading: {autoTrader.currentSession.direction === 'bullish' ? 'SOXL' : 'SOXS'}
                </div>
              </div>
            ) : (
              <Card>
                <div style={{ textAlign: 'center', padding: '20px', color: theme.colors.gray500 }}>
                  <div style={{ fontSize: '14px', marginBottom: '8px' }}>No Active Direction</div>
                  <div style={{ fontSize: '12px' }}>Start auto-trading to see direction</div>
                </div>
              </Card>
            )}

            {/* AI Decision Feed */}
            <Card title="AI Decision Feed">
              <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {decisions.length === 0 ? (
                  <div style={{ color: theme.colors.gray500, textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                    No decisions yet. Start auto-trading to see AI decisions.
                  </div>
                ) : (
                  decisions.map((decision, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 0',
                        borderBottom: idx < decisions.length - 1 ? `1px solid ${theme.colors.gray100}` : 'none',
                      }}
                    >
                      <div style={{
                        color: decision.type === 'success' ? theme.colors.success :
                               decision.type === 'error' ? theme.colors.error :
                               decision.type === 'warn' ? theme.colors.warning : theme.colors.text,
                        fontSize: '13px',
                        marginBottom: '4px',
                      }}>
                        {decision.message}
                      </div>
                      <div style={{ color: theme.colors.gray400, fontSize: '11px' }}>
                        {new Date(decision.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Alerts */}
            <Card title="Alerts">
              {alerts.length === 0 ? (
                <div style={{ color: theme.colors.gray500, textAlign: 'center', padding: '20px', fontSize: '13px' }}>
                  No alerts
                </div>
              ) : (
                alerts.map((alert, idx) => (
                  <div key={idx} style={{ padding: '10px', borderLeft: `3px solid ${theme.colors.warning}`, marginBottom: '8px', backgroundColor: '#fffbeb' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px' }}>{alert.title}</div>
                    <div style={{ fontSize: '12px', color: theme.colors.gray600 }}>{alert.message}</div>
                  </div>
                ))
              )}
            </Card>

            {/* Market Status */}
            <Card title="Market Status">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                <div style={{ color: theme.colors.gray500 }}>Market Hours</div>
                <div style={{ color: theme.colors.text, textAlign: 'right' }}>9:30 AM - 4:00 PM ET</div>
                <div style={{ color: theme.colors.gray500 }}>Watchlist</div>
                <div style={{ color: theme.colors.text, textAlign: 'right' }}>{SEMI_WATCHLIST.length} symbols</div>
                <div style={{ color: theme.colors.gray500 }}>Auto-Trade</div>
                <div style={{ color: autoTrader.config?.autoTrade ? theme.colors.success : theme.colors.gray400, textAlign: 'right' }}>
                  {autoTrader.config?.autoTrade ? 'Enabled' : 'Disabled'}
                </div>
              </div>
            </Card>

            {/* Auto-Trader Stats */}
            <Card title="Auto-Trader Stats">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                <div style={{ color: theme.colors.gray500 }}>Checks</div>
                <div style={{ color: theme.colors.text, textAlign: 'right' }}>{autoTrader.stats?.checks || 0}</div>
                <div style={{ color: theme.colors.gray500 }}>Sessions Started</div>
                <div style={{ color: theme.colors.text, textAlign: 'right' }}>{autoTrader.stats?.sessionsStarted || 0}</div>
                <div style={{ color: theme.colors.gray500 }}>Direction Switches</div>
                <div style={{ color: theme.colors.text, textAlign: 'right' }}>{autoTrader.stats?.directionSwitches || 0}</div>
                <div style={{ color: theme.colors.gray500 }}>Last Check</div>
                <div style={{ color: theme.colors.text, textAlign: 'right', fontSize: '11px' }}>
                  {autoTrader.lastCheck ? new Date(autoTrader.lastCheck).toLocaleTimeString() : '---'}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SemiconductorDemoPage;
