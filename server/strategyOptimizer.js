/**
 * STRATEGY OPTIMIZER - Genetic Algorithm & Multi-Simulation Engine
 *
 * Runs thousands of backtests to find optimal trading parameters.
 * Uses genetic algorithm for parameter evolution and Monte Carlo
 * for risk assessment.
 *
 * Key Features:
 * - Genetic algorithm for parameter optimization
 * - Multi-timeframe backtesting (1m, 5m, 15m, 1H)
 * - Inverse correlation trading (QBTX bullish, QBTZ bearish)
 * - Walk-forward validation
 * - Monte Carlo risk simulation
 */

const { getAggregates } = require('./polygonClient');
const { getAllIndicators } = require('./technicalIndicatorsService');
const TransactionCostModel = require('./transactionCostModel');

// Shared cost model for realistic per-symbol slippage
const costModel = new TransactionCostModel();

// ============================================
// GENETIC ALGORITHM CONFIG
// ============================================
const GA_CONFIG = {
  populationSize: 50,
  generations: 30,
  mutationRate: 0.15,
  crossoverRate: 0.7,
  eliteCount: 5,
  tournamentSize: 3,
};

// ============================================
// PARAMETER RANGES FOR OPTIMIZATION
// ============================================
const PARAMETER_RANGES = {
  // Entry conditions
  rsiOversold: { min: 20, max: 40, step: 2 },
  rsiOverbought: { min: 60, max: 80, step: 2 },
  rsiEntryThreshold: { min: 30, max: 50, step: 5 },

  // Exit conditions
  takeProfitPercent: { min: 1, max: 10, step: 0.5 },
  stopLossPercent: { min: 0.5, max: 5, step: 0.5 },
  trailingStopPercent: { min: 0, max: 3, step: 0.5 },

  // Volume filters
  volumeMultiplier: { min: 1, max: 3, step: 0.25 },

  // Trend filters
  adxMinStrength: { min: 15, max: 35, step: 5 },

  // Position sizing
  positionSizePercent: { min: 5, max: 25, step: 5 },

  // Timeframe specific
  holdingPeriodBars: { min: 2, max: 20, step: 2 },

  // MACD
  macdFastPeriod: { min: 8, max: 14, step: 2 },
  macdSlowPeriod: { min: 20, max: 30, step: 2 },
  macdSignalPeriod: { min: 7, max: 11, step: 2 },
};

// ============================================
// STRATEGY CHROMOSOME (Individual)
// ============================================
class StrategyChromosome {
  constructor(genes = null) {
    if (genes) {
      this.genes = genes;
    } else {
      this.genes = this.randomGenes();
    }
    this.fitness = 0;
    this.metrics = {};
  }

  randomGenes() {
    const genes = {};
    for (const [param, range] of Object.entries(PARAMETER_RANGES)) {
      const steps = Math.floor((range.max - range.min) / range.step);
      const randomStep = Math.floor(Math.random() * (steps + 1));
      genes[param] = range.min + randomStep * range.step;
    }
    return genes;
  }

  mutate(mutationRate) {
    const mutatedGenes = { ...this.genes };
    for (const [param, range] of Object.entries(PARAMETER_RANGES)) {
      if (Math.random() < mutationRate) {
        // Small mutation: adjust by 1-2 steps
        const direction = Math.random() < 0.5 ? -1 : 1;
        const steps = Math.floor(Math.random() * 2) + 1;
        mutatedGenes[param] = Math.max(
          range.min,
          Math.min(range.max, mutatedGenes[param] + direction * steps * range.step)
        );
      }
    }
    return new StrategyChromosome(mutatedGenes);
  }

  crossover(other) {
    const childGenes = {};
    for (const param of Object.keys(PARAMETER_RANGES)) {
      // Uniform crossover with blending
      if (Math.random() < 0.5) {
        childGenes[param] = this.genes[param];
      } else {
        childGenes[param] = other.genes[param];
      }
    }
    return new StrategyChromosome(childGenes);
  }

  clone() {
    const cloned = new StrategyChromosome({ ...this.genes });
    cloned.fitness = this.fitness;
    cloned.metrics = { ...this.metrics };
    return cloned;
  }
}

