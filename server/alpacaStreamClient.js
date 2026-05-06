/**
 * ALPACA WEBSOCKET STREAM CLIENT
 *
 * Real-time price streaming from Alpaca's data WebSocket.
 * Provides sub-second trade prices for stop-loss and trailing-stop exits.
 *
 * This is an additive safety net — if WS is down, everything degrades
 * gracefully to the existing REST polling behavior.
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const tradingModeManager = require('./tradingModeManager');

const STREAM_URL = 'wss://stream.data.alpaca.markets/v2/iex';

// Reconnect config
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 50;

// Heartbeat: if no message for 30s while we have active subs, reconnect
const HEARTBEAT_TIMEOUT_MS = 30000;

// Price is stale if older than 15 seconds
const STALE_THRESHOLD_MS = 15000;

class AlpacaStreamClient extends EventEmitter {
  constructor() {
    super();
    this._ws = null;
    this._authenticated = false;
    this._subscribedSymbols = new Set();
    this._priceCache = new Map(); // symbol -> {price, bid, ask, timestamp, receivedAt}
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._heartbeatTimer = null;
    this._intentionalClose = false;
    this._connecting = false;
  }

  /**
   * Connect to Alpaca's data WebSocket
   */
  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this._connecting) return;

    this._intentionalClose = false;
    this._connecting = true;

    let credentials;
    try {
      credentials = tradingModeManager.getCredentials();
    } catch (err) {
      console.error('[Alpaca Stream] Cannot connect — missing credentials:', err.message);
      this._connecting = false;
      return;
    }

    console.log('[Alpaca Stream] Connecting to', STREAM_URL);

    try {
      this._ws = new WebSocket(STREAM_URL);
    } catch (err) {
      console.error('[Alpaca Stream] WebSocket creation failed:', err.message);
      this._connecting = false;
      this._scheduleReconnect();
      return;
    }

    this._ws.on('open', () => {
      console.log('[Alpaca Stream] WebSocket opened, authenticating...');
      this._connecting = false;
      this._send({ action: 'auth', key: credentials.apiKey, secret: credentials.secretKey });
    });

    this._ws.on('message', (raw) => {
      this._resetHeartbeat();
      try {
        const messages = JSON.parse(raw);
        if (!Array.isArray(messages)) return;
        for (const msg of messages) {
          this._handleMessage(msg);
        }
      } catch (err) {
        console.error('[Alpaca Stream] Parse error:', err.message);
      }
    });

    this._ws.on('error', (err) => {
      console.error('[Alpaca Stream] WebSocket error:', err.message);
      this._connecting = false;
      this.emit('error', err);
    });

    this._ws.on('close', (code, reason) => {
      this._connecting = false;
      this._authenticated = false;
      this._clearHeartbeat();
      const reasonStr = reason ? reason.toString() : 'unknown';
      console.log(`[Alpaca Stream] Disconnected (code=${code}, reason=${reasonStr})`);
      this.emit('disconnected', { code, reason: reasonStr });

      if (!this._intentionalClose) {
        this._scheduleReconnect();
      }
    });
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect() {
    this._intentionalClose = true;
    this._clearReconnect();
    this._clearHeartbeat();
    this._authenticated = false;

    if (this._ws) {
      try {
        this._ws.close(1000, 'Client disconnect');
      } catch (e) {
        // Ignore close errors
      }
      this._ws = null;
    }

    console.log('[Alpaca Stream] Disconnected (intentional)');
  }

  /**
   * Subscribe to trade updates for symbols
   * @param {string[]} symbols - Array of ticker symbols
   */
  subscribe(symbols) {
    if (!symbols || symbols.length === 0) return;

    const newSymbols = symbols.filter(s => !this._subscribedSymbols.has(s));
    if (newSymbols.length === 0) return;

    for (const s of newSymbols) {
      this._subscribedSymbols.add(s);
    }

    if (this._authenticated) {
      this._send({ action: 'subscribe', trades: newSymbols });
      console.log(`[Alpaca Stream] Subscribing to trades: ${newSymbols.join(', ')}`);
    }
  }

  /**
   * Unsubscribe from trade updates for symbols
   * @param {string[]} symbols - Array of ticker symbols
   */
  unsubscribe(symbols) {
    if (!symbols || symbols.length === 0) return;

    const toRemove = symbols.filter(s => this._subscribedSymbols.has(s));
    if (toRemove.length === 0) return;

    for (const s of toRemove) {
      this._subscribedSymbols.delete(s);
      this._priceCache.delete(s);
    }

    if (this._authenticated) {
      this._send({ action: 'unsubscribe', trades: toRemove });
      console.log(`[Alpaca Stream] Unsubscribing from trades: ${toRemove.join(', ')}`);
    }
  }

  /**
   * Get latest price for a symbol from the WS cache
   * @param {string} symbol
   * @returns {{price: number, timestamp: string, age: number, isStale: boolean}|null}
   */
  getLatestPrice(symbol) {
    const cached = this._priceCache.get(symbol);
    if (!cached) return null;

    const age = Date.now() - cached.receivedAt;
    return {
      price: cached.price,
      timestamp: cached.timestamp,
      age,
      isStale: age > STALE_THRESHOLD_MS,
    };
  }

  /**
   * Check if WebSocket is connected and authenticated
   */
  isConnected() {
    return this._ws !== null &&
      this._ws.readyState === WebSocket.OPEN &&
      this._authenticated;
  }

  /**
   * Get connection status summary
   */
  getStatus() {
    return {
      connected: this.isConnected(),
      authenticated: this._authenticated,
      readyState: this._ws ? this._ws.readyState : -1,
      subscribedSymbols: Array.from(this._subscribedSymbols),
      cachedPrices: this._priceCache.size,
      reconnectAttempts: this._reconnectAttempts,
    };
  }

  // --- Internal Methods ---

  _handleMessage(msg) {
    const type = msg.T;

    switch (type) {
      case 'success':
        if (msg.msg === 'connected') {
          console.log('[Alpaca Stream] Connected to server');
        } else if (msg.msg === 'authenticated') {
          console.log('[Alpaca Stream] Authenticated successfully');
          this._authenticated = true;
          this._reconnectAttempts = 0;
          this.emit('authenticated');
          // Re-subscribe to any symbols we were tracking
          if (this._subscribedSymbols.size > 0) {
            const symbols = Array.from(this._subscribedSymbols);
            this._send({ action: 'subscribe', trades: symbols });
            console.log(`[Alpaca Stream] Re-subscribing to: ${symbols.join(', ')}`);
          }
        }
        break;

      case 'error':
        console.error(`[Alpaca Stream] Server error: ${msg.msg} (code=${msg.code})`);
        this.emit('error', new Error(msg.msg));
        // Auth failures: don't reconnect
        if (msg.code === 402 || msg.code === 406) {
          this._intentionalClose = true;
        }
        break;

      case 'subscription':
        console.log(`[Alpaca Stream] Subscription confirmed — trades: [${(msg.trades || []).join(', ')}]`);
        break;

      case 't': // Trade
        this._handleTrade(msg);
        break;

      case 'q': // Quote (not subscribed, but handle if received)
        // Ignored — we only use trades for stop-loss checks
        break;

      case 'b': // Bar
        // Ignored — we use candles from Polygon
        break;

      default:
        // Unknown message type, ignore
        break;
    }
  }

  _handleTrade(msg) {
    const symbol = msg.S;
    const price = msg.p;
    const size = msg.s;
    const timestamp = msg.t;

    if (!symbol || typeof price !== 'number') return;

    // Update price cache
    this._priceCache.set(symbol, {
      price,
      size,
      timestamp,
      receivedAt: Date.now(),
    });

    // Emit trade event for fast-path exit checks
    this.emit('trade', { symbol, price, size, timestamp });
  }

  _send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    }
  }

  _scheduleReconnect() {
    this._clearReconnect();

    if (this._reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error(`[Alpaca Stream] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached. Giving up.`);
      return;
    }

    // Exponential backoff with jitter
    const baseDelay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts), RECONNECT_MAX_MS);
    const jitter = Math.random() * baseDelay * 0.3;
    const delay = Math.round(baseDelay + jitter);
    this._reconnectAttempts++;

    console.log(`[Alpaca Stream] Reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _resetHeartbeat() {
    this._clearHeartbeat();
    if (this._subscribedSymbols.size > 0) {
      this._heartbeatTimer = setTimeout(() => {
        console.warn('[Alpaca Stream] No messages for 30s — reconnecting');
        if (this._ws) {
          try { this._ws.close(4000, 'Heartbeat timeout'); } catch (e) { /* ignore */ }
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }
  }

  _clearHeartbeat() {
    if (this._heartbeatTimer) {
      clearTimeout(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}

// Singleton instance
const alpacaStream = new AlpacaStreamClient();

module.exports = alpacaStream;
