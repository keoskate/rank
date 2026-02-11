# AI Trading System - Complete Reference Guide

> **Last Updated:** February 2025
> **Purpose:** One-stop reference for understanding, debugging, and improving the automated trading system

---

## Quick Start Commands

```bash
# Start the server
npm run server-dev

# Check running sessions
curl -s "http://localhost:8080/api/ai/sessions/default_user" | jq '.sessions[] | select(.status == "running") | {name: .name, watchlist: .config.watchlist}'

# Check recent logs
tail -100 server.log | grep -E "(AI Engine|BUY|SELL|EXIT|ERROR)"

# Check Alpaca account
curl -s "http://localhost:8080/api/alpaca/account" | jq '{cash: .cash, portfolio_value: .portfolio_value, buying_power: .buying_power}'

# Check open positions
curl -s "http://localhost:8080/api/alpaca/positions" | jq '.[] | {symbol: .symbol, qty: .qty, unrealized_pl: .unrealized_pl}'

# Check recent orders
curl -s "http://localhost:8080/api/alpaca/orders?status=all&limit=20" | jq '.[] | {symbol: .symbol, side: .side, status: .status, filled_avg_price: .filled_avg_price}'
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  react-client/src/Components/pages/LiveTradingDashboard.jsx     │
└─────────────────────────────────────────────────────────────────┘
                              │ WebSocket + REST API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express Server (server/index.js)             │
│  - REST API endpoints (/api/ai/*, /api/alpaca/*)                │
│  - WebSocket for real-time updates                               │
│  - Serves React frontend                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ aiTradingEngine │ │ semiconductorSen│ │   Alpaca API    │
│    .js          │ │   timent.js     │ │ (Paper Trading) │
│                 │ │                 │ │                 │
│ - Trading loop  │ │ - SOXX analysis │ │ - Orders        │
│ - Entry/Exit    │ │ - Market gate   │ │ - Positions     │
│ - Risk mgmt     │ │ - Bull/Bear     │ │ - Account       │
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  data/ai-sessions.json                           │
│  - Session configs, portfolios, stats, trade logs               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `server/index.js` | Main Express server, all API routes |
| `server/aiTradingEngine.js` | **Core trading logic** - entry/exit decisions, order execution |
| `server/semiconductorSentiment.js` | SOXX-based sentiment analysis for SOXL/SOXS |
| `data/ai-sessions.json` | **Session persistence** - all configs, positions, stats |
| `react-client/src/Components/pages/LiveTradingDashboard.jsx` | Trading UI |
| `react-client/src/Components/trading/TradingSessionSummary.jsx` | Session stats modal |

---

## Session Configuration Reference

### Full Config Object

```javascript
{
  // Identity
  name: 'SOXL Bullish Momentum',
  assetType: 'stocks',           // 'stocks' or 'crypto'
  watchlist: ['SOXL'],           // Tickers to trade

  // Entry Strategy
  entryStrategy: 'dip',          // 'dip' (buy pullbacks) or 'momentum' (chase breakouts)
  minSignalsRequired: 2,         // How many signals needed to enter (1-5)
  rsiOversold: 35,               // RSI below this = oversold (buy signal for dip strategy)
  rsiOverbought: 75,             // RSI above this = overbought (sell signal)
  requireVolumeSpike: false,     // Require volume spike for entry
  requireTrendAlignment: true,   // Require trend confirmation
  requireRsiSignal: true,        // Require RSI signal
  minConfidence: 70,             // Minimum confidence score (0-100)

  // Exit Strategy (CRITICAL for leveraged ETFs)
  stopLossPercent: 4,            // Exit if down this % (use 3-5% for 3x ETFs)
  takeProfitPercent: 5,          // Exit if up this %
  trailingStopPercent: 40,       // After profit, lock in this % of gains
  trailingStopMinProfitPercent: 2, // Only activate trailing after this % profit

  // Risk Management
  maxPositions: 1,               // Max concurrent positions per session
  maxPositionSizePercent: 25,    // Max % of portfolio per position
  dailyLossLimitPercent: 8,      // Stop trading if daily loss exceeds this
  maxConsecutiveLosses: 3,       // Circuit breaker after N losses

  // Timing
  minHoldMinutes: 5,             // Don't exit before this (prevents whipsaws)
  exitBeforeClose: true,         // Auto-exit before market close
  exitBeforeCloseMinutes: 15,    // Minutes before close to exit

  // Semiconductor Mode (SOXL/SOXS only)
  semiconductorMode: true,       // Use SOXX sentiment analysis
  marketGate: null,              // 'bullish', 'bearish', or null (any)

  // Execution
  autoTrade: true,               // MUST BE TRUE for automated trading
  allowStopLossExit: true,       // Allow stop loss even if autoTrade is false
  paperTradeOnly: true,          // Use paper trading (safety)
  manageAllPositions: false,     // false = only manage watchlist positions
}
```

### Recommended Settings by ETF Type

#### 3x Leveraged Bull ETF (SOXL, QBTX)
```javascript
{
  entryStrategy: 'dip',
  stopLossPercent: 4,
  takeProfitPercent: 5,
  trailingStopPercent: 40,
  minHoldMinutes: 5,
  maxPositionSizePercent: 25,
}
```

#### 3x Leveraged Bear/Inverse ETF (SOXS, QBTZ)
```javascript
{
  entryStrategy: 'dip',
  stopLossPercent: 3,        // Tighter - inverse ETFs decay faster
  takeProfitPercent: 4,      // Take profits quicker
  trailingStopPercent: 50,   // Lock in more gains
  minHoldMinutes: 3,         // Shorter holds
  maxPositionSizePercent: 20, // Smaller positions
}
```

---

## Current Running Sessions

As of last update:

| Session | Watchlist | Mode | Stop Loss | Take Profit |
|---------|-----------|------|-----------|-------------|
| SOXL Bullish Momentum | SOXL | Semiconductor (SOXX) | 4% | 5% |
| SOXS Bearish Hedge | SOXS | Semiconductor (SOXX) | 3% | 4% |
| QBTX Bullish Momentum | QBTX | Pure Technicals | 4% | 5% |
| QBTZ Bearish Hedge | QBTZ | Pure Technicals | 3% | 4% |

---

## Creating New Sessions

### Option 1: Via Script (Recommended)

Create a script in `scripts/` following this template:

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SESSION_FILE = path.join(__dirname, '../data/ai-sessions.json');

const NEW_SESSION_CONFIG = {
  name: 'My New Strategy',
  assetType: 'stocks',
  watchlist: ['TICKER'],
  entryStrategy: 'dip',
  // ... add all config options
  autoTrade: true,
  paperTradeOnly: true,
};

function createSession(config, userId = 'default_user') {
  return {
    sessionId: uuidv4(),
    userId,
    name: config.name,
    status: 'running',
    startTime: new Date().toISOString(),
    config: { ...config },
    portfolio: {
      cash: 100000,
      positions: [],
      initialValue: 100000,
    },
    stats: {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0,
      consecutiveLosses: 0,
      peakValue: 100000,
      maxDrawdown: 0,
      winRate: 0,
    },
    decisions: [],
    alerts: [],
    tradingLog: [],
    circuitBreakerTriggered: false,
  };
}

// Load, add, save
const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
const session = createSession(NEW_SESSION_CONFIG);
data[session.sessionId] = session;
fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
console.log('Created:', session.name);
```

