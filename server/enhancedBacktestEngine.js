/**
 * Enhanced Backtest Engine
 *
 * Advanced backtesting with what-if scenarios, Monte Carlo simulation,
 * and strategy optimization.
 */

const polygonClient = require('./polygonClient');
const technicalIndicators = require('./technicalIndicatorsService');
const assetUtils = require('./assetUtils');

/**
 * Helper to get aggregates with automatic crypto detection
 * @param {string} symbol - Symbol to fetch
 * @param {number} multiplier - Timespan multiplier
 * @param {string} timespan - minute, hour, day, etc.
 * @param {Object} options - { from, to }
 * @returns {Array} - Array of OHLCV bars
 */
async function getAggregatesWithCryptoDetection(symbol, multiplier, timespan, options) {
  const upperSymbol = symbol.toUpperCase();
  const isCryptoSymbol = assetUtils.CRYPTO_BASE_TO_PAIR[upperSymbol] ||
                         upperSymbol.includes('/USD') ||
                         upperSymbol.startsWith('X:');

  if (isCryptoSymbol) {
    return polygonClient.getCryptoAggregates(symbol, multiplier, timespan, options);
  }
  return polygonClient.getAggregates(symbol, multiplier, timespan, options);
}

/**
 * Run a comprehensive backtest with what-if analysis
 * @param {object} params - Backtest parameters
 * @returns {object} Backtest results with what-if comparisons
 */
async function runEnhancedBacktest(params) {
  const {
    symbol,
    startDate,
    endDate,
    strategy = 'momentum',
    initialCapital = 100000,
    positionSizePercent = 10,
    profitTarget = 5,
    stopLoss = 3,
    timeframe = 'day',
  } = params;

  // Fetch historical data (with crypto detection)
  const candles = await getAggregatesWithCryptoDetection(symbol, 1, timeframe, {
    from: new Date(startDate),
    to: new Date(endDate),
  });

  if (!candles || candles.length < 50) {
    throw new Error('Insufficient historical data for backtest');
  }

  // Run base backtest
  const baseResults = await runBacktest({
    candles,
    initialCapital,
    positionSizePercent,
    profitTarget,
    stopLoss,
    strategy,
  });

  // Run what-if scenarios
  const whatIfResults = await runWhatIfScenarios(candles, baseResults, {
    initialCapital,
    positionSizePercent,
    strategy,
  });

  // Run Monte Carlo simulation
  const monteCarloResults = runMonteCarloSimulation(baseResults.trades, 1000);

  return {
    symbol,
    period: { startDate, endDate },
    baseResults,
    whatIfResults,
    monteCarloResults,
    recommendations: generateRecommendations(baseResults, whatIfResults),
  };
}

/**
 * Run basic backtest
 * @param {object} params - Backtest parameters
 * @returns {object} Backtest results
 */
