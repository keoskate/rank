# Metric Categories - Time-Series vs. Snapshot Metrics

## Overview

Not all financial metrics are suitable for time-series analysis and correlation studies. This document categorizes metrics based on their update frequency and suitability for time-series plotting.

---

## ✅ Time-Series Metrics (Daily Updates)

These metrics change frequently (daily or intraday) and are suitable for:

- Time-series charts
- Correlation analysis
- Trend detection
- Real-time monitoring

| Metric                            | Update Frequency | Notes                                                      |
| --------------------------------- | ---------------- | ---------------------------------------------------------- |
| **Price**                         | Real-time/Daily  | Primary metric, basis for many calculations                |
| **RSI (Relative Strength Index)** | Daily            | Calculated from recent price movements (14-period default) |
| **Volume**                        | Daily            | Trading volume changes every day                           |
| **Daily Price Change %**          | Daily            | Percentage change from previous day's close                |
| **20-Day SMA**                    | Daily            | Simple Moving Average over 20 trading days                 |
| **50-Day SMA**                    | Daily            | Simple Moving Average over 50 trading days                 |
| **Volatility (20-day)**           | Daily            | Rolling standard deviation of returns (annualized)         |
| **Market Cap**                    | Daily            | Calculated from price × shares outstanding                 |
| **Implied Volatility**            | Daily            | Derived from options prices                                |

### Usage in App:

- ✅ Show mini charts in metric cards
- ✅ Include in correlation analysis
- ✅ Plot time-series trends
- ✅ Use for intraday/daily alerts

---

## ❌ Snapshot/Static Metrics (Quarterly or Irregular Updates)

These metrics change infrequently and are **NOT** suitable for daily time-series analysis.

### A) 52-Week Extremes (Staircase Pattern)

**Problem:** These only change when new highs/lows are hit. Most days show flat lines.

| Metric                     | Update Pattern              | Why Not Time-Series?                                       |
| -------------------------- | --------------------------- | ---------------------------------------------------------- |
| **52-Week High**           | Increases only on new highs | Creates staircase pattern - not meaningful for correlation |
| **52-Week Low**            | Decreases only on new lows  | Creates inverse staircase - not meaningful for correlation |
| **Discount from 52W High** | Derived from above          | Reflects price changes, not independent metric             |

**Visualization Example:**

```
52W High Over Time (BAD):
$150 |         ████████████████
$140 |    ███████
$130 | ███
     |_________________________
     Jan  Feb  Mar  Apr  May
(Only goes up in steps - no meaningful daily variation)
```

### B) Quarterly Financial Metrics

**Problem:** These only update 4 times per year (earnings reports). Plotting them daily creates misleading flat lines.

| Metric                     | Update Frequency | Source                                     |
| -------------------------- | ---------------- | ------------------------------------------ |
| **P/E Ratio**              | Quarterly        | Earnings reports (EPS)                     |
| **ROE (Return on Equity)** | Quarterly        | Financial statements                       |
| **Debt/EBITDA**            | Quarterly        | Balance sheet + income statement           |
| **EV/EBITDA**              | Quarterly        | Enterprise value calculation               |
| **Free Cash Flow Yield**   | Quarterly        | Cash flow statement                        |
| **Quick Ratio**            | Quarterly        | Balance sheet (current assets/liabilities) |
| **EBITDA**                 | Quarterly        | Income statement                           |
| **Cash**                   | Quarterly        | Balance sheet                              |
| **Price to Book**          | Quarterly        | Book value updates quarterly               |

**Visualization Example:**

```
P/E Ratio Over Time (BAD):
25 |     ████████████    ████████████
20 | ████            ████
15 |
   |_________________________________
   Jan  Feb  Mar  Apr  May  Jun  Jul
   (Flat for 3 months, jumps at earnings)
```

### C) Slow-Moving Metrics

**Problem:** These change infrequently and don't provide meaningful daily signals.

| Metric       | Update Frequency   | Notes                                    |
| ------------ | ------------------ | ---------------------------------------- |
| **Beta**     | Monthly/Quarterly  | Statistical measure updated periodically |
| **Dividend** | Quarterly/Annually | Only changes when declared               |

### Usage in App:

- ❌ NO mini charts in metric cards
- ❌ Exclude from correlation analysis
- ✅ Display current value as "snapshot"
- ✅ Use for ranking/sorting
- ✅ Label as "(Snapshot value)" or "(Updated quarterly)"
- 🔄 **Future:** Track in Phase 2 (ranking snapshots) for quarterly trend analysis

---

## Phase 2 Enhancement: Quarterly Time-Series

Once we implement the **ranking snapshot system** (Phase 2), we can track quarterly metrics over time:

### Quarterly Snapshots Approach:

```javascript
// Store snapshots every quarter
{
  "2024-Q1": { peRatio: 25.3, debtEbitda: 2.1, roe: 0.18 },
  "2024-Q2": { peRatio: 26.1, debtEbitda: 2.0, roe: 0.19 },
  "2024-Q3": { peRatio: 24.8, debtEbitda: 1.9, roe: 0.21 },
  "2024-Q4": { peRatio: 27.2, debtEbitda: 2.2, roe: 0.20 }
}
```