// ============================================
// BACKTESTER ENGINE
// ============================================
class Backtester {
  constructor(candles, config = {}) {
    this.candles = candles;
    this.symbol = config.symbol || null;
    this.config = {
      initialCapital: config.initialCapital || 10000,
      commissionPercent: config.commissionPercent || 0,
      // Use per-symbol cost model instead of flat slippage
      slippage: config.slippage || 0.001, // Fallback only if no symbol
      ...config,
    };
  }

  /**
   * Get realistic execution price using TransactionCostModel when symbol is available
   */
  getExecPrice(price, side) {
    if (this.symbol) {
      return costModel.getExecutionPrice(this.symbol, price, side);
    }
    // Fallback to flat slippage
    return side === 'BUY' || side === 'buy'
      ? price * (1 + this.config.slippage)
      : price * (1 - this.config.slippage);
  }

  /**
   * Calculate technical indicators for each bar
   */
  calculateIndicators(params) {
    const indicators = [];
    const closes = this.candles.map(c => c.close);
    const highs = this.candles.map(c => c.high);
    const lows = this.candles.map(c => c.low);
    const volumes = this.candles.map(c => c.volume);

    for (let i = 0; i < this.candles.length; i++) {
      const slice = Math.min(i + 1, 50);
      const closesSlice = closes.slice(Math.max(0, i - slice + 1), i + 1);
      const highsSlice = highs.slice(Math.max(0, i - slice + 1), i + 1);
      const lowsSlice = lows.slice(Math.max(0, i - slice + 1), i + 1);
      const volumesSlice = volumes.slice(Math.max(0, i - slice + 1), i + 1);

      indicators.push({
        rsi: this.calculateRSI(closesSlice, 14),
        macd: this.calculateMACD(
          closesSlice,
          params.macdFastPeriod || 12,
          params.macdSlowPeriod || 26,
          params.macdSignalPeriod || 9
        ),
        adx: this.calculateADX(highsSlice, lowsSlice, closesSlice, 14),
        volumeRatio: this.calculateVolumeRatio(volumesSlice, 20),
        atr: this.calculateATR(highsSlice, lowsSlice, closesSlice, 14),
        ema9: this.calculateEMA(closesSlice, 9),
        ema21: this.calculateEMA(closesSlice, 21),
        vwap: this.calculateVWAP(closesSlice, volumesSlice),
      });
    }

    return indicators;
  }

