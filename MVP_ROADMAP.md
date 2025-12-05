# MVP Roadmap - Trading Platform

## 🎯 MVP Goal

Build a functional trading platform that:

1. **Ranks stocks** based on real financial metrics
2. **Backtests strategies** ("If I bought top 5 stocks last month...")
3. **Paper trades** automatically based on rankings
4. **Tracks performance** with real metrics (Sharpe ratio, win rate, etc.)

---

## 📊 Current Status

### ✅ Phase 1: Data Quality Foundation (COMPLETE)

- [x] Yahoo Finance API integration for real data
- [x] Data validator with confidence scoring
- [x] Fix fake 52W highs (now using real historical data)
- [x] Multi-metric correlation analysis (7 daily metrics)
- [x] Distinguish time-series vs. snapshot metrics
- [x] RSI calculation with proper warmup periods

**Result:** We now have **REAL data** and can analyze correlations between daily-changing metrics.

---

## 🚀 Phase 2: Snapshot System + Backtesting (MVP CORE)

### Problem to Solve

Right now we have two types of metrics but they're mixed together:

**Time-Series Metrics (Daily):**

- Price, RSI, Volume, Daily Change %, SMAs, Volatility
- Change every day
- Can correlate over any timeframe

**Snapshot Metrics (Quarterly/Static):**

- P/E Ratio, Debt/EBITDA, ROE, Quick Ratio, Cash, etc.
- Only update quarterly (earnings reports)
- Need different comparison approach (QoQ, YoY)

### Solution: Dual Tracking System

#### 1️⃣ **Daily Ranking Snapshots**

Store daily rankings to enable backtesting:

```json
// snapshots/2025-12-03.json
{
  "date": "2025-12-03",
  "rankings": [
    {
      "symbol": "NVDA",
      "rank": 1,
      "score": 95.2,
      "price": 150.0,
      "rsi": 68.5,
      "volume": 45000000,
      // Daily metrics included

      // Quarterly metrics (only update when available)
      "peRatio": 65.3,
      "debtEbitda": 0.2,
      "roe": 0.45,
      "lastQuarterUpdate": "2025-11-01"
    }
    // ... more stocks
  ]
}
```

**Enables:**

- ✅ "Show me top 10 stocks from 30 days ago"
- ✅ "If I bought top 5 last month, what would my return be?"
- ✅ "Which stocks stayed in top 10 for longest period?"
- ✅ Historical ranking drift analysis

#### 2️⃣ **Quarterly Metric Snapshots**

Store quarterly financials separately:

```json
// quarterly_snapshots/NVDA.json
{
  "symbol": "NVDA",
  "quarters": [
    {
      "quarter": "2025-Q4",
      "date": "2025-11-01",
      "peRatio": 65.3,
      "debtEbitda": 0.2,
      "roe": 0.45,
      "priceToBook": 12.5,
      "freeCashFlowYield": 0.03,
      "quickRatio": 2.1
    },
    {
      "quarter": "2025-Q3",
      "date": "2025-08-01",
      "peRatio": 68.1,
      "debtEbitda": 0.3,
      "roe": 0.42
      // ...
    }
    // ... more quarters
  ]
}
```

**Enables:**

- ✅ Quarter-over-Quarter (QoQ) comparison
- ✅ Year-over-Year (YoY) comparison
- ✅ Quarterly trend analysis (P/E improving over time?)
- ✅ Correlation between quarterly metrics (Debt ↔ ROE)

---

## 🏗️ Phase 2 Implementation Steps

### Step 1: Separate Snapshot Metrics in UI

**Files:** `StockDetailPage.jsx`, new component `SnapshotMetricsCard.jsx`

**What:**

- Move quarterly metrics to separate card/section
- Label clearly: "Quarterly Financials (Updated Q4 2025)"
- Show last update date
- Remove mini charts for these metrics (already done)
- Add QoQ/YoY comparison arrows

**UI Example:**

```
📊 Daily Metrics (Real-Time)
├─ Price: $150.00 ▲ 2.3%
├─ RSI: 68.5 [mini chart]
├─ Volume: 45M [mini chart]
└─ Volatility: 45% [mini chart]

📈 Quarterly Financials (Updated Nov 1, 2025 - Q4)
├─ P/E Ratio: 65.3 ▼ -4.1% QoQ
├─ Debt/EBITDA: 0.2 ▲ -33% QoQ (improvement!)
├─ ROE: 45% ▲ +7.1% QoQ
└─ [View Quarterly Trends →]
```

