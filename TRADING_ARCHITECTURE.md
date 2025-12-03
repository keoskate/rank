# Trading Platform Architecture

**North Star Vision:** Validated ranking system → Proven backtesting → Seamless paper/live trading

## Design Principles

1. **No Tech Debt** - Build it right from day one
2. **Environment Agnostic** - Same code for paper and live trading
3. **Data Quality First** - Multi-source validation before ranking
4. **Lean & Fast** - Minimal dependencies, maximum value

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED UI LAYER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Dashboards  │  │   Trading    │  │  Backtesting │     │
│  │  (Paper/Live)│  │   Interface  │  │   Analytics  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   BUSINESS LOGIC LAYER                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Ranking    │  │   Trading    │  │  Backtesting │     │
│  │   Engine     │  │   Strategy   │  │   Engine     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                DATA VALIDATION LAYER                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Multi-Source Validator                              │  │
│  │  - Compare metrics across providers                  │  │
│  │  - Flag outliers and inconsistencies                 │  │
│  │  - Calculate confidence scores                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   DATA PROVIDER LAYER                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │    Yahoo     │  │   Polygon    │  │    Alpaca    │     │
│  │   Finance    │  │   (existing) │  │  (trading)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Validated  │  │   Ranking    │  │   Trading    │     │
│  │   Stock Data │  │   Snapshots  │  │   History    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
react-client/src/
├── api/
│   ├── unifiedAPI.js                 # Existing Polygon + Alpha Vantage
│   ├── yahooFinanceAPI.js            # NEW: Yahoo Finance integration
│   ├── alpacaAPI.js                  # NEW: Alpaca trading API
│   └── dataValidator.js              # NEW: Multi-source validation
│
├── services/
│   ├── rankingEngine.js              # Core ranking logic
│   ├── backtestingEngine.js          # NEW: Historical validation
│   ├── tradingStrategy.js            # NEW: Buy/sell signal generation
│   └── portfolioManager.js           # NEW: Position tracking
│
├── utils/
│   ├── dataQuality.js                # NEW: Confidence scoring
│   ├── tradingEnvironment.js         # NEW: Paper vs Live mode manager
│   └── performanceMetrics.js         # NEW: P&L, win rates, etc.
│
├── Components/
│   ├── TradingDashboard.jsx          # NEW: Unified paper/live dashboard
│   ├── BacktestResults.jsx           # NEW: Historical performance
│   ├── DataQualityIndicator.jsx      # NEW: Confidence badges
│   └── EnvironmentToggle.jsx         # NEW: Paper/Live switcher
│
└── storage/
    ├── rankingSnapshots.json         # Daily ranking history
    ├── tradingHistory.json            # All trades (paper + live)
    └── validationCache.json           # Cross-provider validation results
```

---

## Phase 1: Data Quality (Current)

### Goals:
1. Fix 52-week high using real Yahoo Finance data
2. Get real financial metrics (debt, EBITDA, cash, ROE)
3. Build validation layer to compare providers
4. Add confidence indicators to UI

### Implementation:

#### **Yahoo Finance Integration**
- **Endpoint**: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`
- **Get Real Data**: 52W high, volume, historical prices
- **Endpoint**: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}`
- **Get Financials**: Balance sheet, income statement, key statistics

#### **Data Validator**
```javascript
// Pseudo-code
const validatedData = {
  price: {
    polygon: 150.25,
    yahoo: 150.27,
    confidence: 0.99,  // <1% deviation
    source: 'consensus'
  },
  yearHigh: {
    polygon: null,       // not available
    yahoo: 180.50,
    confidence: 1.0,     // single source
    source: 'yahoo'
  }
}
```

#### **UI Changes**
- Add confidence badges to each metric (🟢 high, 🟡 medium, 🔴 low)
- Show data source and last update time
- Alert when validation fails

---

## Phase 2: Backtesting

### Goals:
1. Store daily ranking snapshots
2. Calculate "If I bought top 5 last month, what's my return?"
3. Track win rates by ranking position
4. Display performance dashboard

### Storage Schema:

```json
// rankingSnapshots.json
{
  "2025-11-10": [
    {
      "rank": 1,
      "ticker": "NVDA",
      "price": 150.25,
      "score": 95.5,
      "metrics": { /* all ranking metrics */ }
    }
  ]
}
```

### Backtest Engine:
- Load snapshot from 30 days ago
- Calculate performance of top N stocks
- Compare vs S&P 500 benchmark
- Show win rate, average return, Sharpe ratio

---

## Phase 3: Alpaca Paper Trading

### Goals:
1. Integrate Alpaca SDK (paper mode)
2. Build unified trading interface
3. Auto-execute trades based on ranking signals
4. Track portfolio performance

### Environment Management:

```javascript
// tradingEnvironment.js
const TRADING_MODE = {
  PAPER: 'paper',
  LIVE: 'live'
};

