/**
 * Backtesting Engine - "If I bought top N stocks X days ago..."
 *
 * This module provides functionality to:
 * 1. Load historical snapshots from a date range
 * 2. Simulate buying/selling based on ranking strategies
 * 3. Calculate returns, win rates, and performance metrics
 * 4. Compare against benchmarks (S&P 500)
 */

const snapshotManager = require('./snapshotManager');

/**
 * Calculate daily returns for a position
 *
 * @param {number} buyPrice - Purchase price
 * @param {number} sellPrice - Sale price
 * @returns {number} - Return percentage
 */
function calculateReturn(buyPrice, sellPrice) {
  return ((sellPrice - buyPrice) / buyPrice) * 100;
}

/**
 * Calculate Sharpe Ratio (risk-adjusted return)
 *
 * @param {Array} returns - Array of daily returns (percentages)
 * @param {number} riskFreeRate - Annual risk-free rate (default 4%)
 * @returns {number} - Sharpe ratio
 */
function calculateSharpeRatio(returns, riskFreeRate = 0.04) {
  if (returns.length === 0) return 0;

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize (assuming daily returns)
  const annualizedReturn = avgReturn * 252; // 252 trading days
  const annualizedStdDev = stdDev * Math.sqrt(252);
  const dailyRiskFreeRate = riskFreeRate / 252;

  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

/**
 * Calculate Maximum Drawdown
 *
 * @param {Array} portfolioValues - Array of portfolio values over time
 * @returns {Object} - { maxDrawdown, maxDrawdownPercent, peak, trough }
 */
function calculateMaxDrawdown(portfolioValues) {
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = portfolioValues[0];
  let peakIndex = 0;
  let troughIndex = 0;

  for (let i = 0; i < portfolioValues.length; i++) {
    const value = portfolioValues[i];

    if (value > peak) {
      peak = value;
      peakIndex = i;
    }

    const drawdown = peak - value;
    const drawdownPercent = (drawdown / peak) * 100;

    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
      maxDrawdown = drawdown;
      troughIndex = i;
    }
  }

  return {
    maxDrawdown,
    maxDrawdownPercent,
    peak,
    peakIndex,
    troughIndex,
  };
}

/**
 * Backtest a "Top N" strategy
 *
 * Strategy: Buy top N stocks by rank, hold for rebalance period, repeat
 *
 * @param {Object} options - Backtest configuration
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 * @param {number} options.topN - Number of top stocks to buy (e.g., 5)
 * @param {string} options.rebalanceFrequency - 'daily', 'weekly', 'monthly'
 * @param {number} options.initialCapital - Starting capital (default $100,000)
 * @returns {Object} - Backtest results
 */
