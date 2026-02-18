/**
 * Analytics Utilities
 *
 * Shared calculation functions for strategy analytics visualizations.
 */

/**
 * Calculate equity curve from trades
 * @param {Array} trades - Array of trade objects with pnl
 * @param {number} startingCapital - Starting capital (default 10000)
 * @returns {Array} Equity curve data points
 */
export function calculateEquityCurve(trades, startingCapital = 10000) {
  if (!trades || trades.length === 0) {
    return [{ index: 0, equity: startingCapital, highWaterMark: startingCapital, drawdown: 0 }];
  }

  let equity = startingCapital;
  let highWaterMark = startingCapital;

  return trades.map((trade, index) => {
    equity += trade.pnl || 0;
    highWaterMark = Math.max(highWaterMark, equity);
    const drawdown = highWaterMark > 0 ? ((highWaterMark - equity) / highWaterMark) * 100 : 0;

    return {
      index,
      date: trade.exitDate || trade.date || new Date().toISOString(),
      equity,
      highWaterMark,
      drawdown,
      pnl: trade.pnl,
      symbol: trade.symbol,
    };
  });
}

/**
 * Calculate rolling metrics over a window
 * @param {Array} trades - Array of trades
 * @param {number} windowSize - Rolling window size
 * @returns {Array} Rolling metrics data points
 */
export function calculateRollingMetrics(trades, windowSize = 20) {
  if (!trades || trades.length < windowSize) {
    return [];
  }

  const results = [];

  for (let i = windowSize - 1; i < trades.length; i++) {
    const window = trades.slice(i - windowSize + 1, i + 1);
    const metrics = calculateMetrics(window);

    results.push({
      index: i,
      date: trades[i].exitDate || trades[i].date,
      ...metrics,
    });
  }

  return results;
}

/**
 * Calculate trading metrics from trades
 * @param {Array} trades - Array of trades
 * @returns {Object} Calculated metrics
 */
export function calculateMetrics(trades) {
  if (!trades || trades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      expectancy: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      totalPnl: 0,
      maxDrawdown: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  // Calculate max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let equity = 0;

  for (const trade of trades) {
    equity += trade.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    expectancy,
    profitFactor: profitFactor === Infinity ? 999 : profitFactor,
    avgWin,
    avgLoss,
    totalPnl: totalWins - totalLosses,
    maxDrawdown,
  };
}

/**
 * Run Monte Carlo simulation
 * @param {Array} trades - Array of trades
 * @param {number} simulations - Number of simulations to run
 * @param {number} startingCapital - Starting capital
 * @returns {Object} Monte Carlo results with percentile bands
 */
export function runMonteCarloSimulation(trades, simulations = 1000, startingCapital = 10000) {
  if (!trades || trades.length === 0) {
    return { percentiles: [], simulations: [] };
  }

  const allCurves = [];

  // Run simulations
  for (let sim = 0; sim < simulations; sim++) {
    // Shuffle trades randomly
    const shuffled = [...trades].sort(() => Math.random() - 0.5);

    // Calculate equity curve for this simulation
    let equity = startingCapital;
    const curve = [equity];

    for (const trade of shuffled) {
      equity += trade.pnl || 0;
      curve.push(equity);
    }

    allCurves.push(curve);
  }

  // Calculate percentiles at each trade index
  const percentiles = [];
  const tradeCount = trades.length + 1;

  for (let i = 0; i < tradeCount; i++) {
    const valuesAtPoint = allCurves.map(curve => curve[i] || curve[curve.length - 1]).sort((a, b) => a - b);

    percentiles.push({
      index: i,
      p5: valuesAtPoint[Math.floor(simulations * 0.05)],
      p25: valuesAtPoint[Math.floor(simulations * 0.25)],
      p50: valuesAtPoint[Math.floor(simulations * 0.50)],
      p75: valuesAtPoint[Math.floor(simulations * 0.75)],
      p95: valuesAtPoint[Math.floor(simulations * 0.95)],
      min: valuesAtPoint[0],
      max: valuesAtPoint[simulations - 1],
    });
  }

  // Calculate final statistics
  const finalValues = allCurves.map(curve => curve[curve.length - 1]);
  const sortedFinal = [...finalValues].sort((a, b) => a - b);

  // Calculate max drawdowns for each simulation
  const maxDrawdowns = allCurves.map(curve => {
    let peak = startingCapital;
    let maxDD = 0;
    for (const equity of curve) {
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }
    return maxDD;
  });

  const sortedDrawdowns = [...maxDrawdowns].sort((a, b) => a - b);

  return {
    percentiles,
    sampleCurves: allCurves.slice(0, 100), // Keep first 100 for visualization
    statistics: {
      finalEquity: {
        p5: sortedFinal[Math.floor(simulations * 0.05)],
        p25: sortedFinal[Math.floor(simulations * 0.25)],
        p50: sortedFinal[Math.floor(simulations * 0.50)],
        p75: sortedFinal[Math.floor(simulations * 0.75)],
        p95: sortedFinal[Math.floor(simulations * 0.95)],
        mean: finalValues.reduce((a, b) => a + b, 0) / simulations,
      },
      maxDrawdown: {
        p5: sortedDrawdowns[Math.floor(simulations * 0.05)],
        p50: sortedDrawdowns[Math.floor(simulations * 0.50)],
        p95: sortedDrawdowns[Math.floor(simulations * 0.95)],
        mean: maxDrawdowns.reduce((a, b) => a + b, 0) / simulations,
      },
      profitProbability: (finalValues.filter(v => v > startingCapital).length / simulations) * 100,
    },
  };
}

/**
 * Calculate MFE/MAE data for scatter plot
 * @param {Array} trades - Array of trades with MFE/MAE data
 * @returns {Array} Formatted data for scatter plot
 */
export function calculateMFEMAEData(trades) {
  return trades
    .filter(t => t.maxFavorableExcursion !== undefined && t.maxAdverseExcursion !== undefined)
    .map(t => ({
      mfe: Math.abs(t.maxFavorableExcursion || 0),
      mae: Math.abs(t.maxAdverseExcursion || 0),
      pnl: t.pnl,
      pnlPercent: t.pnlPercent || 0,
      isWinner: t.pnl > 0,
      symbol: t.symbol,
      date: t.exitDate || t.date,
    }));
}

/**
 * Calculate trade distribution histogram data
 * @param {Array} trades - Array of trades
 * @param {number} bins - Number of histogram bins
 * @returns {Array} Histogram data
 */
export function calculateTradeDistribution(trades, bins = 20) {
  if (!trades || trades.length === 0) {
    return [];
  }

  const pnls = trades.map(t => t.pnl || 0);
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);
  const range = max - min;
  const binWidth = range / bins;

  const histogram = Array(bins).fill(null).map((_, i) => ({
    binStart: min + i * binWidth,
    binEnd: min + (i + 1) * binWidth,
    binMid: min + (i + 0.5) * binWidth,
    count: 0,
    isProfit: min + (i + 0.5) * binWidth > 0,
  }));

  for (const pnl of pnls) {
    const binIndex = Math.min(Math.floor((pnl - min) / binWidth), bins - 1);
    histogram[binIndex].count++;
  }

  return histogram;
}

