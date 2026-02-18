/**
 * Schwab CSV Import Service
 *
 * Parses Schwab trade exports and analyzes trading patterns
 * to learn from wins and mistakes.
 */

const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Storage for imported trades
const userTrades = new Map();

// Path for persisting trades
const TRADES_DIR = path.join(__dirname, '..', 'data', 'training');

/**
 * Parse Schwab CSV export
 * @param {string|Buffer} csvData - CSV file content
 * @param {string} userId - User identifier
 * @returns {object} Parsed trades and summary
 */
function parseCSV(csvData, userId = 'default_user') {
  const csvString = Buffer.isBuffer(csvData)
    ? csvData.toString('utf-8')
    : csvData;

  // Parse CSV
  const parsed = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: header => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (parsed.errors.length > 0) {
    console.warn('[Schwab Import] Parse warnings:', parsed.errors);
  }

  const trades = [];
  const rawRows = parsed.data;

  for (const row of rawRows) {
    // Schwab CSV typically has these columns:
    // Date, Action, Symbol, Description, Quantity, Price, Fees & Comm, Amount
    const trade = normalizeSchwabRow(row);
    if (trade) {
      trades.push(trade);
    }
  }

  // Sort by date
  trades.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Match buys with sells to create complete trades
  const completeTrades = matchBuysAndSells(trades);

  // Store for user
  const existing = userTrades.get(userId) || [];
  userTrades.set(userId, [...existing, ...completeTrades]);

  // Save to disk
  saveTrades(userId, completeTrades);

  return {
    success: true,
    rawTransactions: trades.length,
    completeTrades: completeTrades.length,
    trades: completeTrades,
    summary: generateSummary(completeTrades),
  };
}

/**
 * Normalize Schwab CSV row to standard format
 * @param {object} row - Raw CSV row
 * @returns {object|null} Normalized trade or null if invalid
 */
function normalizeSchwabRow(row) {
  try {
    // Try different column name variations
    const date = row.date || row.trade_date || row.settlement_date;
    const action = row.action || row.type || row.transaction_type;
    const symbol = (row.symbol || row.ticker || '')
      .replace(/\s+/g, '')
      .toUpperCase();
    const quantity = parseFloat(row.quantity || row.qty || row.shares || 0);
    const price = parseFloat(
      (row.price || row.trade_price || '0')
        .toString()
        .replace('$', '')
        .replace(',', '')
    );
    const amount = parseFloat(
      (row.amount || row.total || row.net_amount || '0')
        .toString()
        .replace('$', '')
        .replace(',', '')
        .replace('(', '-')
        .replace(')', '')
    );
    const fees = parseFloat(
      (row.fees___comm || row.fees || row.commission || '0')
        .toString()
        .replace('$', '')
        .replace(',', '')
    );

    // Skip non-trade rows
    if (!symbol || !action || quantity === 0) return null;

    // Determine side
    const actionLower = action.toLowerCase();
    let side = null;

    if (
      actionLower.includes('buy') ||
      actionLower.includes('purchased') ||
      actionLower === 'b'
    ) {
      side = 'buy';
    } else if (
      actionLower.includes('sell') ||
      actionLower.includes('sold') ||
      actionLower === 's'
    ) {
      side = 'sell';
    }

    if (!side) return null;

    return {
      id: uuidv4(),
      date: new Date(date).toISOString(),
      symbol,
      side,
      quantity: Math.abs(quantity),
      price: Math.abs(price),
      amount: Math.abs(amount),
      fees: Math.abs(fees),
      rawAction: action,
    };
  } catch (error) {
    console.warn('[Schwab Import] Error parsing row:', error.message);
    return null;
  }
}

/**
 * Match buy and sell transactions to create complete trades
 * @param {Array} transactions - All transactions
 * @returns {Array} Complete trades with entry/exit
 */
