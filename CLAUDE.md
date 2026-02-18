# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Start development environment:

```bash
npm run server-dev    # Start Express server with nodemon
npm run react-dev     # Start React client with webpack watch (legacy OpenSSL)
```

Access the application at `http://localhost:8080/`

Build commands:

```bash
npm run build         # Production webpack build
npm run dev           # Development webpack build with watch
npm run lint          # ESLint check
npm run code-quality  # Lint + format check
npm run code-fix      # Lint fix + format
```

## Subagent Workflow

Custom subagents live in `.claude/agents/`. Use them to maintain quality and speed across PRs:

| Agent | When to Use | What It Does |
|-------|------------|--------------|
| **build-validator** | After any code changes | Runs webpack build, ESLint, import verification, server syntax check, MVP impact assessment |
| **code-architect** | Before multi-file features | Maps dependencies, assesses risk level, recommends implementation path |
| **code-simplifier** | After implementation is done | Reviews changed files for dead code, complexity, duplication, naming issues |
| **verify-app** | Before shipping / when broken | Full stack health check: server, APIs, sessions, positions, data integrity |
| **oncall-guide** | When something is broken | Diagnoses trading issues, checks logs, provides step-by-step fixes |

### PR Workflow
1. **Plan**: Use `code-architect` to analyze impact before starting
2. **Implement**: Write the code, use `/feature` command for structured workflow
3. **Validate**: Use `build-validator` to catch build/lint/import issues
4. **Simplify**: Use `code-simplifier` to clean up the diff
5. **Verify**: Use `verify-app` for end-to-end health check
6. **Ship**: Commit and PR

### Debugging Workflow
1. **Diagnose**: Use `oncall-guide` to investigate the issue
2. **Fix**: Implement the recommended fix
3. **Validate**: Use `build-validator` + `verify-app` to confirm

## Architecture Overview

Full-stack React + Express trading platform for ranking investments and automated leveraged ETF trading.

### Frontend (React 19)
- **Entry**: `react-client/src/index.jsx` (React 18 createRoot)
- **Router**: React Router v6 in `App.jsx` (~14 routes)
- **State**: React Context (`TradingConfigContext`, `StockDataProvider`)
- **Components**: `react-client/src/Components/` (121+ components across pages/, trading/, common/, simulator/, Analytics/)
- **Build**: Webpack 5 + Babel 7 with `babel-plugin-react-compiler` (React 19)
- **Aliases**: `@components`, `@common`, `@pages`, `@trading`, `@simulator`, `@contexts`, `@hooks`, `@utils`, `@config`, `@mvp`

### Backend (Express)
- **Server**: `server/index.js` (7300+ lines, 50+ API routes)
- **AI Trading**: `server/aiTradingEngine.js` (3400+ lines) - autonomous entry/exit decisions
- **Market Data**: `server/polygonClient.js`, `server/alpacaClient.js`
- **Sentiment**: `server/semiconductorSentiment.js` (SOXX-based market gating)
- **Backtesting**: `server/enhancedBacktestEngine.js`, `server/strategyOptimizer.js`, `server/walkForwardOptimizer.js`
- **Persistence**: `data/ai-sessions.json` (JSON file, no database)
- **Real-time**: WebSocket server for live trading updates

### Key API Routes
```
/api/ai/sessions/:userId        - List trading sessions
/api/ai/session/start|stop|pause - Session lifecycle
/api/alpaca/account|positions    - Broker integration
/api/alpaca/orders               - Order management
/api/backtest/run                - Run backtests
/api/snapshots/:date             - Historical data
```

## AI Trading System

**See `AI_TRADING_GUIDE.md` for complete documentation.**

The app includes an automated trading system that trades leveraged ETFs via Alpaca Paper Trading API.

### Key Files
- `server/aiTradingEngine.js` - Core trading logic (entry/exit decisions, order execution)
- `server/semiconductorSentiment.js` - SOXX-based sentiment for SOXL/SOXS
- `data/ai-sessions.json` - Session configs and state (stop server before editing)

### Current Strategies
- **SOXL/SOXS** - Semiconductor 3x ETFs using SOXX sentiment + technicals
- **QBTX/QBTZ** - Quantum computing 3x ETFs using pure technicals

### Quick Commands
```bash
# Check running sessions
curl -s "http://localhost:8080/api/ai/sessions/default_user" | jq '.sessions[] | select(.status == "running") | .name'

# Check logs
tail -f server.log | grep -E "(AI Engine|BUY|SELL|EXIT)"

# Utility scripts in scripts/
node scripts/enableAutoTrade.js
node scripts/fixDuplicateSessions.js
```

## MVP Files (Require Extra Rigor)

Changes to these files should be validated with `build-validator` and reviewed carefully:

**Tier 1 - CRITICAL (trading money):**
- `server/aiTradingEngine.js`, `server/alpacaClient.js`, `server/index.js`

**Tier 2 - HIGH IMPACT:**
- `server/semiconductorSentiment.js`, `server/polygonClient.js`
- `react-client/src/utils/tradingLogic.js`, `react-client/src/utils/rankingAlgorithms.js`

**Tier 3 - SUPPORTING:**
- `server/websocketServer.js`, `server/tradingLogger.js`

## Development Notes

- Uses legacy Node.js OpenSSL provider for compatibility (`NODE_OPTIONS=--openssl-legacy-provider`)
- No test framework currently configured
- React 19 with babel-plugin-react-compiler
- Webpack 5 with source maps and path aliases
- Express server handles SPA routing with catch-all route serving index.html
- 300+ console.log statements across server files (no structured logging yet)
