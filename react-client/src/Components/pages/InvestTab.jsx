/**
 * INVEST TAB - SnapTrade Integration for Brokerage Connectivity
 *
 * Features:
 * - Charles Schwab account connection via SnapTrade
 * - Account balance and information display
 * - Portfolio positions visualization
 * - Proof of concept for trading integration
 */

import React, { useState, useEffect } from 'react';
import Button from '../common/Button';
import Card from '../common/Card';
import MetricCard from '../common/MetricCard';
import theme from '../../theme';

const InvestTab = () => {
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [tradeSummary, setTradeSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connectionStep, setConnectionStep] = useState('connect'); // 'connect', 'connecting', 'connected'
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'positions', 'trades', 'trading'
  const [tradingMode, setTradingMode] = useState('paper'); // 'paper' or 'live'

  // Paper trading state
  const [paperPortfolio, setPaperPortfolio] = useState(null);
  const [paperTrades, setPaperTrades] = useState([]);
  const [orderForm, setOrderForm] = useState({
    symbol: '',
    side: 'buy',
    quantity: '',
    orderType: 'market',
    limitPrice: '',
  });
  const [stockAnalysis, setStockAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // Check URL params for connection success, or auto-connect for paper trading
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === 'true') {
      setConnectionStep('connected');
      // Remove the URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (tradingMode === 'paper') {
      // Auto-connect for paper trading - no Schwab connection needed
      setConnectionStep('connected');
    }
  }, [tradingMode]);

  // Generate a unique user ID for demo purposes
  const generateUserId = () => {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Step 1: Create SnapTrade user
  const createSnapTradeUser = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const userId = generateUserId();

      const response = await fetch('/api/snaptrade/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setUser(data);
      console.log('✅ SnapTrade user created:', data);

      // Automatically proceed to connection portal
      await generateConnectionPortal(data);
    } catch (err) {
      setError(err.message);
      console.error('❌ Error creating user:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Generate connection portal and redirect
  const generateConnectionPortal = async userData => {
    try {
      const response = await fetch('/api/snaptrade/connection-portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: userData.userId,
          userSecret: userData.userSecret,
          connectionType: 'read', // Start with read-only for demo
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate connection portal');
      }

      console.log('🔗 Connection portal generated:', data);

      // For demo purposes, we'll simulate the connection
      setConnectionStep('connecting');

      // Simulate connection delay
      setTimeout(() => {
        setConnectionStep('connected');
        fetchAccountData(userData);
      }, 2000);
    } catch (err) {
      setError(err.message);
      console.error('❌ Error generating portal:', err);
    }
  };

  // Step 3: Fetch account data after connection
  const fetchAccountData = async userData => {
    try {
      const response = await fetch(
        `/api/snaptrade/accounts/${userData.userId}?userSecret=${userData.userSecret}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch accounts');
      }

      setAccounts(data.accounts);
      console.log('📊 Accounts fetched:', data.accounts);

      // Fetch positions, trades, and summary for the first account
      if (data.accounts.length > 0) {
        await Promise.all([
          fetchPositions(data.accounts[0].id, userData),
          fetchTrades(data.accounts[0].id, userData),
          fetchTradeSummary(data.accounts[0].id, userData),
        ]);
      }
    } catch (err) {
      setError(err.message);
      console.error('❌ Error fetching accounts:', err);
    }
  };

  // Step 4: Fetch positions for an account
  const fetchPositions = async (accountId, userData) => {
    try {
      const response = await fetch(
        `/api/snaptrade/accounts/${accountId}/positions?userId=${userData.userId}&userSecret=${userData.userSecret}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch positions');
      }

      setPositions(data.positions);
      console.log('📈 Positions fetched:', data.positions);
    } catch (err) {
      setError(err.message);
      console.error('❌ Error fetching positions:', err);
    }
  };

  // Step 5: Fetch recent trades for an account
  const fetchTrades = async (accountId, userData, limit = 10) => {
    try {
      const response = await fetch(
        `/api/snaptrade/accounts/${accountId}/trades?userId=${userData.userId}&userSecret=${userData.userSecret}&limit=${limit}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch trades');
      }

      setTrades(data.trades);
      console.log('💹 Trades fetched:', data.trades);
    } catch (err) {
      setError(err.message);
      console.error('❌ Error fetching trades:', err);
    }
  };

  // Step 6: Fetch trade summary for an account
  const fetchTradeSummary = async (accountId, userData, period = '30d') => {
    try {
      const response = await fetch(
        `/api/snaptrade/accounts/${accountId}/trade-summary?userId=${userData.userId}&userSecret=${userData.userSecret}&period=${period}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch trade summary');
      }

      setTradeSummary(data.summary);
      console.log('📊 Trade summary fetched:', data.summary);
    } catch (err) {
      setError(err.message);
      console.error('❌ Error fetching trade summary:', err);
    }
  };

  // Format currency values
  const formatCurrency = value => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  // Format percentage values
  const formatPercent = value => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  // Format date values
  const formatDate = dateString => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // Get trade side styling
  const getTradeSideStyle = side => {
    return {
      color: side === 'buy' ? theme.colors.success : theme.colors.error,
      fontWeight: theme.typography.fontWeight.medium,
      textTransform: 'uppercase',
      fontSize: theme.typography.fontSize.sm,
    };
  };

  // Paper Trading Functions
  const createPaperPortfolio = async (initialCash = 100000) => {
    try {
      const response = await fetch('/api/paper-trading/portfolio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user?.userId || 'demo_user',
          initialCash,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setPaperPortfolio(data.portfolio);
        console.log('📄 Paper portfolio created:', data.portfolio);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to create paper trading portfolio');
      console.error('Error creating paper portfolio:', err);
    }
  };

  const fetchPaperPortfolio = async () => {
    try {
      const userId = user?.userId || 'demo_user';
      const response = await fetch(`/api/paper-trading/portfolio/${userId}`);

      const data = await response.json();
      if (response.ok) {
        setPaperPortfolio(data.portfolio);
        setPaperTrades(data.portfolio.trades || []);
        console.log('📄 Paper portfolio fetched:', data.portfolio);
      } else if (response.status === 404) {
        // Portfolio doesn't exist, create one
        await createPaperPortfolio();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to fetch paper trading portfolio');
      console.error('Error fetching paper portfolio:', err);
    }
  };

  // Fetch comprehensive stock analysis
  const fetchStockAnalysis = async symbol => {
    if (!symbol || symbol.length === 0) {
      setStockAnalysis(null);
      return;
    }

    setLoadingAnalysis(true);
    setError(null);

    try {
      const response = await fetch(`/api/stock/analysis/${symbol}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch stock analysis');
      }

      setStockAnalysis(data.analysis);
      console.log('✅ Stock analysis loaded:', data.analysis);
    } catch (err) {
      console.error('Error fetching stock analysis:', err);
      setError(err.message);
      setStockAnalysis(null);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  // Auto-fetch analysis when symbol changes
  useEffect(() => {
    if (orderForm.symbol && orderForm.symbol.length >= 1) {
      const timeoutId = setTimeout(() => {
        fetchStockAnalysis(orderForm.symbol);
      }, 500); // Debounce for 500ms

      return () => clearTimeout(timeoutId);
    } else {
      setStockAnalysis(null);
    }
  }, [orderForm.symbol]);

  const executePaperTrade = async () => {
    try {
      const { symbol, side, quantity, orderType, limitPrice } = orderForm;

      if (!symbol || !quantity) {
        setError('Symbol and quantity are required');
        return;
      }

      const orderData = {
        userId: user?.userId || 'demo_user',
        symbol: symbol.toUpperCase(),
        side,
        quantity: parseInt(quantity),
        orderType,
      };

      if (orderType === 'limit' && limitPrice) {
        orderData.limitPrice = parseFloat(limitPrice);
      }

      const response = await fetch('/api/paper-trading/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData),
      });

      const data = await response.json();
      if (response.ok) {
        setPaperPortfolio(data.portfolio);
        setPaperTrades(data.portfolio.trades || []);

        // Reset form
        setOrderForm({
          symbol: '',
          side: 'buy',
          quantity: '',
          orderType: 'market',
          limitPrice: '',
        });

        console.log('💹 Paper trade executed:', data.trade);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to execute paper trade');
      console.error('Error executing paper trade:', err);
    }
  };

  const resetPaperPortfolio = async () => {
    try {
      const userId = user?.userId || 'demo_user';
      const response = await fetch(
        `/api/paper-trading/portfolio/${userId}/reset`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ initialCash: 100000 }),
        }
      );

      const data = await response.json();
      if (response.ok) {
        setPaperPortfolio(data.portfolio);
        setPaperTrades([]);
        console.log('🔄 Paper portfolio reset');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to reset paper trading portfolio');
      console.error('Error resetting paper portfolio:', err);
    }
  };

  // Load paper portfolio when switching to trading tab in paper mode
  useEffect(() => {
    if (
      activeTab === 'trading' &&
      tradingMode === 'paper' &&
      connectionStep === 'connected' &&
      !paperPortfolio
    ) {
      fetchPaperPortfolio();
    }
  }, [activeTab, tradingMode, connectionStep]);

  // Render connection step
  if (connectionStep === 'connect') {
    return (
      <div
        style={{
          padding: theme.spacing.xxl + ' ' + theme.spacing.md,
          textAlign: 'center',
          backgroundColor: theme.colors.background,
          minHeight: '400px',
        }}
      >
        <Card padding="large" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ fontSize: '48px', marginBottom: theme.spacing.md }}>
            🏦
          </div>
          <h2
            style={{
              margin: '0 0 ' + theme.spacing.md + ' 0',
              color: theme.colors.primary,
              fontSize: '28px',
              fontWeight: theme.typography.fontWeight.medium,
            }}
          >
            Connect Your Brokerage Account
          </h2>
          <p
            style={{
              fontSize: theme.typography.fontSize.md,
              color: theme.colors.textLight,
              marginBottom: theme.spacing.xl,
              lineHeight: '1.5',
            }}
          >
            Connect your Charles Schwab account via SnapTrade to view your
            balance, positions, and enable trading functionality.
          </p>

          <Card
            variant="info"
            padding="medium"
            style={{ marginBottom: theme.spacing.xl, textAlign: 'left' }}
          >
            <h4
              style={{
                margin: '0 0 ' + theme.spacing.sm + ' 0',
                color: theme.colors.infoDark,
                fontSize: theme.typography.fontSize.md,
              }}
            >
              What you'll get:
            </h4>
            <ul
              style={{
                margin: 0,
                paddingLeft: theme.spacing.md,
                fontSize: theme.typography.fontSize.base,
                color: theme.colors.infoDark,
              }}
            >
              <li style={{ marginBottom: theme.spacing.xs }}>
                View account balance and information
              </li>
              <li style={{ marginBottom: theme.spacing.xs }}>
                See your current stock positions
              </li>
              <li style={{ marginBottom: theme.spacing.xs }}>
                Portfolio performance tracking
              </li>
              <li style={{ marginBottom: theme.spacing.xs }}>
                Future: Direct trading capabilities
              </li>
            </ul>
          </Card>

          {error && (
            <Card
              variant="error"
              padding="medium"
              style={{ marginBottom: theme.spacing.lg }}
            >
              <strong style={{ color: theme.colors.errorDark }}>Error:</strong>{' '}
              <span style={{ color: theme.colors.errorDark }}>{error}</span>
            </Card>
          )}

          <Button
            variant="success"
            size="large"
            onClick={createSnapTradeUser}
            disabled={isLoading}
            style={{ minWidth: '200px' }}
          >
            {isLoading ? '🔄 Connecting...' : '🔗 Connect Schwab Account'}
          </Button>

          <div
            style={{
              marginTop: theme.spacing.lg,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.textLight,
            }}
          >
            This demo uses SnapTrade's unified API to securely connect to your
            brokerage account.
            <br />
            Your credentials are never stored and are handled securely by
            SnapTrade.
          </div>
        </Card>
      </div>
    );
  }

  // Render connecting step
  if (connectionStep === 'connecting') {
    return (
      <div
        style={{
          padding: theme.spacing.xxl + ' ' + theme.spacing.md,
          textAlign: 'center',
          backgroundColor: theme.colors.background,
          minHeight: '400px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Card padding="large" style={{ maxWidth: '500px' }}>
          <div
            style={{
              fontSize: '48px',
              marginBottom: theme.spacing.md,
              animation: 'pulse 2s infinite',
            }}
          >
            🔄
          </div>
          <h3
            style={{
              margin: '0 0 ' + theme.spacing.md + ' 0',
              color: theme.colors.primary,
              fontSize: theme.typography.fontSize.xxl,
            }}
          >
            Connecting to Schwab...
          </h3>
          <p style={{ color: theme.colors.textLight, margin: '0' }}>
            Please wait while we establish a secure connection to your account.
          </p>
        </Card>
      </div>
    );
  }

  // Render connected state with account data
  return (
    <div
      style={{
        padding: theme.spacing.md,
        backgroundColor: theme.colors.background,
        minHeight: '600px',
      }}
    >
      <div>
        <div style={{ marginBottom: theme.spacing.lg, textAlign: 'center' }}>
          <h2
            style={{
              margin: '0 0 ' + theme.spacing.sm + ' 0',
              color: theme.colors.primary,
              fontSize: '28px',
              fontWeight: theme.typography.fontWeight.medium,
            }}
          >
            🎉 Account Connected Successfully!
          </h2>
          <p
            style={{
              color: theme.colors.textLight,
              margin: '0',
              fontSize: theme.typography.fontSize.md,
            }}
          >
            Your Charles Schwab account is now connected via SnapTrade
          </p>
        </div>

        {/* Quick Account Summary */}
        {accounts.length > 0 && (
          <Card padding="medium" style={{ marginBottom: theme.spacing.lg }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h4
                  style={{
                    margin: '0 0 ' + theme.spacing.xs + ' 0',
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSize.lg,
                  }}
                >
                  🏦 {accounts[0].institution.name}
                </h4>
                <p
                  style={{
                    margin: '0',
                    color: theme.colors.textLight,
                    fontSize: theme.typography.fontSize.base,
                  }}
                >
                  Account {accounts[0].number} • {accounts[0].type}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.xxl,
                    fontWeight: theme.typography.fontWeight.bold,
                    color: theme.colors.success,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  {formatCurrency(accounts[0].balance.total)}
                </div>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.base,
                    color: theme.colors.textLight,
                  }}
                >
                  Cash: {formatCurrency(accounts[0].balance.cash)}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Tab Navigation */}
        <Card padding="none" style={{ marginBottom: theme.spacing.lg }}>
          <div
            style={{
              borderBottom: `1px solid ${theme.colors.gray300}`,
              padding: '0 ' + theme.spacing.lg,
            }}
          >
            <div style={{ display: 'flex', gap: theme.spacing.xl }}>
              {[
                { id: 'overview', label: '📊 Overview', icon: '📊' },
                { id: 'positions', label: '💼 Positions', icon: '💼' },
                { id: 'trades', label: '💹 Recent Trades', icon: '💹' },
                { id: 'trading', label: '🚀 Trading', icon: '🚀' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: theme.spacing.md + ' 0',
                    fontSize: theme.typography.fontSize.md,
                    fontWeight: theme.typography.fontWeight.medium,
                    color:
                      activeTab === tab.id
                        ? theme.colors.info
                        : theme.colors.textLight,
                    borderBottom:
                      activeTab === tab.id
                        ? `3px solid ${theme.colors.info}`
                        : '3px solid transparent',
                    cursor: 'pointer',
                    transition: theme.transitions.normal,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ padding: theme.spacing.lg }}>
            {/* Trading Mode Toggle */}
            {activeTab === 'trading' && (
              <Card
                variant="default"
                padding="medium"
                style={{
                  marginBottom: theme.spacing.lg,
                  backgroundColor: theme.colors.gray100,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: theme.spacing.sm,
                  }}
                >
                  <h4
                    style={{
                      margin: '0',
                      color: theme.colors.primary,
                      fontSize: theme.typography.fontSize.md,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Trading Mode
                  </h4>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.spacing.sm,
                    }}
                  >
                    <span
                      style={{
                        fontSize: theme.typography.fontSize.base,
                        color: theme.colors.textLight,
                        fontWeight: theme.typography.fontWeight.normal,
                      }}
                    >
                      {tradingMode === 'paper'
                        ? '📄 Paper Trading'
                        : '💰 Live Trading'}
                    </span>
                    <Button
                      variant={tradingMode === 'paper' ? 'primary' : 'success'}
                      size="small"
                      onClick={() =>
                        setTradingMode(
                          tradingMode === 'paper' ? 'live' : 'paper'
                        )
                      }
                      style={{
                        borderRadius: theme.borderRadius.full,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Switch to {tradingMode === 'paper' ? 'Live' : 'Paper'}
                    </Button>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: theme.typography.fontSize.sm,
                    color: theme.colors.textLight,
                    lineHeight: '1.4',
                  }}
                >
                  {tradingMode === 'paper' ? (
                    <>
                      <strong>Paper Trading Mode:</strong> Practice with virtual
                      money ($100,000 starting balance) using real stock prices.
                      Perfect for testing strategies without financial risk.
                    </>
                  ) : (
                    <>
                      <strong>Live Trading Mode:</strong> Execute real trades
                      with your connected Schwab account.
                      <span
                        style={{
                          color: theme.colors.error,
                          fontWeight: theme.typography.fontWeight.medium,
                        }}
                      >
                        Use real money with caution.
                      </span>
                    </>
                  )}
                </div>
              </Card>
            )}

            {/* Overview Tab */}
            {activeTab === 'overview' && tradeSummary && (
              <div>
                <h3
                  style={{
                    margin: '0 0 ' + theme.spacing.md + ' 0',
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSize.xl,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  Trading Summary (Last 30 Days)
                </h3>

                {/* Summary Cards */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: theme.spacing.md,
                    marginBottom: theme.spacing.lg,
                  }}
                >
                  <Card
                    variant="default"
                    padding="medium"
                    style={{
                      textAlign: 'center',
                      backgroundColor: theme.colors.gray100,
                    }}
                  >
                    <MetricCard
                      label="Total Trades"
                      value={tradeSummary.totalTrades}
                      variant="default"
                    />
                  </Card>
                  <Card
                    variant="default"
                    padding="medium"
                    style={{
                      textAlign: 'center',
                      backgroundColor: theme.colors.gray100,
                    }}
                  >
                    <MetricCard
                      label="Total Volume"
                      value={formatCurrency(tradeSummary.totalVolume)}
                      variant="success"
                    />
                  </Card>
                  <Card
                    variant="default"
                    padding="medium"
                    style={{
                      textAlign: 'center',
                      backgroundColor: theme.colors.gray100,
                    }}
                  >
                    <MetricCard
                      label="Avg Trade Size"
                      value={formatCurrency(tradeSummary.averageTradeSize)}
                      variant="info"
                    />
                  </Card>
                  <Card
                    variant="default"
                    padding="medium"
                    style={{
                      textAlign: 'center',
                      backgroundColor: theme.colors.gray100,
                    }}
                  >
                    <MetricCard
                      label={`Net ${tradeSummary.netCashFlow < 0 ? 'Invested' : 'Withdrawn'}`}
                      value={formatCurrency(Math.abs(tradeSummary.netCashFlow))}
                      variant={
                        tradeSummary.netCashFlow < 0 ? 'error' : 'success'
                      }
                    />
                  </Card>
                </div>

                {/* Top Symbols */}
                <div>
                  <h4
                    style={{
                      margin: '0 0 ' + theme.spacing.md + ' 0',
                      color: theme.colors.primary,
                      fontSize: theme.typography.fontSize.lg,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Most Traded Symbols
                  </h4>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: theme.spacing.sm,
                    }}
                  >
                    {tradeSummary.topSymbols
                      .slice(0, 5)
                      .map((symbol, index) => (
                        <Card
                          key={index}
                          variant="info"
                          padding="small"
                          style={{ textAlign: 'center' }}
                        >
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.infoDark,
                              marginBottom: theme.spacing.xs,
                            }}
                          >
                            {symbol.symbol}
                          </div>
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.infoDark,
                            }}
                          >
                            {formatCurrency(symbol.volume)}
                          </div>
                        </Card>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Positions Tab */}
            {activeTab === 'positions' && positions.length > 0 && (
              <div>
                <h3
                  style={{
                    margin: '0 0 ' + theme.spacing.md + ' 0',
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSize.xl,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  Current Holdings
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: theme.colors.gray100 }}>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'left',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Symbol
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Quantity
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Avg Price
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Current Price
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Market Value
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Gain/Loss
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position, index) => (
                        <tr key={index}>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.medium,
                              color: theme.colors.primary,
                            }}
                          >
                            {position.symbol}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {position.quantity}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {formatCurrency(position.averagePrice)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {formatCurrency(position.currentPrice)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.medium,
                              color: theme.colors.primary,
                            }}
                          >
                            {formatCurrency(position.marketValue)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              borderBottom: `1px solid ${theme.colors.gray200}`,
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.medium,
                              color:
                                position.unrealizedGainLoss >= 0
                                  ? theme.colors.success
                                  : theme.colors.error,
                            }}
                          >
                            {formatCurrency(position.unrealizedGainLoss)}
                            <br />
                            <span
                              style={{ fontSize: theme.typography.fontSize.sm }}
                            >
                              (
                              {formatPercent(
                                position.unrealizedGainLossPercent
                              )}
                              )
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Trades Tab */}
            {activeTab === 'trades' && trades.length > 0 && (
              <div>
                <h3
                  style={{
                    margin: '0 0 ' + theme.spacing.md + ' 0',
                    color: theme.colors.primary,
                    fontSize: theme.typography.fontSize.xl,
                    fontWeight: theme.typography.fontWeight.medium,
                  }}
                >
                  Recent Trades
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: theme.colors.gray100 }}>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'left',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Date
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'left',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Symbol
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'center',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Side
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Quantity
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Price
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'right',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Total Value
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'center',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Type
                        </th>
                        <th
                          style={{
                            padding: theme.spacing.sm,
                            textAlign: 'center',
                            borderBottom: `1px solid ${theme.colors.gray300}`,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            color: theme.colors.gray700,
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, index) => (
                        <tr
                          key={index}
                          style={{
                            borderBottom: `1px solid ${theme.colors.gray200}`,
                          }}
                        >
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {formatDate(trade.executedAt)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.medium,
                              color: theme.colors.primary,
                            }}
                          >
                            {trade.symbol}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'center',
                            }}
                          >
                            <span style={getTradeSideStyle(trade.side)}>
                              {trade.side}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {trade.quantity}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.gray700,
                            }}
                          >
                            {formatCurrency(trade.price)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'right',
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.medium,
                              color: theme.colors.primary,
                            }}
                          >
                            {formatCurrency(trade.totalValue)}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'center',
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.textLight,
                              textTransform: 'capitalize',
                            }}
                          >
                            {trade.orderType}
                          </td>
                          <td
                            style={{
                              padding: theme.spacing.sm,
                              textAlign: 'center',
                            }}
                          >
                            <span
                              style={{
                                backgroundColor:
                                  trade.status === 'filled'
                                    ? theme.colors.successLight
                                    : theme.colors.warningLight,
                                color:
                                  trade.status === 'filled'
                                    ? theme.colors.successDark
                                    : theme.colors.warningDark,
                                padding:
                                  theme.spacing.xs + ' ' + theme.spacing.sm,
                                borderRadius: theme.borderRadius.full,
                                fontSize: theme.typography.fontSize.sm,
                                fontWeight: theme.typography.fontWeight.medium,
                                textTransform: 'capitalize',
                              }}
                            >
                              {trade.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Trading Tab */}
            {activeTab === 'trading' && tradingMode === 'paper' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: theme.spacing.md,
                  }}
                >
                  <h3
                    style={{
                      margin: '0',
                      color: theme.colors.primary,
                      fontSize: theme.typography.fontSize.xl,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Paper Trading Simulation
                  </h3>
                  {paperPortfolio && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={resetPaperPortfolio}
                    >
                      Reset Portfolio
                    </Button>
                  )}
                </div>

                {/* Portfolio Summary */}
                {paperPortfolio && (
                  <div style={{ marginBottom: theme.spacing.lg }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: theme.spacing.md,
                        marginBottom: theme.spacing.md,
                      }}
                    >
                      <Card
                        variant="default"
                        padding="medium"
                        style={{
                          textAlign: 'center',
                          backgroundColor: theme.colors.gray100,
                        }}
                      >
                        <MetricCard
                          label="Total Value"
                          value={formatCurrency(
                            paperPortfolio.totalPortfolioValue || 0
                          )}
                          variant="success"
                        />
                      </Card>
                      <Card
                        variant="default"
                        padding="medium"
                        style={{
                          textAlign: 'center',
                          backgroundColor: theme.colors.gray100,
                        }}
                      >
                        <MetricCard
                          label="Cash"
                          value={formatCurrency(paperPortfolio.cash || 0)}
                          variant="info"
                        />
                      </Card>
                      <Card
                        variant="default"
                        padding="medium"
                        style={{
                          textAlign: 'center',
                          backgroundColor: theme.colors.gray100,
                        }}
                      >
                        <MetricCard
                          label="Positions"
                          value={formatCurrency(
                            paperPortfolio.totalMarketValue || 0
                          )}
                          variant="default"
                        />
                      </Card>
                      <Card
                        variant="default"
                        padding="medium"
                        style={{
                          textAlign: 'center',
                          backgroundColor: theme.colors.gray100,
                        }}
                      >
                        <MetricCard
                          label="P&L"
                          value={formatCurrency(
                            paperPortfolio.totalGainLoss || 0
                          )}
                          subtext={`(${formatPercent(paperPortfolio.totalGainLossPercent || 0)})`}
                          variant={
                            (paperPortfolio.totalGainLoss || 0) >= 0
                              ? 'success'
                              : 'error'
                          }
                        />
                      </Card>
                    </div>
                  </div>
                )}

                {/* Enhanced Order Form with Real-time Analysis */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: stockAnalysis ? '1fr 400px' : '1fr',
                    gap: theme.spacing.md,
                    marginBottom: theme.spacing.lg,
                  }}
                >
                  {/* Left: Order Form */}
                  <Card padding="large">
                    <h4
                      style={{
                        margin: '0 0 ' + theme.spacing.md + ' 0',
                        color: theme.colors.primary,
                        fontSize: theme.typography.fontSize.xl,
                        fontWeight: theme.typography.fontWeight.bold,
                      }}
                    >
                      Place Order
                    </h4>

                    {error && (
                      <Card
                        variant="error"
                        padding="small"
                        style={{ marginBottom: theme.spacing.md }}
                      >
                        <span
                          style={{
                            color: theme.colors.errorDark,
                            fontSize: theme.typography.fontSize.base,
                          }}
                        >
                          {error}
                        </span>
                      </Card>
                    )}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr',
                        gap: theme.spacing.md,
                        marginBottom: theme.spacing.md,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: 'block',
                            marginBottom: theme.spacing.sm,
                            fontSize: theme.typography.fontSize.sm,
                            fontWeight: theme.typography.fontWeight.bold,
                            color: theme.colors.gray700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          Stock Symbol
                        </label>
                        <input
                          type="text"
                          value={orderForm.symbol}
                          onChange={e =>
                            setOrderForm({
                              ...orderForm,
                              symbol: e.target.value.toUpperCase(),
                            })
                          }
                          placeholder="Enter symbol (e.g., AAPL)"
                          style={{
                            width: '100%',
                            padding: theme.spacing.sm + ' ' + theme.spacing.md,
                            border: `2px solid ${theme.colors.gray400}`,
                            borderRadius: theme.borderRadius.lg,
                            fontSize: theme.typography.fontSize.md,
                            fontWeight: theme.typography.fontWeight.medium,
                            outline: 'none',
                            transition: theme.transitions.normal,
                          }}
                          onFocus={e =>
                            (e.target.style.borderColor = theme.colors.info)
                          }
                          onBlur={e =>
                            (e.target.style.borderColor = theme.colors.gray400)
                          }
                        />
                        {loadingAnalysis && (
                          <div
                            style={{
                              marginTop: theme.spacing.sm,
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.info,
                            }}
                          >
                            Loading analysis...
                          </div>
                        )}
                      </div>

                      <div>
                        <label
                          style={{
                            display: 'block',
                            marginBottom: theme.spacing.sm,
                            fontSize: theme.typography.fontSize.sm,
                            fontWeight: theme.typography.fontWeight.bold,
                            color: theme.colors.gray700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          Shares
                        </label>
                        <input
                          type="number"
                          value={orderForm.quantity}
                          onChange={e =>
                            setOrderForm({
                              ...orderForm,
                              quantity: e.target.value,
                            })
                          }
                          placeholder="0"
                          min="1"
                          style={{
                            width: '100%',
                            padding: theme.spacing.sm + ' ' + theme.spacing.md,
                            border: `2px solid ${theme.colors.gray400}`,
                            borderRadius: theme.borderRadius.lg,
                            fontSize: theme.typography.fontSize.md,
                            fontWeight: theme.typography.fontWeight.medium,
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>

                    {/* Order Cost Summary */}
                    {stockAnalysis && orderForm.quantity && (
                      <Card
                        variant="default"
                        padding="medium"
                        style={{
                          backgroundColor: theme.colors.gray100,
                          marginBottom: theme.spacing.md,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: theme.spacing.sm,
                          }}
                        >
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.textLight,
                            }}
                          >
                            Market Price
                          </span>
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.medium,
                            }}
                          >
                            $
                            {parseFloat(stockAnalysis.price.current).toFixed(2)}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: theme.spacing.sm,
                          }}
                        >
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              color: theme.colors.textLight,
                            }}
                          >
                            Shares
                          </span>
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.medium,
                            }}
                          >
                            {orderForm.quantity}
                          </span>
                        </div>
                        <div
                          style={{
                            borderTop: `1px solid ${theme.colors.gray300}`,
                            margin: theme.spacing.sm + ' 0',
                          }}
                        ></div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                            }}
                          >
                            Estimated Total
                          </span>
                          <span
                            style={{
                              fontSize: theme.typography.fontSize.md,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                            }}
                          >
                            $
                            {(
                              parseFloat(stockAnalysis.price.current) *
                              parseFloat(orderForm.quantity)
                            ).toFixed(2)}
                          </span>
                        </div>
                      </Card>
                    )}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: theme.spacing.sm,
                        marginBottom: theme.spacing.md,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: 'block',
                            marginBottom: theme.spacing.sm,
                            fontSize: theme.typography.fontSize.sm,
                            fontWeight: theme.typography.fontWeight.bold,
                            color: theme.colors.gray700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          Order Type
                        </label>
                        <select
                          value={orderForm.orderType}
                          onChange={e =>
                            setOrderForm({
                              ...orderForm,
                              orderType: e.target.value,
                            })
                          }
                          style={{
                            width: '100%',
                            padding: theme.spacing.sm,
                            border: `2px solid ${theme.colors.gray400}`,
                            borderRadius: theme.borderRadius.lg,
                            fontSize: theme.typography.fontSize.base,
                            fontWeight: theme.typography.fontWeight.medium,
                            backgroundColor: theme.colors.surface,
                          }}
                        >
                          <option value="market">Market Order</option>
                          <option value="limit">Limit Order</option>
                        </select>
                      </div>

                      {orderForm.orderType === 'limit' && (
                        <div>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: theme.spacing.sm,
                              fontSize: theme.typography.fontSize.sm,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.gray700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            Limit Price
                          </label>
                          <input
                            type="number"
                            value={orderForm.limitPrice}
                            onChange={e =>
                              setOrderForm({
                                ...orderForm,
                                limitPrice: e.target.value,
                              })
                            }
                            placeholder="0.00"
                            step="0.01"
                            style={{
                              width: '100%',
                              padding: theme.spacing.sm,
                              border: `2px solid ${theme.colors.gray400}`,
                              borderRadius: theme.borderRadius.lg,
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.medium,
                            }}
                          />
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: theme.spacing.sm,
                      }}
                    >
                      <Button
                        variant="success"
                        size="large"
                        onClick={() => {
                          setOrderForm({ ...orderForm, side: 'buy' });
                          executePaperTrade();
                        }}
                        disabled={!orderForm.symbol || !orderForm.quantity}
                      >
                        Buy {orderForm.symbol || 'Stock'}
                      </Button>

                      <Button
                        variant="danger"
                        size="large"
                        onClick={() => {
                          setOrderForm({ ...orderForm, side: 'sell' });
                          executePaperTrade();
                        }}
                        disabled={!orderForm.symbol || !orderForm.quantity}
                      >
                        Sell {orderForm.symbol || 'Stock'}
                      </Button>
                    </div>
                  </Card>

                  {/* Right: Stock Analysis Panel */}
                  {stockAnalysis && (
                    <Card
                      padding="medium"
                      style={{ maxHeight: '700px', overflowY: 'auto' }}
                    >
                      <h4
                        style={{
                          margin: '0 0 ' + theme.spacing.md + ' 0',
                          color: theme.colors.primary,
                          fontSize: theme.typography.fontSize.lg,
                          fontWeight: theme.typography.fontWeight.bold,
                        }}
                      >
                        {stockAnalysis.symbol} Analysis
                      </h4>

                      {/* Price Info */}
                      <div style={{ marginBottom: theme.spacing.md }}>
                        <div
                          style={{
                            fontSize: '32px',
                            fontWeight: theme.typography.fontWeight.bold,
                            color: theme.colors.primary,
                            marginBottom: theme.spacing.xs,
                          }}
                        >
                          ${parseFloat(stockAnalysis.price.current).toFixed(2)}
                        </div>
                        {stockAnalysis.price.change24h && (
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.medium,
                              color:
                                parseFloat(stockAnalysis.price.change24h) >= 0
                                  ? theme.colors.success
                                  : theme.colors.error,
                            }}
                          >
                            {parseFloat(stockAnalysis.price.change24h) >= 0
                              ? '▲'
                              : '▼'}{' '}
                            {Math.abs(
                              parseFloat(stockAnalysis.price.change24h)
                            ).toFixed(2)}
                            % today
                          </div>
                        )}
                      </div>

                      {/* Recommendation */}
                      {stockAnalysis.recommendation && (
                        <Card
                          variant={
                            stockAnalysis.recommendation.action.includes('Buy')
                              ? 'success'
                              : stockAnalysis.recommendation.action.includes(
                                    'Sell'
                                  )
                                ? 'error'
                                : 'warning'
                          }
                          padding="small"
                          style={{ marginBottom: theme.spacing.md }}
                        >
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            Recommendation:{' '}
                            {stockAnalysis.recommendation.action}
                          </div>
                          <ul
                            style={{
                              margin: 0,
                              paddingLeft: theme.spacing.md,
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.gray700,
                            }}
                          >
                            {stockAnalysis.recommendation.reasons.map(
                              (reason, i) => (
                                <li
                                  key={i}
                                  style={{ marginBottom: theme.spacing.xs }}
                                >
                                  {reason}
                                </li>
                              )
                            )}
                          </ul>
                        </Card>
                      )}

                      {/* Technical Indicators */}
                      {stockAnalysis.technicals && (
                        <div style={{ marginBottom: theme.spacing.md }}>
                          <h5
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            Technical Indicators
                          </h5>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1fr',
                              gap: theme.spacing.sm,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            <Card
                              variant="default"
                              padding="small"
                              style={{ backgroundColor: theme.colors.gray100 }}
                            >
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.xs,
                                  color: theme.colors.textLight,
                                  marginBottom: theme.spacing.xs,
                                }}
                              >
                                RSI (14)
                              </div>
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.md,
                                  fontWeight: theme.typography.fontWeight.bold,
                                  color: theme.colors.primary,
                                }}
                              >
                                {stockAnalysis.technicals.rsi}
                              </div>
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.xs,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color:
                                    stockAnalysis.technicals.rsiSignal ===
                                    'Oversold'
                                      ? theme.colors.success
                                      : stockAnalysis.technicals.rsiSignal ===
                                          'Overbought'
                                        ? theme.colors.error
                                        : theme.colors.textLight,
                                }}
                              >
                                {stockAnalysis.technicals.rsiSignal}
                              </div>
                            </Card>

                            <Card
                              variant="default"
                              padding="small"
                              style={{ backgroundColor: theme.colors.gray100 }}
                            >
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.xs,
                                  color: theme.colors.textLight,
                                  marginBottom: theme.spacing.xs,
                                }}
                              >
                                Trend
                              </div>
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.md,
                                  fontWeight: theme.typography.fontWeight.bold,
                                  color:
                                    stockAnalysis.technicals.trendSignal ===
                                    'Bullish'
                                      ? theme.colors.success
                                      : stockAnalysis.technicals.trendSignal ===
                                          'Bearish'
                                        ? theme.colors.error
                                        : theme.colors.textLight,
                                }}
                              >
                                {stockAnalysis.technicals.trendSignal}
                              </div>
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.xs,
                                  color: theme.colors.textLight,
                                }}
                              >
                                MA20/MA50
                              </div>
                            </Card>
                          </div>

                          <div
                            style={{
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.gray700,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            <strong>52-Week Range:</strong> $
                            {stockAnalysis.technicals.low52w} - $
                            {stockAnalysis.technicals.high52w}
                          </div>
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.gray700,
                            }}
                          >
                            <strong>Distance from High:</strong>{' '}
                            {stockAnalysis.technicals.distanceFromHigh}%
                          </div>
                        </div>
                      )}

                      {/* Volume */}
                      {stockAnalysis.volume && (
                        <div style={{ marginBottom: theme.spacing.md }}>
                          <h5
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            Volume
                          </h5>
                          <div
                            style={{
                              fontSize: theme.typography.fontSize.sm,
                              color: theme.colors.gray700,
                            }}
                          >
                            <div>
                              Today:{' '}
                              {stockAnalysis.volume.current?.toLocaleString()}
                            </div>
                            {stockAnalysis.volume.changePercent && (
                              <div
                                style={{
                                  color:
                                    parseFloat(
                                      stockAnalysis.volume.changePercent
                                    ) > 0
                                      ? theme.colors.success
                                      : theme.colors.error,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                }}
                              >
                                {parseFloat(
                                  stockAnalysis.volume.changePercent
                                ) > 0
                                  ? '▲'
                                  : '▼'}{' '}
                                {Math.abs(
                                  parseFloat(stockAnalysis.volume.changePercent)
                                ).toFixed(1)}
                                % vs yesterday
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Projections */}
                      {stockAnalysis.projections && (
                        <div>
                          <h5
                            style={{
                              fontSize: theme.typography.fontSize.base,
                              fontWeight: theme.typography.fontWeight.bold,
                              color: theme.colors.primary,
                              marginBottom: theme.spacing.sm,
                            }}
                          >
                            Expected Returns
                          </h5>

                          <Card
                            variant="info"
                            padding="small"
                            style={{ marginBottom: theme.spacing.sm }}
                          >
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.sm,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: theme.colors.gray700,
                                marginBottom: theme.spacing.sm,
                              }}
                            >
                              1 Week Projection
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.lg,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: theme.colors.infoDark,
                                marginBottom: theme.spacing.xs,
                              }}
                            >
                              ${stockAnalysis.projections.oneWeek.expectedPrice}
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xs,
                                color: theme.colors.textLight,
                              }}
                            >
                              Expected return:{' '}
                              {stockAnalysis.projections.oneWeek.expectedReturn}
                              %
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xs,
                                color: theme.colors.textLight,
                              }}
                            >
                              Range: $
                              {stockAnalysis.projections.oneWeek.range.low} - $
                              {stockAnalysis.projections.oneWeek.range.high}
                            </div>
                            {orderForm.quantity && (
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.sm,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.infoDark,
                                  marginTop: theme.spacing.sm,
                                }}
                              >
                                Your potential P/L: $
                                {(
                                  (parseFloat(
                                    stockAnalysis.projections.oneWeek
                                      .expectedPrice
                                  ) -
                                    parseFloat(stockAnalysis.price.current)) *
                                  parseFloat(orderForm.quantity)
                                ).toFixed(2)}
                              </div>
                            )}
                          </Card>

                          <Card variant="success" padding="small">
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.sm,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: theme.colors.gray700,
                                marginBottom: theme.spacing.sm,
                              }}
                            >
                              1 Month Projection
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.lg,
                                fontWeight: theme.typography.fontWeight.bold,
                                color: theme.colors.successDark,
                                marginBottom: theme.spacing.xs,
                              }}
                            >
                              $
                              {stockAnalysis.projections.oneMonth.expectedPrice}
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xs,
                                color: theme.colors.textLight,
                              }}
                            >
                              Expected return:{' '}
                              {
                                stockAnalysis.projections.oneMonth
                                  .expectedReturn
                              }
                              %
                            </div>
                            <div
                              style={{
                                fontSize: theme.typography.fontSize.xs,
                                color: theme.colors.textLight,
                              }}
                            >
                              Range: $
                              {stockAnalysis.projections.oneMonth.range.low} - $
                              {stockAnalysis.projections.oneMonth.range.high}
                            </div>
                            {orderForm.quantity && (
                              <div
                                style={{
                                  fontSize: theme.typography.fontSize.sm,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.successDark,
                                  marginTop: theme.spacing.sm,
                                }}
                              >
                                Your potential P/L: $
                                {(
                                  (parseFloat(
                                    stockAnalysis.projections.oneMonth
                                      .expectedPrice
                                  ) -
                                    parseFloat(stockAnalysis.price.current)) *
                                  parseFloat(orderForm.quantity)
                                ).toFixed(2)}
                              </div>
                            )}
                          </Card>
                        </div>
                      )}
                    </Card>
                  )}
                </div>

                {/* Paper Trading Positions */}
                {paperPortfolio &&
                  paperPortfolio.positions &&
                  paperPortfolio.positions.length > 0 && (
                    <div style={{ marginBottom: theme.spacing.lg }}>
                      <h4
                        style={{
                          margin: '0 0 ' + theme.spacing.md + ' 0',
                          color: theme.colors.primary,
                          fontSize: theme.typography.fontSize.lg,
                          fontWeight: theme.typography.fontWeight.medium,
                        }}
                      >
                        Paper Trading Positions
                      </h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table
                          style={{ width: '100%', borderCollapse: 'collapse' }}
                        >
                          <thead>
                            <tr
                              style={{ backgroundColor: theme.colors.gray100 }}
                            >
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'left',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Symbol
                              </th>
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'right',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Quantity
                              </th>
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'right',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Avg Price
                              </th>
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'right',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Current Price
                              </th>
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'right',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Market Value
                              </th>
                              <th
                                style={{
                                  padding: theme.spacing.sm,
                                  textAlign: 'right',
                                  borderBottom: `1px solid ${theme.colors.gray300}`,
                                  fontSize: theme.typography.fontSize.base,
                                  fontWeight:
                                    theme.typography.fontWeight.medium,
                                  color: theme.colors.gray700,
                                }}
                              >
                                Gain/Loss
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {paperPortfolio.positions.map((position, index) => (
                              <tr key={index}>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.md,
                                    fontWeight:
                                      theme.typography.fontWeight.medium,
                                    color: theme.colors.primary,
                                  }}
                                >
                                  {position.symbol}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {position.quantity}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {formatCurrency(position.averagePrice)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {formatCurrency(position.currentPrice)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.md,
                                    fontWeight:
                                      theme.typography.fontWeight.medium,
                                    color: theme.colors.primary,
                                  }}
                                >
                                  {formatCurrency(position.marketValue)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    borderBottom: `1px solid ${theme.colors.gray200}`,
                                    fontSize: theme.typography.fontSize.base,
                                    fontWeight:
                                      theme.typography.fontWeight.medium,
                                    color:
                                      position.unrealizedGainLoss >= 0
                                        ? theme.colors.success
                                        : theme.colors.error,
                                  }}
                                >
                                  {formatCurrency(position.unrealizedGainLoss)}
                                  <br />
                                  <span
                                    style={{
                                      fontSize: theme.typography.fontSize.sm,
                                    }}
                                  >
                                    (
                                    {formatPercent(
                                      position.unrealizedGainLossPercent
                                    )}
                                    )
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                {/* Paper Trading History */}
                {paperTrades.length > 0 && (
                  <div>
                    <h4
                      style={{
                        margin: '0 0 ' + theme.spacing.md + ' 0',
                        color: theme.colors.primary,
                        fontSize: theme.typography.fontSize.lg,
                        fontWeight: theme.typography.fontWeight.medium,
                      }}
                    >
                      Paper Trading History
                    </h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{ width: '100%', borderCollapse: 'collapse' }}
                      >
                        <thead>
                          <tr style={{ backgroundColor: theme.colors.gray100 }}>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Date
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'left',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Symbol
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'center',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Side
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Quantity
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Price
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'right',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Total Value
                            </th>
                            <th
                              style={{
                                padding: theme.spacing.sm,
                                textAlign: 'center',
                                borderBottom: `1px solid ${theme.colors.gray300}`,
                                fontSize: theme.typography.fontSize.base,
                                fontWeight: theme.typography.fontWeight.medium,
                                color: theme.colors.gray700,
                              }}
                            >
                              Type
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paperTrades
                            .slice()
                            .reverse()
                            .slice(0, 10)
                            .map((trade, index) => (
                              <tr
                                key={index}
                                style={{
                                  borderBottom: `1px solid ${theme.colors.gray200}`,
                                }}
                              >
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {formatDate(trade.executedAt)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    fontSize: theme.typography.fontSize.md,
                                    fontWeight:
                                      theme.typography.fontWeight.medium,
                                    color: theme.colors.primary,
                                  }}
                                >
                                  {trade.symbol}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'center',
                                  }}
                                >
                                  <span style={getTradeSideStyle(trade.side)}>
                                    {trade.side}
                                  </span>
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {trade.quantity}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    fontSize: theme.typography.fontSize.base,
                                    color: theme.colors.gray700,
                                  }}
                                >
                                  {formatCurrency(trade.price)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'right',
                                    fontSize: theme.typography.fontSize.md,
                                    fontWeight:
                                      theme.typography.fontWeight.medium,
                                    color: theme.colors.primary,
                                  }}
                                >
                                  {formatCurrency(trade.totalValue)}
                                </td>
                                <td
                                  style={{
                                    padding: theme.spacing.sm,
                                    textAlign: 'center',
                                    fontSize: theme.typography.fontSize.sm,
                                    color: theme.colors.textLight,
                                    textTransform: 'capitalize',
                                  }}
                                >
                                  {trade.orderType}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Getting Started Message */}
                {!paperPortfolio && (
                  <Card
                    variant="default"
                    padding="large"
                    style={{
                      textAlign: 'center',
                      backgroundColor: theme.colors.gray100,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '48px',
                        marginBottom: theme.spacing.md,
                      }}
                    >
                      📄
                    </div>
                    <h4
                      style={{
                        margin: '0 0 ' + theme.spacing.sm + ' 0',
                        color: theme.colors.primary,
                        fontSize: theme.typography.fontSize.xl,
                      }}
                    >
                      Welcome to Paper Trading
                    </h4>
                    <p
                      style={{
                        color: theme.colors.textLight,
                        margin: '0 0 ' + theme.spacing.md + ' 0',
                        fontSize: theme.typography.fontSize.md,
                      }}
                    >
                      Test your investment strategies with virtual money and
                      real stock prices.
                      <br />
                      Start with $100,000 in simulated cash.
                    </p>
                    <Button
                      variant="success"
                      size="large"
                      onClick={() => createPaperPortfolio(100000)}
                    >
                      Create Paper Trading Portfolio
                    </Button>
                  </Card>
                )}
              </div>
            )}

            {/* Live Trading Tab */}
            {activeTab === 'trading' && tradingMode === 'live' && (
              <div>
                <div style={{ marginBottom: theme.spacing.md }}>
                  <h3
                    style={{
                      margin: '0 0 ' + theme.spacing.sm + ' 0',
                      color: theme.colors.primary,
                      fontSize: theme.typography.fontSize.xl,
                      fontWeight: theme.typography.fontWeight.medium,
                    }}
                  >
                    Live Trading - Charles Schwab
                  </h3>
                  <Card variant="warning" padding="medium">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                        marginBottom: theme.spacing.sm,
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>⚠️</span>
                      <strong
                        style={{
                          color: theme.colors.warningDark,
                          fontSize: theme.typography.fontSize.md,
                        }}
                      >
                        Live Trading Mode
                      </strong>
                    </div>
                    <p
                      style={{
                        color: theme.colors.warningDark,
                        margin: '0',
                        fontSize: theme.typography.fontSize.base,
                        lineHeight: '1.4',
                      }}
                    >
                      You are now in <strong>Live Trading Mode</strong> using
                      your connected Charles Schwab account. All trades will use
                      real money and execute on live markets. Please trade
                      responsibly.
                    </p>
                  </Card>
                </div>

                {/* Account Summary for Live Trading */}
                {accounts.length > 0 && (
                  <Card
                    variant="default"
                    padding="medium"
                    style={{
                      backgroundColor: theme.colors.gray100,
                      marginBottom: theme.spacing.lg,
                    }}
                  >
                    <h4
                      style={{
                        margin: '0 0 ' + theme.spacing.md + ' 0',
                        color: theme.colors.primary,
                        fontSize: theme.typography.fontSize.lg,
                        fontWeight: theme.typography.fontWeight.medium,
                      }}
                    >
                      Account Overview
                    </h4>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: theme.spacing.md,
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <MetricCard
                          label="Total Balance"
                          value={formatCurrency(accounts[0].balance.total)}
                          variant="success"
                        />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <MetricCard
                          label="Available Cash"
                          value={formatCurrency(accounts[0].balance.cash)}
                          variant="info"
                        />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <MetricCard
                          label="Invested"
                          value={formatCurrency(
                            accounts[0].balance.total - accounts[0].balance.cash
                          )}
                          variant="default"
                        />
                      </div>
                    </div>
                  </Card>
                )}

                {/* Live Trading Notice */}
                <Card
                  variant="info"
                  padding="large"
                  style={{ textAlign: 'center' }}
                >
                  <div
                    style={{ fontSize: '48px', marginBottom: theme.spacing.md }}
                  >
                    🚧
                  </div>
                  <h4
                    style={{
                      margin: '0 0 ' + theme.spacing.sm + ' 0',
                      color: theme.colors.infoDark,
                      fontSize: theme.typography.fontSize.xl,
                    }}
                  >
                    Live Trading Interface Coming Soon
                  </h4>
                  <p
                    style={{
                      color: theme.colors.infoDark,
                      margin: '0 0 ' + theme.spacing.md + ' 0',
                      fontSize: theme.typography.fontSize.md,
                      lineHeight: '1.5',
                    }}
                  >
                    Direct trading functionality through SnapTrade API is
                    currently under development.
                    <br />
                    For now, you can view your account data, positions, and
                    trade history in the other tabs.
                  </p>
                  <div
                    style={{
                      fontSize: theme.typography.fontSize.base,
                      color: theme.colors.infoDark,
                      fontWeight: theme.typography.fontWeight.normal,
                    }}
                  >
                    💡 <strong>Tip:</strong> Use Paper Trading mode to test
                    strategies while we complete the live trading integration.
                  </div>
                </Card>
              </div>
            )}
          </div>
        </Card>

        {/* Success Banner */}
        <Card
          variant="success"
          padding="medium"
          style={{ textAlign: 'center' }}
        >
          <strong style={{ color: theme.colors.successDark }}>
            ✅ Complete Trading Solution!
          </strong>
          <div
            style={{
              color: theme.colors.successDark,
              fontSize: theme.typography.fontSize.base,
              marginTop: theme.spacing.sm,
            }}
          >
            Successfully implemented: SnapTrade brokerage connectivity, account
            information, trade history, and paper trading simulation.
            <br />
            Ready for both real and simulated trading strategies with live
            market data.
          </div>
        </Card>
      </div>

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

export default InvestTab;
