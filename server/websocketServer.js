/**
 * WebSocket Server for Real-Time Trading Updates
 *
 * Provides live price updates, AI decisions, position updates,
 * and trading alerts during market hours.
 */

const { Server } = require('socket.io');

// Store active connections by user
const userSockets = new Map();

// Store active trading sessions
const tradingSessions = new Map();

// Store price subscriptions
const priceSubscriptions = new Map();

let io = null;

/**
 * Initialize WebSocket server
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {Server} Socket.io server instance
 */
function initializeWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:8080'],
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', socket => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Handle user authentication/identification
    socket.on('authenticate', data => {
      const { userId } = data;
      if (userId) {
        socket.userId = userId;
        userSockets.set(userId, socket);
        console.log(`[WebSocket] User ${userId} authenticated`);
        socket.emit('authenticated', { success: true, userId });
      }
    });

    // Start live trading simulation
    socket.on('start_simulation', async data => {
      const { userId, config } = data;
      console.log(`[WebSocket] Starting simulation for user ${userId}`);

      // Store session info
      tradingSessions.set(userId, {
        socketId: socket.id,
        config,
        startTime: new Date(),
        status: 'running',
      });

      // Notify client
      socket.emit('simulation_started', {
        sessionId: `session_${userId}_${Date.now()}`,
        config,
        startTime: new Date().toISOString(),
      });

      // Start the AI trading engine (will be connected later)
      socket.emit('ai_status', {
        status: 'active',
        message: 'AI trading engine initialized',
      });
    });

    // Stop live trading simulation
    socket.on('stop_simulation', data => {
      const { userId } = data;
      console.log(`[WebSocket] Stopping simulation for user ${userId}`);

      const session = tradingSessions.get(userId);
      if (session) {
        session.status = 'stopped';
        tradingSessions.set(userId, session);
      }

      socket.emit('simulation_stopped', {
        userId,
        stopTime: new Date().toISOString(),
      });
    });

    // Pause simulation
    socket.on('pause_simulation', data => {
      const { userId } = data;
      const session = tradingSessions.get(userId);
      if (session) {
        session.status = 'paused';
        tradingSessions.set(userId, session);
        socket.emit('simulation_paused', { userId });
      }
    });

    // Resume simulation
    socket.on('resume_simulation', data => {
      const { userId } = data;
      const session = tradingSessions.get(userId);
      if (session) {
        session.status = 'running';
        tradingSessions.set(userId, session);
        socket.emit('simulation_resumed', { userId });
      }
    });

    // Subscribe to price updates for specific symbols
    socket.on('subscribe_prices', data => {
      const { symbols } = data;
      if (!Array.isArray(symbols)) return;

      symbols.forEach(symbol => {
        if (!priceSubscriptions.has(symbol)) {
          priceSubscriptions.set(symbol, new Set());
        }
        priceSubscriptions.get(symbol).add(socket.id);
      });

      console.log(
        `[WebSocket] ${socket.id} subscribed to: ${symbols.join(', ')}`
      );
    });

    // Unsubscribe from price updates
    socket.on('unsubscribe_prices', data => {
      const { symbols } = data;
      if (!Array.isArray(symbols)) return;

      symbols.forEach(symbol => {
        const subs = priceSubscriptions.get(symbol);
        if (subs) {
          subs.delete(socket.id);
          if (subs.size === 0) {
            priceSubscriptions.delete(symbol);
          }
        }
      });
    });

    // Manual trade override
    socket.on('manual_override', data => {
      const { userId, symbol, action, quantity } = data;
      console.log(
        `[WebSocket] Manual override: ${action} ${quantity} ${symbol} for ${userId}`
      );

      // Emit to AI engine to execute manual trade
      socket.emit('manual_trade_received', {
        userId,
        symbol,
        action,
        quantity,
        timestamp: new Date().toISOString(),
      });
    });

    // Update trading configuration
    socket.on('update_config', data => {
      const { userId, config } = data;
      const session = tradingSessions.get(userId);
      if (session) {
        session.config = { ...session.config, ...config };
        tradingSessions.set(userId, session);
        socket.emit('config_updated', { userId, config: session.config });
      }
    });

    // Request current positions
    socket.on('get_positions', data => {
      const { userId } = data;
      // This will be filled by the AI trading engine
      socket.emit('positions_requested', { userId });
    });

    // Request AI decision history
    socket.on('get_decisions', data => {
      const { userId, limit = 50 } = data;
      socket.emit('decisions_requested', { userId, limit });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);

      // Clean up user socket mapping
      for (const [userId, userSocket] of userSockets.entries()) {
        if (userSocket.id === socket.id) {
          userSockets.delete(userId);
          break;
        }
      }

      // Clean up price subscriptions
      for (const [, subs] of priceSubscriptions.entries()) {
        subs.delete(socket.id);
      }
    });

    // Handle errors
    socket.on('error', error => {
      console.error(`[WebSocket] Error for ${socket.id}:`, error);
    });
  });

  console.log('[WebSocket] Server initialized');
  return io;
}

