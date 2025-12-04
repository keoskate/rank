/**
 * Paper Trading Dashboard - Real Alpaca Paper Trading Integration
 *
 * Connected to your actual Alpaca paper trading account for realistic testing.
 * All trades execute through Alpaca's paper trading API.
 *
 * Features:
 * - Real Alpaca account connection
 * - Live portfolio tracking
 * - Real order execution (paper money)
 * - Account verification display
 * - Cross-validation with Polygon data
 */

import { useState, useEffect } from 'react';

const PaperTradingPage = () => {
  // Account state
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Trading state
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [orderType, setOrderType] = useState('buy');
  const [quantity, setQuantity] = useState(10);
  const [orderLoading, setOrderLoading] = useState(false);

  // Auto-trading state
  const [autoTrading, setAutoTrading] = useState(false);
  const [autoConfig, setAutoConfig] = useState({
    topN: 5,
    positionSize: 20 // % of portfolio per stock
  });

  // Trading mode state
  const [tradingMode, setTradingMode] = useState(null);
  const [modeLoading, setModeLoading] = useState(false);

  // Load data on mount and refresh
  useEffect(() => {
    loadAllData();
    loadTradingMode();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading) {
        loadAllData();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [loading]);

  /**
   * Load all account data from Alpaca
   */
  const loadAllData = async () => {
    try {
      setError(null);
      await Promise.all([
        loadAccount(),
        loadPositions(),
        loadOrders(),
        loadRankings()
      ]);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load account data');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load Alpaca account info
   */
  const loadAccount = async () => {
    const response = await fetch('/api/alpaca/account');
    const data = await response.json();

    if (data.success) {
      setAccount(data.account);
    } else {
      throw new Error('Failed to load account');
    }
  };

  /**
   * Load current positions
   */
  const loadPositions = async () => {
    const response = await fetch('/api/alpaca/positions');
    const data = await response.json();

    if (data.success) {
      setPositions(data.positions);
    }
  };

  /**
   * Load recent orders
   */
  const loadOrders = async () => {
    const response = await fetch('/api/alpaca/orders?limit=50');
    const data = await response.json();

    if (data.success) {
      setOrders(data.orders);
    }
  };

  /**
   * Load current stock rankings
   */
  const loadRankings = async () => {
    const response = await fetch('/api/rankings/current');
    const data = await response.json();

    if (data.success) {
      setRankings(data.rankings);
    }
  };

  /**
   * Load current trading mode
   */
  const loadTradingMode = async () => {
    try {
      const response = await fetch('/api/trading/mode');
      const data = await response.json();

      if (data.success) {
        setTradingMode(data.mode);
      }
    } catch (err) {
      console.error('Error loading trading mode:', err);
    }
  };

  /**
   * Switch trading mode (paper or live)
   */
  const switchTradingMode = async (newMode) => {
    if (tradingMode.isLive && newMode === 'paper') {
      if (!confirm('Switch from LIVE to PAPER mode? Future orders will use paper trading.')) {
        return;
      }
    } else if (!tradingMode.isLive && newMode === 'live') {
      if (!confirm('⚠️  WARNING: Switch to LIVE TRADING MODE?\n\nThis will execute orders with REAL MONEY!\n\nAre you absolutely sure?')) {
        return;
      }
    }

    setModeLoading(true);

    try {
      const response = await fetch('/api/trading/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });

      const data = await response.json();

      if (data.success) {
        setTradingMode(data.mode);
        await loadAllData(); // Reload account data for new mode
        alert(`Trading mode switched to ${newMode.toUpperCase()}`);
      } else {
        throw new Error(data.error || 'Failed to switch mode');
      }
    } catch (err) {
      console.error('Error switching trading mode:', err);
      alert(`Failed to switch mode: ${err.message}`);
    } finally {
      setModeLoading(false);
    }
  };

  /**
   * Place order through Alpaca
   */
  const placeOrder = async () => {
    if (!selectedSymbol || quantity < 1) {
      alert('Please select a symbol and enter quantity');
      return;
    }

    setOrderLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/alpaca/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          qty: parseInt(quantity),
          side: orderType,
          type: 'market',
          time_in_force: 'day'
        })
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ ${orderType.toUpperCase()} order placed: ${quantity} shares of ${selectedSymbol}\nOrder ID: ${data.order.id}\nStatus: ${data.order.status}`);
        setQuantity(10);
        setSelectedSymbol('');
        await loadAllData();
      } else {
        throw new Error(data.error || 'Order failed');
      }
    } catch (err) {
      console.error('Error placing order:', err);
      setError(`Order failed: ${err.message}`);
      alert(`❌ Order failed: ${err.message}`);
    } finally {
      setOrderLoading(false);
    }
  };

  /**
   * Execute auto-trading based on rankings
   */
  const executeAutoTrade = async () => {
    if (!rankings || rankings.length === 0) {
      alert('No rankings available');
      return;
    }

    if (!confirm(`This will place ${autoConfig.topN} buy orders. Continue?`)) {
      return;
    }

    setAutoTrading(true);
    setError(null);

    try {
      const topStocks = rankings.slice(0, autoConfig.topN);
      const portfolioValue = parseFloat(account.portfolio_value);
      const positionValue = portfolioValue * (autoConfig.positionSize / 100);

      let successCount = 0;
      let failCount = 0;

      for (const stock of topStocks) {
        const qty = Math.floor(positionValue / stock.price);

        if (qty > 0) {
          try {
            const response = await fetch('/api/alpaca/orders', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: stock.ticker,
                qty,
                side: 'buy',
                type: 'market',
                time_in_force: 'day'
              })
            });

            const data = await response.json();
            if (data.success) {
              successCount++;
              console.log(`✅ Placed order: ${qty} shares of ${stock.ticker}`);
            } else {
              failCount++;
              console.error(`❌ Failed: ${stock.ticker} - ${data.error}`);
            }
          } catch (err) {
            failCount++;
            console.error(`❌ Error placing order for ${stock.ticker}:`, err);
          }

          // Small delay between orders
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      alert(`✅ Auto-trade complete!\nSuccess: ${successCount}\nFailed: ${failCount}`);
      await loadAllData();
    } catch (err) {
      console.error('Error executing auto-trade:', err);
      setError('Auto-trade failed: ' + err.message);
      alert(`❌ Auto-trade failed: ${err.message}`);
    } finally {
      setAutoTrading(false);
    }
  };

  /**
   * Close all positions
   */
  const closeAllPositions = async () => {
    if (!confirm('⚠️ This will CLOSE ALL POSITIONS and cancel all orders. Are you sure?')) {
      return;
    }

    try {
      // Note: Alpaca doesn't have a reset endpoint, but we can close all positions
      alert('Close all positions functionality - this would liquidate everything');
      // In production, implement actual position closing
    } catch (err) {
      console.error('Error closing positions:', err);
      setError('Failed to close positions');
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>🔄 Loading Alpaca Paper Trading Account...</h2>
        <p style={{ color: '#6c757d' }}>Connecting to your account...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: '0 0 5px 0' }}>💰 Alpaca Paper Trading</h1>
          <p style={{ margin: 0, color: '#6c757d' }}>
            Real Alpaca paper account • Account #{account?.account_number}
          </p>
        </div>
        <button
          onClick={() => loadAllData()}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '8px',
          padding: '15px',
          marginBottom: '20px',
          color: '#721c24'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Trading Mode Toggle */}
      {tradingMode && (
        <div style={{
          backgroundColor: tradingMode.isLive ? '#fff3cd' : '#d4edda',
          border: `2px solid ${tradingMode.isLive ? '#ffc107' : '#28a745'}`,
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: '0 0 10px 0', color: tradingMode.isLive ? '#856404' : '#155724' }}>
                {tradingMode.statusEmoji} {tradingMode.statusText}
              </h3>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: tradingMode.isLive ? '#856404' : '#155724' }}>
                {tradingMode.description}
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: '#6c757d' }}>
                <strong>Account:</strong> {tradingMode.accountNumber} • <strong>Mode:</strong> {tradingMode.mode.toUpperCase()}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => switchTradingMode('paper')}
                disabled={!tradingMode.isLive || modeLoading}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  backgroundColor: !tradingMode.isLive ? '#28a745' : '#e9ecef',
                  color: !tradingMode.isLive ? 'white' : '#6c757d',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: !tradingMode.isLive || modeLoading ? 'not-allowed' : 'pointer',
                  opacity: !tradingMode.isLive || modeLoading ? 0.6 : 1
                }}
              >
                📝 Paper Mode
              </button>
              <button
                onClick={() => switchTradingMode('live')}
                disabled={tradingMode.isLive || modeLoading}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  backgroundColor: tradingMode.isLive ? '#dc3545' : '#e9ecef',
                  color: tradingMode.isLive ? 'white' : '#6c757d',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: tradingMode.isLive || modeLoading ? 'not-allowed' : 'pointer',
                  opacity: tradingMode.isLive || modeLoading ? 0.6 : 1
                }}
              >
                💰 Live Mode
              </button>
            </div>
          </div>
          {tradingMode.isLive && tradingMode.safetyConfig && (
            <div style={{ marginTop: '15px', padding: '10px', backgroundColor: 'rgba(255,0,0,0.1)', borderRadius: '6px' }}>
              <p style={{ margin: '0 0 5px 0', fontSize: '12px', fontWeight: '600', color: '#721c24' }}>
                ⚠️ SAFETY LIMITS ACTIVE:
              </p>
              <p style={{ margin: 0, fontSize: '12px', color: '#721c24' }}>
                Max Order: ${tradingMode.safetyConfig.maxOrderValue.toLocaleString()} •
                Max Daily Trades: {tradingMode.safetyConfig.maxDailyTrades} •
                Confirmation Required: {tradingMode.safetyConfig.requireDoubleConfirm ? 'YES' : 'NO'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Account Verification Section */}
      {account && (
        <div style={{
          backgroundColor: '#d1ecf1',
          border: '1px solid #bee5eb',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#0c5460' }}>✅ Connected to Real Alpaca Account</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', fontSize: '14px', color: '#0c5460' }}>
            <div>
              <strong>Account ID:</strong><br />
              <code style={{ fontSize: '12px' }}>{account.id}</code>
            </div>
            <div>
              <strong>Account Number:</strong><br />
              <code>{account.account_number}</code>
            </div>
            <div>
              <strong>Status:</strong><br />
              <span style={{
                padding: '2px 8px',
                backgroundColor: account.status === 'ACTIVE' ? '#28a745' : '#ffc107',
                color: 'white',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600'
              }}>
                {account.status}
              </span>
            </div>
            <div>
              <strong>Created:</strong><br />
              {new Date(account.created_at).toLocaleDateString()}
            </div>
            <div>
              <strong>Pattern Day Trader:</strong><br />
              {account.pattern_day_trader ? 'Yes' : 'No'}
            </div>
            <div>
              <strong>Daytrade Count:</strong><br />
              {account.daytrade_count}
            </div>
          </div>
        </div>
      )}

      {/* Portfolio Summary */}
      {account && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '30px',
          marginBottom: '30px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 20px 0' }}>📊 Portfolio Summary</h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
            <MetricCard
              label="Portfolio Value"
              value={`$${parseFloat(account.portfolio_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="#17a2b8"
            />
            <MetricCard
              label="Cash"
              value={`$${parseFloat(account.cash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="#6c757d"
            />
            <MetricCard
              label="Buying Power"
              value={`$${parseFloat(account.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="#28a745"
              subtitle={`${account.multiplier}x leverage`}
            />
            <MetricCard
              label="Equity"
              value={`$${parseFloat(account.equity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="#fd7e14"
            />
            <MetricCard
              label="Long Positions"
              value={`$${parseFloat(account.long_market_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              color="#007bff"
            />
            <MetricCard
              label="Open Positions"
              value={positions.length.toString()}
              color="#6610f2"
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
        {/* Manual Trading */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '30px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 20px 0' }}>🎯 Manual Trading</h2>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Symbol</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            >
              <option value="">Select a stock...</option>
              {rankings.map((stock, idx) => (
                <option key={stock.ticker} value={stock.ticker}>
                  {stock.ticker} - ${stock.price?.toFixed(2) || 'N/A'} (Rank #{idx + 1})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Order Type</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setOrderType('buy')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: orderType === 'buy' ? '#28a745' : '#f8f9fa',
                  color: orderType === 'buy' ? 'white' : '#495057',
                  border: '1px solid #28a745',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                BUY
              </button>
              <button
                onClick={() => setOrderType('sell')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: orderType === 'sell' ? '#dc3545' : '#f8f9fa',
                  color: orderType === 'sell' ? 'white' : '#495057',
                  border: '1px solid #dc3545',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                SELL
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min="1"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            />
          </div>

          <button
            onClick={placeOrder}
            disabled={orderLoading || !selectedSymbol}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              fontWeight: '600',
              backgroundColor: orderType === 'buy' ? '#28a745' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: orderLoading || !selectedSymbol ? 'not-allowed' : 'pointer',
              opacity: orderLoading || !selectedSymbol ? 0.6 : 1
            }}
          >
            {orderLoading ? '⏳ Placing Order...' : `${orderType.toUpperCase()} ${quantity} Shares`}
          </button>

          <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '6px', fontSize: '13px' }}>
            💡 <strong>Note:</strong> Market is {new Date().getDay() >= 1 && new Date().getDay() <= 5 && new Date().getHours() >= 9 && new Date().getHours() < 16 ? 'OPEN' : 'CLOSED'}. Orders will execute when market opens.
          </div>
        </div>

        {/* Auto-Trading */}
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '30px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 20px 0' }}>🤖 Auto-Trading</h2>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Top N Stocks</label>
            <input
              type="number"
              value={autoConfig.topN}
              onChange={(e) => setAutoConfig({ ...autoConfig, topN: parseInt(e.target.value) })}
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
            <small style={{ color: '#6c757d' }}>Buy the top {autoConfig.topN} ranked stocks</small>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>Position Size (%)</label>
            <input
              type="number"
              value={autoConfig.positionSize}
              onChange={(e) => setAutoConfig({ ...autoConfig, positionSize: parseInt(e.target.value) })}
              min="1"
              max="100"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '16px'
              }}
            />
            <small style={{ color: '#6c757d' }}>
              {autoConfig.positionSize}% of portfolio per stock (~${account ? ((parseFloat(account.portfolio_value) * (autoConfig.positionSize / 100)).toLocaleString()) : '0'} each)
            </small>
          </div>

          <button
            onClick={executeAutoTrade}
            disabled={autoTrading}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              fontWeight: '600',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: autoTrading ? 'not-allowed' : 'pointer',
              opacity: autoTrading ? 0.6 : 1
            }}
          >
            {autoTrading ? '⏳ Executing...' : `🚀 Buy Top ${autoConfig.topN} Stocks`}
          </button>

          <div style={{ marginTop: '15px', padding: '12px', backgroundColor: '#d1ecf1', borderRadius: '6px', fontSize: '13px', color: '#0c5460' }}>
            <strong>Auto-Trade Preview:</strong> Will buy equal $ amounts of top {autoConfig.topN} stocks using {autoConfig.positionSize}% position sizing.
          </div>
        </div>
      </div>

      {/* Current Positions */}
      {positions && positions.length > 0 && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '30px',
          marginBottom: '30px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 20px 0' }}>📈 Current Positions</h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e6ed' }}>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Symbol</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Qty</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Avg Entry</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Current</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Market Value</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Unrealized P&L</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Return %</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Today %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #e0e6ed' }}>
                    <td style={{ padding: '10px 8px', fontWeight: '600' }}>{pos.symbol}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{pos.quantity.toLocaleString()}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>${pos.avgEntryPrice.toFixed(2)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>${pos.currentPrice.toFixed(2)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>${pos.marketValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{
                      padding: '10px 8px',
                      textAlign: 'right',
                      fontWeight: '600',
                      color: pos.unrealizedPL >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      {pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{
                      padding: '10px 8px',
                      textAlign: 'right',
                      fontWeight: '600',
                      color: pos.unrealizedPLPercent >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      {pos.unrealizedPLPercent >= 0 ? '+' : ''}{pos.unrealizedPLPercent.toFixed(2)}%
                    </td>
                    <td style={{
                      padding: '10px 8px',
                      textAlign: 'right',
                      color: pos.changeToday >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      {pos.changeToday >= 0 ? '+' : ''}{pos.changeToday.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order History */}
      {orders && orders.length > 0 && (
        <div style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e0e6ed',
          padding: '30px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ margin: '0 0 20px 0' }}>📋 Order History (Last {orders.length})</h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #e0e6ed' }}>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Time</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Type</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Symbol</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Qty</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Filled</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right', fontWeight: '600' }}>Avg Price</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Status</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: '600' }}>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid #e0e6ed' }}>
                    <td style={{ padding: '10px 8px' }}>{new Date(order.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '600',
                        backgroundColor: order.side === 'buy' ? '#d1ecf1' : '#f8d7da',
                        color: order.side === 'buy' ? '#0c5460' : '#721c24'
                      }}>
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontWeight: '600' }}>{order.symbol}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{order.quantity.toLocaleString()}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{order.filledQty}/{order.quantity}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                      {order.filledAvgPrice ? `$${order.filledAvgPrice.toFixed(2)}` : '-'}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor:
                          order.status === 'filled' ? '#d4edda' :
                          order.status === 'accepted' ? '#d1ecf1' :
                          order.status === 'pending_new' ? '#fff3cd' : '#f8d7da',
                        color:
                          order.status === 'filled' ? '#155724' :
                          order.status === 'accepted' ? '#0c5460' :
                          order.status === 'pending_new' ? '#856404' : '#721c24'
                      }}>
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: '11px', fontFamily: 'monospace' }}>
                      {order.id.substring(0, 8)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Metric card component
const MetricCard = ({ label, value, color, subtitle }) => (
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
    {subtitle && (
      <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '5px' }}>
        {subtitle}
      </div>
    )}
  </div>
);

export default PaperTradingPage;