async function backtestTopNStrategy(options) {
  const {
    startDate,
    endDate,
    topN = 5,
    rebalanceFrequency = 'daily',
    initialCapital = 100000,
  } = options;

  console.log(
    `🧪 Starting backtest: Top ${topN}, ${rebalanceFrequency} rebalance, ${startDate} to ${endDate}`
  );

  // Load all snapshots in date range
  const snapshots = await snapshotManager.loadSnapshotRange(startDate, endDate);

  if (snapshots.length === 0) {
    throw new Error('No snapshots available for the specified date range');
  }

  console.log(`📊 Loaded ${snapshots.length} snapshots for backtest`);

  // Initialize portfolio
  let capital = initialCapital;
  let positions = new Map(); // symbol -> { quantity, buyPrice, buyDate }
  const trades = [];
  const dailyPortfolioValues = [];
  const dailyReturns = [];

  // Track rebalance dates
  let lastRebalanceDate = null;
  let daysToNextRebalance = 0;

  const rebalanceDays = {
    daily: 1,
    weekly: 7,
    monthly: 30,
  };

  const rebalanceInterval = rebalanceDays[rebalanceFrequency] || 1;

  // Iterate through snapshots (each represents a trading day)
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    const date = snapshot.date;

    // Check if we should rebalance
    const shouldRebalance = !lastRebalanceDate || daysToNextRebalance <= 0;

    if (shouldRebalance) {
      // Sell all current positions
      if (positions.size > 0) {
        for (const [symbol, position] of positions) {
          // Find current price in snapshot
          const stock = snapshot.rankings.find(s => s.symbol === symbol);

          if (stock) {
            const sellPrice = stock.price;
            const proceeds = position.quantity * sellPrice;
            capital += proceeds;

            const returnPct = calculateReturn(position.buyPrice, sellPrice);

            trades.push({
              date,
              symbol,
              side: 'sell',
              quantity: position.quantity,
              price: sellPrice,
              proceeds,
              buyPrice: position.buyPrice,
              buyDate: position.buyDate,
              holdDays: i - position.buyIndex,
              returnPct,
              profit: proceeds - position.quantity * position.buyPrice,
            });

            console.log(`  💰 Sell ${symbol}: ${returnPct.toFixed(2)}% return`);
          }
        }

        positions.clear();
      }

      // Buy top N stocks
      const topStocks = snapshot.rankings.slice(0, topN);
      const capitalPerStock = capital / topN;

      for (const stock of topStocks) {
        const quantity = Math.floor(capitalPerStock / stock.price);
        const cost = quantity * stock.price;

        if (quantity > 0 && cost <= capital) {
          capital -= cost;

          positions.set(stock.symbol, {
            quantity,
            buyPrice: stock.price,
            buyDate: date,
            buyIndex: i,
          });

          trades.push({
            date,
            symbol: stock.symbol,
            side: 'buy',
            quantity,
            price: stock.price,
            cost,
            rank: stock.rank,
          });

          console.log(
            `  🛒 Buy ${stock.symbol} (rank ${stock.rank}): ${quantity} shares @ $${stock.price}`
          );
        }
      }

      lastRebalanceDate = date;
      daysToNextRebalance = rebalanceInterval;
    }

    // Calculate portfolio value
    let positionsValue = 0;
    for (const [symbol, position] of positions) {
      const stock = snapshot.rankings.find(s => s.symbol === symbol);
      if (stock) {
        positionsValue += position.quantity * stock.price;
      }
    }

    const portfolioValue = capital + positionsValue;
    dailyPortfolioValues.push({
      date,
      value: portfolioValue,
      cash: capital,
      positionsValue,
    });

    // Calculate daily return
    if (i > 0) {
      const previousValue = dailyPortfolioValues[i - 1].value;
      const dailyReturn =
        ((portfolioValue - previousValue) / previousValue) * 100;
      dailyReturns.push(dailyReturn);
    }

    daysToNextRebalance--;
  }

  // Close all positions at end (final liquidation)
  const finalSnapshot = snapshots[snapshots.length - 1];
  for (const [symbol, position] of positions) {
    const stock = finalSnapshot.rankings.find(s => s.symbol === symbol);
    if (stock) {
      const sellPrice = stock.price;
      const proceeds = position.quantity * sellPrice;
      capital += proceeds;

      const returnPct = calculateReturn(position.buyPrice, sellPrice);

      trades.push({
        date: finalSnapshot.date,
        symbol,
        side: 'sell',
        quantity: position.quantity,
        price: sellPrice,
        proceeds,
        buyPrice: position.buyPrice,
        buyDate: position.buyDate,
        holdDays: snapshots.length - 1 - position.buyIndex,
        returnPct,
        profit: proceeds - position.quantity * position.buyPrice,
      });
    }
  }

  positions.clear();

  // Calculate final metrics
  const finalValue = capital;
  const totalReturn = ((finalValue - initialCapital) / initialCapital) * 100;
  const totalProfit = finalValue - initialCapital;

  // Win rate (percentage of profitable trades)
  const sellTrades = trades.filter(t => t.side === 'sell');
  const profitableTrades = sellTrades.filter(t => t.profit > 0);
  const winRate =
    sellTrades.length > 0
      ? (profitableTrades.length / sellTrades.length) * 100
      : 0;

  // Average trade return
  const avgReturn =
    sellTrades.length > 0
      ? sellTrades.reduce((sum, t) => sum + t.returnPct, 0) / sellTrades.length
      : 0;

  // Sharpe ratio
  const sharpeRatio = calculateSharpeRatio(dailyReturns);

  // Max drawdown
  const portfolioValues = dailyPortfolioValues.map(d => d.value);
  const maxDrawdown = calculateMaxDrawdown(portfolioValues);

  // Calculate annualized return
  const days = snapshots.length;
  const years = days / 252; // Trading days per year
  const annualizedReturn =
    years > 0
      ? (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100
      : 0;

  console.log(
    `✅ Backtest complete: ${totalReturn.toFixed(2)}% return, ${winRate.toFixed(1)}% win rate`
  );

  return {
    strategy: {
      name: `Top ${topN} Stocks`,
      topN,
      rebalanceFrequency,
      startDate,
      endDate,
      days: snapshots.length,
    },
    performance: {
      initialCapital,
      finalValue,
      totalReturn,
      totalProfit,
      annualizedReturn,
      avgDailyReturn:
        dailyReturns.length > 0
          ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
          : 0,
    },
    trades: {
      total: trades.length,
      buys: trades.filter(t => t.side === 'buy').length,
      sells: trades.filter(t => t.side === 'sell').length,
      profitableTrades: profitableTrades.length,
      losingTrades: sellTrades.length - profitableTrades.length,
      winRate,
      avgReturn,
      avgProfit:
        sellTrades.length > 0
          ? sellTrades.reduce((sum, t) => sum + t.profit, 0) / sellTrades.length
          : 0,
    },
    risk: {
      sharpeRatio,
      maxDrawdown: maxDrawdown.maxDrawdown,
      maxDrawdownPercent: maxDrawdown.maxDrawdownPercent,
      volatility:
        dailyReturns.length > 0
          ? Math.sqrt(
              dailyReturns.reduce((sum, r) => {
                const mean =
                  dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
                return sum + Math.pow(r - mean, 2);
              }, 0) / dailyReturns.length
            ) * Math.sqrt(252)
          : 0, // Annualized volatility
    },
    timeline: {
      dailyValues: dailyPortfolioValues,
      dailyReturns: dailyReturns.map((ret, i) => ({
        date: dailyPortfolioValues[i + 1].date,
        return: ret,
      })),
    },
    allTrades: trades,
  };
}

/**
 * Compare strategy performance to S&P 500 benchmark
 *
 * @param {Object} backtestResults - Results from backtestTopNStrategy
 * @param {number} spyReturn - S&P 500 return over same period (%)
 * @returns {Object} - Comparison metrics
 */
function compareToSP500(backtestResults, spyReturn = 8.5) {
  const alpha = backtestResults.performance.annualizedReturn - spyReturn;
  const outperformance = backtestResults.performance.totalReturn > spyReturn;

  return {
    benchmarkReturn: spyReturn,
    strategyReturn: backtestResults.performance.annualizedReturn,
    alpha,
    outperformance,
    outperformancePercent: alpha,
  };
}

module.exports = {
  backtestTopNStrategy,
  compareToSP500,
  calculateReturn,
  calculateSharpeRatio,
  calculateMaxDrawdown,
};
