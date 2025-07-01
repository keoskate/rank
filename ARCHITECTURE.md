# Rank App - Architecture Overview

## 🏗️ Critical Components & Data Flow

### 📁 Project Structure

```
rank/
├── server/
│   └── index.js              # Express server (serves React app)
├── react-client/
│   ├── dist/                 # Built React app (served by Express)
│   └── src/
│       ├── index.jsx         # Entry point
│       ├── Components/
│       │   ├── App.jsx       # Root component + routing
│       │   ├── HomePage.jsx  # Main dashboard
│       │   ├── StonkBoard.jsx # 🔥 CORE: Stock ranking engine
│       │   ├── StockBoard.jsx # LEGACY: Old implementation
│       │   ├── Scoreboard.jsx # CEF data rankings
│       │   ├── StockUtils.js # 🔥 CORE: API utilities & config
│       │   ├── WeightSlider.jsx # UI: Weight adjustment
│       │   └── ColorColumn.jsx  # UI: Table cell formatting
│       ├── stock-data_20.js  # Cached stock data (current)
│       ├── stock-data_19.js  # Cached stock data (2019)
│       └── rank-data.js      # CEF data
└── package.json
```

## 🔥 Critical Paths

### 1. **Data Flow Pipeline**

```
Stock Symbols → Yahoo Finance API → Data Parsing → Ranking Calculation → UI Display
```

### 2. **Core Components** (DO NOT BREAK!)

#### **StonkBoard.jsx** - The Heart of the App

- **componentDidMount()**: Initial data loading
- **setupDataStructures()**: Core ranking engine
- **rankCols()**: Relative position ranking algorithm
- **rankColsStd()**: Statistical deviation ranking algorithm
- **render()**: Interactive table with controls

#### **StockUtils.js** - API & Configuration

- **getStockData()**: Yahoo Finance API integration
- **parseData()**: Raw API → App data structure
- **STOCK_COLUMNS**: Column weights & multipliers

#### **HomePage.jsx** - Main View Controller

- Board type switching (CEF vs Stock)
- Primary user interface

### 3. **Ranking Algorithm (Dual System)**

#### Algorithm #1: Relative Ranking

- Sorts stocks by each metric (1st, 2nd, 3rd...)
- Applies user-defined weights
- Good for relative performance comparison

#### Algorithm #2: Statistical Ranking

- Calculates standard deviations from mean
- Identifies statistical outliers
- Powers conditional cell coloring (green/red)

**Final Rank = Average(Relative Rank, Statistical Rank)**

### 4. **Key Configuration**

#### Current Column Weights:

- **Discount**: 0.4 (from 52-week high)
- **Debt/EBITDA**: 0.15
- **Net Debt**: 0.15
- **Beta**: 0.15 (volatility)
- **Quick Ratio**: 0.1 (liquidity)
- **Dividend**: 0.05

#### Stock Groups:

- **COVID_19**: 20 pandemic-era stocks
- **MEME_STOCKS**: Reddit favorites (GME, AMC, etc.)
- **KEO_STOCKS**: Personal picks
- Currently using: **TEST_STOCKS** (COVID_19 subset)

## ⚠️ Important Notes

### API Integration

- **Provider**: Yahoo Finance via RapidAPI
- **Rate Limit**: 500 requests/month (free tier)
- **API Key**: Embedded in StockUtils.js
- **Debug Mode**: Uses cached data to preserve quota

### Performance Considerations

- **Throttling**: Delays between API requests
- **Batch Loading**: Loads 5 stocks at a time
- **Background Loading**: Initial 5 stocks show immediately

### Data Structure

```javascript
// Stock Object Schema
{
  rank: 0,              // Final calculated rank
  ticker: "AAPL",       // Stock symbol
  name: "Apple Inc.",   // Company name
  industry: "Technology", // Sector
  price: 150.25,        // Current price
  yearHigh: 180.50,     // 52-week high
  discount: 0.17,       // Discount from high
  debtEbitda: 2.5,      // Debt/EBITDA ratio
  netDebt: 1500000000,  // Total debt - cash
  beta: 1.2,            // Volatility vs market
  quickRatio: 1.5,      // Liquidity ratio
  dividend: 0.88,       // Annual dividend
  ebitda: 50000000000,  // Earnings metric
  evEbitda: 15,         // Valuation ratio
  cash: 200000000000    // Cash holdings
}
```

## 🚨 Before Making Changes

1. **Test with DEBUG=true** to avoid API quota usage
2. **Backup current rankings** before algorithm changes
3. **Check weight totals** don't exceed 1.0
4. **Verify column multipliers** (1 = higher is better, -1 = lower is better)
5. **Test both ranking algorithms** work correctly

---

_This document maps the critical paths for safe development and debugging._