Then run:
```bash
node scripts/myNewSession.js
# Restart server to activate
pkill -f "node server/index.js" && node server/index.js &
```

### Option 2: Via API

```bash
curl -X POST "http://localhost:8080/api/ai/session/start" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "default_user",
    "config": {
      "name": "My New Strategy",
      "watchlist": ["TICKER"],
      "autoTrade": true,
      ...
    }
  }'
```

---

## Common Issues & Fixes

### 1. Stop Loss Not Executing

**Symptom:** Positions held through major losses without exiting

**Cause:** `autoTrade: false` blocks all exits including stop loss

**Fix:** The code now has `allowStopLossExit` bypass:
```javascript
// In aiTradingEngine.js executeExit()
const isStopLoss = decision.exitReason?.toLowerCase().includes('stop loss');
const allowStopLossExit = session.config.allowStopLossExit !== false;
const isEmergencyExit = isStopLoss && allowStopLossExit;
if (!session.config.autoTrade && !isEmergencyExit) {
  // Still blocked
}
```

### 2. Duplicate Sessions Running

**Symptom:** Multiple sessions with same name, conflicting trades

**Cause:** Server restarts without proper session cleanup

**Fix:** Run `scripts/fixDuplicateSessions.js` or manually stop duplicates:
```bash
curl -X POST "http://localhost:8080/api/ai/session/stop" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "UUID_HERE"}'
```

