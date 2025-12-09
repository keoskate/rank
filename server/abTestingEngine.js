/**
 * A/B Testing Engine
 *
 * Systematic framework for testing multiple strategy configurations
 * to find the most consistently profitable parameters.
 *
 * Features:
 * - Run A/B/C/D... tests with multiple strategy variants
 * - Statistical significance testing
 * - Auto-declare winners based on confidence levels
 * - Track test history for auditing
 * - Integration with version control and regime detection
 *
 * Example usage:
 *   Create test: SOXL variants A (TP=2%), B (TP=2.5%), C (TP=3%)
 *   Run backtest on each variant
 *   Calculate statistical significance
 *   Declare winner when confidence > 95%
 *   Promote winner to production
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ABTestingEngine {
  constructor(dataDir = path.join(__dirname, '..', 'data')) {
    this.dataDir = dataDir;
    this.testsFile = path.join(dataDir, 'ab-tests.json');
    this.tests = this.loadTests();
  }

  /**
   * Load tests from disk
   */
  loadTests() {
    try {
      if (fs.existsSync(this.testsFile)) {
        const data = JSON.parse(fs.readFileSync(this.testsFile, 'utf8'));
        return data.tests || {};
      }
    } catch (error) {
      console.error('Error loading A/B tests:', error.message);
    }
    return {};
  }

  /**
   * Save tests to disk
   */
  saveTests() {
    try {
      const data = {
        _meta: {
          description: 'A/B test history and results',
          lastUpdated: new Date().toISOString(),
          version: '1.0',
        },
        tests: this.tests,
      };
      fs.writeFileSync(this.testsFile, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving A/B tests:', error.message);
      return false;
    }
  }

  /**
   * Create a new A/B test
   *
   * @param {Object} options - Test configuration
   * @param {string} options.name - Test name (e.g., "SOXL Profit Target Test")
   * @param {string} options.symbol - Symbol being tested
   * @param {Array} options.variants - Array of { name, config } for each variant
   * @param {string} options.primaryMetric - Primary metric to compare (e.g., "expectancy")
   * @param {number} options.minTrades - Minimum trades before declaring winner
   * @param {number} options.confidenceThreshold - Required confidence (default 95%)
   */
  createTest(options) {
    const {
      name,
      symbol,
      variants,
      primaryMetric = 'expectancy',
      minTrades = 30,
      confidenceThreshold = 95,
      description = '',
    } = options;

    if (!name || !symbol || !variants || variants.length < 2) {
      return {
        success: false,
        error: 'name, symbol, and at least 2 variants are required',
      };
    }

    const testId = uuidv4();

    const test = {
      id: testId,
      name,
      symbol: symbol.toUpperCase(),
      description,
      status: 'created', // created, running, paused, completed, cancelled
      primaryMetric,
      minTrades,
      confidenceThreshold,
      variants: variants.map((v, index) => ({
        id: uuidv4(),
        name: v.name || String.fromCharCode(65 + index), // A, B, C, D...
        config: v.config,
        trades: [],
        metrics: null,
        isControl: index === 0, // First variant is control
        isWinner: false,
      })),
      winner: null,
      results: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    this.tests[testId] = test;
    this.saveTests();

    return {
      success: true,
      testId,
      test,
      message: `Created test "${name}" with ${variants.length} variants`,
    };
  }

  /**
   * Start a test (set to running)
   */
  startTest(testId) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    if (test.status === 'completed') {
      return { success: false, error: 'Test already completed' };
    }

    test.status = 'running';
    test.startedAt = test.startedAt || new Date().toISOString();
    this.saveTests();

    return {
      success: true,
      message: `Test "${test.name}" is now running`,
      test,
    };
  }

  /**
   * Record a trade result for a variant
   *
   * @param {string} testId - Test ID
   * @param {string} variantId - Variant ID (or name like "A", "B")
   * @param {Object} trade - Trade result { pnl, pnlPercent, entryPrice, exitPrice, ... }
   */
  recordTrade(testId, variantId, trade) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Find variant by ID or name
    const variant = test.variants.find(
      v => v.id === variantId || v.name.toLowerCase() === variantId.toLowerCase()
    );

    if (!variant) {
      return { success: false, error: 'Variant not found' };
    }

    // Record the trade
    variant.trades.push({
      ...trade,
      recordedAt: new Date().toISOString(),
    });

    // Recalculate metrics
    variant.metrics = this.calculateVariantMetrics(variant.trades);

    // Check if we should evaluate for a winner
    const evaluation = this.evaluateTest(testId);

    this.saveTests();

    return {
      success: true,
      variant: variant.name,
      totalTrades: variant.trades.length,
      metrics: variant.metrics,
      evaluation,
    };
  }

  /**
   * Record backtest results for a variant (batch)
   */
  recordBacktestResults(testId, variantId, trades) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    const variant = test.variants.find(
      v => v.id === variantId || v.name.toLowerCase() === variantId.toLowerCase()
    );

    if (!variant) {
      return { success: false, error: 'Variant not found' };
    }

    // Replace trades with backtest results
    variant.trades = trades.map(t => ({
      ...t,
      source: 'backtest',
      recordedAt: new Date().toISOString(),
    }));

    variant.metrics = this.calculateVariantMetrics(variant.trades);

    this.saveTests();

    return {
      success: true,
      variant: variant.name,
      totalTrades: variant.trades.length,
      metrics: variant.metrics,
    };
  }

  /**
   * Calculate metrics for a variant's trades
   */
  calculateVariantMetrics(trades) {
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

    // Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: +(winRate * 100).toFixed(2),
      expectancy: +expectancy.toFixed(2),
      profitFactor: +profitFactor.toFixed(2),
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      totalPnl: +(totalWins - totalLosses).toFixed(2),
      maxDrawdown: +maxDrawdown.toFixed(2),
      sharpeRatio: +sharpeRatio.toFixed(2),
    };
  }

  /**
   * Evaluate test results and determine if we have a winner
   */
  evaluateTest(testId) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // Check if all variants have enough trades
    const allHaveMinTrades = test.variants.every(v => v.trades.length >= test.minTrades);

    if (!allHaveMinTrades) {
      return {
        status: 'insufficient_data',
        message: `Need at least ${test.minTrades} trades per variant`,
        tradesCounts: test.variants.map(v => ({
          name: v.name,
          trades: v.trades.length,
          needed: test.minTrades - v.trades.length,
        })),
      };
    }

    // Compare variants on primary metric
    const control = test.variants.find(v => v.isControl);
    const challengers = test.variants.filter(v => !v.isControl);

    const comparisons = challengers.map(challenger => {
      const comparison = this.compareVariants(control, challenger, test.primaryMetric);
      return {
        challenger: challenger.name,
        control: control.name,
        ...comparison,
      };
    });

    // Find the best variant
    const sortedVariants = [...test.variants].sort((a, b) => {
      const metricA = a.metrics?.[test.primaryMetric] || 0;
      const metricB = b.metrics?.[test.primaryMetric] || 0;
      return metricB - metricA;
    });

    const leader = sortedVariants[0];
    const leaderConfidence = this.calculateConfidence(leader, test.variants);

    const evaluation = {
      status: 'evaluated',
      primaryMetric: test.primaryMetric,
      leader: {
        name: leader.name,
        value: leader.metrics?.[test.primaryMetric],
        confidence: leaderConfidence,
      },
      comparisons,
      canDeclareWinner: leaderConfidence >= test.confidenceThreshold,
      recommendation: this.getRecommendation(leader, leaderConfidence, test.confidenceThreshold),
    };

    // Update test with evaluation
    test.results = evaluation;
    this.saveTests();

    return evaluation;
  }

  /**
   * Compare two variants using statistical tests
   */
  compareVariants(variantA, variantB, metric) {
    const valuesA = variantA.trades.map(t => {
      if (metric === 'pnl') return t.pnl;
      if (metric === 'pnlPercent') return t.pnlPercent || 0;
      if (metric === 'expectancy') return t.pnl; // Use raw PnL for expectancy calculation
      return t[metric] || 0;
    });

    const valuesB = variantB.trades.map(t => {
      if (metric === 'pnl') return t.pnl;
      if (metric === 'pnlPercent') return t.pnlPercent || 0;
      if (metric === 'expectancy') return t.pnl;
      return t[metric] || 0;
    });

    // Calculate means
    const meanA = valuesA.reduce((a, b) => a + b, 0) / valuesA.length;
    const meanB = valuesB.reduce((a, b) => a + b, 0) / valuesB.length;

    // Calculate standard deviations
    const stdA = Math.sqrt(
      valuesA.reduce((sum, v) => sum + Math.pow(v - meanA, 2), 0) / valuesA.length
    );
    const stdB = Math.sqrt(
      valuesB.reduce((sum, v) => sum + Math.pow(v - meanB, 2), 0) / valuesB.length
    );

    // Welch's t-test
    const tStat = (meanA - meanB) / Math.sqrt(stdA ** 2 / valuesA.length + stdB ** 2 / valuesB.length);

    // Degrees of freedom (Welch-Satterthwaite)
    const df =
      (stdA ** 2 / valuesA.length + stdB ** 2 / valuesB.length) ** 2 /
      ((stdA ** 4) / (valuesA.length ** 2 * (valuesA.length - 1)) +
        (stdB ** 4) / (valuesB.length ** 2 * (valuesB.length - 1)));

    // Approximate p-value (two-tailed)
    const pValue = this.approximatePValue(Math.abs(tStat), df);

    // Effect size (Cohen's d)
    const pooledStd = Math.sqrt((stdA ** 2 + stdB ** 2) / 2);
    const cohensD = pooledStd > 0 ? (meanB - meanA) / pooledStd : 0;

    // Calculate improvement percentage
    const improvement = meanA !== 0 ? ((meanB - meanA) / Math.abs(meanA)) * 100 : 0;

    return {
      meanA: +meanA.toFixed(4),
      meanB: +meanB.toFixed(4),
      stdA: +stdA.toFixed(4),
      stdB: +stdB.toFixed(4),
      tStatistic: +tStat.toFixed(4),
      pValue: +pValue.toFixed(4),
      isSignificant: pValue < 0.05,
      effectSize: +cohensD.toFixed(4),
      effectInterpretation: this.interpretEffectSize(cohensD),
      improvement: +improvement.toFixed(2) + '%',
      winner: meanB > meanA ? variantB.name : meanA > meanB ? variantA.name : 'tie',
    };
  }

  /**
   * Approximate p-value from t-statistic (using normal approximation for large df)
   */
  approximatePValue(t, df) {
    // For df > 30, t-distribution approximates normal
    if (df > 30) {
      // Standard normal CDF approximation
      const z = t;
      const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      return 2 * (1 - this.normalCDF(Math.abs(z)));
    }

    // For smaller df, use a lookup table approximation
    // This is a simplified approximation
    const criticalValues = {
      0.1: 1.28,
      0.05: 1.96,
      0.01: 2.58,
      0.001: 3.29,
    };

    for (const [p, cv] of Object.entries(criticalValues)) {
      if (t < cv) return parseFloat(p);
    }
    return 0.0001;
  }

  /**
   * Standard normal CDF approximation
   */
  normalCDF(z) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

    return 0.5 * (1.0 + sign * y);
  }

  /**
   * Interpret Cohen's d effect size
   */
  interpretEffectSize(d) {
    const absD = Math.abs(d);
    if (absD < 0.2) return 'negligible';
    if (absD < 0.5) return 'small';
    if (absD < 0.8) return 'medium';
    return 'large';
  }

  /**
   * Calculate overall confidence in the leader
   */
  calculateConfidence(leader, allVariants) {
    if (!leader.metrics || allVariants.length < 2) return 0;

    // Compare leader to all other variants
    const others = allVariants.filter(v => v.id !== leader.id);

    let totalConfidence = 0;
    let comparisons = 0;

    for (const other of others) {
      if (!other.metrics || other.trades.length === 0) continue;

      const comparison = this.compareVariants(other, leader, 'pnl');
      // Convert p-value to confidence
      const confidence = (1 - comparison.pValue) * 100;
      totalConfidence += confidence;
      comparisons++;
    }

    return comparisons > 0 ? Math.round(totalConfidence / comparisons) : 0;
  }

  /**
   * Get recommendation based on results
   */
  getRecommendation(leader, confidence, threshold) {
    if (confidence >= threshold) {
      return {
        action: 'PROMOTE',
        message: `${leader.name} is the winner with ${confidence}% confidence. Recommend promoting to production.`,
        urgency: 'HIGH',
      };
    } else if (confidence >= threshold * 0.8) {
      return {
        action: 'CONTINUE',
        message: `${leader.name} is leading but needs more data. Current confidence: ${confidence}%.`,
        urgency: 'MEDIUM',
      };
    } else {
      return {
        action: 'CONTINUE',
        message: `No clear winner yet. Keep collecting data.`,
        urgency: 'LOW',
      };
    }
  }

  /**
   * Declare a winner and complete the test
   */
  declareWinner(testId, variantId = null) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    // If variantId not specified, use the leader from evaluation
    let winner;
    if (variantId) {
      winner = test.variants.find(
        v => v.id === variantId || v.name.toLowerCase() === variantId.toLowerCase()
      );
    } else if (test.results?.leader) {
      winner = test.variants.find(v => v.name === test.results.leader.name);
    }

    if (!winner) {
      return { success: false, error: 'Could not determine winner' };
    }

    // Update test
    winner.isWinner = true;
    test.winner = {
      variantId: winner.id,
      variantName: winner.name,
      config: winner.config,
      metrics: winner.metrics,
      declaredAt: new Date().toISOString(),
    };
    test.status = 'completed';
    test.completedAt = new Date().toISOString();

    this.saveTests();

    return {
      success: true,
      message: `Declared ${winner.name} as winner of test "${test.name}"`,
      winner: test.winner,
      test,
    };
  }

  /**
   * Get test by ID
   */
  getTest(testId) {
    return this.tests[testId] || null;
  }

  /**
   * Get all tests for a symbol
   */
  getTestsForSymbol(symbol) {
    const symbolKey = symbol.toUpperCase();
    return Object.values(this.tests).filter(t => t.symbol === symbolKey);
  }

  /**
   * Get all tests
   */
  getAllTests() {
    return Object.values(this.tests);
  }

  /**
   * Get active tests
   */
  getActiveTests() {
    return Object.values(this.tests).filter(t => t.status === 'running');
  }

  /**
   * Pause a test
   */
  pauseTest(testId) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    test.status = 'paused';
    this.saveTests();

    return {
      success: true,
      message: `Test "${test.name}" paused`,
    };
  }

  /**
   * Cancel a test
   */
  cancelTest(testId) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    test.status = 'cancelled';
    test.completedAt = new Date().toISOString();
    this.saveTests();

    return {
      success: true,
      message: `Test "${test.name}" cancelled`,
    };
  }

  /**
   * Delete a test
   */
  deleteTest(testId) {
    if (!this.tests[testId]) {
      return { success: false, error: 'Test not found' };
    }

    const testName = this.tests[testId].name;
    delete this.tests[testId];
    this.saveTests();

    return {
      success: true,
      message: `Test "${testName}" deleted`,
    };
  }

  /**
   * Get test summary with leaderboard
   */
  getTestSummary(testId) {
    const test = this.tests[testId];
    if (!test) {
      return null;
    }

    // Sort variants by primary metric
    const rankedVariants = [...test.variants]
      .filter(v => v.metrics)
      .sort((a, b) => {
        const metricA = a.metrics[test.primaryMetric] || 0;
        const metricB = b.metrics[test.primaryMetric] || 0;
        return metricB - metricA;
      })
      .map((v, index) => ({
        rank: index + 1,
        name: v.name,
        isControl: v.isControl,
        isWinner: v.isWinner,
        trades: v.trades.length,
        metrics: v.metrics,
      }));

    return {
      id: test.id,
      name: test.name,
      symbol: test.symbol,
      status: test.status,
      primaryMetric: test.primaryMetric,
      leaderboard: rankedVariants,
      winner: test.winner,
      results: test.results,
      createdAt: test.createdAt,
      completedAt: test.completedAt,
    };
  }

  /**
   * Clone a test configuration (for re-running)
   */
  cloneTest(testId, newName = null) {
    const test = this.tests[testId];
    if (!test) {
      return { success: false, error: 'Test not found' };
    }

    return this.createTest({
      name: newName || `${test.name} (copy)`,
      symbol: test.symbol,
      variants: test.variants.map(v => ({
        name: v.name,
        config: { ...v.config },
      })),
      primaryMetric: test.primaryMetric,
      minTrades: test.minTrades,
      confidenceThreshold: test.confidenceThreshold,
      description: `Clone of test ${test.id}`,
    });
  }

  /**
   * Export test data
   */
  exportTest(testId) {
    const test = this.tests[testId];
    if (!test) {
      return null;
    }
    return JSON.parse(JSON.stringify(test));
  }

  /**
   * Import test data
   */
  importTest(testData) {
    try {
      const testId = testData.id || uuidv4();
      this.tests[testId] = {
        ...testData,
        id: testId,
        importedAt: new Date().toISOString(),
      };
      this.saveTests();
      return { success: true, testId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ABTestingEngine;
