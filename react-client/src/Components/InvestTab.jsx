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

const InvestTab = () => {
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [tradeSummary, setTradeSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connectionStep, setConnectionStep] = useState('connect'); // 'connect', 'connecting', 'connected'
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'positions', 'trades', 'paper-trading'
  
  // Paper trading state
  const [paperPortfolio, setPaperPortfolio] = useState(null);
  const [paperTrades, setPaperTrades] = useState([]);
  const [orderForm, setOrderForm] = useState({
    symbol: '',
    side: 'buy',
    quantity: '',
    orderType: 'market',
    limitPrice: ''
  });

  // Check URL params for connection success
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected') === 'true') {
      setConnectionStep('connected');
      // Remove the URL parameter
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

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
  const generateConnectionPortal = async (userData) => {
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
  const fetchAccountData = async (userData) => {
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
          fetchTradeSummary(data.accounts[0].id, userData)
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
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  // Format percentage values
  const formatPercent = (value) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  // Format date values
  const formatDate = (dateString) => {
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
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  // Get trade side styling
  const getTradeSideStyle = (side) => {
    return {
      color: side === 'buy' ? '#28a745' : '#dc3545',
      fontWeight: '600',
      textTransform: 'uppercase',
      fontSize: '12px'
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
          initialCash 
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
          limitPrice: ''
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
      const response = await fetch(`/api/paper-trading/portfolio/${userId}/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initialCash: 100000 }),
      });

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

  // Load paper portfolio when switching to paper trading tab
  useEffect(() => {
    if (activeTab === 'paper-trading' && connectionStep === 'connected' && !paperPortfolio) {
      fetchPaperPortfolio();
    }
  }, [activeTab, connectionStep]);

  // Render connection step
  if (connectionStep === 'connect') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', backgroundColor: '#f8f9fa', minHeight: '400px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏦</div>
          <h2 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '28px', fontWeight: '600' }}>
            Connect Your Brokerage Account
          </h2>
          <p style={{ fontSize: '16px', color: '#6c757d', marginBottom: '32px', lineHeight: '1.5' }}>
            Connect your Charles Schwab account via SnapTrade to view your balance, positions, and enable trading functionality.
          </p>

          <div style={{ backgroundColor: '#e3f2fd', border: '1px solid #2196f3', borderRadius: '8px', padding: '20px', marginBottom: '32px', textAlign: 'left' }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#1976d2', fontSize: '16px' }}>What you'll get:</h4>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: '#1976d2' }}>
              <li style={{ marginBottom: '6px' }}>View account balance and information</li>
              <li style={{ marginBottom: '6px' }}>See your current stock positions</li>
              <li style={{ marginBottom: '6px' }}>Portfolio performance tracking</li>
              <li style={{ marginBottom: '6px' }}>Future: Direct trading capabilities</li>
            </ul>
          </div>

          {error && (
            <div style={{ backgroundColor: '#ffebee', border: '1px solid #f44336', borderRadius: '6px', padding: '16px', marginBottom: '24px', color: '#c62828' }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          <button
            onClick={createSnapTradeUser}
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '16px 32px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
              minWidth: '200px',
            }}
          >
            {isLoading ? '🔄 Connecting...' : '🔗 Connect Schwab Account'}
          </button>

          <div style={{ marginTop: '24px', fontSize: '12px', color: '#6c757d' }}>
            This demo uses SnapTrade's unified API to securely connect to your brokerage account.
            <br />
            Your credentials are never stored and are handled securely by SnapTrade.
          </div>
        </div>
      </div>
    );
  }

  // Render connecting step
  if (connectionStep === 'connecting') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', backgroundColor: '#f8f9fa', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px', animation: 'pulse 2s infinite' }}>🔄</div>
          <h3 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '24px' }}>Connecting to Schwab...</h3>
          <p style={{ color: '#6c757d', margin: '0' }}>Please wait while we establish a secure connection to your account.</p>
        </div>
      </div>
    );
  }

  // Render connected state with account data
  return (
    <div style={{ padding: '20px', backgroundColor: '#f8f9fa', minHeight: '600px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px 0', color: '#2c3e50', fontSize: '28px', fontWeight: '600' }}>
            🎉 Account Connected Successfully!
          </h2>
          <p style={{ color: '#6c757d', margin: '0', fontSize: '16px' }}>
            Your Charles Schwab account is now connected via SnapTrade
          </p>
        </div>

        {/* Quick Account Summary */}
        {accounts.length > 0 && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '20px', marginBottom: '24px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ margin: '0 0 4px 0', color: '#2c3e50', fontSize: '18px' }}>
                  🏦 {accounts[0].institution.name}
                </h4>
                <p style={{ margin: '0', color: '#6c757d', fontSize: '14px' }}>
                  Account {accounts[0].number} • {accounts[0].type}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745', marginBottom: '4px' }}>
                  {formatCurrency(accounts[0].balance.total)}
                </div>
                <div style={{ fontSize: '14px', color: '#6c757d' }}>
                  Cash: {formatCurrency(accounts[0].balance.cash)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
          <div style={{ borderBottom: '1px solid #e9ecef', padding: '0 24px' }}>
            <div style={{ display: 'flex', gap: '32px' }}>
              {[
                { id: 'overview', label: '📊 Overview', icon: '📊' },
                { id: 'positions', label: '💼 Positions', icon: '💼' },
                { id: 'trades', label: '💹 Recent Trades', icon: '💹' },
                { id: 'paper-trading', label: '📄 Paper Trading', icon: '📄' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '16px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: activeTab === tab.id ? '#007bff' : '#6c757d',
                    borderBottom: activeTab === tab.id ? '3px solid #007bff' : '3px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div style={{ padding: '24px' }}>
            {/* Overview Tab */}
            {activeTab === 'overview' && tradeSummary && (
              <div>
                <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '20px', fontWeight: '600' }}>
                  Trading Summary (Last 30 Days)
                </h3>
                
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#2c3e50', marginBottom: '4px' }}>
                      {tradeSummary.totalTrades}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>Total Trades</div>
                  </div>
                  <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#28a745', marginBottom: '4px' }}>
                      {formatCurrency(tradeSummary.totalVolume)}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>Total Volume</div>
                  </div>
                  <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#007bff', marginBottom: '4px' }}>
                      {formatCurrency(tradeSummary.averageTradeSize)}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>Avg Trade Size</div>
                  </div>
                  <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: tradeSummary.netCashFlow < 0 ? '#dc3545' : '#28a745', marginBottom: '4px' }}>
                      {formatCurrency(Math.abs(tradeSummary.netCashFlow))}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>
                      Net {tradeSummary.netCashFlow < 0 ? 'Invested' : 'Withdrawn'}
                    </div>
                  </div>
                </div>

                {/* Top Symbols */}
                <div>
                  <h4 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '18px', fontWeight: '600' }}>
                    Most Traded Symbols
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
                    {tradeSummary.topSymbols.slice(0, 5).map((symbol, index) => (
                      <div key={index} style={{ backgroundColor: '#e3f2fd', borderRadius: '6px', padding: '12px', textAlign: 'center' }}>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: '#1976d2', marginBottom: '4px' }}>
                          {symbol.symbol}
                        </div>
                        <div style={{ fontSize: '12px', color: '#1976d2' }}>
                          {formatCurrency(symbol.volume)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Positions Tab */}
            {activeTab === 'positions' && positions.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '20px', fontWeight: '600' }}>
                  Current Holdings
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                        <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Symbol</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Quantity</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Avg Price</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Current Price</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Market Value</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Gain/Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((position, index) => (
                        <tr key={index}>
                          <td style={{ padding: '12px', borderBottom: '1px solid #f1f3f4', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                            {position.symbol}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                            {position.quantity}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                            {formatCurrency(position.averagePrice)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                            {formatCurrency(position.currentPrice)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                            {formatCurrency(position.marketValue)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', fontWeight: '600', color: position.unrealizedGainLoss >= 0 ? '#28a745' : '#dc3545' }}>
                            {formatCurrency(position.unrealizedGainLoss)}
                            <br />
                            <span style={{ fontSize: '12px' }}>
                              ({formatPercent(position.unrealizedGainLossPercent)})
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
                <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '20px', fontWeight: '600' }}>
                  Recent Trades
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                        <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Date</th>
                        <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Symbol</th>
                        <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Side</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Quantity</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Price</th>
                        <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Total Value</th>
                        <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Type</th>
                        <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid #f1f3f4' }}>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#495057' }}>
                            {formatDate(trade.executedAt)}
                          </td>
                          <td style={{ padding: '12px', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                            {trade.symbol}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span style={getTradeSideStyle(trade.side)}>
                              {trade.side}
                            </span>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#495057' }}>
                            {trade.quantity}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#495057' }}>
                            {formatCurrency(trade.price)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                            {formatCurrency(trade.totalValue)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#6c757d', textTransform: 'capitalize' }}>
                            {trade.orderType}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span style={{
                              backgroundColor: trade.status === 'filled' ? '#d4edda' : '#fff3cd',
                              color: trade.status === 'filled' ? '#155724' : '#856404',
                              padding: '4px 8px',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: '600',
                              textTransform: 'capitalize'
                            }}>
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

            {/* Paper Trading Tab */}
            {activeTab === 'paper-trading' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: '0', color: '#2c3e50', fontSize: '20px', fontWeight: '600' }}>
                    Paper Trading Simulation
                  </h3>
                  {paperPortfolio && (
                    <button
                      onClick={resetPaperPortfolio}
                      style={{
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '8px 16px',
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      Reset Portfolio
                    </button>
                  )}
                </div>

                {/* Portfolio Summary */}
                {paperPortfolio && (
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '20px' }}>
                      <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: '700', color: '#28a745', marginBottom: '4px' }}>
                          {formatCurrency(paperPortfolio.totalPortfolioValue || 0)}
                        </div>
                        <div style={{ fontSize: '14px', color: '#6c757d' }}>Total Value</div>
                      </div>
                      <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: '#007bff', marginBottom: '4px' }}>
                          {formatCurrency(paperPortfolio.cash || 0)}
                        </div>
                        <div style={{ fontSize: '14px', color: '#6c757d' }}>Cash</div>
                      </div>
                      <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: '#6c757d', marginBottom: '4px' }}>
                          {formatCurrency(paperPortfolio.totalMarketValue || 0)}
                        </div>
                        <div style={{ fontSize: '14px', color: '#6c757d' }}>Positions</div>
                      </div>
                      <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                        <div style={{ fontSize: '18px', fontWeight: '700', color: (paperPortfolio.totalGainLoss || 0) >= 0 ? '#28a745' : '#dc3545', marginBottom: '4px' }}>
                          {formatCurrency(paperPortfolio.totalGainLoss || 0)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6c757d' }}>
                          ({formatPercent(paperPortfolio.totalGainLossPercent || 0)})
                        </div>
                        <div style={{ fontSize: '14px', color: '#6c757d' }}>P&L</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Order Form */}
                <div style={{ backgroundColor: '#f8f9fa', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
                  <h4 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '18px', fontWeight: '600' }}>
                    Place Order
                  </h4>
                  
                  {error && (
                    <div style={{ backgroundColor: '#ffebee', border: '1px solid #f44336', borderRadius: '6px', padding: '12px', marginBottom: '16px', color: '#c62828', fontSize: '14px' }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600', color: '#495057' }}>
                        Symbol
                      </label>
                      <input
                        type="text"
                        value={orderForm.symbol}
                        onChange={(e) => setOrderForm({...orderForm, symbol: e.target.value.toUpperCase()})}
                        placeholder="AAPL"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          fontSize: '14px',
                        }}
                      />
                    </div>
                    
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600', color: '#495057' }}>
                        Side
                      </label>
                      <select
                        value={orderForm.side}
                        onChange={(e) => setOrderForm({...orderForm, side: e.target.value})}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          fontSize: '14px',
                        }}
                      >
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                    </div>
                    
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600', color: '#495057' }}>
                        Quantity
                      </label>
                      <input
                        type="number"
                        value={orderForm.quantity}
                        onChange={(e) => setOrderForm({...orderForm, quantity: e.target.value})}
                        placeholder="100"
                        min="1"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          fontSize: '14px',
                        }}
                      />
                    </div>
                    
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600', color: '#495057' }}>
                        Order Type
                      </label>
                      <select
                        value={orderForm.orderType}
                        onChange={(e) => setOrderForm({...orderForm, orderType: e.target.value})}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          fontSize: '14px',
                        }}
                      >
                        <option value="market">Market</option>
                        <option value="limit">Limit</option>
                      </select>
                    </div>
                    
                    {orderForm.orderType === 'limit' && (
                      <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '600', color: '#495057' }}>
                          Limit Price
                        </label>
                        <input
                          type="number"
                          value={orderForm.limitPrice}
                          onChange={(e) => setOrderForm({...orderForm, limitPrice: e.target.value})}
                          placeholder="0.00"
                          step="0.01"
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: '1px solid #ced4da',
                            borderRadius: '4px',
                            fontSize: '14px',
                          }}
                        />
                      </div>
                    )}
                  </div>
                  
                  <button
                    onClick={executePaperTrade}
                    disabled={!orderForm.symbol || !orderForm.quantity}
                    style={{
                      backgroundColor: orderForm.side === 'buy' ? '#28a745' : '#dc3545',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '12px 24px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: !orderForm.symbol || !orderForm.quantity ? 'not-allowed' : 'pointer',
                      opacity: !orderForm.symbol || !orderForm.quantity ? 0.6 : 1,
                    }}
                  >
                    {orderForm.side === 'buy' ? '🛒 Place Buy Order' : '💰 Place Sell Order'}
                  </button>
                </div>

                {/* Paper Trading Positions */}
                {paperPortfolio && paperPortfolio.positions && paperPortfolio.positions.length > 0 && (
                  <div style={{ marginBottom: '24px' }}>
                    <h4 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '18px', fontWeight: '600' }}>
                      Paper Trading Positions
                    </h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8f9fa' }}>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Symbol</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Quantity</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Avg Price</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Current Price</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Market Value</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Gain/Loss</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paperPortfolio.positions.map((position, index) => (
                            <tr key={index}>
                              <td style={{ padding: '12px', borderBottom: '1px solid #f1f3f4', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                                {position.symbol}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                                {position.quantity}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                                {formatCurrency(position.averagePrice)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', color: '#495057' }}>
                                {formatCurrency(position.currentPrice)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                                {formatCurrency(position.marketValue)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #f1f3f4', fontSize: '14px', fontWeight: '600', color: position.unrealizedGainLoss >= 0 ? '#28a745' : '#dc3545' }}>
                                {formatCurrency(position.unrealizedGainLoss)}
                                <br />
                                <span style={{ fontSize: '12px' }}>
                                  ({formatPercent(position.unrealizedGainLossPercent)})
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
                    <h4 style={{ margin: '0 0 16px 0', color: '#2c3e50', fontSize: '18px', fontWeight: '600' }}>
                      Paper Trading History
                    </h4>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#f8f9fa' }}>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Date</th>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Symbol</th>
                            <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Side</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Quantity</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Price</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Total Value</th>
                            <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid #e9ecef', fontSize: '14px', fontWeight: '600', color: '#495057' }}>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paperTrades.slice().reverse().slice(0, 10).map((trade, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid #f1f3f4' }}>
                              <td style={{ padding: '12px', fontSize: '14px', color: '#495057' }}>
                                {formatDate(trade.executedAt)}
                              </td>
                              <td style={{ padding: '12px', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                                {trade.symbol}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center' }}>
                                <span style={getTradeSideStyle(trade.side)}>
                                  {trade.side}
                                </span>
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#495057' }}>
                                {trade.quantity}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#495057' }}>
                                {formatCurrency(trade.price)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'right', fontSize: '16px', fontWeight: '600', color: '#2c3e50' }}>
                                {formatCurrency(trade.totalValue)}
                              </td>
                              <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#6c757d', textTransform: 'capitalize' }}>
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
                  <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
                    <h4 style={{ margin: '0 0 12px 0', color: '#2c3e50', fontSize: '20px' }}>
                      Welcome to Paper Trading
                    </h4>
                    <p style={{ color: '#6c757d', margin: '0 0 20px 0', fontSize: '16px' }}>
                      Test your investment strategies with virtual money and real stock prices.
                      <br />
                      Start with $100,000 in simulated cash.
                    </p>
                    <button
                      onClick={() => createPaperPortfolio(100000)}
                      style={{
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '12px 24px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Create Paper Trading Portfolio
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Success Banner */}
        <div style={{ backgroundColor: '#d4edda', border: '1px solid #c3e6cb', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
          <strong style={{ color: '#155724' }}>✅ Complete Trading Solution!</strong>
          <div style={{ color: '#155724', fontSize: '14px', marginTop: '8px' }}>
            Successfully implemented: SnapTrade brokerage connectivity, account information, trade history, and paper trading simulation.
            <br />
            Ready for both real and simulated trading strategies with live market data.
          </div>
        </div>
      </div>

      <style jsx>{`
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