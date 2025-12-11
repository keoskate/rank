/**
 * TradingSimulator - Visual backtesting simulation
 *
 * Compresses a full trading day (6.5 hours) into a configurable duration
 * with real-time visualization of price movement and AI decisions.
 *
 * Features:
 * - Uses config from TradingConfigContext
 * - Shows current config being tested prominently
 * - Generates AI recommendations after simulation
 * - Allows applying recommendations to trading config
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Card from './common/Card';
import Button from './common/Button';
import ConfigPanel from './common/ConfigPanel';
import theme from '../theme';
import { useTradingConfig } from '../contexts/TradingConfigContext';

// Simulation constants
const MARKET_OPEN_HOUR = 9.5; // 9:30 AM EST
const MARKET_CLOSE_HOUR = 16; // 4:00 PM EST
const DEFAULT_SIMULATION_DURATION = 6000; // 6 seconds in ms

// Convert timestamp to EST hour (handles timezone correctly)
const getEstHour = timestamp => {
  const date = new Date(timestamp);
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  let estHours = utcHours - 5;
  if (estHours < 0) estHours += 24;
  return estHours + utcMinutes / 60;
};

// ============================================
// SHARED TRADING LOGIC - Used by BOTH optimizer AND full simulation
// This ensures 100% parity between predicted and actual results
// ============================================

// Helper for boolean config values
const toBool = val => val === true || val === 'Yes' || val === 'yes';

// Calculate indicators from candle data
// MUST match full simulation's calculations EXACTLY
const calculateIndicatorsShared = (index, allCandles) => {
  // Helper to safely get candle values
  const getVal = (c, field) => c?.[field] ?? c?.[field[0]] ?? 0;
  const getClose = c => getVal(c, 'close') || getVal(c, 'c') || 0;
  const getHigh = c => getVal(c, 'high') || getVal(c, 'h') || 0;
  const getLow = c => getVal(c, 'low') || getVal(c, 'l') || 0;
  const getVolume = c => getVal(c, 'volume') || getVal(c, 'v') || 0;

  // RSI calculation - MATCHES full simulation exactly
  const lookback = Math.min(14, index);
  let gains = 0, losses = 0;
  for (let i = index - lookback; i < index; i++) {
    if (i > 0 && allCandles[i] && allCandles[i - 1]) {
      const currClose = getClose(allCandles[i]);
      const prevClose = getClose(allCandles[i - 1]);
      if (prevClose > 0) {
        const change = currClose - prevClose;
        if (change > 0) gains += change;
        else losses -= change;
      }
    }
  }
  const avgGain = lookback > 0 ? gains / lookback : 0;
  const avgLoss = lookback > 0 ? losses / lookback : 0.001;
  const rs = avgGain / Math.max(avgLoss, 0.001);
  const rsi = 100 - 100 / (1 + rs);

  // VWAP calculation - MATCHES full simulation exactly
  let cumulativeTPV = 0, cumulativeVol = 0;
  for (let i = 0; i <= index; i++) {
    const c = allCandles[i];
    const vol = getVolume(c);
    if (vol > 0) {
      const tp = (getHigh(c) + getLow(c) + getClose(c)) / 3;
      cumulativeTPV += tp * vol;
      cumulativeVol += vol;
    }
  }
  const price = getClose(allCandles[index]);
  const vwap = cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : price;

  // MA20 calculation - MATCHES full simulation exactly
  let ma20Sum = 0;
  const ma20Lookback = Math.min(20, index + 1);
  for (let i = index - ma20Lookback + 1; i <= index; i++) {
    if (i >= 0 && allCandles[i]) {
      ma20Sum += getClose(allCandles[i]);
    }
  }
  const ma20 = ma20Lookback > 0 ? ma20Sum / ma20Lookback : price;

  // Volume ratio - MATCHES full simulation exactly (uses 10 candles)
  const volLookback = Math.min(10, index);
  let totalVol = 0;
  for (let i = index - volLookback; i < index; i++) {
    if (i >= 0 && allCandles[i]) {
      totalVol += getVolume(allCandles[i]);
    }
  }
  const avgVolume = volLookback > 0 ? totalVol / volLookback : 1;
  const currentVol = getVolume(allCandles[index]);
  const volumeRatio = avgVolume > 0 ? currentVol / avgVolume : 1;

  // Price change from previous candle
  const prevPrice = index > 0 ? getClose(allCandles[index - 1]) : price;
  const priceChange = prevPrice > 0 ? (price - prevPrice) / prevPrice : 0;

  return { rsi, vwap, ma20, volumeRatio, priceChange };
};

// SHARED BUY DECISION LOGIC
const shouldBuy = (price, indicators, cfg, position) => {
  if (position) return { shouldBuy: false, signals: 0, reasons: [] };

  const strategy = cfg.entryStrategy || 'balanced';
  const rsiOversold = cfg.rsiOversold || 30;
  const vwapDeviation = (cfg.vwapDeviationPercent || 0.5) / 100;
  const volumeMultiplier = cfg.volumeMultiplier || 1.5;
  const minSignalsRequired = cfg.minSignalsRequired || 2;
  const minConfidence = cfg.minConfidence || 70;
  const requireVolumeSpike = toBool(cfg.requireVolumeSpike);
  const requireTrendAlign = toBool(cfg.requireTrendAlignment) || toBool(cfg.requireTrendAlign);
  const requireRsiSignal = toBool(cfg.requireRsiSignal);

  let signals = 0;
  const reasons = [];
  let hasRsiSignal = false;
  let hasTrendSignal = false;
  let hasVolumeSpike = false;

  const { rsi, vwap, ma20, volumeRatio, priceChange } = indicators;

  // DIP SIGNALS (for: dip, balanced, conservative)
  if (strategy === 'dip' || strategy === 'balanced' || strategy === 'conservative') {
    if (rsi < rsiOversold) {
      signals++;
      hasRsiSignal = true;
      reasons.push(`RSI oversold (${Math.round(rsi)})`);
    }
    if (price < vwap * (1 - vwapDeviation)) {
      signals++;
      hasTrendSignal = true;
      reasons.push(`Below VWAP by ${(vwapDeviation * 100).toFixed(1)}%`);
    }
    if (priceChange < -0.005 && priceChange > -0.02 && price > ma20) {
      signals++;
      hasTrendSignal = true;
      reasons.push('Pullback in uptrend');
    }
  }

  // MOMENTUM SIGNALS (for: momentum, balanced, aggressive)
  if (strategy === 'momentum' || strategy === 'balanced' || strategy === 'aggressive') {
    if (rsi > 50 && rsi < 65) {
      signals++;
      hasRsiSignal = true;
      reasons.push(`RSI momentum (${Math.round(rsi)})`);
    }
    if (price > vwap * (1 + vwapDeviation) && priceChange > 0) {
      signals++;
      hasTrendSignal = true;
      reasons.push(`Breakout above VWAP (+${((price/vwap - 1) * 100).toFixed(1)}%)`);
    }
    if (price > ma20 * 1.005) {
      signals++;
      hasTrendSignal = true;
      reasons.push('Above MA20 uptrend');
    }
  }

  // VOLUME SPIKE (applies to all strategies)
  if (volumeRatio > volumeMultiplier) {
    signals++;
    hasVolumeSpike = true;
    reasons.push(`Volume spike (${volumeRatio.toFixed(1)}x)`);
  }

  // Check requirements
  let meetsRequirements = true;
  if (requireRsiSignal && !hasRsiSignal) meetsRequirements = false;
  if (requireVolumeSpike && !hasVolumeSpike) meetsRequirements = false;
  if (requireTrendAlign && !hasTrendSignal) meetsRequirements = false;

  // Calculate confidence
  const confidence = Math.min(95, 50 + signals * 15);

  const buy = signals >= minSignalsRequired && meetsRequirements && confidence >= minConfidence;

  return { shouldBuy: buy, signals, reasons, confidence, meetsRequirements };
};

// SHARED SELL DECISION LOGIC
const shouldSell = (price, entryPrice, indicators, cfg, candleIndex, entryIndex, timestamp, highWaterMark) => {
  const pnlPercent = ((price - entryPrice) / entryPrice) * 100;
  const minConfidence = cfg.minConfidence || 70;
  const rsiOverbought = cfg.rsiOverbought || 70;
  const profitTargetPercent = cfg.takeProfitPercent || 2;
  const stopLossPercent = cfg.stopLossPercent || 1;
  // Trailing stop is now a % of gains to lock in (e.g., 50 means lock in 50% of gains from high)
  const trailingStopOfTP = cfg.trailingStopPercent || 0; // 0-100, represents % of gains to protect

  const estHour = getEstHour(timestamp);
  const { rsi, vwap, priceChange } = indicators;

  // Minimum hold time (5 candles, except stop loss, trailing stop, or EOD)
  const candlesSinceEntry = candleIndex - (entryIndex || 0);
  const minHoldCandles = 5;

  // Score-based sell system
  let sellScore = 0;
  const reasons = [];

  if (pnlPercent >= profitTargetPercent) {
    sellScore += 30;
    reasons.push(`Profit target hit (+${pnlPercent.toFixed(2)}%)`);
  }
  if (pnlPercent <= -stopLossPercent) {
    sellScore += 40;
    reasons.push(`Stop loss triggered (${pnlPercent.toFixed(2)}%)`);
  }

  // Trailing stop - only activates when in profit and price drops from high
  // trailingStopOfTP is 0-100: e.g., 50 means "lock in 50% of gains" (sell if price drops 50% back toward entry)
  let trailingStopTriggered = false;
  if (trailingStopOfTP > 0 && highWaterMark && highWaterMark > entryPrice && pnlPercent > 0) {
    const gainFromEntry = highWaterMark - entryPrice;
    const allowedDropFromHigh = gainFromEntry * (100 - trailingStopOfTP) / 100;
    const triggerPrice = highWaterMark - allowedDropFromHigh;
    const lockedInGainPercent = ((triggerPrice - entryPrice) / entryPrice) * 100;

    if (price <= triggerPrice) {
      sellScore += 35;
      trailingStopTriggered = true;
      reasons.push(`Trailing stop (locked in ${lockedInGainPercent.toFixed(2)}% of ${((highWaterMark - entryPrice) / entryPrice * 100).toFixed(2)}% gain)`);
    }
  }

  if (rsi > rsiOverbought) {
    sellScore += 20;
    reasons.push(`RSI overbought (${Math.round(rsi)} > ${rsiOverbought})`);
  }
  if (price > vwap * 1.01 && priceChange < 0) {
    sellScore += 15;
    reasons.push('Momentum fading above VWAP');
  }
  if (estHour >= 15.75) {
    sellScore += 50;
    reasons.push('End of day liquidation');
  }

  // Hold time exempt conditions: stop loss, trailing stop, or EOD
  const holdTimeExempt = pnlPercent <= -stopLossPercent || trailingStopTriggered || estHour >= 15.75;

  const confidence = Math.min(95, 50 + sellScore);
  const canSell = (candlesSinceEntry >= minHoldCandles || holdTimeExempt) &&
                  (confidence >= minConfidence || estHour >= 15.75);

  return { shouldSell: canSell, sellScore, reasons, confidence, pnlPercent };
};

// ============================================
// END SHARED TRADING LOGIC
// ============================================

const TradingSimulator = ({ onComplete, onDateChange, onSymbolChange, initialSymbol, lockedSymbols }) => {
  // Use config DIRECTLY from context - this ensures ConfigPanel edits are immediately used
  const { config, updateConfig: updateGlobalConfig } = useTradingConfig();

  // State for config recommendations
  const [recommendations, setRecommendations] = useState([]);

  // Simulation state - load from localStorage if available
  const [simulationDate, setSimulationDate] = useState(() => {
    const saved = localStorage.getItem('simulator-date');
    return saved || '';
  });
  const [symbol, setSymbol] = useState(() => {
    // Use initialSymbol if provided, otherwise load from localStorage
    if (initialSymbol) return initialSymbol;
    const saved = localStorage.getItem('simulator-symbol');
    return saved || 'AAPL';
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('09:30');
  const [simulationSpeed, setSimulationSpeed] = useState(1);

  // Market data
  const [candles, setCandles] = useState([]);
  const [currentCandleIndex, setCurrentCandleIndex] = useState(0);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [dayOpen, setDayOpen] = useState(0);
  const [dayHigh, setDayHigh] = useState(0);
  const [dayLow, setDayLow] = useState(Infinity);

  // Pre-market gap info (to explain overnight moves)
  const [preMarketInfo, setPreMarketInfo] = useState(null);

  // Get initial capital from config, with fallback
  const getInitialCapital = () => config?.allocatedCapital || 100000;

  // Trading state - initialized from config
  const [portfolio, setPortfolio] = useState({
    cash: getInitialCapital(),
    startingCash: getInitialCapital(),
    positions: [],
    trades: [],
  });
  const [realizedPnL, setRealizedPnL] = useState(0);
  const [aiDecisions, setAiDecisions] = useState([]);
  const [events, setEvents] = useState([]);

  // Analysis results
  const [analysis, setAnalysis] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  // Current indicators (what the ML is seeing)
  const [currentIndicators, setCurrentIndicators] = useState({
    rsi: 50,
    vwap: 0,
    priceVsVwap: 0,
    volumeRatio: 1,
    momentum: 0,
    priceChange: 0,
    ma20: 0,
    priceVsMa: 0,
  });

  // Intraday regime detection state
  const [intradayRegime, setIntradayRegime] = useState({
    regime: 'unknown',
    confidence: 0,
    priceVsOpen: 0,
    trend: 'flat',
    lastUpdate: null,
    history: [], // Track regime changes throughout the day
  });

  // Refs for simulation control
  const simulationRef = useRef(null);
  const indexRef = useRef(0);
  const candlesRef = useRef([]);
  const isPausedRef = useRef(false);

  // CRITICAL: Store config snapshot when simulation starts
  // This prevents config changes during simulation from affecting results
  const configSnapshotRef = useRef(null);
  const [usedConfig, setUsedConfig] = useState(null); // For displaying in results

  // Stress Test / Config Optimizer state
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizerProgress, setOptimizerProgress] = useState(0);
  const [optimizerResults, setOptimizerResults] = useState([]);
  const [showOptimizer, setShowOptimizer] = useState(false);

  // Debug logging state
  const [debugLog, setDebugLog] = useState([]);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [optimizerPrediction, setOptimizerPrediction] = useState(null);
  const debugLogRef = useRef([]);

  // Config diff state - shows what changed when applying optimizer result
  const [configDiff, setConfigDiff] = useState(null);
  const [showConfigDiff, setShowConfigDiff] = useState(false);

  // Get yesterday's date as default (only if no saved date)
  useEffect(() => {
    if (!simulationDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
        yesterday.setDate(yesterday.getDate() - 1);
      }
      setSimulationDate(yesterday.toISOString().split('T')[0]);
    }
  }, []);

  // Persist date and symbol to localStorage + notify parent
  useEffect(() => {
    if (simulationDate) {
      localStorage.setItem('simulator-date', simulationDate);
      onDateChange?.(simulationDate);
    }
  }, [simulationDate, onDateChange]);

  useEffect(() => {
    if (symbol) {
      localStorage.setItem('simulator-symbol', symbol);
      onSymbolChange?.(symbol);
    }
  }, [symbol, onSymbolChange]);

  // Update symbol if initialSymbol changes (e.g., from leveraged ETF panel)
  useEffect(() => {
    if (initialSymbol && initialSymbol !== symbol && !isRunning) {
      setSymbol(initialSymbol);
    }
  }, [initialSymbol]);

  // Calculate unrealized P&L
  const getUnrealizedPnL = useCallback(() => {
    if (portfolio.positions.length === 0) return 0;
    const pos = portfolio.positions[0];
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }, [portfolio.positions, currentPrice]);

  // Total P&L (realized + unrealized)
  const totalPnL = realizedPnL + getUnrealizedPnL();

  /**
   * Detect intraday regime based on price action
   * Called every N candles during simulation to update regime
   */
  const detectIntradayRegime = useCallback((candleData, currentIdx, openPrice) => {
    if (!candleData || currentIdx < 10 || !openPrice) return null;

    const recentCandles = candleData.slice(Math.max(0, currentIdx - 30), currentIdx + 1);
    const currentCandle = candleData[currentIdx];
    const price = currentCandle.close ?? currentCandle.c;

    // Calculate metrics
    const priceVsOpen = ((price - openPrice) / openPrice) * 100;

    // Calculate trend from recent highs/lows
    let higherHighs = 0;
    let lowerLows = 0;
    for (let i = 5; i < recentCandles.length; i++) {
      const prevHigh = recentCandles[i - 5].high ?? recentCandles[i - 5].h;
      const currHigh = recentCandles[i].high ?? recentCandles[i].h;
      const prevLow = recentCandles[i - 5].low ?? recentCandles[i - 5].l;
      const currLow = recentCandles[i].low ?? recentCandles[i].l;

      if (currHigh > prevHigh) higherHighs++;
      if (currLow < prevLow) lowerLows++;
    }

    // Calculate VWAP for comparison
    let vwapSum = 0;
    let volumeSum = 0;
    for (let i = 0; i <= currentIdx; i++) {
      const c = candleData[i];
      const typical = ((c.high ?? c.h) + (c.low ?? c.l) + (c.close ?? c.c)) / 3;
      const vol = c.volume ?? c.v ?? 1;
      vwapSum += typical * vol;
      volumeSum += vol;
    }
    const vwap = vwapSum / volumeSum;
    const priceVsVwap = ((price - vwap) / vwap) * 100;

    // Calculate 20-candle momentum
    const momentum20 = currentIdx >= 20
      ? ((price - (candleData[currentIdx - 20].close ?? candleData[currentIdx - 20].c)) /
         (candleData[currentIdx - 20].close ?? candleData[currentIdx - 20].c)) * 100
      : 0;

    // Determine trend direction
    let trend = 'flat';
    if (higherHighs > lowerLows + 3) trend = 'uptrend';
    else if (lowerLows > higherHighs + 3) trend = 'downtrend';

    // Determine regime based on multiple signals
    let bullSignals = 0;
    let bearSignals = 0;

    // Signal 1: Price vs Open
    if (priceVsOpen > 2) bullSignals += 2;
    else if (priceVsOpen > 0.5) bullSignals += 1;
    else if (priceVsOpen < -2) bearSignals += 2;
    else if (priceVsOpen < -0.5) bearSignals += 1;

    // Signal 2: Price vs VWAP
    if (priceVsVwap > 1) bullSignals += 2;
    else if (priceVsVwap > 0.3) bullSignals += 1;
    else if (priceVsVwap < -1) bearSignals += 2;
    else if (priceVsVwap < -0.3) bearSignals += 1;

    // Signal 3: Trend
    if (trend === 'uptrend') bullSignals += 2;
    else if (trend === 'downtrend') bearSignals += 2;

    // Signal 4: Recent momentum
    if (momentum20 > 1) bullSignals += 1;
    else if (momentum20 < -1) bearSignals += 1;

    // Determine regime
    let regime = 'sideways';
    let confidence = 50;

    if (bullSignals >= bearSignals + 3) {
      regime = 'bull';
      confidence = Math.min(95, 60 + (bullSignals - bearSignals) * 5);
    } else if (bearSignals >= bullSignals + 3) {
      regime = 'bear';
      confidence = Math.min(95, 60 + (bearSignals - bullSignals) * 5);
    } else {
      regime = 'sideways';
      confidence = 50 + Math.abs(bullSignals - bearSignals) * 5;
    }

    return {
      regime,
      confidence,
      priceVsOpen: priceVsOpen.toFixed(2),
      priceVsVwap: priceVsVwap.toFixed(2),
      momentum20: momentum20.toFixed(2),
      trend,
      bullSignals,
      bearSignals,
      timestamp: currentCandle.timestamp || currentCandle.t,
    };
  }, []);

  // Fetch historical intraday data
  const fetchSimulationData = async () => {
    if (!simulationDate || !symbol) return null;

    try {
      const res = await fetch(
        `/api/polygon/aggregates/${symbol}/1/minute?from=${simulationDate}&to=${simulationDate}`
      );

      if (!res.ok) throw new Error('Failed to fetch market data');

      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        throw new Error('No market data available for this date');
      }

      // Get all valid candles first
      const allValidCandles = data.results
        .filter(candle => {
          const close = candle.close ?? candle.c;
          const high = candle.high ?? candle.h;
          const low = candle.low ?? candle.l;
          const open = candle.open ?? candle.o;
          return close !== undefined && high !== undefined && low !== undefined && open !== undefined;
        })
        .sort((a, b) => (a.timestamp || a.t) - (b.timestamp || b.t));

      // Find pre-market data (before 9:30 AM EST)
      const preMarketCandles = allValidCandles.filter(candle => {
        const timestamp = candle.timestamp || candle.t;
        const estHour = getEstHour(timestamp);
        return estHour < MARKET_OPEN_HOUR;
      });

      // Filter to market hours only for trading (9:30 AM - 4:00 PM EST)
      const marketCandles = allValidCandles.filter(candle => {
        const timestamp = candle.timestamp || candle.t;
        const estHour = getEstHour(timestamp);
        return estHour >= MARKET_OPEN_HOUR && estHour < MARKET_CLOSE_HOUR;
      });

      // Calculate pre-market gap info if there's pre-market data
      if (preMarketCandles.length > 0 && marketCandles.length > 0) {
        const preMarketLow = Math.min(...preMarketCandles.map(c => c.low ?? c.l));
        const preMarketHigh = Math.max(...preMarketCandles.map(c => c.high ?? c.h));
        const preMarketFirst = preMarketCandles[0].open ?? preMarketCandles[0].o;
        const marketOpen = marketCandles[0].open ?? marketCandles[0].o;
        const gapPercent = ((marketOpen - preMarketFirst) / preMarketFirst * 100).toFixed(1);

        setPreMarketInfo({
          preMarketLow,
          preMarketHigh,
          preMarketFirst,
          marketOpen,
          gapPercent,
          hasGap: Math.abs(parseFloat(gapPercent)) > 2, // Consider >2% a significant gap
        });
      } else {
        setPreMarketInfo(null);
      }

      return marketCandles;
    } catch (err) {
      console.error('Failed to fetch simulation data:', err);
      addEvent('error', 'Data Error', err.message);
      return null;
    }
  };

  // Safe getter for candle properties
  const getCandle = candle => {
    if (!candle) return null;
    return {
      close: candle.close ?? candle.c ?? 0,
      open: candle.open ?? candle.o ?? 0,
      high: candle.high ?? candle.h ?? 0,
      low: candle.low ?? candle.l ?? 0,
      volume: candle.volume ?? candle.v ?? 0,
      timestamp: candle.timestamp ?? candle.t ?? Date.now(),
    };
  };

  // Simple AI decision logic with null checks
  // CRITICAL: Uses configSnapshotRef to ensure consistent config throughout simulation
  const makeAiDecision = (candle, index, allCandles, currentPosition) => {
    const c = getCandle(candle);
    if (!c)
      return {
        action: 'HOLD',
        confidence: 0,
        reasons: ['Invalid candle data'],
      };

    const { close: price, volume, open, high, low, timestamp } = c;

    // CRITICAL: Use snapshot config, NOT live config
    // This ensures config doesn't change mid-simulation
    const cfg = configSnapshotRef.current || config;

    // Get ALL config values with defaults
    const profitTargetPercent =
      cfg?.takeProfitPercent ||
      cfg?.profitTarget ||
      cfg?.profitTargetPercent ||
      2;
    const stopLossPercent = cfg?.stopLossPercent || cfg?.stopLoss || 1;
    const minConfidence = cfg?.minConfidence || 70;

    // Entry condition config values
    const rsiOversold = cfg?.rsiOversold || 30;
    const rsiOverbought = cfg?.rsiOverbought || 70;
    const vwapDeviation = (cfg?.vwapDeviationPercent || 0.5) / 100; // Convert to decimal
    const volumeMultiplier = cfg?.volumeMultiplier || 1.5;
    const minSignalsRequired = cfg?.minSignalsRequired || 3;
    // Handle both boolean and string "Yes"/"No" values
    const toBool = val => val === true || val === 'Yes' || val === 'yes';
    const requireVolumeSpike = toBool(cfg?.requireVolumeSpike);
    const requireTrendAlign = toBool(cfg?.requireTrendAlignment) || toBool(cfg?.requireTrendAlign);
    const requireRsiSignal = toBool(cfg?.requireRsiSignal);
    // Entry strategy: 'dip' (buy oversold), 'momentum' (buy breakouts), 'balanced' (both)
    const entryStrategy = cfg?.entryStrategy || 'balanced';

    // Debug log on first candle to verify config is being used
    if (index === 0) {
      console.log('[Simulator] Using config:', {
        entryStrategy,
        profitTargetPercent,
        stopLossPercent,
        minConfidence,
        rsiOversold,
        rsiOverbought,
        vwapDeviation,
        volumeMultiplier,
        minSignalsRequired,
        requireVolumeSpike,
        requireTrendAlign,
        requireRsiSignal,
        rawConfig: config,
      });
    }

    // Calculate price change from previous candle
    let priceChange = 0;
    if (index > 0) {
      const prevCandle = getCandle(allCandles[index - 1]);
      if (prevCandle && prevCandle.close > 0) {
        priceChange = (price - prevCandle.close) / prevCandle.close;
      }
    }

    // Calculate RSI-like momentum (simplified)
    let gains = 0,
      losses = 0;
    const lookback = Math.min(14, index);
    for (let i = index - lookback; i < index; i++) {
      if (i > 0 && allCandles[i] && allCandles[i - 1]) {
        const curr = getCandle(allCandles[i]);
        const prev = getCandle(allCandles[i - 1]);
        if (curr && prev && prev.close > 0) {
          const change = curr.close - prev.close;
          if (change > 0) gains += change;
          else losses -= change;
        }
      }
    }
    const avgGain = lookback > 0 ? gains / lookback : 0;
    const avgLoss = lookback > 0 ? losses / lookback : 0.001;
    const rs = avgGain / Math.max(avgLoss, 0.001);
    const rsi = 100 - 100 / (1 + rs);

    // Calculate VWAP (simplified) with null checks
    let cumulativeTPV = 0,
      cumulativeVol = 0;
    for (let i = 0; i <= index; i++) {
      const candleData = getCandle(allCandles[i]);
      if (candleData && candleData.volume > 0) {
        const tp = (candleData.high + candleData.low + candleData.close) / 3;
        cumulativeTPV += tp * candleData.volume;
        cumulativeVol += candleData.volume;
      }
    }
    const vwap = cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : price;

    // Calculate 20-period moving average
    let ma20Sum = 0;
    const ma20Lookback = Math.min(20, index + 1);
    for (let i = index - ma20Lookback + 1; i <= index; i++) {
      if (i >= 0) {
        const cd = getCandle(allCandles[i]);
        if (cd) ma20Sum += cd.close;
      }
    }
    const ma20 = ma20Lookback > 0 ? ma20Sum / ma20Lookback : price;

    // Calculate average volume (10-period)
    const recentCandles = allCandles.slice(Math.max(0, index - 10), index);
    const avgVolume =
      recentCandles.reduce((s, c) => {
        const cd = getCandle(c);
        return s + (cd ? cd.volume : 0);
      }, 0) / Math.max(recentCandles.length, 1);
    const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

    const decision = {
      timestamp,
      price,
      rsi: Math.round(rsi),
      vwap: parseFloat(vwap.toFixed(2)),
      priceVsVwap: parseFloat(((price / vwap - 1) * 100).toFixed(2)),
      ma20: parseFloat(ma20.toFixed(2)),
      priceVsMa: parseFloat(((price / ma20 - 1) * 100).toFixed(2)),
      volumeRatio: parseFloat(volumeRatio.toFixed(2)),
      priceChange: parseFloat((priceChange * 100).toFixed(2)),
      action: 'HOLD',
      confidence: 50,
      reasons: [],
      // Store all indicators for UI display
      indicators: {
        rsi: Math.round(rsi),
        vwap: parseFloat(vwap.toFixed(2)),
        priceVsVwap: parseFloat(((price / vwap - 1) * 100).toFixed(2)),
        ma20: parseFloat(ma20.toFixed(2)),
        priceVsMa: parseFloat(((price / ma20 - 1) * 100).toFixed(2)),
        volumeRatio: parseFloat(volumeRatio.toFixed(2)),
        volume: volume,
        avgVolume: Math.round(avgVolume),
        momentum: parseFloat((priceChange * 100).toFixed(2)),
      },
    };

    // Use SHARED indicator calculation for consistency with optimizer
    const sharedIndicators = calculateIndicatorsShared(index, allCandles);

    // BUY signals - USE SHARED FUNCTION for parity with optimizer
    if (!currentPosition) {
      const buyResult = shouldBuy(price, sharedIndicators, cfg, null);

      if (buyResult.shouldBuy) {
        decision.action = 'BUY';
        decision.reasons = buyResult.reasons;
        decision.confidence = buyResult.confidence;

        // Debug log for BUY
        debugLogRef.current.push({
          type: 'BUY',
          index,
          price,
          timestamp,
          signalCount: buyResult.signals,
          minSignalsRequired,
          confidence: buyResult.confidence,
          minConfidence,
          meetsRequirements: buyResult.meetsRequirements,
          reasons: buyResult.reasons,
          indicators: sharedIndicators,
          entryStrategy,
        });
      }
    }

    // SELL signals - USE SHARED FUNCTION for parity with optimizer
    if (currentPosition) {
      // Update high water mark for trailing stop
      const currentHighWaterMark = currentPosition.highWaterMark || currentPosition.entryPrice;
      const updatedHighWaterMark = Math.max(currentHighWaterMark, price);

      // Update position's highWaterMark if price made new high
      if (price > currentHighWaterMark) {
        currentPosition.highWaterMark = price;
      }

      const sellResult = shouldSell(
        price,
        currentPosition.entryPrice,
        sharedIndicators,
        cfg,
        index,
        currentPosition.entryIndex,
        timestamp,
        updatedHighWaterMark // Pass high water mark for trailing stop
      );

      if (sellResult.shouldSell) {
        decision.action = 'SELL';
        decision.reasons = sellResult.reasons;
        decision.confidence = sellResult.confidence;

        // Debug log for SELL
        debugLogRef.current.push({
          type: 'SELL',
          index,
          price,
          entryPrice: currentPosition.entryPrice,
          highWaterMark: updatedHighWaterMark,
          pnlPercent: sellResult.pnlPercent,
          timestamp,
          sellScore: sellResult.sellScore,
          confidence: sellResult.confidence,
          minConfidence,
          reasons: sellResult.reasons,
          indicators: sharedIndicators,
        });
      }
    }

    return decision;
  };

  // Execute trade
  const executeTrade = useCallback(
    (decision, candle, candleIndex) => {
      const c = getCandle(candle);
      if (!c) return;

      const { close: price, timestamp } = c;
      const reasons = decision.reasons || [];
      const reasonsText =
        reasons.length > 0 ? reasons.join(', ') : 'Manual signal';

      setPortfolio(prev => {
        const newPortfolio = { ...prev };
        // Use config snapshot if available (locked during simulation)
        const activeConfig = configSnapshotRef.current || config;

        if (decision.action === 'BUY' && prev.positions.length === 0) {
          // Use config position sizing, with fallbacks
          const maxPositionPercent = (activeConfig?.maxPositionSizePercent || 50) / 100;
          const maxPositionDollars = activeConfig?.maxPositionSize || prev.cash;
          const positionValue = Math.min(prev.cash * maxPositionPercent, maxPositionDollars);
          const positionSize = Math.floor(positionValue / price);

          if (positionSize > 0) {
            const cost = positionSize * price;
            newPortfolio.cash = prev.cash - cost;
            newPortfolio.positions = [
              {
                symbol,
                quantity: positionSize,
                entryPrice: price,
                entryTime: timestamp,
                entryIndex: candleIndex, // Track candle index for minimum hold time
                highWaterMark: price, // Track highest price for trailing stop
                reasons: reasons,
              },
            ];

            newPortfolio.trades = [
              ...prev.trades,
              {
                type: 'BUY',
                symbol,
                quantity: positionSize,
                price,
                timestamp,
                value: cost,
                confidence: decision.confidence,
                reasons: reasons,
              },
            ];

            // Format market time in EST for event log
            const marketTime = new Date(timestamp).toLocaleTimeString('en-US', {
              timeZone: 'America/New_York',
              hour: '2-digit',
              minute: '2-digit',
            });
            addEvent(
              'trade',
              'BUY Order Filled',
              `Bought ${positionSize} ${symbol} @ $${price.toFixed(2)} [${marketTime} EST]`,
              reasonsText,
              decision.confidence
            );
          }
        } else if (decision.action === 'SELL' && prev.positions.length > 0) {
          const position = prev.positions[0];
          const proceeds = position.quantity * price;
          const pnl = proceeds - position.quantity * position.entryPrice;

          newPortfolio.cash = prev.cash + proceeds;
          newPortfolio.positions = [];

          newPortfolio.trades = [
            ...prev.trades,
            {
              type: 'SELL',
              symbol,
              quantity: position.quantity,
              price,
              timestamp,
              value: proceeds,
              pnl,
              pnlPercent:
                ((price - position.entryPrice) / position.entryPrice) * 100,
              confidence: decision.confidence,
              reasons: reasons,
            },
          ];

          setRealizedPnL(prev => prev + pnl);
          // Format market time in EST for event log
          const sellMarketTime = new Date(timestamp).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
          });
          addEvent(
            pnl >= 0 ? 'success' : 'error',
            'SELL Order Filled',
            `Sold ${position.quantity} ${symbol} @ $${price.toFixed(2)} (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}) [${sellMarketTime} EST]`,
            reasonsText,
            decision.confidence
          );
        }

        return newPortfolio;
      });
    },
    [symbol]
  );

  // Add event to timeline
  const addEvent = (type, title, message, reason = null, confidence = null) => {
    setEvents(prev => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        type,
        title,
        reason,
        confidence,
        message,
        timestamp: new Date(),
      },
    ]);
  };

  // Process single candle
  // Process each candle during simulation
  // NOT using useCallback because makeAiDecision and config need fresh references
  const processCandle = (index, data) => {
    if (index >= data.length) {
      completeSimulation(data);
      return;
    }

    const candle = data[index];
    const c = getCandle(candle);
    if (!c) {
      // Skip invalid candle
      indexRef.current = index + 1;
      return;
    }

    const { close: price, high, low, timestamp } = c;

    setCurrentPrice(price);
    setCurrentCandleIndex(index);
    setProgress((index / data.length) * 100);

    setDayHigh(prev => Math.max(prev, high));
    setDayLow(prev => Math.min(prev === Infinity ? low : prev, low));

    // Display time in EST (market time)
    const time = new Date(timestamp);
    setCurrentTime(
      time.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York',
      })
    );

    // Update intraday regime every 30 candles (30 minutes)
    if (index > 0 && index % 30 === 0) {
      const regimeResult = detectIntradayRegime(data, index, dayOpen);
      if (regimeResult) {
        setIntradayRegime(prev => {
          const newHistory = prev.history || [];
          // Only add to history if regime changed
          if (newHistory.length === 0 || newHistory[newHistory.length - 1].regime !== regimeResult.regime) {
            newHistory.push({
              ...regimeResult,
              time: currentTime,
              candleIndex: index,
            });
          }
          return {
            ...regimeResult,
            lastUpdate: currentTime,
            history: newHistory,
          };
        });
      }
    }

    // Make AI decision
    setPortfolio(prev => {
      const currentPosition = prev.positions[0] || null;
      const decision = makeAiDecision(candle, index, data, currentPosition);

      // Update current indicators for visualization
      if (decision.indicators) {
        setCurrentIndicators(decision.indicators);
      }

      setAiDecisions(prevDecisions => [...prevDecisions, decision]);

      if (decision.action !== 'HOLD') {
        executeTrade(decision, candle, index);
      }

      return prev;
    });

    indexRef.current = index + 1;
  };

  // Start simulation
  const startSimulation = async () => {
    // CRITICAL: Snapshot the config at simulation start
    // This ensures the SAME config is used throughout the entire simulation
    const configSnapshot = { ...config };
    configSnapshotRef.current = configSnapshot;
    setUsedConfig(configSnapshot);
    console.log('[Simulator] 🔒 Config snapshot locked:', {
      entryStrategy: configSnapshot.entryStrategy,
      minSignalsRequired: configSnapshot.minSignalsRequired,
      takeProfitPercent: configSnapshot.takeProfitPercent,
      stopLossPercent: configSnapshot.stopLossPercent,
      minConfidence: configSnapshot.minConfidence,
      maxPositionSizePercent: configSnapshot.maxPositionSizePercent,
      requireVolumeSpike: configSnapshot.requireVolumeSpike,
      requireTrendAlignment: configSnapshot.requireTrendAlignment,
      requireRsiSignal: configSnapshot.requireRsiSignal,
      rsiOversold: configSnapshot.rsiOversold,
      rsiOverbought: configSnapshot.rsiOverbought,
      volumeMultiplier: configSnapshot.volumeMultiplier,
      allocatedCapital: configSnapshot.allocatedCapital,
    });

    setIsRunning(true);
    setIsPaused(false);
    isPausedRef.current = false;
    setProgress(0);
    setCurrentCandleIndex(0);
    indexRef.current = 0;
    setAiDecisions([]);
    setEvents([]);
    setAnalysis(null);
    setShowAnalysis(false);
    setRealizedPnL(0);
    // Clear debug log for fresh simulation
    debugLogRef.current = [];
    setDebugLog([]);
    setShowDebugLog(false);
    // Reset intraday regime
    setIntradayRegime({
      regime: 'unknown',
      confidence: 0,
      priceVsOpen: 0,
      trend: 'flat',
      lastUpdate: null,
      history: [],
    });
    const initialCapital = configSnapshot.allocatedCapital || 100000;
    setPortfolio({
      cash: initialCapital,
      startingCash: initialCapital,
      positions: [],
      trades: [],
    });
    setDayHigh(0);
    setDayLow(Infinity);

    addEvent(
      'info',
      'Simulation Started',
      `Running backtest for ${symbol} on ${simulationDate}`
    );

    const data = await fetchSimulationData();

    if (!data || data.length === 0) {
      setIsRunning(false);
      addEvent('error', 'Simulation Failed', 'No valid data available');
      return;
    }

    setCandles(data);
    candlesRef.current = data;

    const firstCandle = getCandle(data[0]);
    if (firstCandle) {
      setDayOpen(firstCandle.open);
      setCurrentPrice(firstCandle.close);
    }

    const totalDuration = DEFAULT_SIMULATION_DURATION / simulationSpeed;
    const intervalMs = totalDuration / data.length;

    simulationRef.current = setInterval(() => {
      if (isPausedRef.current) return;

      const currentIndex = indexRef.current;
      if (currentIndex >= data.length) {
        clearInterval(simulationRef.current);
        return;
      }

      processCandle(currentIndex, data);
    }, intervalMs);
  };

  // Complete simulation
  const completeSimulation = data => {
    clearInterval(simulationRef.current);
    setIsRunning(false);
    setProgress(100);

    addEvent('success', 'Simulation Complete', 'Generating analysis...');

    // Generate analysis
    setTimeout(() => {
      setPortfolio(prev => {
        const totalTrades = prev.trades.length;
        const sellTrades = prev.trades.filter(t => t.type === 'SELL').length;
        const profitableTrades = prev.trades.filter(
          t => t.pnl && t.pnl > 0
        ).length;
        const losingTrades = prev.trades.filter(t => t.pnl && t.pnl < 0).length;

        const totalPnLCalc = prev.trades.reduce(
          (sum, t) => sum + (t.pnl || 0),
          0
        );
        const winRate =
          sellTrades > 0 ? (profitableTrades / sellTrades) * 100 : 0;

        const finalValue =
          prev.cash +
          prev.positions.reduce((sum, p) => sum + p.quantity * currentPrice, 0);
        const returnPercent =
          ((finalValue - prev.startingCash) / prev.startingCash) * 100;

        const positives = [];
        const negatives = [];
        const improvements = [];

        if (returnPercent > 0) {
          positives.push(
            `Generated positive return of +${returnPercent.toFixed(2)}%`
          );
        } else if (returnPercent < 0) {
          negatives.push(
            `Generated negative return of ${returnPercent.toFixed(2)}%`
          );
        }

        if (winRate >= 50) {
          positives.push(`Win rate of ${winRate.toFixed(0)}% is above 50%`);
        } else if (winRate > 0) {
          negatives.push(`Win rate of ${winRate.toFixed(0)}% is below 50%`);
          improvements.push(
            'Consider tighter stop losses or wider profit targets'
          );
        }

        if (totalTrades === 0) {
          negatives.push(
            'No trades executed - confidence threshold may be too high'
          );
          improvements.push(
            'Lower minimum confidence threshold to increase trading activity'
          );
        } else if (totalTrades > 10) {
          negatives.push('High number of trades may indicate overtrading');
          improvements.push(
            'Increase confidence threshold to reduce noise trades'
          );
        }

        const analysisResult = {
          date: simulationDate,
          symbol,
          startingCash: prev.startingCash,
          finalValue,
          totalPnL: totalPnLCalc,
          returnPercent,
          totalTrades,
          profitableTrades,
          losingTrades,
          winRate,
          dayOpen,
          dayHigh,
          dayLow,
          dayClose: currentPrice,
          priceChangePercent:
            dayOpen > 0 ? ((currentPrice - dayOpen) / dayOpen) * 100 : 0,
          positives,
          negatives,
          improvements,
        };

        setAnalysis(analysisResult);
        setShowAnalysis(true);

        // Save debug log for review
        setDebugLog([...debugLogRef.current]);
        console.log('[Simulator] Debug log saved:', debugLogRef.current.length, 'entries');
        console.log('[Simulator] Actual results:', {
          returnPercent: returnPercent.toFixed(2),
          totalPnL: totalPnLCalc.toFixed(2),
          numTrades: totalTrades,
          winRate: winRate.toFixed(0),
        });

        // Generate config recommendations based on results
        generateRecommendations(analysisResult, prev.trades);

        return prev;
      });
    }, 100);
  };

  // Pause/resume with proper ref tracking
  const togglePause = () => {
    if (isPaused) {
      isPausedRef.current = false;
      setIsPaused(false);
      addEvent('info', 'Resumed', 'Simulation resumed');
    } else {
      isPausedRef.current = true;
      setIsPaused(true);
      addEvent('info', 'Paused', 'Simulation paused');
    }
  };

  // Stop simulation
  const stopSimulation = () => {
    clearInterval(simulationRef.current);
    setIsRunning(false);
    setIsPaused(false);
    isPausedRef.current = false;
    addEvent(
      'warning',
      'Simulation Stopped',
      'Simulation was manually stopped'
    );
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
      }
    };
  }, []);

  // Mini price chart
  const renderMiniChart = () => {
    if (candles.length === 0) return null;

    const visibleCandles = candles.slice(0, currentCandleIndex + 1);
    if (visibleCandles.length === 0) return null;

    const width = 600;
    const height = 180;
    const padding = 40;

    const prices = visibleCandles
      .map(c => getCandle(c)?.close || 0)
      .filter(p => p > 0);
    if (prices.length === 0) return null;

    const minPrice = Math.min(...prices) * 0.999;
    const maxPrice = Math.max(...prices) * 1.001;

    const xScale = i => padding + (i / candles.length) * (width - padding * 2);
    const yScale = p =>
      height -
      padding -
      ((p - minPrice) / (maxPrice - minPrice)) * (height - padding * 2);

    const pathPoints = visibleCandles
      .map((candle, i) => {
        const c = getCandle(candle);
        if (!c) return null;
        const x = xScale(i);
        const y = yScale(c.close);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .filter(Boolean)
      .join(' ');

    const buyTrades = portfolio.trades.filter(t => t.type === 'BUY');
    const sellTrades = portfolio.trades.filter(t => t.type === 'SELL');

    return (
      <svg
        width={width}
        height={height}
        style={{
          backgroundColor: theme.colors.gray50,
          borderRadius: theme.borderRadius.md,
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <line
            key={pct}
            x1={padding}
            y1={height - padding - pct * (height - padding * 2)}
            x2={width - padding}
            y2={height - padding - pct * (height - padding * 2)}
            stroke={theme.colors.gray200}
            strokeDasharray="2,2"
          />
        ))}

        <text x={5} y={padding} fontSize={10} fill={theme.colors.gray500}>
          ${maxPrice.toFixed(2)}
        </text>
        <text
          x={5}
          y={height - padding}
          fontSize={10}
          fill={theme.colors.gray500}
        >
          ${minPrice.toFixed(2)}
        </text>

        <path
          d={pathPoints}
          fill="none"
          stroke={
            currentPrice >= dayOpen ? theme.colors.success : theme.colors.error
          }
          strokeWidth={2}
        />

        {visibleCandles.length > 0 && (
          <circle
            cx={xScale(visibleCandles.length - 1)}
            cy={yScale(currentPrice)}
            r={4}
            fill={
              currentPrice >= dayOpen
                ? theme.colors.success
                : theme.colors.error
            }
          />
        )}

        {buyTrades.map((trade, i) => {
          const tradeIndex = candles.findIndex(
            c => (c.timestamp || c.t) >= trade.timestamp
          );
          if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
          return (
            <polygon
              key={`buy-${i}`}
              points={`${xScale(tradeIndex)},${yScale(trade.price) + 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) + 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) + 16}`}
              fill={theme.colors.success}
            />
          );
        })}
        {sellTrades.map((trade, i) => {
          const tradeIndex = candles.findIndex(
            c => (c.timestamp || c.t) >= trade.timestamp
          );
          if (tradeIndex < 0 || tradeIndex > currentCandleIndex) return null;
          return (
            <polygon
              key={`sell-${i}`}
              points={`${xScale(tradeIndex)},${yScale(trade.price) - 8} ${xScale(tradeIndex) - 5},${yScale(trade.price) - 16} ${xScale(tradeIndex) + 5},${yScale(trade.price) - 16}`}
              fill={theme.colors.error}
            />
          );
        })}

        <text
          x={padding}
          y={height - 5}
          fontSize={10}
          fill={theme.colors.gray500}
        >
          9:30
        </text>
        <text
          x={width / 2}
          y={height - 5}
          fontSize={10}
          fill={theme.colors.gray500}
          textAnchor="middle"
        >
          12:00
        </text>
        <text
          x={width - padding}
          y={height - 5}
          fontSize={10}
          fill={theme.colors.gray500}
          textAnchor="end"
        >
          4:00
        </text>
      </svg>
    );
  };

  // Generate recommendations based on simulation results
  const generateRecommendations = useCallback((analysisData, trades, dayData) => {
    const recs = [];
    const currentTP = config?.takeProfitPercent || 2;
    const currentSL = config?.stopLossPercent || 1;
    const currentConf = config?.minConfidence || 70;
    const currentMinSignals = config?.minSignalsRequired || 3;
    const currentStrategy = config?.entryStrategy || 'balanced';

    if (!analysisData || trades.length === 0) {
      setRecommendations([]);
      return;
    }

    // Analyze trade outcomes
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const winRate = wins.length / trades.length;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

    // Analyze day characteristics
    const dayMove = analysisData.priceChangePercent || 0;
    const isTrendingDay = Math.abs(dayMove) > 3; // >3% move
    const isBigDay = Math.abs(dayMove) > 5; // >5% move
    const captureRate = dayMove !== 0 ? (analysisData.returnPercent / Math.abs(dayMove)) : 0;

    // Recommendation 1: Strategy type for the day
    if (isTrendingDay && currentStrategy !== 'momentum' && captureRate < 0.3) {
      recs.push({
        id: 'use_momentum',
        title: '🚀 Switch to Momentum Strategy',
        description: `This was a ${dayMove > 0 ? '+' : ''}${dayMove.toFixed(1)}% day but you only captured ${(captureRate * 100).toFixed(0)}% of it. Momentum strategy is better for strong trend days.`,
        field: 'entryStrategy',
        currentValue: currentStrategy,
        suggestedValue: 'momentum',
        impact: `Potential ${(dayMove * 0.5).toFixed(1)}%+ return on similar days`,
        priority: 'high',
      });
    }

    // Recommendation 2: Too few signals required on trending day
    if (isTrendingDay && currentMinSignals >= 3 && trades.length < 5) {
      recs.push({
        id: 'reduce_signals',
        title: '📉 Reduce Min Signals Required',
        description: `Only ${trades.length} trades on a ${dayMove.toFixed(1)}% day. Requiring ${currentMinSignals} signals is too strict for momentum plays.`,
        field: 'minSignalsRequired',
        currentValue: currentMinSignals,
        suggestedValue: 2,
        impact: 'More opportunities on strong moves',
        priority: 'high',
      });
    }

    // Recommendation 3: Take Profit too tight on big day
    if (isBigDay && currentTP < 3 && avgWin > 0) {
      const potentialExtra = (dayMove * 0.3) - currentTP;
      if (potentialExtra > 0.5) {
        recs.push({
          id: 'increase_tp_big_day',
          title: '💰 Increase Take Profit for Big Days',
          description: `On ${dayMove.toFixed(1)}% days, ${currentTP}% take profit exits too early. Let winners run when momentum is strong.`,
          field: 'takeProfitPercent',
          currentValue: currentTP,
          suggestedValue: Math.min(dayMove * 0.4, 8),
          impact: `Capture ${(potentialExtra).toFixed(1)}% more per trade`,
          priority: 'high',
        });
      }
    }

    // Recommendation 4: Standard Take Profit adjustment
    if (winRate >= 0.6 && avgWin < avgLoss * 1.5) {
      recs.push({
        id: 'increase_tp',
        title: 'Increase Take Profit Target',
        description: `Your win rate is ${(winRate * 100).toFixed(0)}% but average win ($${avgWin.toFixed(0)}) is less than 1.5x average loss ($${avgLoss.toFixed(0)}).`,
        field: 'takeProfitPercent',
        currentValue: currentTP,
        suggestedValue: Math.min(currentTP * 1.5, 5),
        impact: '+0.5-1% potential daily return',
      });
    } else if (winRate < 0.4 && avgWin > avgLoss * 2) {
      recs.push({
        id: 'decrease_tp',
        title: 'Decrease Take Profit Target',
        description: `Your win rate is only ${(winRate * 100).toFixed(0)}% but winners are ${(avgWin / avgLoss).toFixed(1)}x larger than losses.`,
        field: 'takeProfitPercent',
        currentValue: currentTP,
        suggestedValue: Math.max(currentTP * 0.75, 1),
        impact: '+5-15% expected win rate improvement',
      });
    }

    // Recommendation 5: Stop Loss adjustment
    if (losses.length > 0) {
      const avgLossPercent = (avgLoss / (config?.allocatedCapital || 100000)) * 100;
      if (avgLossPercent > currentSL * 1.2) {
        recs.push({
          id: 'tighten_sl',
          title: 'Tighten Stop Loss',
          description: `Average loss (${avgLossPercent.toFixed(2)}%) exceeds your stop loss setting (${currentSL}%).`,
          field: 'stopLossPercent',
          currentValue: currentSL,
          suggestedValue: Math.max(currentSL * 0.8, 0.5),
          impact: 'Better risk control per trade',
        });
      } else if (avgLossPercent < currentSL * 0.5 && winRate < 0.5) {
        recs.push({
          id: 'widen_sl',
          title: 'Widen Stop Loss',
          description: `You might be getting stopped out too early. Average loss (${avgLossPercent.toFixed(2)}%) is much less than your stop (${currentSL}%).`,
          field: 'stopLossPercent',
          currentValue: currentSL,
          suggestedValue: Math.min(currentSL * 1.25, 3),
          impact: '+5-10% potential win rate improvement',
        });
      }
    }

    // Recommendation 6: Confidence threshold
    if (trades.length < 3 && analysisData.returnPercent < dayMove * 0.1) {
      recs.push({
        id: 'lower_confidence',
        title: 'Lower Confidence Threshold',
        description: `Only ${trades.length} trades executed on a ${dayMove.toFixed(1)}% day. Consider lowering confidence threshold.`,
        field: 'minConfidence',
        currentValue: currentConf,
        suggestedValue: Math.max(currentConf - 10, 50),
        impact: 'More trading opportunities',
      });
    } else if (trades.length > 15 && winRate < 0.45) {
      recs.push({
        id: 'raise_confidence',
        title: 'Raise Confidence Threshold',
        description: `${trades.length} trades with only ${(winRate * 100).toFixed(0)}% win rate. Be more selective.`,
        field: 'minConfidence',
        currentValue: currentConf,
        suggestedValue: Math.min(currentConf + 10, 85),
        impact: 'Higher quality signals',
      });
    }

    // Recommendation 7: R:R Ratio
    const rrRatio = avgWin / (avgLoss || 1);
    if (rrRatio < 1 && winRate < 0.6) {
      recs.push({
        id: 'improve_rr',
        title: 'Improve Risk/Reward Ratio',
        description: `Current R:R is ${rrRatio.toFixed(2)}:1 with ${(winRate * 100).toFixed(0)}% win rate. This combination is not profitable.`,
        field: 'takeProfitPercent',
        currentValue: currentTP,
        suggestedValue: currentSL * 2,
        impact: 'Profitable expectancy',
      });
    }

    // Recommendation 8: Disable require flags on momentum days
    if (isTrendingDay && config?.requireVolumeSpike && trades.length < 5) {
      recs.push({
        id: 'disable_volume_req',
        title: 'Disable Volume Spike Requirement',
        description: `On strong trend days, requiring volume spikes filters out good momentum entries.`,
        field: 'requireVolumeSpike',
        currentValue: true,
        suggestedValue: false,
        impact: 'More momentum entries',
      });
    }

    // Sort by priority (high priority first)
    recs.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return 0;
    });

    setRecommendations(recs);
  }, [config]);

  // Apply a recommendation
  const applyRecommendation = (rec) => {
    updateGlobalConfig({ [rec.field]: rec.suggestedValue });
    // Remove applied recommendation from list
    setRecommendations(prev => prev.filter(r => r.id !== rec.id));
  };

  // Apply all recommendations at once
  const applyAllRecommendations = () => {
    const updates = {};
    recommendations.forEach(rec => {
      updates[rec.field] = rec.suggestedValue;
    });
    updateGlobalConfig(updates);
    setRecommendations([]);
  };

  // ============================================
  // CONFIG OPTIMIZER / STRESS TEST
  // Runs multiple simulations to find optimal config
  // ============================================

  // Config variations to test - comprehensive coverage
  const CONFIG_VARIATIONS = {
    entryStrategy: ['dip', 'conservative', 'balanced', 'aggressive', 'momentum'],
    minSignalsRequired: [1, 2, 3],
    takeProfitPercent: [1, 1.5, 2, 3, 5, 8, 10],
    stopLossPercent: [0.5, 1, 1.5, 2, 3],
    minConfidence: [40, 50, 60, 70, 80],
    maxPositionSizePercent: [10, 25, 50, 80, 100],
    // Test different requirement combinations
    requireFlags: [
      { requireVolumeSpike: false, requireTrendAlignment: false, requireRsiSignal: false },
      { requireVolumeSpike: true, requireTrendAlignment: false, requireRsiSignal: false },
      { requireVolumeSpike: true, requireTrendAlignment: true, requireRsiSignal: false },
    ],
  };
  // Total combinations: 5 × 3 × 7 × 5 × 5 × 5 × 3 = 39,375

  // Run a fast simulation with a given config (no UI updates)
  // USES SHARED FUNCTIONS to guarantee parity with full simulation
  const runFastSimulation = (candleData, testConfig) => {
    const initialCash = testConfig.allocatedCapital || 25000;
    let cash = initialCash;
    let position = null;
    let trades = [];

    // Process each candle (start at 20 for indicator warm-up)
    for (let i = 20; i < candleData.length; i++) {
      const candle = candleData[i];
      const price = candle.close || candle.c;
      const timestamp = candle.timestamp || candle.t;

      // Use SHARED indicator calculation (same as full simulation)
      const indicators = calculateIndicatorsShared(i, candleData);

      // BUY logic - use SHARED function
      if (!position) {
        const buyResult = shouldBuy(price, indicators, testConfig, null);
        if (buyResult.shouldBuy) {
          // Position sizing (same as full simulation)
          const maxPositionPercent = (testConfig.maxPositionSizePercent || 50) / 100;
          const maxPositionDollars = testConfig.maxPositionSize || cash;
          const positionValue = Math.min(cash * maxPositionPercent, maxPositionDollars);
          const positionSize = Math.floor(positionValue / price);
          if (positionSize > 0) {
            position = { quantity: positionSize, entryPrice: price, entryIndex: i, highWaterMark: price };
            cash -= positionSize * price;
          }
        }
      }
      // SELL logic - use SHARED function
      else if (position) {
        // Update high water mark for trailing stop
        position.highWaterMark = Math.max(position.highWaterMark || position.entryPrice, price);

        const sellResult = shouldSell(price, position.entryPrice, indicators, testConfig, i, position.entryIndex, timestamp, position.highWaterMark);
        if (sellResult.shouldSell) {
          const pnl = position.quantity * (price - position.entryPrice);
          trades.push({ pnl, entryPrice: position.entryPrice, exitPrice: price });
          cash += position.quantity * price;
          position = null;
        }
      }
    }

    // Close any remaining position at end
    if (position && candleData.length > 0) {
      const lastPrice = candleData[candleData.length - 1].close || candleData[candleData.length - 1].c;
      const pnl = position.quantity * (lastPrice - position.entryPrice);
      trades.push({ pnl, entryPrice: position.entryPrice, exitPrice: lastPrice });
      cash += position.quantity * lastPrice;
    }

    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const returnPercent = ((cash - initialCash) / initialCash) * 100;
    const winRate = trades.length > 0 ? (trades.filter(t => t.pnl > 0).length / trades.length) * 100 : 0;

    return {
      totalPnL,
      returnPercent,
      winRate,
      numTrades: trades.length,
      config: testConfig,
    };
  };

  // Run the optimizer
  const runOptimizer = async () => {
    setIsOptimizing(true);
    setOptimizerProgress(0);
    setOptimizerResults([]);
    setShowOptimizer(true);

    // Fetch candle data
    const data = await fetchSimulationData();
    if (!data || data.length === 0) {
      setIsOptimizing(false);
      addEvent('error', 'Optimizer Failed', 'No data available for this date');
      return;
    }
    console.log(`[Optimizer] Processing ${data.length} candles (starting from index 20, so ${data.length - 20} tradeable candles)`);

    // Generate all config combinations
    const combinations = [];
    const baseConfig = {
      ...config,
      allocatedCapital: config.allocatedCapital || 25000,
      rsiOversold: config.rsiOversold || 30,
      rsiOverbought: config.rsiOverbought || 70,
      volumeMultiplier: config.volumeMultiplier || 1.5,
    };

    for (const strategy of CONFIG_VARIATIONS.entryStrategy) {
      for (const signals of CONFIG_VARIATIONS.minSignalsRequired) {
        for (const tp of CONFIG_VARIATIONS.takeProfitPercent) {
          for (const sl of CONFIG_VARIATIONS.stopLossPercent) {
            for (const conf of CONFIG_VARIATIONS.minConfidence) {
              for (const posSize of CONFIG_VARIATIONS.maxPositionSizePercent) {
                for (const flags of CONFIG_VARIATIONS.requireFlags) {
                  combinations.push({
                    ...baseConfig,
                    entryStrategy: strategy,
                    minSignalsRequired: signals,
                    takeProfitPercent: tp,
                    stopLossPercent: sl,
                    minConfidence: conf,
                    maxPositionSizePercent: posSize,
                    ...flags,
                  });
                }
              }
            }
          }
        }
      }
    }

    console.log(`[Optimizer] Testing ${combinations.length} config combinations...`);
    addEvent('info', 'Optimizer Started', `Testing ${combinations.length} configurations...`);

    const results = [];
    for (let i = 0; i < combinations.length; i++) {
      const testConfig = combinations[i];
      const result = runFastSimulation(data, testConfig);
      results.push(result);

      // Update progress every 10 iterations
      if (i % 10 === 0) {
        setOptimizerProgress(Math.round((i / combinations.length) * 100));
        // Yield to prevent UI freeze
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Sort by return percent (best first)
    results.sort((a, b) => b.returnPercent - a.returnPercent);

    // Keep top 10
    const topResults = results.slice(0, 10);
    setOptimizerResults(topResults);
    setOptimizerProgress(100);
    setIsOptimizing(false);

    addEvent('success', 'Optimizer Complete', `Best config: ${topResults[0].returnPercent.toFixed(2)}% return`);
    console.log('[Optimizer] Top 10 results:', topResults);
  };

  // Apply an optimizer result
  const applyOptimizerResult = (result) => {
    // Calculate diff between current config and new config
    const oldConfig = { ...config };
    const newConfig = result.config;

    // Fields to compare
    const fieldsToCompare = [
      { key: 'entryStrategy', label: 'Strategy' },
      { key: 'minSignalsRequired', label: 'Min Signals' },
      { key: 'takeProfitPercent', label: 'Take Profit %' },
      { key: 'stopLossPercent', label: 'Stop Loss %' },
      { key: 'minConfidence', label: 'Min Confidence %' },
      { key: 'maxPositionSizePercent', label: 'Position Size %' },
      { key: 'rsiOversold', label: 'RSI Oversold' },
      { key: 'rsiOverbought', label: 'RSI Overbought' },
      { key: 'requireVolumeSpike', label: 'Require Volume Spike' },
      { key: 'requireTrendAlignment', label: 'Require Trend Align' },
      { key: 'requireRsiSignal', label: 'Require RSI Signal' },
    ];

    const changes = [];
    fieldsToCompare.forEach(({ key, label }) => {
      const oldVal = oldConfig[key];
      const newVal = newConfig[key];
      if (oldVal !== newVal && newVal !== undefined) {
        changes.push({
          field: label,
          key,
          oldValue: oldVal,
          newValue: newVal,
          direction: typeof newVal === 'number' && typeof oldVal === 'number'
            ? (newVal > oldVal ? 'up' : 'down')
            : 'changed',
        });
      }
    });

    // Store the diff
    setConfigDiff({
      oldConfig,
      newConfig,
      changes,
      prediction: {
        returnPercent: result.returnPercent,
        totalPnL: result.totalPnL,
        numTrades: result.numTrades,
        winRate: result.winRate,
      },
    });
    setShowConfigDiff(true);

    // Apply the new config
    updateGlobalConfig(result.config);

    // Store the prediction for comparison after simulation
    setOptimizerPrediction({
      returnPercent: result.returnPercent,
      totalPnL: result.totalPnL,
      numTrades: result.numTrades,
      winRate: result.winRate,
      config: { ...result.config },
    });
    // Clear debug log for fresh start
    debugLogRef.current = [];
    setDebugLog([]);
    addEvent('info', 'Config Applied', `Applied ${result.config.entryStrategy} strategy config. Predicted: ${result.returnPercent.toFixed(2)}% return, ${result.numTrades} trades`);
  };

  // Save results
  const saveResults = async () => {
    if (!analysis) return;

    try {
      const res = await fetch('/api/simulation/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          aiDecisions,
          events,
          config,
          savedAt: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        addEvent('success', 'Results Saved', 'Simulation results saved');
      }
    } catch (err) {
      console.error('Failed to save results:', err);
    }
  };

  return (
    <Card style={{ marginBottom: theme.spacing.lg }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.md,
        }}
      >
        <h3 style={{ margin: 0 }}>Trading Day Simulator</h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.md,
          }}
        >
          <div
            style={{
              fontSize: theme.typography.fontSize.xs,
              color: theme.colors.gray500,
              display: 'flex',
              gap: theme.spacing.sm,
            }}
          >
            <span
              style={{
                backgroundColor: theme.colors.success + '20',
                padding: '2px 6px',
                borderRadius: theme.borderRadius.sm,
              }}
            >
              +{config?.takeProfitPercent || 2}% TP
            </span>
            <span
              style={{
                backgroundColor: theme.colors.error + '20',
                padding: '2px 6px',
                borderRadius: theme.borderRadius.sm,
              }}
            >
              -{config?.stopLossPercent || 1}% SL
            </span>
          </div>
          <div
            style={{
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray500,
            }}
          >
            6.5 hours → {(6 / simulationSpeed).toFixed(1)} seconds
          </div>
        </div>
      </div>

      {/* EDITABLE CONFIG PANEL - Set what you want to test */}
      <ConfigPanel
        mode={isRunning ? 'view' : 'edit'}
        title="Trading Config (Edit Before Running)"
      />

      {/* Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: theme.spacing.md,
          marginBottom: theme.spacing.lg,
        }}
      >
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: theme.spacing.xs,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
            }}
          >
            Date
          </label>
          <input
            type="date"
            value={simulationDate}
            onChange={e => setSimulationDate(e.target.value)}
            disabled={isRunning}
            max={new Date().toISOString().split('T')[0]}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md,
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: theme.spacing.xs,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
            }}
          >
            Symbol {lockedSymbols?.length > 0 && <span style={{ color: '#22c55e', fontSize: '10px' }}>(ETF Mode)</span>}
          </label>
          {lockedSymbols?.length > 0 ? (
            /* When ETF mode is enabled, show dropdown of allowed symbols */
            <select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              disabled={isRunning}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid #22c55e`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
                backgroundColor: '#dcfce7',
              }}
            >
              {lockedSymbols.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              disabled={isRunning}
              placeholder="AAPL"
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray300}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.md,
              }}
            />
          )}
        </div>

        <div>
          <label
            style={{
              display: 'block',
              marginBottom: theme.spacing.xs,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
            }}
          >
            Speed
          </label>
          <select
            value={simulationSpeed}
            onChange={e => setSimulationSpeed(parseFloat(e.target.value))}
            disabled={isRunning}
            style={{
              width: '100%',
              padding: theme.spacing.sm,
              border: `1px solid ${theme.colors.gray300}`,
              borderRadius: theme.borderRadius.md,
              fontSize: theme.typography.fontSize.md,
            }}
          >
            <option value={0.5}>0.5x (12s)</option>
            <option value={1}>1x (6s)</option>
            <option value={2}>2x (3s)</option>
            <option value={4}>4x (1.5s)</option>
          </select>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: theme.spacing.sm,
          }}
        >
          {!isRunning && !isOptimizing ? (
            <>
              <Button
                onClick={startSimulation}
                disabled={!simulationDate || !symbol}
              >
                Run Simulation
              </Button>
              <Button
                variant="outline"
                onClick={runOptimizer}
                disabled={!simulationDate || !symbol}
                style={{ backgroundColor: '#8b5cf6', color: '#fff', border: 'none' }}
              >
                🔬 Find Optimal Config
              </Button>
            </>
          ) : isOptimizing ? (
            <Button variant="outline" disabled>
              Optimizing... {optimizerProgress}%
            </Button>
          ) : (
            <>
              <Button
                variant={isPaused ? 'primary' : 'outline'}
                onClick={togglePause}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="danger" onClick={stopSimulation}>
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Config Locked Indicator - Shows during simulation */}
      {isRunning && configSnapshotRef.current && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.md,
            padding: theme.spacing.xs,
            marginBottom: theme.spacing.sm,
            backgroundColor: '#dbeafe',
            borderRadius: theme.borderRadius.sm,
            fontSize: theme.typography.fontSize.xs,
            color: '#1e40af',
          }}
        >
          <span>🔒 <strong>Config Locked:</strong> {configSnapshotRef.current.entryStrategy} strategy | TP {configSnapshotRef.current.takeProfitPercent}% | SL {configSnapshotRef.current.stopLossPercent}% | {configSnapshotRef.current.minSignalsRequired} signals</span>
        </div>
      )}

      {/* PROMINENT P&L DISPLAY */}
      {(isRunning || progress > 0) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: theme.spacing.lg,
            marginBottom: theme.spacing.md,
            backgroundColor:
              totalPnL >= 0
                ? `${theme.colors.success}15`
                : `${theme.colors.error}15`,
            borderRadius: theme.borderRadius.lg,
            border: `2px solid ${totalPnL >= 0 ? theme.colors.success : theme.colors.error}`,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                marginBottom: theme.spacing.xs,
              }}
            >
              Total P&L
            </div>
            <div
              style={{
                fontSize: '48px',
                fontWeight: theme.typography.fontWeight.bold,
                color:
                  totalPnL >= 0 ? theme.colors.success : theme.colors.error,
                lineHeight: 1,
              }}
            >
              {totalPnL >= 0 ? '+' : ''}
              {totalPnL.toFixed(2)}
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                marginTop: theme.spacing.xs,
              }}
            >
              {portfolio.startingCash > 0
                ? `${((totalPnL / portfolio.startingCash) * 100).toFixed(2)}%`
                : '0.00%'}{' '}
              return
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {(isRunning || progress > 0) && (
        <div style={{ marginBottom: theme.spacing.md }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: theme.spacing.xs,
            }}
          >
            <span
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
              }}
            >
              {currentTime}{' '}
              {isPaused && (
                <span style={{ color: theme.colors.warning }}>(PAUSED)</span>
              )}
            </span>
            <span
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
              }}
            >
              {progress.toFixed(0)}%
            </span>
          </div>
          <div
            style={{
              height: 8,
              backgroundColor: theme.colors.gray200,
              borderRadius: theme.borderRadius.full,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: isPaused
                  ? theme.colors.warning
                  : isRunning
                    ? theme.colors.primary
                    : theme.colors.success,
                transition: 'width 0.1s linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Live Stats */}
      {(isRunning || progress > 0) && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              Price
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
                color:
                  currentPrice >= dayOpen
                    ? theme.colors.success
                    : theme.colors.error,
              }}
            >
              ${currentPrice.toFixed(2)}
            </div>
          </div>
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              Day %
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
                color:
                  currentPrice >= dayOpen
                    ? theme.colors.success
                    : theme.colors.error,
              }}
            >
              {dayOpen > 0
                ? `${(((currentPrice - dayOpen) / dayOpen) * 100).toFixed(2)}%`
                : '--'}
            </div>
            {preMarketInfo?.hasGap && (
              <div
                style={{
                  fontSize: '10px',
                  color: parseFloat(preMarketInfo.gapPercent) > 0 ? theme.colors.success : theme.colors.error,
                  marginTop: '2px',
                }}
              >
                Gap: {preMarketInfo.gapPercent > 0 ? '+' : ''}{preMarketInfo.gapPercent}%
              </div>
            )}
          </div>
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              Cash
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            >
              ${portfolio.cash.toFixed(0)}
            </div>
          </div>
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor: theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              Trades
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.lg,
                fontWeight: theme.typography.fontWeight.bold,
              }}
            >
              {portfolio.trades.length}
            </div>
          </div>
          <div
            style={{
              padding: theme.spacing.sm,
              backgroundColor:
                portfolio.positions.length > 0
                  ? `${theme.colors.info}15`
                  : theme.colors.gray50,
              borderRadius: theme.borderRadius.sm,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.xs,
                color: theme.colors.gray500,
              }}
            >
              Position
            </div>
            <div
              style={{
                fontSize: theme.typography.fontSize.md,
                fontWeight: theme.typography.fontWeight.bold,
                color:
                  portfolio.positions.length > 0
                    ? theme.colors.info
                    : theme.colors.gray400,
              }}
            >
              {portfolio.positions.length > 0
                ? `${portfolio.positions[0].quantity} shs`
                : 'None'}
            </div>
          </div>
        </div>
      )}

      {/* Intraday Regime Panel */}
      {(isRunning || progress > 0) && intradayRegime.regime !== 'unknown' && (
        <div
          style={{
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
            backgroundColor: intradayRegime.regime === 'bull' ? '#dcfce7'
              : intradayRegime.regime === 'bear' ? '#fee2e2' : '#fef9c3',
            borderRadius: theme.borderRadius.md,
            border: `2px solid ${intradayRegime.regime === 'bull' ? '#22c55e'
              : intradayRegime.regime === 'bear' ? '#ef4444' : '#eab308'}`,
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.spacing.sm,
          }}>
            <h4 style={{
              margin: 0,
              fontSize: theme.typography.fontSize.sm,
              color: intradayRegime.regime === 'bull' ? '#166534'
                : intradayRegime.regime === 'bear' ? '#991b1b' : '#854d0e',
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}>
              {intradayRegime.regime === 'bull' && '📈'}
              {intradayRegime.regime === 'bear' && '📉'}
              {intradayRegime.regime === 'sideways' && '↔️'}
              Intraday Regime: <strong>{intradayRegime.regime.toUpperCase()}</strong>
              <span style={{
                padding: '2px 8px',
                borderRadius: theme.borderRadius.sm,
                backgroundColor: 'white',
                fontSize: theme.typography.fontSize.xs,
              }}>
                {intradayRegime.confidence}% conf
              </span>
            </h4>
            <span style={{ fontSize: theme.typography.fontSize.xs, color: theme.colors.textMuted }}>
              Updated: {intradayRegime.lastUpdate || 'Pending'}
            </span>
          </div>

          {/* Regime Metrics */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: theme.spacing.sm,
            fontSize: theme.typography.fontSize.xs,
          }}>
            <div style={{ textAlign: 'center', padding: theme.spacing.xs, backgroundColor: 'white', borderRadius: theme.borderRadius.sm }}>
              <div style={{ color: theme.colors.textMuted }}>vs Open</div>
              <div style={{
                fontWeight: 'bold',
                color: parseFloat(intradayRegime.priceVsOpen) > 0 ? '#22c55e' : parseFloat(intradayRegime.priceVsOpen) < 0 ? '#ef4444' : 'inherit',
              }}>
                {intradayRegime.priceVsOpen > 0 ? '+' : ''}{intradayRegime.priceVsOpen}%
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: theme.spacing.xs, backgroundColor: 'white', borderRadius: theme.borderRadius.sm }}>
              <div style={{ color: theme.colors.textMuted }}>vs VWAP</div>
              <div style={{
                fontWeight: 'bold',
                color: parseFloat(intradayRegime.priceVsVwap) > 0 ? '#22c55e' : parseFloat(intradayRegime.priceVsVwap) < 0 ? '#ef4444' : 'inherit',
              }}>
                {intradayRegime.priceVsVwap > 0 ? '+' : ''}{intradayRegime.priceVsVwap}%
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: theme.spacing.xs, backgroundColor: 'white', borderRadius: theme.borderRadius.sm }}>
              <div style={{ color: theme.colors.textMuted }}>20m Mom</div>
              <div style={{
                fontWeight: 'bold',
                color: parseFloat(intradayRegime.momentum20) > 0 ? '#22c55e' : parseFloat(intradayRegime.momentum20) < 0 ? '#ef4444' : 'inherit',
              }}>
                {intradayRegime.momentum20 > 0 ? '+' : ''}{intradayRegime.momentum20}%
              </div>
            </div>
            <div style={{ textAlign: 'center', padding: theme.spacing.xs, backgroundColor: 'white', borderRadius: theme.borderRadius.sm }}>
              <div style={{ color: theme.colors.textMuted }}>Trend</div>
              <div style={{ fontWeight: 'bold' }}>
                {intradayRegime.trend === 'uptrend' && '⬆️ Up'}
                {intradayRegime.trend === 'downtrend' && '⬇️ Down'}
                {intradayRegime.trend === 'flat' && '➡️ Flat'}
              </div>
            </div>
          </div>

          {/* Regime History */}
          {intradayRegime.history?.length > 1 && (
            <div style={{
              marginTop: theme.spacing.sm,
              padding: theme.spacing.xs,
              backgroundColor: 'white',
              borderRadius: theme.borderRadius.sm,
              fontSize: '10px',
            }}>
              <strong>Regime Changes:</strong>{' '}
              {intradayRegime.history.map((h, i) => (
                <span key={i} style={{
                  padding: '2px 6px',
                  marginLeft: '4px',
                  borderRadius: '4px',
                  backgroundColor: h.regime === 'bull' ? '#dcfce7' : h.regime === 'bear' ? '#fee2e2' : '#fef9c3',
                }}>
                  {h.time}: {h.regime.toUpperCase()}
                </span>
              ))}
            </div>
          )}

          {/* ETF Mode Symbol Suggestion */}
          {lockedSymbols && lockedSymbols.length > 0 && (
            <div style={{
              marginTop: theme.spacing.sm,
              padding: theme.spacing.xs,
              backgroundColor: '#dbeafe',
              borderRadius: theme.borderRadius.sm,
              fontSize: theme.typography.fontSize.xs,
              color: '#1e40af',
            }}>
              <strong>ETF Mode Suggestion:</strong>{' '}
              {intradayRegime.regime === 'bull' && `Consider ${lockedSymbols[1] || lockedSymbols[0]} (bull ETF)`}
              {intradayRegime.regime === 'bear' && `Consider ${lockedSymbols[2] || lockedSymbols[0]} (bear ETF)`}
              {intradayRegime.regime === 'sideways' && 'Consider staying in cash - sideways regime detected'}
            </div>
          )}
        </div>
      )}

      {/* ML Indicators Panel - What the Strategy Sees */}
      {(isRunning || progress > 0) && (
        <div
          style={{
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
            backgroundColor: theme.colors.gray50,
            borderRadius: theme.borderRadius.md,
            border: `1px solid ${theme.colors.gray200}`,
          }}
        >
          <h4
            style={{
              margin: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.sm,
              color: theme.colors.gray600,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <span style={{ fontSize: '16px' }}>🔍</span>
            What the Strategy Sees
          </h4>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: theme.spacing.md,
            }}
          >
            {/* RSI Indicator */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                RSI (14)
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    currentIndicators.rsi <= 30
                      ? theme.colors.success
                      : currentIndicators.rsi >= 70
                        ? theme.colors.error
                        : theme.colors.text,
                }}
              >
                {currentIndicators.rsi}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color:
                    currentIndicators.rsi <= 30
                      ? theme.colors.success
                      : currentIndicators.rsi >= 70
                        ? theme.colors.error
                        : theme.colors.gray500,
                }}
              >
                {currentIndicators.rsi <= 30
                  ? 'Oversold'
                  : currentIndicators.rsi >= 70
                    ? 'Overbought'
                    : 'Neutral'}
              </div>
              {/* RSI Bar */}
              <div
                style={{
                  marginTop: '6px',
                  height: '4px',
                  backgroundColor: theme.colors.gray200,
                  borderRadius: '2px',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: `${currentIndicators.rsi}%`,
                    top: '-2px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor:
                      currentIndicators.rsi <= 30
                        ? theme.colors.success
                        : currentIndicators.rsi >= 70
                          ? theme.colors.error
                          : theme.colors.primary,
                    transform: 'translateX(-50%)',
                  }}
                />
              </div>
            </div>

            {/* Price vs VWAP */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                Price vs VWAP
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    currentIndicators.priceVsVwap >= 0
                      ? theme.colors.success
                      : theme.colors.error,
                }}
              >
                {currentIndicators.priceVsVwap >= 0 ? '+' : ''}
                {currentIndicators.priceVsVwap}%
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                VWAP: ${currentIndicators.vwap}
              </div>
            </div>

            {/* Price vs MA20 */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                Price vs MA(20)
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    currentIndicators.priceVsMa >= 0
                      ? theme.colors.success
                      : theme.colors.error,
                }}
              >
                {currentIndicators.priceVsMa >= 0 ? '+' : ''}
                {currentIndicators.priceVsMa}%
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                MA20: ${currentIndicators.ma20}
              </div>
            </div>

            {/* Volume Ratio */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                Volume Ratio
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    currentIndicators.volumeRatio >= 1.5
                      ? theme.colors.success
                      : currentIndicators.volumeRatio <= 0.5
                        ? theme.colors.warning
                        : theme.colors.text,
                }}
              >
                {currentIndicators.volumeRatio}x
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color:
                    currentIndicators.volumeRatio >= 1.5
                      ? theme.colors.success
                      : theme.colors.gray500,
                }}
              >
                {currentIndicators.volumeRatio >= 1.5
                  ? 'High Volume'
                  : currentIndicators.volumeRatio <= 0.5
                    ? 'Low Volume'
                    : 'Normal'}
              </div>
              {/* Volume bar visualization */}
              <div
                style={{
                  marginTop: '6px',
                  height: '16px',
                  backgroundColor: theme.colors.gray200,
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(currentIndicators.volumeRatio * 50, 100)}%`,
                    backgroundColor:
                      currentIndicators.volumeRatio >= 1.5
                        ? theme.colors.success
                        : currentIndicators.volumeRatio <= 0.5
                          ? theme.colors.warning
                          : theme.colors.primary,
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>

            {/* Momentum */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                Momentum (1m)
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    currentIndicators.momentum >= 0
                      ? theme.colors.success
                      : theme.colors.error,
                }}
              >
                {currentIndicators.momentum >= 0 ? '+' : ''}
                {currentIndicators.momentum}%
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                {currentIndicators.momentum >= 0.5
                  ? 'Strong Up'
                  : currentIndicators.momentum <= -0.5
                    ? 'Strong Down'
                    : 'Flat'}
              </div>
            </div>

            {/* Current Volume */}
            <div
              style={{
                padding: theme.spacing.sm,
                backgroundColor: theme.colors.surface,
                borderRadius: theme.borderRadius.sm,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                  marginBottom: '4px',
                }}
              >
                Volume
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.lg,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {currentIndicators.volume
                  ? (currentIndicators.volume / 1000).toFixed(0) + 'K'
                  : '-'}
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xs,
                  color: theme.colors.gray500,
                }}
              >
                Avg: {currentIndicators.avgVolume
                  ? (currentIndicators.avgVolume / 1000).toFixed(0) + 'K'
                  : '-'}
              </div>
            </div>
          </div>

          {/* Signal Summary */}
          <div
            style={{
              marginTop: theme.spacing.md,
              padding: theme.spacing.sm,
              backgroundColor:
                currentIndicators.rsi <= 30 && currentIndicators.priceVsVwap < 0
                  ? `${theme.colors.success}15`
                  : currentIndicators.rsi >= 70 && currentIndicators.priceVsVwap > 0
                    ? `${theme.colors.error}15`
                    : theme.colors.surface,
              borderRadius: theme.borderRadius.sm,
              border: `1px solid ${
                currentIndicators.rsi <= 30 && currentIndicators.priceVsVwap < 0
                  ? theme.colors.success + '40'
                  : currentIndicators.rsi >= 70 && currentIndicators.priceVsVwap > 0
                    ? theme.colors.error + '40'
                    : theme.colors.gray200
              }`,
            }}
          >
            <div
              style={{
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.gray600,
                display: 'flex',
                flexWrap: 'wrap',
                gap: theme.spacing.sm,
              }}
            >
              <strong>Signals:</strong>
              {currentIndicators.rsi <= 30 && (
                <span
                  style={{
                    backgroundColor: theme.colors.success + '20',
                    color: theme.colors.success,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  RSI Oversold
                </span>
              )}
              {currentIndicators.rsi >= 70 && (
                <span
                  style={{
                    backgroundColor: theme.colors.error + '20',
                    color: theme.colors.error,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  RSI Overbought
                </span>
              )}
              {currentIndicators.priceVsVwap < -0.5 && (
                <span
                  style={{
                    backgroundColor: theme.colors.success + '20',
                    color: theme.colors.success,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  Below VWAP
                </span>
              )}
              {currentIndicators.priceVsVwap > 0.5 && (
                <span
                  style={{
                    backgroundColor: theme.colors.warning + '20',
                    color: theme.colors.warning,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  Above VWAP
                </span>
              )}
              {currentIndicators.volumeRatio >= 1.5 && (
                <span
                  style={{
                    backgroundColor: theme.colors.info + '20',
                    color: theme.colors.info,
                    padding: '2px 8px',
                    borderRadius: theme.borderRadius.sm,
                    fontSize: theme.typography.fontSize.xs,
                  }}
                >
                  Volume Spike
                </span>
              )}
              {currentIndicators.rsi > 35 &&
                currentIndicators.rsi < 65 &&
                currentIndicators.priceVsVwap >= -0.5 &&
                currentIndicators.priceVsVwap <= 0.5 &&
                currentIndicators.volumeRatio < 1.5 && (
                  <span
                    style={{
                      backgroundColor: theme.colors.gray200,
                      color: theme.colors.gray600,
                      padding: '2px 8px',
                      borderRadius: theme.borderRadius.sm,
                      fontSize: theme.typography.fontSize.xs,
                    }}
                  >
                    No Strong Signals
                  </span>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Mini Chart */}
      {candles.length > 0 && (
        <div style={{ marginBottom: theme.spacing.md }}>
          {renderMiniChart()}
        </div>
      )}

      {/* Events Feed */}
      {events.length > 0 && (
        <div style={{ marginBottom: theme.spacing.md }}>
          <h4 style={{ margin: 0, marginBottom: theme.spacing.sm }}>
            Event Log
          </h4>
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              fontSize: theme.typography.fontSize.sm,
            }}
          >
            {events
              .slice()
              .reverse()
              .slice(0, 10)
              .map(event => (
                <div
                  key={event.id}
                  style={{
                    padding: theme.spacing.sm,
                    marginBottom: theme.spacing.xs,
                    backgroundColor:
                      event.type === 'error'
                        ? `${theme.colors.error}10`
                        : event.type === 'success'
                          ? `${theme.colors.success}10`
                          : event.type === 'trade'
                            ? `${theme.colors.info}10`
                            : theme.colors.gray50,
                    borderLeft: `3px solid ${
                      event.type === 'error'
                        ? theme.colors.error
                        : event.type === 'success'
                          ? theme.colors.success
                          : event.type === 'trade'
                            ? theme.colors.info
                            : theme.colors.gray300
                    }`,
                    borderRadius: theme.borderRadius.sm,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div>
                      <strong
                        style={{
                          color:
                            event.type === 'error'
                              ? theme.colors.error
                              : event.type === 'success'
                                ? theme.colors.success
                                : theme.colors.info,
                        }}
                      >
                        {event.title}
                      </strong>
                      <span>: {event.message}</span>
                    </div>
                    {event.confidence && (
                      <span
                        style={{
                          fontSize: theme.typography.fontSize.xs,
                          backgroundColor: theme.colors.gray200,
                          padding: '2px 6px',
                          borderRadius: theme.borderRadius.sm,
                          marginLeft: theme.spacing.sm,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {event.confidence}% conf
                      </span>
                    )}
                  </div>
                  {event.reason && (
                    <div
                      style={{
                        marginTop: theme.spacing.xs,
                        fontSize: theme.typography.fontSize.xs,
                        color: theme.colors.gray600,
                        fontStyle: 'italic',
                        paddingLeft: theme.spacing.sm,
                        borderLeft: `2px solid ${theme.colors.gray300}`,
                      }}
                    >
                      Trigger: {event.reason}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* OPTIMIZER RESULTS */}
      {showOptimizer && optimizerResults.length > 0 && (
        <div
          style={{
            marginBottom: theme.spacing.lg,
            padding: theme.spacing.md,
            backgroundColor: '#f5f3ff',
            borderRadius: theme.borderRadius.lg,
            border: '2px solid #8b5cf6',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
            <h4 style={{ margin: 0, color: '#5b21b6' }}>
              🔬 Optimizer Results - Top 10 Configs for {symbol} on {simulationDate}
            </h4>
            <button
              onClick={() => setShowOptimizer(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '18px',
                cursor: 'pointer',
                color: '#5b21b6',
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
              <thead>
                <tr style={{ backgroundColor: '#ede9fe' }}>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>#</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Return</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>P&L</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Win Rate</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Trades</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Strategy</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Signals</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>TP%</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>SL%</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Conf%</th>
                  <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #8b5cf6' }}>Pos%</th>
                  <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #8b5cf6' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {optimizerResults.map((result, index) => (
                  <tr
                    key={index}
                    style={{
                      backgroundColor: index === 0 ? '#ddd6fe' : index % 2 === 0 ? '#faf5ff' : 'white',
                    }}
                  >
                    <td style={{ padding: '8px', fontWeight: index === 0 ? 'bold' : 'normal' }}>
                      {index === 0 ? '🏆' : index + 1}
                    </td>
                    <td style={{
                      padding: '8px',
                      fontWeight: 'bold',
                      color: result.returnPercent >= 0 ? '#16a34a' : '#dc2626',
                    }}>
                      {result.returnPercent >= 0 ? '+' : ''}{result.returnPercent.toFixed(2)}%
                    </td>
                    <td style={{
                      padding: '8px',
                      color: result.totalPnL >= 0 ? '#16a34a' : '#dc2626',
                    }}>
                      ${result.totalPnL.toFixed(0)}
                    </td>
                    <td style={{ padding: '8px' }}>{result.winRate.toFixed(0)}%</td>
                    <td style={{ padding: '8px' }}>{result.numTrades}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor:
                          result.config.entryStrategy === 'momentum' ? '#8b5cf6' :
                          result.config.entryStrategy === 'aggressive' ? '#ef4444' :
                          result.config.entryStrategy === 'conservative' ? '#22c55e' : '#3b82f6',
                        color: '#fff',
                        fontSize: '11px',
                      }}>
                        {result.config.entryStrategy}
                      </span>
                    </td>
                    <td style={{ padding: '8px' }}>{result.config.minSignalsRequired}</td>
                    <td style={{ padding: '8px' }}>{result.config.takeProfitPercent}%</td>
                    <td style={{ padding: '8px' }}>{result.config.stopLossPercent}%</td>
                    <td style={{ padding: '8px' }}>{result.config.minConfidence}%</td>
                    <td style={{ padding: '8px' }}>{result.config.maxPositionSizePercent}%</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <Button
                        size="small"
                        variant={index === 0 ? 'primary' : 'outline'}
                        onClick={() => applyOptimizerResult(result)}
                        style={index === 0 ? { backgroundColor: '#8b5cf6', border: 'none' } : {}}
                      >
                        Apply
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0, marginTop: theme.spacing.md, fontSize: theme.typography.fontSize.xs, color: '#5b21b6' }}>
            💡 Click "Apply" on the best config, then run a full simulation to verify the results.
          </p>
        </div>
      )}

      {/* CONFIG DIFF PANEL - Shows what changed when applying optimizer result */}
      {showConfigDiff && configDiff && configDiff.changes.length > 0 && (
        <div
          style={{
            marginBottom: theme.spacing.lg,
            padding: theme.spacing.md,
            backgroundColor: '#fefce8',
            border: '1px solid #fbbf24',
            borderRadius: theme.borderRadius.lg,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
            <h4 style={{ margin: 0, color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📊 Config Changes Applied
            </h4>
            <button
              onClick={() => setShowConfigDiff(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#92400e',
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.spacing.sm }}>
            {configDiff.changes.map((change, index) => (
              <div
                key={index}
                style={{
                  padding: theme.spacing.sm,
                  backgroundColor: 'white',
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${
                    change.direction === 'up' ? '#22c55e' :
                    change.direction === 'down' ? '#ef4444' : '#6b7280'
                  }`,
                }}
              >
                <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px', fontWeight: 500 }}>
                  {change.field}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: '#fef2f2',
                    color: '#991b1b',
                    fontSize: '12px',
                    textDecoration: 'line-through',
                  }}>
                    {typeof change.oldValue === 'boolean' ? (change.oldValue ? 'Yes' : 'No') : change.oldValue}
                  </span>
                  <span style={{ color: '#6b7280', fontSize: '14px' }}>→</span>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    backgroundColor: change.direction === 'up' ? '#dcfce7' :
                      change.direction === 'down' ? '#fef2f2' : '#f3f4f6',
                    color: change.direction === 'up' ? '#166534' :
                      change.direction === 'down' ? '#991b1b' : '#374151',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>
                    {typeof change.newValue === 'boolean' ? (change.newValue ? 'Yes' : 'No') : change.newValue}
                    {change.direction === 'up' && ' ▲'}
                    {change.direction === 'down' && ' ▼'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: theme.spacing.md,
            padding: theme.spacing.sm,
            backgroundColor: '#fef9c3',
            borderRadius: theme.borderRadius.md,
            fontSize: '12px',
            color: '#854d0e',
          }}>
            <strong>Expected Results:</strong> {configDiff.prediction.returnPercent.toFixed(2)}% return,
            ${configDiff.prediction.totalPnL.toFixed(0)} P&L,
            {configDiff.prediction.winRate.toFixed(0)}% win rate,
            {configDiff.prediction.numTrades} trades
          </div>
        </div>
      )}

      {/* Analysis Results */}
      {showAnalysis && analysis && (
        <div
          style={{
            borderTop: `1px solid ${theme.colors.gray200}`,
            paddingTop: theme.spacing.md,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: theme.spacing.md,
            }}
          >
            <h4 style={{ margin: 0 }}>Simulation Analysis</h4>
            <Button size="small" variant="outline" onClick={saveResults}>
              Save Results
            </Button>
          </div>

          {/* Config Used - CRITICAL for knowing what settings produced these results */}
          {usedConfig && (
            <div
              style={{
                marginBottom: theme.spacing.md,
                padding: theme.spacing.sm,
                backgroundColor: '#e0f2fe',
                borderRadius: theme.borderRadius.md,
                border: '1px solid #0ea5e9',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontWeight: 'bold', color: '#0369a1' }}>
                  🔒 Config Used in This Simulation:
                </span>
                <Button
                  size="small"
                  variant="primary"
                  onClick={() => updateGlobalConfig(usedConfig)}
                  style={{ backgroundColor: '#0ea5e9', border: 'none', fontSize: '12px', padding: '4px 12px' }}
                >
                  ↩ Restore This Config
                </Button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.spacing.md }}>
                <span><strong>Strategy:</strong> {usedConfig.entryStrategy}</span>
                <span><strong>TP:</strong> {usedConfig.takeProfitPercent}%</span>
                <span><strong>SL:</strong> {usedConfig.stopLossPercent}%</span>
                <span><strong>Signals:</strong> {usedConfig.minSignalsRequired}</span>
                <span><strong>Confidence:</strong> {usedConfig.minConfidence}%</span>
                <span><strong>Volume Spike:</strong> {usedConfig.requireVolumeSpike ? 'Yes' : 'No'}</span>
                <span><strong>Trend Align:</strong> {usedConfig.requireTrendAlignment ? 'Yes' : 'No'}</span>
                <span><strong>RSI Signal:</strong> {usedConfig.requireRsiSignal ? 'Yes' : 'No'}</span>
              </div>
            </div>
          )}

          {/* OPTIMIZER vs ACTUAL COMPARISON */}
          {optimizerPrediction && analysis && (
            <div
              style={{
                marginBottom: theme.spacing.md,
                padding: theme.spacing.sm,
                backgroundColor: '#fef3c7',
                borderRadius: theme.borderRadius.md,
                border: '1px solid #f59e0b',
                fontSize: theme.typography.fontSize.sm,
              }}
            >
              <div style={{ fontWeight: 'bold', color: '#92400e', marginBottom: '8px' }}>
                ⚠️ Optimizer vs Actual Comparison:
              </div>
              <table style={{ width: '100%', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f59e0b' }}>
                    <th style={{ textAlign: 'left', padding: '4px' }}>Metric</th>
                    <th style={{ textAlign: 'right', padding: '4px' }}>Predicted</th>
                    <th style={{ textAlign: 'right', padding: '4px' }}>Actual</th>
                    <th style={{ textAlign: 'right', padding: '4px' }}>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px' }}>Return %</td>
                    <td style={{ textAlign: 'right', padding: '4px', color: '#16a34a' }}>+{optimizerPrediction.returnPercent.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '4px', color: analysis.returnPercent >= 0 ? '#16a34a' : '#dc2626' }}>{analysis.returnPercent >= 0 ? '+' : ''}{analysis.returnPercent.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '4px', color: '#dc2626', fontWeight: 'bold' }}>{(analysis.returnPercent - optimizerPrediction.returnPercent).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>P&L</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>${optimizerPrediction.totalPnL.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>${analysis.totalPnL?.toFixed(0) || realizedPnL.toFixed(0)}</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>${((analysis.totalPnL || realizedPnL) - optimizerPrediction.totalPnL).toFixed(0)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>Trades</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>{optimizerPrediction.numTrades}</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>{analysis.totalTrades}</td>
                    <td style={{ textAlign: 'right', padding: '4px', color: analysis.totalTrades !== optimizerPrediction.numTrades ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}>{analysis.totalTrades - optimizerPrediction.numTrades}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px' }}>Win Rate</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>{optimizerPrediction.winRate.toFixed(0)}%</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>{analysis.winRate?.toFixed(0) || 0}%</td>
                    <td style={{ textAlign: 'right', padding: '4px' }}>{((analysis.winRate || 0) - optimizerPrediction.winRate).toFixed(0)}%</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: '8px' }}>
                <button
                  onClick={() => setShowDebugLog(!showDebugLog)}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: '#f59e0b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  {showDebugLog ? 'Hide' : 'Show'} Debug Log ({debugLog.length} entries)
                </button>
              </div>
            </div>
          )}

          {/* DEBUG LOG PANEL */}
          {showDebugLog && debugLog.length > 0 && (
            <div
              style={{
                marginBottom: theme.spacing.md,
                padding: theme.spacing.sm,
                backgroundColor: '#1e1e1e',
                borderRadius: theme.borderRadius.md,
                maxHeight: '400px',
                overflow: 'auto',
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#d4d4d4',
              }}
            >
              <div style={{ marginBottom: '8px', color: '#4ec9b0', fontWeight: 'bold' }}>
                Full Simulation Decision Log ({debugLog.length} trades):
              </div>
              {debugLog.map((entry, idx) => (
                <div key={idx} style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
                  <div style={{ color: entry.type === 'BUY' ? '#4ec9b0' : '#ce9178' }}>
                    #{idx + 1} {entry.type} @ ${entry.price?.toFixed(2)} (idx: {entry.index})
                  </div>
                  {entry.type === 'BUY' ? (
                    <div style={{ color: '#9cdcfe', marginLeft: '12px' }}>
                      signals: {entry.signalCount}/{entry.minSignalsRequired} | conf: {entry.confidence}%/{entry.minConfidence}% |
                      RSI:{entry.indicators?.rsi?.toFixed(0)} | VWAP:{entry.indicators?.vwap?.toFixed(2)} | Vol:{entry.indicators?.volumeRatio?.toFixed(1)}x
                      <br/>
                      strategy: {entry.entryStrategy} | meetsReq: {entry.meetsRequirements ? 'Y' : 'N'} |
                      reqVol: {entry.requireVolumeSpike ? 'Y' : 'N'}({entry.hasVolumeSpike ? '✓' : '✗'}) |
                      reqTrend: {entry.requireTrendAlign ? 'Y' : 'N'}({entry.hasTrendSignal ? '✓' : '✗'}) |
                      reqRSI: {entry.requireRsiSignal ? 'Y' : 'N'}({entry.hasRsiSignal ? '✓' : '✗'})
                      <br/>
                      <span style={{ color: '#6a9955' }}>reasons: {entry.reasons?.join(', ')}</span>
                    </div>
                  ) : (
                    <div style={{ color: '#9cdcfe', marginLeft: '12px' }}>
                      entry: ${entry.entryPrice?.toFixed(2)} | pnl: {entry.pnlPercent?.toFixed(2)}% |
                      sellScore: {entry.sellScore} | conf: {entry.confidence}%/{entry.minConfidence}%
                      <br/>
                      TP: {entry.profitTargetPercent}% | SL: {entry.stopLossPercent}% | RSI: {entry.indicators?.rsi?.toFixed(0)} | hour: {entry.estHour?.toFixed(2)}
                      <br/>
                      <span style={{ color: '#6a9955' }}>reasons: {entry.reasons?.join(', ')}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: theme.spacing.md,
              marginBottom: theme.spacing.lg,
            }}
          >
            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor:
                  analysis.returnPercent >= 0
                    ? `${theme.colors.success}10`
                    : `${theme.colors.error}10`,
                borderRadius: theme.borderRadius.md,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Return
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    analysis.returnPercent >= 0
                      ? theme.colors.success
                      : theme.colors.error,
                }}
              >
                {analysis.returnPercent >= 0 ? '+' : ''}
                {analysis.returnPercent.toFixed(2)}%
              </div>
            </div>

            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Win Rate
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    analysis.winRate >= 50
                      ? theme.colors.success
                      : theme.colors.warning,
                }}
              >
                {analysis.winRate.toFixed(0)}%
              </div>
            </div>

            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Trades
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                }}
              >
                {analysis.totalTrades}
              </div>
            </div>

            <div
              style={{
                padding: theme.spacing.md,
                backgroundColor: theme.colors.gray50,
                borderRadius: theme.borderRadius.md,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.gray600,
                }}
              >
                Stock %
              </div>
              <div
                style={{
                  fontSize: theme.typography.fontSize.xxl,
                  fontWeight: theme.typography.fontWeight.bold,
                  color:
                    analysis.priceChangePercent >= 0
                      ? theme.colors.success
                      : theme.colors.error,
                }}
              >
                {analysis.priceChangePercent >= 0 ? '+' : ''}
                {analysis.priceChangePercent.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Feedback */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: theme.spacing.md,
            }}
          >
            {analysis.positives.length > 0 && (
              <div
                style={{
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.success}08`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.success}30`,
                }}
              >
                <h5
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.sm,
                    color: theme.colors.success,
                  }}
                >
                  Positives
                </h5>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: theme.spacing.md,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  {analysis.positives.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.negatives.length > 0 && (
              <div
                style={{
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.error}08`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.error}30`,
                }}
              >
                <h5
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.sm,
                    color: theme.colors.error,
                  }}
                >
                  Concerns
                </h5>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: theme.spacing.md,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  {analysis.negatives.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.improvements.length > 0 && (
              <div
                style={{
                  padding: theme.spacing.md,
                  backgroundColor: `${theme.colors.info}08`,
                  borderRadius: theme.borderRadius.md,
                  border: `1px solid ${theme.colors.info}30`,
                }}
              >
                <h5
                  style={{
                    margin: 0,
                    marginBottom: theme.spacing.sm,
                    color: theme.colors.info,
                  }}
                >
                  Improvements
                </h5>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: theme.spacing.md,
                    fontSize: theme.typography.fontSize.sm,
                  }}
                >
                  {analysis.improvements.map((imp, i) => (
                    <li key={i}>{imp}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* AI RECOMMENDATIONS - Specific config adjustments with Apply buttons */}
          {recommendations.length > 0 && (
            <div
              style={{
                marginTop: theme.spacing.lg,
                padding: theme.spacing.md,
                backgroundColor: '#fef3c7',
                borderRadius: theme.borderRadius.md,
                border: `2px solid #f59e0b`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.md }}>
                <h4 style={{ margin: 0, color: '#92400e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ⚡ Recommended Optimizations
                  <span style={{
                    fontSize: theme.typography.fontSize.xs,
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    padding: '2px 8px',
                    borderRadius: '10px',
                  }}>
                    {recommendations.length} suggestions
                  </span>
                </h4>
                <Button
                  size="small"
                  variant="primary"
                  onClick={applyAllRecommendations}
                  style={{ backgroundColor: '#22c55e', border: 'none' }}
                >
                  ✨ Apply All Optimizations
                </Button>
              </div>
              <div style={{ display: 'grid', gap: theme.spacing.md }}>
                {recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    style={{
                      padding: theme.spacing.md,
                      backgroundColor: rec.priority === 'high' ? '#fef9c3' : theme.colors.surface,
                      borderRadius: theme.borderRadius.md,
                      border: rec.priority === 'high' ? `2px solid #eab308` : `1px solid ${theme.colors.gray200}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <h5 style={{ margin: 0, marginBottom: theme.spacing.xs, color: theme.colors.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {rec.title}
                          {rec.priority === 'high' && (
                            <span style={{
                              fontSize: '10px',
                              backgroundColor: '#ef4444',
                              color: '#fff',
                              padding: '2px 6px',
                              borderRadius: '4px',
                            }}>
                              HIGH IMPACT
                            </span>
                          )}
                        </h5>
                        <p style={{ margin: 0, marginBottom: theme.spacing.sm, color: theme.colors.gray600, fontSize: theme.typography.fontSize.sm }}>
                          {rec.description}
                        </p>
                        <div style={{ display: 'flex', gap: theme.spacing.lg, fontSize: theme.typography.fontSize.sm, flexWrap: 'wrap' }}>
                          <span style={{ color: theme.colors.error }}>
                            <strong>Current:</strong> {typeof rec.currentValue === 'boolean' ? (rec.currentValue ? 'Yes' : 'No') : rec.currentValue}
                            {typeof rec.currentValue === 'number' && (rec.field.includes('Percent') || rec.field.includes('Confidence')) ? '%' : ''}
                          </span>
                          <span style={{ color: theme.colors.success }}>
                            <strong>→ Suggested:</strong> {typeof rec.suggestedValue === 'boolean' ? (rec.suggestedValue ? 'Yes' : 'No') : (typeof rec.suggestedValue === 'number' ? rec.suggestedValue.toFixed(2) : rec.suggestedValue)}
                            {typeof rec.suggestedValue === 'number' && (rec.field.includes('Percent') || rec.field.includes('Confidence')) ? '%' : ''}
                          </span>
                          <span style={{ color: '#8b5cf6' }}>
                            <strong>Impact:</strong> {rec.impact}
                          </span>
                        </div>
                      </div>
                      <Button
                        size="small"
                        variant="primary"
                        onClick={() => applyRecommendation(rec)}
                        style={{ marginLeft: theme.spacing.md }}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ margin: 0, marginTop: theme.spacing.md, color: '#92400e', fontSize: theme.typography.fontSize.xs }}>
                💡 Click "Apply All Optimizations" to apply all suggestions, then re-run the simulation to see improvements.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export default TradingSimulator;
