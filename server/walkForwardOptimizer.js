/**
 * Walk-Forward Optimizer
 *
 * Prevents overfitting by using rolling train/test windows on unseen data.
 *
 * Traditional backtesting pitfall:
 * - Optimize on ALL historical data → strategy perfectly fits past data
 * - Deploy live → strategy fails because it was overfit
 *
 * Walk-Forward solution:
 * - Split data into windows: train on 70%, test on next 30%
 * - Roll window forward, repeat
 * - Only keep strategies that work on UNSEEN test data
 *
 * Example with 1 year of data, 3-month windows:
 * Window 1: Train Jan-Sep, Test Oct-Dec
 * Window 2: Train Apr-Dec, Test Jan-Mar (next year)
 * etc.
 */

const { v4: uuidv4 } = require('uuid');

class WalkForwardOptimizer {
  constructor(options = {}) {
    this.config = {
      // Window configuration
      trainPeriodDays: options.trainPeriodDays || 180, // 6 months training
      testPeriodDays: options.testPeriodDays || 60, // 2 months testing
      stepDays: options.stepDays || 30, // Roll forward 1 month at a time
      minTrainSamples: options.minTrainSamples || 50, // Min trades in training
      minTestSamples: options.minTestSamples || 10, // Min trades in testing

      // Performance thresholds
      minWinRate: options.minWinRate || 0.45, // At least 45% win rate
      minExpectancy: options.minExpectancy || 0.5, // At least $0.50 per $1 risked
      minProfitFactor: options.minProfitFactor || 1.2, // Winners > 1.2x losers
      maxDrawdownPercent: options.maxDrawdownPercent || 20, // Max 20% drawdown

      // Optimization settings
      parameterRanges: options.parameterRanges || this.getDefaultParameterRanges(),
      maxIterations: options.maxIterations || 1000,
      convergenceThreshold: options.convergenceThreshold || 0.001,
    };
  }

  /**
   * Default parameter ranges for optimization
   */
  getDefaultParameterRanges() {
    return {
      takeProfitPercent: { min: 0.5, max: 5, step: 0.25 },
      stopLossPercent: { min: 0.25, max: 3, step: 0.25 },
      minConfidence: { min: 50, max: 90, step: 5 },
      positionSizePercent: { min: 10, max: 50, step: 5 },
      maxHoldingPeriodHours: { min: 1, max: 8, step: 1 },
      entryRsiMin: { min: 20, max: 40, step: 5 },
      entryRsiMax: { min: 60, max: 80, step: 5 },
    };
  }

  /**
   * Run walk-forward optimization
   *
   * @param {Array} historicalData - Array of { date, candles, trades } or similar
   * @param {Object} baseStrategy - Base strategy config to optimize
   * @param {Function} backtestFn - Function(config, data) => { trades, metrics }
   * @returns {Object} Optimization results with best parameters
   */
  async runOptimization(historicalData, baseStrategy, backtestFn) {
    const optimizationId = uuidv4();
    const startTime = Date.now();

    // Generate walk-forward windows
    const windows = this.generateWindows(historicalData);

    if (windows.length === 0) {
      return {
        success: false,
        error: 'Insufficient data for walk-forward optimization',
        minRequiredDays: this.config.trainPeriodDays + this.config.testPeriodDays,
      };
    }

    const windowResults = [];
    const parameterPerformance = new Map(); // Track how each param combo performs

    // Process each window
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      console.log(
        `Processing window ${i + 1}/${windows.length}: Train ${window.trainStart} to ${window.trainEnd}, Test ${window.testStart} to ${window.testEnd}`
      );

      // Optimize on training data
      const trainResult = await this.optimizeWindow(
        window.trainData,
        baseStrategy,
        backtestFn,
        parameterPerformance
      );

      if (!trainResult.bestConfig) {
        windowResults.push({
          window: i + 1,
          trainPeriod: { start: window.trainStart, end: window.trainEnd },
          testPeriod: { start: window.testStart, end: window.testEnd },
          status: 'NO_PROFITABLE_CONFIG',
          reason: 'No configuration met minimum thresholds in training',
        });
        continue;
      }

      // Test on out-of-sample data
      const testResult = await backtestFn(trainResult.bestConfig, window.testData);

      // Evaluate test performance
      const testMetrics = this.calculateMetrics(testResult.trades);
      const passed = this.meetsThresholds(testMetrics);

      windowResults.push({
        window: i + 1,
        trainPeriod: { start: window.trainStart, end: window.trainEnd },
        testPeriod: { start: window.testStart, end: window.testEnd },
        trainMetrics: trainResult.metrics,
        testMetrics,
        bestConfig: trainResult.bestConfig,
        passed,
        degradation: this.calculateDegradation(trainResult.metrics, testMetrics),
      });

      // Track parameter performance across windows
      const configKey = JSON.stringify(trainResult.bestConfig);
      if (!parameterPerformance.has(configKey)) {
        parameterPerformance.set(configKey, { wins: 0, total: 0, testReturns: [] });
      }
      const perf = parameterPerformance.get(configKey);
      perf.total++;
      if (passed) perf.wins++;
      perf.testReturns.push(testMetrics.totalReturn || 0);
    }

