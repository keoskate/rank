# Strategy & ML Validation Workflow

This document outlines the validation process to ensure changes to ML models, trading strategies, or configurations don't break existing functionality.

---

## 1. Validation Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CHANGE DETECTED                                  │
│  (Strategy config, ML model, indicator params, entry/exit rules)    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: UNIT TESTS                                                  │
│  • Run: npm test                                                     │
│  • All component tests must pass                                     │
│  • Exit if failures                                                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: INTEGRATION TESTS                                          │
│  • Run: node tests/integrationTest.js                               │
│  • API endpoint validation                                           │
│  • Database connectivity                                             │
│  • External service mocking                                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: SMOKE TESTS                                                 │
│  • Run: node tests/smokeTest.js                                     │
│  • All pages load without errors                                     │
│  • Critical UI elements render                                       │
│  • No console errors                                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: STRATEGY REGRESSION                                        │
│  • Run baseline backtest on benchmark symbols                        │
│  • Compare results to saved baseline                                 │
│  • Flag if performance degrades > 5%                                 │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 5: A/B TEST CREATION                                          │
│  • Create A/B test: old config vs new config                        │
│  • Run parallel paper trading                                        │
│  • Collect minimum 50 trades                                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 6: PRODUCTION DEPLOYMENT                                       │
│  • Gradual rollout (10% → 50% → 100%)                               │
│  • Monitor real-time metrics                                         │
│  • Rollback if issues detected                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Test Commands

### 2.1 Full Validation Suite
```bash
# Run all validation tests
npm run validate

# This runs:
# 1. npm test (unit tests)
# 2. node tests/smokeTest.js (UI smoke tests)
# 3. node tests/integrationTest.js (API tests)
# 4. node tests/strategyRegressionTest.js (backtest regression)
```

### 2.2 Individual Test Suites
```bash
# Unit tests only
npm test

# Smoke tests (all pages load)
node tests/smokeTest.js

# Integration tests (API + flows)
node tests/integrationTest.js

# Strategy regression (backtest comparison)
node tests/strategyRegressionTest.js

# Screenshot tests (visual regression)
node tests/screenshotTest.js
```

---

## 3. Strategy Regression Testing

### 3.1 Baseline Configuration
The baseline represents a known-good strategy configuration that new changes are compared against.

**Baseline File:** `tests/baselines/strategy-baseline.json`

```json
{
  "version": "1.0.0",
  "createdAt": "2025-12-09",
  "config": {
    "takeProfitPercent": 2,
    "stopLossPercent": 1,
    "minConfidence": 70,
    "rsiOversold": 30,
    "rsiOverbought": 70,
    "adxMinStrength": 20
  },
  "benchmarkSymbols": ["SPY", "AAPL", "MSFT", "GOOG", "AMZN"],
  "testPeriod": {
    "days": 90,
    "endDate": "2025-12-01"
  },
  "expectedResults": {
    "minWinRate": 45,
    "minProfitFactor": 1.1,
    "maxDrawdown": 20
  }
}
```

### 3.2 Regression Test Script
```javascript
// tests/strategyRegressionTest.js

const baseline = require('./baselines/strategy-baseline.json');
const backtestEngine = require('../server/backtestEngine');

async function runRegressionTest(newConfig) {
  const results = {
    passed: true,
    comparisons: []
  };

  for (const symbol of baseline.benchmarkSymbols) {
    // Run backtest with new config
    const newResult = await backtestEngine.runBacktest({
      symbol,
      config: newConfig,
      days: baseline.testPeriod.days
    });

    // Run backtest with baseline config
    const baselineResult = await backtestEngine.runBacktest({
      symbol,
      config: baseline.config,
      days: baseline.testPeriod.days
    });

    // Compare results
    const comparison = {
      symbol,
      baseline: {
        winRate: baselineResult.winRate,
        profitFactor: baselineResult.profitFactor,
        totalPnL: baselineResult.totalPnL
      },
      new: {
        winRate: newResult.winRate,
        profitFactor: newResult.profitFactor,
        totalPnL: newResult.totalPnL
      },
      delta: {
        winRate: newResult.winRate - baselineResult.winRate,
        profitFactor: newResult.profitFactor - baselineResult.profitFactor,
        totalPnL: newResult.totalPnL - baselineResult.totalPnL
      }
    };

    // Check for regression
    if (comparison.delta.winRate < -5 ||
        comparison.delta.profitFactor < -0.2) {
      comparison.status = 'REGRESSION';
      results.passed = false;
    } else if (comparison.delta.winRate > 5) {
      comparison.status = 'IMPROVEMENT';
    } else {
      comparison.status = 'STABLE';
    }

    results.comparisons.push(comparison);
  }

  return results;
}
```