### Step 2: Build Snapshot Storage System

**Files:** New `snapshotManager.js`, background job script

**What:**

- Cron job (or manual trigger) to save daily snapshots
- Store in `data/snapshots/YYYY-MM-DD.json`
- Store quarterly financials in `data/quarterly/SYMBOL.json`
- Include timestamp, data source, confidence scores

**API Endpoints:**

```javascript
GET /api/snapshots?date=2025-11-03  // Get rankings from specific date
GET /api/snapshots/range?start=2025-11-01&end=2025-12-03  // Date range
GET /api/quarterly/:symbol  // Get quarterly history for stock
```

### Step 3: Quarterly Metric Comparison UI

**Files:** New `QuarterlyMetricsChart.jsx`

**What:**

- Bar chart showing P/E ratio over last 8 quarters
- QoQ percentage change indicators
- YoY comparison highlighting
- Trend lines (improving/declining)

**Features:**

- Select multiple quarterly metrics to overlay
- Correlation analysis (quarterly granularity)
- Industry average comparison

### Step 4: Backtesting Engine

**Files:** New `backtestEngine.js`, `BacktestDashboard.jsx`

**What:**

- Load historical snapshots
- Simulate buying "top N stocks X days ago"
- Calculate returns based on current prices
- Track win rate, average return, max drawdown

**Example Backtest:**

```
Strategy: Buy top 5 stocks by rank
Period: Last 30 days (30 tests)
Rebalance: Daily

Results:
├─ Total Return: +12.3%
├─ Win Rate: 73% (22/30 days positive)
├─ Average Daily Return: +0.41%
├─ Max Drawdown: -3.2%
├─ Sharpe Ratio: 1.85
└─ vs S&P 500: +8.1% outperformance
```

### Step 5: Backtesting UI

**Files:** `BacktestDashboard.jsx`

**What:**

- Select strategy parameters (top N stocks, rebalance frequency)
- Date range selector
- Run backtest button
- Results visualization (equity curve, drawdown chart)
- Performance metrics table

---

## 💰 Phase 3: Paper Trading (MVP Finalization)

### Step 6: Alpaca Integration

**Files:** New `alpacaClient.js`, update `server/index.js`

**What:**

- Alpaca SDK integration (paper trading mode)
- Authentication and account connection
- Order placement API
- Position tracking API

### Step 7: Paper Trading Dashboard

**Files:** New `PaperTradingDashboard.jsx`

**What:**

- Real-time P&L display
- Current positions table
- Order history
- Performance metrics (updated live)

### Step 8: Auto-Trading Rules

**Files:** New `tradingEngine.js`

**What:**

- Monitor rankings daily
- Execute trades based on strategy
- Position sizing logic (equal weight, risk-based, etc.)
- Risk management (stop losses, position limits)

**Example Auto-Strategy:**

```javascript
{
  "name": "Top 5 Daily Rebalance",
  "rules": {
    "buyTop": 5,
    "rebalanceFrequency": "daily",
    "positionSize": "equal",  // 20% each
    "maxPositionSize": 0.25,  // Max 25% in single stock
    "stopLoss": 0.10  // Exit if down 10%
  }
}
```

---

## 📋 Implementation Priority

### 🔴 Critical Path (Must Have for MVP)

1. ✅ Multi-metric correlation (DONE)
2. Separate snapshot metrics in UI
3. Build daily ranking snapshot storage
4. Build quarterly metric snapshot storage
5. Create basic backtesting engine
6. Create backtesting UI
7. Alpaca paper trading integration
8. Paper trading dashboard

### 🟡 Important (Nice to Have)

- QoQ/YoY comparison UI for quarterly metrics
- Quarterly metric correlation analysis
- Auto-trading rule engine
- Performance attribution analysis
- Sector/industry comparison

### 🟢 Future Enhancements

- Live trading mode (post-MVP)
- Mobile app
- Alerts and notifications
- Portfolio optimization
- Machine learning rank predictions

---

## 🎯 MVP Success Criteria

### Minimum Viable Product Must:

