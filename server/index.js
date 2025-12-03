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
const snapshotManager = require('./snapshotManager');

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

// 5. Get recent trades for an account
app.get('/api/snaptrade/accounts/:accountId/trades', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { userId, userSecret, limit = 10 } = req.query;
    
    if (!userId || !userSecret) {
      return res.status(400).json({ error: 'userId and userSecret are required' });
    }

    // For demo purposes, return mock recent trades data
    const mockTrades = [
      {
        id: 'trade_001',
        symbol: 'NVDA',
        side: 'buy',
        quantity: 10,
        price: 445.60,
        totalValue: 4456.00,
        fee: 0.00,
        executedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
        status: 'filled',
        orderType: 'market'
      },
      {
        id: 'trade_002',
        symbol: 'AAPL',
        side: 'buy',
        quantity: 25,
        price: 182.45,
        totalValue: 4561.25,
        fee: 0.00,
        executedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        status: 'filled',
        orderType: 'market'
      },
      {
        id: 'trade_003',
        symbol: 'TSLA',
        side: 'sell',
        quantity: 15,
        price: 248.50,
        totalValue: 3727.50,
        fee: 0.00,
        executedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
        status: 'filled',
        orderType: 'limit'
      },
      {
        id: 'trade_004',
        symbol: 'MSFT',
        side: 'buy',
        quantity: 20,
        price: 425.30,
        totalValue: 8506.00,
        fee: 0.00,
        executedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        status: 'filled',
        orderType: 'market'
      },
      {
        id: 'trade_005',
        symbol: 'GOOGL',
        side: 'buy',
        quantity: 8,
        price: 178.20,
        totalValue: 1425.60,
        fee: 0.00,
        executedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago
        status: 'filled',
        orderType: 'market'
      },
      {
        id: 'trade_006',
        symbol: 'AMZN',
        side: 'sell',
        quantity: 12,
        price: 186.40,
        totalValue: 2236.80,
        fee: 0.00,
        executedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
        status: 'filled',
        orderType: 'limit'
      }
    ];

    // Apply limit
    const limitedTrades = mockTrades.slice(0, parseInt(limit));
    
    console.log(`💹 Retrieved ${limitedTrades.length} trades for account: ${accountId}`);
    
    res.json({
      success: true,
      trades: limitedTrades,
      totalTrades: mockTrades.length,
      message: 'Trades retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving trades:', error.message);
    res.status(500).json({ error: 'Failed to retrieve trades' });
  }
});

// 6. Get trade analytics/summary
app.get('/api/snaptrade/accounts/:accountId/trade-summary', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { userId, userSecret, period = '30d' } = req.query;
    
    if (!userId || !userSecret) {
      return res.status(400).json({ error: 'userId and userSecret are required' });
    }

    // For demo purposes, return mock trade summary data
    const mockSummary = {
      period: period,
      totalTrades: 6,
      buyTrades: 4,
      sellTrades: 2,
      totalVolume: 24913.15,
      totalFees: 0.00,
      netCashFlow: -17446.55, // More buys than sells
      averageTradeSize: 4152.19,
      largestTrade: {
        symbol: 'MSFT',
        value: 8506.00,
        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      },
      topSymbols: [
        { symbol: 'MSFT', trades: 1, volume: 8506.00 },
        { symbol: 'NVDA', trades: 1, volume: 4456.00 },
        { symbol: 'AAPL', trades: 1, volume: 4561.25 },
        { symbol: 'TSLA', trades: 1, volume: 3727.50 },
        { symbol: 'AMZN', trades: 1, volume: 2236.80 }
      ],
      dailyActivity: [
        { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 4456.00 },
        { date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 4561.25 },
        { date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 3727.50 },
        { date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 8506.00 },
        { date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 1425.60 },
        { date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], trades: 1, volume: 2236.80 }
      ]
    };
    
    console.log(`📊 Retrieved trade summary for account: ${accountId}`);
    
    res.json({
      success: true,
      summary: mockSummary,
      message: 'Trade summary retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving trade summary:', error.message);
    res.status(500).json({ error: 'Failed to retrieve trade summary' });
  }
});

// ================================
// PAPER TRADING SIMULATION SYSTEM
// ================================

// In-memory paper trading portfolios (in production, use database)
const paperTradingPortfolios = new Map();