/**
 * Calculate time-based heatmap data
 * @param {Array} trades - Array of trades with timestamps
 * @returns {Object} Heatmap data by hour and day of week
 */
export function calculateTimeHeatmap(trades) {
  if (!trades || trades.length === 0) {
    return { byHour: [], byDayOfWeek: [], byHourAndDay: [] };
  }

  // Initialize buckets
  const hourBuckets = Array(24).fill(null).map((_, i) => ({ hour: i, totalPnl: 0, count: 0, avgPnl: 0 }));
  const dayBuckets = Array(7).fill(null).map((_, i) => ({
    day: i,
    dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i],
    totalPnl: 0,
    count: 0,
    avgPnl: 0,
  }));

  // 2D grid for hour x day
  const grid = Array(7).fill(null).map(() =>
    Array(24).fill(null).map(() => ({ totalPnl: 0, count: 0, avgPnl: 0 }))
  );

  for (const trade of trades) {
    const date = new Date(trade.entryDate || trade.date);
    if (isNaN(date.getTime())) continue;

    const hour = date.getHours();
    const day = date.getDay();

    hourBuckets[hour].totalPnl += trade.pnl || 0;
    hourBuckets[hour].count++;

    dayBuckets[day].totalPnl += trade.pnl || 0;
    dayBuckets[day].count++;

    grid[day][hour].totalPnl += trade.pnl || 0;
    grid[day][hour].count++;
  }

  // Calculate averages
  hourBuckets.forEach(b => { b.avgPnl = b.count > 0 ? b.totalPnl / b.count : 0; });
  dayBuckets.forEach(b => { b.avgPnl = b.count > 0 ? b.totalPnl / b.count : 0; });

  const flatGrid = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell = grid[day][hour];
      flatGrid.push({
        day,
        dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
        hour,
        totalPnl: cell.totalPnl,
        count: cell.count,
        avgPnl: cell.count > 0 ? cell.totalPnl / cell.count : 0,
      });
    }
  }

  return {
    byHour: hourBuckets,
    byDayOfWeek: dayBuckets.filter(b => b.day >= 1 && b.day <= 5), // Weekdays only
    byHourAndDay: flatGrid,
  };
}

/**
 * Calculate R-Multiple distribution
 * @param {Array} trades - Array of trades
 * @param {number} riskPerTrade - Default risk per trade if not specified
 * @returns {Array} R-Multiple data
 */
export function calculateRMultiples(trades, riskPerTrade = null) {
  return trades.map(t => {
    // Calculate R based on stop loss if available
    const risk = t.riskAmount || t.stopLossAmount || riskPerTrade || Math.abs(t.pnl) * 0.5;
    const rMultiple = risk > 0 ? t.pnl / risk : 0;

    return {
      rMultiple,
      pnl: t.pnl,
      risk,
      date: t.exitDate || t.date,
      symbol: t.symbol,
    };
  });
}

/**
 * Format currency value
 * @param {number} value - Value to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value) {
  if (value === null || value === undefined) return '-';
  const prefix = value >= 0 ? '' : '-';
  return prefix + '$' + Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format percentage value
 * @param {number} value - Value to format
 * @param {number} decimals - Decimal places
 * @returns {string} Formatted percentage string
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return value.toFixed(decimals) + '%';
}

/**
 * Get color based on P&L value
 * @param {number} value - P&L value
 * @returns {string} Color code
 */
export function getPnlColor(value) {
  if (value > 0) return '#10b981'; // Green
  if (value < 0) return '#ef4444'; // Red
  return '#6b7280'; // Gray
}

/**
 * Chart color palette
 */
export const chartColors = {
  profit: '#10b981',
  loss: '#ef4444',
  neutral: '#6b7280',
  primary: '#3b82f6',
  secondary: '#8b5cf6',
  tertiary: '#f59e0b',
  background: '#1f2937',
  gridLine: '#374151',
  text: '#9ca3af',
  textLight: '#d1d5db',
};