This enables:

- ✅ Quarterly P/E ratio trends (over years)
- ✅ Debt ratio evolution
- ✅ ROE improvement tracking
- ✅ Correlation between quarterly financials

But **not daily correlation** - that would be meaningless!

---

## Current Implementation

### StockDetailPage.jsx

```javascript
// Define metric categories
const TIME_SERIES_METRICS = ['price', 'rsi', 'impliedVolatility'];
const STATIC_METRICS = [
  'yearHigh',
  'yearLow',
  'discount', // 52W data
  'peRatio',
  'roe',
  'priceToBook', // Quarterly
  'debtEbitda',
  'netDebt',
  'quickRatio',
  'evEbitda',
  'freeCashFlowYield',
  'ebitda',
  'cash',
  'beta',
  'dividend',
  'marketCap',
];

// Conditionally render mini charts
{
  TIME_SERIES_METRICS.includes(key) ? (
    <MiniChart data={chartData} />
  ) : (
    <div>(Snapshot value)</div>
  );
}
```

### MetricCorrelationChart.jsx

```javascript
// Only accept daily-changing metrics
availableMetrics={{
  price: 'Price ($)',
  rsi: 'RSI (14-period)',
  volume: 'Volume',
  priceChange: 'Daily Change (%)',
  sma20: '20-Day SMA ($)',
  sma50: '50-Day SMA ($)',
  volatility: 'Volatility (20-day, %)'
  // NO: peRatio, yearHigh, debtEbitda
}}

// Calculated derived metrics in StockDetailPage:
// - Daily Price Change %: ((price[i] - price[i-1]) / price[i-1]) * 100
// - 20-Day SMA: Simple moving average over 20 periods
// - 50-Day SMA: Simple moving average over 50 periods
// - Volatility: Rolling 20-day std dev of returns (annualized)
```

---

## Key Insights

### Why This Matters:

1. **Meaningful Correlations**
   - Price ↔ RSI: Valid (both change daily)
   - Price ↔ P/E Ratio: **Invalid** (P/E only changes quarterly)
   - 52W High ↔ Anything: **Invalid** (staircase pattern)

2. **User Experience**
   - Don't show flat-line charts (confusing)
   - Don't calculate fake correlations (misleading)
   - Clearly label snapshot vs. time-series data

3. **Data Quality**
   - Use real data where available (Price, Volume)
   - Don't simulate quarterly data (wait for real reports)
   - Don't extrapolate 52W highs (they are what they are)

---

## Future Enhancements

### ✅ Completed:

- [x] Add Volume to correlation analysis
- [x] Add Daily Price Change % to correlation analysis
- [x] Add 20-Day and 50-Day Moving Averages
- [x] Add Volatility (rolling std dev) metric
- [x] Multi-metric correlation visualization (up to 7 metrics)

### Short Term (Phase 2):

- [ ] Implement ranking snapshot system
- [ ] Store daily snapshots of ALL metrics
- [ ] Enable "top 10 stocks last month" backtesting
- [ ] Track quarterly metric evolution

### Long Term (Phase 3+):

- [ ] Add Market Cap (daily) to correlation
- [ ] Compare sector averages over time
- [ ] Alert on unusual correlations (breakdown/formation)
- [ ] Add sector/industry comparison overlays

---

## FAQ

**Q: Why not just plot P/E ratio daily?**
A: P/E ratio only changes 4 times per year (when earnings are reported). Plotting it daily creates a misleading flat line that suggests no change, when actually there's just no new data.

**Q: Can't we calculate P/E daily using current price?**
A: No. P/E = Price / Earnings Per Share. The earnings part only updates quarterly. The price changes, but not the P/E.

**Q: What about 52-week high? It's based on price, which changes daily.**
A: Yes, but 52W high is the **maximum** price over 52 weeks. It only increases when a new high is hit. Most days it stays flat, creating a staircase pattern that has no meaningful correlation with anything.

**Q: When will quarterly metrics be available for correlation?**
A: After Phase 2 (ranking snapshots). We'll store quarterly snapshots and enable quarterly trend analysis. But this will be **quarterly correlation**, not daily.

---

## Summary

| Metric Type                    | Daily Chart | Correlation Analysis | Usage                     |
| ------------------------------ | ----------- | -------------------- | ------------------------- |
| **Daily (Price, RSI, Volume)** | ✅ Yes      | ✅ Yes               | Time-series + correlation |
| **Quarterly (P/E, ROE, Debt)** | ❌ No       | ❌ No (yet)          | Snapshot + ranking        |
| **Static (52W High/Low)**      | ❌ No       | ❌ No                | Snapshot + reference      |

**Remember:** Not all numbers are time-series. Some are snapshots, some are quarterly reports. Treat them accordingly!
