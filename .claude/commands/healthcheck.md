---
description: Full system health + trading performance analysis
argument-hint: ""
---

# Trading System Health Check

Run a comprehensive health check of the trading system. Produce a structured report covering all 7 areas below, then synthesize into an overall assessment.

## 1. System Health

Check that core endpoints are responding:

```bash
curl -sf http://localhost:8080/api/alpaca/account > /dev/null && echo "Account API: UP" || echo "Account API: DOWN"
curl -sf http://localhost:8080/api/alpaca/positions > /dev/null && echo "Positions API: UP" || echo "Positions API: DOWN"
curl -sf "http://localhost:8080/api/ai/sessions/default_user" > /dev/null && echo "Sessions API: UP" || echo "Sessions API: DOWN"
```

If the server is down, note it and continue with file-based analysis where possible.

## 2. Account Status

GET `http://localhost:8080/api/alpaca/account`

Extract and report: cash, equity, buying_power, pattern_day_trader status, trading_blocked, daytrade_count.

## 3. Open Positions

GET `http://localhost:8080/api/alpaca/positions`

For each position report: symbol, qty, side, avg_entry_price, current_price, unrealized_pl, unrealized_plpc, market_value.

Cross-reference positions against running session watchlists. Flag any **orphan positions** (positions not tracked by any running session).

Calculate total position value and percentage of portfolio.

## 4. Session Analysis

GET `http://localhost:8080/api/ai/sessions/default_user`

For each **running** session, report:
- **Config**: autoTrade, watchlist, takeProfitPercent, stopLossPercent, trendDampeningFactor, maxPositionSize, confidenceThreshold
- **Stats**: totalTrades, wins, losses, winRate, totalPnL, maxDrawdown, profitFactor, avgWin, avgLoss
- **Flags**: Is circuit breaker near triggering? Is P&L negative? Is win rate below 50%? Is max drawdown > 5%?

Also list paused/stopped sessions with their final stats.

## 5. Today's Trading Activity

Search `server.log` for today's date patterns. Look for:
- **Signals**: BUY, SELL, EXIT, ENTRY keywords
- **Trend dampening**: "Trend dampening:" or "dampening" messages
- **Position sizing**: "Position size:" or "position size" messages
- **Errors**: ERROR, Error, error, exception, failed, failure keywords
- **Trade count**: How many trades executed today per session

Summarize the activity timeline.

## 6. Self-Improvement Engine

Check these endpoints (skip gracefully if they return errors — the feature may not be active):
- GET `http://localhost:8080/api/ai/improvements/status` — running state, guardrails
- GET `http://localhost:8080/api/ai/improvements/latest` — last cycle results
- GET `http://localhost:8080/api/ai/tournament/scoreboard` — tournament rankings

Also check if `data/improvement-log.json` exists and summarize recent entries.

## 7. Data Integrity

Check these files:
- `data/ai-sessions.json` — exists, valid JSON, file size reasonable
- `data/improvement-log.json` — exists, valid JSON (if applicable)
- `server.log` — exists, recent entries (not stale)
- Check for backup files in `data/` directory

Report any issues: corrupt JSON, missing files, stale data.

---

## Output Format

After gathering all data, produce a report in this format:

```
TRADING SYSTEM HEALTH CHECK
============================
Date:            [today's date and time]
System:          RUNNING | DOWN
Account:         $XX,XXX equity | $XX,XXX buying power | PDT: OK/WARNING
Positions:       N open ($XX,XXX total) | Orphaned: NONE/list
Sessions:        N running, N paused | Flags: [any concerns]
Today's Trades:  N buys, N exits | Errors: NONE/count
Self-Improve:    ACTIVE/IDLE | Last cycle: [date] [result]
Data:            HEALTHY | [issues]

OPEN POSITIONS
==============
[Table: symbol, qty, entry, current, P&L, %P&L, session]

SESSION DETAILS
===============
[Per-session: name, status, trades, winRate, P&L, drawdown, flags]

TODAY'S ACTIVITY
================
[Timeline of significant events from server.log]

ASSESSMENT
==========
[1-2 paragraph overall health assessment]
[What's working well]
[What needs attention]
[Specific actionable recommendations]
```

**Important**: Handle errors gracefully. If an API is down or a file is missing, note it in the report and continue with what's available. The report should always complete, even in degraded conditions.
