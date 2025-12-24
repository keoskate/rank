# Page Map & Codebase Organization

This document maps the MVP pages to their component and server dependencies, identifies experimental/WIP code, and provides a component catalog for development reference.

## Quick Reference

| Page | Route | Component | Status |
|------|-------|-----------|--------|
| Rankings | `/` | `RankingsPage.jsx` | MVP |
| Stock Detail | `/stock/:ticker` | `StockDetailPage.jsx` | MVP |
| Portfolio | `/portfolio` | `PortfolioPage.jsx` | MVP |
| AI Sessions List | `/live-trading` | `TradingSessionsList.jsx` | MVP |
| Live Trading Dashboard | `/live-trading/:sessionId` | `LiveTradingDashboard.jsx` | MVP |
| Analytics | `/portfolio?tab=analytics` | `PerformanceAnalyticsPanel.jsx` | Embedded in Portfolio |

---

## MVP Pages (5 Core Screens)

### 1. Rankings Page (Home)
**Route:** `/`
**File:** `react-client/src/Components/RankingsPage.jsx`

The main landing page showing stock rankings with scoring algorithm.

#### Component Dependencies
```
RankingsPage.jsx
├── ModernStonkBoard.jsx          # Main ranking table
│   ├── StockTable (TanStack)     # Data table with sorting/filtering
│   └── WeightSlider.jsx          # Ranking weight adjustments
├── common/Button.jsx             # Design system button
├── common/Card.jsx               # Design system card
└── theme.js                      # Design tokens
```

#### Server Dependencies
- `GET /api/stock-data` - Fetch stock rankings data
- `polygonClient.js` - Market data provider


### 2. Stock Detail Page
**Route:** `/stock/:ticker`
**File:** `react-client/src/Components/pages/StockDetailPage.jsx`

Individual stock analysis, charts, and trading interface.

#### Component Dependencies
```
StockDetailPage.jsx
├── StockDataProvider (context)   # Stock data context
├── trading/StockQuoteHeader.jsx  # Price/quote display
├── trading/StockInsightsPanel.jsx # AI analysis panel
├── charts/PriceChart.jsx         # Price visualization
├── common/Button.jsx
├── common/Card.jsx
└── config/stockColumns.js        # Column configuration
```

#### Server Dependencies
- `GET /api/polygon/quote/:symbol` - Real-time quote
- `GET /api/polygon/chart/:symbol` - Historical chart data
- `GET /api/polygon/company/:symbol` - Company info
- `GET /api/alpaca/account` - Trading account
- `POST /api/alpaca/orders` - Place orders
- `polygonClient.js`, `alpacaClient.js`


### 3. Portfolio Page
**Route:** `/portfolio`
**File:** `react-client/src/Components/pages/PortfolioPage.jsx`

Account overview, positions, P&L, and trade history.

#### Component Dependencies
```
PortfolioPage.jsx
├── common/Card.jsx
├── common/Button.jsx
├── common/MetricCard.jsx         # Metric display cards
├── common/PortfolioPerformanceChart.jsx  # Equity curve
└── theme.js
```

#### Server Dependencies
- `GET /api/alpaca/account` - Account info (equity, cash, buying power)
- `GET /api/alpaca/positions` - Open positions
- `GET /api/alpaca/orders` - Order history
- `GET /api/alpaca/portfolio-history` - Historical performance
- `GET /api/ai/session/:userId` - AI session status
- `alpacaClient.js`

#### Analytics Tab
The Portfolio page now includes a tabbed interface:
- **Overview** (`/portfolio`): Positions, P&L, recent orders, AI session status
- **Analytics** (`/portfolio?tab=analytics`): Comprehensive performance charts, metrics, top symbols


### 4. AI Trading Sessions List
**Route:** `/live-trading`
**File:** `react-client/src/Components/pages/TradingSessionsList.jsx`

List of all AI trading sessions with create/manage controls.

#### Component Dependencies
```
TradingSessionsList.jsx
├── common/Button.jsx
├── common/Card.jsx
├── common/MetricCard.jsx
└── theme.js
```

#### Server Dependencies
- `GET /api/ai/sessions/:userId` - List all sessions
- `POST /api/ai/session/start` - Create new session
- `POST /api/ai/session/stop` - Stop session
- `POST /api/ai/session/pause` - Pause session
- `POST /api/ai/session/resume` - Resume session
- `POST /api/ai/session/clone` - Clone session config
- `DELETE /api/ai/session/:sessionId` - Delete session
- `aiTradingEngine.js`