function matchBuysAndSells(transactions) {
  const completeTrades = [];
  const openPositions = new Map(); // symbol -> [{ trade, remainingQty }]

  for (const tx of transactions) {
    const { symbol, side, quantity, price, date, fees } = tx;

    if (side === 'buy') {
      // Add to open positions
      const positions = openPositions.get(symbol) || [];
      positions.push({
        trade: tx,
        remainingQty: quantity,
      });
      openPositions.set(symbol, positions);
    } else if (side === 'sell') {
      // Match with open positions (FIFO)
      const positions = openPositions.get(symbol) || [];
      let sellQtyRemaining = quantity;
      let totalCost = 0;
      let totalSold = 0;
      const entryDates = [];

      while (sellQtyRemaining > 0 && positions.length > 0) {
        const oldest = positions[0];
        const matchQty = Math.min(sellQtyRemaining, oldest.remainingQty);

        totalCost += matchQty * oldest.trade.price;
        totalSold += matchQty;
        entryDates.push(oldest.trade.date);

        oldest.remainingQty -= matchQty;
        sellQtyRemaining -= matchQty;

        if (oldest.remainingQty === 0) {
          positions.shift();
        }
      }

      if (totalSold > 0) {
        const avgEntryPrice = totalCost / totalSold;
        const profit = (price - avgEntryPrice) * totalSold - fees;
        const profitPercent = ((price - avgEntryPrice) / avgEntryPrice) * 100;
        const holdingDays = Math.round(
          (new Date(date) - new Date(entryDates[0])) / (1000 * 60 * 60 * 24)
        );

        completeTrades.push({
          id: uuidv4(),
          symbol,
          entryDate: entryDates[0],
          exitDate: date,
          entryPrice: avgEntryPrice,
          exitPrice: price,
          quantity: totalSold,
          profit,
          profitPercent,
          holdingDays,
          fees,
          isWin: profit > 0,
          // Trading style classification
          tradingStyle:
            holdingDays < 1
              ? 'scalping'
              : holdingDays <= 5
                ? 'dayTrading'
                : 'swing',
        });
      }

      openPositions.set(symbol, positions);
    }
  }

  return completeTrades;
}

/**
 * Generate trading summary and insights
 * @param {Array} trades - Complete trades
 * @returns {object} Summary statistics
 */
