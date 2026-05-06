---
description: Trading performance breakdown — P&L, win rates, per-session analysis, and actionable tweaks
argument-hint: "[today | week | all | session name]"
---

# Trading Performance Analysis

Scope: $ARGUMENTS (default: "today" if empty)

Run a deep performance analysis of the trading system. This is a **read-only** analysis — no changes are made. Produce a comprehensive report with actionable suggestions.

---

## Phase 1: Gather Data

Collect all data in parallel. Handle errors gracefully — if the server is down, fall back to file analysis.

### 1a. Account Snapshot
GET `http://localhost:8080/api/alpaca/account`
- Equity, cash, buying power, day trade count, PDT status

### 1b. Open Positions
GET `http://localhost:8080/api/alpaca/positions`
- Symbol, qty, entry price, current price, unrealized P&L, % P&L
- Total exposure as % of equity

### 1c. Closed Orders
GET `http://localhost:8080/api/alpaca/orders?status=closed&limit=500`
- Filter by scope: today's date, last 5 trading days, or all
- If `$ARGUMENTS` is a session name, match orders to that session's watchlist

### 1d. Session Data
GET `http://localhost:8080/api/ai/sessions/default_user`
- All sessions: status, config, stats, portfolio
- Focus on sessions with trades > 0

### 1e. Server Logs (today only)
Search `server.log` for today's patterns:
- Count BUY/SELL/EXIT signals
- Count errors (especially Polygon API failures, order rejections)
- Look for "entry lock", "cross-session block", "FORCE EXIT" messages (new safety features)
- Look for "dampening", "confidence", "signal" entries

---

## Phase 2: Analyze Performance

### 2a. Today's P&L Breakdown
Match buys with sells to compute round-trip P&L:
- Per-symbol P&L (realized + unrealized)
- Per-session P&L (match orders to session watchlists)
- Win/loss count and amounts
- Average hold time
- Best and worst trades

### 2b. Running Session Scorecard
For each **running** session:
- Win rate, profit factor, avg win / avg loss ratio
- Expectancy per trade (avgWin * winRate - avgLoss * lossRate)
- Risk/reward ratio
- Trade frequency (trades per day)
- Current config: entry strategy, confidence threshold, stop loss, take profit, position sizing
- Grade: A (profitable + good metrics) / B (breakeven or mixed) / C (losing money) / F (consistently bad)

### 2c. All-Time Leaderboard
Rank ALL sessions (including stopped/paused) by total P&L:
- Show top 5 best and worst performers
- Identify which strategies/configs are working

### 2d. Pattern Detection
Look for these specific patterns:
- **Position piling**: Multiple sessions buying same symbol simultaneously (check logs for "entry lock" or multiple BUY orders within 30s)
- **Whipsaw**: Buy then sell same symbol within minutes at a loss
- **Death spiral**: Session with 3+ consecutive losses
- **Stuck positions**: Positions held > 2 hours with no exit evaluation
- **Oversized bets**: Any single position > 20% of equity
- **Stop loss clustering**: Multiple stop losses hit at similar times (correlated risk)
- **Win streak**: Sessions on 3+ consecutive wins (momentum)

### 2e. Market Context
From the data available, note:
- Were the ETFs (SOXL, SOXS, QBTX, QBTZ) up or down today?
- Did the market trend or chop? (look at buy vs sell prices for clues)
- Were there Polygon API errors affecting exits?

---

## Phase 3: Generate Report

Present the full report in this format:

```
TRADING PERFORMANCE REPORT
===========================
Date:       [today's date]
Scope:      [today | week | all | session name]
Account:    $XX,XXX equity | $XX,XXX buying power

TODAY'S P&L
===========
Realized:     $XXX.XX (N trades: XW / XL)
Unrealized:   $XXX.XX (N open positions)
Net:          $XXX.XX

PER-SYMBOL BREAKDOWN
====================
[Table: symbol | trades | qty | avg buy | avg sell | realized P&L | unrealized | total]

OPEN POSITIONS
==============
[Table: symbol | qty | entry | current | P&L | %P&L | hold time | session]
Total exposure: $XX,XXX (XX% of equity)

SESSION SCORECARD
=================
[Table per running session:]
Session Name     | Grade | Trades | Win% | P&L      | Avg W/L | PF   | Expectancy
EXP-B Momentum   | A     | 16     | 75%  | +$1,584  | 2.1:1   | 3.2  | +$99/trade
T-Conservative    | C     | 2      | 0%   | -$134    | 0:1     | 0    | -$67/trade
...

ALL-TIME LEADERBOARD
====================
 #1  Strategy 4           +$1,033  (61 trades, 75% WR) — BEST
 #2  EXP-B Momentum       +$1,584  (16 trades, 75% WR)
 ...
 #N  Stocks (bullish)    -$10,691  (16 trades, 44% WR) — WORST

PATTERNS DETECTED
=================
- [Pattern]: [evidence] → [impact]
- [Pattern]: [evidence] → [impact]

MARKET CONTEXT
==============
[1-2 sentences on market conditions based on price action observed]
```

---

## Phase 4: Recommendations

Based on the analysis, provide **specific, actionable** recommendations. Group into:

### Immediate Actions (do now)
- Sessions to stop/pause (Grade F with consistent losses)
- Positions to manually close (stuck, oversized, or in loss spiral)
- Config knobs to adjust (with exact current → proposed values)

### Strategy Tweaks (next trading day)
- Entry signal adjustments (with rationale from data)
- Stop loss / take profit tuning (based on where wins and losses cluster)
- Position sizing changes
- Session consolidation (too many sessions doing the same thing?)

### Structural Improvements (this week)
- Code changes needed (with specific file + area)
- New safety features to implement
- Monitoring gaps to fill

Present recommendations as:

```
RECOMMENDATIONS
===============

IMMEDIATE:
  1. [Action] — [Why] — Risk: LOW/MED/HIGH
  2. ...

NEXT SESSION:
  1. [Tweak] — [Current → Proposed] — [Expected impact]
  2. ...

THIS WEEK:
  1. [Improvement] — [What it fixes]
  2. ...
```

---

## Important Notes

- This is **read-only** — do NOT make any changes, just analyze and recommend
- Always show real numbers, not placeholders
- If a section has no data, say "No data" rather than omitting it
- Be honest about losses — don't sugarcoat. The point is to find what's broken and fix it
- Compare running sessions against each other — which config is actually working?
- When making recommendations, always include the data that supports the suggestion
- If `$ARGUMENTS` specifies a session name, deep-dive into that session specifically but still show overall context
