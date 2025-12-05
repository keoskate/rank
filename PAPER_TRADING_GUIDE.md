# Paper Trading Simulation System

## Overview

Comprehensive paper trading simulation environment for testing investment strategies with virtual money and real stock prices. Perfect for strategy development without financial risk.

## ✅ **COMPLETE IMPLEMENTATION**

### 🎯 **Core Features**

1. **Virtual Portfolio Management**
   - $100,000 starting cash (configurable)
   - Real-time position tracking with P&L calculations
   - Average price calculation for multiple buys
   - Portfolio value tracking (cash + positions)

2. **Order Execution Simulation**
   - Market orders (executed at current price)
   - Limit orders (executed when price is favorable)
   - Buy/sell validation (sufficient cash/shares)
   - Realistic order execution logic

3. **Live Market Data Integration**
   - Uses existing stock price APIs (Polygon.io/Alpha Vantage)
   - Real-time position valuation updates
   - Current market prices for order execution

4. **Performance Analytics**
   - Total portfolio value tracking
   - Individual position P&L with percentages
   - Trade history with execution details
   - Portfolio reset functionality

## 🚀 **How to Use**

### 1. **Access Paper Trading**

```bash
# Start the application
npm run build
npm run server-dev

# Navigate to http://localhost:8080/
# Go to Invest tab → Connect Schwab Account → Paper Trading tab
```

### 2. **Create Portfolio**

- Click "Create Paper Trading Portfolio"
- Starts with $100,000 virtual cash
- Ready to place orders immediately

### 3. **Place Orders**

```
Symbol: AAPL, NVDA, TSLA, etc.
Side: Buy or Sell
Quantity: Number of shares
Order Type: Market or Limit
Limit Price: (if using limit orders)
```

### 4. **Track Performance**

- View portfolio summary (total value, cash, P&L)
- Monitor individual positions with real-time updates
- Review trade history with execution details

## 🔧 **API Endpoints**

### **Create/Get Portfolio**

```bash
POST /api/paper-trading/portfolio
{
  "userId": "demo_user",
  "initialCash": 100000
}
```

### **Execute Trade**

```bash
POST /api/paper-trading/order
{
  "userId": "demo_user",
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 50,
  "orderType": "market"
}
```

### **Get Portfolio Status**

```bash
GET /api/paper-trading/portfolio/{userId}
```

### **Reset Portfolio**

```bash
POST /api/paper-trading/portfolio/{userId}/reset
{
  "initialCash": 100000
}
```

## 💡 **Strategy Testing Use Cases**

### **1. Ranking-Based Strategy**

```javascript
// Test top-ranked stocks from your scoring system
// Example: Buy top 5 ranked stocks equally weighted
const topStocks = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'TSLA'];
const cashPerStock = 20000; // $20K per position

topStocks.forEach(symbol => {
  executePaperTrade({
    symbol,
    side: 'buy',
    quantity: Math.floor(cashPerStock / getCurrentPrice(symbol)),
    orderType: 'market',
  });
});
```

### **2. Momentum Strategy**

```javascript
// Buy stocks showing positive momentum
// Sell positions that have declined
if (stockData.discount < 0.15) {
  // Less than 15% from 52-week high
  buyStock(symbol, quantity);
}
```

### **3. Value Strategy**

```javascript
// Buy undervalued stocks based on metrics
if (stockData.peRatio < 15 && stockData.priceToBook < 2) {
  buyStock(symbol, quantity);
}
```

### **4. Portfolio Rebalancing**

```javascript
// Monthly rebalancing based on new rankings
// Sell underperforming positions
// Buy new top-ranked stocks
```

## 🎯 **Key Advantages**

### **vs. Real Money Trading:**

- ✅ **Zero Risk** - Test strategies without losing money
- ✅ **Unlimited Experiments** - Try different approaches
- ✅ **Quick Iterations** - Reset and test new strategies instantly
- ✅ **Educational** - Learn trading concepts safely

### **vs. Other Paper Trading Tools:**

- ✅ **Integrated with Your Ranking System** - Test strategies directly
- ✅ **Real Market Data** - Uses live stock prices
- ✅ **Customizable** - Modify starting cash, add new features
- ✅ **Free** - No subscription fees

## 🔮 **Future Enhancements**

### **Strategy Automation** (Next Phase)

```javascript
// Automated strategy execution
const strategy = {
  name: 'Top 10 Momentum',
  rebalanceFrequency: 'weekly',
  stockSelection: topRankedStocks(10),
  allocation: 'equal_weight',
  stopLoss: 0.1, // 10% stop loss
  targetProfit: 0.25, // 25% profit target
};

executeStrategy(strategy);
```

### **Backtesting Engine** (Next Phase)

```javascript
// Test strategies on historical data
const backtest = {
  strategy: momentumStrategy,
  startDate: '2023-01-01',
  endDate: '2024-01-01',
  initialCash: 100000,
};

runBacktest(backtest);
```

## 📊 **Example Usage Session**

```bash
# 1. Create portfolio
curl -X POST /api/paper-trading/portfolio \
  -d '{"userId": "strategy_test", "initialCash": 100000}'

# 2. Buy top ranked stock
curl -X POST /api/paper-trading/order \
  -d '{"userId": "strategy_test", "symbol": "NVDA", "side": "buy", "quantity": 25}'

# 3. Check performance
curl /api/paper-trading/portfolio/strategy_test

# 4. Sell if needed
curl -X POST /api/paper-trading/order \
  -d '{"userId": "strategy_test", "symbol": "NVDA", "side": "sell", "quantity": 10}'
```

## 🎉 **Status: PRODUCTION READY**

The paper trading simulation is fully functional and ready for:

- ✅ Strategy development and testing
- ✅ Educational purposes
- ✅ Risk-free experimentation
- ✅ Portfolio management practice
- ✅ Integration with your stock ranking system

**Perfect solution for testing different buy/sell strategies without financial risk while using real market data for accurate simulation.**