// Helper function to get current stock price (integrates with existing APIs)
async function getCurrentStockPrice(symbol) {
  try {
    // In a real implementation, this would call your existing stock API
    // For demo, return realistic but mock prices
    const mockPrices = {
      'AAPL': 182.45,
      'NVDA': 445.60,
      'TSLA': 248.50,
      'MSFT': 425.30,
      'GOOGL': 178.20,
      'AMZN': 186.40,
      'META': 520.80,
      'AMD': 158.90,
      'NFLX': 445.20,
      'UBER': 65.80
    };
    
    return mockPrices[symbol] || 100.00 + Math.random() * 200; // Random price for unknown symbols
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

// 7. Create or get paper trading portfolio
app.post('/api/paper-trading/portfolio', async (req, res) => {
  try {
    const { userId, initialCash = 100000 } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Check if portfolio already exists
    if (paperTradingPortfolios.has(userId)) {
      return res.json({
        success: true,
        portfolio: paperTradingPortfolios.get(userId),
        message: 'Paper trading portfolio retrieved'
      });
    }

    // Create new paper trading portfolio
    const newPortfolio = {
      userId: userId,
      cash: parseFloat(initialCash),
      initialCash: parseFloat(initialCash),
      positions: new Map(),
      trades: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    paperTradingPortfolios.set(userId, newPortfolio);
    
    console.log(`💰 Created paper trading portfolio for user: ${userId} with $${initialCash}`);
    
    res.json({
      success: true,
      portfolio: {
        ...newPortfolio,
        positions: Array.from(newPortfolio.positions.entries()).map(([symbol, position]) => ({
          symbol,
          ...position
        }))
      },
      message: 'Paper trading portfolio created successfully'
    });
  } catch (error) {
    console.error('❌ Error creating paper trading portfolio:', error.message);
    res.status(500).json({ error: 'Failed to create paper trading portfolio' });
  }
});

// 8. Execute paper trading order
app.post('/api/paper-trading/order', async (req, res) => {
  try {
    const { userId, symbol, side, quantity, orderType = 'market', limitPrice = null } = req.body;
    
    if (!userId || !symbol || !side || !quantity) {
      return res.status(400).json({ error: 'userId, symbol, side, and quantity are required' });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: 'side must be "buy" or "sell"' });
    }

    if (!['market', 'limit'].includes(orderType)) {
      return res.status(400).json({ error: 'orderType must be "market" or "limit"' });
    }

    // Get portfolio
    const portfolio = paperTradingPortfolios.get(userId);
    if (!portfolio) {
      return res.status(404).json({ error: 'Paper trading portfolio not found. Create one first.' });
    }

    // Get current stock price
    const currentPrice = await getCurrentStockPrice(symbol);
    if (!currentPrice) {
      return res.status(400).json({ error: 'Unable to get current price for symbol' });
    }

    // Determine execution price
    let executionPrice = currentPrice;
    if (orderType === 'limit') {
      if (!limitPrice) {
        return res.status(400).json({ error: 'limitPrice is required for limit orders' });
      }
      
      // For demo, assume limit orders execute if price is favorable
      if (side === 'buy' && limitPrice < currentPrice) {
        return res.status(400).json({ error: 'Limit buy price is below current market price. Order not executed.' });
      }
      if (side === 'sell' && limitPrice > currentPrice) {
        return res.status(400).json({ error: 'Limit sell price is above current market price. Order not executed.' });
      }
      
      executionPrice = limitPrice;
    }

    const totalValue = executionPrice * quantity;
    const position = portfolio.positions.get(symbol) || { quantity: 0, averagePrice: 0, totalCost: 0 };

    // Execute order
    if (side === 'buy') {
      // Check if enough cash
      if (portfolio.cash < totalValue) {
        return res.status(400).json({ error: 'Insufficient cash for purchase' });
      }

      // Update cash
      portfolio.cash -= totalValue;

      // Update position
      const newTotalCost = position.totalCost + totalValue;
      const newQuantity = position.quantity + quantity;
      const newAveragePrice = newTotalCost / newQuantity;

      portfolio.positions.set(symbol, {
        quantity: newQuantity,
        averagePrice: newAveragePrice,
        totalCost: newTotalCost,
        currentPrice: currentPrice,
        marketValue: newQuantity * currentPrice,
        unrealizedGainLoss: (newQuantity * currentPrice) - newTotalCost,
        unrealizedGainLossPercent: ((newQuantity * currentPrice) - newTotalCost) / newTotalCost * 100
      });

    } else { // sell
      // Check if enough shares
      if (position.quantity < quantity) {
        return res.status(400).json({ error: 'Insufficient shares to sell' });
      }

      // Update cash
      portfolio.cash += totalValue;

      // Update position
      const newQuantity = position.quantity - quantity;
      if (newQuantity === 0) {
        portfolio.positions.delete(symbol);
      } else {
        const soldCost = (position.totalCost / position.quantity) * quantity;
        const newTotalCost = position.totalCost - soldCost;
        
        portfolio.positions.set(symbol, {
          quantity: newQuantity,
          averagePrice: position.averagePrice, // Keep same average price
          totalCost: newTotalCost,
          currentPrice: currentPrice,
          marketValue: newQuantity * currentPrice,
          unrealizedGainLoss: (newQuantity * currentPrice) - newTotalCost,
          unrealizedGainLossPercent: newTotalCost > 0 ? ((newQuantity * currentPrice) - newTotalCost) / newTotalCost * 100 : 0
        });
      }
    }

    // Record trade
    const trade = {
      id: `paper_trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: symbol,
      side: side,
      quantity: quantity,
      price: executionPrice,
      totalValue: totalValue,
      orderType: orderType,
      limitPrice: limitPrice,
      executedAt: new Date().toISOString(),
      status: 'filled'
    };

    portfolio.trades.push(trade);
    portfolio.lastUpdated = new Date().toISOString();

    console.log(`📋 Executed paper trade: ${side.toUpperCase()} ${quantity} ${symbol} @ $${executionPrice}`);

    res.json({
      success: true,
      trade: trade,
      portfolio: {
        ...portfolio,
        positions: Array.from(portfolio.positions.entries()).map(([sym, pos]) => ({
          symbol: sym,
          ...pos
        }))
      },
      message: 'Paper trade executed successfully'
    });

  } catch (error) {
    console.error('❌ Error executing paper trading order:', error.message);
    res.status(500).json({ error: 'Failed to execute paper trading order' });
  }
});

// 9. Get paper trading portfolio status
app.get('/api/paper-trading/portfolio/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const portfolio = paperTradingPortfolios.get(userId);
    if (!portfolio) {
      return res.status(404).json({ error: 'Paper trading portfolio not found' });
    }

    // Update current market values for all positions
    const updatedPositions = [];
    let totalMarketValue = 0;

    for (const [symbol, position] of portfolio.positions) {
      const currentPrice = await getCurrentStockPrice(symbol);
      const marketValue = position.quantity * currentPrice;
      const unrealizedGainLoss = marketValue - position.totalCost;
      const unrealizedGainLossPercent = position.totalCost > 0 ? (unrealizedGainLoss / position.totalCost * 100) : 0;

      const updatedPosition = {
        symbol: symbol,
        quantity: position.quantity,
        averagePrice: position.averagePrice,
        totalCost: position.totalCost,
        currentPrice: currentPrice,
        marketValue: marketValue,
        unrealizedGainLoss: unrealizedGainLoss,
        unrealizedGainLossPercent: unrealizedGainLossPercent
      };

      updatedPositions.push(updatedPosition);
      totalMarketValue += marketValue;

      // Update the stored position with current values
      portfolio.positions.set(symbol, updatedPosition);
    }

    const totalPortfolioValue = portfolio.cash + totalMarketValue;
    const totalGainLoss = totalPortfolioValue - portfolio.initialCash;
    const totalGainLossPercent = (totalGainLoss / portfolio.initialCash) * 100;

    console.log(`📊 Retrieved paper trading portfolio for user: ${userId}`);

    res.json({
      success: true,
      portfolio: {
        userId: portfolio.userId,
        cash: portfolio.cash,
        initialCash: portfolio.initialCash,
        totalMarketValue: totalMarketValue,
        totalPortfolioValue: totalPortfolioValue,
        totalGainLoss: totalGainLoss,
        totalGainLossPercent: totalGainLossPercent,
        positions: updatedPositions,
        trades: portfolio.trades,
        createdAt: portfolio.createdAt,
        lastUpdated: new Date().toISOString()
      },
      message: 'Paper trading portfolio retrieved successfully'
    });

  } catch (error) {
    console.error('❌ Error retrieving paper trading portfolio:', error.message);
    res.status(500).json({ error: 'Failed to retrieve paper trading portfolio' });
  }
});

// 10. Reset paper trading portfolio
app.post('/api/paper-trading/portfolio/:userId/reset', async (req, res) => {
  try {
    const { userId } = req.params;
    const { initialCash = 100000 } = req.body;

    const newPortfolio = {
      userId: userId,
      cash: parseFloat(initialCash),
      initialCash: parseFloat(initialCash),
      positions: new Map(),
      trades: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };

    paperTradingPortfolios.set(userId, newPortfolio);

    console.log(`🔄 Reset paper trading portfolio for user: ${userId}`);

    res.json({
      success: true,
      portfolio: {
        ...newPortfolio,
        positions: []
      },
      message: 'Paper trading portfolio reset successfully'
    });
  } catch (error) {
    console.error('❌ Error resetting paper trading portfolio:', error.message);
    res.status(500).json({ error: 'Failed to reset paper trading portfolio' });
  }
});

// ================================
// SNAPSHOT & BACKTESTING ENDPOINTS
// ================================

// 11. Get available snapshot dates
app.get('/api/snapshots/dates', async (req, res) => {
  try {
    const dates = await snapshotManager.getAvailableSnapshots();
    res.json({
      success: true,
      dates,
      count: dates.length,
      message: 'Snapshot dates retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot dates:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot dates' });
  }
});

// 12. Get snapshot for specific date
app.get('/api/snapshots/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const snapshot = await snapshotManager.loadSnapshot(date);

    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found for specified date' });
    }

    res.json({
      success: true,
      snapshot,
      message: 'Snapshot retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot' });
  }
});

// 13. Get snapshot range
app.get('/api/snapshots/range/:startDate/:endDate', async (req, res) => {
  try {
    const { startDate, endDate } = req.params;
    const snapshots = await snapshotManager.loadSnapshotRange(startDate, endDate);

    res.json({
      success: true,
      snapshots,
      count: snapshots.length,
      startDate,
      endDate,
      message: 'Snapshot range retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving snapshot range:', error.message);
    res.status(500).json({ error: 'Failed to retrieve snapshot range' });
  }
});

// 14. Generate synthetic historical snapshots
app.post('/api/snapshots/generate-history', async (req, res) => {
  try {
    const { stocks, days = 90, stockListName = 'Default' } = req.body;

    if (!stocks || !Array.isArray(stocks)) {
      return res.status(400).json({ error: 'stocks array is required' });
    }

    const snapshots = await snapshotManager.generateSyntheticHistory(stocks, days, stockListName);

    res.json({
      success: true,
      snapshotsGenerated: snapshots.length,
      days,
      message: 'Synthetic historical snapshots generated successfully'
    });
  } catch (error) {
    console.error('❌ Error generating synthetic history:', error.message);
    res.status(500).json({ error: 'Failed to generate synthetic history' });
  }
});

// 15. Get quarterly data for a stock
app.get('/api/quarterly/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await snapshotManager.loadQuarterlyData(symbol);

    if (!data) {
      return res.status(404).json({ error: 'Quarterly data not found for symbol' });
    }

    res.json({
      success: true,
      data,
      message: 'Quarterly data retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error retrieving quarterly data:', error.message);
    res.status(500).json({ error: 'Failed to retrieve quarterly data' });
  }
});

// 16. Calculate QoQ for a stock metric
app.get('/api/quarterly/:symbol/qoq/:metric', async (req, res) => {
  try {
    const { symbol, metric } = req.params;
    const qoq = await snapshotManager.calculateQoQ(symbol, metric);

    if (!qoq) {
      return res.status(404).json({ error: 'QoQ data not available' });
    }

    res.json({
      success: true,
      qoq,
      message: 'QoQ calculation retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error calculating QoQ:', error.message);
    res.status(500).json({ error: 'Failed to calculate QoQ' });
  }
});

// 17. Calculate YoY for a stock metric
app.get('/api/quarterly/:symbol/yoy/:metric', async (req, res) => {
  try {
    const { symbol, metric } = req.params;
    const yoy = await snapshotManager.calculateYoY(symbol, metric);

    if (!yoy) {
      return res.status(404).json({ error: 'YoY data not available' });
    }

    res.json({
      success: true,
      yoy,
      message: 'YoY calculation retrieved successfully'
    });
  } catch (error) {
    console.error('❌ Error calculating YoY:', error.message);
    res.status(500).json({ error: 'Failed to calculate YoY' });
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
  console.log(`   GET  /api/snaptrade/accounts/:accountId/trades`);
  console.log(`   GET  /api/snaptrade/accounts/:accountId/trade-summary`);
  console.log(`💰 Paper Trading Simulation endpoints available:`);
  console.log(`   POST /api/paper-trading/portfolio`);
  console.log(`   POST /api/paper-trading/order`);
  console.log(`   GET  /api/paper-trading/portfolio/:userId`);
  console.log(`   POST /api/paper-trading/portfolio/:userId/reset`);
  console.log(`📸 Snapshot & Backtesting endpoints available:`);
  console.log(`   GET  /api/snapshots/dates`);
  console.log(`   GET  /api/snapshots/:date`);
  console.log(`   GET  /api/snapshots/range/:startDate/:endDate`);
  console.log(`   POST /api/snapshots/generate-history`);
  console.log(`   GET  /api/quarterly/:symbol`);
  console.log(`   GET  /api/quarterly/:symbol/qoq/:metric`);
  console.log(`   GET  /api/quarterly/:symbol/yoy/:metric`);
});
