# Financial Calculations Validation & Documentation

## Overview

This document validates the financial ratio calculations used in the stock ranking system and provides expected ranges and interpretations for each metric.

## Data Sources

- **Alpha Vantage**: Uses real financial data from company overview
- **Polygon.io**: Uses estimated calculations based on market data (price, volume)

## Financial Metrics Breakdown

### 1. Discount (%)

**Definition**: Percentage discount from 52-week high to current price
**Formula**: `(yearHigh - currentPrice) / yearHigh`
**Expected Range**: 0% - 50%
**Interpretation**:

- Lower values (0-10%): Stock near 52-week high, potentially overvalued
- Higher values (30-50%): Stock significantly below peak, potential value opportunity

**Current Implementation**:

- Alpha Vantage: Uses real 52-week high data
- Polygon: Estimates yearHigh as 1.1x-1.6x current price (NEEDS IMPROVEMENT)

### 2. Debt/EBITDA Ratio

**Definition**: Total debt divided by EBITDA (Earnings Before Interest, Taxes, Depreciation, Amortization)
**Formula**: `totalDebt / EBITDA`
**Expected Range**: 0.5 - 6.0
**Interpretation**:

- Low (0.5-2.0): Healthy debt levels, strong ability to service debt
- Medium (2.0-4.0): Moderate debt burden, manageable
- High (4.0+): High debt burden, potential financial stress

**Current Implementation**:

- Alpha Vantage: Calculated from real debt and EBITDA data
- Polygon: Hardcoded range 1.5-4.5 (ACCEPTABLE for demo)

### 3. Beta

**Definition**: Measure of stock's volatility relative to market (S&P 500)
**Formula**: Statistical correlation coefficient
**Expected Range**: 0.0 - 3.0
**Interpretation**:

- Low (0.0-0.8): Less volatile than market, defensive stocks
- Market (0.8-1.2): Similar volatility to market
- High (1.2+): More volatile than market, growth/tech stocks

**Current Implementation**:

- Alpha Vantage: Uses real beta from market data
- Polygon: Range 0.5-2.0 (ACCEPTABLE for demo)

### 4. Quick Ratio (Acid Test)

**Definition**: (Current Assets - Inventory) / Current Liabilities
**Formula**: `(cash + marketableSecurities + receivables) / currentLiabilities`
**Expected Range**: 0.2 - 3.0
**Interpretation**:

- Low (0.2-0.8): Potential liquidity issues
- Healthy (0.8-1.5): Good liquidity position
- High (1.5+): Excellent liquidity, possibly excess cash

**Current Implementation**:

- Alpha Vantage: Uses real quick ratio data
- Polygon: Range 0.8-1.6 (ACCEPTABLE for demo)

### 5. EV/EBITDA

**Definition**: Enterprise Value divided by EBITDA
**Formula**: `(marketCap + totalDebt - cash) / EBITDA`
**Expected Range**: 5 - 30
**Interpretation**:

- Low (5-12): Potentially undervalued
- Fair (12-18): Fairly valued
- High (18+): Potentially overvalued or high-growth expected

**Current Implementation**:

- Alpha Vantage: Uses real EV/EBITDA data
- Polygon: Range 8-28 (ACCEPTABLE for demo)

### 6. Net Debt

**Definition**: Total debt minus cash and cash equivalents
**Formula**: `totalDebt - cash`
**Expected Range**: Can be negative (net cash) to billions
**Interpretation**:

- Negative: Company has more cash than debt (strong position)
- Positive low: Manageable debt levels
- Positive high: High debt burden

**Current Implementation**:

- Alpha Vantage: Estimated as (bookValue _ 0.2) - (marketCap _ 0.05)
- Polygon: Based on market cap proxy (NEEDS IMPROVEMENT)

## Issues Identified & Recommendations

### Critical Issues:

1. **Polygon Year High**: Currently 1.1x-1.6x current price is unrealistic
2. **Net Debt Calculation**: Both implementations use rough estimates
3. **EBITDA Estimation**: Polygon uses market cap proxy, not realistic

### Recommended Fixes:

#### 1. Fix Polygon Year High Calculation

```javascript
// Instead of: currentPrice * yearHighMultiplier
// Use historical high simulation:
const yearHighMultiplier = 1.2 + (symbolHash % 80) / 100; // Range: 1.2 - 2.0
const calculatedYearHigh = formatNumber(currentPrice * yearHighMultiplier);
```

#### 2. Improve Net Debt Calculation

```javascript
// More realistic estimation based on industry averages
const industryDebtRatio = 0.3 + (symbolHash % 40) / 100; // 0.3 - 0.7
const estimatedMarketCap = currentPrice * 1000000; // Rough estimate
const estimatedDebt = estimatedMarketCap * industryDebtRatio;
const estimatedCash = estimatedMarketCap * 0.15; // 15% cash ratio
const netDebt = Math.max(0, estimatedDebt - estimatedCash);
```

#### 3. Add Data Quality Indicators

Add flags to indicate whether data is real or estimated:

```javascript
return {
  // ... other fields
  dataQuality: {
    discount: 'estimated',
    debtEbitda: 'estimated',
    beta: 'estimated',
    quickRatio: 'estimated',
    evEbitda: 'estimated',
  },
};
```

## Validation Test Cases

### Test Stock: AAPL (Example)

**Expected Realistic Ranges**:

- Discount: 5-25%
- Debt/EBITDA: 0.5-2.0 (Apple has low debt)
- Beta: 0.8-1.3 (Tech stock, moderate volatility)
- Quick Ratio: 0.8-1.2 (Efficient working capital)
- EV/EBITDA: 15-25 (Premium tech valuation)

### Test Stock: XOM (Example)

**Expected Realistic Ranges**:

- Discount: 10-40%
- Debt/EBITDA: 1.0-3.0 (Energy sector debt)
- Beta: 0.9-1.4 (Cyclical stock)
- Quick Ratio: 0.6-1.0 (Capital intensive)
- EV/EBITDA: 8-15 (Value sector)

## Ranking Impact Analysis

### High Weight Metrics (0.15-0.4):

1. **Discount (0.4)**: Drives value investing approach
2. **Debt/EBITDA (0.15)**: Financial health screening
3. **Net Debt (0.15)**: Leverage assessment
4. **Beta (0.15)**: Risk adjustment

### Medium Weight Metrics (0.05-0.1):

1. **Quick Ratio (0.1)**: Liquidity check
2. **Dividend (0.05)**: Income component

### Display Only (0.0):

1. **EV/EBITDA**: Valuation context
2. **EBITDA**: Earnings context
3. **Cash**: Balance sheet context

## Conclusion

The current implementation provides reasonable demo data for stock ranking, but several improvements are needed for production use:

1. **Priority 1**: Fix unrealistic year high calculations
2. **Priority 2**: Add data quality indicators
3. **Priority 3**: Improve net debt and EBITDA estimations
4. **Priority 4**: Consider industry-specific ratio ranges

The ranking algorithm's heavy weighting on discount (40%) creates a value-oriented strategy, which is appropriate for the current metric set.
