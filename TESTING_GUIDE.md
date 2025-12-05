# 🧪 Testing Guide - MVP Validation

## ✅ Pre-Testing Checklist

Before testing, ensure:

- [ ] Server is running: `npm start`
- [ ] Navigate to: `http://localhost:8080`
- [ ] No console errors on page load
- [ ] Navigation bar is visible

---

## 🏠 Test 1: Home Page - Stock Rankings

**Path:** `/` (home)

### **What to Test:**

1. ✅ Stock list loads and displays
2. ✅ Color-coded metrics (green = good, red = bad)
3. ✅ Can click on a stock to view details
4. ✅ Rankings are visible (rank 1, 2, 3...)

### **Expected Results:**

- See 10+ stocks ranked by score
- Metrics show with color coding
- Clicking stock navigates to detail page

### **Screenshot Checklist:**

- [ ] Rankings display correctly
- [ ] Colors make sense
- [ ] No NaN or undefined values

---

## 📊 Test 2: Stock Detail Page - Metrics

**Path:** `/stock/NVDA` (or any ticker)

### **What to Test:**

1. ✅ Real-Time Metrics section appears
2. ✅ Quarterly Financials section appears
3. ✅ Real-time metrics (Price, RSI) show mini charts
4. ✅ Quarterly metrics show "(Snapshot value)" or "(Updated quarterly)"
5. ✅ Click "Metric Correlation Analysis" section loads

### **Expected Results:**

- Two separate metric sections
- Real-time metrics have charts
- Quarterly metrics do NOT have charts
- Correlation chart appears below metrics

### **Screenshot Checklist:**

- [ ] Metrics separated correctly
- [ ] Charts appear for real-time metrics only
- [ ] Correlation section loads

---

## 📈 Test 3: Multi-Metric Correlation

**Path:** `/stock/NVDA` → Scroll to "Metric Correlation Analysis"

### **What to Test:**

1. ✅ Select "Price" and "RSI" from dropdowns
2. ✅ See normalized overlay chart
3. ✅ See correlation matrix showing r = X.XX
4. ✅ Change timeframe (1W, 1M, 3M, 6M, YTD, 1Y, 5Y)
5. ✅ Add more metrics (Volume, Daily Change %, SMAs)
6. ✅ Correlation updates when metrics added/removed

### **Expected Results:**

- Chart shows 2+ lines overlayed
- Correlation score displays (e.g., r = 0.87)
- Correlation label shows (e.g., "Very Strong")
- Changing timeframe updates correlation

### **What to Look For:**

- **Short Timeframe (1W):** High correlation between Price & RSI
- **Long Timeframe (YTD):** Weaker correlation (RSI mean-reverts)
- **No Leading Gaps:** SMAs should start cleanly (no null values)

### **Screenshot Checklist:**

- [ ] Overlay chart renders
- [ ] Correlation matrix shows
- [ ] Multiple metrics can be selected
- [ ] No gaps in SMA/Volatility data

---

## 🧪 Test 4: Backtesting - Generate History

**Path:** `/backtest`

### **What to Test (First Time):**

1. ✅ See "No Historical Data Available" warning
2. ✅ Click "Generate 90 Days of History" button
3. ✅ Wait ~30 seconds (shows "Generating..." state)
4. ✅ See success alert: "Generated 90 days of historical data"
5. ✅ Warning disappears
6. ✅ "Run Backtest" button becomes enabled

### **Expected Results:**

- Generation takes 20-40 seconds
- Success alert appears
- Files created in `data/snapshots/` directory

### **Console Check:**

Open browser console (F12) and look for:

```
✅ Generated daily snapshot: 2025-12-03 (10 stocks)
✅ Generated daily snapshot: 2025-12-02 (10 stocks)
...
✅ Generated 91 synthetic snapshots
```

### **Screenshot Checklist:**

- [ ] Warning shows before generation
- [ ] Button shows "Generating..." state
- [ ] Success alert appears
- [ ] Warning disappears after generation

---

## 🎯 Test 5: Backtesting - Run Strategy

**Path:** `/backtest` (after generating history)

### **What to Test:**

1. ✅ Configure strategy:
   - Top N: `5`
   - Rebalance: `Daily`
   - Period: `90 days`
   - Capital: `$100,000`
2. ✅ Click "Run Backtest" button
3. ✅ Wait 2-5 seconds
4. ✅ Results appear below

### **Expected Results:**

- **Performance Summary** section shows:
  - Total Return: +/- X.XX%
  - Annualized Return: +/- X.XX%
  - Win Rate: XX.X%
  - Sharpe Ratio: X.XX
  - Max Drawdown: -X.XX%
  - Total Trades: XX
- **Trade Statistics** section shows:
  - Profitable trades count
  - Losing trades count
  - Average return per trade
  - Total profit/loss

### **Validation Checks:**

✅ **Win Rate:** Between 30-70% (realistic)
✅ **Sharpe Ratio:** Between -1 and 3 (typical range)
✅ **Max Drawdown:** Less than 50% (reasonable)
✅ **Total Trades:** > 0 (at least some trades happened)

### **Screenshot Checklist:**

- [ ] Performance metrics display
- [ ] Trade statistics display
- [ ] No NaN or infinity values
- [ ] Numbers make sense

---

## 🔬 Test 6: Backtesting - Strategy Variations

**Goal:** Test different strategies and compare results

### **Test 6A: Conservative Strategy**

- Top N: `3`
- Rebalance: `Monthly`
- Period: `90 days`
- Capital: `$100,000`

**Expected:**

- Fewer total trades (~3-6 trades)
- Potentially higher win rate (fewer bets)
- Different return profile

### **Test 6B: Aggressive Strategy**