    // Find most robust parameters (best across multiple windows)
    const robustConfig = this.findRobustConfiguration(windowResults, parameterPerformance);

    // Calculate overall statistics
    const passedWindows = windowResults.filter(w => w.passed).length;
    const robustnessScore = (passedWindows / windows.length) * 100;

    return {
      success: true,
      optimizationId,
      duration: Date.now() - startTime,
      summary: {
        totalWindows: windows.length,
        passedWindows,
        robustnessScore: robustnessScore.toFixed(1) + '%',
        recommendation: this.getRecommendation(robustnessScore),
      },
      robustConfig,
      windowResults,
      degradationAnalysis: this.analyzeDegradation(windowResults),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate train/test windows from historical data
   */
  generateWindows(historicalData) {
    const windows = [];

    // Sort data by date
    const sortedData = [...historicalData].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    if (sortedData.length === 0) return windows;

    const startDate = new Date(sortedData[0].date);
    const endDate = new Date(sortedData[sortedData.length - 1].date);
    const totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24);

    // Need enough data for at least one window
    const minRequired = this.config.trainPeriodDays + this.config.testPeriodDays;
    if (totalDays < minRequired) {
      return windows;
    }

    // Generate rolling windows
    let windowStart = new Date(startDate);

    while (true) {
      const trainEnd = new Date(windowStart);
      trainEnd.setDate(trainEnd.getDate() + this.config.trainPeriodDays);

      const testEnd = new Date(trainEnd);
      testEnd.setDate(testEnd.getDate() + this.config.testPeriodDays);

      // Stop if test period exceeds data
      if (testEnd > endDate) break;

      // Extract data for this window
      const trainData = sortedData.filter(d => {
        const date = new Date(d.date);
        return date >= windowStart && date < trainEnd;
      });

      const testData = sortedData.filter(d => {
        const date = new Date(d.date);
        return date >= trainEnd && date < testEnd;
      });

      windows.push({
        trainStart: windowStart.toISOString().split('T')[0],
        trainEnd: trainEnd.toISOString().split('T')[0],
        testStart: trainEnd.toISOString().split('T')[0],
        testEnd: testEnd.toISOString().split('T')[0],
        trainData,
        testData,
      });

      // Roll forward
      windowStart.setDate(windowStart.getDate() + this.config.stepDays);
    }

    return windows;
  }

  /**
   * Optimize parameters for a single training window
   */
  async optimizeWindow(trainData, baseStrategy, backtestFn, parameterPerformance) {
    const parameterCombinations = this.generateParameterCombinations();
    let bestConfig = null;
    let bestMetrics = null;
    let bestScore = -Infinity;

    for (const params of parameterCombinations) {
      const config = { ...baseStrategy, ...params };

      try {
        const result = await backtestFn(config, trainData);
        const metrics = this.calculateMetrics(result.trades);

        // Skip if doesn't meet minimum thresholds
        if (!this.meetsThresholds(metrics)) continue;

        // Calculate composite score
        const score = this.calculateScore(metrics);

        if (score > bestScore) {
          bestScore = score;
          bestConfig = config;
          bestMetrics = metrics;
        }
      } catch (error) {
        // Skip failed configurations
        continue;
      }
    }

    return {
      bestConfig,
      metrics: bestMetrics,
      score: bestScore,
    };
  }

  /**
   * Generate all parameter combinations to test
   */
  generateParameterCombinations() {
    const ranges = this.config.parameterRanges;
    const combinations = [];

    // Generate combinations using grid search
    // For production, could use random search or Bayesian optimization

    const paramNames = Object.keys(ranges);
    const paramValues = paramNames.map(name => {
      const range = ranges[name];
      const values = [];
      for (let v = range.min; v <= range.max; v += range.step) {
        values.push(v);
      }
      return values;
    });

    // Generate cartesian product (limited to maxIterations)
    const generateCombos = (index, current) => {
      if (combinations.length >= this.config.maxIterations) return;

      if (index === paramNames.length) {
        combinations.push({ ...current });
        return;
      }

      for (const value of paramValues[index]) {
        current[paramNames[index]] = value;
        generateCombos(index + 1, current);
      }
    };

    generateCombos(0, {});

    // If we hit max iterations, sample randomly
    if (combinations.length >= this.config.maxIterations) {
      return this.randomSample(combinations, this.config.maxIterations);
    }

    return combinations;
  }