async function runBacktest(params) {
  const {
    candles,
    initialCapital,
    positionSizePercent,
    profitTarget,
    stopLoss,
    strategy,
  } = params;

  let capital = initialCapital;
  let position = null;
  const trades = [];
  const equityCurve = [{ date: candles[0].date, value: capital }];

  // Calculate indicators for entire period
  const indicators = technicalIndicators.getAllIndicators(candles);

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];
    const currentPrice = candle.close;

    // Get indicator values at this point
    const rsiIdx =
      i - (candles.length - (indicators.rsi?.history?.length || 0));
    const rsi = indicators.rsi?.history?.[rsiIdx] || 50;
    const macd = indicators.macd?.history?.[rsiIdx]?.histogram || 0;

    // Check for exit if in position
    if (position) {
      const pnlPercent =
        ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Check profit target
      if (pnlPercent >= profitTarget) {
        const pnl = (currentPrice - position.entryPrice) * position.quantity;
        trades.push({
          ...position,
          exitDate: candle.date,
          exitPrice: currentPrice,
          pnl,
          pnlPercent,
          exitReason: 'profit_target',
          holdingBars: i - position.entryIndex,
        });
        capital += position.quantity * currentPrice;
        position = null;
      }
      // Check stop loss
      else if (pnlPercent <= -stopLoss) {
        const pnl = (currentPrice - position.entryPrice) * position.quantity;
        trades.push({
          ...position,
          exitDate: candle.date,
          exitPrice: currentPrice,
          pnl,
          pnlPercent,
          exitReason: 'stop_loss',
          holdingBars: i - position.entryIndex,
        });
        capital += position.quantity * currentPrice;
        position = null;
      }
    }

    // Check for entry if not in position
    if (!position) {
      const shouldEnter = evaluateEntry(strategy, {
        rsi,
        macd,
        candle,
        prevCandle,
      });

      if (shouldEnter) {
        const positionSize = capital * (positionSizePercent / 100);
        const quantity = Math.floor(positionSize / currentPrice);

        if (quantity > 0) {
          position = {
            entryDate: candle.date,
            entryPrice: currentPrice,
            quantity,
            entryIndex: i,
            entryRsi: rsi,
            entryMacd: macd,
          };
          capital -= quantity * currentPrice;
        }
      }
    }

    // Record equity curve
    const currentValue =
      capital + (position ? position.quantity * currentPrice : 0);
    equityCurve.push({ date: candle.date, value: currentValue });
  }

  // Close any remaining position
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const pnl = (lastCandle.close - position.entryPrice) * position.quantity;
    const pnlPercent =
      ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100;

    trades.push({
      ...position,
      exitDate: lastCandle.date,
      exitPrice: lastCandle.close,
      pnl,
      pnlPercent,
      exitReason: 'end_of_period',
      holdingBars: candles.length - 1 - position.entryIndex,
    });
    capital += position.quantity * lastCandle.close;
  }

  // Calculate statistics
  const stats = calculateStats(trades, equityCurve, initialCapital);

  return {
    trades,
    equityCurve,
    stats,
    finalCapital: capital,
    totalReturn: ((capital - initialCapital) / initialCapital) * 100,
  };
}

/**
 * Evaluate entry signal based on strategy
 * @param {string} strategy - Strategy name
 * @param {object} data - Market data
 * @returns {boolean} Whether to enter
 */
function evaluateEntry(strategy, { rsi, macd, candle, prevCandle }) {
  switch (strategy) {
    case 'momentum':
      // RSI between 30-50 and MACD positive
      return rsi > 30 && rsi < 50 && macd > 0;

    case 'meanReversion':
      // RSI oversold and price recovering
      return rsi < 30 && candle.close > prevCandle.close;

    case 'breakout':
      // Price breaking above previous high with volume
      return (
        candle.close > prevCandle.high &&
        candle.volume > prevCandle.volume * 1.5
      );

    case 'trend':
      // RSI bullish and MACD positive crossover
      return rsi > 50 && rsi < 70 && macd > 0;

    default:
      return false;
  }
}

/**
 * Run what-if scenarios
 * @param {Array} candles - Historical candles
 * @param {object} baseResults - Base backtest results
 * @param {object} params - Parameters
 * @returns {object} What-if results
 */
async function runWhatIfScenarios(candles, baseResults, params) {
  const scenarios = {};

  // Scenario 1: What if entered 1 bar earlier?
  scenarios.earlyEntry = await runBacktestWithModification(candles, params, {
    entryOffset: -1,
  });

  // Scenario 2: What if entered 1 bar later?
  scenarios.lateEntry = await runBacktestWithModification(candles, params, {
    entryOffset: 1,
  });

  // Scenario 3: What if used tighter stop loss?
  scenarios.tighterStop = await runBacktest({
    candles,
    ...params,
    profitTarget: 5,
    stopLoss: 2,
  });

  // Scenario 4: What if used wider stop loss?
  scenarios.widerStop = await runBacktest({
    candles,
    ...params,
    profitTarget: 5,
    stopLoss: 5,
  });

  // Scenario 5: What if held for higher profit target?
  scenarios.higherTarget = await runBacktest({
    candles,
    ...params,
    profitTarget: 8,
    stopLoss: 3,
  });

  // Scenario 6: What if used trailing stop?
  scenarios.trailingStop = await runBacktestWithTrailingStop(candles, params);

  // Scenario 7: What if doubled down on losers?
  scenarios.averageDown = await runBacktestWithAveraging(
    candles,
    params,
    'down'
  );

  // Scenario 8: What if scaled into winners?
  scenarios.scaleUp = await runBacktestWithAveraging(candles, params, 'up');

  // Calculate improvement/degradation
  Object.keys(scenarios).forEach(key => {
    scenarios[key].improvement =
      scenarios[key].totalReturn - baseResults.totalReturn;
    scenarios[key].improvementPercent =
      ((scenarios[key].totalReturn - baseResults.totalReturn) /
        Math.abs(baseResults.totalReturn)) *
      100;
  });

  return scenarios;
}