const getCurrentMode = () => {
  return process.env.TRADING_MODE || TRADING_MODE.PAPER;
};

const getAlpacaConfig = () => {
  const isPaper = getCurrentMode() === TRADING_MODE.PAPER;
  return {
    apiKey: isPaper ? process.env.ALPACA_PAPER_KEY : process.env.ALPACA_LIVE_KEY,
    secretKey: isPaper ? process.env.ALPACA_PAPER_SECRET : process.env.ALPACA_LIVE_SECRET,
    baseUrl: isPaper
      ? 'https://paper-api.alpaca.markets'
      : 'https://api.alpaca.markets'
  };
};
```

### Trading Strategy:
```javascript
// tradingStrategy.js
const generateSignals = (rankedStocks) => {
  const signals = [];

  // BUY: Top 5 ranked stocks
  const topStocks = rankedStocks.slice(0, 5);
  for (const stock of topStocks) {
    signals.push({
      action: 'BUY',
      ticker: stock.ticker,
      reason: `Rank #${stock.rank} - Score: ${stock.score}`,
      confidence: stock.dataConfidence
    });
  }

  // SELL: Stocks that dropped out of top 10
  // ... (implement exit strategy)

  return signals;
};
```

### Unified Dashboard:
- Same UI for paper and live
- Clear environment banner (PAPER MODE / LIVE MODE)
- Real-time P&L
- Position tracking
- Trade history
- Performance metrics (win rate, total return, Sharpe ratio)

---

## Phase 4: Live Trading Ready

### Checklist Before Going Live:
- [ ] Backtesting shows positive returns over 3+ months
- [ ] Paper trading profitable for 1+ month
- [ ] All data validation passes with >95% confidence
- [ ] Risk management rules implemented
- [ ] Stop losses and position sizing configured
- [ ] User explicitly confirms live mode

### Easy Switch:
```bash
# In .env file
TRADING_MODE=paper  # Change to 'live' when ready
```

That's it! Same code, different environment.

---

## API Providers

### Current Stack:
1. **Polygon.io** - Real-time prices, historical data
2. **Yahoo Finance** - 52W high, financial statements (free!)
3. **Alpaca** - Paper + live trading execution

### Why This Stack:
- **Yahoo Finance**: Free, reliable for missing data
- **Alpaca**: Industry standard, great API, free paper trading
- **Polygon**: Already integrated, good data quality

### Future Additions (if needed):
- **IEX Cloud** - Options data, better financials
- **Financial Modeling Prep** - Comprehensive fundamentals
- **TradingView** - Advanced charting (Phase 5)

---

## Success Metrics

### Data Quality:
- ✅ >95% of metrics validated across 2+ sources
- ✅ Zero fake/estimated data in ranking calculations
- ✅ All data <24 hours old

### Backtesting:
- ✅ Top 5 stocks outperform S&P 500 by >5% over 3 months
- ✅ Win rate >60% for top-ranked stocks
- ✅ Positive Sharpe ratio

### Paper Trading:
- ✅ Consistent weekly profits for 4+ weeks
- ✅ Max drawdown <15%
- ✅ All trades executed successfully

---

## Next Steps

1. **Start Phase 1** - Fix data quality (Yahoo Finance integration)
2. **Validate** - Run data quality checks on current stocks
3. **Build confidence** - Show users which metrics are trustworthy
4. **Move to Phase 2** - Prove rankings work with backtesting
5. **Phase 3** - Start paper trading with validated strategies

**Target Timeline:**
- Phase 1: 2-3 days
- Phase 2: 2-3 days
- Phase 3: 3-4 days
- **Total: ~2 weeks to paper trading**
