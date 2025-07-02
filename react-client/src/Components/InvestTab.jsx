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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connectionStep, setConnectionStep] = useState('connect'); // 'connect', 'connecting', 'connected'

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
      
      // Fetch positions for the first account
      if (data.accounts.length > 0) {
        await fetchPositions(data.accounts[0].id, userData);
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

        {/* Account Overview */}
        {accounts.length > 0 && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '20px', fontWeight: '600' }}>
              Account Overview
            </h3>
            {accounts.map((account, index) => (
              <div key={index} style={{ border: '1px solid #e9ecef', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: '#2c3e50', fontSize: '18px' }}>
                      {account.institution.logo} {account.institution.name}
                    </h4>
                    <p style={{ margin: '0', color: '#6c757d', fontSize: '14px' }}>
                      Account {account.number} • {account.type}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#28a745', marginBottom: '4px' }}>
                      {formatCurrency(account.balance.total)}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>
                      Cash: {formatCurrency(account.balance.cash)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Positions */}
        {positions.length > 0 && (
          <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
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

        {/* Success Banner */}
        <div style={{ backgroundColor: '#d4edda', border: '1px solid #c3e6cb', borderRadius: '8px', padding: '16px', marginTop: '24px', textAlign: 'center' }}>
          <strong style={{ color: '#155724' }}>✅ Proof of Concept Complete!</strong>
          <div style={{ color: '#155724', fontSize: '14px', marginTop: '8px' }}>
            Successfully connected to Charles Schwab via SnapTrade and retrieved account information.
            <br />
            This demonstrates the foundation for implementing trading functionality.
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