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
const strategies = require('./strategies');

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

  // Check cooldown - prevent re-entry too soon after selling.
  // Universal gate — applies to every strategy plugin, so it stays in the
  // dispatcher rather than each plugin.
  const sessionCooldowns = ctx.tradeCooldowns.get(sessionId);
  if (sessionCooldowns) {
    const lastSellTime = sessionCooldowns.get(symbol);
    if (lastSellTime) {
      const minutesSinceSell = (Date.now() - lastSellTime) / (1000 * 60);
      if (minutesSinceSell < ctx.TRADE_COOLDOWN_MINUTES) {
        tradingLogger.logRisk('Cooldown active', {
          sessionId,
          sessionName: session.name,
          reason: `${symbol} sold ${minutesSinceSell.toFixed(1)} min ago`,
          value: minutesSinceSell,
          threshold: ctx.TRADE_COOLDOWN_MINUTES,
          symbol,
        });
        return {
          shouldEnter: false,
          reason: `Cooldown: ${(ctx.TRADE_COOLDOWN_MINUTES - minutesSinceSell).toFixed(0)} min remaining`,
          cooldownRemaining: ctx.TRADE_COOLDOWN_MINUTES - minutesSinceSell,
        };
      }
    }
  }

  // Signal funnel: count every evaluation that clears the cooldown gate.
  if (session.stats) {
    session.stats.signalsEvaluated = (session.stats.signalsEvaluated || 0) + 1;
  }

  // Dispatch to the broker's strategy plugin. The plugin owns the full
  // signal-to-decision logic and returns the decision object.
  const plugin = strategies.resolve(session.config);
  const decision = await plugin.evaluate(session, symbol, ctx);

  // Funnel: a decision that clears all of the plugin's gates "passed".
  // signalsEntered is incremented downstream when an order actually executes.
  if (decision && decision.shouldEnter && session.stats) {
    session.stats.signalsPassed = (session.stats.signalsPassed || 0) + 1;
  }

  return decision;
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

  // Plugin-owned exit: strategies whose exit is a signal, not a price level
  // (e.g. trend-following exits on a trend break, never on stop/target/EOD),
  // provide their own evaluateExit. When present, it GOVERNS — the universal
  // technical exit below is bypassed. Returns null on a data failure so the
  // engine's force-exit failure-counter backstop still applies.
  const plugin = strategies.resolve(session.config);
  if (typeof plugin.evaluateExit === 'function') {
    try {
      const d = await plugin.evaluateExit(session, symbol, position, ctx);
      if (d && typeof d.shouldExit === 'boolean') {
        if (d.shouldExit) {
          ctx.logDecision(sessionId, d);
          tradingLogger.logSignal('EXIT', symbol, {
            sessionId,
            sessionName: session.name,
            reasons: d.reasons || [d.exitReason],
            currentPrice: d.currentPrice,
            shouldExit: true,
            pnlPercent: d.pnlPercent,
          });
          websocketServer.sendAIDecision(session.userId, {
            ...d,
            sessionName: session.name,
          });
        }
        ctx.exitEvalFailCounts.delete(`${sessionId}:${symbol}`);
        return d;
      }
    } catch (err) {
      tradingLogger.logError(`Plugin exit failed for ${symbol}`, {
        sessionId,
        symbol,
        error: err.message,
      });
      // fall through to universal exit on error
    }
  }

  try {
    // Get recent candles first (needed for regime detection)
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
    const currentPrice =
      wsExitPrice && !wsExitPrice.isStale
        ? wsExitPrice.price
        : candles[candles.length - 1].close;
    const pnlPercent = position.unrealizedPnLPercent;

    // Emergency stop-loss check — BEFORE minimum hold time gate.
    // A 3x ETF can move 5%+ in 30 minutes; stop-loss must never be gated by hold time.
    const cfg = session.config;
    const leverage = ctx.getEtfLeverage(symbol);
    // Leverage-scale the stop to match the WS fast-path (aiTradingEngine
    // ~:3973). Previously this path used the raw stop while the WS path scaled
    // it, so a 3x ETF's effective stop was non-deterministic (-1% vs -3%) and
    // asymmetric with the already-scaled take-profit.
    const rawStopLoss = cfg.stopLossPercent || 1;
    const stopLossPercent =
      leverage > 1
        ? Math.max(rawStopLoss, rawStopLoss * leverage)
        : rawStopLoss;

    if (pnlPercent <= -stopLossPercent) {
      tradingLogger.logRisk('STOP LOSS during hold period', {
        sessionId,
        sessionName: session.name,
        symbol,
        reason: `${pnlPercent.toFixed(2)}% <= -${stopLossPercent}%`,
        value: pnlPercent,
        threshold: -stopLossPercent,
        action: 'Exiting immediately',
      });
      return {
        shouldExit: true,
        confidence: 100,
        exitReason: `Stop loss triggered (${pnlPercent.toFixed(2)}%)`,
        factors: [
          `STOP LOSS -${stopLossPercent}% triggered (at ${pnlPercent.toFixed(2)}%)`,
        ],
        currentPrice,
        pnlPercent,
        isPartialExit: false,
      };
    }

    // Minimum hold time - use session config (default: 30 min normal, 15 min counter-trend)
    // Use || to ensure 0 falls back to default (0 min hold is dangerous)
    // NOTE: Stop-loss exits above bypass this gate entirely
    const configMinHold = session.config.minHoldMinutes || 30;
    const configCounterTrendHold =
      session.config.counterTrendMinHoldMinutes || 15;
    const MIN_HOLD_MINUTES = isPositionCounterTrend
      ? configCounterTrendHold
      : configMinHold;
    // FIX: Default to Date.now() if entryTime is undefined/null to prevent NaN hold calculations
    let entryTime = position.entryTime || position.createdAt;
    if (!entryTime) {
      entryTime = Date.now();
      tradingLogger.logRisk('entryTime undefined', {
        sessionId,
        sessionName: session.name,
        symbol,
        reason: `${symbol}: entryTime is undefined, defaulting to now — hold-time gate bypassed`,
        action: 'Using Date.now() as fallback',
      });
    }
    if (entryTime) {
      const holdDuration = Date.now() - new Date(entryTime).getTime();
      const holdMinutes = holdDuration / (1000 * 60);
      if (holdMinutes < MIN_HOLD_MINUTES) {
        tradingLogger.logInfo(
          `[AI Engine] ${symbol}: Holding for ${holdMinutes.toFixed(1)} min (min: ${MIN_HOLD_MINUTES} min${isPositionCounterTrend ? ' [counter-trend]' : ''})`,
          { sessionId, sessionName: session.name, symbol }
        );
        return { shouldExit: false, reason: 'Minimum hold time not reached' };
      }
    }

    // Max hold (multi-day strategies only): force an exit after N days so a
    // stale multi-day thesis doesn't linger forever. Purely additive — intraday
    // plugins never set cfg.maxHoldDays, so this is a no-op for them.
    const maxHoldDays = session.config.maxHoldDays;
    if (maxHoldDays && entryTime) {
      const holdDays =
        (Date.now() - new Date(entryTime).getTime()) / (24 * 60 * 60 * 1000);
      if (holdDays >= maxHoldDays) {
        tradingLogger.logRisk('Max hold reached', {
          sessionId,
          sessionName: session.name,
          symbol,
          reason: `${holdDays.toFixed(1)}d >= ${maxHoldDays}d`,
          value: holdDays,
          threshold: maxHoldDays,
          action: 'Force exit',
        });
        return {
          shouldExit: true,
          confidence: 100,
          exitReason: `Max hold ${maxHoldDays}d reached (${holdDays.toFixed(1)}d)`,
          factors: [`MAX HOLD ${maxHoldDays}d reached`],
          currentPrice,
          pnlPercent,
          isPartialExit: false,
        };
      }
    }

    const factors = [];
    let exitScore = 0;
    let criticalExitScore = 0;
    let exitReason = '';

    // Config and leverage already computed above (before hold time gate)
    const rawTakeProfit = cfg.takeProfitPercent || 2;
    const takeProfitPercent =
      leverage > 1
        ? Math.max(rawTakeProfit, rawTakeProfit * leverage)
        : rawTakeProfit;
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
        criticalExitScore += tpScore; // Profit targets are structural — never dampen
        exitReason = alreadyPartial
          ? 'Remainder profit target'
          : 'Profit target reached';
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
        criticalExitScore += 35; // Trailing stop is structural — never dampen
        exitReason = 'Trailing stop triggered';
        factors.push(
          `Trailing stop (locked ${lockedInGainPercent.toFixed(2)}% of ${highWaterMarkPnlPercent.toFixed(2)}% gain)`
        );
      }
    } else if (
      trailingStopOfTP > 0 &&
      pnlPercent > 0 &&
      highWaterMarkPnlPercent < trailingStopMinProfitPercent
    ) {
      // Log that trailing stop is waiting for minimum profit
      factors.push(
        `Trailing stop waiting (need ${trailingStopMinProfitPercent}% gain, have ${highWaterMarkPnlPercent.toFixed(2)}%)`
      );
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
    const exitBeforeCloseMinutes =
      leverage > 1 ? Math.max(configEodMin, 30) : configEodMin;
    const exitBeforeClose = cfg.exitBeforeClose !== false; // Default true

    if (
      exitBeforeClose &&
      minutesUntilClose > 0 &&
      minutesUntilClose <= exitBeforeCloseMinutes
    ) {
      // Force exit regardless of P&L when approaching market close
      exitScore += 100; // Guaranteed exit - don't hold overnight
      criticalExitScore += 100;
      exitReason = `End-of-day exit (${minutesUntilClose.toFixed(0)} min until close)`;
      factors.push(`EOD EXIT: ${minutesUntilClose.toFixed(0)} min until close`);
    } else if (
      exitBeforeClose &&
      minutesUntilClose > 0 &&
      minutesUntilClose <= 30
    ) {
      // Strong signal to exit within 30 min of close
      exitScore += 50;
      criticalExitScore += 50;
      factors.push(
        `Approaching market close (${minutesUntilClose.toFixed(0)} min)`
      );
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
      factors.push(
        `Warning: Counter-trend position: ${etfType} ETF in ${marketRegime} market`
      );

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
    const shouldDampenExits =
      pnlPercent > 0 &&
      indicators.adx.trending &&
      ctx.isRegimeAligned(etfType, marketRegime) &&
      baseDampeningFactor < 1.0;

    if (shouldDampenExits) {
      const dampenableScore = exitScore - criticalExitScore;
      if (dampenableScore > 0) {
        // Scale dampening by profit depth relative to take-profit target
        const takeProfitPct = cfg.takeProfitPercent || 2;
        const profitDepth = Math.min(pnlPercent / takeProfitPct, 2.0); // Cap at 2x target
        const trendDampeningFactor = Math.max(
          0.2,
          baseDampeningFactor * (1 - profitDepth * 0.3)
        );
        const originalExitScore = exitScore;
        const dampenedScore = Math.round(
          dampenableScore * trendDampeningFactor
        );
        exitScore = criticalExitScore + dampenedScore;
        factors.push(
          `Trend dampening: ${originalExitScore}->${exitScore} (ADX trending, ${marketRegime} regime, factor=${trendDampeningFactor.toFixed(2)}, depth=${profitDepth.toFixed(1)}x)`
        );
      }
    }

    // MINIMUM PROFIT PROTECTION: Don't exit with tiny profits due to weak signals
    // If profit is positive but under minimum threshold, require MUCH higher exit score
    // (Stop loss at 100 pts still works, but technical signals alone won't trigger exit)
    // Leverage-aware: 3x ETFs keep 1.5% (0.5% * 3), regular stocks use 0.5%
    const minProfitForExit = cfg.minProfitForExitPercent || 0.5 * leverage; // Scales with leverage
    const isProfitTooSmall = pnlPercent > 0 && pnlPercent < minProfitForExit;
    const effectiveExitThreshold = isProfitTooSmall ? 95 : 70; // Raised 50->70: non-critical exits require stronger confluence

    if (isProfitTooSmall && exitScore >= 70 && exitScore < 95) {
      factors.push(
        `Hold - profit ${pnlPercent.toFixed(2)}% too small (need ${minProfitForExit}% or stop loss)`
      );
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

    tradingLogger.logError(
      `Exit evaluation failed for ${symbol} (failure ${failures}/${ctx.EXIT_EVAL_MAX_FAILURES})`,
      {
        sessionId,
        sessionName: session?.name,
        symbol,
        error: error.message,
        consecutiveFailures: failures,
      }
    );

    // INVARIANT: never liquidate on a dead price feed. A failed exit evaluation
    // means we have NO trustworthy price, so any exit here is priced blind.
    // The old behavior force-sold after 3 failures — which dumped overnight
    // holds into the gap-down open (the single largest realized-loss driver,
    // ~$1.2k of the cohort's bleed) AND corrupted per-source edge stats by
    // booking data-outage losses against the strategy. Instead we HOLD and
    // escalate a risk alert so a human can intervene; normal exit logic resumes
    // automatically the moment the feed recovers (the success path above resets
    // this counter). The position is never silently abandoned — it is loudly
    // flagged. A data failure is not a thesis break.
    if (failures >= ctx.EXIT_EVAL_MAX_FAILURES) {
      // Alert on the threshold crossing and every EXIT_EVAL_MAX_FAILURES cycles
      // thereafter, so a prolonged outage escalates without spamming the log.
      if (failures % ctx.EXIT_EVAL_MAX_FAILURES === 0) {
        tradingLogger.logRisk('DATA FEED DOWN — HOLDING (no blind exit)', {
          sessionId,
          sessionName: session?.name,
          symbol,
          reason: `${failures} consecutive exit-eval failures (price feed unavailable)`,
          value: failures,
          threshold: ctx.EXIT_EVAL_MAX_FAILURES,
          action:
            'Holding position; refusing to exit on a stale/dead quote. Manual review advised.',
        });
        websocketServer.broadcastToAll('trading_log', {
          id: `${Date.now()}-feeddown-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
          level: 'WARNING',
          category: 'RISK',
          symbol,
          sessionId,
          sessionName: session?.name,
          message: `DATA FEED DOWN: ${symbol} un-evaluable for ${failures} cycles — HOLDING, no blind liquidation. Manual review advised.`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Hold through the outage — a data failure is never an exit signal.
    return {
      shouldExit: false,
      reason: `hold (exit eval failed, feed unavailable: ${error.message})`,
    };
  }
}

/**
 * Stateless symbol evaluator for the scanner. Returns the same shape
 * fields as evaluateEntry but without session dependency. Uses default
 * config (momentum entry strategy, 1.5x volume threshold, RSI 30/70).
 *
 * Returns { confidence, signalCount, signalScore, shouldEnter, reasons }.
 * Confidence is bounded 50-95 like the live engine.
 */
function evaluateSymbolStateless(symbol, candles, indicators) {
  if (!indicators || !indicators.rsi) {
    return {
      confidence: 50,
      signalCount: 0,
      signalScore: 0,
      shouldEnter: false,
      reasons: ['no indicators'],
    };
  }

  const SIGNAL_WEIGHTS = {
    strategyMatch: 20,
    volumeSpike: 15,
    rsiSignal: 12,
    macdConfirmation: 8,
    bollingerOversold: 10,
  };

  const factors = [];
  let signalCount = 0;
  let signalScore = 0;
  let strategyMatch = false;

  const rsiValue = indicators.rsi.value;
  const volumeRatio = indicators.volume?.ratio ?? 1;
  const hasVolumeSpike = volumeRatio >= 1.5;
  const macdBullish = !!(
    indicators.macd?.bullish || indicators.macd?.crossover
  );
  const bbPercentB = indicators.bollingerBands?.percentB;

  // Strategy match: momentum-style entry (RSI 50-65) is the default;
  // we also accept dip-style (RSI < 45 + below VWAP) for scanner breadth.
  if (rsiValue > 50 && rsiValue < 65) {
    strategyMatch = true;
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.strategyMatch;
    factors.push(`RSI momentum zone (${rsiValue.toFixed(1)})`);
  } else if (rsiValue < 45 && indicators.vwap && candles?.length) {
    const lastClose = candles[candles.length - 1].close;
    const vwapValue = indicators.vwap.value || indicators.vwap.price;
    if (vwapValue && lastClose < vwapValue) {
      strategyMatch = true;
      signalCount += 2;
      signalScore += SIGNAL_WEIGHTS.strategyMatch;
      factors.push(`RSI dip (${rsiValue.toFixed(1)}) + below VWAP`);
    }
  }

  if (hasVolumeSpike) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.volumeSpike;
    factors.push(`Volume ${volumeRatio.toFixed(2)}x`);
  }

  if (indicators.rsi.divergence?.bullish) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.rsiSignal;
    factors.push('Bullish RSI divergence');
  } else if (rsiValue < 40) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.rsiSignal;
    factors.push('RSI oversold zone');
  }

  if (macdBullish) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.macdConfirmation;
    factors.push(
      indicators.macd.crossover ? 'MACD bullish crossover' : 'MACD bullish'
    );
  }

  if (Number.isFinite(bbPercentB) && bbPercentB < 0.2) {
    signalCount++;
    signalScore += SIGNAL_WEIGHTS.bollingerOversold;
    factors.push('Near lower Bollinger Band');
  }

  const confidence = Math.min(50 + signalScore, 95);
  const shouldEnter = strategyMatch && signalCount >= 2 && confidence >= 65;

  return {
    confidence,
    signalCount,
    signalScore,
    shouldEnter,
    reasons: factors,
  };
}

module.exports = { init, evaluateEntry, evaluateExit, evaluateSymbolStateless };