/**
 * Run backtest with entry offset modification
 * @param {Array} candles - Historical candles
 * @param {object} params - Parameters
 * @param {object} modification - Modification to apply
 * @returns {object} Modified backtest results
 */
async function runBacktestWithModification(candles, params, modification) {
  const { entryOffset = 0 } = modification;

  let capital = params.initialCapital;
  let position = null;
  const trades = [];
  const equityCurve = [{ date: candles[0].date, value: capital }];

  const indicators = technicalIndicators.getAllIndicators(candles);

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const currentPrice = candle.close;

    // Exit logic (same as base)
    if (position) {
      const pnlPercent =
        ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      if (pnlPercent >= 5 || pnlPercent <= -3) {
        const pnl = (currentPrice - position.entryPrice) * position.quantity;
        trades.push({
          ...position,
          exitDate: candle.date,
          exitPrice: currentPrice,
          pnl,
          pnlPercent,
        });
        capital += position.quantity * currentPrice;
        position = null;
      }
    }

    // Modified entry logic
    if (!position) {
      const entryIndex = i + entryOffset;
      if (entryIndex >= 50 && entryIndex < candles.length) {
        const rsiIdx =
          entryIndex -
          (candles.length - (indicators.rsi?.history?.length || 0));
        const rsi = indicators.rsi?.history?.[rsiIdx] || 50;
        const macd = indicators.macd?.history?.[rsiIdx]?.histogram || 0;

        const shouldEnter = evaluateEntry(params.strategy, {
          rsi,
          macd,
          candle: candles[entryIndex],
          prevCandle: candles[entryIndex - 1],
        });

        if (shouldEnter) {
          const positionSize = capital * (params.positionSizePercent / 100);
          const entryPrice = candles[entryIndex].close;
          const quantity = Math.floor(positionSize / entryPrice);

          if (quantity > 0) {
            position = {
              entryDate: candles[entryIndex].date,
              entryPrice,
              quantity,
              entryIndex: entryIndex,
            };
            capital -= quantity * entryPrice;
          }
        }
      }
    }

    const currentValue =
      capital + (position ? position.quantity * currentPrice : 0);
    equityCurve.push({ date: candle.date, value: currentValue });
  }

  // Close remaining position
  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    capital += position.quantity * lastPrice;
  }

  const stats = calculateStats(trades, equityCurve, params.initialCapital);

  return {
    trades,
    stats,
    finalCapital: capital,
    totalReturn:
      ((capital - params.initialCapital) / params.initialCapital) * 100,
  };
}

/**
 * Run backtest with trailing stop
 * @param {Array} candles - Historical candles
 * @param {object} params - Parameters
 * @returns {object} Backtest results
 */