/**
 * Broadcast price update to subscribed clients
 * @param {string} symbol - Stock symbol
 * @param {object} priceData - Price data
 */
function broadcastPriceUpdate(symbol, priceData) {
  if (!io) return;

  const subscribers = priceSubscriptions.get(symbol);
  if (!subscribers || subscribers.size === 0) return;

  const data = {
    symbol,
    price: priceData.price,
    change: priceData.change,
    changePercent: priceData.changePercent,
    volume: priceData.volume,
    timestamp: new Date().toISOString(),
  };

  subscribers.forEach(socketId => {
    io.to(socketId).emit('price_update', data);
  });
}

/**
 * Send AI decision to specific user
 * @param {string} userId - User ID
 * @param {object} decision - AI decision data
 */
function sendAIDecision(userId, decision) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('ai_decision', {
    symbol: decision.symbol,
    action: decision.action,
    confidence: decision.confidence,
    reasons: decision.reasons,
    indicators: decision.indicators,
    pattern: decision.pattern,
    riskLevel: decision.riskLevel,
    sessionId: decision.sessionId, // Include sessionId for filtering
    sessionName: decision.sessionName, // Include sessionName for display
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send position update to specific user
 * @param {string} userId - User ID
 * @param {object} position - Position data
 */
function sendPositionUpdate(userId, position) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('position_update', {
    symbol: position.symbol,
    quantity: position.quantity,
    averageCost: position.averageCost,
    currentPrice: position.currentPrice,
    marketValue: position.marketValue,
    unrealizedPnL: position.unrealizedPnL,
    unrealizedPnLPercent: position.unrealizedPnLPercent,
    status: position.status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send alert to specific user
 * @param {string} userId - User ID
 * @param {object} alert - Alert data
 */
function sendAlert(userId, alert) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('alert', {
    type: alert.type, // 'info', 'warning', 'error', 'success'
    title: alert.title,
    message: alert.message,
    severity: alert.severity, // 'low', 'medium', 'high', 'critical'
    actionRequired: alert.actionRequired || false,
    sessionId: alert.sessionId, // Include sessionId for filtering
    sessionName: alert.sessionName, // Include sessionName for display
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send trade execution notification
 * @param {string} userId - User ID
 * @param {object} trade - Trade data
 */
function sendTradeExecution(userId, trade) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('trade_executed', {
    tradeId: trade.tradeId,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    totalValue: trade.totalValue,
    pnl: trade.pnl, // Include profit/loss for sell announcements
    status: trade.status,
    sessionId: trade.sessionId, // Include sessionId for filtering
    sessionName: trade.sessionName,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast to all connected clients
 * @param {string} event - Event name
 * @param {object} data - Data to broadcast
 */
function broadcastToAll(event, data) {
  if (!io) return;
  io.emit(event, { ...data, timestamp: new Date().toISOString() });
}

/**
 * Send trading log entry to specific user (for verbose AI thinking display)
 * @param {string} userId - User ID
 * @param {object} logEntry - Log entry data
 */
function sendTradingLog(userId, logEntry) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('trading_log', {
    level: logEntry.level || 'INFO', // INFO, SIGNAL, INDICATOR, CONFIG, RISK, ERROR, EXEC, OUTCOME
    category: logEntry.category, // Entry analysis, exit analysis, indicators, etc.
    symbol: logEntry.symbol,
    message: logEntry.message,
    data: logEntry.data, // Additional structured data (indicators, reasons, etc.)
    sessionId: logEntry.sessionId,
    sessionName: logEntry.sessionName,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send daily performance summary
 * @param {string} userId - User ID
 * @param {object} summary - Performance summary
 */
function sendDailySummary(userId, summary) {
  if (!io) return;

  const socket = userSockets.get(userId);
  if (!socket) return;

  socket.emit('daily_summary', {
    totalTrades: summary.totalTrades,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    totalPnL: summary.totalPnL,
    totalPnLPercent: summary.totalPnLPercent,
    bestTrade: summary.bestTrade,
    worstTrade: summary.worstTrade,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get trading session status
 * @param {string} userId - User ID
 * @returns {object|null} Session info
 */
function getSessionStatus(userId) {
  return tradingSessions.get(userId) || null;
}

/**
 * Check if simulation is running for user
 * @param {string} userId - User ID
 * @returns {boolean}
 */
function isSimulationRunning(userId) {
  const session = tradingSessions.get(userId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Map} Active sessions
 */
function getActiveSessions() {
  const active = new Map();
  for (const [userId, session] of tradingSessions.entries()) {
    if (session.status === 'running' || session.status === 'paused') {
      active.set(userId, session);
    }
  }
  return active;
}

/**
 * Get WebSocket server instance
 * @returns {Server|null}
 */
function getIO() {
  return io;
}

module.exports = {
  initializeWebSocket,
  broadcastPriceUpdate,
  sendAIDecision,
  sendPositionUpdate,
  sendAlert,
  sendTradeExecution,
  sendTradingLog,
  broadcastToAll,
  sendDailySummary,
  getSessionStatus,
  isSimulationRunning,
  getActiveSessions,
  getIO,
};
