/**
 * Signal Evaluator Module
 *
 * Evaluates entry and exit signals for trading positions.
 * Extracted from aiTradingEngine.js for modularity.
 *
 * Receives shared state via init() context pattern — all module-level
 * variables from the engine are accessed through ctx.
 */

const technicalIndicators = require('./technicalIndicatorsService');
const tradingLogger = require('./tradingLogger');
const websocketServer = require('./websocketServer');
const alpacaStream = require('./alpacaStreamClient');
const LeveragedEtfStrategy = require('./leveragedEtfStrategy');

const leveragedEtfStrategy = new LeveragedEtfStrategy();

// Shared context — populated by init() from aiTradingEngine.js
let ctx = {};

/**
 * Initialize shared context from the engine.
 * Must be called after all engine state/functions are defined.
 * @param {object} context - Shared state and functions from aiTradingEngine.js
 */
function init(context) {
  ctx = context;
}

/**
 * Evaluate entry conditions for a symbol
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Entry decision
 */
async function evaluateEntry(sessionId, symbol) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return { shouldEnter: false };

  // Check cooldown - prevent re-entry too soon after selling
  const sessionCooldowns = ctx.tradeCooldowns.get(sessionId);
  if (sessionCooldowns) {
    const lastSellTime = sessionCooldowns.get(symbol);
    if (lastSellTime) {
      const minutesSinceSell = (Date.now() - lastSellTime) / (1000 * 60);
      if (minutesSinceSell < ctx.TRADE_COOLDOWN_MINUTES) {
        tradingLogger.logRisk('Cooldown active', { sessionId, sessionName: session.name, reason: `${symbol} sold ${minutesSinceSell.toFixed(1)} min ago`, value: minutesSinceSell, threshold: ctx.TRADE_COOLDOWN_MINUTES, symbol });
        return {
          shouldEnter: false,
          reason: `Cooldown: ${(ctx.TRADE_COOLDOWN_MINUTES - minutesSinceSell).toFixed(0)} min remaining`,
          cooldownRemaining: ctx.TRADE_COOLDOWN_MINUTES - minutesSinceSell,
        };
      }
    }
  }

  try {
    // Get recent candles (5-minute for intraday)
    // Use asset-type-aware helper for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';
    const candles = await ctx.getAggregatesForAsset(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    }, sessionAssetType);

    if (!candles || candles.length < 50) {
      return { shouldEnter: false, reason: 'Insufficient data' };
    }

    // Calculate all indicators
    const indicators = technicalIndicators.getAllIndicators(candles);
    const signals = indicators.signals;

    // Get config with defaults
    const cfg = session.config;
    const entryStrategy = cfg.entryStrategy || 'balanced';
    const rsiOversold = cfg.rsiOversold || 30;
    const rsiOverbought = cfg.rsiOverbought || 70;
    const volumeMultiplier = cfg.volumeMultiplier || 1.5;
    const minSignalsRequired = cfg.minSignalsRequired || 2;
    const requireVolumeSpike = cfg.requireVolumeSpike !== false;
    const requireTrendAlignment = cfg.requireTrendAlignment !== false;
    const requireRsiSignal = cfg.requireRsiSignal !== false;

    // Regime-aware trading: determine market regime and ETF type
    const etfType = ctx.getEtfType(symbol);

    // Use hysteresis-stabilized regime to prevent flip-flop whipsaws
    const rawRegime = ctx.getRawMarketRegime(session, indicators);
    const marketRegime = ctx.getStableRegime(session, rawRegime);

    // Check if this trade would be counter-trend
    const isTradeCounterTrend = ctx.isCounterTrend(etfType, marketRegime);
    const isTradeAligned = ctx.isRegimeAligned(etfType, marketRegime);

    // Decision factors
    const factors = [];
    let signalCount = 0;

    // Current price: prefer real-time WS price over stale candle close
    const wsPrice = alpacaStream.getLatestPrice(symbol);
    const currentPrice = (wsPrice && !wsPrice.isStale) ? wsPrice.price : candles[candles.length - 1].close;
    // Note: indicators service returns vwap.value, not vwap.price
    const vwapValue = indicators.vwap?.value || indicators.vwap?.price;
    const priceVsVwap = vwapValue
      ? ((currentPrice - vwapValue) / vwapValue) * 100
      : 0;
    const belowVwap = priceVsVwap < 0;
    const volumeRatio = indicators.volume?.ratio || 1;
    const hasVolumeSpike = volumeRatio >= volumeMultiplier;

    // WEIGHTED SIGNAL SCORING
    // Each signal contributes a weight proportional to its predictive value.
    // signalCount still tracks # of distinct signals for minSignalsRequired gate.
    // signalScore determines confidence (replaces equal +15 per signal).
    let strategyMatch = false;
    let signalScore = 0;

    // Signal weights tuned by predictive value:
    const SIGNAL_WEIGHTS = {
      strategyMatch: 20,      // Core strategy condition (RSI dip + VWAP, or momentum)
      volumeSpike: 15,        // Leading indicator — institutional activity
      rsiSignal: 12,          // Confirming but partially lagging
      macdConfirmation: 8,    // Lagging — useful only as confirmation
      bollingerOversold: 10,  // Statistical — good for mean reversion
    };

    // Debug logging for every evaluation (helps diagnose why entries aren't triggering)
    tradingLogger.logIndicators(symbol, {
      rsi: indicators.rsi.value,
      macd: indicators.macd.histogram,
      volumeRatio,
      vwapPosition: priceVsVwap,
      bbPercentB: indicators.bollingerBands?.percentB,
      adx: indicators.adx?.value,
    }, { sessionId, sessionName: session.name });

    if (entryStrategy === 'dip' || entryStrategy === 'conservative') {
      // Buy the dip: RSI below threshold + below VWAP
      const dipThreshold = entryStrategy === 'dip'
        ? (rsiOversold || 30) + 15  // More lenient: RSI < 45
        : rsiOversold;              // Strict: RSI < 30

      if (indicators.rsi.value < dipThreshold && belowVwap) {
        strategyMatch = true;
        signalCount += 2;
        signalScore += SIGNAL_WEIGHTS.strategyMatch;
        factors.push(
          `RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP [+${SIGNAL_WEIGHTS.strategyMatch}w]`
        );
      }
    }

    if (entryStrategy === 'momentum' || entryStrategy === 'aggressive') {
      if (indicators.rsi.value > 50 && indicators.rsi.value < 65) {
        strategyMatch = true;
        signalCount++;
        signalScore += SIGNAL_WEIGHTS.strategyMatch;
        factors.push(`RSI momentum zone (${indicators.rsi.value.toFixed(1)}) [+${SIGNAL_WEIGHTS.strategyMatch}w]`);
      }
    }

    if (entryStrategy === 'balanced') {
      const balancedRsiThreshold = (rsiOversold || 30) + 15;
      if (indicators.rsi.value < balancedRsiThreshold && belowVwap) {
        strategyMatch = true;
        signalCount += 2;
        signalScore += SIGNAL_WEIGHTS.strategyMatch;
        factors.push(
          `RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP [+${SIGNAL_WEIGHTS.strategyMatch}w]`
        );
      }

      // Momentum bounce - RSI rising from oversold with bullish MACD + volume
      if (indicators.rsi.value > rsiOversold &&
          indicators.rsi.value < 40 &&
          (indicators.macd.bullish || indicators.macd.crossover) &&
          hasVolumeSpike) {
        strategyMatch = true;
        signalCount++;
        signalScore += SIGNAL_WEIGHTS.strategyMatch;
        factors.push(
          `RSI momentum (${indicators.rsi.value.toFixed(1)}) + bullish MACD + volume [+${SIGNAL_WEIGHTS.strategyMatch}w]`
        );
      }
    }

    // Additional confirming signals (configurable)
    if (requireVolumeSpike && hasVolumeSpike) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.volumeSpike;
      factors.push(`Volume spike (${volumeRatio.toFixed(2)}x) [+${SIGNAL_WEIGHTS.volumeSpike}w]`);
    }

    if (requireTrendAlignment && indicators.trend?.shortTerm === 'bullish') {
      // Logged as context only — trend alignment is always true in uptrends, not a distinct signal
      factors.push('Bullish trend alignment');
    }

    if (requireRsiSignal) {
      if (indicators.rsi.divergence?.bullish) {
        signalCount++;
        signalScore += SIGNAL_WEIGHTS.rsiSignal;
        factors.push(`Bullish RSI divergence [+${SIGNAL_WEIGHTS.rsiSignal}w]`);
      } else if (indicators.rsi.value < 40) {
        signalCount++;
        signalScore += SIGNAL_WEIGHTS.rsiSignal;
        factors.push(`RSI oversold zone [+${SIGNAL_WEIGHTS.rsiSignal}w]`);
      }
    }

    // MACD confirmation
    if (indicators.macd.bullish || indicators.macd.crossover) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.macdConfirmation;
      factors.push(
        (indicators.macd.crossover ? 'MACD bullish crossover' : 'MACD bullish') + ` [+${SIGNAL_WEIGHTS.macdConfirmation}w]`
      );
    }

    // Bollinger Band oversold
    if (indicators.bollingerBands.percentB < 0.2) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.bollingerOversold;
      factors.push(`Near lower Bollinger Band [+${SIGNAL_WEIGHTS.bollingerOversold}w]`);
    }

    // OPTIONS FLOW INTEGRATION
    // CheddarFlow data is a leading indicator (institutional positioning) — worth 2x a technical signal
    let flowSignal = null;
    if (cfg.useOptionsFlow !== false) {
      try {
        const flowData = ctx.getCachedFlowData(symbol);
        if (flowData && !flowData.isStale) {
          flowSignal = leveragedEtfStrategy.analyzeFlowSentiment(flowData);
        }
      } catch (e) { /* flow data is optional, don't block entry */ }
    }

    // Calculate base confidence using weighted signal scores (replaces equal +15 per signal)
    let confidence = Math.min(50 + signalScore, 95);

    // Apply options flow as weighted signal after base confidence
    if (flowSignal && flowSignal.confidence > 0) {
      const flowEtfType = ctx.getEtfType(symbol);
      const flowAligned = (flowEtfType === 'bullish' && flowSignal.sentiment === 'bullish')
        || (flowEtfType === 'bearish' && flowSignal.sentiment === 'bearish')
        || (flowEtfType === 'neutral'); // Neutral ETFs always benefit from any flow data

      if (flowAligned && flowSignal.confidence >= 60) {
        signalCount += 2;  // Worth 2x a technical signal (leading, not lagging)
        confidence = Math.min(confidence + 10, 95); // Direct confidence boost
        factors.push(`Options flow: ${flowSignal.sentiment} (${flowSignal.confidence}% conf)`);
      } else if (!flowAligned && flowSignal.confidence >= 70) {
        confidence = Math.max(confidence - 15, 0); // Strong counter-flow penalizes entry
        factors.push(`Options flow AGAINST: ${flowSignal.sentiment} (${flowSignal.confidence}%)`);
      }
    }

    // REGIME-AWARE CONFIDENCE ADJUSTMENTS
    // Favor trades that align with market regime, penalize counter-trend trades
    if (etfType !== 'neutral') {
      if (isTradeAligned) {
        // Bonus for regime-aligned trades (e.g., bearish ETF in bear market)
        signalCount++;
        confidence = Math.min(confidence + 10, 95);
        factors.push(`Regime-aligned: ${etfType} ETF in ${marketRegime} market`);
      } else if (isTradeCounterTrend) {
        // Penalty for counter-trend trades (e.g., bullish ETF in bear market)
        // Require much higher signals to overcome the disadvantage
        confidence = Math.max(confidence - 20, 0);
        factors.push(`Warning: Counter-trend: ${etfType} ETF in ${marketRegime} market`);

        // For counter-trend trades, require at least minSignalsRequired signals (no +1 penalty)
        if (signalCount < minSignalsRequired) {
          tradingLogger.logRisk('Counter-trend trade blocked', { sessionId, sessionName: session.name, symbol, reason: `Need ${minSignalsRequired} signals, have ${signalCount}`, value: signalCount, threshold: minSignalsRequired });
          return {
            shouldEnter: false,
            reason: `Counter-trend trade: ${etfType} ETF in ${marketRegime} market requires extra confirmation`,
            etfType,
            marketRegime,
            counterTrend: true,
          };
        }
      }
    }

    // TIME-OF-DAY CONFIDENCE ADJUSTMENT
    // Morning momentum window (10:00-11:00 AM ET) and afternoon reversion window (2:00-3:30 PM ET)
    const now = new Date();
    const etHour = now.getUTCHours() - (ctx.isDST(now) ? 4 : 5);
    const etMinute = now.getUTCMinutes();
    const minutesSinceOpen = (etHour - 9) * 60 + (etMinute - 30); // Minutes since 9:30 AM ET

    if (minutesSinceOpen >= 30 && minutesSinceOpen <= 90) {
      // Morning momentum window (10:00-11:00 AM ET)
      if (entryStrategy === 'momentum' || entryStrategy === 'aggressive') {
        confidence = Math.min(confidence + 5, 95);
        factors.push('Morning momentum window (+5 conf)');
      }
    } else if (minutesSinceOpen >= 270 && minutesSinceOpen <= 360) {
      // Late afternoon reversion window (2:00-3:30 PM ET)
      if (entryStrategy === 'dip' || entryStrategy === 'conservative') {
        confidence = Math.min(confidence + 5, 95);
        factors.push('Afternoon reversion window (+5 conf)');
      }
      if (entryStrategy === 'momentum') {
        confidence = Math.max(confidence - 5, 0);
        factors.push('Afternoon momentum fade (-5 conf)');
      }
    }

    // Hard filters: counter-trend + weak volume OR counter-trend + sub-80 confidence
    // blocks the 70-79 zone the existing -20 penalty alone still permits. Empirically lossy.
    const blockedByF1 = isTradeCounterTrend && volumeRatio < 1.5;
    const blockedByF2 = isTradeCounterTrend && confidence < 80;

    if (blockedByF1) factors.push('BLOCKED-F1: counter-trend + weak volume');
    if (blockedByF2) factors.push('BLOCKED-F2: counter-trend + confidence < 80');

    // Entry requirements: strategy match + minimum signals + confidence threshold
    const meetsSignalRequirement = signalCount >= minSignalsRequired;
    const meetsConfidenceRequirement = confidence >= cfg.minConfidence;
    const wouldOtherwiseEnter =
      strategyMatch && meetsSignalRequirement && meetsConfidenceRequirement;

    if (wouldOtherwiseEnter && (blockedByF1 || blockedByF2)) {
      tradingLogger.logRisk('Hard filter blocked entry', {
        sessionId,
        sessionName: session.name,
        symbol,
        reason: [blockedByF1 && 'F1', blockedByF2 && 'F2']
          .filter(Boolean)
          .join('+'),
        value: confidence,
        threshold: 80,
      });
    }

    const shouldEnter = wouldOtherwiseEnter && !blockedByF1 && !blockedByF2;

    // Only log when there's a potential trade signal
    if (strategyMatch) {
      tradingLogger.logSignal('STRATEGY_MATCH', symbol, {
        sessionId, sessionName: session.name, confidence, shouldEnter,
        reasons: [`RSI=${indicators.rsi.value.toFixed(1)}`, `signals=${signalCount}`, `regime=${marketRegime}`, `etfType=${etfType}`],
        currentPrice,
      });
    }

    // Calculate position size and targets using config percentages
    const atr = indicators.atr?.value || currentPrice * 0.02;
    // Stop/target percentages apply directly to the ETF position P&L (not underlying)
    // User sets 2.5% stop = exit at -2.5% on the position, regardless of leverage
    const leverage = ctx.getEtfLeverage(symbol);
    const takeProfitPercent = cfg.takeProfitPercent || 2;
    const stopLossPercent = cfg.stopLossPercent || 1;

    // Use percentage-based targets (matching simulator)
    const profitTarget = currentPrice * (1 + takeProfitPercent / 100);
    const stopLoss = currentPrice * (1 - stopLossPercent / 100);

    // Adaptive targets based on volatility (if enabled)
    const useAdaptiveTargets = cfg.useAdaptiveTargets !== false;
    const volatilityMultiplier =
      useAdaptiveTargets && indicators.bollingerBands?.bandwidth > 0.05
        ? 1.2
        : 1.0;
    const adaptiveProfitTarget =
      currentPrice * (1 + (takeProfitPercent * volatilityMultiplier) / 100);

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons: factors,
      currentPrice,
      profitTarget: adaptiveProfitTarget,
      stopLoss,
      atr,
      indicators: {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        bbPercentB: indicators.bollingerBands.percentB,
        adx: indicators.adx.value,
        volumeRatio: indicators.volume.ratio,
      },
      timestamp: new Date(),
    };

    // Only log decisions that will actually execute (shouldEnter = true)
    // This keeps the decision feed clean and aligned with actual trades
    if (shouldEnter) {
      ctx.logDecision(sessionId, decision);
    }

    // ALWAYS send verbose trading log to frontend (regardless of shouldEnter)
    // This gives visibility into what the AI is "thinking"
    // Broadcast to all connected clients so the Trading Log panel can display it
    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldEnter ? 'SIGNAL' : 'INFO',
      category: 'ENTRY_ANALYSIS',
      symbol,
      message: shouldEnter
        ? `BUY signal: ${confidence}% confidence, ${signalCount} signals`
        : `Watching: RSI=${indicators.rsi.value.toFixed(1)}, signals=${signalCount}/${cfg.minSignalCount || 3}, conf=${confidence}%`,
      sessionId: session.sessionId,
      sessionName: session.name,
      data: {
        shouldEnter,
        confidence,
        signalCount,
        minSignalCount: cfg.minSignalCount || 3,
        price: currentPrice,
        indicators: {
          rsi: indicators.rsi.value.toFixed(1),
          macd: indicators.macd.histogram.toFixed(3),
          bbPercentB: (indicators.bollingerBands.percentB * 100).toFixed(1),
          adx: indicators.adx.value.toFixed(1),
          volumeRatio: indicators.volume.ratio.toFixed(2),
        },
        reasons: factors,
        regime: marketRegime,
      },
    });

    // Log to trading logger
    if (shouldEnter) {
      tradingLogger.logSignal('ENTRY', symbol, {
        sessionId,
        sessionName: session.name,
        confidence,
        reasons: factors,
        currentPrice,
        profitTarget: adaptiveProfitTarget,
        stopLoss,
        shouldEnter,
      });

      // Also log indicators for context
      tradingLogger.logIndicators(
        symbol,
        {
          rsi: indicators.rsi.value,
          macd: indicators.macd.histogram,
          adx: indicators.adx.value,
          volumeRatio: indicators.volume.ratio,
          bbPercentB: indicators.bollingerBands.percentB,
        },
        { sessionId, sessionName: session.name }
      );
    }

    // Send to websocket (use userId for notifications)
    if (shouldEnter) {
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    return decision;
  } catch (error) {
    tradingLogger.logError(`Entry evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
    return { shouldEnter: false, reason: error.message };
  }
}

/**
 * Evaluate exit conditions for a position
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @returns {object} Exit decision
 */
async function evaluateExit(sessionId, symbol) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return { shouldExit: false };

  const position = session.portfolio.positions.get(symbol);
  if (!position) return { shouldExit: false };

  try {
    // Get recent candles first (needed for regime detection)
    // Use asset-type-aware helper for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';
    const candles = await ctx.getAggregatesForAsset(symbol, 5, 'minute', {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(),
    }, sessionAssetType);

    if (!candles || candles.length < 50) {
      return { shouldExit: false };
    }

    const indicators = technicalIndicators.getAllIndicators(candles);

    // Determine regime for dynamic hold time - use sentiment engine when available
    const etfType = ctx.getEtfType(symbol);
    const trend = indicators.trend || {};
    // Use hysteresis-stabilized regime (same as evaluateEntry) to prevent flip-flop exits
    const rawRegime = ctx.getRawMarketRegime(session, indicators);
    const marketRegime = ctx.getStableRegime(session, rawRegime);
    const isPositionCounterTrend = ctx.isCounterTrend(etfType, marketRegime);

    // Current price: prefer real-time WS price over stale candle close
    // IMPORTANT: Computed BEFORE hold time gate so stop-loss can fire immediately
    const wsExitPrice = alpacaStream.getLatestPrice(symbol);
    const currentPrice = (wsExitPrice && !wsExitPrice.isStale) ? wsExitPrice.price : candles[candles.length - 1].close;
    const pnlPercent = position.unrealizedPnLPercent;

    // Emergency stop-loss check — BEFORE minimum hold time gate.
    // A 3x ETF can move 5%+ in 30 minutes; stop-loss must never be gated by hold time.
    const cfg = session.config;
    const leverage = ctx.getEtfLeverage(symbol);
    const stopLossPercent = cfg.stopLossPercent || 1;

    if (pnlPercent <= -stopLossPercent) {
      tradingLogger.logRisk('STOP LOSS during hold period', { sessionId, sessionName: session.name, symbol, reason: `${pnlPercent.toFixed(2)}% <= -${stopLossPercent}%`, value: pnlPercent, threshold: -stopLossPercent, action: 'Exiting immediately' });
      return {
        shouldExit: true,
        confidence: 100,
        exitReason: `Stop loss triggered (${pnlPercent.toFixed(2)}%)`,
        factors: [`STOP LOSS -${stopLossPercent}% triggered (at ${pnlPercent.toFixed(2)}%)`],
        currentPrice,
        pnlPercent,
        isPartialExit: false,
      };
    }

    // Minimum hold time - use session config (default: 30 min normal, 15 min counter-trend)
    // Use || to ensure 0 falls back to default (0 min hold is dangerous)
    // NOTE: Stop-loss exits above bypass this gate entirely
    const configMinHold = session.config.minHoldMinutes || 30;
    const configCounterTrendHold = session.config.counterTrendMinHoldMinutes || 15;
    const MIN_HOLD_MINUTES = isPositionCounterTrend ? configCounterTrendHold : configMinHold;
    // FIX: Default to Date.now() if entryTime is undefined/null to prevent NaN hold calculations
    let entryTime = position.entryTime || position.createdAt;
    if (!entryTime) {
      entryTime = Date.now();
      tradingLogger.logRisk('entryTime undefined', { sessionId, sessionName: session.name, symbol, reason: `${symbol}: entryTime is undefined, defaulting to now — hold-time gate bypassed`, action: 'Using Date.now() as fallback' });
    }
    if (entryTime) {
      const holdDuration = Date.now() - new Date(entryTime).getTime();
      const holdMinutes = holdDuration / (1000 * 60);
      if (holdMinutes < MIN_HOLD_MINUTES) {
        tradingLogger.logInfo(`[AI Engine] ${symbol}: Holding for ${holdMinutes.toFixed(1)} min (min: ${MIN_HOLD_MINUTES} min${isPositionCounterTrend ? ' [counter-trend]' : ''})`, { sessionId, sessionName: session.name, symbol });
        return { shouldExit: false, reason: 'Minimum hold time not reached' };
      }
    }

    const factors = [];
    let exitScore = 0;
    let criticalExitScore = 0;
    let exitReason = '';

    // Config and leverage already computed above (before hold time gate)
    const rawTakeProfit = cfg.takeProfitPercent || 2;
    const takeProfitPercent = leverage > 1 ? Math.max(rawTakeProfit, rawTakeProfit * leverage) : rawTakeProfit;
    const exitOnRsiExtreme = cfg.exitOnRsiExtreme !== false;
    const rsiOverbought = cfg.rsiOverbought || 70;

    // Exit point values aligned with simulator:
    // - Stop loss: 40 pts (was 50)
    // - Profit target: 30 pts (was 50) - should be confirmed with other signals
    // - Trailing stop: 35 pts (was 45)
    // - RSI overbought: 20 pts (same)
    // - EOD: 50 pts (same as simulator)

    // Profit target hit (using percentage config)
    // If TP is very low (< 0.5%), treat it as aggressive scalping - immediate exit
    // Otherwise needs confirmation from other signals
    // PARTIAL EXIT: If enabled and TP hit, sell partial position first
    let isPartialExit = false;
    if (pnlPercent >= takeProfitPercent) {
      const isAggressiveScalp = takeProfitPercent < 0.5;
      const partialEnabled = cfg.partialExitEnabled === true;
      const alreadyPartial = position.partialExitDone === true;

      if (partialEnabled && !alreadyPartial && !isAggressiveScalp) {
        // First TP hit with partial exits enabled — sell partial position
        isPartialExit = true;
        exitScore += 100; // Force the partial exit
        criticalExitScore += 100;
        exitReason = 'Partial profit target reached';
        factors.push(
          `PARTIAL EXIT: +${takeProfitPercent}% TP hit (at +${pnlPercent.toFixed(2)}%) — selling ${cfg.partialExitPercent || 50}%`
        );
      } else {
        const tpScore = isAggressiveScalp ? 100 : 30;
        exitScore += tpScore;
        criticalExitScore += tpScore;  // Profit targets are structural — never dampen
        exitReason = alreadyPartial ? 'Remainder profit target' : 'Profit target reached';
        factors.push(
          `Profit target +${takeProfitPercent}% reached (at +${pnlPercent.toFixed(2)}%)${isAggressiveScalp ? ' [SCALP]' : ''}${alreadyPartial ? ' [REMAINDER]' : ''}`
        );
      }
    }

    // Stop loss hit (using percentage config) - IMMEDIATE EXIT (must exceed threshold alone)
    // This is a critical risk management rule - stop loss should ALWAYS trigger exit
    if (pnlPercent <= -stopLossPercent) {
      exitScore += 100; // Guarantee exit - stop loss is non-negotiable
      criticalExitScore += 100;
      exitReason = 'Stop loss triggered';
      factors.push(
        `STOP LOSS -${stopLossPercent}% triggered (at ${pnlPercent.toFixed(2)}%)`
      );
    }

    // Trailing stop - now a % of gains to lock in (e.g., 50 means lock in 50% of gains)
    // 0 = disabled, values 0-100 represent % of gains to protect
    // IMPORTANT: Only activates after minimum profit threshold to prevent premature exits
    const trailingStopOfTP = cfg.trailingStopPercent || 0;
    const trailingStopMinProfitPercent = cfg.trailingStopMinProfitPercent || 2; // Default 2% min before trailing activates
    const entryPrice = position.averageCost;
    const highWaterMarkPnlPercent = position.highWaterMark
      ? ((position.highWaterMark - entryPrice) / entryPrice) * 100
      : 0;

    if (
      trailingStopOfTP > 0 &&
      position.highWaterMark &&
      position.highWaterMark > entryPrice &&
      pnlPercent > 0 &&
      highWaterMarkPnlPercent >= trailingStopMinProfitPercent // Only activate after meaningful gain
    ) {
      const gainFromEntry = position.highWaterMark - entryPrice;
      const allowedDropFromHigh =
        (gainFromEntry * (100 - trailingStopOfTP)) / 100;
      const triggerPrice = position.highWaterMark - allowedDropFromHigh;
      const lockedInGainPercent =
        ((triggerPrice - entryPrice) / entryPrice) * 100;

      if (currentPrice <= triggerPrice) {
        exitScore += 35;
        criticalExitScore += 35;  // Trailing stop is structural — never dampen
        exitReason = 'Trailing stop triggered';
        factors.push(
          `Trailing stop (locked ${lockedInGainPercent.toFixed(2)}% of ${highWaterMarkPnlPercent.toFixed(2)}% gain)`
        );
      }
    } else if (trailingStopOfTP > 0 && pnlPercent > 0 && highWaterMarkPnlPercent < trailingStopMinProfitPercent) {
      // Log that trailing stop is waiting for minimum profit
      factors.push(`Trailing stop waiting (need ${trailingStopMinProfitPercent}% gain, have ${highWaterMarkPnlPercent.toFixed(2)}%)`);
    }

    // RSI overbought (configurable)
    if (exitOnRsiExtreme && indicators.rsi.value > rsiOverbought) {
      exitScore += 20;
      factors.push('RSI overbought');
    }

    // Removed: Bearish RSI divergence + MACD confirm (5pts, MACD being removed)
    // Removed: MACD bearish momentum (5pts, 12% accuracy on 5-min bars)

    // "Price below VWAP" exit removed — 1% historical accuracy (1 win in 96 fires).
    // VWAP is a lag indicator on 5-min bars; price can be below and still rising.

    // End of day exit - uses proper timezone calculation
    // FIX 6b: Leveraged ETFs get wider EOD window (at least 30 min before close)
    const minutesUntilClose = ctx.getMinutesUntilClose();
    const configEodMin = cfg.exitBeforeCloseMinutes || 15;
    const exitBeforeCloseMinutes = leverage > 1 ? Math.max(configEodMin, 30) : configEodMin;
    const exitBeforeClose = cfg.exitBeforeClose !== false; // Default true

    if (exitBeforeClose && minutesUntilClose > 0 && minutesUntilClose <= exitBeforeCloseMinutes) {
      // Force exit regardless of P&L when approaching market close
      exitScore += 100; // Guaranteed exit - don't hold overnight
      criticalExitScore += 100;
      exitReason = `End-of-day exit (${minutesUntilClose.toFixed(0)} min until close)`;
      factors.push(`EOD EXIT: ${minutesUntilClose.toFixed(0)} min until close`);
    } else if (exitBeforeClose && minutesUntilClose > 0 && minutesUntilClose <= 30) {
      // Strong signal to exit within 30 min of close
      exitScore += 50;
      criticalExitScore += 50;
      factors.push(`Approaching market close (${minutesUntilClose.toFixed(0)} min)`);
    }

    // Volume declining while price rising (distribution)
    if (pnlPercent > 0 && indicators.volume.ratio < 0.7) {
      exitScore += 10;
      factors.push('Low volume on advance (distribution)');
    }

    // Removed: Stochastic overbought (8pts, lagging on extended moves)

    // AI discretion for loss handling
    if (pnlPercent < 0 && pnlPercent > stopLossPercent) {
      // Pattern suggests recovery
      if (indicators.rsi.value < 35 && indicators.volume.aboveAverage) {
        factors.push('AI holding: oversold with volume support');
        exitScore -= 20; // Reduce exit pressure
      }
      // Trend still intact
      if (indicators.adx.trending && indicators.adx.bullishDI) {
        factors.push('AI holding: trend still bullish');
        exitScore -= 15;
      }
    }

    // REGIME-AWARE EXIT PRESSURE
    // Counter-trend positions (e.g., bullish ETF in bear market) get extra exit pressure
    // Reduced from 25/15/20 to 10/10/15 — counter-trend alone shouldn't force exits
    // without real technical confirmation (needs 50 pts total to exit)
    if (isPositionCounterTrend && etfType !== 'neutral') {
      // Add mild exit pressure for counter-trend positions
      exitScore += 10;
      factors.push(`Warning: Counter-trend position: ${etfType} ETF in ${marketRegime} market`);

      // If losing on a counter-trend position, add moderate pressure
      if (pnlPercent < 0) {
        exitScore += 10;
        factors.push('Counter-trend position showing loss');
      }

      // Small profits on counter-trend: mild pressure, require tech confirmation
      if (pnlPercent > 0.5) {
        exitScore += 15;
        exitReason = exitReason || 'Taking quick profit on counter-trend trade';
        factors.push('Quick scalp profit on counter-trend trade');
      }
    }

    // TREND-AWARE EXIT DAMPENING (graduated by profit depth)
    // When profitable in a strong trend that's regime-aligned, dampen oscillator-based exit signals.
    // Critical signals (stop loss, trailing stop, EOD, profit targets) are NEVER dampened.
    // Dampening scales with profit depth: deeper profit = stronger hold.
    const baseDampeningFactor = cfg.trendDampeningFactor ?? 0.4;
    const shouldDampenExits = pnlPercent > 0
      && indicators.adx.trending
      && ctx.isRegimeAligned(etfType, marketRegime)
      && baseDampeningFactor < 1.0;

    if (shouldDampenExits) {
      const dampenableScore = exitScore - criticalExitScore;
      if (dampenableScore > 0) {
        // Scale dampening by profit depth relative to take-profit target
        const takeProfitPct = cfg.takeProfitPercent || 2;
        const profitDepth = Math.min(pnlPercent / takeProfitPct, 2.0); // Cap at 2x target
        const trendDampeningFactor = Math.max(0.2, baseDampeningFactor * (1 - profitDepth * 0.3));
        const originalExitScore = exitScore;
        const dampenedScore = Math.round(dampenableScore * trendDampeningFactor);
        exitScore = criticalExitScore + dampenedScore;
        factors.push(`Trend dampening: ${originalExitScore}->${exitScore} (ADX trending, ${marketRegime} regime, factor=${trendDampeningFactor.toFixed(2)}, depth=${profitDepth.toFixed(1)}x)`);
      }
    }

    // MINIMUM PROFIT PROTECTION: Don't exit with tiny profits due to weak signals
    // If profit is positive but under minimum threshold, require MUCH higher exit score
    // (Stop loss at 100 pts still works, but technical signals alone won't trigger exit)
    // Leverage-aware: 3x ETFs keep 1.5% (0.5% * 3), regular stocks use 0.5%
    const minProfitForExit = cfg.minProfitForExitPercent || (0.5 * leverage); // Scales with leverage
    const isProfitTooSmall = pnlPercent > 0 && pnlPercent < minProfitForExit;
    const effectiveExitThreshold = isProfitTooSmall ? 95 : 70; // Raised 50->70: non-critical exits require stronger confluence

    if (isProfitTooSmall && exitScore >= 70 && exitScore < 95) {
      factors.push(`Hold - profit ${pnlPercent.toFixed(2)}% too small (need ${minProfitForExit}% or stop loss)`);
    }

    // Non-critical exit threshold raised from 50 to 70 to prevent noise-driven whipsaws.
    // Critical exits (EOD +100, trailing stop +35, hard stop loss) bypass this via criticalExitScore.
    const shouldExit = exitScore >= effectiveExitThreshold;

    const decision = {
      shouldExit,
      symbol,
      action: 'SELL',
      exitScore,
      partialExit: isPartialExit,
      reasons: factors,
      exitReason: exitReason || factors[0] || 'Multiple factors',
      currentPrice,
      pnlPercent,
      pnl: position.unrealizedPnL,
      quantity: position.quantity,
      entryPrice: position.averageCost,
      indicators: {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        adx: indicators.adx.value,
      },
      timestamp: new Date(),
    };

    // Only log decisions that will actually execute (shouldExit = true)
    // This keeps the decision feed clean and aligned with actual trades
    if (shouldExit) {
      ctx.logDecision(sessionId, decision);
    }

    // Log to trading logger
    if (shouldExit) {
      tradingLogger.logSignal('EXIT', symbol, {
        sessionId,
        sessionName: session.name,
        exitScore,
        reasons: factors,
        currentPrice,
        shouldExit,
        pnlPercent,
      });
    }

    if (shouldExit) {
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    // ALWAYS log exit evaluation to trading log (verbose mode)
    // This helps debug why positions aren't selling
    const pnlSign = pnlPercent >= 0 ? '+' : '';
    const exitStatus = shouldExit ? 'WILL SELL' : 'HOLDING';
    const thresholdNote = `score ${exitScore}/${effectiveExitThreshold}`;

    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-exit-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldExit ? 'SIGNAL' : 'INFO',
      symbol,
      sessionId,
      sessionName: session.name,
      message: `EXIT EVAL: ${exitStatus} | P/L: ${pnlSign}${pnlPercent?.toFixed(2)}% | ${thresholdNote} | TP:${takeProfitPercent}% SL:${stopLossPercent}%${factors.length > 0 ? ' | ' + factors.slice(0, 2).join(', ') : ''}`,
      timestamp: new Date().toISOString(),
    });

    // Reset failure counter on successful evaluation
    ctx.exitEvalFailCounts.delete(`${sessionId}:${symbol}`);

    return decision;
  } catch (error) {
    const failKey = `${sessionId}:${symbol}`;
    const failures = (ctx.exitEvalFailCounts.get(failKey) || 0) + 1;
    ctx.exitEvalFailCounts.set(failKey, failures);

    tradingLogger.logError(`Exit evaluation failed for ${symbol} (failure ${failures}/${ctx.EXIT_EVAL_MAX_FAILURES})`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
      consecutiveFailures: failures,
    });

    // Force exit after consecutive data failures to prevent stuck positions
    if (failures >= ctx.EXIT_EVAL_MAX_FAILURES) {
      tradingLogger.logRisk('FORCE EXIT', { sessionId, sessionName: session?.name, symbol, reason: `${failures} consecutive eval failures`, value: failures, threshold: ctx.EXIT_EVAL_MAX_FAILURES, action: 'Force exiting position' });
      ctx.exitEvalFailCounts.delete(failKey);
      return {
        shouldExit: true,
        reason: `Force exit: ${failures} consecutive data failures`,
        confidence: 100,
        factors: [`${failures} consecutive exit evaluation failures`],
      };
    }

    return { shouldExit: false, reason: error.message };
  }
}

module.exports = { init, evaluateEntry, evaluateExit };