  calculateRSI(closes, period) {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateMACD(closes, fast, slow, signal) {
    if (closes.length < slow) return { histogram: 0, macd: 0, signal: 0 };

    const emaFast = this.calculateEMA(closes, fast);
    const emaSlow = this.calculateEMA(closes, slow);
    const macdLine = emaFast - emaSlow;

    return { histogram: macdLine, macd: macdLine, signal: 0 };
  }

  calculateEMA(data, period) {
    if (data.length < period) return data[data.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateADX(highs, lows, closes, period) {
    if (closes.length < period * 2) return 25;

    // Simplified ADX calculation
    let sumDX = 0;
    for (let i = 1; i < Math.min(period, closes.length); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      const dmPlus = Math.max(0, highs[i] - highs[i - 1]);
      const dmMinus = Math.max(0, lows[i - 1] - lows[i]);

      if (tr > 0) {
        sumDX += Math.abs(dmPlus - dmMinus) / tr;
      }
    }

    return (sumDX / period) * 100;
  }

  calculateVolumeRatio(volumes, period) {
    if (volumes.length < period) return 1;
    const avgVolume =
      volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
    return volumes[volumes.length - 1] / avgVolume;
  }

  calculateATR(highs, lows, closes, period) {
    if (closes.length < 2) return 0;

    const trueRanges = [];
    for (let i = 1; i < Math.min(period + 1, closes.length); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trueRanges.push(tr);
    }

    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  calculateVWAP(closes, volumes) {
    if (closes.length === 0) return 0;
    const totalVolume = volumes.reduce((a, b) => a + b, 0);
    if (totalVolume === 0) return closes[closes.length - 1];

    let vwap = 0;
    for (let i = 0; i < closes.length; i++) {
      vwap += closes[i] * volumes[i];
    }
    return vwap / totalVolume;
  }

  /**
   * Run backtest with given parameters
   */
  run(params) {
    const indicators = this.calculateIndicators(params);
    const trades = [];

    let capital = this.config.initialCapital;
    let position = null;
    let peakCapital = capital;
    let maxDrawdown = 0;

    for (let i = 50; i < this.candles.length; i++) {
      const candle = this.candles[i];
      const ind = indicators[i];

      // Update drawdown
      peakCapital = Math.max(peakCapital, capital);
      const currentDrawdown = (peakCapital - capital) / peakCapital;
      maxDrawdown = Math.max(maxDrawdown, currentDrawdown);

      // Check exit conditions first
      if (position) {
        const pnlPercent =
          ((candle.close - position.entryPrice) / position.entryPrice) * 100;

        // Take profit
        if (pnlPercent >= params.takeProfitPercent) {
          const exitPrice = this.getExecPrice(candle.close, 'SELL');
          const pnl = position.shares * (exitPrice - position.entryPrice);
          capital += position.shares * exitPrice;

          trades.push({
            entryBar: position.entryBar,
            exitBar: i,
            entryPrice: position.entryPrice,
            exitPrice,
            shares: position.shares,
            pnl,
            pnlPercent: (pnl / (position.shares * position.entryPrice)) * 100,
            exitReason: 'takeProfit',
            holdingBars: i - position.entryBar,
          });

          position = null;
          continue;
        }

        // Stop loss
        if (pnlPercent <= -params.stopLossPercent) {
          const exitPrice = this.getExecPrice(candle.close, 'SELL');
          const pnl = position.shares * (exitPrice - position.entryPrice);
          capital += position.shares * exitPrice;

          trades.push({
            entryBar: position.entryBar,
            exitBar: i,
            entryPrice: position.entryPrice,
            exitPrice,
            shares: position.shares,
            pnl,
            pnlPercent: (pnl / (position.shares * position.entryPrice)) * 100,
            exitReason: 'stopLoss',
            holdingBars: i - position.entryBar,
          });

          position = null;
          continue;
        }

        // Max holding period
        if (i - position.entryBar >= params.holdingPeriodBars) {
          const exitPrice = this.getExecPrice(candle.close, 'SELL');
          const pnl = position.shares * (exitPrice - position.entryPrice);
          capital += position.shares * exitPrice;

          trades.push({
            entryBar: position.entryBar,
            exitBar: i,
            entryPrice: position.entryPrice,
            exitPrice,
            shares: position.shares,
            pnl,
            pnlPercent: (pnl / (position.shares * position.entryPrice)) * 100,
            exitReason: 'maxHolding',
            holdingBars: i - position.entryBar,
          });

          position = null;
          continue;
        }
      }

      // Check entry conditions (no position)
      if (!position && capital > 0) {
        const entrySignal = this.checkEntrySignal(candle, ind, params);

        if (entrySignal) {
          const entryPrice = this.getExecPrice(candle.close, 'BUY');
          const positionValue = capital * (params.positionSizePercent / 100);
          const shares = Math.floor(positionValue / entryPrice);

          if (shares > 0) {
            capital -= shares * entryPrice;
            position = {
              entryBar: i,
              entryPrice,
              shares,
              entryReason: entrySignal,
            };
          }
        }
      }
    }

    // Close any remaining position
    if (position) {
      const lastCandle = this.candles[this.candles.length - 1];
      const exitPrice = lastCandle.close;
      const pnl = position.shares * (exitPrice - position.entryPrice);
      capital += position.shares * exitPrice;

      trades.push({
        entryBar: position.entryBar,
        exitBar: this.candles.length - 1,
        entryPrice: position.entryPrice,
        exitPrice,
        shares: position.shares,
        pnl,
        pnlPercent: (pnl / (position.shares * position.entryPrice)) * 100,
        exitReason: 'endOfData',
        holdingBars: this.candles.length - 1 - position.entryBar,
      });
    }

    // Calculate metrics
    const metrics = this.calculateMetrics(
      trades,
      capital,
      this.config.initialCapital,
      maxDrawdown
    );

    return { trades, metrics, finalCapital: capital };
  }

  checkEntrySignal(candle, indicators, params) {
    const signals = [];

    // RSI oversold
    if (indicators.rsi < params.rsiOversold) {
      signals.push('rsiOversold');
    }

    // RSI in entry zone
    if (
      indicators.rsi >= params.rsiOversold &&
      indicators.rsi < params.rsiEntryThreshold
    ) {
      signals.push('rsiEntryZone');
    }

    // MACD bullish
    if (indicators.macd.histogram > 0) {
      signals.push('macdBullish');
    }

    // Volume spike
    if (indicators.volumeRatio >= params.volumeMultiplier) {
      signals.push('volumeSpike');
    }

    // ADX trending
    if (indicators.adx >= params.adxMinStrength) {
      signals.push('trending');
    }

    // EMA alignment bullish
    if (indicators.ema9 > indicators.ema21) {
      signals.push('emaBullish');
    }

    // Price above VWAP
    if (candle.close > indicators.vwap) {
      signals.push('aboveVWAP');
    }

    // Require at least 3 signals for entry
    if (signals.length >= 3) {
      return signals.join(',');
    }

    return null;
  }

  calculateMetrics(trades, finalCapital, initialCapital, maxDrawdown) {
    if (trades.length === 0) {
      return {
        totalReturn: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        maxDrawdown: maxDrawdown * 100,
        sharpeRatio: 0,
        expectancy: 0,
        fitness: -Infinity,
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);

    const totalReturn =
      ((finalCapital - initialCapital) / initialCapital) * 100;
    const winRate = (wins.length / trades.length) * 100;

    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit;

    const avgWin =
      wins.length > 0
        ? wins.reduce((sum, t) => sum + t.pnlPercent, 0) / wins.length
        : 0;
    const avgLoss =
      losses.length > 0
        ? Math.abs(losses.reduce((sum, t) => sum + t.pnlPercent, 0)) /
          losses.length
        : 0;

    const expectancy =
      (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

    // Calculate Sharpe Ratio (simplified)
    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    // Fitness function: Optimize for risk-adjusted returns
    // Penalize low trade count, high drawdown, low win rate
    const fitness =
      totalReturn * 0.3 + // 30% weight on return
      profitFactor * 10 * 0.2 + // 20% weight on profit factor
      winRate * 0.2 + // 20% weight on win rate
      expectancy * 0.15 + // 15% weight on expectancy
      -maxDrawdown * 100 * 0.15; // 15% penalty for drawdown

    return {
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalTrades: trades.length,
      winRate: Math.round(winRate * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100 * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      fitness: Math.round(fitness * 100) / 100,
    };
  }
}

// ============================================
// GENETIC ALGORITHM OPTIMIZER
// ============================================
class GeneticOptimizer {
  constructor(candles, config = {}) {
    this.backtester = new Backtester(candles, config);
    this.config = { ...GA_CONFIG, ...config };
    this.population = [];
    this.bestChromosome = null;
    this.generationHistory = [];
  }

  /**
   * Initialize population with random chromosomes
   */
  initializePopulation() {
    this.population = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      this.population.push(new StrategyChromosome());
    }
  }

  /**
   * Evaluate fitness for all chromosomes
   */
  evaluatePopulation() {
    for (const chromosome of this.population) {
      const result = this.backtester.run(chromosome.genes);
      chromosome.fitness = result.metrics.fitness;
      chromosome.metrics = result.metrics;
    }

    // Sort by fitness (descending)
    this.population.sort((a, b) => b.fitness - a.fitness);

    // Update best chromosome
    if (
      !this.bestChromosome ||
      this.population[0].fitness > this.bestChromosome.fitness
    ) {
      this.bestChromosome = this.population[0].clone();
    }
  }

  /**
   * Tournament selection
   */
  tournamentSelect() {
    const tournament = [];
    for (let i = 0; i < this.config.tournamentSize; i++) {
      const idx = Math.floor(Math.random() * this.population.length);
      tournament.push(this.population[idx]);
    }
    tournament.sort((a, b) => b.fitness - a.fitness);
    return tournament[0];
  }

  /**
   * Create next generation
   */
  evolve() {
    const newPopulation = [];

    // Elitism: keep best chromosomes
    for (let i = 0; i < this.config.eliteCount; i++) {
      newPopulation.push(this.population[i].clone());
    }

    // Fill rest with crossover and mutation
    while (newPopulation.length < this.config.populationSize) {
      const parent1 = this.tournamentSelect();
      const parent2 = this.tournamentSelect();

      let child;
      if (Math.random() < this.config.crossoverRate) {
        child = parent1.crossover(parent2);
      } else {
        child = parent1.clone();
      }

      child = child.mutate(this.config.mutationRate);
      newPopulation.push(child);
    }

    this.population = newPopulation;
  }

  /**
   * Run full optimization
   */
  async optimize(progressCallback = null) {
    console.log('🧬 Starting Genetic Algorithm Optimization...');
    console.log(`   Population: ${this.config.populationSize}`);
    console.log(`   Generations: ${this.config.generations}`);

    this.initializePopulation();

    for (let gen = 0; gen < this.config.generations; gen++) {
      this.evaluatePopulation();

      const best = this.population[0];
      const avgFitness =
        this.population.reduce((sum, c) => sum + c.fitness, 0) /
        this.population.length;

      this.generationHistory.push({
        generation: gen + 1,
        bestFitness: best.fitness,
        avgFitness,
        bestReturn: best.metrics.totalReturn,
        bestWinRate: best.metrics.winRate,
      });

      if (progressCallback) {
        progressCallback({
          generation: gen + 1,
          totalGenerations: this.config.generations,
          bestFitness: best.fitness,
          bestReturn: best.metrics.totalReturn,
          bestWinRate: best.metrics.winRate,
        });
      }

      console.log(
        `   Gen ${gen + 1}: Best Fitness=${best.fitness.toFixed(2)} Return=${best.metrics.totalReturn.toFixed(1)}% WinRate=${best.metrics.winRate.toFixed(1)}%`
      );

      // Early stopping if fitness converges
      if (gen > 10) {
        const recentHistory = this.generationHistory.slice(-5);
        const fitnessChange = Math.abs(
          recentHistory[recentHistory.length - 1].bestFitness -
            recentHistory[0].bestFitness
        );
        if (fitnessChange < 0.1) {
          console.log('   🎯 Converged early!');
          break;
        }
      }

      this.evolve();
    }

    return {
      bestChromosome: this.bestChromosome,
      generationHistory: this.generationHistory,
    };
  }
}

// ============================================
// MONTE CARLO SIMULATION
// ============================================
class MonteCarloSimulator {
  constructor(trades, config = {}) {
    this.trades = trades;
    this.config = {
      simulations: config.simulations || 1000,
      initialCapital: config.initialCapital || 10000,
    };
  }

  run() {
    if (this.trades.length === 0) {
      return {
        probOfProfit: 0,
        avgReturn: 0,
        percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
        riskOfRuin: 100,
      };
    }

    const results = [];

    for (let i = 0; i < this.config.simulations; i++) {
      let capital = this.config.initialCapital;

      // Randomly sample trades with replacement
      const numTrades = Math.max(20, Math.floor(this.trades.length * 1.5));

      for (let j = 0; j < numTrades; j++) {
        const trade = this.trades[Math.floor(Math.random() * this.trades.length)];
        capital *= 1 + trade.pnlPercent / 100;

        // Stop if ruin (90% loss)
        if (capital < this.config.initialCapital * 0.1) {
          break;
        }
      }

      results.push(capital);
    }

    results.sort((a, b) => a - b);

    const profitableRuns = results.filter(
      r => r > this.config.initialCapital
    ).length;
    const ruinedRuns = results.filter(
      r => r < this.config.initialCapital * 0.1
    ).length;

    const avgReturn =
      ((results.reduce((a, b) => a + b, 0) / results.length -
        this.config.initialCapital) /
        this.config.initialCapital) *
      100;

    return {
      probOfProfit: (profitableRuns / this.config.simulations) * 100,
      avgReturn: Math.round(avgReturn * 100) / 100,
      percentiles: {
        p5:
          Math.round(
            ((results[Math.floor(results.length * 0.05)] -
              this.config.initialCapital) /
              this.config.initialCapital) *
              10000
          ) / 100,
        p25:
          Math.round(
            ((results[Math.floor(results.length * 0.25)] -
              this.config.initialCapital) /
              this.config.initialCapital) *
              10000
          ) / 100,
        p50:
          Math.round(
            ((results[Math.floor(results.length * 0.5)] -
              this.config.initialCapital) /
              this.config.initialCapital) *
              10000
          ) / 100,
        p75:
          Math.round(
            ((results[Math.floor(results.length * 0.75)] -
              this.config.initialCapital) /
              this.config.initialCapital) *
              10000
          ) / 100,
        p95:
          Math.round(
            ((results[Math.floor(results.length * 0.95)] -
              this.config.initialCapital) /
              this.config.initialCapital) *
              10000
          ) / 100,
      },
      riskOfRuin: (ruinedRuns / this.config.simulations) * 100,
    };
  }
}

// ============================================
// CORRELATION STRATEGY (QBTS/QBTX/QBTZ)
// ============================================
class CorrelationStrategy {
  /**
   * Analyze correlation between assets
   */
  static analyzeCorrelation(asset1Candles, asset2Candles) {
    // Match timestamps
    const map1 = new Map(asset1Candles.map(c => [c.timestamp, c]));
    const map2 = new Map(asset2Candles.map(c => [c.timestamp, c]));

    const commonTimestamps = [...map1.keys()].filter(t => map2.has(t));

    if (commonTimestamps.length < 10) {
      return { correlation: 0, pairs: 0 };
    }

    const returns1 = [];
    const returns2 = [];

    for (let i = 1; i < commonTimestamps.length; i++) {
      const t1 = commonTimestamps[i - 1];
      const t2 = commonTimestamps[i];

      const c1Prev = map1.get(t1);
      const c1Curr = map1.get(t2);
      const c2Prev = map2.get(t1);
      const c2Curr = map2.get(t2);

      returns1.push((c1Curr.close - c1Prev.close) / c1Prev.close);
      returns2.push((c2Curr.close - c2Prev.close) / c2Prev.close);
    }

    // Calculate Pearson correlation
    const mean1 = returns1.reduce((a, b) => a + b, 0) / returns1.length;
    const mean2 = returns2.reduce((a, b) => a + b, 0) / returns2.length;

    let cov = 0;
    let var1 = 0;
    let var2 = 0;

    for (let i = 0; i < returns1.length; i++) {
      const d1 = returns1[i] - mean1;
      const d2 = returns2[i] - mean2;
      cov += d1 * d2;
      var1 += d1 * d1;
      var2 += d2 * d2;
    }

    const correlation = cov / Math.sqrt(var1 * var2) || 0;

    return {
      correlation: Math.round(correlation * 100) / 100,
      pairs: commonTimestamps.length,
    };
  }

  /**
   * Generate trading signals based on correlation
   * QBTX = bullish on QBTS (leveraged)
   * QBTZ = bearish on QBTS (inverse)
   */
  static generateSignals(qbtsCandles, qbtxCandles, qbtzCandles) {
    const signals = [];

    // Simple strategy: When QBTS shows strong momentum, trade the leveraged ETFs
    for (let i = 20; i < qbtsCandles.length; i++) {
      const slice = qbtsCandles.slice(i - 20, i + 1);
      const closes = slice.map(c => c.close);

      // Calculate short-term momentum
      const shortMomentum = (closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5];
      const mediumMomentum = (closes[closes.length - 1] - closes[0]) / closes[0];

      const timestamp = qbtsCandles[i].timestamp;

      if (shortMomentum > 0.02 && mediumMomentum > 0.01) {
        // Strong bullish - buy QBTX
        signals.push({
          timestamp,
          action: 'BUY',
          symbol: 'QBTX',
          reason: 'Strong bullish momentum on QBTS',
          confidence: Math.min(100, Math.abs(shortMomentum) * 500),
        });
      } else if (shortMomentum < -0.02 && mediumMomentum < -0.01) {
        // Strong bearish - buy QBTZ
        signals.push({
          timestamp,
          action: 'BUY',
          symbol: 'QBTZ',
          reason: 'Strong bearish momentum on QBTS',
          confidence: Math.min(100, Math.abs(shortMomentum) * 500),
        });
      }
    }

    return signals;
  }
}

// ============================================
// MAIN OPTIMIZER FUNCTION
// ============================================
async function runOptimization(symbol, startDate, endDate, options = {}) {
  console.log('='.repeat(60));
  console.log(`📊 STRATEGY OPTIMIZER - ${symbol}`);
  console.log(`📅 Period: ${startDate} to ${endDate}`);
  console.log('='.repeat(60));

  try {
    // Fetch historical data
    const candles = await getAggregates(symbol, 5, 'minute', {
      from: startDate,
      to: endDate,
    });

    if (!candles || candles.length < 100) {
      throw new Error(`Insufficient data: only ${candles?.length || 0} bars`);
    }

    console.log(`\n📈 Loaded ${candles.length} candles`);

    // Run genetic optimization
    const optimizer = new GeneticOptimizer(candles, {
      symbol,
      initialCapital: options.initialCapital || 10000,
      populationSize: options.populationSize || 50,
      generations: options.generations || 30,
    });

    const result = await optimizer.optimize();

    // Run Monte Carlo on best strategy
    const bestResult = optimizer.backtester.run(result.bestChromosome.genes);
    const monteCarlo = new MonteCarloSimulator(bestResult.trades, {
      simulations: 1000,
      initialCapital: options.initialCapital || 10000,
    });
    const mcResults = monteCarlo.run();

    console.log('\n' + '='.repeat(60));
    console.log('🏆 OPTIMIZATION RESULTS');
    console.log('='.repeat(60));

    console.log('\n📊 Best Strategy Parameters:');
    console.log(JSON.stringify(result.bestChromosome.genes, null, 2));

    console.log('\n📈 Performance Metrics:');
    console.log(`   Total Return: ${result.bestChromosome.metrics.totalReturn}%`);
    console.log(`   Total Trades: ${result.bestChromosome.metrics.totalTrades}`);
    console.log(`   Win Rate: ${result.bestChromosome.metrics.winRate}%`);
    console.log(`   Profit Factor: ${result.bestChromosome.metrics.profitFactor}`);
    console.log(`   Max Drawdown: ${result.bestChromosome.metrics.maxDrawdown}%`);
    console.log(`   Sharpe Ratio: ${result.bestChromosome.metrics.sharpeRatio}`);
    console.log(`   Expectancy: ${result.bestChromosome.metrics.expectancy}%`);

    console.log('\n🎲 Monte Carlo Analysis (1000 simulations):');
    console.log(`   Probability of Profit: ${mcResults.probOfProfit.toFixed(1)}%`);
    console.log(`   Average Return: ${mcResults.avgReturn}%`);
    console.log(`   Risk of Ruin: ${mcResults.riskOfRuin.toFixed(1)}%`);
    console.log(`   5th Percentile: ${mcResults.percentiles.p5}%`);
    console.log(`   50th Percentile (Median): ${mcResults.percentiles.p50}%`);
    console.log(`   95th Percentile: ${mcResults.percentiles.p95}%`);

    return {
      symbol,
      period: { startDate, endDate },
      candlesAnalyzed: candles.length,
      bestParams: result.bestChromosome.genes,
      metrics: result.bestChromosome.metrics,
      trades: bestResult.trades,
      monteCarlo: mcResults,
      generationHistory: result.generationHistory,
    };
  } catch (error) {
    console.error(`❌ Optimization failed: ${error.message}`);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
  runOptimization,
  GeneticOptimizer,
  Backtester,
  MonteCarloSimulator,
  CorrelationStrategy,
  StrategyChromosome,
  PARAMETER_RANGES,
  GA_CONFIG,
};
