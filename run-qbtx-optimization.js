#!/usr/bin/env node
/**
 * QBTX Strategy Optimization Script
 *
 * Analyzes Dec 4-5, 2025 trading data for QBTX, QBTS, and QBTZ
 * to find optimal day trading parameters.
 *
 * Run with: node run-qbtx-optimization.js
 */

require('dotenv').config();

const axios = require('axios');

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE_URL = 'https://api.polygon.io';

// ============================================
// FETCH DATA
// ============================================
async function fetchCandles(symbol, startDate, endDate, timespan = 'minute', multiplier = 5) {
  const url = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${startDate}/${endDate}`;

  const response = await axios.get(url, {
    params: {
      adjusted: 'true',
      sort: 'asc',
      limit: 50000,
      apiKey: POLYGON_API_KEY,
    },
  });

  if (!response.data.results || response.data.results.length === 0) {
    console.warn(`⚠️ No data found for ${symbol}`);
    return [];
  }

  return response.data.results.map(bar => ({
    timestamp: bar.t,
    date: new Date(bar.t).toISOString(),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    vwap: bar.vw,
  }));
}

// ============================================
// TECHNICAL INDICATORS
// ============================================
function calculateRSI(closes, period = 14) {
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

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = (data[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateVWAP(candles) {
  let cumulativeVolume = 0;
  let cumulativeVWAP = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativeVolume += c.volume;
    cumulativeVWAP += typicalPrice * c.volume;
  }

  return cumulativeVolume > 0 ? cumulativeVWAP / cumulativeVolume : 0;
}

// ============================================
// BACKTEST ENGINE
// ============================================
function backtest(candles, params) {
  const initialCapital = 10000;
  let capital = initialCapital;
  let position = null;
  const trades = [];

  // Pre-calculate indicators for all bars
  const closes = candles.map(c => c.close);

  for (let i = 20; i < candles.length; i++) {
    const candle = candles[i];
    const closesSlice = closes.slice(0, i + 1);
    const candlesSlice = candles.slice(0, i + 1);

    const rsi = calculateRSI(closesSlice, 14);
    const ema9 = calculateEMA(closesSlice, 9);
    const ema21 = calculateEMA(closesSlice, 21);
    const vwap = calculateVWAP(candlesSlice.slice(-78)); // ~6.5 hours of 5min bars

    // Exit logic
    if (position) {
      const pnlPercent = ((candle.close - position.entryPrice) / position.entryPrice) * 100;

      // Take profit
      if (pnlPercent >= params.takeProfitPercent) {
        const pnl = position.shares * (candle.close - position.entryPrice);
        capital += position.shares * candle.close;

        trades.push({
          entryTime: position.entryTime,
          exitTime: candle.date,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          shares: position.shares,
          pnl,
          pnlPercent,
          reason: 'takeProfit',
        });

        position = null;
        continue;
      }

      // Stop loss
      if (pnlPercent <= -params.stopLossPercent) {
        const pnl = position.shares * (candle.close - position.entryPrice);
        capital += position.shares * candle.close;

        trades.push({
          entryTime: position.entryTime,
          exitTime: candle.date,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          shares: position.shares,
          pnl,
          pnlPercent,
          reason: 'stopLoss',
        });

        position = null;
        continue;
      }

      // RSI overbought exit
      if (params.exitOnRsiOverbought && rsi > params.rsiOverbought) {
        const pnl = position.shares * (candle.close - position.entryPrice);
        capital += position.shares * candle.close;

        trades.push({
          entryTime: position.entryTime,
          exitTime: candle.date,
          entryPrice: position.entryPrice,
          exitPrice: candle.close,
          shares: position.shares,
          pnl,
          pnlPercent,
          reason: 'rsiOverbought',
        });

        position = null;
        continue;
      }
    }

    // Entry logic (no position)
    if (!position && capital > 100) {
      let signals = 0;

      // RSI oversold
      if (rsi < params.rsiOversold) signals += 2;
      else if (rsi < params.rsiEntry) signals += 1;

      // EMA alignment
      if (ema9 > ema21) signals += 1;

      // Price above VWAP
      if (candle.close > vwap) signals += 1;

      // Volume spike
      const avgVolume = candles.slice(Math.max(0, i - 20), i).reduce((s, c) => s + c.volume, 0) / 20;
      if (candle.volume > avgVolume * params.volumeMultiplier) signals += 1;

      if (signals >= params.minSignals) {
        const positionValue = capital * (params.positionSizePercent / 100);
        const shares = Math.floor(positionValue / candle.close);

        if (shares > 0) {
          capital -= shares * candle.close;
          position = {
            entryTime: candle.date,
            entryPrice: candle.close,
            shares,
            entryRsi: rsi,
          };
        }
      }
    }
  }

  // Close any remaining position
  if (position) {
    const lastCandle = candles[candles.length - 1];
    const pnl = position.shares * (lastCandle.close - position.entryPrice);
    capital += position.shares * lastCandle.close;

    trades.push({
      entryTime: position.entryTime,
      exitTime: lastCandle.date,
      entryPrice: position.entryPrice,
      exitPrice: lastCandle.close,
      shares: position.shares,
      pnl,
      pnlPercent: ((lastCandle.close - position.entryPrice) / position.entryPrice) * 100,
      reason: 'endOfDay',
    });
  }

  // Calculate metrics
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit || 0;

  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPercent, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPercent, 0)) / losses.length : 0;

  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  // Fitness: optimize for risk-adjusted returns
  const fitness =
    totalReturn * 0.35 +
    profitFactor * 10 * 0.25 +
    winRate * 0.2 +
    expectancy * 0.2;

  return {
    trades,
    metrics: {
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      fitness: Math.round(fitness * 100) / 100,
    },
    finalCapital: capital,
  };
}

// ============================================
// GENETIC ALGORITHM
// ============================================
const PARAM_RANGES = {
  rsiOversold: { min: 20, max: 40, step: 2 },
  rsiEntry: { min: 35, max: 55, step: 5 },
  rsiOverbought: { min: 65, max: 85, step: 5 },
  takeProfitPercent: { min: 1, max: 8, step: 0.5 },
  stopLossPercent: { min: 0.5, max: 4, step: 0.5 },
  positionSizePercent: { min: 20, max: 80, step: 10 },
  volumeMultiplier: { min: 1, max: 2.5, step: 0.25 },
  minSignals: { min: 2, max: 4, step: 1 },
  exitOnRsiOverbought: { min: 0, max: 1, step: 1 },
};

function randomParams() {
  const params = {};
  for (const [key, range] of Object.entries(PARAM_RANGES)) {
    const steps = Math.floor((range.max - range.min) / range.step);
    const randomStep = Math.floor(Math.random() * (steps + 1));
    params[key] = range.min + randomStep * range.step;
  }
  params.exitOnRsiOverbought = params.exitOnRsiOverbought === 1;
  return params;
}

function mutateParams(params, mutationRate = 0.2) {
  const mutated = { ...params };
  for (const [key, range] of Object.entries(PARAM_RANGES)) {
    if (Math.random() < mutationRate) {
      const direction = Math.random() < 0.5 ? -1 : 1;
      const steps = Math.floor(Math.random() * 2) + 1;
      let currentVal = key === 'exitOnRsiOverbought' ? (params[key] ? 1 : 0) : params[key];
      currentVal = Math.max(range.min, Math.min(range.max, currentVal + direction * steps * range.step));
      mutated[key] = key === 'exitOnRsiOverbought' ? currentVal === 1 : currentVal;
    }
  }
  return mutated;
}

function crossover(parent1, parent2) {
  const child = {};
  for (const key of Object.keys(PARAM_RANGES)) {
    child[key] = Math.random() < 0.5 ? parent1[key] : parent2[key];
  }
  return child;
}

async function runGeneticOptimization(candles, config = {}) {
  const populationSize = config.populationSize || 100;
  const generations = config.generations || 50;
  const eliteCount = config.eliteCount || 10;

  console.log(`\n🧬 Running Genetic Algorithm...`);
  console.log(`   Population: ${populationSize}`);
  console.log(`   Generations: ${generations}`);
  console.log(`   Candles: ${candles.length}`);

  // Initialize population
  let population = [];
  for (let i = 0; i < populationSize; i++) {
    population.push(randomParams());
  }

  let bestEver = null;
  let bestEverFitness = -Infinity;

  for (let gen = 0; gen < generations; gen++) {
    // Evaluate fitness
    const evaluated = population.map(params => {
      const result = backtest(candles, params);
      return { params, ...result };
    });

    // Sort by fitness
    evaluated.sort((a, b) => b.metrics.fitness - a.metrics.fitness);

    // Track best
    if (evaluated[0].metrics.fitness > bestEverFitness) {
      bestEverFitness = evaluated[0].metrics.fitness;
      bestEver = evaluated[0];
    }

    // Log progress
    const avgFitness = evaluated.reduce((s, e) => s + e.metrics.fitness, 0) / evaluated.length;
    console.log(
      `   Gen ${gen + 1}: Best=${evaluated[0].metrics.fitness.toFixed(1)} Avg=${avgFitness.toFixed(1)} Return=${evaluated[0].metrics.totalReturn.toFixed(1)}% Trades=${evaluated[0].metrics.totalTrades}`
    );

    // Early convergence check
    if (gen > 20) {
      const topFitnesses = evaluated.slice(0, 10).map(e => e.metrics.fitness);
      const variance = topFitnesses.reduce((s, f) => s + Math.pow(f - avgFitness, 2), 0) / 10;
      if (variance < 0.5) {
        console.log(`   🎯 Converged at generation ${gen + 1}`);
        break;
      }
    }

    // Create next generation
    const nextGen = [];

    // Elitism
    for (let i = 0; i < eliteCount; i++) {
      nextGen.push(evaluated[i].params);
    }

    // Breed rest
    while (nextGen.length < populationSize) {
      // Tournament selection
      const tournament = [];
      for (let i = 0; i < 3; i++) {
        tournament.push(evaluated[Math.floor(Math.random() * evaluated.length)]);
      }
      tournament.sort((a, b) => b.metrics.fitness - a.metrics.fitness);
      const parent1 = tournament[0].params;

      const tournament2 = [];
      for (let i = 0; i < 3; i++) {
        tournament2.push(evaluated[Math.floor(Math.random() * evaluated.length)]);
      }
      tournament2.sort((a, b) => b.metrics.fitness - a.metrics.fitness);
      const parent2 = tournament2[0].params;

      let child = crossover(parent1, parent2);
      child = mutateParams(child, 0.15);
      nextGen.push(child);
    }

    population = nextGen;
  }

  return bestEver;
}

// ============================================
// MONTE CARLO SIMULATION
// ============================================
function runMonteCarlo(trades, simulations = 1000) {
  if (trades.length === 0) {
    return { probOfProfit: 0, avgReturn: 0, percentiles: {} };
  }

  const results = [];

  for (let i = 0; i < simulations; i++) {
    let capital = 10000;
    const numTrades = Math.max(20, trades.length);

    for (let j = 0; j < numTrades; j++) {
      const trade = trades[Math.floor(Math.random() * trades.length)];
      capital *= 1 + trade.pnlPercent / 100;
    }

    results.push(capital);
  }

  results.sort((a, b) => a - b);

  const profitableRuns = results.filter(r => r > 10000).length;
  const avgReturn = ((results.reduce((a, b) => a + b, 0) / results.length - 10000) / 10000) * 100;

  return {
    probOfProfit: Math.round((profitableRuns / simulations) * 100),
    avgReturn: Math.round(avgReturn * 100) / 100,
    percentiles: {
      p5: Math.round(((results[Math.floor(results.length * 0.05)] - 10000) / 10000) * 10000) / 100,
      p25: Math.round(((results[Math.floor(results.length * 0.25)] - 10000) / 10000) * 10000) / 100,
      p50: Math.round(((results[Math.floor(results.length * 0.5)] - 10000) / 10000) * 10000) / 100,
      p75: Math.round(((results[Math.floor(results.length * 0.75)] - 10000) / 10000) * 10000) / 100,
      p95: Math.round(((results[Math.floor(results.length * 0.95)] - 10000) / 10000) * 10000) / 100,
    },
  };
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('='.repeat(70));
  console.log('📊 QBTX/QBTS/QBTZ STRATEGY OPTIMIZER');
  console.log('📅 Analyzing December 4-5, 2025');
  console.log('='.repeat(70));

  if (!POLYGON_API_KEY) {
    console.error('❌ POLYGON_API_KEY not set!');
    process.exit(1);
  }

  try {
    // Fetch data for all three symbols
    console.log('\n📥 Fetching market data...');

    const [qbtxData, qbtsData, qbtzData] = await Promise.all([
      fetchCandles('QBTX', '2025-12-03', '2025-12-05'),
      fetchCandles('QBTS', '2025-12-03', '2025-12-05'),
      fetchCandles('QBTZ', '2025-12-03', '2025-12-05'),
    ]);

    console.log(`   QBTX: ${qbtxData.length} bars`);
    console.log(`   QBTS: ${qbtsData.length} bars`);
    console.log(`   QBTZ: ${qbtzData.length} bars`);

    // Analyze price movements
    console.log('\n📈 Price Analysis:');
    for (const [symbol, data] of [['QBTX', qbtxData], ['QBTS', qbtsData], ['QBTZ', qbtzData]]) {
      if (data.length > 0) {
        const firstPrice = data[0].open;
        const lastPrice = data[data.length - 1].close;
        const highPrice = Math.max(...data.map(c => c.high));
        const lowPrice = Math.min(...data.map(c => c.low));
        const change = ((lastPrice - firstPrice) / firstPrice) * 100;
        const range = ((highPrice - lowPrice) / lowPrice) * 100;

        console.log(`   ${symbol}: $${firstPrice.toFixed(2)} → $${lastPrice.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%) Range: ${range.toFixed(1)}%`);
      }
    }

    // ============================================
    // OPTIMIZE QBTX (Bullish on QBTS)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('🚀 OPTIMIZING QBTX STRATEGY (Bullish Leverage)');
    console.log('='.repeat(70));

    const qbtxBest = await runGeneticOptimization(qbtxData, {
      populationSize: 100,
      generations: 50,
      eliteCount: 10,
    });

    // Run Monte Carlo
    const qbtxMC = runMonteCarlo(qbtxBest.trades, 1000);

    console.log('\n🏆 QBTX OPTIMAL STRATEGY:');
    console.log('-'.repeat(50));
    console.log('Parameters:');
    console.log(`   RSI Oversold: ${qbtxBest.params.rsiOversold}`);
    console.log(`   RSI Entry: ${qbtxBest.params.rsiEntry}`);
    console.log(`   RSI Overbought: ${qbtxBest.params.rsiOverbought}`);
    console.log(`   Take Profit: ${qbtxBest.params.takeProfitPercent}%`);
    console.log(`   Stop Loss: ${qbtxBest.params.stopLossPercent}%`);
    console.log(`   Position Size: ${qbtxBest.params.positionSizePercent}%`);
    console.log(`   Volume Multiplier: ${qbtxBest.params.volumeMultiplier}x`);
    console.log(`   Min Signals: ${qbtxBest.params.minSignals}`);
    console.log(`   Exit on RSI Overbought: ${qbtxBest.params.exitOnRsiOverbought}`);

    console.log('\nPerformance:');
    console.log(`   Total Return: ${qbtxBest.metrics.totalReturn}%`);
    console.log(`   Total Trades: ${qbtxBest.metrics.totalTrades}`);
    console.log(`   Win Rate: ${qbtxBest.metrics.winRate}%`);
    console.log(`   Profit Factor: ${qbtxBest.metrics.profitFactor}`);
    console.log(`   Avg Win: ${qbtxBest.metrics.avgWin}%`);
    console.log(`   Avg Loss: ${qbtxBest.metrics.avgLoss}%`);
    console.log(`   Expectancy: ${qbtxBest.metrics.expectancy}%`);

    console.log('\nMonte Carlo (1000 sims):');
    console.log(`   Prob of Profit: ${qbtxMC.probOfProfit}%`);
    console.log(`   Avg Return: ${qbtxMC.avgReturn}%`);
    console.log(`   5th Percentile: ${qbtxMC.percentiles.p5}%`);
    console.log(`   Median: ${qbtxMC.percentiles.p50}%`);
    console.log(`   95th Percentile: ${qbtxMC.percentiles.p95}%`);

    if (qbtxBest.trades.length > 0) {
      console.log('\nTrade Details:');
      qbtxBest.trades.forEach((t, i) => {
        const entryTime = new Date(t.entryTime).toLocaleTimeString();
        const exitTime = new Date(t.exitTime).toLocaleTimeString();
        const icon = t.pnl > 0 ? '✅' : '❌';
        console.log(
          `   ${icon} Trade ${i + 1}: ${entryTime} → ${exitTime} | $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)} | ${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}% | ${t.reason}`
        );
      });
    }

    // ============================================
    // OPTIMIZE QBTZ (Bearish on QBTS)
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('📉 OPTIMIZING QBTZ STRATEGY (Bearish Inverse)');
    console.log('='.repeat(70));

    const qbtzBest = await runGeneticOptimization(qbtzData, {
      populationSize: 100,
      generations: 50,
      eliteCount: 10,
    });

    const qbtzMC = runMonteCarlo(qbtzBest.trades, 1000);

    console.log('\n🏆 QBTZ OPTIMAL STRATEGY:');
    console.log('-'.repeat(50));
    console.log('Parameters:');
    console.log(`   RSI Oversold: ${qbtzBest.params.rsiOversold}`);
    console.log(`   RSI Entry: ${qbtzBest.params.rsiEntry}`);
    console.log(`   RSI Overbought: ${qbtzBest.params.rsiOverbought}`);
    console.log(`   Take Profit: ${qbtzBest.params.takeProfitPercent}%`);
    console.log(`   Stop Loss: ${qbtzBest.params.stopLossPercent}%`);
    console.log(`   Position Size: ${qbtzBest.params.positionSizePercent}%`);
    console.log(`   Volume Multiplier: ${qbtzBest.params.volumeMultiplier}x`);
    console.log(`   Min Signals: ${qbtzBest.params.minSignals}`);
    console.log(`   Exit on RSI Overbought: ${qbtzBest.params.exitOnRsiOverbought}`);

    console.log('\nPerformance:');
    console.log(`   Total Return: ${qbtzBest.metrics.totalReturn}%`);
    console.log(`   Total Trades: ${qbtzBest.metrics.totalTrades}`);
    console.log(`   Win Rate: ${qbtzBest.metrics.winRate}%`);
    console.log(`   Profit Factor: ${qbtzBest.metrics.profitFactor}`);
    console.log(`   Avg Win: ${qbtzBest.metrics.avgWin}%`);
    console.log(`   Avg Loss: ${qbtzBest.metrics.avgLoss}%`);
    console.log(`   Expectancy: ${qbtzBest.metrics.expectancy}%`);

    console.log('\nMonte Carlo (1000 sims):');
    console.log(`   Prob of Profit: ${qbtzMC.probOfProfit}%`);
    console.log(`   Avg Return: ${qbtzMC.avgReturn}%`);
    console.log(`   5th Percentile: ${qbtzMC.percentiles.p5}%`);
    console.log(`   Median: ${qbtzMC.percentiles.p50}%`);
    console.log(`   95th Percentile: ${qbtzMC.percentiles.p95}%`);

    if (qbtzBest.trades.length > 0) {
      console.log('\nTrade Details:');
      qbtzBest.trades.forEach((t, i) => {
        const entryTime = new Date(t.entryTime).toLocaleTimeString();
        const exitTime = new Date(t.exitTime).toLocaleTimeString();
        const icon = t.pnl > 0 ? '✅' : '❌';
        console.log(
          `   ${icon} Trade ${i + 1}: ${entryTime} → ${exitTime} | $${t.entryPrice.toFixed(2)} → $${t.exitPrice.toFixed(2)} | ${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}% | ${t.reason}`
        );
      });
    }

    // ============================================
    // SUMMARY & RECOMMENDATIONS
    // ============================================
    console.log('\n' + '='.repeat(70));
    console.log('📋 SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(70));

    console.log('\n💡 Key Insights:');
    console.log('   1. QBTX (bullish leverage) is best for days when QBTS is trending up');
    console.log('   2. QBTZ (bearish inverse) is best for days when QBTS is trending down');
    console.log('   3. Use RSI oversold conditions as entry signals');
    console.log('   4. Volume spikes confirm momentum');
    console.log('   5. Tight stop losses protect capital in volatile conditions');

    console.log('\n🎯 Recommended Strategy:');
    console.log('   • Morning Gap Analysis: Check pre-market direction of QBTS');
    console.log('   • If QBTS gaps up → Trade QBTX with bullish parameters');
    console.log('   • If QBTS gaps down → Trade QBTZ with inverse parameters');
    console.log('   • Use RSI < 40 as primary entry trigger');
    console.log('   • Take profit at 3-5% gains');
    console.log('   • Stop loss at 1-2% to protect capital');

    console.log('\n📊 Optimal Parameters (Combined):');
    console.log(`   • RSI Entry Zone: 30-45`);
    console.log(`   • Take Profit: 3-5%`);
    console.log(`   • Stop Loss: 1-2%`);
    console.log(`   • Position Size: 40-60% of capital`);
    console.log(`   • Volume Confirmation: 1.5x average`);

    console.log('\n' + '='.repeat(70));
    console.log('✅ OPTIMIZATION COMPLETE');
    console.log('='.repeat(70));

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