async function runBacktestWithTrailingStop(candles, params) {
  let capital = params.initialCapital;
  let position = null;
  const trades = [];
  const equityCurve = [{ date: candles[0].date, value: capital }];
  const trailingStopPercent = 3;

  const indicators = technicalIndicators.getAllIndicators(candles);

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const currentPrice = candle.close;

    if (position) {
      // Update trailing stop
      if (currentPrice > position.highSinceEntry) {
        position.highSinceEntry = currentPrice;
        position.trailingStop = currentPrice * (1 - trailingStopPercent / 100);
      }

      // Check trailing stop
      if (currentPrice <= position.trailingStop) {
        const pnl = (currentPrice - position.entryPrice) * position.quantity;
        const pnlPercent =
          ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

        trades.push({
          ...position,
          exitDate: candle.date,
          exitPrice: currentPrice,
          pnl,
          pnlPercent,
          exitReason: 'trailing_stop',
        });
        capital += position.quantity * currentPrice;
        position = null;
      }
    }

    if (!position) {
      const rsiIdx =
        i - (candles.length - (indicators.rsi?.history?.length || 0));
      const rsi = indicators.rsi?.history?.[rsiIdx] || 50;
      const macd = indicators.macd?.history?.[rsiIdx]?.histogram || 0;

      const shouldEnter = evaluateEntry(params.strategy, {
        rsi,
        macd,
        candle,
        prevCandle: candles[i - 1],
      });

      if (shouldEnter) {
        const positionSize = capital * (params.positionSizePercent / 100);
        const quantity = Math.floor(positionSize / currentPrice);

        if (quantity > 0) {
          position = {
            entryDate: candle.date,
            entryPrice: currentPrice,
            quantity,
            highSinceEntry: currentPrice,
            trailingStop: currentPrice * (1 - trailingStopPercent / 100),
          };
          capital -= quantity * currentPrice;
        }
      }
    }

    const currentValue =
      capital + (position ? position.quantity * currentPrice : 0);
    equityCurve.push({ date: candle.date, value: currentValue });
  }

  if (position) {
    capital += position.quantity * candles[candles.length - 1].close;
  }

  const stats = calculateStats(trades, equityCurve, params.initialCapital);

  return {
    trades,
    stats,
    finalCapital: capital,
    totalReturn:
      ((capital - params.initialCapital) / params.initialCapital) * 100,
  };
}

/**
 * Run backtest with position averaging
 * @param {Array} candles - Historical candles
 * @param {object} params - Parameters
 * @param {string} direction - 'up' or 'down'
 * @returns {object} Backtest results
 */
async function runBacktestWithAveraging(candles, params, direction) {
  let capital = params.initialCapital;
  let position = null;
  const trades = [];
  const equityCurve = [{ date: candles[0].date, value: capital }];
  const averageThreshold = direction === 'down' ? -2 : 2;
  let hasAveraged = false;

  const indicators = technicalIndicators.getAllIndicators(candles);

  for (let i = 50; i < candles.length; i++) {
    const candle = candles[i];
    const currentPrice = candle.close;

    if (position) {
      const pnlPercent =
        ((currentPrice - position.avgPrice) / position.avgPrice) * 100;

      // Average into position
      if (!hasAveraged) {
        if (
          (direction === 'down' && pnlPercent <= averageThreshold) ||
          (direction === 'up' && pnlPercent >= averageThreshold)
        ) {
          const addSize = capital * (params.positionSizePercent / 200); // Half size
          const addQuantity = Math.floor(addSize / currentPrice);

          if (addQuantity > 0 && capital > addSize) {
            const totalCost =
              position.avgPrice * position.quantity +
              currentPrice * addQuantity;
            position.quantity += addQuantity;
            position.avgPrice = totalCost / position.quantity;
            capital -= addQuantity * currentPrice;
            hasAveraged = true;
          }
        }
      }

      // Exit logic
      if (pnlPercent >= 5 || pnlPercent <= -5) {
        const pnl = (currentPrice - position.avgPrice) * position.quantity;
        trades.push({
          ...position,
          exitDate: candle.date,
          exitPrice: currentPrice,
          pnl,
          pnlPercent,
        });
        capital += position.quantity * currentPrice;
        position = null;
        hasAveraged = false;
      }
    }

    if (!position) {
      const rsiIdx =
        i - (candles.length - (indicators.rsi?.history?.length || 0));
      const rsi = indicators.rsi?.history?.[rsiIdx] || 50;
      const macd = indicators.macd?.history?.[rsiIdx]?.histogram || 0;

      const shouldEnter = evaluateEntry(params.strategy, {
        rsi,
        macd,
        candle,
        prevCandle: candles[i - 1],
      });

      if (shouldEnter) {
        const positionSize = capital * (params.positionSizePercent / 100);
        const quantity = Math.floor(positionSize / currentPrice);

        if (quantity > 0) {
          position = {
            entryDate: candle.date,
            entryPrice: currentPrice,
            avgPrice: currentPrice,
            quantity,
          };
          capital -= quantity * currentPrice;
        }
      }
    }

    const currentValue =
      capital + (position ? position.quantity * currentPrice : 0);
    equityCurve.push({ date: candle.date, value: currentValue });
  }

  if (position) {
    capital += position.quantity * candles[candles.length - 1].close;
  }

  const stats = calculateStats(trades, equityCurve, params.initialCapital);

  return {
    trades,
    stats,
    finalCapital: capital,
    totalReturn:
      ((capital - params.initialCapital) / params.initialCapital) * 100,
  };
}