  /**
   * Random sample from array
   */
  randomSample(array, n) {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  /**
   * Calculate trading metrics from trades
   */
  calculateMetrics(trades) {
    if (!trades || trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        expectancy: 0,
        profitFactor: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);

    const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    const winRate = trades.length > 0 ? wins.length / trades.length : 0;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Calculate drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    for (const trade of trades) {
      runningPnl += trade.pnl;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak > 0 ? ((peak - runningPnl) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Calculate Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnlPercent || (t.pnl / (t.entryPrice * t.quantity)) * 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: (winRate * 100).toFixed(1) + '%',
      winRateNum: winRate,
      expectancy: expectancy.toFixed(2),
      expectancyNum: expectancy,
      profitFactor: profitFactor.toFixed(2),
      profitFactorNum: profitFactor,
      totalReturn: (totalWins - totalLosses).toFixed(2),
      totalReturnNum: totalWins - totalLosses,
      maxDrawdown: maxDrawdown.toFixed(1) + '%',
      maxDrawdownNum: maxDrawdown,
      sharpeRatio: sharpeRatio.toFixed(2),
      sharpeRatioNum: sharpeRatio,
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
    };
  }

  /**
   * Check if metrics meet minimum thresholds
   */
  meetsThresholds(metrics) {
    if (!metrics || metrics.totalTrades === 0) return false;

    return (
      metrics.winRateNum >= this.config.minWinRate &&
      metrics.expectancyNum >= this.config.minExpectancy &&
      metrics.profitFactorNum >= this.config.minProfitFactor &&
      metrics.maxDrawdownNum <= this.config.maxDrawdownPercent
    );
  }

  /**
   * Calculate composite score for ranking configurations
   */
  calculateScore(metrics) {
    if (!metrics) return -Infinity;

    // Weighted composite score
    // Emphasize expectancy and profit factor over win rate
    const score =
      metrics.expectancyNum * 30 + // Expectancy is most important
      metrics.profitFactorNum * 20 +
      metrics.sharpeRatioNum * 20 +
      metrics.winRateNum * 10 -
      metrics.maxDrawdownNum * 0.5; // Penalize drawdown

    return score;
  }

  /**
   * Calculate performance degradation from train to test
   */
  calculateDegradation(trainMetrics, testMetrics) {
    if (!trainMetrics || !testMetrics) return null;

    const degrade = (train, test) => {
      if (train === 0) return test === 0 ? 0 : -100;
      return ((test - train) / Math.abs(train)) * 100;
    };

    return {
      winRate: degrade(trainMetrics.winRateNum, testMetrics.winRateNum).toFixed(1) + '%',
      expectancy: degrade(trainMetrics.expectancyNum, testMetrics.expectancyNum).toFixed(1) + '%',
      profitFactor:
        degrade(trainMetrics.profitFactorNum, testMetrics.profitFactorNum).toFixed(1) + '%',
      sharpeRatio:
        degrade(trainMetrics.sharpeRatioNum, testMetrics.sharpeRatioNum).toFixed(1) + '%',
      interpretation: this.interpretDegradation(trainMetrics, testMetrics),
    };
  }

  /**
   * Interpret the degradation pattern
   */
  interpretDegradation(trainMetrics, testMetrics) {
    const expectancyDrop =
      ((trainMetrics.expectancyNum - testMetrics.expectancyNum) / trainMetrics.expectancyNum) * 100;

    if (expectancyDrop > 50) {
      return 'SEVERE_OVERFITTING: Strategy is significantly overfit to training data';
    } else if (expectancyDrop > 25) {
      return 'MODERATE_OVERFITTING: Some overfitting detected, consider simplifying parameters';
    } else if (expectancyDrop > 10) {
      return 'MILD_DEGRADATION: Normal performance decay, acceptable for live trading';
    } else if (expectancyDrop < -10) {
      return 'IMPROVEMENT: Strategy performed better on unseen data (unusual, verify)';
    } else {
      return 'STABLE: Consistent performance across train/test periods';
    }
  }

  /**
   * Find the most robust configuration across all windows
   */
  findRobustConfiguration(windowResults, parameterPerformance) {
    // Find configs that passed multiple windows
    const passingConfigs = windowResults
      .filter(w => w.passed && w.bestConfig)
      .map(w => ({
        config: w.bestConfig,
        testMetrics: w.testMetrics,
      }));

    if (passingConfigs.length === 0) {
      return {
        found: false,
        reason: 'No configuration passed validation in any window',
      };
    }

    // Group by similar configs and find most consistent
    const configGroups = new Map();

    for (const { config, testMetrics } of passingConfigs) {
      // Create simplified key (round parameters)
      const key = JSON.stringify({
        tp: Math.round(config.takeProfitPercent * 4) / 4,
        sl: Math.round(config.stopLossPercent * 4) / 4,
        conf: Math.round(config.minConfidence / 5) * 5,
      });

      if (!configGroups.has(key)) {
        configGroups.set(key, { configs: [], metrics: [] });
      }
      configGroups.get(key).configs.push(config);
      configGroups.get(key).metrics.push(testMetrics);
    }

    // Find group with best average test performance
    let bestGroup = null;
    let bestAvgScore = -Infinity;

    for (const [key, group] of configGroups) {
      const avgScore =
        group.metrics.reduce((sum, m) => sum + this.calculateScore(m), 0) / group.metrics.length;

      if (avgScore > bestAvgScore) {
        bestAvgScore = avgScore;
        bestGroup = group;
      }
    }

    if (!bestGroup) {
      return {
        found: false,
        reason: 'Could not determine optimal configuration',
      };
    }

    // Average the parameters from the best group
    const avgConfig = {};
    const firstConfig = bestGroup.configs[0];

    for (const key of Object.keys(firstConfig)) {
      if (typeof firstConfig[key] === 'number') {
        avgConfig[key] =
          bestGroup.configs.reduce((sum, c) => sum + c[key], 0) / bestGroup.configs.length;
        // Round to reasonable precision
        avgConfig[key] = Math.round(avgConfig[key] * 100) / 100;
      } else {
        avgConfig[key] = firstConfig[key];
      }
    }

    return {
      found: true,
      config: avgConfig,
      validationWindows: bestGroup.configs.length,
      avgTestScore: bestAvgScore.toFixed(2),
      confidence:
        bestGroup.configs.length >= 3
          ? 'HIGH'
          : bestGroup.configs.length >= 2
            ? 'MEDIUM'
            : 'LOW',
    };
  }

  /**
   * Analyze degradation patterns across all windows
   */
  analyzeDegradation(windowResults) {
    const validResults = windowResults.filter(w => w.degradation);

    if (validResults.length === 0) {
      return { message: 'No degradation data available' };
    }

    const interpretations = validResults.map(w => w.degradation.interpretation);

    const overfit = interpretations.filter(i => i.includes('OVERFITTING')).length;
    const stable = interpretations.filter(i => i.includes('STABLE')).length;
    const mild = interpretations.filter(i => i.includes('MILD')).length;

    return {
      windowsAnalyzed: validResults.length,
      overfitWindows: overfit,
      stableWindows: stable,
      mildDegradationWindows: mild,
      overallAssessment:
        overfit > validResults.length / 2
          ? 'HIGH_OVERFIT_RISK: Consider simplifying strategy or using more data'
          : stable > validResults.length / 2
            ? 'ROBUST: Strategy shows consistent out-of-sample performance'
            : 'MODERATE: Some degradation expected, monitor live performance',
    };
  }

  /**
   * Get recommendation based on robustness score
   */
  getRecommendation(robustnessScore) {
    if (robustnessScore >= 80) {
      return 'STRONG_BUY: Highly robust strategy, confident for live trading';
    } else if (robustnessScore >= 60) {
      return 'MODERATE: Acceptable robustness, start with small position sizes';
    } else if (robustnessScore >= 40) {
      return 'CAUTION: Strategy shows inconsistent results, needs refinement';
    } else {
      return 'AVOID: Strategy appears overfit or unreliable';
    }
  }

  /**
   * Quick validation run (fewer windows, faster)
   */
  async quickValidation(historicalData, config, backtestFn) {
    // Use just 3 windows for quick check
    const quickConfig = {
      ...this.config,
      trainPeriodDays: 90,
      testPeriodDays: 30,
      stepDays: 60,
    };

    const optimizer = new WalkForwardOptimizer(quickConfig);
    const windows = optimizer.generateWindows(historicalData);

    const results = [];
    for (const window of windows.slice(0, 3)) {
      try {
        const testResult = await backtestFn(config, window.testData);
        const metrics = this.calculateMetrics(testResult.trades);
        results.push({
          period: `${window.testStart} to ${window.testEnd}`,
          passed: this.meetsThresholds(metrics),
          metrics,
        });
      } catch (error) {
        results.push({
          period: `${window.testStart} to ${window.testEnd}`,
          passed: false,
          error: error.message,
        });
      }
    }

    const passRate = results.filter(r => r.passed).length / results.length;

    return {
      quickCheck: true,
      windowsTested: results.length,
      passed: results.filter(r => r.passed).length,
      passRate: (passRate * 100).toFixed(0) + '%',
      recommendation:
        passRate >= 0.66 ? 'Proceed with full optimization' : 'Strategy may be overfit',
      results,
    };
  }
}

module.exports = WalkForwardOptimizer;
