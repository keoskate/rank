/**
 * EXPRESS SERVER - Static File Server + SnapTrade API Proxy
 *
 * Enhanced Express server that:
 * 1. Serves the built React application from /dist folder
 * 2. Handles client-side routing with catch-all route
 * 3. Provides secure SnapTrade API proxy endpoints for brokerage integration
 *
 * CRITICAL PATH: This serves the entire application
 * All HTTP requests flow through this server
 */
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const crypto = require('crypto');
const PORT = process.env.PORT || 8080;
const path = require('path');

const app = express();

// Middleware for JSON parsing
app.use(bodyParser.json());

// SnapTrade API Configuration
const SNAPTRADE_CONFIG = {
  baseURL: 'https://api.snaptrade.com/api/v1',
  clientId: process.env.SNAPTRADE_CLIENT_ID || 'DEMO_CLIENT_ID', // Replace with real credentials
  consumerKey: process.env.SNAPTRADE_CONSUMER_KEY || 'DEMO_CONSUMER_KEY', // Replace with real credentials
};

// SnapTrade API Helper Functions
function generateSnapTradeSignature(path, body, timestamp, userSecret) {
  const content = `${path}${SNAPTRADE_CONFIG.clientId}${timestamp}${body}`;
  return crypto
    .createHmac('sha256', userSecret)
    .update(content)
    .digest('base64');
}

function createSnapTradeUser(userId) {
  // In production, store this in a database
  const userSecret = crypto.randomBytes(32).toString('hex');
  return { userId, userSecret };
}

// SnapTrade API Endpoints

// 1. Create or get SnapTrade user
app.post('/api/snaptrade/users', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // In a real app, check if user exists in database first
    // For demo, we'll always create a new user
    const user = createSnapTradeUser(userId);
    
    console.log(`✅ Created SnapTrade user: ${userId}`);
    
    res.json({
      success: true,
      userId: user.userId,
      // Note: In production, never send userSecret to frontend
      // Store it securely in your backend database
      userSecret: user.userSecret,
      message: 'SnapTrade user created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating SnapTrade user:', error.message);
    res.status(500).json({ error: 'Failed to create SnapTrade user' });
  }
});

// 2. Generate connection portal URL for brokerage login
app.post('/api/snaptrade/connection-portal', async (req, res) => {
  try {
    const { userId, userSecret, connectionType = 'read' } = req.body;
    
    if (!userId || !userSecret) {
      return res.status(400).json({ error: 'userId and userSecret are required' });
    }

    const timestamp = Date.now().toString();
    const path = '/snapTrade/login';
    const body = JSON.stringify({
      broker: 'ALPACA', // Start with Alpaca for demo, can change to 'SCHWAB'
      connectionType: connectionType, // 'read' or 'trade'
      returnToUrl: `http://localhost:${PORT}/invest?connected=true`
    });

    const signature = generateSnapTradeSignature(path, body, timestamp, userSecret);

    const headers = {
      'Content-Type': 'application/json',
      'X-Snaptrade-Signature': signature,
      'X-Snaptrade-Timestamp': timestamp,
      'X-Snaptrade-Client-Id': SNAPTRADE_CONFIG.clientId,
      'X-Snaptrade-User-Id': userId
    };

    // For demo purposes, we'll simulate the connection portal URL
    // In real implementation, you'd call SnapTrade API here
    const demoPortalUrl = `https://app.snaptrade.com/connect?client_id=${SNAPTRADE_CONFIG.clientId}&user_id=${userId}&redirect=${encodeURIComponent(`http://localhost:${PORT}/invest?connected=true`)}`;
    
    console.log(`🔗 Generated connection portal for user: ${userId}`);
    
    res.json({
      success: true,
      redirectUrl: demoPortalUrl,
      message: 'Connection portal URL generated successfully'
    });
  } catch (error) {
    console.error('❌ Error generating connection portal:', error.message);
    res.status(500).json({ error: 'Failed to generate connection portal' });
  }
});

// 3. Get user accounts
app.get('/api/snaptrade/accounts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { userSecret } = req.query;
    
    if (!userId || !userSecret) {
      return res.status(400).json({ error: 'userId and userSecret are required' });
    }

    // For demo purposes, return mock account data
    // In real implementation, you'd call SnapTrade API here
    const mockAccounts = [
      {
        id: 'schwab-account-123',
        name: 'Charles Schwab Brokerage',
        number: '****7890',
        type: 'taxable',
        balance: {
          total: 45782.35,
          cash: 2340.50,
          currency: 'USD'
        },
        institution: {
          name: 'Charles Schwab',
          logo: '🏦'
        }
      }
    ];
    
    console.log(`📊 Retrieved accounts for user: ${userId}`);
    
    res.json({
      success: true,
      accounts: mockAccounts,
      message: 'Accounts retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving accounts:', error.message);
    res.status(500).json({ error: 'Failed to retrieve accounts' });
  }
});

// 4. Get account positions
app.get('/api/snaptrade/accounts/:accountId/positions', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { userId, userSecret } = req.query;
    
    if (!userId || !userSecret) {
      return res.status(400).json({ error: 'userId and userSecret are required' });
    }

    // For demo purposes, return mock positions data
    const mockPositions = [
      {
        symbol: 'AAPL',
        quantity: 50,
        averagePrice: 175.20,
        currentPrice: 182.45,
        marketValue: 9122.50,
        unrealizedGainLoss: 362.50,
        unrealizedGainLossPercent: 4.14
      },
      {
        symbol: 'NVDA',
        quantity: 25,
        averagePrice: 420.80,
        currentPrice: 445.60,
        marketValue: 11140.00,
        unrealizedGainLoss: 620.00,
        unrealizedGainLossPercent: 5.89
      }
    ];
    
    console.log(`📈 Retrieved positions for account: ${accountId}`);
    
    res.json({
      success: true,
      positions: mockPositions,
      message: 'Positions retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving positions:', error.message);
    res.status(500).json({ error: 'Failed to retrieve positions' });
  }
});

// Serve static files from React build
app.use(express.static(`${__dirname}/../react-client/dist`));

// Catch-all handler: send back React's index.html file for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../react-client/dist/index.html`));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}!`);
  console.log(`📊 SnapTrade API proxy endpoints available:`);
  console.log(`   POST /api/snaptrade/users`);
  console.log(`   POST /api/snaptrade/connection-portal`);
  console.log(`   GET  /api/snaptrade/accounts/:userId`);
  console.log(`   GET  /api/snaptrade/accounts/:accountId/positions`);
});