1. ✅ Rank stocks based on real financial data
2. ✅ Show correlation between daily metrics
3. ⬜ Store daily ranking snapshots
4. ⬜ Backtest "top N stocks X days ago" strategies
5. ⬜ Show backtest performance metrics
6. ⬜ Execute paper trades via Alpaca
7. ⬜ Display paper trading P&L

### MVP Demo Flow:

```
1. User views stock rankings (updated daily)
2. User clicks "Backtest Strategy"
3. Selects: "Buy top 5 stocks, 30 days ago, rebalance daily"
4. System shows: "+12.3% return, 73% win rate, Sharpe 1.85"
5. User clicks "Run This Strategy (Paper Trading)"
6. System executes paper trades via Alpaca
7. Dashboard shows real-time P&L and positions
8. User can see "If I started this 30 days ago, I'd be up $1,230"
```

---

## 📊 Data Architecture

### Daily Metrics (Time-Series)

```javascript
// Stored in historical API responses (Polygon/Yahoo)
// Fetched on-demand for charts
{
  price: [150, 152, 148, ...],
  rsi: [68, 72, 65, ...],
  volume: [45M, 50M, 42M, ...],
  // ... etc
}
```

### Snapshot Metrics (Quarterly)

```javascript
// Stored in files: data/quarterly/SYMBOL.json
{
  symbol: "NVDA",
  quarters: [
    { quarter: "2025-Q4", peRatio: 65.3, roe: 0.45, ... },
    { quarter: "2025-Q3", peRatio: 68.1, roe: 0.42, ... }
  ]
}
```

### Daily Ranking Snapshots

```javascript
// Stored in files: data/snapshots/YYYY-MM-DD.json
{
  date: "2025-12-03",
  rankings: [
    { symbol: "NVDA", rank: 1, score: 95.2, price: 150, ... },
    { symbol: "AAPL", rank: 2, score: 92.1, price: 180, ... }
  ]
}
```

### Backtest Results

```javascript
// Stored in files: data/backtests/STRATEGY_ID.json
{
  strategyId: "top5-daily-rebalance",
  period: "2025-11-03 to 2025-12-03",
  results: {
    totalReturn: 0.123,
    winRate: 0.73,
    sharpeRatio: 1.85,
    trades: [...]
  }
}
```

---

## 🚀 Next Steps (Starting Now)

### Immediate (Today/This Week):

1. **Separate snapshot metrics in UI** - Create new section for quarterly metrics
2. **Design snapshot data structure** - Finalize JSON schema
3. **Build snapshot storage** - Implement daily ranking save functionality

### Short Term (This Sprint):

4. **Implement backtesting engine** - Core calculation logic
5. **Create backtesting UI** - Basic results display
6. **Test with historical data** - Validate backtest accuracy

### Medium Term (Next Sprint):

7. **Alpaca integration** - Paper trading API connection
8. **Paper trading dashboard** - Real-time P&L display
9. **Auto-trading rules** - Basic strategy execution

---

## 💡 Key Insights

### Why This Order?

1. **Snapshots First** - Foundation for everything else
2. **Backtesting Second** - Validates strategies before real money
3. **Paper Trading Last** - Proof of concept before live trading

### Why Separate Time-Series vs. Snapshot?

- **Different update frequencies** - Daily vs. Quarterly
- **Different visualization** - Charts vs. Comparisons
- **Different analysis** - Correlation vs. Trend
- **Different use cases** - Real-time monitoring vs. Fundamental analysis

### Why Backtesting Matters?

- Validates ranking algorithm effectiveness
- Builds confidence before risking real money
- Identifies winning strategies
- Provides performance expectations

---

## 📈 Expected Outcomes

### After Phase 2 (Backtesting):

- "I can see that buying top 5 stocks last month would have returned +12%"
- "My ranking algorithm has a 73% win rate over 30 days"
- "I know which strategy works best (daily vs. weekly rebalance)"

### After Phase 3 (Paper Trading):

- "My paper trading account is up $1,230 (12.3%) in 30 days"
- "I can validate my strategy in real-time before using real money"
- "I have confidence in the system to go live"

### After MVP:

- "I have a proven, automated trading system"
- "I can rank stocks, backtest strategies, and execute trades"
- "I'm ready to scale to live trading with real capital"
