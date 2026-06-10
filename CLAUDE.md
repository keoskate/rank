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

## AI Broker Agents (Phases 0-10)

Markdown-driven autonomous trading personas that compete on simulated $100k pools, get promoted to real Alpaca paper trading when they prove themselves, and rewrite their own configs at EOD via Claude.

### Key Files
- `server/brokers/brokerSchema.js` - frontmatter validator + session-config translator
- `server/brokers/brokerLoader.js` - chokidar file watcher for hot-reload
- `server/brokers/brokerWriter.js` - atomic .md writes with versioned snapshots
- `server/brokers/brokerSessionBridge.js` - reconciles .md files with engine sessions
- `server/brokers/simulatedExecutor.js` - simulated buy/sell with mark-to-market
- `server/brokers/tierPromotion.js` - promote/demote/fire/breed survival mechanics
- `server/brokers/brokerLlm.js` - per-broker Claude analyst (prompt-cached, structured output)
- `server/brokers/selfMutation.js` - EOD self-mutation loop with allow-list safety
- `server/strategies/entropyGate.js` - Shannon entropy regime filter
- `server/risk/kellySizing.js` - fractional Kelly with Bayesian prior
- `agents/brokers/*.md` - persona files (frontmatter + markdown body)
- `data/broker-ledger.json` - audit log of all tier changes + self-mutations
- `data/broker-versions/<slug>/` - per-broker .md snapshot history for rollback

### Daily Commands
```bash
npm run floor              # tmux: 4-pane Exchange Floor (server + TUI + log + broker shell)
npm run exchange           # standalone blessed TUI
npm run broker:status      # one-shot terminal snapshot (works offline)
npm run brief              # generate morning brief markdown to data/reports/
npm run brief -- --print   # print to stdout
npm run broker:reset       # wipe all brokers to clean $100k (sim only)
```

### API Endpoints
```
GET  /api/brokers                            - leaderboard + live state
GET  /api/brokers/ledger                     - tier-change + mutation audit log
GET  /api/brokers/paper-allocations          - paper-tier allocation summary
GET  /api/brokers/:slug/snapshots            - rollback fuel
POST /api/brokers/sync                       - manual broker→session reconcile
POST /api/brokers/tier-eval?dryRun=1&breed=1 - run promotion/fire/breed evaluation
POST /api/brokers/:slug/test-trade           - force a sim buy/sell (sim-tier only)
POST /api/brokers/:slug/seed                 - inject synthetic trade history (test-only)
POST /api/brokers/:slug/reset                - wipe one broker to fresh capital
POST /api/brokers/reset-all                  - wipe all brokers
POST /api/brokers/:slug/self-mutate?dryRun=1 - ask Claude to review + propose changes
POST /api/brokers/self-mutate-all            - fan-out across all eligible brokers
POST /api/brokers/:slug/transition           - manually flip tier (body: {to: "paper"|"simulated"})
POST /api/brokers/:slug/revert               - rollback to a snapshot (body: {timestamp})
```

### Paper Alpaca (Tier 2: tier:paper brokers)
When a broker is promoted from `simulated` to `paper`, the engine flips `simulationMode: false` and routes real orders to the Alpaca paper account. Each broker gets a `paperAllocation` (default 20% of `capital`, or set explicitly in frontmatter). All paper-tier brokers share the single Alpaca paper account's buying power.

**Manual setup needed once:**
- Bump your Alpaca paper account size above $25k (in dashboard → Paper Trading → Reset Account) to avoid PDT limits. Current account shows $314k buying power, so this is already done.

**Kill switch:**
- `BROKER_PAPER_TRADING=off npm run server-dev` forces every broker back to simulation regardless of declared tier. Use when you don't trust the system.

### Hiring brokers
- `/hire-broker <idea>` - Claude Code slash command, conversational wizard
- `npm run hire -- --slug <slug> --non-interactive` - CLI alternative
- Persona files at `agents/brokers/*.md`; edit live, file-watcher hot-reloads in ~5s

## Backtest Validation Foundation

A strategy earns "VALIDATED" only by clearing five gates: data-integrity, backtest==live faithfulness, walk-forward out-of-sample, 2x-cost stress, and multiple-testing-aware significance. `scripts/backtests/lib/validateStrategy.js` runs them in order and emits the verdict. **Expect most strategies not to validate — that is the point.**

### Rules
- ONE data path: `scripts/backtests/lib/marketData.js` (Alpaca split+dividend adjusted, 2016+, cached, sanity-checked). Never fetch bars any other way in a backtest. Polygon floors at ~2021-06 and its `META` pre-2022-06 is the wrong security (see `scripts/backtests/known-data-issues.json`).
- ONE artifact: every run emits a standardized `run.json` (`lib/runArtifact.js`) — equity + drawdown + trade ledger + OHLC bars + gate verdicts + ledger-vs-equity reconciliation. Viewers read the artifact; nothing re-computes.
- ONE stats definition: `@keo/quant-core` `equityStats` (Sharpe/CAGR/maxDD/Calmar). Do not re-implement.
- Shared decision cores: live plugins and backtests must import the same pure function from `@keo/quant-core` (e.g. `entropyGateCore`), certified by a script in `scripts/backtests/certify-*.js`.
- Every parameter combination evaluated is recorded in `data/backtests/trials-ledger.json` — the honest N for Sharpe deflation. Never delete trials.

### Commands
```bash
npm run backtest:trend             # instrumented trend backtest -> 10 run.json artifacts
npm run backtest:view              # list run artifacts
npm run backtest:view <runId>      # terminal viewer (equity, drawdown, candles+markers)
npm run backtest:view <runId> -- --replay   # animate day by day
node scripts/backtests/validate-trend.js        # five-gate validation of the DEPLOYED trend-follower spec
node scripts/backtests/validate-xs-momentum.js  # five-gate validation, xs-momentum
node scripts/backtests/certify-entropy-gate.js  # live==backtest faithfulness cert (entropy)
node scripts/backtests/certify-trend-core.js    # live==backtest faithfulness cert (trend)
node scripts/backtests/revalidate-entropy-gate.js  # gate edge re-test (net of costs)
```
Verdict scoreboard + prioritized next steps: see `ROADMAP.md`.
Web viewer: `/backtest` page reads `/api/backtest-runs` (artifacts only, no engine).

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