### 3. Sessions Managing Wrong Positions

**Symptom:** One session selling another session's positions

**Cause:** `manageAllPositions: true` or not set

**Fix:** Ensure each session has:
```javascript
manageAllPositions: false  // Only manage own watchlist
```

### 4. Stop Loss Too Tight for Leveraged ETFs

**Symptom:** Stopped out constantly on normal volatility

**Cause:** 1-2% stop loss on a 3x ETF that swings 3-5% daily

**Fix:** Use appropriate stops:
- 3x Bull ETF: 4% stop loss
- 3x Bear/Inverse ETF: 3% stop loss

### 5. Buying at Highs (Momentum Strategy)

**Symptom:** Entries at peak prices, immediate losses

**Cause:** `entryStrategy: 'momentum'` chases rising prices

**Fix:** Use dip strategy:
```javascript
entryStrategy: 'dip',
rsiOversold: 35,  // Buy when RSI dips below 35
```

### 6. No End-of-Day Exit

**Symptom:** Positions held overnight (risky for leveraged ETFs)

**Fix:** Ensure config has:
```javascript
exitBeforeClose: true,
exitBeforeCloseMinutes: 15,
```

### 7. Win Rate Stuck at 0

**Cause:** Stats not recalculated after trades

**Fix:** Already fixed in `executeExit()`:
```javascript
session.stats.winRate = session.stats.totalTrades > 0
  ? ((session.stats.wins / session.stats.totalTrades) * 100).toFixed(1)
  : 0;
```

---

## Debugging & Logs

### Key Log Patterns

```bash
# All trading activity
tail -f server.log | grep -E "(AI Engine|BUY|SELL|EXIT)"

# Entry decisions
tail -f server.log | grep "ENTRY"

# Exit decisions
tail -f server.log | grep "EXIT"

# Errors only
tail -f server.log | grep -i "error"

# Specific session
tail -f server.log | grep "SOXL"

# Semiconductor sentiment
tail -f server.log | grep -i "semiconductor\|soxx\|sentiment"
```

### Check Session State

```bash
# Full session details
curl -s "http://localhost:8080/api/ai/session/detail/SESSION_ID" | jq

# Recent decisions
curl -s "http://localhost:8080/api/ai/decisions/SESSION_ID" | jq '.[-5:]'
```

### Analyze Trade History

```bash
# Recent filled orders
curl -s "http://localhost:8080/api/alpaca/orders?status=all&limit=50" | jq '[.[] | select(.status == "filled")] | group_by(.symbol) | .[] | {symbol: .[0].symbol, trades: length}'

# P&L by symbol
node scripts/analyzeTradeHistory.js
```

---

## API Reference

### Session Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/sessions/:userId` | GET | List all sessions |
| `/api/ai/session/detail/:sessionId` | GET | Get session details |
| `/api/ai/session/start` | POST | Create new session |
| `/api/ai/session/stop` | POST | Stop session |
| `/api/ai/session/pause` | POST | Pause session |
| `/api/ai/session/resume` | POST | Resume session |
| `/api/ai/session/:sessionId/config` | PUT | Update config |
| `/api/ai/decisions/:sessionId` | GET | Get decisions |

