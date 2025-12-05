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
import Button from './common/Button';
import Card from './common/Card';
import MetricCard from './common/MetricCard';
import theme from '../theme';

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
      <div style={{
        padding: theme.spacing.xxl,
        textAlign: 'center'
      }}>
        <h2 style={{
          fontSize: theme.typography.fontSize.xxl,
          fontWeight: theme.typography.fontWeight.medium,
          margin: `0 0 ${theme.spacing.md} 0`
        }}>
          🔄 Loading Alpaca Paper Trading Account...
        </h2>
        <p style={{
          color: theme.colors.textLight,
          fontSize: theme.typography.fontSize.base
        }}>
          Connecting to your account...
        </p>
      </div>
    );
  }

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
            margin: `0 0 ${theme.spacing.xs} 0`,
            fontSize: theme.typography.fontSize.xxl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            💰 Alpaca Paper Trading
          </h1>
          <p style={{
            margin: 0,
            color: theme.colors.textLight,
            fontSize: theme.typography.fontSize.sm
          }}>
            Real Alpaca paper account • Account #{account?.account_number}
          </p>
        </div>
        <Button variant="primary" onClick={() => loadAllData()}>
          🔄 Refresh
        </Button>
      </div>

      {/* Error Display */}
      {error && (
        <Card
          variant="error"
          padding="medium"
          style={{ marginBottom: theme.spacing.lg }}
        >
          <span style={{
            color: theme.colors.errorDark,
            fontSize: theme.typography.fontSize.base
          }}>
            ❌ {error}
          </span>
        </Card>
      )}

      {/* Trading Mode Toggle */}
      {tradingMode && (
        <Card
          variant={tradingMode.isLive ? "warning" : "success"}
          padding="large"
          style={{ marginBottom: theme.spacing.lg }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{
                margin: `0 0 ${theme.spacing.sm} 0`,
                color: tradingMode.isLive ? theme.colors.warningDark : theme.colors.successDark,
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold
              }}>
                {tradingMode.statusEmoji} {tradingMode.statusText}
              </h3>
              <p style={{
                margin: `0 0 ${theme.spacing.sm} 0`,
                fontSize: theme.typography.fontSize.sm,
                color: tradingMode.isLive ? theme.colors.warningDark : theme.colors.successDark
              }}>
                {tradingMode.description}
              </p>
              <p style={{
                margin: 0,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.textLight
              }}>
                <strong>Account:</strong> {tradingMode.accountNumber} • <strong>Mode:</strong> {tradingMode.mode.toUpperCase()}
              </p>
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <Button
                variant={!tradingMode.isLive ? "success" : "ghost"}
                onClick={() => switchTradingMode('paper')}
                disabled={!tradingMode.isLive || modeLoading}
              >
                📝 Paper Mode
              </Button>
              <Button
                variant={tradingMode.isLive ? "danger" : "ghost"}
                onClick={() => switchTradingMode('live')}
                disabled={tradingMode.isLive || modeLoading}
              >
                💰 Live Mode
              </Button>
            </div>
          </div>
          {tradingMode.isLive && tradingMode.safetyConfig && (
            <div style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.sm,
              backgroundColor: 'rgba(255,0,0,0.1)',
              borderRadius: theme.borderRadius.md
            }}>
              <p style={{
                margin: `0 0 ${theme.spacing.xs} 0`,
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium,
                color: theme.colors.errorDark
              }}>
                ⚠️ SAFETY LIMITS ACTIVE:
              </p>
              <p style={{
                margin: 0,
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.errorDark
              }}>
                Max Order: ${tradingMode.safetyConfig.maxOrderValue.toLocaleString()} •
                Max Daily Trades: {tradingMode.safetyConfig.maxDailyTrades} •
                Confirmation Required: {tradingMode.safetyConfig.requireDoubleConfirm ? 'YES' : 'NO'}
              </p>
            </div>
          )}
        </Card>
      )}

      {/* Account Verification Section */}
      {account && (
        <Card
          variant="info"
          padding="large"
          style={{ marginBottom: theme.spacing.lg }}
        >
          <h3 style={{
            margin: `0 0 ${theme.spacing.md} 0`,
            color: theme.colors.infoDark,
            fontSize: theme.typography.fontSize.lg,
            fontWeight: theme.typography.fontWeight.bold
          }}>
            ✅ Connected to Real Alpaca Account
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: theme.spacing.md,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.infoDark
          }}>
            <div>
              <strong>Account ID:</strong><br />
              <code style={{ fontSize: theme.typography.fontSize.xs }}>{account.id}</code>
            </div>
            <div>
              <strong>Account Number:</strong><br />
              <code>{account.account_number}</code>
            </div>
            <div>
              <strong>Status:</strong><br />
              <span style={{
                padding: '2px 8px',
                backgroundColor: account.status === 'ACTIVE' ? theme.colors.success : theme.colors.warning,
                color: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                fontSize: theme.typography.fontSize.xs,
                fontWeight: theme.typography.fontWeight.medium
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
        </Card>
      )}

      {/* Portfolio Summary */}
      {account && (
        <Card padding="large" style={{ marginBottom: theme.spacing.xl }}>
          <h2 style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            📊 Portfolio Summary
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: theme.spacing.lg
          }}>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Portfolio Value"
                value={`$${parseFloat(account.portfolio_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                variant="info"
              />
            </Card>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Cash"
                value={`$${parseFloat(account.cash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                variant="default"
              />
            </Card>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Buying Power"
                value={`$${parseFloat(account.buying_power).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                subtext={`${account.multiplier}x leverage`}
                variant="success"
              />
            </Card>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Equity"
                value={`$${parseFloat(account.equity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                variant="warning"
              />
            </Card>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Long Positions"
                value={`$${parseFloat(account.long_market_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                variant="info"
              />
            </Card>
            <Card variant="default" padding="medium">
              <MetricCard
                label="Open Positions"
                value={positions.length.toString()}
                variant="info"
              />
            </Card>
          </div>
        </Card>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: theme.spacing.xl,
        marginBottom: theme.spacing.xl
      }}>
        {/* Manual Trading */}
        <Card padding="large">
          <h2 style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            🎯 Manual Trading
          </h2>

          <div style={{ marginBottom: theme.spacing.md }}>
            <label style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              fontSize: theme.typography.fontSize.base,
              color: theme.colors.text
            }}>
              Symbol
            </label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                fontFamily: theme.typography.fontFamily
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

          <div style={{ marginBottom: theme.spacing.md }}>
            <label style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              fontSize: theme.typography.fontSize.base,
              color: theme.colors.text
            }}>
              Order Type
            </label>
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <Button
                variant={orderType === 'buy' ? "success" : "outline"}
                onClick={() => setOrderType('buy')}
                style={{ flex: 1 }}
              >
                BUY
              </Button>
              <Button
                variant={orderType === 'sell' ? "danger" : "outline"}
                onClick={() => setOrderType('sell')}
                style={{ flex: 1 }}
              >
                SELL
              </Button>
            </div>
          </div>

          <div style={{ marginBottom: theme.spacing.lg }}>
            <label style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              fontSize: theme.typography.fontSize.base,
              color: theme.colors.text
            }}>
              Quantity
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              min="1"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                fontFamily: theme.typography.fontFamily
              }}
            />
          </div>

          <Button
            variant={orderType === 'buy' ? "success" : "danger"}
            onClick={placeOrder}
            disabled={orderLoading || !selectedSymbol}
            size="large"
            style={{ width: '100%' }}
          >
            {orderLoading ? '⏳ Placing Order...' : `${orderType.toUpperCase()} ${quantity} Shares`}
          </Button>

          <Card
            variant="info"
            padding="small"
            style={{
              marginTop: theme.spacing.md,
              fontSize: theme.typography.fontSize.sm
            }}
          >
            <span style={{ color: theme.colors.infoDark }}>
              💡 <strong>Note:</strong> Market is {new Date().getDay() >= 1 && new Date().getDay() <= 5 && new Date().getHours() >= 9 && new Date().getHours() < 16 ? 'OPEN' : 'CLOSED'}. Orders will execute when market opens.
            </span>
          </Card>
        </Card>

        {/* Auto-Trading */}
        <Card padding="large">
          <h2 style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            🤖 Auto-Trading
          </h2>

          <div style={{ marginBottom: theme.spacing.md }}>
            <label style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              fontSize: theme.typography.fontSize.base,
              color: theme.colors.text
            }}>
              Top N Stocks
            </label>
            <input
              type="number"
              value={autoConfig.topN}
              onChange={(e) => setAutoConfig({ ...autoConfig, topN: parseInt(e.target.value) })}
              min="1"
              max="20"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                fontFamily: theme.typography.fontFamily
              }}
            />
            <small style={{
              color: theme.colors.textLight,
              fontSize: theme.typography.fontSize.sm
            }}>
              Buy the top {autoConfig.topN} ranked stocks
            </small>
          </div>

          <div style={{ marginBottom: theme.spacing.lg }}>
            <label style={{
              display: 'block',
              marginBottom: theme.spacing.sm,
              fontWeight: theme.typography.fontWeight.medium,
              fontSize: theme.typography.fontSize.base,
              color: theme.colors.text
            }}>
              Position Size (%)
            </label>
            <input
              type="number"
              value={autoConfig.positionSize}
              onChange={(e) => setAutoConfig({ ...autoConfig, positionSize: parseInt(e.target.value) })}
              min="1"
              max="100"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                fontFamily: theme.typography.fontFamily
              }}
            />
            <small style={{
              color: theme.colors.textLight,
              fontSize: theme.typography.fontSize.sm
            }}>
              {autoConfig.positionSize}% of portfolio per stock (~${account ? ((parseFloat(account.portfolio_value) * (autoConfig.positionSize / 100)).toLocaleString()) : '0'} each)
            </small>
          </div>

          <Button
            variant="primary"
            onClick={executeAutoTrade}
            disabled={autoTrading}
            size="large"
            style={{ width: '100%' }}
          >
            {autoTrading ? '⏳ Executing...' : `🚀 Buy Top ${autoConfig.topN} Stocks`}
          </Button>

          <Card
            variant="info"
            padding="small"
            style={{
              marginTop: theme.spacing.md,
              fontSize: theme.typography.fontSize.sm
            }}
          >
            <span style={{ color: theme.colors.infoDark }}>
              <strong>Auto-Trade Preview:</strong> Will buy equal $ amounts of top {autoConfig.topN} stocks using {autoConfig.positionSize}% position sizing.
            </span>
          </Card>
        </Card>
      </div>

      {/* Current Positions */}
      {positions && positions.length > 0 && (
        <Card padding="large" style={{ marginBottom: theme.spacing.xl }}>
          <h2 style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            📈 Current Positions
          </h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: theme.typography.fontSize.sm,
              fontFamily: theme.typography.fontFamily
            }}>
              <thead>
                <tr style={{
                  backgroundColor: theme.colors.gray100,
                  borderBottom: `2px solid ${theme.colors.gray300}`
                }}>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Symbol</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Qty</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Avg Entry</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Current</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Market Value</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Unrealized P&L</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Return %</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Today %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, index) => (
                  <tr key={index} style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      fontWeight: theme.typography.fontWeight.medium
                    }}>{pos.symbol}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>{pos.quantity.toLocaleString()}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>${pos.avgEntryPrice.toFixed(2)}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>${pos.currentPrice.toFixed(2)}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>${pos.marketValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right',
                      fontWeight: theme.typography.fontWeight.medium,
                      color: pos.unrealizedPL >= 0 ? theme.colors.success : theme.colors.error
                    }}>
                      {pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right',
                      fontWeight: theme.typography.fontWeight.medium,
                      color: pos.unrealizedPLPercent >= 0 ? theme.colors.success : theme.colors.error
                    }}>
                      {pos.unrealizedPLPercent >= 0 ? '+' : ''}{pos.unrealizedPLPercent.toFixed(2)}%
                    </td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right',
                      color: pos.changeToday >= 0 ? theme.colors.success : theme.colors.error
                    }}>
                      {pos.changeToday >= 0 ? '+' : ''}{pos.changeToday.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Order History */}
      {orders && orders.length > 0 && (
        <Card padding="large">
          <h2 style={{
            margin: `0 0 ${theme.spacing.lg} 0`,
            fontSize: theme.typography.fontSize.xl,
            fontWeight: theme.typography.fontWeight.bold,
            color: theme.colors.text
          }}>
            📋 Order History (Last {orders.length})
          </h2>

          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: theme.typography.fontSize.sm,
              fontFamily: theme.typography.fontFamily
            }}>
              <thead>
                <tr style={{
                  backgroundColor: theme.colors.gray100,
                  borderBottom: `2px solid ${theme.colors.gray300}`
                }}>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Time</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Type</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Symbol</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Qty</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Filled</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'right',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Avg Price</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Status</th>
                  <th style={{
                    padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                    textAlign: 'left',
                    fontWeight: theme.typography.fontWeight.medium
                  }}>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, index) => (
                  <tr key={index} style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`
                    }}>{new Date(order.createdAt).toLocaleString()}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`
                    }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: theme.borderRadius.sm,
                        fontSize: theme.typography.fontSize.xs,
                        fontWeight: theme.typography.fontWeight.medium,
                        backgroundColor: order.side === 'buy' ? theme.colors.infoLight : theme.colors.errorLight,
                        color: order.side === 'buy' ? theme.colors.infoDark : theme.colors.errorDark
                      }}>
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      fontWeight: theme.typography.fontWeight.medium
                    }}>{order.symbol}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>{order.quantity.toLocaleString()}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>{order.filledQty}/{order.quantity}</td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      textAlign: 'right'
                    }}>
                      {order.filledAvgPrice ? `$${order.filledAvgPrice.toFixed(2)}` : '-'}
                    </td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`
                    }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: theme.borderRadius.sm,
                        fontSize: theme.typography.fontSize.xs,
                        fontWeight: theme.typography.fontWeight.medium,
                        backgroundColor:
                          order.status === 'filled' ? theme.colors.successLight :
                          order.status === 'accepted' ? theme.colors.infoLight :
                          order.status === 'pending_new' ? theme.colors.warningLight : theme.colors.errorLight,
                        color:
                          order.status === 'filled' ? theme.colors.successDark :
                          order.status === 'accepted' ? theme.colors.infoDark :
                          order.status === 'pending_new' ? theme.colors.warningDark : theme.colors.errorDark
                      }}>
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{
                      padding: `${theme.spacing.sm} ${theme.spacing.xs}`,
                      fontSize: theme.typography.fontSize.xs,
                      fontFamily: 'monospace'
                    }}>
                      {order.id.substring(0, 8)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default PaperTradingPage;
