const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { paperTradingPortfolios, getCurrentStockPrice } = deps;

  // 7. Create or get paper trading portfolio
  router.post('/api/paper-trading/portfolio', async (req, res) => {
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
          message: 'Paper trading portfolio retrieved',
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
        lastUpdated: new Date().toISOString(),
      };

      paperTradingPortfolios.set(userId, newPortfolio);

      console.log(
        `💰 Created paper trading portfolio for user: ${userId} with $${initialCash}`
      );

      res.json({
        success: true,
        portfolio: {
          ...newPortfolio,
          positions: Array.from(newPortfolio.positions.entries()).map(
            ([symbol, position]) => ({
              symbol,
              ...position,
            })
          ),
        },
        message: 'Paper trading portfolio created successfully',
      });
    } catch (error) {
      console.error('❌ Error creating paper trading portfolio:', error.message);
      res.status(500).json({ error: 'Failed to create paper trading portfolio' });
    }
  });

  // 8. Execute paper trading order
  router.post('/api/paper-trading/order', async (req, res) => {
    try {
      const {
        userId,
        symbol,
        side,
        quantity,
        orderType = 'market',
        limitPrice = null,
      } = req.body;

      if (!userId || !symbol || !side || !quantity) {
        return res
          .status(400)
          .json({ error: 'userId, symbol, side, and quantity are required' });
      }

      if (!['buy', 'sell'].includes(side)) {
        return res.status(400).json({ error: 'side must be "buy" or "sell"' });
      }

      if (!['market', 'limit'].includes(orderType)) {
        return res
          .status(400)
          .json({ error: 'orderType must be "market" or "limit"' });
      }

      // Get portfolio
      const portfolio = paperTradingPortfolios.get(userId);
      if (!portfolio) {
        return res.status(404).json({
          error: 'Paper trading portfolio not found. Create one first.',
        });
      }

      // Get current stock price
      const currentPrice = await getCurrentStockPrice(symbol);
      if (!currentPrice) {
        return res
          .status(400)
          .json({ error: 'Unable to get current price for symbol' });
      }

      // Determine execution price
      let executionPrice = currentPrice;
      if (orderType === 'limit') {
        if (!limitPrice) {
          return res
            .status(400)
            .json({ error: 'limitPrice is required for limit orders' });
        }

        // For demo, assume limit orders execute if price is favorable
        if (side === 'buy' && limitPrice < currentPrice) {
          return res.status(400).json({
            error:
              'Limit buy price is below current market price. Order not executed.',
          });
        }
        if (side === 'sell' && limitPrice > currentPrice) {
          return res.status(400).json({
            error:
              'Limit sell price is above current market price. Order not executed.',
          });
        }

        executionPrice = limitPrice;
      }

      const totalValue = executionPrice * quantity;
      const position = portfolio.positions.get(symbol) || {
        quantity: 0,
        averagePrice: 0,
        totalCost: 0,
      };

      // Execute order
      if (side === 'buy') {
        // Check if enough cash
        if (portfolio.cash < totalValue) {
          return res
            .status(400)
            .json({ error: 'Insufficient cash for purchase' });
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
          unrealizedGainLoss: newQuantity * currentPrice - newTotalCost,
          unrealizedGainLossPercent:
            ((newQuantity * currentPrice - newTotalCost) / newTotalCost) * 100,
        });
      } else {
        // sell
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
            unrealizedGainLoss: newQuantity * currentPrice - newTotalCost,
            unrealizedGainLossPercent:
              newTotalCost > 0
                ? ((newQuantity * currentPrice - newTotalCost) / newTotalCost) *
                  100
                : 0,
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
        status: 'filled',
      };

      portfolio.trades.push(trade);
      portfolio.lastUpdated = new Date().toISOString();

      console.log(
        `📋 Executed paper trade: ${side.toUpperCase()} ${quantity} ${symbol} @ $${executionPrice}`
      );

      res.json({
        success: true,
        trade: trade,
        portfolio: {
          ...portfolio,
          positions: Array.from(portfolio.positions.entries()).map(
            ([sym, pos]) => ({
              symbol: sym,
              ...pos,
            })
          ),
        },
        message: 'Paper trade executed successfully',
      });
    } catch (error) {
      console.error('❌ Error executing paper trading order:', error.message);
      res.status(500).json({ error: 'Failed to execute paper trading order' });
    }
  });

  // 9. Get paper trading portfolio status
  router.get('/api/paper-trading/portfolio/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const portfolio = paperTradingPortfolios.get(userId);
      if (!portfolio) {
        return res
          .status(404)
          .json({ error: 'Paper trading portfolio not found' });
      }

      // Update current market values for all positions
      const updatedPositions = [];
      let totalMarketValue = 0;

      for (const [symbol, position] of portfolio.positions) {
        const currentPrice = await getCurrentStockPrice(symbol);
        const marketValue = position.quantity * currentPrice;
        const unrealizedGainLoss = marketValue - position.totalCost;
        const unrealizedGainLossPercent =
          position.totalCost > 0
            ? (unrealizedGainLoss / position.totalCost) * 100
            : 0;

        const updatedPosition = {
          symbol: symbol,
          quantity: position.quantity,
          averagePrice: position.averagePrice,
          totalCost: position.totalCost,
          currentPrice: currentPrice,
          marketValue: marketValue,
          unrealizedGainLoss: unrealizedGainLoss,
          unrealizedGainLossPercent: unrealizedGainLossPercent,
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
          lastUpdated: new Date().toISOString(),
        },
        message: 'Paper trading portfolio retrieved successfully',
      });
    } catch (error) {
      console.error(
        '❌ Error retrieving paper trading portfolio:',
        error.message
      );
      res
        .status(500)
        .json({ error: 'Failed to retrieve paper trading portfolio' });
    }
  });

  // 10. Reset paper trading portfolio
  router.post('/api/paper-trading/portfolio/:userId/reset', async (req, res) => {
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
        lastUpdated: new Date().toISOString(),
      };

      paperTradingPortfolios.set(userId, newPortfolio);

      console.log(`🔄 Reset paper trading portfolio for user: ${userId}`);

      res.json({
        success: true,
        portfolio: {
          ...newPortfolio,
          positions: [],
        },
        message: 'Paper trading portfolio reset successfully',
      });
    } catch (error) {
      console.error('❌ Error resetting paper trading portfolio:', error.message);
      res.status(500).json({ error: 'Failed to reset paper trading portfolio' });
    }
  });

  return router;
};
