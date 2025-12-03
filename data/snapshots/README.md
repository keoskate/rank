# Daily Ranking Snapshots

This directory stores daily snapshots of stock rankings to enable backtesting.

## File Structure

```
data/snapshots/
  2025-12-03.json
  2025-12-02.json
  2025-12-01.json
  ...
```

## Snapshot Format

Each snapshot file contains the complete ranking state for that day:

```json
{
  "date": "2025-12-03",
  "timestamp": "2025-12-03T00:00:00.000Z",
  "generatedAt": "2025-12-03T06:00:00.000Z",
  "stockListName": "Tech Giants",
  "rankings": [
    {
      "symbol": "NVDA",
      "rank": 1,
      "score": 95.2,
      "price": 150.00,
      "marketCap": 3700000000000,

      // Daily metrics (change frequently)
      "rsi": 68.5,
      "volume": 45000000,
      "impliedVolatility": 0.42,

      // Quarterly metrics (only update on earnings)
      "peRatio": 65.3,
      "debtEbitda": 0.2,
      "roe": 0.45,
      "priceToBook": 12.5,
      "freeCashFlowYield": 0.03,
      "quickRatio": 2.1,
      "ebitda": 50000000000,
      "cash": 25000000000,

      // Snapshot metrics
      "yearHigh": 140.50,
      "yearLow": 90.20,
      "discount": 0.068,
      "beta": 1.75,
      "dividend": 0.001,

      // Metadata
      "lastQuarterUpdate": "2025-11-01",
      "dataQuality": {
        "overallConfidence": 0.95,
        "status": "verified"
      }
    }
    // ... more stocks
  ],
  "metadata": {
    "totalStocks": 10,
    "dataSource": "polygon",
    "version": "1.0"
  }
}
```

## Usage

### Generate Snapshot
```javascript
const { generateDailySnapshot } = require('../snapshotManager');
await generateDailySnapshot();
```

### Load Snapshot
```javascript
const { loadSnapshot } = require('../snapshotManager');
const snapshot = await loadSnapshot('2025-12-03');
```

### Backtest Strategy
```javascript
const { backtestStrategy } = require('../backtestEngine');
const results = await backtestStrategy({
  startDate: '2025-11-03',
  endDate: '2025-12-03',
  strategy: 'top5',
  rebalanceFrequency: 'daily'
});
```