---

## 4. ML Model Validation

### 4.1 Model Performance Baseline
```json
{
  "modelVersion": "1.0.0",
  "lastTrainingDate": "2025-12-01",
  "trainingMetrics": {
    "accuracy": 0.72,
    "loss": 0.45,
    "validationAccuracy": 0.68,
    "validationLoss": 0.52
  },
  "predictionBaseline": {
    "buySignalAccuracy": 65,
    "sellSignalAccuracy": 62,
    "holdAccuracy": 70,
    "falsePositiveRate": 0.18
  }
}
```

### 4.2 Model Validation Steps
1. **Training Data Validation**
   - Check for data quality issues
   - Ensure sufficient sample size (min 1000 trades)
   - Verify class balance

2. **Cross-Validation**
   - 5-fold cross-validation
   - Check for overfitting (train vs val gap < 10%)

3. **Out-of-Sample Testing**
   - Test on held-out data (20% of dataset)
   - Compare to baseline metrics

4. **Live Paper Trading Test**
   - Run 50+ paper trades with new model
   - Compare to historical performance

---

## 5. Pre-Deployment Checklist

### For Strategy Changes
- [ ] Unit tests pass (`npm test`)
- [ ] Smoke tests pass (`node tests/smokeTest.js`)
- [ ] Integration tests pass (`node tests/integrationTest.js`)
- [ ] Backtest regression test shows no degradation
- [ ] Walk-forward optimization completed
- [ ] A/B test running for minimum 3 days
- [ ] Documentation updated

### For ML Model Changes
- [ ] All strategy checklist items above
- [ ] Cross-validation accuracy within baseline
- [ ] Out-of-sample test passes
- [ ] Model saved and versioned
- [ ] Fallback to heuristics tested

### For UI/Config Changes
- [ ] All pages load without errors
- [ ] No console errors or warnings
- [ ] Config changes persist correctly
- [ ] Undo/reset functionality works

---

## 6. Automated CI/CD Integration

### GitHub Actions Workflow
```yaml
# .github/workflows/validate.yml
name: Strategy Validation

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'

    - name: Install dependencies
      run: npm ci

    - name: Run unit tests
      run: npm test

    - name: Build application
      run: npm run build

    - name: Start server
      run: npm run server-dev &

    - name: Wait for server
      run: sleep 5

    - name: Run smoke tests
      run: node tests/smokeTest.js

    - name: Run integration tests
      run: node tests/integrationTest.js

    - name: Run regression tests
      run: node tests/strategyRegressionTest.js

    - name: Upload test artifacts
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: test-results
        path: tests/screenshots/
```

---

## 7. Rollback Procedures

### If Regression Detected
1. **Immediate Actions**
   - Stop any live trading sessions
   - Switch to previous strategy version
   - Alert team via notification

2. **Investigation**
   - Review test logs
   - Identify failing comparisons
   - Analyze root cause

3. **Resolution**
   - Fix issue and re-run validation
   - Or revert to baseline config
   - Document incident

### Strategy Version Control
All strategy configurations are versioned in:
- Database: `strategy_versions` table
- Files: `server/configs/strategies/`

To rollback:
```bash
# Rollback to specific version
node scripts/rollbackStrategy.js --version=1.2.0

# Rollback to last known good
node scripts/rollbackStrategy.js --last-good
```

---

## 8. Metrics Monitoring

### Real-Time Dashboards
Monitor these metrics post-deployment:

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Win Rate | < 40% (3-day rolling) | Review & pause |
| Daily P&L | < -3% | Reduce position size |
| Signal Accuracy | < 50% | Switch to heuristics |
| API Latency | > 500ms | Scale infrastructure |
| Error Rate | > 1% | Investigate logs |

### Performance Analytics
- Track all metrics in `/performance-analytics` page
- Daily automated report generation
- Weekly strategy review meetings

---

## 9. Documentation Requirements

When making changes, update:

1. **CHANGELOG.md** - What changed and why
2. **Strategy configs** - New parameter values
3. **Test baselines** - If intentionally changing behavior
4. **This document** - If process changes

---

## Quick Reference

```bash
# Full validation before any deployment
npm run validate

# Update baseline after intentional improvement
node scripts/updateBaseline.js --confirm

# Create A/B test for new strategy
curl -X POST localhost:8080/api/ab-tests \
  -H "Content-Type: application/json" \
  -d '{"name":"New RSI Params","variants":[...]}'

# Check current strategy version
curl localhost:8080/api/strategy/version
```