- Top N: `10`
- Rebalance: `Daily`
- Period: `90 days`
- Capital: `$100,000`

**Expected:**

- Many more trades (~180+ trades)
- Potentially lower win rate (more bets)
- Higher volatility

### **Comparison:**

Compare results from Test 5, 6A, and 6B:

- Which has best return?
- Which has best Sharpe ratio?
- Which has best win rate?
- Trade-offs between strategies?

---

## 🌐 Test 7: Navigation & Routing

### **What to Test:**

1. ✅ Click "KEO STONKS V2" logo → Goes to home (`/`)
2. ✅ Click "📊 Rankings" button → Goes to home (`/`)
3. ✅ Click "🧪 Backtest" button → Goes to backtest (`/backtest`)
4. ✅ Click "💰 Invest" button → Goes to invest (`/invest`)
5. ✅ Click stock in rankings → Goes to detail (`/stock/TICKER`)
6. ✅ Browser back button works correctly
7. ✅ Direct URL navigation works (paste `/backtest` in address bar)

### **Expected Results:**

- All nav buttons work
- URLs update correctly
- Back/forward buttons work
- No page reloads (SPA behavior)

---

## 🐛 Test 8: Error Handling

### **Test 8A: Invalid Stock Ticker**

- Navigate to `/stock/INVALID`
- Expected: Error message or redirect

### **Test 8B: Run Backtest Without History**

- Clear `data/snapshots/` directory
- Try to run backtest
- Expected: "No snapshots available" error

### **Test 8C: Network Error**

- Stop server
- Try to generate history
- Expected: Error message in UI

---

## 📱 Test 9: Responsive Design (Optional)

### **What to Test:**

1. Resize browser window to mobile width (375px)
2. Check if layout adapts
3. Check if navigation works
4. Check if charts are readable

**Note:** MVP is desktop-first. Mobile optimization is post-MVP.

---

## 🔍 Test 10: Data Quality Validation

### **What to Test:**

1. Navigate to any stock detail page
2. Look for data quality badges (small icons near metrics)
3. Check 52-week high value (should be realistic, not fake)
4. Verify RSI is between 0-100
5. Verify prices are reasonable

### **Expected:**

- 52W high should be close to current price (within 50%)
- RSI should be 0-100
- No obvious "fake" data (like $999,999.99)

---

## ✅ MVP Acceptance Criteria

### **Must Pass:**

- [ ] Home page loads and displays rankings
- [ ] Stock detail page shows metrics correctly
- [ ] Real-time and quarterly metrics are separated
- [ ] Correlation analysis works with 2+ metrics
- [ ] Can generate 90 days of history successfully
- [ ] Can run a backtest and see results
- [ ] Results show realistic performance metrics
- [ ] Navigation works between all pages
- [ ] No critical console errors

### **Nice to Have:**

- [ ] No console warnings
- [ ] Fast page loads (<2s)
- [ ] Smooth animations
- [ ] Clear error messages

---

## 🚨 Common Issues & Solutions

### **Issue: "No Historical Data Available" won't go away**

**Solution:**

1. Check browser console for errors
2. Check `data/snapshots/` directory exists and has files
3. Try refreshing the page
4. Try re-generating history

### **Issue: Backtest returns "No snapshots available"**

**Solution:**

1. Ensure you clicked "Generate History" first
2. Check server console for generation logs
3. Verify files exist: `ls data/snapshots/`

### **Issue: Correlation chart shows gaps at the start**

**Solution:** This was fixed. If still seeing gaps:

1. Check you're on latest code
2. Verify `cleanPrice` is being used (not `trimmedPrice`)
3. Look for console log: "Cleaned data: Removed X leading null values"

### **Issue: Win rate is 100% or 0%**

**Solution:** This might indicate:

1. Synthetic data is too predictable
2. Backtest logic error
3. Expected with very small samples (<5 trades)

### **Issue: Sharpe ratio is negative**

**Solution:** This is NORMAL if strategy loses money. Negative Sharpe = losing strategy.

---

## 📊 Expected Ranges (Synthetic Data)

Since we're using synthetic data (random walk), expect:

- **Total Return:** -20% to +30%
- **Win Rate:** 40% to 65%
- **Sharpe Ratio:** 0.5 to 2.0
- **Max Drawdown:** 5% to 25%

**Real historical data will have different ranges.**

---

## 🎓 Understanding Test Results

### **Good Backtest Results:**

- Win Rate > 55%
- Sharpe Ratio > 1.0
- Max Drawdown < 15%
- Consistent returns across different strategies

### **Concerning Results:**

- Win Rate < 40%
- Sharpe Ratio < 0 (losing strategy)
- Max Drawdown > 30%
- Huge variance between strategies

---

## 📸 Screenshot Checklist for User

Please capture screenshots of:

1. [ ] Home page with rankings
2. [ ] Stock detail page (real-time metrics section)
3. [ ] Stock detail page (quarterly metrics section)
4. [ ] Correlation analysis with 3+ metrics selected
5. [ ] Backtest page before generating history
6. [ ] Backtest page after successful generation
7. [ ] Backtest results (performance summary)
8. [ ] Backtest results (trade statistics)

**These screenshots will help identify any UI issues!**

---

## ✅ Final Validation

After completing all tests, verify:

- [ ] All core features work as expected
- [ ] No critical bugs or errors
- [ ] Performance is acceptable (no major lag)
- [ ] UI is clean and intuitive
- [ ] Can successfully complete a full workflow:
  - View rankings → Click stock → Analyze correlations → Run backtest → View results

---

## 🎉 Success Criteria Met!

If all tests pass, the MVP is **COMPLETE and FUNCTIONAL**! 🚀

Ready to iterate on features from the BACKLOG.md! 💪
