/**
 * Technical Indicators Strategy Plugin
 *
 * The legacy signal strategy every broker used before the plugin split.
 * Extracted verbatim from signalEvaluator.evaluateEntry — the 6 entry styles
 * (dip/conservative/momentum/aggressive/orb/balanced) live here as internal
 * branches keyed off session.config.entryStrategy.
 *
 * Contract (shared by all strategy plugins):
 *   evaluate(session, symbol, ctx) => decisionObject
 * where ctx is the shared engine context (sessions, regime helpers, data
 * accessors, constants) wired by aiTradingEngine via signalEvaluator.init().
 *
 * This plugin only owns the ENTER decision. Universal exit logic, the
 * cooldown gate, and the signal funnel counters live in the dispatcher
 * (signalEvaluator.js).
 */

const technicalIndicators = require('../technicalIndicatorsService');
const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const LeveragedEtfStrategy = require('../leveragedEtfStrategy');
const openingRange = require('../openingRange');

const leveragedEtfStrategy = new LeveragedEtfStrategy();

const SLUG = 'technical-indicators';

/**
 * Evaluate entry conditions for a symbol using the technical-indicator stack.
 * @param {object} session - Live session object (config, portfolio, stats)
 * @param {string} symbol - Stock symbol
 * @param {object} ctx - Shared engine context (see aiTradingEngine _sharedCtx)
 * @returns {object} Entry decision
 */
