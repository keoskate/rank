const express = require('express');
const router = express.Router();

module.exports = function (deps) {
  const { alpacaClient, alpacaStream, tradingModeManager } = deps;

  // 18. Get Alpaca account info
  router.get('/api/alpaca/account', async (req, res) => {
    try {
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;
      const account = await alpacaClient.getAccount(tradingMode);
      res.json({
        success: true,
        account,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error('❌ Error fetching Alpaca account:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get PDT (Pattern Day Trade) status
  router.get('/api/alpaca/pdt-status', async (req, res) => {
    try {
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;
      const pdtStatus = await alpacaClient.getPDTStatus(tradingMode);
      res.json({
        success: true,
        ...pdtStatus,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error('❌ Error fetching PDT status:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get Portfolio History (equity and P&L over time)
  router.get('/api/alpaca/portfolio-history', async (req, res) => {
    try {
      const { mode, period, timeframe, date_start, date_end, extended_hours } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;

      const options = {};
      if (period) options.period = period;
      if (timeframe) options.timeframe = timeframe;
      if (date_start) options.date_start = date_start;
      if (date_end) options.date_end = date_end;
      if (extended_hours !== undefined) options.extended_hours = extended_hours === 'true';

      const history = await alpacaClient.getPortfolioHistory(options, tradingMode);
      res.json({
        success: true,
        ...history,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error('❌ Error fetching portfolio history:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 19. Get Alpaca positions
  router.get('/api/alpaca/positions', async (req, res) => {
    try {
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;
      const positions = await alpacaClient.getPositions(tradingMode);
      res.json({
        success: true,
        positions,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error('❌ Error fetching positions:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 20. Get Alpaca position for specific symbol
  router.get('/api/alpaca/positions/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;
      const position = await alpacaClient.getPosition(symbol, tradingMode);

      if (!position) {
        return res.json({
          success: true,
          position: null,
          message: 'No position found',
          mode: tradingMode || tradingModeManager.getCurrentMode(),
        });
      }

      res.json({
        success: true,
        position,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error(
        `❌ Error fetching position for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // 21. Place order on Alpaca
  router.post('/api/alpaca/orders', async (req, res) => {
    try {
      const {
        symbol,
        qty,
        side,
        type = 'market',
        time_in_force = 'day',
        limit_price,
        market_price,
      } = req.body;

      if (!symbol || !qty || !side) {
        return res
          .status(400)
          .json({ error: 'symbol, qty, and side are required' });
      }

      const orderParams = {
        symbol,
        qty,
        side,
        type,
        time_in_force,
      };

      if (type === 'limit' && limit_price) {
        orderParams.limit_price = limit_price;
      }

      // Add market_price for validation if provided
      if (market_price) {
        orderParams.market_price = market_price;
      }

      // Get account value for safety validation
      let accountValue = null;
      try {
        const account = await alpacaClient.getAccount();
        accountValue = parseFloat(account.portfolio_value);
      } catch (e) {
        console.warn('⚠️  Could not fetch account value for validation');
      }

      const order = await alpacaClient.placeOrder(orderParams, accountValue);
      res.json({ success: true, order });
    } catch (error) {
      console.error('❌ Error placing order:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 22. Get Alpaca orders (with P/L for sell orders)
  router.get('/api/alpaca/orders', async (req, res) => {
    try {
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;

      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.limit) filters.limit = req.query.limit;

      const orders = await alpacaClient.getOrders(filters, tradingMode);

      // Get recent trade activities to enrich sell orders with P/L
      // Activities contain per_share_profit for closed trades
      let activities = [];
      try {
        activities = await alpacaClient.getAccountActivities(
          {
            activity_types: 'FILL',
            page_size: 100,
          },
          tradingMode
        );
      } catch (err) {
        console.warn(
          'Could not fetch activities for P/L enrichment:',
          err.message
        );
      }

      // Create a map of order_id -> activity for quick lookup
      const activityByOrderId = {};
      if (Array.isArray(activities)) {
        activities.forEach(activity => {
          if (activity.order_id) {
            // Store the activity, keyed by order_id
            // Note: There may be multiple fills for a single order (partial fills)
            if (!activityByOrderId[activity.order_id]) {
              activityByOrderId[activity.order_id] = [];
            }
            activityByOrderId[activity.order_id].push(activity);
          }
        });
      }

      // Enrich orders with P/L data for filled sell orders
      const enrichedOrders = orders.map(order => {
        const enriched = { ...order };

        // For sell orders that are filled, calculate P/L from activities
        if (order.side === 'sell' && order.status === 'filled') {
          const fills = activityByOrderId[order.id];
          if (fills && fills.length > 0) {
            // Sum up P/L from all fills for this order
            let totalPnL = 0;
            let hasValidPnL = false;

            fills.forEach(fill => {
              // Alpaca activities may have per_share_profit or we calculate from price/cost_basis
              if (
                fill.per_share_profit !== undefined &&
                fill.per_share_profit !== null
              ) {
                const qty = parseFloat(fill.qty) || 0;
                totalPnL += parseFloat(fill.per_share_profit) * qty;
                hasValidPnL = true;
              } else if (fill.price && fill.cost_basis) {
                // Fallback: calculate from fill price - cost_basis
                const qty = parseFloat(fill.qty) || 0;
                const fillPrice = parseFloat(fill.price) || 0;
                const costBasisPerShare = parseFloat(fill.cost_basis) / qty;
                totalPnL += (fillPrice - costBasisPerShare) * qty;
                hasValidPnL = true;
              }
            });

            if (hasValidPnL) {
              enriched.pnl = totalPnL;
            }
          }
        }

        return enriched;
      });

      res.json({
        success: true,
        orders: enrichedOrders,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error('❌ Error fetching orders:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 23. Cancel order
  router.delete('/api/alpaca/orders/:orderId', async (req, res) => {
    try {
      const { orderId } = req.params;
      await alpacaClient.cancelOrder(orderId);
      res.json({ success: true, message: 'Order cancelled' });
    } catch (error) {
      console.error('❌ Error cancelling order:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // 24. Close position
  router.delete('/api/alpaca/positions/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      // Use mode from query param (paper or live) - passed directly to client without changing global state
      const { mode } = req.query;
      const tradingMode = mode === 'paper' || mode === 'live' ? mode : null;
      const result = await alpacaClient.closePosition(symbol, tradingMode);
      res.json({
        success: true,
        result,
        mode: tradingMode || tradingModeManager.getCurrentMode(),
      });
    } catch (error) {
      console.error(
        `❌ Error closing position ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // 25. Get latest quote from Alpaca
  router.get('/api/alpaca/quotes/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const quote = await alpacaClient.getLatestQuote(symbol);
      res.json({ success: true, quote });
    } catch (error) {
      console.error(
        `❌ Error fetching quote for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // 26. Get latest trade from Alpaca
  router.get('/api/alpaca/trades/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      const trade = await alpacaClient.getLatestTrade(symbol);
      res.json({ success: true, trade });
    } catch (error) {
      console.error(
        `❌ Error fetching trade for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // 26b. Get historical bars from Alpaca (alternative to Polygon)
  // Alpaca includes pre-calculated VWAP in bar data
  router.get('/api/alpaca/bars/:symbol/:timeframe', async (req, res) => {
    try {
      const { symbol, timeframe } = req.params;
      const { from, to, limit } = req.query;

      // Map timeframe to Alpaca format
      const timeframeMap = {
        1: '1Min',
        5: '5Min',
        15: '15Min',
        30: '30Min',
        60: '1Hour',
        hour: '1Hour',
        day: '1Day',
        '1Day': '1Day',
      };

      const alpacaTimeframe = timeframeMap[timeframe] || timeframe;

      console.log(
        `📊 Fetching Alpaca bars for ${symbol} (${alpacaTimeframe}) from ${from} to ${to}`
      );

      const bars = await alpacaClient.getBars(
        symbol,
        alpacaTimeframe,
        from,
        to,
        limit ? parseInt(limit) : 10000
      );

      // Transform to match Polygon format for easy switching
      const results = bars.map(bar => ({
        t: new Date(bar.timestamp).getTime(),
        o: bar.open,
        h: bar.high,
        l: bar.low,
        c: bar.close,
        v: bar.volume,
        vw: bar.vwap, // Alpaca provides pre-calculated VWAP!
        n: bar.tradeCount,
        // Also provide full property names
        time: new Date(bar.timestamp).getTime(),
        timestamp: new Date(bar.timestamp).getTime(),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        vwap: bar.vwap,
      }));

      res.json({
        success: true,
        ticker: symbol,
        queryCount: results.length,
        resultsCount: results.length,
        results,
        source: 'alpaca',
      });
    } catch (error) {
      console.error(
        `❌ Error fetching Alpaca bars for ${req.params.symbol}:`,
        error.message
      );
      res.status(500).json({ error: error.message });
    }
  });

  // Alpaca WebSocket stream status
  router.get('/api/alpaca/stream/status', (req, res) => {
    const status = alpacaStream.getStatus();
    res.json(status);
  });

  return router;
};