### 5. Live Trading Dashboard
**Route:** `/live-trading/:sessionId`
**File:** `react-client/src/Components/pages/LiveTradingDashboard.jsx`

Individual session view with real-time trading, charts, and configuration.

#### Component Dependencies
```
LiveTradingDashboard.jsx
├── common/TradingViewChart.jsx   # TradingView integration
├── common/WatchlistCharts.jsx    # Multiple symbol charts
├── common/Button.jsx
├── common/Card.jsx
├── common/MetricCard.jsx
├── common/ErrorBoundary.jsx
├── common/TradingLogPanel.jsx    # Real-time trade logs
├── common/StrategyMonitorPanel.jsx
├── common/RegimeConfigPanel.jsx  # Market regime settings
├── common/LeveragedEtfPanel.jsx  # ETF mode toggle
├── common/CheddarFlowCard.jsx    # Options flow analysis
├── common/TechnicalRegimeCard.jsx # Technical analysis
├── common/MarketTideCard.jsx     # Market sentiment
├── common/StrategyValidatorPanel.jsx # Backtest validation
├── TradingSimulator.jsx          # Manual simulation
├── contexts/TradingConfigContext.jsx
├── utils/audioNotifications.js   # Trade audio alerts
└── theme.js
```

#### Server Dependencies
- WebSocket: `socket.io` for real-time updates
  - `trading_update` - Position/trade updates
  - `trading_log` - Log entries
  - `ai_decision` - AI trading decisions
- `GET /api/ai/session/:sessionId` - Session details
- `POST /api/ai/session/config` - Update config
- `GET /api/alpaca/account` - Account info
- `GET /api/alpaca/positions` - Positions
- `GET /api/trading-logs` - Historical logs
- `GET /api/regime/:symbol` - Market regime detection
- `GET /api/cheddarflow/latest` - Options flow data
- `aiTradingEngine.js`, `websocketServer.js`, `regimeDetector.js`

---

## Shared Component Library (Design System)

Located in `react-client/src/Components/common/`

| Component | File | Description |
|-----------|------|-------------|
| **Button** | `Button.jsx` | Primary action button with variants |
| **Card** | `Card.jsx` | Container with shadow/border |
| **MetricCard** | `MetricCard.jsx` | Stat display with label/value/subtext |
| **ErrorBoundary** | `ErrorBoundary.jsx` | React error boundary wrapper |
| **TradingViewChart** | `TradingViewChart.jsx` | TradingView widget integration |
| **TradingLogPanel** | `TradingLogPanel.jsx` | Real-time log display |
| **PortfolioPerformanceChart** | `PortfolioPerformanceChart.jsx` | Equity curve with Chart.js |
| **CheddarFlowCard** | `CheddarFlowCard.jsx` | Options flow sentiment |
| **TechnicalRegimeCard** | `TechnicalRegimeCard.jsx` | Regime detection display |
| **MarketTideCard** | `MarketTideCard.jsx` | Unusual Whales sentiment |
| **StrategyValidatorPanel** | `StrategyValidatorPanel.jsx` | Multi-day backtest |
| **RegimeConfigPanel** | `RegimeConfigPanel.jsx` | Regime detection settings |
| **LeveragedEtfPanel** | `LeveragedEtfPanel.jsx` | ETF mode toggle |
| **StrategyMonitorPanel** | `StrategyMonitorPanel.jsx` | Strategy status monitor |
| **WatchlistCharts** | `WatchlistCharts.jsx` | Multi-symbol chart grid |
| **ConfigPanel** | `ConfigPanel.jsx` | Trading configuration form |
| **LiveTradingChart** | `LiveTradingChart.jsx` | Deprecated - use TradingViewChart |

---

## Server-Side File Classification

### MVP-Critical (Core Trading)
Located in `server/`

| File | Purpose |
|------|---------|
| `index.js` | Express server, routes, middleware |
| `aiTradingEngine.js` | AI trading loop, entry/exit logic |
| `websocketServer.js` | Socket.io real-time updates |
| `alpacaClient.js` | Alpaca trading API client |
| `polygonClient.js` | Polygon market data client |
| `regimeDetector.js` | Market regime detection |
| `technicalIndicatorsService.js` | Technical indicator calculations |
| `tradingModeManager.js` | Paper/live mode management |
| `sessionManager.js` | Trading session persistence |
| `tradingLogger.js` | Structured trade logging |
| `backtestEngine.js` | Backtest execution |
| `strategyBacktester.js` | Strategy validation |

### Experimental / WIP (Isolate)
These files are for research and not production-ready:

| File | Purpose | Status |
|------|---------|--------|
| `walkForwardOptimizer.js` | Walk-forward optimization | WIP |
| `abTestingEngine.js` | A/B testing strategies | WIP |
| `strategyVersionControl.js` | Strategy versioning | WIP |
| `overnightOptimizer.js` | Overnight position analysis | WIP |
| `strategyOptimizer.js` | Strategy parameter tuning | WIP |
| `patternRecognitionService.js` | Chart pattern detection | WIP |
| `mlConfidenceService.js` | ML confidence scoring | WIP |
| `mlPredictionService.js` | ML price predictions | WIP |
| `feedbackLearningService.js` | Trade feedback learning | WIP |
| `cheddarflowScraper.js` | Options flow scraping | WIP |

---

## Pages Classification

### MVP Pages (Production Ready)
- `/` - RankingsPage
- `/stock/:ticker` - StockDetailPage
- `/portfolio` - PortfolioPage
- `/live-trading` - TradingSessionsList
- `/live-trading/:sessionId` - LiveTradingDashboard

### Tools (Functional, Secondary Priority)
- `/backtest` - BacktestPage
- `/day-trading` - IntradayAnalyzerPage
- `/import-trades` - TradeImportPage

### Experimental (Not Production Ready)
- `/ab-testing` - ABTestPage
- `/walk-forward` - WalkForwardPage
- `/strategy-lab` - StrategyLabPage
- `/overnight` - OvernightOptimizationPage
- `/charlie-strategy` - CharlieStrategyPage

### Legacy (Keep for Compatibility)
- `/invest` - InvestTab
- `/paper-trading` - PaperTradingPage
- `/ai-research` - AIResearchPage
- `/test-validation` - DataValidationTest

---

## Recommended Folder Restructure

```
react-client/src/Components/
├── pages/
│   ├── mvp/                    # Core product pages
│   │   ├── RankingsPage.jsx    # Currently in Components/
│   │   ├── StockDetailPage.jsx
│   │   ├── PortfolioPage.jsx
│   │   ├── TradingSessionsList.jsx
│   │   └── LiveTradingDashboard.jsx
│   ├── tools/                  # Secondary features
│   │   ├── BacktestPage.jsx
│   │   ├── IntradayAnalyzerPage.jsx
│   │   ├── TradeImportPage.jsx
│   │   └── PerformanceAnalytics.jsx
│   └── experimental/           # WIP / Research
│       ├── ABTestPage.jsx
│       ├── WalkForwardPage.jsx
│       ├── StrategyLabPage.jsx
│       ├── OvernightOptimizationPage.jsx
│       └── CharlieStrategyPage.jsx
├── common/                     # Design system components
├── charts/                     # Chart components
├── trading/                    # Trading-specific components
└── simulator/                  # Simulation components
```

---

## Context & Hooks

### Contexts
| Context | File | Purpose |
|---------|------|---------|
| StockDataProvider | `Components/StockDataProvider.jsx` | Stock data state |
| TradingConfigContext | `contexts/TradingConfigContext.jsx` | Trading configuration |

### Custom Hooks
| Hook | File | Purpose |
|------|------|---------|
| useRanking | `hooks/useRanking.js` | Ranking calculation |
| useStockData | `hooks/useStockData.js` | Stock data fetching |
| useTradingViewChart | `hooks/useTradingViewChart.js` | TradingView integration |

---

## Development Tools (Planned)

### Component Catalog Page
A developer-facing page that displays all core components with:
- Visual preview of each component
- Props documentation
- Code examples
- Screenshot reference capability

This will enable:
1. Easy screenshot attachment for discussions
2. Quick component lookup during development
3. Consistent design system usage
4. Visual regression testing baseline

---

## Key API Patterns

### Alpaca Endpoints
All support `?mode=paper|live` query parameter:
- `GET /api/alpaca/account`
- `GET /api/alpaca/positions`
- `GET /api/alpaca/orders`
- `POST /api/alpaca/orders`
- `GET /api/alpaca/portfolio-history`

### Polygon Endpoints
- `GET /api/polygon/quote/:symbol`
- `GET /api/polygon/chart/:symbol`
- `GET /api/polygon/aggregates/:symbol/:multiplier/:timespan`
- `GET /api/polygon/company/:symbol`

### AI/Trading Endpoints
- `GET /api/ai/sessions/:userId`
- `GET /api/ai/session/:sessionId`
- `POST /api/ai/session/start`
- `POST /api/ai/session/stop`
- `POST /api/ai/session/pause`
- `POST /api/ai/session/resume`
- `POST /api/ai/session/config`
- `GET /api/trading-logs`
- `GET /api/regime/:symbol`