/**
 * Run Monte Carlo simulation
 * @param {Array} trades - Historical trades
 * @param {number} simulations - Number of simulations
 * @returns {object} Simulation results
 */
function runMonteCarloSimulation(trades, simulations = 1000) {
  if (trades.length === 0) {
    return { error: 'No trades for simulation' };
  }

  const returns = trades.map(t => t.pnlPercent);
  const results = [];

  for (let sim = 0; sim < simulations; sim++) {
    // Randomly sample trades with replacement
    let equity = 100;

    for (let i = 0; i < trades.length; i++) {
      const randomIndex = Math.floor(Math.random() * returns.length);
      const tradeReturn = returns[randomIndex];
      equity *= 1 + tradeReturn / 100;
    }

    results.push(equity);
  }

  // Sort results
  results.sort((a, b) => a - b);

  // Calculate percentiles
  const percentile = (arr, p) => arr[Math.floor(arr.length * p)];

  const mean = results.reduce((a, b) => a + b, 0) / results.length;
  const stdDev = Math.sqrt(
    results.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / results.length
  );

  return {
    simulations,
    mean: mean - 100,
    median: percentile(results, 0.5) - 100,
    stdDev,
    percentile5: percentile(results, 0.05) - 100,
    percentile25: percentile(results, 0.25) - 100,
    percentile75: percentile(results, 0.75) - 100,
    percentile95: percentile(results, 0.95) - 100,
    worstCase: results[0] - 100,
    bestCase: results[results.length - 1] - 100,
    probabilityOfProfit: (
      (results.filter(r => r > 100).length / results.length) *
      100
    ).toFixed(1),
  };
}

/**
 * Calculate statistics from trades and equity curve
 * @param {Array} trades - Trade history
 * @param {Array} equityCurve - Equity curve
 * @param {number} initialCapital - Starting capital
 * @returns {object} Statistics
 */
function calculateStats(trades, equityCurve, initialCapital) {
  if (trades.length === 0) {
    return { totalTrades: 0 };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const avgWin =
    wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)
      : 0;

  // Calculate max drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    if (point.value > peak) {
      peak = point.value;
    }
    const drawdown = ((peak - point.value) / peak) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // Calculate Sharpe ratio (simplified)
  const returns = trades.map(t => t.pnlPercent);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdReturn = Math.sqrt(
    returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length
  );
  const sharpeRatio = stdReturn > 0 ? avgReturn / stdReturn : 0;

  // Calculate profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Average holding period
  const avgHoldingBars =
    trades.reduce((s, t) => s + (t.holdingBars || 0), 0) / trades.length;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: ((wins.length / trades.length) * 100).toFixed(1),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    profitFactor: profitFactor === Infinity ? 'N/A' : profitFactor.toFixed(2),
    sharpeRatio: sharpeRatio.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    avgHoldingBars: avgHoldingBars.toFixed(1),
    expectancy: (
      (wins.length / trades.length) * avgWin -
      (losses.length / trades.length) * avgLoss
    ).toFixed(2),
  };
}

/**
 * Generate recommendations based on backtest results
 * @param {object} baseResults - Base backtest results
 * @param {object} whatIfResults - What-if scenario results
 * @returns {Array} Recommendations
 */
