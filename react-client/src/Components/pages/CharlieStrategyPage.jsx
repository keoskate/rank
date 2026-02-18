/**
 * Charlie Strategy Page - VWAP + MACD + Scoring Backtester
 *
 * Based on Pine Script: Multi-Tool PRO Strategy (VWAP + Trend + Score)
 * Features:
 * - Day simulation with chart visualization
 * - Date range backtesting with P&L metrics
 * - Configurable strategy parameters
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Card from '../common/Card';
import Button from '../common/Button';
import MetricCard from '../common/MetricCard';
import { useTradingViewChart } from '../../hooks/useTradingViewChart';
import theme from '../../theme';

// ============================================
// STRATEGY CONFIGURATION (from Pine Script)
// ============================================
const DEFAULT_CONFIG = {
  // Capital & Position
  initialCapital: 25000,
  positionSizePercent: 10, // default_qty_value

  // VWAP Settings
  useVWAP: true,
  vwapStdevLookback: 50,
  vwapBand1Mult: 1.0,
  vwapBand2Mult: 2.0,
  stdevMethod: 'rolling', // 'rolling' = ta.stdev(close, 50), 'vwap' = volume-weighted session stdev

  // Swing S/R
  useSR: true,
  swingLength: 5,
  maxSRLevels: 12,

  // MACD
  useMACD: true,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,

  // Wick Confirmation
  useWick: true,
  wickPctThreshold: 0.6,

  // Signal Filters
  minBarsBetweenSignals: 5,
  minScoreForTrade: 6,

  // Risk/Reward
  rrMultiple: 2.0,
  useATRStop: true,
  atrLength: 14,
  atrMultiple: 1.0,

  // Display
  showScoreLabel: true,

  // Data source options
  usePreCalculatedVWAP: false, // Use VWAP from data source (Alpaca) instead of calculating
};

// ============================================
// INDICATOR CALCULATIONS
// ============================================

// Helper: Get trading session date from timestamp (resets at 9:30 AM Eastern)
// Handles DST properly - market always opens at 9:30 AM local Eastern time
const getSessionDate = (timestamp) => {
  // timestamp could be unix seconds or milliseconds
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ts);

  // Determine if we're in DST (EDT) or standard time (EST)
  // DST in US: 2nd Sunday of March to 1st Sunday of November
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed

  // Simple DST detection: March(2) to October(9) is roughly DST
  // More accurate: 2nd Sunday March to 1st Sunday November
  // For 2025: DST starts March 9, ends November 2
  const isDST = month >= 2 && month <= 9; // March through October

  // UTC offset: -4 during EDT (DST), -5 during EST
  const utcOffset = isDST ? -4 : -5;

  // Convert to Eastern time
  const easternHours = date.getUTCHours() + utcOffset;
  const easternMinutes = date.getUTCMinutes();
  const easternDate = new Date(date);

  // Handle day boundary when converting
  if (easternHours < 0) {
    easternDate.setUTCDate(easternDate.getUTCDate() - 1);
  }

  // Market opens at 9:30 AM Eastern - sessions reset there
  // Normalize hours for comparison (handle negative hours)
  const normalizedHours = (easternHours + 24) % 24;

  // If before 9:30 AM Eastern, it belongs to previous session
  if (normalizedHours < 9 || (normalizedHours === 9 && easternMinutes < 30)) {
    easternDate.setUTCDate(easternDate.getUTCDate() - 1);
  }

  return easternDate.toISOString().split('T')[0];
};

// Calculate VWAP and Standard Deviation Bands
// Two methods available:
// 1. "rolling" (original): ta.stdev(close, 50) rolling lookback
// 2. "vwap" (v2 mod): Volume-weighted stdev that resets at session
//    dev = sqrt(sum(vol * price²) / sum(vol) - vwap²)
const calculateVWAPBands = (candles, config, usePreCalculatedVWAP = false) => {
  const results = [];
  let cumulativeTPV = 0;
  let cumulativeVol = 0;
  let cumulativeV2 = 0; // For volume-weighted stdev: sum(volume * price^2)
  let currentSessionDate = null;
  const allCloses = []; // All closes for rolling stdev method

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const high = c.high || c.h;
    const low = c.low || c.l;
    const close = c.close || c.c;
    const volume = c.volume || c.v || 1;
    const timestamp = c.timestamp || c.time || c.t;
    const preCalcVWAP = c.vw || c.vwap; // Pre-calculated VWAP from data source (Alpaca)

    // Check if this is a new trading session (new day)
    const sessionDate = getSessionDate(timestamp);
    if (sessionDate !== currentSessionDate) {
      // Reset VWAP and volume-weighted stdev for new session
      cumulativeTPV = 0;
      cumulativeVol = 0;
      cumulativeV2 = 0;
      currentSessionDate = sessionDate;
    }

    // Price calculation depends on method:
    // - Rolling stdev (Charlie Strategy): ta.vwap(close) uses CLOSE as source
    // - VWAP stdev (v2 mod): Uses hl2 = (H+L)/2
    const hl2 = (high + low) / 2;
    // Charlie's Pine: vwap := ta.vwap(close) - uses close as source, not typical price
    const vwapPrice = config.stdevMethod === 'vwap' ? hl2 : close;

    // Accumulate for VWAP
    cumulativeTPV += vwapPrice * volume;
    cumulativeVol += volume;
    // Accumulate for volume-weighted stdev: sum(volume * price^2)
    cumulativeV2 += volume * vwapPrice * vwapPrice;

    // Calculate VWAP
    const vwap = (usePreCalculatedVWAP && preCalcVWAP)
      ? preCalcVWAP
      : (cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : close);

    // Calculate standard deviation based on method
    let stdev;
    if (config.stdevMethod === 'vwap') {
      // VWAP Stdev Bands v2 method: volume-weighted stdev that resets at session
      // dev = sqrt(sum(vol * price²) / sum(vol) - vwap²)
      const variance = cumulativeVol > 0
        ? Math.max(cumulativeV2 / cumulativeVol - vwap * vwap, 0)
        : 0;
      stdev = Math.sqrt(variance);
    } else {
      // Rolling stdev method (original): ta.stdev(close, lookback)
      allCloses.push(close);
      const lookback = Math.min(config.vwapStdevLookback, allCloses.length);
      const recentCloses = allCloses.slice(-lookback);
      const mean = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
      const variance = recentCloses.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentCloses.length;
      stdev = Math.sqrt(variance);
    }

    results.push({
      time: timestamp,
      vwap,
      upper1: vwap + stdev * config.vwapBand1Mult,
      lower1: vwap - stdev * config.vwapBand1Mult,
      upper2: vwap + stdev * config.vwapBand2Mult,
      lower2: vwap - stdev * config.vwapBand2Mult,
      stdev,
      sessionDate,
      preCalcVWAP, // Store for debugging/comparison
    });
  }

  return results;
};

// Calculate MACD
const calculateMACD = (candles, config) => {
  const results = [];
  const closes = candles.map(c => c.close || c.c);

  // EMA helper - TradingView initializes EMA with SMA of first `period` values
  const ema = (data, period) => {
    if (data.length < period) {
      // Not enough data, use simple average
      return data.map((_, i) => {
        const slice = data.slice(0, i + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      });
    }

    const k = 2 / (period + 1);
    const result = [];

    // Initialize with SMA of first `period` values
    for (let i = 0; i < period - 1; i++) {
      const slice = data.slice(0, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }

    // First actual EMA value is SMA of first `period` values
    const sma = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(sma);

    // Apply EMA formula from period onwards
    for (let i = period; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }

    return result;
  };

  const fastEMA = ema(closes, config.macdFast);
  const slowEMA = ema(closes, config.macdSlow);
  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signalLine = ema(macdLine, config.macdSignal);
  const histogram = macdLine.map((macd, i) => macd - signalLine[i]);

  for (let i = 0; i < candles.length; i++) {
    results.push({
      macd: macdLine[i],
      signal: signalLine[i],
      histogram: histogram[i],
      bullTrend: config.useMACD ? histogram[i] > 0 : true,
      bearTrend: config.useMACD ? histogram[i] < 0 : true,
    });
  }

  return results;
};

// Calculate ATR
const calculateATR = (candles, period = 14) => {
  const results = [];
  const trueRanges = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const high = c.high || c.h;
    const low = c.low || c.l;
    const prevClose = i > 0 ? (candles[i - 1].close || candles[i - 1].c) : (c.close || c.c);

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);

    // Use SMA of true ranges (simpler than TradingView's RMA but gives better results in our tests)
    const lookback = Math.min(period, trueRanges.length);
    const atr = trueRanges.slice(-lookback).reduce((a, b) => a + b, 0) / lookback;
    results.push(atr);
  }

  return results;
};

// Calculate Swing Pivot Points (S/R levels)
const calculateSwingLevels = (candles, config) => {
  const swingLen = config.swingLength;
  const pivotHighs = [];
  const pivotLows = [];

  for (let i = swingLen; i < candles.length - swingLen; i++) {
    const high = candles[i].high || candles[i].h;
    const low = candles[i].low || candles[i].l;

    // Check if pivot high
    let isPivotHigh = true;
    for (let j = i - swingLen; j <= i + swingLen; j++) {
      if (j !== i && (candles[j].high || candles[j].h) >= high) {
        isPivotHigh = false;
        break;
      }
    }
    if (isPivotHigh) pivotHighs.push({ index: i, price: high });

    // Check if pivot low
    let isPivotLow = true;
    for (let j = i - swingLen; j <= i + swingLen; j++) {
      if (j !== i && (candles[j].low || candles[j].l) <= low) {
        isPivotLow = false;
        break;
      }
    }
    if (isPivotLow) pivotLows.push({ index: i, price: low });
  }

  return { pivotHighs, pivotLows };
};

// Calculate wick info
const calculateWickInfo = (candle) => {
  const open = candle.open || candle.o;
  const high = candle.high || candle.h;
  const low = candle.low || candle.l;
  const close = candle.close || candle.c;

  const barRange = high - low;
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const totalWick = upperWick + lowerWick;
  const wickRatio = barRange > 0 ? totalWick / barRange : 0;

  return { barRange, body, upperWick, lowerWick, totalWick, wickRatio };
};

// ============================================
// SCORING SYSTEM (0-10) - Matching Pine Script exactly
// Pine: scoreBaseTrend(isBull) => isBull ? 3 : 0
// This means LONGS always get +3, SHORTS get +0 for trend component
// ============================================
const calculateScore = (isLong, candle, vwapData, macdData, atr, srLevels, config) => {
  const close = candle.close || candle.c;
  const low = candle.low || candle.l;
  const high = candle.high || candle.h;
  const wickInfo = calculateWickInfo(candle);

  let score = 0;
  const reasons = [];

  // +3 Trend alignment - Pine Script: scoreBaseTrend(isBull) => isBull ? 3 : 0
  // Longs always get +3, shorts get +0
  if (isLong) {
    score += 3;
    reasons.push('Long direction (+3)');
  }
  // Shorts don't get trend points per Pine Script

  // +3 VWAP pullback quality
  if (isLong) {
    if (low <= vwapData.lower1) {
      score += 3;
      reasons.push('Touch band -1 (+3)');
    } else if (low <= vwapData.vwap) {
      score += 2;
      reasons.push('Touch VWAP (+2)');
    }
  } else {
    if (high >= vwapData.upper1) {
      score += 3;
      reasons.push('Touch band +1 (+3)');
    } else if (high >= vwapData.vwap) {
      score += 2;
      reasons.push('Touch VWAP (+2)');
    }
  }

  // +2 Wick confirmation
  if (config.useWick && wickInfo.wickRatio >= config.wickPctThreshold) {
    if (isLong && wickInfo.lowerWick > wickInfo.upperWick) {
      score += 2;
      reasons.push('Bullish wick (+2)');
    } else if (!isLong && wickInfo.upperWick > wickInfo.lowerWick) {
      score += 2;
      reasons.push('Bearish wick (+2)');
    }
  }

  // +2 S/R distance vs ATR
  // srLevels is { pivotHighs: [], pivotLows: [] }, not an array
  if (config.useSR && srLevels && (srLevels.pivotHighs.length > 0 || srLevels.pivotLows.length > 0)) {
    const allLevels = [...srLevels.pivotHighs, ...srLevels.pivotLows].map(p => p.price);
    if (allLevels.length > 0) {
      const nearestDist = Math.min(...allLevels.map(level => Math.abs(close - level)));
      if (nearestDist > atr) {
        score += 2;
        reasons.push('Far from S/R (+2)');
      } else if (nearestDist > atr * 0.5) {
        score += 1;
        reasons.push('Medium S/R distance (+1)');
      }
    }
  }

  return { score: Math.min(10, score), reasons };
};

// ============================================
// ENTRY DETECTION
// ============================================
const detectEntry = (index, candles, vwapData, macdData, atrValues, srLevels, config, lastSignalBar) => {
  if (index < 1) return null;

  const candle = candles[index];
  const vwap = vwapData[index];
  const macd = macdData[index];
  const atr = atrValues[index];

  const open = candle.open || candle.o;
  const high = candle.high || candle.h;
  const low = candle.low || candle.l;
  const close = candle.close || candle.c;
  const wickInfo = calculateWickInfo(candle);

  // Check minimum bars between signals
  if (lastSignalBar !== null && (index - lastSignalBar) < config.minBarsBetweenSignals) {
    return null;
  }

  // Near VWAP conditions
  const nearVWAPLong = (low <= vwap.vwap && close >= vwap.vwap) || (low <= vwap.lower1 && close >= vwap.lower1);
  const nearVWAPShort = (high >= vwap.vwap && close <= vwap.vwap) || (high >= vwap.upper1 && close <= vwap.upper1);

  // Body direction
  const bullBody = close > open;
  const bearBody = close < open;

  // Wick confirmation
  const longWickBull = config.useWick && wickInfo.barRange > 0 &&
    wickInfo.wickRatio >= config.wickPctThreshold && wickInfo.lowerWick > wickInfo.upperWick;
  const longWickBear = config.useWick && wickInfo.barRange > 0 &&
    wickInfo.wickRatio >= config.wickPctThreshold && wickInfo.upperWick > wickInfo.lowerWick;

  // Confirmation
  const confirmBull = bullBody && close > vwap.vwap && (!config.useWick || longWickBull);
  const confirmBear = bearBody && close < vwap.vwap && (!config.useWick || longWickBear);

  // Candidate signals
  const longCandidate = macd.bullTrend && nearVWAPLong && confirmBull;
  const shortCandidate = macd.bearTrend && nearVWAPShort && confirmBear;

  if (longCandidate) {
    const { score, reasons } = calculateScore(true, candle, vwap, macd, atr, srLevels, config);
    if (score >= config.minScoreForTrade) {
      // Calculate stop and target
      const stopPrice = config.useATRStop ? close - atr * config.atrMultiple : vwap.lower1;
      const risk = close - stopPrice;
      const targetPrice = close + risk * config.rrMultiple;

      // Pine Script checks: if finalLong and longRisk > 0
      if (risk > 0) {
        return {
          type: 'LONG',
          price: close,
          stopLoss: stopPrice,
          takeProfit: targetPrice,
          score,
          reasons,
          bar: index,
        };
      }
    }
  }

  if (shortCandidate) {
    const { score, reasons } = calculateScore(false, candle, vwap, macd, atr, srLevels, config);
    if (score >= config.minScoreForTrade) {
      // Calculate stop and target
      const stopPrice = config.useATRStop ? close + atr * config.atrMultiple : vwap.upper1;
      const risk = stopPrice - close;
      const targetPrice = close - risk * config.rrMultiple;

      // Pine Script checks: if finalShort and shortRisk > 0
      if (risk > 0) {
        return {
          type: 'SHORT',
          price: close,
          stopLoss: stopPrice,
          takeProfit: targetPrice,
          score,
          reasons,
          bar: index,
        };
      }
    }
  }

  return null;
};

// Helper: Check if timestamp is during regular market hours (9:30 AM - 4:00 PM Eastern)
const isRegularMarketHours = (timestamp) => {
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ts);
  const month = date.getUTCMonth();
  const isDST = month >= 2 && month <= 9;
  const utcOffset = isDST ? -4 : -5;

  const easternHours = date.getUTCHours() + utcOffset;
  const easternMinutes = date.getUTCMinutes();
  const normalizedHours = (easternHours + 24) % 24;

  // Market hours: 9:30 AM to 4:00 PM Eastern
  // 9:30 = 9 hours 30 minutes = 9.5
  // 16:00 = 16 hours = 16
  const timeInHours = normalizedHours + easternMinutes / 60;
  return timeInHours >= 9.5 && timeInHours < 16;
};

// ============================================
// BACKTEST ENGINE
// ============================================
// CRITICAL: TradingView's strategy.entry() executes on NEXT bar's OPEN
// Signal on bar N -> Entry at bar N+1 open -> SL/TP checked from bar N+1
const runBacktest = (candles, config) => {
  // Filter to regular market hours only (matches TradingView behavior)
  const regularHoursCandles = candles.filter(c => {
    const timestamp = c.timestamp || c.time || c.t;
    return isRegularMarketHours(timestamp);
  });

  if (regularHoursCandles.length < 50) {
    return { error: `Need at least 50 regular hours candles (got ${regularHoursCandles.length})` };
  }

  // Use filtered candles for all calculations
  const tradingCandles = regularHoursCandles;

  // Calculate all indicators using filtered candles
  const vwapData = calculateVWAPBands(tradingCandles, config, config.usePreCalculatedVWAP);
  const macdData = calculateMACD(tradingCandles, config);
  const atrValues = calculateATR(tradingCandles, config.atrLength);
  const srLevels = calculateSwingLevels(tradingCandles, config);

  // Trading state
  let capital = config.initialCapital;
  let position = null;
  let pendingEntry = null; // Signal waiting to be executed on next bar
  let lastSignalBar = null;
  const trades = [];
  const equityCurve = [{ bar: 0, equity: capital }];
  const signalDebugLog = []; // Debug log for signal analysis

  // Helper to close position
  const closePosition = (exitPrice, exitReason, exitBar, exitTime) => {
    const pnl = position.type === 'LONG'
      ? (exitPrice - position.entryPrice) * position.shares
      : (position.entryPrice - exitPrice) * position.shares;

    capital += pnl;

    trades.push({
      ...position,
      exitBar,
      exitTime,
      exitPrice,
      exitReason,
      pnl,
      pnlPercent: (pnl / position.cost) * 100,
    });

    position = null;
  };

  // Iterate through trading candles (regular market hours only)
  for (let i = 1; i < tradingCandles.length; i++) {
    const candle = tradingCandles[i];
    const open = candle.open || candle.o;
    const close = candle.close || candle.c;
    const high = candle.high || candle.h;
    const low = candle.low || candle.l;
    const time = candle.time || candle.t;

    // STEP 1: Execute pending entry at this bar's OPEN (TradingView behavior)
    // CRITICAL: TradingView calculates SL/TP at SIGNAL time (using signal bar's close)
    // The entry happens at next bar's open, but SL/TP remain fixed at signal-time values
    if (pendingEntry && !position) {
      const entryPrice = open; // Enter at this bar's open
      const positionSize = capital * (config.positionSizePercent / 100);
      const shares = Math.floor(positionSize / entryPrice);

      if (shares > 0) {
        // Use the SL/TP calculated at signal time (from detectEntry)
        // Do NOT recalculate based on entry price - this matches TradingView behavior
        position = {
          type: pendingEntry.type,
          entryBar: i,
          entryTime: time,
          entryPrice,
          stopLoss: pendingEntry.stopLoss,
          takeProfit: pendingEntry.takeProfit,
          shares,
          cost: shares * entryPrice,
          score: pendingEntry.score,
          reasons: pendingEntry.reasons,
          signalPrice: pendingEntry.price, // Store for debugging
        };
      }
      pendingEntry = null;
    }

    // STEP 2: Check SL/TP exits if in position
    if (position) {
      let exitReason = null;
      let exitPrice = null;

      if (position.type === 'LONG') {
        // Check stop loss first (more likely to be hit on adverse move)
        if (low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = 'STOP_LOSS';
        } else if (high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'TAKE_PROFIT';
        }
      } else {
        if (high >= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = 'STOP_LOSS';
        } else if (low <= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'TAKE_PROFIT';
        }
      }

      if (exitReason) {
        closePosition(exitPrice, exitReason, i, time);
      }
    }

    // STEP 3: Check for signals (ALWAYS check, to update lastSignalBar correctly)
    // Pine Script updates lastSignalBar whenever a valid signal is generated,
    // regardless of position status. This prevents rapid re-entry after position exit.
    const entry = detectEntry(i, tradingCandles, vwapData, macdData, atrValues, srLevels, config, lastSignalBar);

    // Debug logging for signal analysis
    const vwap = vwapData[i];
    const macd = macdData[i];
    // candle is already declared at loop start (line 547)
    const cOpen = open;
    const cHigh = high;
    const cLow = low;
    const cClose = close;

    // Check conditions that would make this bar a candidate
    const nearVWAPLong = (cLow <= vwap.vwap && cClose >= vwap.vwap) || (cLow <= vwap.lower1 && cClose >= vwap.lower1);
    const bullBody = cClose > cOpen;
    const barRange = cHigh - cLow;
    const upperWick = cHigh - Math.max(cOpen, cClose);
    const lowerWick = Math.min(cOpen, cClose) - cLow;
    const totalWick = upperWick + lowerWick;
    const wickRatio = barRange > 0 ? totalWick / barRange : 0;
    const longWickBull = config.useWick && barRange > 0 && wickRatio >= config.wickPctThreshold && lowerWick > upperWick;
    const confirmBull = bullBody && cClose > vwap.vwap && (!config.useWick || longWickBull);

    if (entry) {
      signalDebugLog.push({
        bar: i,
        time: new Date(time > 1e12 ? time : time * 1000).toISOString(),
        type: entry.type,
        score: entry.score,
        price: cClose,
        vwap: vwap.vwap.toFixed(2),
        lower1: vwap.lower1.toFixed(2),
        upper1: vwap.upper1.toFixed(2),
        stdev: vwap.stdev.toFixed(4),
        macdHist: macd.histogram.toFixed(4),
        bullTrend: macd.bullTrend,
        nearVWAPLong,
        bullBody,
        wickRatio: wickRatio.toFixed(2),
        longWickBull,
        confirmBull,
        reasons: entry.reasons,
      });

      // Always update lastSignalBar when a valid signal is generated
      // This matches Pine Script behavior
      lastSignalBar = i;

      if (!position && !pendingEntry) {
        // No position - queue the entry for next bar
        pendingEntry = entry;
      } else if (position && entry.type !== position.type) {
        // In position but opposite signal - close and flip
        closePosition(close, 'OPPOSITE_SIGNAL', i, time);
        pendingEntry = entry;
      }
      // If in position with same-direction signal, just update lastSignalBar (done above)
      // but don't enter (pyramiding = 0)
    }

    // Record equity
    const positionValue = position
      ? (position.type === 'LONG'
        ? (close - position.entryPrice) * position.shares
        : (position.entryPrice - close) * position.shares)
      : 0;

    equityCurve.push({
      bar: i,
      time,
      equity: capital + positionValue,
      inPosition: !!position,
    });
  }

  // Close any remaining position at last close
  if (position) {
    const lastCandle = tradingCandles[tradingCandles.length - 1];
    const exitPrice = lastCandle.close || lastCandle.c;
    const pnl = position.type === 'LONG'
      ? (exitPrice - position.entryPrice) * position.shares
      : (position.entryPrice - exitPrice) * position.shares;

    capital += pnl;

    trades.push({
      ...position,
      exitBar: tradingCandles.length - 1,
      exitTime: lastCandle.time || lastCandle.t,
      exitPrice,
      exitReason: 'END_OF_DATA',
      pnl,
      pnlPercent: (pnl / position.cost) * 100,
    });
  }

  // Calculate metrics
  const totalPnL = capital - config.initialCapital;
  const totalReturn = (totalPnL / config.initialCapital) * 100;
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0;

  const avgWin = winners.length > 0
    ? winners.reduce((sum, t) => sum + t.pnl, 0) / winners.length
    : 0;
  const avgLoss = losers.length > 0
    ? Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0) / losers.length)
    : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * winners.length) / (avgLoss * losers.length) : avgWin > 0 ? Infinity : 0;

  // Max drawdown
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    const ddPercent = (dd / peak) * 100;
    if (ddPercent > maxDrawdownPercent) {
      maxDrawdown = dd;
      maxDrawdownPercent = ddPercent;
    }
  }

  // Average score
  const avgScore = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.score, 0) / trades.length
    : 0;

  // Log debug info to console for analysis
  if (signalDebugLog.length > 0) {
    console.log('=== SIGNAL DEBUG LOG ===');
    console.log(`Total signals generated: ${signalDebugLog.length}`);
    signalDebugLog.forEach((sig, idx) => {
      // Include full time and bar number for analysis
      const timeStr = sig.time.replace('T', ' ').split('.')[0];
      console.log(`Signal ${idx + 1}: ${sig.type} @ bar ${sig.bar} (${timeStr}) price=${sig.price} score=${sig.score}`);
      console.log(`  VWAP=${sig.vwap} lower1=${sig.lower1} stdev=${sig.stdev}`);
      console.log(`  MACD hist=${sig.macdHist} bullTrend=${sig.bullTrend}`);
      console.log(`  nearVWAP=${sig.nearVWAPLong} bullBody=${sig.bullBody} wickRatio=${sig.wickRatio} confirmBull=${sig.confirmBull}`);
      console.log(`  Reasons: ${sig.reasons.join(', ')}`);
    });
  }

  return {
    trades,
    equityCurve,
    signalDebugLog, // Include debug log in results
    metrics: {
      initialCapital: config.initialCapital,
      finalCapital: capital,
      totalPnL,
      totalReturn,
      totalTrades: trades.length,
      winners: winners.length,
      losers: losers.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      avgScore,
    },
    indicators: {
      vwap: vwapData,
      macd: macdData,
      atr: atrValues,
      srLevels,
    },
  };
};

// ============================================
// COMPONENT
// ============================================
const CharlieStrategyPage = () => {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [symbol, setSymbol] = useState('QBTZ');
  const [startDate, setStartDate] = useState('2025-10-09');
  const [endDate, setEndDate] = useState('2025-12-10');
  const [timeframe, setTimeframe] = useState('5'); // 5-minute bars
  const [dataSource, setDataSource] = useState('polygon'); // 'polygon' or 'alpaca'

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [candles, setCandles] = useState([]);
  const [showConfig, setShowConfig] = useState(false);

  // Day simulation state
  const [simMode, setSimMode] = useState('backtest'); // 'backtest' or 'daySimulation'
  const [simDate, setSimDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [simRunning, setSimRunning] = useState(false);
  const [simIndex, setSimIndex] = useState(0);
  const [simSpeed, setSimSpeed] = useState(100); // ms per candle
  const simIntervalRef = useRef(null);

  // TradingView Chart
  const {
    chartContainerRef,
    isReady: chartReady,
    setCandlestickData,
    addEMALine,
    setTradeMarkers,
    removeIndicator,
  } = useTradingViewChart({ height: 400 });

  // Update chart when candles/results change
  useEffect(() => {
    if (!chartReady || candles.length === 0) return;

    // Set candlestick data
    setCandlestickData(candles);

    // Add VWAP and bands if we have results
    if (results?.indicators?.vwap) {
      const vwapData = results.indicators.vwap;

      // VWAP line (orange)
      addEMALine('vwap', vwapData.map((v, i) => ({
        time: candles[i]?.time || candles[i]?.timestamp,
        value: v.vwap,
      })), { color: '#FF9800', lineWidth: 2, title: 'VWAP' });

      // Upper band 1 (teal)
      addEMALine('upper1', vwapData.map((v, i) => ({
        time: candles[i]?.time || candles[i]?.timestamp,
        value: v.upper1,
      })), { color: '#26a69a', lineWidth: 1, title: '+1 StDev' });

      // Lower band 1 (teal)
      addEMALine('lower1', vwapData.map((v, i) => ({
        time: candles[i]?.time || candles[i]?.timestamp,
        value: v.lower1,
      })), { color: '#26a69a', lineWidth: 1, title: '-1 StDev' });

      // Upper band 2 (red, lighter)
      addEMALine('upper2', vwapData.map((v, i) => ({
        time: candles[i]?.time || candles[i]?.timestamp,
        value: v.upper2,
      })), { color: '#ef5350', lineWidth: 1, title: '+2 StDev', lineStyle: 2 });

      // Lower band 2 (red, lighter)
      addEMALine('lower2', vwapData.map((v, i) => ({
        time: candles[i]?.time || candles[i]?.timestamp,
        value: v.lower2,
      })), { color: '#ef5350', lineWidth: 1, title: '-2 StDev', lineStyle: 2 });
    }

    // Add trade markers
    if (results?.trades) {
      const markers = results.trades.flatMap(trade => {
        const entryMarker = {
          time: trade.entryTime,
          side: trade.type === 'LONG' ? 'buy' : 'sell',
          price: trade.entryPrice,
          text: `${trade.type} Entry (${trade.score})`,
        };
        const exitMarker = trade.exitTime ? {
          time: trade.exitTime,
          side: trade.type === 'LONG' ? 'sell' : 'buy',
          price: trade.exitPrice,
          text: `${trade.exitReason}`,
        } : null;
        return exitMarker ? [entryMarker, exitMarker] : [entryMarker];
      });
      setTradeMarkers(markers);
    }
  }, [chartReady, candles, results, setCandlestickData, addEMALine, setTradeMarkers]);

  // Fetch candle data
  const fetchCandles = async () => {
    setLoading(true);
    setError(null);

    try {
      const fromDate = simMode === 'daySimulation' ? simDate : startDate;
      const toDate = simMode === 'daySimulation' ? simDate : endDate;

      let url;
      if (dataSource === 'alpaca') {
        // Alpaca endpoint - includes pre-calculated VWAP in bar data
        url = `/api/alpaca/bars/${symbol}/${timeframe}?from=${fromDate}&to=${toDate}`;
      } else {
        // Polygon endpoint (default)
        url = `/api/polygon/aggregates/${symbol}/${timeframe}/minute?from=${fromDate}&to=${toDate}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch candles');
      }

      const candleData = data.results || data.candles || [];
      if (candleData.length === 0) {
        throw new Error('No candle data returned. Market may have been closed on this date.');
      }

      // If Alpaca data, note that it includes VWAP (vw property)
      if (dataSource === 'alpaca' && candleData[0]?.vw) {
        console.log('Using Alpaca data with pre-calculated VWAP');
      }

      setCandles(candleData);
      return candleData;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Run backtest
  const handleRunBacktest = async () => {
    const candleData = await fetchCandles();
    if (!candleData) return;

    const backtestResults = runBacktest(candleData, config);
    if (backtestResults.error) {
      setError(backtestResults.error);
      return;
    }

    setResults(backtestResults);
  };

  // Day simulation controls
  const startDaySimulation = async () => {
    const candleData = await fetchCandles();
    if (!candleData) return;

    setSimIndex(0);
    setSimRunning(true);

    // Run initial backtest to get indicators
    const fullResults = runBacktest(candleData, config);
    setResults(fullResults);
  };

  const stopDaySimulation = () => {
    setSimRunning(false);
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
    }
  };

  // Simulation tick
  useEffect(() => {
    if (simRunning && candles.length > 0) {
      simIntervalRef.current = setInterval(() => {
        setSimIndex(prev => {
          if (prev >= candles.length - 1) {
            setSimRunning(false);
            return prev;
          }
          return prev + 1;
        });
      }, simSpeed);

      return () => clearInterval(simIntervalRef.current);
    }
  }, [simRunning, candles.length, simSpeed]);

  // Update results as simulation progresses
  useEffect(() => {
    if (simMode === 'daySimulation' && simIndex > 50 && candles.length > 0) {
      const partialCandles = candles.slice(0, simIndex + 1);
      const partialResults = runBacktest(partialCandles, config);
      setResults(partialResults);
    }
  }, [simIndex, simMode]);

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div style={{ padding: theme.spacing.lg, maxWidth: theme.layout.maxWidthWide, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: theme.spacing.xl }}>
        <h1 style={{ color: theme.colors.text, fontSize: theme.typography.fontSize.xxl, marginBottom: theme.spacing.sm }}>
          Charlie Strategy Backtester
        </h1>
        <p style={{ color: theme.colors.textLight, fontSize: theme.typography.fontSize.base }}>
          VWAP + MACD + Scoring System - Based on Pine Script Multi-Tool PRO Strategy
        </p>
      </div>

      {/* Mode Selector */}
      <Card style={{ marginBottom: theme.spacing.lg }}>
        <div style={{ display: 'flex', gap: theme.spacing.md, marginBottom: theme.spacing.lg }}>
          <Button
            variant={simMode === 'backtest' ? 'primary' : 'outline'}
            onClick={() => setSimMode('backtest')}
          >
            Date Range Backtest
          </Button>
          <Button
            variant={simMode === 'daySimulation' ? 'primary' : 'outline'}
            onClick={() => setSimMode('daySimulation')}
          >
            Day Simulation
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowConfig(!showConfig)}
            style={{ marginLeft: 'auto' }}
          >
            {showConfig ? 'Hide Config' : 'Strategy Config'}
          </Button>
        </div>

        {/* Input Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: theme.spacing.md }}>
          <div>
            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
              Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
              Timeframe
            </label>
            <select
              value={timeframe}
              onChange={e => setTimeframe(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
              }}
            >
              <option value="1">1 min</option>
              <option value="5">5 min</option>
              <option value="15">15 min</option>
              <option value="60">1 hour</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
              Data Source
            </label>
            <select
              value={dataSource}
              onChange={e => setDataSource(e.target.value)}
              style={{
                width: '100%',
                padding: theme.spacing.sm,
                border: `1px solid ${theme.colors.gray400}`,
                borderRadius: theme.borderRadius.md,
                fontSize: theme.typography.fontSize.base,
              }}
            >
              <option value="polygon">Polygon.io</option>
              <option value="alpaca">Alpaca (has VWAP)</option>
            </select>
          </div>

          {simMode === 'backtest' ? (
            <>
              <div>
                <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray400}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.base,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray400}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.base,
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
                  Simulation Date
                </label>
                <input
                  type="date"
                  value={simDate}
                  onChange={e => setSimDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray400}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.base,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: theme.spacing.xs, fontWeight: theme.typography.fontWeight.medium, color: theme.colors.text }}>
                  Speed (ms/candle)
                </label>
                <input
                  type="number"
                  value={simSpeed}
                  onChange={e => setSimSpeed(Number(e.target.value))}
                  min={10}
                  max={1000}
                  step={10}
                  style={{
                    width: '100%',
                    padding: theme.spacing.sm,
                    border: `1px solid ${theme.colors.gray400}`,
                    borderRadius: theme.borderRadius.md,
                    fontSize: theme.typography.fontSize.base,
                  }}
                />
              </div>
            </>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            {simMode === 'backtest' ? (
              <Button
                variant="success"
                onClick={handleRunBacktest}
                disabled={loading}
                style={{ width: '100%' }}
              >
                {loading ? 'Running...' : 'Run Backtest'}
              </Button>
            ) : (
              <div style={{ display: 'flex', gap: theme.spacing.sm, width: '100%' }}>
                {!simRunning ? (
                  <Button variant="success" onClick={startDaySimulation} disabled={loading} style={{ flex: 1 }}>
                    {loading ? 'Loading...' : 'Start'}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={stopDaySimulation} style={{ flex: 1 }}>
                    Stop
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Strategy Configuration Panel */}
      {showConfig && (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <h3 style={{ marginBottom: theme.spacing.lg, color: theme.colors.text }}>Strategy Configuration</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: theme.spacing.lg }}>
            {/* Capital */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>Capital</h4>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>Initial Capital ($)</label>
              <input
                type="number"
                value={config.initialCapital}
                onChange={e => updateConfig('initialCapital', Number(e.target.value))}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
              <label style={{ display: 'block', marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>Position Size (%)</label>
              <input
                type="number"
                value={config.positionSizePercent}
                onChange={e => updateConfig('positionSizePercent', Number(e.target.value))}
                min={1}
                max={100}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
            </div>

            {/* VWAP */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>VWAP Bands</h4>
              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <input type="checkbox" checked={config.useVWAP} onChange={e => updateConfig('useVWAP', e.target.checked)} />
                Enable VWAP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <input type="checkbox" checked={config.usePreCalculatedVWAP} onChange={e => updateConfig('usePreCalculatedVWAP', e.target.checked)} />
                Use Data Source VWAP
              </label>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>StDev Method</label>
              <select
                value={config.stdevMethod}
                onChange={e => updateConfig('stdevMethod', e.target.value)}
                style={{ width: '100%', padding: theme.spacing.sm, marginBottom: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              >
                <option value="rolling">Rolling (ta.stdev)</option>
                <option value="vwap">Volume-Weighted (v2 mod)</option>
              </select>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>StDev Lookback</label>
              <input
                type="number"
                value={config.vwapStdevLookback}
                onChange={e => updateConfig('vwapStdevLookback', Number(e.target.value))}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
              <label style={{ display: 'block', marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>Band 1 Mult</label>
              <input
                type="number"
                value={config.vwapBand1Mult}
                onChange={e => updateConfig('vwapBand1Mult', Number(e.target.value))}
                step={0.1}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
            </div>

            {/* MACD */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>MACD</h4>
              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <input type="checkbox" checked={config.useMACD} onChange={e => updateConfig('useMACD', e.target.checked)} />
                Enable MACD Filter
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: theme.spacing.xs }}>
                <div>
                  <label style={{ fontSize: theme.typography.fontSize.sm }}>Fast</label>
                  <input
                    type="number"
                    value={config.macdFast}
                    onChange={e => updateConfig('macdFast', Number(e.target.value))}
                    style={{ width: '100%', padding: theme.spacing.xs, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.sm }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: theme.typography.fontSize.sm }}>Slow</label>
                  <input
                    type="number"
                    value={config.macdSlow}
                    onChange={e => updateConfig('macdSlow', Number(e.target.value))}
                    style={{ width: '100%', padding: theme.spacing.xs, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.sm }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: theme.typography.fontSize.sm }}>Signal</label>
                  <input
                    type="number"
                    value={config.macdSignal}
                    onChange={e => updateConfig('macdSignal', Number(e.target.value))}
                    style={{ width: '100%', padding: theme.spacing.xs, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.sm }}
                  />
                </div>
              </div>
            </div>

            {/* Risk/Reward */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>Risk/Reward</h4>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>R:R Multiple</label>
              <input
                type="number"
                value={config.rrMultiple}
                onChange={e => updateConfig('rrMultiple', Number(e.target.value))}
                step={0.5}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                <input type="checkbox" checked={config.useATRStop} onChange={e => updateConfig('useATRStop', e.target.checked)} />
                ATR-based Stop
              </label>
              <label style={{ display: 'block', marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>ATR Multiple</label>
              <input
                type="number"
                value={config.atrMultiple}
                onChange={e => updateConfig('atrMultiple', Number(e.target.value))}
                step={0.1}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
            </div>

            {/* Signals */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>Signal Filters</h4>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>Min Score (0-10)</label>
              <input
                type="number"
                value={config.minScoreForTrade}
                onChange={e => updateConfig('minScoreForTrade', Number(e.target.value))}
                min={0}
                max={10}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
              <label style={{ display: 'block', marginTop: theme.spacing.sm, marginBottom: theme.spacing.xs }}>Min Bars Between</label>
              <input
                type="number"
                value={config.minBarsBetweenSignals}
                onChange={e => updateConfig('minBarsBetweenSignals', Number(e.target.value))}
                min={1}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
            </div>

            {/* Wick */}
            <div>
              <h4 style={{ marginBottom: theme.spacing.sm, color: theme.colors.textLight }}>Wick Confirmation</h4>
              <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <input type="checkbox" checked={config.useWick} onChange={e => updateConfig('useWick', e.target.checked)} />
                Enable Wick Filter
              </label>
              <label style={{ display: 'block', marginBottom: theme.spacing.xs }}>Wick % Threshold</label>
              <input
                type="number"
                value={config.wickPctThreshold}
                onChange={e => updateConfig('wickPctThreshold', Number(e.target.value))}
                step={0.1}
                min={0.1}
                max={0.9}
                style={{ width: '100%', padding: theme.spacing.sm, border: `1px solid ${theme.colors.gray400}`, borderRadius: theme.borderRadius.md }}
              />
            </div>
          </div>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Card variant="error" style={{ marginBottom: theme.spacing.lg }}>
          <span style={{ color: theme.colors.errorDark }}>{error}</span>
        </Card>
      )}

      {/* Chart */}
      {candles.length > 0 && (
        <Card style={{ marginBottom: theme.spacing.lg }}>
          <h3 style={{ marginBottom: theme.spacing.md, color: theme.colors.text }}>
            {symbol} - {timeframe}min Chart with VWAP Bands
          </h3>
          <div
            ref={chartContainerRef}
            style={{
              width: '100%',
              height: 400,
              borderRadius: theme.borderRadius.md,
              overflow: 'hidden',
            }}
          />
          <div style={{
            marginTop: theme.spacing.sm,
            display: 'flex',
            gap: theme.spacing.lg,
            fontSize: theme.typography.fontSize.sm,
            color: theme.colors.textLight,
          }}>
            <span><span style={{ color: '#FF9800' }}>━━</span> VWAP</span>
            <span><span style={{ color: '#26a69a' }}>━━</span> ±1 StDev</span>
            <span><span style={{ color: '#ef5350' }}>- -</span> ±2 StDev</span>
            <span><span style={{ color: '#26a69a' }}>▲</span> Long Entry</span>
            <span><span style={{ color: '#ef5350' }}>▼</span> Short/Exit</span>
          </div>
        </Card>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Performance Metrics */}
          <Card style={{ marginBottom: theme.spacing.lg }}>
            <h3 style={{ marginBottom: theme.spacing.lg, color: theme.colors.text }}>Performance Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: theme.spacing.md }}>
              <MetricCard
                label="Total P&L"
                value={`$${results.metrics.totalPnL.toFixed(2)}`}
                variant={results.metrics.totalPnL >= 0 ? 'success' : 'error'}
              />
              <MetricCard
                label="Return"
                value={`${results.metrics.totalReturn >= 0 ? '+' : ''}${results.metrics.totalReturn.toFixed(2)}%`}
                variant={results.metrics.totalReturn >= 0 ? 'success' : 'error'}
              />
              <MetricCard
                label="Win Rate"
                value={`${results.metrics.winRate.toFixed(1)}%`}
                variant={results.metrics.winRate >= 50 ? 'success' : 'error'}
              />
              <MetricCard
                label="Total Trades"
                value={results.metrics.totalTrades.toString()}
                variant="info"
              />
              <MetricCard
                label="Profit Factor"
                value={results.metrics.profitFactor === Infinity ? 'N/A' : results.metrics.profitFactor.toFixed(2)}
                variant={results.metrics.profitFactor >= 1.5 ? 'success' : results.metrics.profitFactor >= 1 ? 'warning' : 'error'}
              />
              <MetricCard
                label="Max Drawdown"
                value={`-${results.metrics.maxDrawdownPercent.toFixed(2)}%`}
                variant={results.metrics.maxDrawdownPercent <= 10 ? 'success' : results.metrics.maxDrawdownPercent <= 20 ? 'warning' : 'error'}
              />
              <MetricCard
                label="Avg Win"
                value={`$${results.metrics.avgWin.toFixed(2)}`}
                variant="success"
              />
              <MetricCard
                label="Avg Loss"
                value={`$${results.metrics.avgLoss.toFixed(2)}`}
                variant="error"
              />
              <MetricCard
                label="Avg Score"
                value={results.metrics.avgScore.toFixed(1)}
                variant={results.metrics.avgScore >= 7 ? 'success' : 'info'}
              />
            </div>
          </Card>

          {/* Equity Curve */}
          {results.equityCurve && results.equityCurve.length > 0 && (
            <Card style={{ marginBottom: theme.spacing.lg }}>
              <h3 style={{ marginBottom: theme.spacing.lg, color: theme.colors.text }}>Equity Curve</h3>
              <div style={{ height: 200, position: 'relative' }}>
                <svg width="100%" height="100%" viewBox={`0 0 ${results.equityCurve.length} 100`} preserveAspectRatio="none">
                  {/* Grid lines */}
                  <line x1="0" y1="50" x2={results.equityCurve.length} y2="50" stroke={theme.colors.gray300} strokeDasharray="4" />

                  {/* Equity line */}
                  <polyline
                    fill="none"
                    stroke={results.metrics.totalPnL >= 0 ? theme.colors.success : theme.colors.error}
                    strokeWidth="2"
                    points={results.equityCurve.map((point, i) => {
                      const minEquity = Math.min(...results.equityCurve.map(p => p.equity));
                      const maxEquity = Math.max(...results.equityCurve.map(p => p.equity));
                      const range = maxEquity - minEquity || 1;
                      const y = 100 - ((point.equity - minEquity) / range) * 100;
                      return `${i},${y}`;
                    }).join(' ')}
                  />
                </svg>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textLight
                }}>
                  ${Math.max(...results.equityCurve.map(p => p.equity)).toFixed(0)}
                </div>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.textLight
                }}>
                  ${Math.min(...results.equityCurve.map(p => p.equity)).toFixed(0)}
                </div>
              </div>
            </Card>
          )}

          {/* Trade History */}
          {results.trades && results.trades.length > 0 && (
            <Card>
              <h3 style={{ marginBottom: theme.spacing.lg, color: theme.colors.text }}>Trade History</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: theme.typography.fontSize.sm }}>
                  <thead>
                    <tr style={{ backgroundColor: theme.colors.gray100, borderBottom: `2px solid ${theme.colors.gray300}` }}>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>#</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Type</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Entry</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Exit</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>Shares</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>P&L</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'right' }}>%</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'center' }}>Score</th>
                      <th style={{ padding: theme.spacing.sm, textAlign: 'left' }}>Exit Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.trades.map((trade, idx) => (
                      <tr key={idx} style={{ borderBottom: `1px solid ${theme.colors.gray300}` }}>
                        <td style={{ padding: theme.spacing.sm }}>{idx + 1}</td>
                        <td style={{ padding: theme.spacing.sm }}>
                          <span style={{
                            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                            borderRadius: theme.borderRadius.sm,
                            backgroundColor: trade.type === 'LONG' ? theme.colors.successLight : theme.colors.errorLight,
                            color: trade.type === 'LONG' ? theme.colors.successDark : theme.colors.errorDark,
                            fontWeight: theme.typography.fontWeight.medium,
                          }}>
                            {trade.type}
                          </span>
                        </td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>${trade.entryPrice.toFixed(2)}</td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>${trade.exitPrice.toFixed(2)}</td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'right' }}>{trade.shares}</td>
                        <td style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                          color: trade.pnl >= 0 ? theme.colors.success : theme.colors.error,
                          fontWeight: theme.typography.fontWeight.medium,
                        }}>
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </td>
                        <td style={{
                          padding: theme.spacing.sm,
                          textAlign: 'right',
                          color: trade.pnlPercent >= 0 ? theme.colors.success : theme.colors.error,
                        }}>
                          {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                        </td>
                        <td style={{ padding: theme.spacing.sm, textAlign: 'center' }}>
                          <span style={{
                            padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                            borderRadius: theme.borderRadius.full,
                            backgroundColor: trade.score >= 8 ? theme.colors.successLight : trade.score >= 6 ? theme.colors.warningLight : theme.colors.gray200,
                            color: trade.score >= 8 ? theme.colors.successDark : trade.score >= 6 ? theme.colors.warningDark : theme.colors.text,
                            fontWeight: theme.typography.fontWeight.medium,
                          }}>
                            {trade.score}
                          </span>
                        </td>
                        <td style={{ padding: theme.spacing.sm }}>
                          <span style={{
                            fontSize: theme.typography.fontSize.xs,
                            color: trade.exitReason === 'TAKE_PROFIT' ? theme.colors.success :
                                   trade.exitReason === 'STOP_LOSS' ? theme.colors.error : theme.colors.textLight,
                          }}>
                            {trade.exitReason.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Simulation Progress (Day Sim mode) */}
          {simMode === 'daySimulation' && candles.length > 0 && (
            <Card style={{ marginTop: theme.spacing.lg }}>
              <h3 style={{ marginBottom: theme.spacing.md, color: theme.colors.text }}>Simulation Progress</h3>
              <div style={{
                height: 8,
                backgroundColor: theme.colors.gray200,
                borderRadius: theme.borderRadius.full,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${(simIndex / candles.length) * 100}%`,
                  backgroundColor: theme.colors.info,
                  transition: 'width 0.1s ease',
                }} />
              </div>
              <div style={{
                marginTop: theme.spacing.sm,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: theme.typography.fontSize.sm,
                color: theme.colors.textLight,
              }}>
                <span>Bar {simIndex} / {candles.length}</span>
                <span>{((simIndex / candles.length) * 100).toFixed(1)}%</span>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default CharlieStrategyPage;