### Alpaca Trading

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/alpaca/account` | GET | Account info |
| `/api/alpaca/positions` | GET | Open positions |
| `/api/alpaca/orders` | GET | Order history |
| `/api/alpaca/orders` | POST | Place order |

---

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `scripts/enableAutoTrade.js` | Enable autoTrade on all running sessions |
| `scripts/fixDuplicateSessions.js` | Stop duplicate running sessions |
| `scripts/fixLeveragedEtfSettings.js` | Fix stop loss/take profit for 3x ETFs |
| `scripts/fixEntryStrategy.js` | Change from momentum to dip strategy |
| `scripts/analyzeTradeHistory.js` | Analyze P&L from Alpaca orders |
| `scripts/createQbtxQbtzSessions.js` | Create QBTX/QBTZ sessions |

---

## Trading Logic Flow

```
Every 10 seconds per session:
┌─────────────────────────────────────────────────────────────────┐
│ 1. CHECK MARKET HOURS                                           │
│    - Skip if market closed                                      │
│    - Check EOD exit (15 min before close)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. CHECK EXISTING POSITIONS                                     │
│    For each position in watchlist:                              │
│    - Calculate current P&L %                                    │
│    - Check stop loss (e.g., -4%)                                │
│    - Check take profit (e.g., +5%)                              │
│    - Check trailing stop                                        │
│    - Check min hold time                                        │
│    → If exit signal: executeExit()                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. CHECK ENTRY SIGNALS (if no position)                         │
│    - Fetch technical indicators (RSI, MACD, etc.)               │
│    - Check semiconductor sentiment (if semiconductorMode)       │
│    - Count entry signals                                        │
│    - Calculate confidence score                                 │
│    → If signals >= minSignalsRequired: executeEntry()           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. EXECUTE TRADE (if autoTrade: true)                           │
│    - Calculate position size                                    │
│    - Submit market order to Alpaca                              │
│    - Update session portfolio & stats                           │
│    - Log decision                                               │
│    - Broadcast via WebSocket                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Recent Changes (Feb 2025)

1. **Stop Loss Bypass** - Stop loss and EOD exits now execute even if `autoTrade: false`
2. **DST-Aware Timezone** - Proper Eastern Time calculation for market hours
3. **Watchlist Filtering** - Sessions only manage their own positions
4. **Win Rate Calculation** - Stats properly update after each trade
5. **Leveraged ETF Settings** - Appropriate stop loss (3-4%) for 3x ETFs
6. **Dip Strategy** - Changed from momentum (chasing highs) to dip (buying pullbacks)
7. **QBTX/QBTZ Sessions** - Added quantum computing ETF trading (pure technicals, no SOXX)

---

## Performance Metrics

Check these regularly:

```bash
# Win rate and P&L
curl -s "http://localhost:8080/api/ai/sessions/default_user" | jq '.sessions[] | select(.status == "running") | {name: .name, winRate: .stats.winRate, totalPnL: .stats.totalPnL, wins: .stats.wins, losses: .stats.losses}'

# Account value over time
curl -s "http://localhost:8080/api/alpaca/portfolio-history?period=1W" | jq '{profit_loss: .profit_loss[-1], equity: .equity[-1]}'
```

---

## Emergency Commands

```bash
# Panic sell all positions in a session
curl -X POST "http://localhost:8080/api/ai/session/SESSION_ID/panic-sell"

# Stop all sessions
for id in $(curl -s "http://localhost:8080/api/ai/sessions/default_user" | jq -r '.sessions[] | select(.status == "running") | .sessionId'); do
  curl -X POST "http://localhost:8080/api/ai/session/stop" -H "Content-Type: application/json" -d "{\"sessionId\": \"$id\"}"
done

# Kill server
pkill -f "node server/index.js"
```

---

## Checklist Before Going Live

- [ ] All sessions have `autoTrade: true`
- [ ] All sessions have `exitBeforeClose: true`
- [ ] Stop loss percentages appropriate for leverage (3-4% for 3x ETFs)
- [ ] `manageAllPositions: false` to prevent cross-session interference
- [ ] No duplicate sessions running
- [ ] Server running in background or via process manager
- [ ] Sufficient buying power in Alpaca account
- [ ] Paper trading mode verified working before switching to live