function generateRecommendations(baseResults, whatIfResults) {
  const recommendations = [];

  // Find best performing what-if scenario
  let bestScenario = null;
  let bestImprovement = 0;

  Object.entries(whatIfResults).forEach(([name, results]) => {
    if (results.improvement > bestImprovement) {
      bestImprovement = results.improvement;
      bestScenario = name;
    }
  });

  if (bestScenario && bestImprovement > 0) {
    const scenarioNames = {
      earlyEntry: 'entering positions earlier',
      lateEntry: 'entering positions later',
      tighterStop: 'using a tighter stop loss (2%)',
      widerStop: 'using a wider stop loss (5%)',
      higherTarget: 'holding for higher profit targets (8%)',
      trailingStop: 'using a trailing stop',
      averageDown: 'averaging down on losers',
      scaleUp: 'scaling into winners',
    };

    recommendations.push({
      type: 'improvement',
      message: `Consider ${scenarioNames[bestScenario]}. This could improve returns by ${bestImprovement.toFixed(1)}%.`,
    });
  }

  // Win rate recommendations
  const winRate = parseFloat(baseResults.stats.winRate);
  if (winRate < 40) {
    recommendations.push({
      type: 'warning',
      message:
        'Win rate is below 40%. Consider more selective entry criteria or improving timing.',
    });
  }

  // Risk/reward recommendations
  const avgWin = parseFloat(baseResults.stats.avgWin);
  const avgLoss = parseFloat(baseResults.stats.avgLoss);

  if (avgLoss > avgWin * 1.5) {
    recommendations.push({
      type: 'warning',
      message:
        'Average loss is larger than average win. Consider tighter stop losses.',
    });

    if (whatIfResults.tighterStop?.improvement > 0) {
      recommendations.push({
        type: 'suggestion',
        message: `A 2% stop loss would have improved returns by ${whatIfResults.tighterStop.improvement.toFixed(1)}%.`,
      });
    }
  }

  // Trailing stop recommendation
  if (whatIfResults.trailingStop?.improvement > baseResults.totalReturn * 0.1) {
    recommendations.push({
      type: 'suggestion',
      message:
        'A trailing stop would have significantly improved results. Consider implementing one.',
    });
  }

  // Max drawdown warning
  if (parseFloat(baseResults.stats.maxDrawdown) > 20) {
    recommendations.push({
      type: 'warning',
      message: `Maximum drawdown of ${baseResults.stats.maxDrawdown}% is high. Consider smaller position sizes.`,
    });
  }

  return recommendations;
}

/**
 * Optimize strategy parameters
 * @param {object} params - Base parameters
 * @returns {object} Optimized parameters
 */
async function optimizeStrategy(params) {
  const { symbol, startDate, endDate, initialCapital = 100000 } = params;

  const candles = await getAggregatesWithCryptoDetection(symbol, 1, 'day', {
    from: new Date(startDate),
    to: new Date(endDate),
  });

  if (!candles || candles.length < 100) {
    throw new Error('Insufficient data for optimization');
  }

  // Parameter ranges to test
  const profitTargets = [3, 5, 7, 10];
  const stopLosses = [2, 3, 5, 7];
  const positionSizes = [5, 10, 15, 20];
  const strategies = ['momentum', 'meanReversion', 'breakout', 'trend'];

  let bestResult = { totalReturn: -Infinity };
  let bestParams = {};

  // Grid search
  for (const strategy of strategies) {
    for (const profitTarget of profitTargets) {
      for (const stopLoss of stopLosses) {
        for (const positionSize of positionSizes) {
          try {
            const result = await runBacktest({
              candles,
              initialCapital,
              positionSizePercent: positionSize,
              profitTarget,
              stopLoss,
              strategy,
            });

            // Score based on return and risk-adjusted metrics
            const score =
              result.totalReturn - parseFloat(result.stats.maxDrawdown) * 0.5;

            if (
              score >
              bestResult.totalReturn -
                parseFloat(bestResult.stats?.maxDrawdown || 0) * 0.5
            ) {
              bestResult = result;
              bestParams = { strategy, profitTarget, stopLoss, positionSize };
            }
          } catch (error) {
            // Skip failed combinations
          }
        }
      }
    }
  }

  return {
    optimalParameters: bestParams,
    expectedReturn: bestResult.totalReturn,
    stats: bestResult.stats,
    trades: bestResult.trades.length,
  };
}

module.exports = {
  runEnhancedBacktest,
  runBacktest,
  runMonteCarloSimulation,
  optimizeStrategy,
  calculateStats,
  generateRecommendations,
};