function generateSummary(trades) {
  if (trades.length === 0) {
    return { message: 'No complete trades found' };
  }

  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);

  const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
  const avgProfit = totalProfit / trades.length;
  const avgWin =
    wins.length > 0 ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? losses.reduce((s, t) => s + t.profit, 0) / losses.length
      : 0;

  // Best and worst trades
  const sortedByProfit = [...trades].sort((a, b) => b.profit - a.profit);
  const bestTrade = sortedByProfit[0];
  const worstTrade = sortedByProfit[sortedByProfit.length - 1];

  // Trading style breakdown
  const byStyle = {
    scalping: trades.filter(t => t.tradingStyle === 'scalping'),
    dayTrading: trades.filter(t => t.tradingStyle === 'dayTrading'),
    swing: trades.filter(t => t.tradingStyle === 'swing'),
  };

  // Symbol performance
  const symbolStats = {};
  trades.forEach(t => {
    if (!symbolStats[t.symbol]) {
      symbolStats[t.symbol] = { trades: 0, wins: 0, profit: 0 };
    }
    symbolStats[t.symbol].trades++;
    if (t.isWin) symbolStats[t.symbol].wins++;
    symbolStats[t.symbol].profit += t.profit;
  });

  // Sort symbols by profit
  const topSymbols = Object.entries(symbolStats)
    .sort((a, b) => b[1].profit - a[1].profit)
    .slice(0, 10);
  const worstSymbols = Object.entries(symbolStats)
    .sort((a, b) => a[1].profit - b[1].profit)
    .slice(0, 5);

  // Time analysis
  const hourlyPerformance = {};
  trades.forEach(t => {
    const hour = new Date(t.entryDate).getHours();
    if (!hourlyPerformance[hour]) {
      hourlyPerformance[hour] = { trades: 0, wins: 0, profit: 0 };
    }
    hourlyPerformance[hour].trades++;
    if (t.isWin) hourlyPerformance[hour].wins++;
    hourlyPerformance[hour].profit += t.profit;
  });

  // Day of week analysis
  const dayPerformance = {};
  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  trades.forEach(t => {
    const day = dayNames[new Date(t.entryDate).getDay()];
    if (!dayPerformance[day]) {
      dayPerformance[day] = { trades: 0, wins: 0, profit: 0 };
    }
    dayPerformance[day].trades++;
    if (t.isWin) dayPerformance[day].wins++;
    dayPerformance[day].profit += t.profit;
  });

  // Holding period analysis
  const avgHoldingWin =
    wins.length > 0
      ? wins.reduce((s, t) => s + t.holdingDays, 0) / wins.length
      : 0;
  const avgHoldingLoss =
    losses.length > 0
      ? losses.reduce((s, t) => s + t.holdingDays, 0) / losses.length
      : 0;

  return {
    overview: {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: ((wins.length / trades.length) * 100).toFixed(1),
      totalProfit: totalProfit.toFixed(2),
      avgProfit: avgProfit.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor:
        avgLoss !== 0 ? Math.abs(avgWin / avgLoss).toFixed(2) : 'N/A',
      expectancy: (
        (wins.length / trades.length) * avgWin +
        (losses.length / trades.length) * avgLoss
      ).toFixed(2),
    },
    bestTrade: bestTrade
      ? {
          symbol: bestTrade.symbol,
          profit: bestTrade.profit.toFixed(2),
          profitPercent: bestTrade.profitPercent.toFixed(2),
          holdingDays: bestTrade.holdingDays,
        }
      : null,
    worstTrade: worstTrade
      ? {
          symbol: worstTrade.symbol,
          profit: worstTrade.profit.toFixed(2),
          profitPercent: worstTrade.profitPercent.toFixed(2),
          holdingDays: worstTrade.holdingDays,
        }
      : null,
    byStyle: {
      scalping: {
        trades: byStyle.scalping.length,
        winRate:
          byStyle.scalping.length > 0
            ? (
                (byStyle.scalping.filter(t => t.isWin).length /
                  byStyle.scalping.length) *
                100
              ).toFixed(1)
            : 0,
        profit: byStyle.scalping.reduce((s, t) => s + t.profit, 0).toFixed(2),
      },
      dayTrading: {
        trades: byStyle.dayTrading.length,
        winRate:
          byStyle.dayTrading.length > 0
            ? (
                (byStyle.dayTrading.filter(t => t.isWin).length /
                  byStyle.dayTrading.length) *
                100
              ).toFixed(1)
            : 0,
        profit: byStyle.dayTrading.reduce((s, t) => s + t.profit, 0).toFixed(2),
      },
      swing: {
        trades: byStyle.swing.length,
        winRate:
          byStyle.swing.length > 0
            ? (
                (byStyle.swing.filter(t => t.isWin).length /
                  byStyle.swing.length) *
                100
              ).toFixed(1)
            : 0,
        profit: byStyle.swing.reduce((s, t) => s + t.profit, 0).toFixed(2),
      },
    },
    topSymbols: topSymbols.map(([symbol, stats]) => ({
      symbol,
      trades: stats.trades,
      winRate: ((stats.wins / stats.trades) * 100).toFixed(1),
      profit: stats.profit.toFixed(2),
    })),
    worstSymbols: worstSymbols.map(([symbol, stats]) => ({
      symbol,
      trades: stats.trades,
      winRate: ((stats.wins / stats.trades) * 100).toFixed(1),
      profit: stats.profit.toFixed(2),
    })),
    timing: {
      bestHours: Object.entries(hourlyPerformance)
        .sort((a, b) => b[1].profit - a[1].profit)
        .slice(0, 3)
        .map(([hour, stats]) => ({
          hour: `${hour}:00`,
          trades: stats.trades,
          profit: stats.profit.toFixed(2),
        })),
      bestDays: Object.entries(dayPerformance)
        .sort((a, b) => b[1].profit - a[1].profit)
        .map(([day, stats]) => ({
          day,
          trades: stats.trades,
          winRate:
            stats.trades > 0
              ? ((stats.wins / stats.trades) * 100).toFixed(1)
              : 0,
          profit: stats.profit.toFixed(2),
        })),
    },
    holdingPeriod: {
      avgWinHolding: avgHoldingWin.toFixed(1),
      avgLossHolding: avgHoldingLoss.toFixed(1),
      insight:
        avgHoldingLoss > avgHoldingWin * 1.5
          ? 'You tend to hold losers longer than winners. Consider tighter stop losses.'
          : avgHoldingWin > avgHoldingLoss * 1.5
            ? 'You exit winners too early. Consider trailing stops to capture more upside.'
            : 'Your holding periods are balanced.',
    },
    insights: generateInsights(trades, wins, losses),
  };
}

/**
 * Generate actionable insights from trade analysis
 * @param {Array} trades - All trades
 * @param {Array} wins - Winning trades
 * @param {Array} losses - Losing trades
 * @returns {Array} Insight strings
 */