async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;

  try {
    // Get recent candles (5-minute for intraday)
    // Use asset-type-aware helper for crypto/stock routing
    const sessionAssetType = session.config.assetType || 'stocks';
    const candles = await ctx.getAggregatesForAsset(
      symbol,
      5,
      'minute',
      {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: new Date(),
      },
      sessionAssetType
    );

    if (!candles || candles.length < 50) {
      return { shouldEnter: false, reason: 'Insufficient data', source: SLUG };
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
    const currentPrice =
      wsPrice && !wsPrice.isStale
        ? wsPrice.price
        : candles[candles.length - 1].close;
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
      strategyMatch: 20, // Core strategy condition (RSI dip + VWAP, or momentum)
      volumeSpike: 15, // Leading indicator — institutional activity
      rsiSignal: 12, // Confirming but partially lagging
      macdConfirmation: 8, // Lagging — useful only as confirmation
      bollingerOversold: 10, // Statistical — good for mean reversion
    };

    // Debug logging for every evaluation (helps diagnose why entries aren't triggering)
    tradingLogger.logIndicators(
      symbol,
      {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        volumeRatio,
        vwapPosition: priceVsVwap,
        bbPercentB: indicators.bollingerBands?.percentB,
        adx: indicators.adx?.value,
      },
      { sessionId, sessionName: session.name }
    );

    if (entryStrategy === 'dip' || entryStrategy === 'conservative') {
      // Buy the dip: RSI below threshold + below VWAP
      const dipThreshold =
        entryStrategy === 'dip'
          ? (rsiOversold || 30) + 15 // More lenient: RSI < 45
          : rsiOversold; // Strict: RSI < 30

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
        factors.push(
          `RSI momentum zone (${indicators.rsi.value.toFixed(1)}) [+${SIGNAL_WEIGHTS.strategyMatch}w]`
        );
      }
    }

    let orbContext = null; // captured for TP/SL override below
    if (entryStrategy === 'orb') {
      if (!openingRange.isInEntryWindow()) {
        factors.push('ORB: outside 9:45-11:30 ET entry window');
      } else {
        const range = openingRange.computeOpeningRange(candles);
        if (!range.finalized) {
          factors.push(`ORB: range not finalized (${range.barCount} bars)`);
        } else {
          const lastBar = candles[candles.length - 1];
          const breakAbove = lastBar.close > range.high;
          const breakBelow = lastBar.close < range.low;
          // Long-only: a "short break below" signal can't be executed as a
          // SELL/short because the engine only places BUY orders. Acting on
          // short breaks by buying the same symbol inverts the intended
          // edge (lost $39 on the SOXL ORB short→buy bug 2026-05-13).
          // Skip short signals entirely until we wire SOXL↔SOXS auto-switch
          // or add real short-order support.
          if (breakAbove && hasVolumeSpike) {
            strategyMatch = true;
            signalCount += 2;
            signalScore += SIGNAL_WEIGHTS.strategyMatch;
            orbContext = { range, direction: 'long' };
            factors.push(
              `ORB long break above $${range.high.toFixed(2)} (range $${range.height.toFixed(2)}) on ${volumeRatio.toFixed(2)}x volume [+${SIGNAL_WEIGHTS.strategyMatch}w]`
            );
          } else if (breakAbove) {
            factors.push(
              `ORB break with weak volume ${volumeRatio.toFixed(2)}x — needs ≥${volumeMultiplier}x`
            );
          } else if (breakBelow) {
            factors.push(
              `ORB short break below $${range.low.toFixed(2)} — long-only mode, skipped`
            );
          }
        }
      }
    }

    if (entryStrategy === 'balanced') {
      // `balanced` is the same dip entry as `dip` — RSI below threshold + below
      // VWAP. (Audit: the former "momentum-bounce" second branch, RSI 30-40 +
      // bullish MACD + volume, fired 0 distinct entries in 6 months because
      // RSI 30-40 is a strict subset of RSI < 45 and always caught by the dip
      // branch first. Removed as dead code; `balanced` ≡ `dip`.)
      const balancedRsiThreshold = (rsiOversold || 30) + 15;
      if (indicators.rsi.value < balancedRsiThreshold && belowVwap) {
        strategyMatch = true;
        signalCount += 2;
        signalScore += SIGNAL_WEIGHTS.strategyMatch;
        factors.push(
          `RSI dip (${indicators.rsi.value.toFixed(1)}) + below VWAP [+${SIGNAL_WEIGHTS.strategyMatch}w]`
        );
      }
    }

    // Additional confirming signals (configurable)
    if (requireVolumeSpike && hasVolumeSpike) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.volumeSpike;
      factors.push(
        `Volume spike (${volumeRatio.toFixed(2)}x) [+${SIGNAL_WEIGHTS.volumeSpike}w]`
      );
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
        (indicators.macd.crossover
          ? 'MACD bullish crossover'
          : 'MACD bullish') + ` [+${SIGNAL_WEIGHTS.macdConfirmation}w]`
      );
    }

    // Bollinger Band oversold
    if (indicators.bollingerBands.percentB < 0.2) {
      signalCount++;
      signalScore += SIGNAL_WEIGHTS.bollingerOversold;
      factors.push(
        `Near lower Bollinger Band [+${SIGNAL_WEIGHTS.bollingerOversold}w]`
      );
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
      } catch (e) {
        /* flow data is optional, don't block entry */
      }
    }

    // Calculate base confidence using weighted signal scores (replaces equal +15 per signal)
    let confidence = Math.min(50 + signalScore, 95);

    // Apply options flow as weighted signal after base confidence
    if (flowSignal && flowSignal.confidence > 0) {
      const flowEtfType = ctx.getEtfType(symbol);
      const flowAligned =
        (flowEtfType === 'bullish' && flowSignal.sentiment === 'bullish') ||
        (flowEtfType === 'bearish' && flowSignal.sentiment === 'bearish') ||
        flowEtfType === 'neutral'; // Neutral ETFs always benefit from any flow data

      if (flowAligned && flowSignal.confidence >= 60) {
        signalCount += 2; // Worth 2x a technical signal (leading, not lagging)
        confidence = Math.min(confidence + 10, 95); // Direct confidence boost
        factors.push(
          `Options flow: ${flowSignal.sentiment} (${flowSignal.confidence}% conf)`
        );
      } else if (!flowAligned && flowSignal.confidence >= 70) {
        confidence = Math.max(confidence - 15, 0); // Strong counter-flow penalizes entry
        factors.push(
          `Options flow AGAINST: ${flowSignal.sentiment} (${flowSignal.confidence}%)`
        );
      }
    }

    // REGIME-AWARE CONFIDENCE ADJUSTMENTS
    // Favor trades that align with market regime, penalize counter-trend trades
    if (etfType !== 'neutral') {
      if (isTradeAligned) {
        // Bonus for regime-aligned trades (e.g., bearish ETF in bear market)
        signalCount++;
        confidence = Math.min(confidence + 10, 95);
        factors.push(
          `Regime-aligned: ${etfType} ETF in ${marketRegime} market`
        );
      } else if (isTradeCounterTrend) {
        // Penalty for counter-trend trades (e.g., bullish ETF in bear market)
        // Require much higher signals to overcome the disadvantage
        confidence = Math.max(confidence - 20, 0);
        factors.push(
          `Warning: Counter-trend: ${etfType} ETF in ${marketRegime} market`
        );

        // For counter-trend trades, require at least minSignalsRequired signals (no +1 penalty)
        if (signalCount < minSignalsRequired) {
          tradingLogger.logRisk('Counter-trend trade blocked', {
            sessionId,
            sessionName: session.name,
            symbol,
            reason: `Need ${minSignalsRequired} signals, have ${signalCount}`,
            value: signalCount,
            threshold: minSignalsRequired,
          });
          return {
            shouldEnter: false,
            reason: `Counter-trend trade: ${etfType} ETF in ${marketRegime} market requires extra confirmation`,
            etfType,
            marketRegime,
            counterTrend: true,
            source: SLUG,
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
    if (blockedByF2)
      factors.push('BLOCKED-F2: counter-trend + confidence < 80');

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
        sessionId,
        sessionName: session.name,
        confidence,
        shouldEnter,
        reasons: [
          `RSI=${indicators.rsi.value.toFixed(1)}`,
          `signals=${signalCount}`,
          `regime=${marketRegime}`,
          `etfType=${etfType}`,
        ],
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

    // ORB strategy: replace standard %-based targets with range-derived ones
    let finalProfitTarget = adaptiveProfitTarget;
    let finalStopLoss = stopLoss;
    if (orbContext && strategyMatch) {
      const orbTargets = openingRange.getStrategyTargets({
        currentPrice,
        range: orbContext.range,
        direction: orbContext.direction,
        fixedStopPct: cfg.orbStopPct ?? 1.5,
        fixedTpPct: cfg.orbTpPct ?? 3.0,
      });
      finalProfitTarget = orbTargets.profitTarget;
      finalStopLoss = orbTargets.stopLoss;
      factors.push(
        `ORB targets: SL $${finalStopLoss.toFixed(2)} / TP $${finalProfitTarget.toFixed(2)}`
      );
    }

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons: factors,
      currentPrice,
      profitTarget: finalProfitTarget,
      stopLoss: finalStopLoss,
      atr,
      indicators: {
        rsi: indicators.rsi.value,
        macd: indicators.macd.histogram,
        bbPercentB: indicators.bollingerBands.percentB,
        adx: indicators.adx.value,
        volumeRatio: indicators.volume.ratio,
      },
      timestamp: new Date(),
      source: SLUG,
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
        profitTarget: finalProfitTarget,
        stopLoss: finalStopLoss,
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
    return { shouldEnter: false, reason: error.message, source: SLUG };
  }
}

module.exports = {
  slug: SLUG,
  mutableFields: [], // Phase 1: empty → self-mutation behavior unchanged
  evaluate,
};
