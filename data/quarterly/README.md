# Quarterly Metric Snapshots

This directory stores quarterly financial metrics for each stock to enable QoQ/YoY comparisons.

## File Structure

```
data/quarterly/
  NVDA.json
  AAPL.json
  TSLA.json
  ...
```

## Quarterly Snapshot Format

Each file contains the quarterly history for one stock:

```json
{
  "symbol": "NVDA",
  "lastUpdated": "2025-12-03T00:00:00.000Z",
  "quarters": [
    {
      "quarter": "2025-Q4",
      "date": "2025-11-01",
      "fiscalYear": 2025,
      "fiscalQuarter": 4,

      // Quarterly financial metrics
      "peRatio": 65.3,
      "debtEbitda": 0.2,
      "roe": 0.45,
      "priceToBook": 12.5,
      "freeCashFlowYield": 0.03,
      "quickRatio": 2.1,
      "ebitda": 50000000000,
      "cash": 25000000000,
      "netDebt": -15000000000,
      "evEbitda": 35.2,

      // Price at time of earnings
      "priceAtEarnings": 148.50,

      // Data quality
      "dataSource": "polygon",
      "confidence": 0.95,
      "status": "verified"
    },
    {
      "quarter": "2025-Q3",
      "date": "2025-08-01",
      "fiscalYear": 2025,
      "fiscalQuarter": 3,
      "peRatio": 68.1,
      "debtEbitda": 0.3,
      "roe": 0.42,
      "priceToBook": 13.1,
      "freeCashFlowYield": 0.028,
      "quickRatio": 2.0,
      "ebitda": 48000000000,
      "cash": 23000000000,
      "netDebt": -13000000000,
      "evEbitda": 36.5,
      "priceAtEarnings": 135.20,
      "dataSource": "polygon",
      "confidence": 0.95,
      "status": "verified"
    }
    // ... more quarters (store 8-12 quarters for 2-3 years of history)
  ],
  "metadata": {
    "totalQuarters": 12,
    "earliestQuarter": "2023-Q1",
    "latestQuarter": "2025-Q4"
  }
}
```

## Calculations

### Quarter-over-Quarter (QoQ)
```javascript
const qoq = ((current - previous) / previous) * 100;
// Example: P/E Ratio Q4 2025 vs Q3 2025
// (65.3 - 68.1) / 68.1 * 100 = -4.1% (improvement)
```

### Year-over-Year (YoY)
```javascript
const yoy = ((current - yearAgo) / yearAgo) * 100;
// Example: ROE Q4 2025 vs Q4 2024
// (0.45 - 0.38) / 0.38 * 100 = +18.4% (growth)
```

## Usage

### Load Quarterly Data
```javascript
const { loadQuarterlyData } = require('../snapshotManager');
const data = await loadQuarterlyData('NVDA');
```

### Calculate QoQ
```javascript
const { calculateQoQ } = require('../snapshotManager');
const qoq = calculateQoQ('NVDA', 'peRatio');
// Returns: { value: -4.1, trend: 'improving', quarters: ['2025-Q4', '2025-Q3'] }
```

### Calculate YoY
```javascript
const { calculateYoY } = require('../snapshotManager');
const yoy = calculateYoY('NVDA', 'roe');
// Returns: { value: 18.4, trend: 'growth', quarters: ['2025-Q4', '2024-Q4'] }
```

## Data Updates

Quarterly data should be updated when:
1. Company reports earnings (typically 4x per year)
2. Manual refresh triggered by user
3. API fetch detects new quarterly data available

Update frequency: **Quarterly** (every ~3 months)