function generateInsights(trades, wins, losses) {
  const insights = [];
  const winRate = (wins.length / trades.length) * 100;

  // Win rate insights
  if (winRate < 40) {
    insights.push(
      'Your win rate is below 40%. Focus on improving entry timing and being more selective with trades.'
    );
  } else if (winRate > 60) {
    insights.push(
      'Strong win rate! Your entry selection is working well. Consider sizing up on high-conviction setups.'
    );
  }

  // Average win vs loss
  const avgWin =
    wins.length > 0 ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length)
      : 0;

  if (avgLoss > avgWin * 1.5) {
    insights.push(
      'Your average loss is significantly larger than average win. Implement stricter stop losses.'
    );
  }

  if (avgWin > avgLoss * 2) {
    insights.push(
      'Excellent risk/reward! Your winners are significantly larger than losers.'
    );
  }

  // Consecutive losses
  let maxConsecutiveLosses = 0;
  let currentStreak = 0;
  for (const trade of trades) {
    if (!trade.isWin) {
      currentStreak++;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  if (maxConsecutiveLosses >= 5) {
    insights.push(
      `You had a max losing streak of ${maxConsecutiveLosses}. Consider pausing after 3 consecutive losses.`
    );
  }

  // Position sizing consistency
  const quantities = trades.map(t => t.quantity);
  const avgQty = quantities.reduce((a, b) => a + b, 0) / quantities.length;
  const qtyVariance =
    quantities.reduce((s, q) => s + Math.pow(q - avgQty, 2), 0) /
    quantities.length;

  if (qtyVariance > avgQty * avgQty) {
    insights.push(
      'Your position sizing varies significantly. Consider more consistent sizing based on account risk.'
    );
  }

  // Early exit detection
  const earlyExits = losses.filter(
    t => t.profitPercent > -2 && t.profitPercent < 0
  );
  if (earlyExits.length > losses.length * 0.3) {
    insights.push(
      'Many losses are small (-0% to -2%). You might be stopped out too early. Consider wider stops.'
    );
  }

  return insights;
}

/**
 * Save trades to disk
 * @param {string} userId - User identifier
 * @param {Array} trades - Trades to save
 */
function saveTrades(userId, trades) {
  try {
    if (!fs.existsSync(TRADES_DIR)) {
      fs.mkdirSync(TRADES_DIR, { recursive: true });
    }

    const filePath = path.join(TRADES_DIR, `${userId}_trades.json`);
    const existing = fs.existsSync(filePath)
      ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      : [];

    const combined = [...existing, ...trades];
    fs.writeFileSync(filePath, JSON.stringify(combined, null, 2));

    console.log(`[Schwab Import] Saved ${trades.length} trades for ${userId}`);
  } catch (error) {
    console.error('[Schwab Import] Error saving trades:', error);
  }
}

/**
 * Load trades from disk
 * @param {string} userId - User identifier
 * @returns {Array} Saved trades
 */
function loadTrades(userId) {
  try {
    const filePath = path.join(TRADES_DIR, `${userId}_trades.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (error) {
    console.error('[Schwab Import] Error loading trades:', error);
  }
  return [];
}

/**
 * Get trades for user
 * @param {string} userId - User identifier
 * @returns {Array} User's trades
 */
function getTrades(userId) {
  // Check memory first
  if (userTrades.has(userId)) {
    return userTrades.get(userId);
  }

  // Load from disk
  const trades = loadTrades(userId);
  if (trades.length > 0) {
    userTrades.set(userId, trades);
  }

  return trades;
}

/**
 * Clear trades for user
 * @param {string} userId - User identifier
 */
function clearTrades(userId) {
  userTrades.delete(userId);

  const filePath = path.join(TRADES_DIR, `${userId}_trades.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Create training dataset from trades
 * @param {string} userId - User identifier
 * @returns {Array} Training data format
 */
function createTrainingDataset(userId) {
  const trades = getTrades(userId);

  // Format for ML training
  // Each trade needs candle data leading up to entry
  // This would be fetched from historical data
  return trades.map(trade => ({
    symbol: trade.symbol,
    entryDate: trade.entryDate,
    exitDate: trade.exitDate,
    outcome: trade.isWin ? 1 : 0,
    profitPercent: trade.profitPercent,
    holdingDays: trade.holdingDays,
    tradingStyle: trade.tradingStyle,
  }));
}

module.exports = {
  parseCSV,
  getTrades,
  clearTrades,
  generateSummary,
  createTrainingDataset,
  loadTrades,
  saveTrades,
};
