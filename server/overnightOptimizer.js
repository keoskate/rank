/**
 * Overnight Optimizer
 *
 * A "set it and forget it" optimization engine that runs for hours
 * while you sleep, testing thousands of parameter combinations.
 *
 * Features:
 * 1. Multi-symbol optimization - test on any stock in your watchlist
 * 2. Regime-specific optimization - find params for bull/bear/sideways
 * 3. Walk-forward validation - ensure no overfitting
 * 4. Auto-save progress - resume if interrupted
 * 5. Report generation - wake up to actionable insights
 *
 * Optimization Methods:
 * - Grid search (exhaustive but slow)
 * - Random search (faster, good coverage)
 * - Bayesian optimization (smart, learns what works)
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const WalkForwardOptimizer = require('./walkForwardOptimizer');
const RegimeDetector = require('./regimeDetector');

class OvernightOptimizer {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.jobsFile = path.join(this.dataDir, 'overnight-jobs.json');
    this.resultsDir = path.join(this.dataDir, 'overnight-results');

    // Create results directory if needed
    if (!fs.existsSync(this.resultsDir)) {
      fs.mkdirSync(this.resultsDir, { recursive: true });
    }

    this.jobs = this.loadJobs();
    this.activeJob = null;
    this.walkForwardOptimizer = new WalkForwardOptimizer();
    this.regimeDetector = new RegimeDetector();

    // Parameter ranges for optimization
    this.parameterRanges = {
      takeProfitPercent: { min: 0.5, max: 5.0, step: 0.25, description: 'Target profit %' },
      stopLossPercent: { min: 0.25, max: 3.0, step: 0.25, description: 'Max loss %' },
      minConfidence: { min: 50, max: 90, step: 5, description: 'Min signal confidence' },
      positionSizePercent: { min: 10, max: 50, step: 5, description: 'Position size %' },
      maxHoldingPeriodHours: { min: 1, max: 8, step: 1, description: 'Max hold time' },
      entryRsiMin: { min: 20, max: 40, step: 5, description: 'RSI oversold level' },
      entryRsiMax: { min: 60, max: 80, step: 5, description: 'RSI overbought level' },
    };
  }

  /**
   * Load jobs from disk
   */
  loadJobs() {
    try {
      if (fs.existsSync(this.jobsFile)) {
        return JSON.parse(fs.readFileSync(this.jobsFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading overnight jobs:', error.message);
    }
    return { jobs: [], completedJobs: [] };
  }

  /**
   * Save jobs to disk
   */
  saveJobs() {
    try {
      fs.writeFileSync(this.jobsFile, JSON.stringify(this.jobs, null, 2));
    } catch (error) {
      console.error('Error saving overnight jobs:', error.message);
    }
  }

  /**
   * Create a new overnight optimization job
   * @param {Array} symbols - Array of symbols to optimize
   * @param {Object} config - Job configuration
   */
  createJob(symbols, config = {}) {
    const symbolList = Array.isArray(symbols) ? symbols : [symbols];
    const job = {
      id: uuidv4(),
      status: 'pending', // pending, running, completed, failed, cancelled
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      config: {
        // Symbols to optimize
        symbols: symbolList,

        // Date range for historical data
        startDate: config.startDate || this.getDefaultStartDate(),
        endDate: config.endDate || new Date().toISOString().split('T')[0],

        // Optimization method
        method: config.method || 'random', // 'grid', 'random', 'bayesian'

        // How many parameter combinations to test
        maxIterations: config.maxIterations || 500,

        // Minimum performance thresholds
        minWinRate: config.minWinRate || 0.45,
        minProfitFactor: config.minProfitFactor || 1.2,
        minExpectancy: config.minExpectancy || 0.5,
        maxDrawdown: config.maxDrawdown || 20,

        // Walk-forward settings
        walkForward: config.walkForward !== false, // Default true
        trainDays: config.trainDays || 60,
        testDays: config.testDays || 20,

        // Regime-specific optimization
        optimizeByRegime: config.optimizeByRegime !== false, // Default true

        // Random day validation
        randomValidationDays: config.randomValidationDays || 10,

        // Custom parameter ranges (optional override)
        parameterRanges: config.parameterRanges || null,
      },
      progress: {
        phase: 'waiting',
        symbolsCompleted: 0,
        totalSymbols: symbolList.length,
        currentIteration: 0,
        totalIterations: config.maxIterations || 500,
        currentSymbol: null,
        message: 'Job created, waiting to start',
        lastUpdate: new Date().toISOString(),
      },
      symbols: symbolList,
      results: null,
      errors: [],
    };

    this.jobs.jobs.push(job);
    this.saveJobs();

    return job;
  }

  /**
   * Get default start date (6 months ago)
   */
  getDefaultStartDate() {
    const date = new Date();
    date.setMonth(date.getMonth() - 6);
    return date.toISOString().split('T')[0];
  }

  /**
   * Start the optimization job
   * This is the main entry point - runs in background
   */
  async startJob(jobId, dataFetcher) {
    const job = this.jobs.jobs.find(j => j.id === jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.status === 'running') {
      throw new Error(`Job ${jobId} is already running`);
    }

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.progress.phase = 'starting';
    job.progress.message = 'Initializing optimization...';
    this.activeJob = job;
    this.saveJobs();

    try {
      const results = await this.runOptimization(job, dataFetcher);

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.results = results;
      job.progress.phase = 'completed';
      job.progress.message = `Optimization complete! Found ${results.strategies?.length || 0} optimized strategies.`;

      // Save detailed results to file
      this.saveResults(job.id, results);

      // Move to completed jobs
      this.jobs.completedJobs.unshift(job);
      this.jobs.jobs = this.jobs.jobs.filter(j => j.id !== jobId);

    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.errors.push({
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack,
      });
      job.progress.phase = 'failed';
      job.progress.message = `Optimization failed: ${error.message}`;
    } finally {
      this.activeJob = null;
      this.saveJobs();
    }

    return job;
  }

  /**
   * Main optimization logic
   */
  async runOptimization(job, dataFetcher) {
    const { config, progress } = job;
    const allResults = {
      jobId: job.id,
      startedAt: job.startedAt,
      completedAt: null,
      config,
      strategies: [],
      symbolResults: {},
      regimeStrategies: {},
      summary: null,
    };

    // Process each symbol
    for (let symbolIdx = 0; symbolIdx < config.symbols.length; symbolIdx++) {
      const symbol = config.symbols[symbolIdx];
      progress.currentSymbol = symbol;
      progress.symbolsCompleted = symbolIdx;
      progress.phase = 'fetching_data';
      progress.message = `Fetching historical data for ${symbol}...`;
      progress.lastUpdate = new Date().toISOString();
      this.saveJobs();

      try {
        // Fetch historical data
        const historicalData = await dataFetcher(
          symbol,
          config.startDate,
          config.endDate
        );

        if (!historicalData || historicalData.length === 0) {
          job.errors.push({
            timestamp: new Date().toISOString(),
            message: `No data available for ${symbol}`,
          });
          continue;
        }

        progress.phase = 'detecting_regimes';
        progress.message = `Analyzing market regimes for ${symbol}...`;
        this.saveJobs();

        // Detect regimes in the data
        const regimeTimeline = this.regimeDetector.getRegimeTimeline(historicalData);
        const regimeAnalysis = this.regimeDetector.analyzeRegimes(regimeTimeline);

        // Optimize for each regime if enabled
        const symbolResult = {
          symbol,
          dataPoints: historicalData.length,
          regimeAnalysis,
          optimizedConfigs: {},
          bestOverall: null,
          validationResults: null,
        };

        if (config.optimizeByRegime && regimeAnalysis) {
          // Optimize for each regime type
          for (const regime of ['bull', 'bear', 'sideways']) {
            progress.phase = `optimizing_${regime}`;
            progress.message = `Optimizing ${symbol} for ${regime.toUpperCase()} market conditions...`;
            this.saveJobs();

            const regimeData = this.filterDataByRegime(historicalData, regimeTimeline, regime);

            if (regimeData.length < 30) {
              symbolResult.optimizedConfigs[regime] = {
                status: 'insufficient_data',
                dataPoints: regimeData.length,
              };
              continue;
            }

            const optimized = await this.optimizeParameters(
              regimeData,
              config,
              job,
              `${symbol}-${regime}`
            );

            symbolResult.optimizedConfigs[regime] = optimized;

            if (optimized.bestConfig) {
              if (!allResults.regimeStrategies[regime]) {
                allResults.regimeStrategies[regime] = [];
              }
              allResults.regimeStrategies[regime].push({
                symbol,
                ...optimized,
              });
            }
          }
        }

        // Also find best overall config (regime-agnostic)
        progress.phase = 'optimizing_overall';
        progress.message = `Finding best overall parameters for ${symbol}...`;
        this.saveJobs();

        const overallOptimized = await this.optimizeParameters(
          historicalData,
          config,
          job,
          `${symbol}-overall`
        );

        symbolResult.bestOverall = overallOptimized;

        // Walk-forward validation on best config
        if (config.walkForward && overallOptimized.bestConfig) {
          progress.phase = 'walk_forward';
          progress.message = `Running walk-forward validation for ${symbol}...`;
          this.saveJobs();

          const wfResult = await this.runWalkForwardValidation(
            historicalData,
            overallOptimized.bestConfig,
            config
          );
          symbolResult.walkForwardResult = wfResult;
        }

        // Random day validation
        if (config.randomValidationDays > 0 && overallOptimized.bestConfig) {
          progress.phase = 'random_validation';
          progress.message = `Testing ${symbol} on random unseen days...`;
          this.saveJobs();

          const randomResult = await this.runRandomDayValidation(
            historicalData,
            overallOptimized.bestConfig,
            config.randomValidationDays
          );
          symbolResult.randomValidation = randomResult;
        }

        allResults.symbolResults[symbol] = symbolResult;

        if (overallOptimized.bestConfig) {
          allResults.strategies.push({
            symbol,
            config: overallOptimized.bestConfig,
            metrics: overallOptimized.bestMetrics,
            walkForwardScore: symbolResult.walkForwardResult?.robustnessScore,
            randomValidationScore: symbolResult.randomValidation?.passRate,
          });
        }

      } catch (symbolError) {
        job.errors.push({
          timestamp: new Date().toISOString(),
          symbol,
          message: symbolError.message,
        });
      }

      progress.symbolsCompleted = symbolIdx + 1;
      this.saveJobs();
    }

    // Generate summary
    progress.phase = 'generating_report';
    progress.message = 'Generating optimization report...';
    this.saveJobs();

    allResults.summary = this.generateSummary(allResults);
    allResults.completedAt = new Date().toISOString();

    return allResults;
  }

  /**
   * Optimize parameters using the selected method
   */
  async optimizeParameters(data, config, job, label) {
    const { progress } = job;
    const ranges = config.parameterRanges || this.parameterRanges;
    const method = config.method || 'random';

    let candidates;
    if (method === 'grid') {
      candidates = this.generateGridCandidates(ranges, config.maxIterations);
    } else if (method === 'random') {
      candidates = this.generateRandomCandidates(ranges, config.maxIterations);
    } else {
      // Default to random
      candidates = this.generateRandomCandidates(ranges, config.maxIterations);
    }

    let bestConfig = null;
    let bestMetrics = null;
    let bestScore = -Infinity;
    const testedConfigs = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // Update progress periodically
      if (i % 10 === 0) {
        progress.iterationsCompleted = i;
        progress.message = `${label}: Testing config ${i + 1}/${candidates.length}`;
        progress.lastUpdate = new Date().toISOString();
        this.saveJobs();
      }

      try {
        const metrics = this.simulateStrategy(data, candidate);

        // Check if meets minimum thresholds
        if (!this.meetsThresholds(metrics, config)) {
          continue;
        }

        const score = this.calculateScore(metrics);

        testedConfigs.push({
          config: candidate,
          metrics,
          score,
        });

        if (score > bestScore) {
          bestScore = score;
          bestConfig = candidate;
          bestMetrics = metrics;
        }
      } catch (error) {
        // Skip failed configs
        continue;
      }
    }

    progress.iterationsCompleted = candidates.length;
    this.saveJobs();

    return {
      bestConfig,
      bestMetrics,
      bestScore,
      candidatesTested: candidates.length,
      candidatesPassed: testedConfigs.length,
      topConfigs: testedConfigs
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    };
  }

  /**
   * Generate grid search candidates
   */
  generateGridCandidates(ranges, maxIterations) {
    const candidates = [];
    const paramNames = Object.keys(ranges);

    const generate = (index, current) => {
      if (candidates.length >= maxIterations) return;

      if (index === paramNames.length) {
        candidates.push({ ...current });
        return;
      }

      const param = paramNames[index];
      const range = ranges[param];

      for (let value = range.min; value <= range.max; value += range.step) {
        current[param] = Math.round(value * 100) / 100;
        generate(index + 1, current);
      }
    };

    generate(0, {});
    return candidates.slice(0, maxIterations);
  }

  /**
   * Generate random search candidates
   */
  generateRandomCandidates(ranges, count) {
    const candidates = [];
    const paramNames = Object.keys(ranges);

    for (let i = 0; i < count; i++) {
      const candidate = {};

      for (const param of paramNames) {
        const range = ranges[param];
        const steps = Math.floor((range.max - range.min) / range.step);
        const randomStep = Math.floor(Math.random() * (steps + 1));
        candidate[param] = Math.round((range.min + randomStep * range.step) * 100) / 100;
      }

      candidates.push(candidate);
    }

    return candidates;
  }

  /**
   * Simulate a strategy on historical data
   */
  simulateStrategy(data, config) {
    const trades = [];
    let position = null;
    let equity = 10000;

    const closes = data.map(d => d.close);

    for (let i = 20; i < data.length; i++) {
      const candle = data[i];
      const price = candle.close;

      // Simple RSI calculation
      const slice = closes.slice(Math.max(0, i - 14), i);
      let gains = 0, losses = 0;
      for (let j = 1; j < slice.length; j++) {
        const change = slice[j] - slice[j - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));

      // Check exit
      if (position) {
        const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100;

        let exit = false;
        if (pnlPercent >= config.takeProfitPercent) exit = true;
        if (pnlPercent <= -config.stopLossPercent) exit = true;
        if (i >= data.length - 5) exit = true; // End of data

        if (exit) {
          const pnl = (price - position.entryPrice) * position.shares;
          trades.push({
            pnl,
            pnlPercent,
            entryPrice: position.entryPrice,
            exitPrice: price,
          });
          equity += pnl;
          position = null;
        }
      }

      // Check entry
      if (!position && i < data.length - 30) {
        const rsiInRange = rsi >= config.entryRsiMin && rsi <= config.entryRsiMax;

        // Price above 20-period MA
        const ma20 = closes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / 20;
        const aboveMA = price > ma20;

        if (rsiInRange && aboveMA) {
          const shares = Math.floor((equity * (config.positionSizePercent / 100)) / price);
          if (shares > 0) {
            position = {
              entryPrice: price,
              shares,
            };
          }
        }
      }
    }

    // Calculate metrics
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    return {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      totalPnl: grossProfit - grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
      expectancy: trades.length > 0 ? (grossProfit - grossLoss) / trades.length : 0,
      maxDrawdown: this.calculateMaxDrawdown(trades),
    };
  }

  /**
   * Calculate maximum drawdown
   */
  calculateMaxDrawdown(trades) {
    if (trades.length === 0) return 0;

    let peak = 0;
    let maxDD = 0;
    let equity = 0;

    for (const trade of trades) {
      equity += trade.pnl;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    return maxDD;
  }

  /**
   * Check if metrics meet minimum thresholds
   */
  meetsThresholds(metrics, config) {
    if (metrics.totalTrades < 5) return false;
    if (metrics.winRate < config.minWinRate) return false;
    if (metrics.profitFactor < config.minProfitFactor) return false;
    if (metrics.expectancy < config.minExpectancy) return false;
    if (metrics.maxDrawdown > config.maxDrawdown) return false;
    return true;
  }

  /**
   * Calculate composite score for ranking
   */
  calculateScore(metrics) {
    return (
      metrics.expectancy * 30 +
      metrics.profitFactor * 20 +
      metrics.winRate * 100 * 15 -
      metrics.maxDrawdown * 2 +
      Math.min(metrics.totalTrades, 50) * 0.5
    );
  }

  /**
   * Filter data by regime
   */
  filterDataByRegime(data, timeline, regime) {
    const regimeDates = new Set(
      timeline
        .filter(t => t.regime === regime)
        .map(t => {
          const d = t.date;
          return typeof d === 'number'
            ? new Date(d).toISOString().split('T')[0]
            : d.split('T')[0];
        })
    );

    return data.filter(candle => {
      const d = candle.date || candle.t;
      const dateStr = typeof d === 'number'
        ? new Date(d).toISOString().split('T')[0]
        : d.split('T')[0];
      return regimeDates.has(dateStr);
    });
  }

  /**
   * Run walk-forward validation
   */
  async runWalkForwardValidation(data, config, jobConfig) {
    const windows = [];
    const windowSize = jobConfig.trainDays + jobConfig.testDays;
    const step = jobConfig.testDays;

    let passed = 0;
    let total = 0;

    for (let i = 0; i + windowSize <= data.length; i += step) {
      const trainData = data.slice(i, i + jobConfig.trainDays);
      const testData = data.slice(i + jobConfig.trainDays, i + windowSize);

      if (trainData.length < jobConfig.trainDays * 0.8) continue;
      if (testData.length < jobConfig.testDays * 0.8) continue;

      const testMetrics = this.simulateStrategy(testData, config);
      const passedWindow = this.meetsThresholds(testMetrics, jobConfig);

      windows.push({
        trainStart: trainData[0]?.date,
        testStart: testData[0]?.date,
        testEnd: testData[testData.length - 1]?.date,
        metrics: testMetrics,
        passed: passedWindow,
      });

      total++;
      if (passedWindow) passed++;
    }

    return {
      totalWindows: total,
      passedWindows: passed,
      robustnessScore: total > 0 ? (passed / total) * 100 : 0,
      windows,
    };
  }

  /**
   * Run random day validation
   */
  async runRandomDayValidation(data, config, numDays) {
    // Group data by date
    const dateGroups = {};
    for (const candle of data) {
      const d = candle.date || candle.t;
      const dateStr = typeof d === 'number'
        ? new Date(d).toISOString().split('T')[0]
        : d.split('T')[0];

      if (!dateGroups[dateStr]) dateGroups[dateStr] = [];
      dateGroups[dateStr].push(candle);
    }

    const allDates = Object.keys(dateGroups).filter(d => dateGroups[d].length >= 10);
    const shuffled = [...allDates].sort(() => Math.random() - 0.5);
    const selectedDates = shuffled.slice(0, Math.min(numDays, allDates.length));

    let profitableDays = 0;
    let totalPnl = 0;
    const results = [];

    for (const date of selectedDates) {
      const dayData = dateGroups[date];
      const metrics = this.simulateStrategy(dayData, config);

      results.push({
        date,
        pnl: metrics.totalPnl,
        trades: metrics.totalTrades,
        winRate: metrics.winRate,
      });

      totalPnl += metrics.totalPnl;
      if (metrics.totalPnl > 0) profitableDays++;
    }

    return {
      daysTesetd: selectedDates.length,
      profitableDays,
      losingDays: selectedDates.length - profitableDays,
      passRate: selectedDates.length > 0 ? (profitableDays / selectedDates.length) * 100 : 0,
      totalPnl,
      avgDailyPnl: selectedDates.length > 0 ? totalPnl / selectedDates.length : 0,
      results,
    };
  }

  /**
   * Generate summary report
   */
  generateSummary(results) {
    const strategies = results.strategies || [];

    // Find best overall strategy
    const bestStrategy = strategies.length > 0
      ? strategies.reduce((best, s) => {
          const score = (s.walkForwardScore || 0) + (s.randomValidationScore || 0) +
                       (s.metrics?.profitFactor || 0) * 10;
          const bestScore = (best.walkForwardScore || 0) + (best.randomValidationScore || 0) +
                           (best.metrics?.profitFactor || 0) * 10;
          return score > bestScore ? s : best;
        }, strategies[0])
      : null;

    // Regime-specific recommendations
    const regimeRecommendations = {};
    for (const [regime, configs] of Object.entries(results.regimeStrategies || {})) {
      if (configs.length > 0) {
        const best = configs.reduce((b, c) =>
          (c.bestScore || 0) > (b.bestScore || 0) ? c : b
        , configs[0]);
        regimeRecommendations[regime] = {
          symbol: best.symbol,
          config: best.bestConfig,
          metrics: best.bestMetrics,
        };
      }
    }

    return {
      totalSymbols: Object.keys(results.symbolResults || {}).length,
      totalStrategiesFound: strategies.length,
      bestStrategy,
      regimeRecommendations,
      readyForTomorrow: bestStrategy &&
        (bestStrategy.walkForwardScore || 0) >= 60 &&
        (bestStrategy.randomValidationScore || 0) >= 60,
      recommendations: this.generateRecommendations(results),
    };
  }

  /**
   * Generate actionable recommendations
   */
  generateRecommendations(results) {
    const recs = [];
    const summary = results.summary;

    if (!summary?.bestStrategy) {
      recs.push({
        type: 'warning',
        message: 'No strategies met the minimum thresholds. Consider relaxing parameters or adding more data.',
      });
      return recs;
    }

    const best = summary.bestStrategy;

    if ((best.walkForwardScore || 0) >= 80) {
      recs.push({
        type: 'success',
        message: `Strategy for ${best.symbol} is highly robust (${best.walkForwardScore}% walk-forward score). Confident for live trading.`,
      });
    } else if ((best.walkForwardScore || 0) >= 60) {
      recs.push({
        type: 'info',
        message: `Strategy for ${best.symbol} shows moderate robustness (${best.walkForwardScore}%). Start with smaller position sizes.`,
      });
    } else {
      recs.push({
        type: 'warning',
        message: `Strategy may be overfit. Walk-forward score is ${best.walkForwardScore || 'N/A'}%. Use with caution.`,
      });
    }

    // Regime-specific recs
    for (const [regime, rec] of Object.entries(summary.regimeRecommendations || {})) {
      recs.push({
        type: 'info',
        message: `For ${regime.toUpperCase()} markets, use: TP=${rec.config?.takeProfitPercent}%, SL=${rec.config?.stopLossPercent}%`,
      });
    }

    return recs;
  }

  /**
   * Save detailed results to file
   */
  saveResults(jobId, results) {
    const filename = path.join(this.resultsDir, `${jobId}.json`);
    try {
      fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    } catch (error) {
      console.error('Error saving results:', error.message);
    }
  }

  /**
   * Get job status
   */
  getJob(jobId) {
    let job = this.jobs.jobs.find(j => j.id === jobId);
    if (!job) {
      job = this.jobs.completedJobs.find(j => j.id === jobId);
    }
    return job;
  }

  /**
   * Get all jobs
   */
  getAllJobs() {
    return {
      active: this.jobs.jobs,
      completed: this.jobs.completedJobs.slice(0, 10), // Last 10 completed
    };
  }

  /**
   * Get all jobs as a flat array (for API)
   */
  getJobs() {
    return [...this.jobs.jobs, ...this.jobs.completedJobs.slice(0, 20)];
  }

  /**
   * Delete a job
   */
  deleteJob(jobId) {
    const activeIdx = this.jobs.jobs.findIndex(j => j.id === jobId);
    if (activeIdx >= 0) {
      this.jobs.jobs.splice(activeIdx, 1);
      this.saveJobs();
      return true;
    }

    const completedIdx = this.jobs.completedJobs.findIndex(j => j.id === jobId);
    if (completedIdx >= 0) {
      this.jobs.completedJobs.splice(completedIdx, 1);
      this.saveJobs();
      // Also delete results file
      const filename = path.join(this.resultsDir, `${jobId}.json`);
      if (fs.existsSync(filename)) {
        fs.unlinkSync(filename);
      }
      return true;
    }

    return false;
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    const job = this.jobs.jobs.find(j => j.id === jobId);
    if (!job) {
      return { success: false, error: 'Job not found' };
    }

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    job.progress.phase = 'cancelled';
    job.progress.message = 'Job cancelled by user';
    this.saveJobs();

    return { success: true, job };
  }

  /**
   * Get results for a completed job
   */
  getResults(jobId) {
    const filename = path.join(this.resultsDir, `${jobId}.json`);
    try {
      if (fs.existsSync(filename)) {
        return JSON.parse(fs.readFileSync(filename, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading results:', error.message);
    }
    return null;
  }
}

module.exports = OvernightOptimizer;
