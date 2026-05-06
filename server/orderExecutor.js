/**
 * Order Executor Module
 *
 * Executes entry and exit orders against Alpaca.
 * Extracted from aiTradingEngine.js for modularity.
 *
 * Receives shared state via init() context pattern — all module-level
 * variables from the engine are accessed through ctx.
 */

const { v4: uuidv4 } = require('uuid');
const { differenceInMinutes, parseISO } = require('date-fns');
const alpacaClient = require('./alpacaClient');
const tradingLogger = require('./tradingLogger');
const websocketServer = require('./websocketServer');
const assetUtils = require('./assetUtils');

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
 * Execute entry trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Entry decision
 */
async function executeEntry(sessionId, symbol, decision) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return;

  // Check if auto-trade is enabled
  if (!session.config.autoTrade) {
    websocketServer.sendAlert(session.userId, {
      type: 'info',
      title: 'Trade Signal',
      message: `[${session.name}] BUY signal for ${symbol} (${decision.confidence}% confidence). Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true,
    });
    return;
  }

  // SIMULATION MODE GATE: Log the signal but do NOT place real orders
  if (session.config.simulationMode) {
    tradingLogger.logInfo(`[AI Engine] SIMULATION: Would BUY ${symbol} (${decision.confidence}% confidence) — skipping real order`, { sessionId, sessionName: session.name, symbol });
    // Record the trade in session stats for virtual tracking
    session.stats.totalTrades = (session.stats.totalTrades || 0) + 1;
    session.stats.simTrades = (session.stats.simTrades || 0) + 1;
    return;
  }

  try {
    // Get the trading mode for this session (needed for all Alpaca calls)
    const tradingMode = ctx.getSessionTradingMode(session);

    // PDT PROTECTION: Check if we can day trade before buying in live mode
    // This prevents buying stocks we won't be able to sell same-day due to PDT rules
    // NOTE: PDT rules do NOT apply to crypto (crypto is commodity, not security)
    const assetType = session.config.assetType || 'stocks';
    if (tradingMode === 'live' && assetUtils.pdtApplies(assetType)) {
      try {
        const pdtStatus = await alpacaClient.getPDTStatus('live');

        // If we can't day trade, log risk warning and either block or proceed with caution
        if (!pdtStatus.canDayTrade) {
          tradingLogger.logRisk('PDT LIMIT REACHED', {
            sessionId,
            sessionName: session.name,
            reason: `Day trade limit reached (${pdtStatus.daytradeCount}/${pdtStatus.daytradeLimit})`,
            value: pdtStatus.daytradeCount,
            threshold: pdtStatus.daytradeLimit,
            action: 'Blocking day trade entry - position would need overnight hold',
          });

          websocketServer.sendAlert(session.userId, {
            type: 'warning',
            title: 'PDT Protection',
            message: `[${session.name}] Skipping ${symbol} buy - PDT limit reached (${pdtStatus.daytradeCount}/3). Any new position must be held overnight.`,
            severity: 'high',
            sessionId: session.sessionId,
            sessionName: session.name,
          });

          // Block the trade - can't day trade
          return;
        }

        // Warn if we're getting close to PDT limit
        if (pdtStatus.pdtWarning) {
          tradingLogger.logRisk('PDT WARNING', {
            sessionId,
            sessionName: session.name,
            reason: `Low day trades remaining (${pdtStatus.daytradesRemaining} left)`,
            value: pdtStatus.daytradeCount,
            threshold: pdtStatus.daytradeLimit,
            action: 'Proceeding with caution - consider swing trading',
          });

          websocketServer.sendAlert(session.userId, {
            type: 'warning',
            title: 'PDT Warning',
            message: `[${session.name}] Only ${pdtStatus.daytradesRemaining} day trade(s) remaining. Consider swing trading.`,
            severity: 'medium',
            sessionId: session.sessionId,
            sessionName: session.name,
          });
        }
      } catch (pdtError) {
        // Log but don't block - PDT check is advisory
        tradingLogger.logError('[AI Engine] PDT check failed', { sessionId, sessionName: session.name, symbol, error: pdtError.message });
      }
    }

    // Calculate position size (guard against NaN from corrupted position data)
    const positionsMarketValue = Array.from(session.portfolio.positions.values()).reduce(
      (sum, p) => sum + (parseFloat(p.marketValue) || 0),
      0
    );
    const portfolioValue = (parseFloat(session.portfolio.cash) || 0) + positionsMarketValue;

    // Ensure we have valid portfolio value (fetch from Alpaca if needed)
    let effectivePortfolioValue = portfolioValue;
    if (!effectivePortfolioValue || effectivePortfolioValue < 1000) {
      // Fallback: fetch from Alpaca directly using session-specific mode
      try {
        const account = await alpacaClient.getAccount(tradingMode);
        effectivePortfolioValue =
          parseFloat(account.equity) ||
          parseFloat(account.portfolio_value) ||
          (session.config.allocatedCapital || 100000);
        session.portfolio.cash = parseFloat(account.cash) || 0;
        tradingLogger.logInfo(`[AI Engine] Fetched account value (${tradingMode.toUpperCase()}): $${effectivePortfolioValue.toFixed(2)}`, { sessionId, sessionName: session.name });
      } catch (e) {
        // FIX: Use session's allocatedCapital instead of hardcoded $100k
        effectivePortfolioValue = session.config.allocatedCapital || 100000;
        tradingLogger.logRisk('Using default portfolio value', { sessionId, sessionName: session.name, reason: 'Account fetch failed', value: effectivePortfolioValue, action: `Using $${effectivePortfolioValue.toLocaleString()} default` });
      }
    }

    // SAFETY: Cap portfolio value at session's allocatedCapital to prevent oversized positions
    const allocatedCap = session.config.allocatedCapital;
    if (allocatedCap && allocatedCap > 0 && effectivePortfolioValue > allocatedCap) {
      tradingLogger.logRisk('Portfolio value capped', { sessionId, sessionName: session.name, symbol, reason: `Capped by allocatedCapital: $${effectivePortfolioValue.toFixed(0)} -> $${allocatedCap}`, value: effectivePortfolioValue, threshold: allocatedCap });
      effectivePortfolioValue = allocatedCap;
    }

    // Cap per-position size at the global maximum
    const sessionMaxPercent = session.config.maxPositionSizePercent || 10;
    const effectiveMaxPercent = Math.min(sessionMaxPercent, ctx.GLOBAL_MAX_POSITION_PERCENT);

    // Confidence-scaled position sizing: scale between base (8%) and effectiveMaxPercent
    const entryConfidence = decision.confidence || 70;
    const confidenceScale = Math.min(Math.max((entryConfidence - 60) / 30, 0), 1.0);
    const basePositionPercent = 8;
    const scaledMaxPercent = basePositionPercent + (effectiveMaxPercent - basePositionPercent) * confidenceScale;
    let maxPositionValue = effectivePortfolioValue * (scaledMaxPercent / 100);

    tradingLogger.logInfo(`[AI Engine] Position size: confidence=${entryConfidence}%, scale=${confidenceScale.toFixed(2)}, ${scaledMaxPercent.toFixed(1)}% of $${effectivePortfolioValue.toFixed(0)} = $${maxPositionValue.toFixed(0)}`, { sessionId, sessionName: session.name, symbol });

    if (sessionMaxPercent > ctx.GLOBAL_MAX_POSITION_PERCENT) {
      tradingLogger.logRisk('Position size capped', { sessionId, sessionName: session.name, symbol, reason: `${sessionMaxPercent}% -> ${effectiveMaxPercent}%`, value: sessionMaxPercent, threshold: ctx.GLOBAL_MAX_POSITION_PERCENT });
    }

    // Check total exposure across all sessions
    // Use actual account equity as denominator (not session's allocatedCapital)
    // to avoid falsely blocking entries when other sessions hold positions
    const { positionsBySymbol } = ctx.getGlobalPositionExposure();
    let totalExposure = 0;
    for (const [, holders] of positionsBySymbol) {
      for (const h of holders) {
        const mv = h.marketValue || 0;
        if (!isNaN(mv)) totalExposure += mv;
      }
    }
    let accountEquity = effectivePortfolioValue;
    try {
      const acct = await alpacaClient.getAccount(tradingMode);
      accountEquity = parseFloat(acct.equity) || effectivePortfolioValue;
    } catch (_) { /* use effectivePortfolioValue as fallback */ }
    const totalExposurePercent = accountEquity > 0
      ? (totalExposure / accountEquity) * 100
      : 0;
    if (totalExposurePercent >= ctx.GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT) {
      tradingLogger.logRisk('Total exposure cap', { sessionId, sessionName: session.name, symbol, reason: `${totalExposurePercent.toFixed(1)}% >= ${ctx.GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT}% cap`, value: totalExposurePercent, threshold: ctx.GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT, action: `Blocking ${symbol} entry` });
      return;
    }
    // Reduce max position value if approaching total exposure limit
    const remainingCapacity = (ctx.GLOBAL_MAX_TOTAL_EXPOSURE_PERCENT - totalExposurePercent) / 100 * effectivePortfolioValue;
    if (remainingCapacity > 0) {
      maxPositionValue = Math.min(maxPositionValue, remainingCapacity);
    }

    // Enforce hard dollar cap from session config (maxPositionSize)
    const maxPositionSizeDollars = session.config.maxPositionSize;
    if (maxPositionSizeDollars && maxPositionSizeDollars > 0 && maxPositionValue > maxPositionSizeDollars) {
      tradingLogger.logRisk('Position size capped by maxPositionSize', { sessionId, sessionName: session.name, symbol, reason: `$${maxPositionValue.toFixed(0)} -> $${maxPositionSizeDollars}`, value: maxPositionValue, threshold: maxPositionSizeDollars });
      maxPositionValue = maxPositionSizeDollars;
    }

    // Guard: ensure maxPositionValue is a valid positive number
    if (!maxPositionValue || isNaN(maxPositionValue) || maxPositionValue <= 0) {
      tradingLogger.logError(`[AI Engine] Invalid maxPositionValue for ${symbol}`, { sessionId, sessionName: session.name, symbol, error: `$${maxPositionValue}, portfolioValue=$${effectivePortfolioValue.toFixed(2)}, exposure=${totalExposurePercent.toFixed(1)}%` });
      return;
    }

    const riskAmount =
      effectivePortfolioValue * ((session.config.riskPerTradePercent || 2) / 100);

    // Position size based on ATR/risk (with fallback if stopLoss not set)
    let quantity;
    const currentPrice = parseFloat(decision.currentPrice);
    const isCrypto = assetUtils.isCrypto(assetType);

    if (!currentPrice || currentPrice <= 0) {
      tradingLogger.logError(`[AI Engine] Invalid price for ${symbol}`, { sessionId, sessionName: session.name, symbol, error: `price=${decision.currentPrice}` });
      return;
    }

    if (
      decision.stopLoss &&
      decision.stopLoss > 0 &&
      decision.stopLoss < currentPrice
    ) {
      // Risk-based position sizing
      const riskPerShare = currentPrice - decision.stopLoss;
      if (isCrypto) {
        // Crypto supports fractional shares - use precise calculation
        const sharesFromRisk = riskAmount / riskPerShare;
        const sharesFromMaxSize = maxPositionValue / currentPrice;
        quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
      } else {
        const sharesFromRisk = Math.floor(riskAmount / riskPerShare);
        const sharesFromMaxSize = Math.floor(maxPositionValue / currentPrice);
        quantity = Math.min(sharesFromRisk, sharesFromMaxSize);
      }
    } else {
      // Fallback: simple max position size based sizing
      if (isCrypto) {
        // Crypto supports fractional shares
        quantity = maxPositionValue / currentPrice;
      } else {
        quantity = Math.floor(maxPositionValue / currentPrice);
      }
    }

    // Early NaN guard — Math.max(1, NaN) returns NaN, not 1
    if (isNaN(quantity) || !isFinite(quantity)) {
      tradingLogger.logError('NaN position size before rounding', {
        sessionId, sessionName: session.name, symbol,
        quantity, maxPositionValue, currentPrice,
        effectivePortfolioValue, riskAmount,
      });
      return;
    }

    // For crypto, allow fractional quantities (round to 8 decimal places for precision)
    // For stocks, ensure minimum of 1 share, maximum reasonable amount
    if (isCrypto) {
      // Round to 8 decimal places (standard for crypto)
      quantity = Math.round(quantity * 100000000) / 100000000;
      // Ensure we have at least $10 worth of the asset (Alpaca minimum)
      const minQuantity = 10 / currentPrice;
      if (quantity < minQuantity) {
        tradingLogger.logInfo(`Position too small for ${symbol}: $${(quantity * currentPrice).toFixed(2)} (min $10)`, { sessionId, sessionName: session.name, symbol });
        return;
      }
    } else {
      quantity = Math.max(1, Math.min(quantity, 1000));
    }

    if (quantity <= 0 || isNaN(quantity)) {
      tradingLogger.logError('Invalid position size after rounding', {
        sessionId, sessionName: session.name, symbol, quantity,
      });
      return;
    }

    // Format quantity for logging (crypto shows decimals, stocks show whole numbers)
    const qtyDisplay = isCrypto ? quantity.toFixed(6) : quantity;
    const orderValue = quantity * currentPrice;
    tradingLogger.logInfo(`[AI Engine] Calculated position: ${qtyDisplay} ${isCrypto ? 'units' : 'shares'} of ${symbol} @ $${currentPrice.toFixed(2)} (max: $${maxPositionValue.toFixed(2)}, ${tradingMode.toUpperCase()})`, { sessionId, sessionName: session.name, symbol });

    // Pre-check buying power to avoid Alpaca rejection
    // Paper mode: use regular buying_power (not daytrading_buying_power which may be $0)
    // Live mode: use daytrading_buying_power for intraday trades
    try {
      const account = await alpacaClient.getAccount(tradingMode);
      // Crypto cannot be bought on margin — use non_marginable_buying_power
      const availableBuyingPower = isCrypto
        ? parseFloat(account.non_marginable_buying_power) || parseFloat(account.cash) || 0
        : tradingMode === 'paper'
          ? parseFloat(account.buying_power) || 0
          : parseFloat(account.daytrading_buying_power) || parseFloat(account.buying_power) || 0;

      if (orderValue > availableBuyingPower) {
        tradingLogger.logRisk('Insufficient buying power', { sessionId, sessionName: session.name, symbol, reason: `Need $${orderValue.toFixed(2)}, have $${availableBuyingPower.toFixed(2)}`, value: orderValue, threshold: availableBuyingPower, action: 'Reducing position size' });
        // Reduce quantity to fit available buying power (use 98% to avoid rounding overshoot)
        const safeBuyingPower = availableBuyingPower * 0.98;
        const maxAffordableQty = isCrypto
          ? safeBuyingPower / currentPrice
          : Math.floor(safeBuyingPower / currentPrice);

        if (maxAffordableQty < 1 || (isCrypto && maxAffordableQty * currentPrice < 10)) {
          tradingLogger.logInfo(`[AI Engine] Cannot afford minimum position for ${symbol}, skipping`, { sessionId, sessionName: session.name, symbol });
          return;
        }

        quantity = maxAffordableQty;
        tradingLogger.logInfo(`[AI Engine] Reduced position to ${quantity} ${isCrypto ? 'units' : 'shares'} to fit buying power`, { sessionId, sessionName: session.name, symbol });
      }
    } catch (bpError) {
      tradingLogger.logError('[AI Engine] Buying power check failed', { sessionId, sessionName: session.name, symbol, error: `${bpError.message} - skipping entry` });
      return;
    }

    // Check for pending order to prevent duplicate buys during race conditions
    if (!ctx.pendingOrders.has(sessionId)) {
      ctx.pendingOrders.set(sessionId, new Map());
    }
    const sessionPending = ctx.pendingOrders.get(sessionId);
    const existingPending = sessionPending.get(symbol);
    if (existingPending) {
      const elapsed = Date.now() - existingPending.timestamp;
      if (elapsed < ctx.PENDING_ORDER_TIMEOUT_MS) {
        tradingLogger.logRisk('Duplicate order blocked', { sessionId, sessionName: session.name, symbol, reason: `Order ${existingPending.orderId.slice(0, 8)} pending (${(elapsed / 1000).toFixed(1)}s ago)` });
        return;
      }
      // Clear stale pending order
      sessionPending.delete(symbol);
    }

    // Mark order as pending before placing
    sessionPending.set(symbol, { orderId: 'pending', timestamp: Date.now() });

    // Place order via Alpaca with session-specific trading mode
    // Use asset-type-aware helper for crypto/stock routing
    let order;
    try {
      order = await ctx.placeOrderForAsset(
        {
          symbol,
          qty: quantity,
          side: 'buy',
          type: 'market',
          time_in_force: 'day',
          _sessionAllowsExtendedHours: session.config?.extendedHours === true,
          _referencePrice: decision.currentPrice,
        },
        tradingMode,
        assetType
      );
      // Update pending order with actual order ID
      sessionPending.set(symbol, { orderId: order.id, timestamp: Date.now() });
    } catch (orderError) {
      // Clear pending on failure
      sessionPending.delete(symbol);
      throw orderError;
    }

    tradingLogger.logExecution('BUY_ORDER', symbol, { quantity, price: decision.currentPrice, sessionId, sessionName: session.name, reason: `Market order (${tradingMode.toUpperCase()})` });

    // Poll for actual fill price (market orders fill quickly)
    let filledPrice = decision.currentPrice; // fallback to signal price
    let filledOrder = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500)); // wait 500ms
      try {
        filledOrder = await alpacaClient.getOrderById(order.id, tradingMode);
        if (filledOrder.status === 'filled' && filledOrder.filledAvgPrice) {
          filledPrice = filledOrder.filledAvgPrice;
          // Clear pending order now that it's filled
          sessionPending.delete(symbol);
          tradingLogger.logInfo(`[AI Engine] Order filled: ${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (signal was $${decision.currentPrice.toFixed(2)})`, { sessionId, sessionName: session.name, symbol });
          break;
        }
      } catch (err) {
        // Order might not be ready yet, continue polling
      }
    }

    // Log execution to trading logger with actual fill price
    tradingLogger.logExecution('BUY', symbol, {
      quantity,
      price: filledPrice,
      signalPrice: decision.currentPrice,
      orderId: order.id,
      sessionId,
      sessionName: session.name,
      reason: decision.reasons?.slice(0, 2).join(', '),
    });

    // Store entry context for ML learning - correlate entry conditions with trade outcomes
    if (!ctx.entryContexts.has(sessionId)) {
      ctx.entryContexts.set(sessionId, new Map());
    }
    ctx.entryContexts.get(sessionId).set(symbol, {
      entryTime: new Date().toISOString(),
      entryPrice: filledPrice, // Use actual fill price
      signalPrice: decision.currentPrice,
      quantity,
      confidence: decision.confidence,
      reasons: decision.reasons || [],
      indicators: decision.indicators || {},
      profitTarget: decision.profitTarget,
      stopLoss: decision.stopLoss,
      regime: decision.regime,
      tradingMode,
    });

    // Send notification with actual fill price
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: order.id,
      symbol,
      side: 'buy',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      status: filledOrder?.status === 'filled' ? 'filled' : 'submitted',
      sessionName: session.name,
      sessionId: session.sessionId,
    });

    // Store alert and trade in session for persistence with actual fill price
    ctx.addSessionAlert(session.sessionId, {
      type: 'success',
      title: 'Trade BUY',
      message: `${quantity} ${symbol} @ $${filledPrice.toFixed(2)}`,
    });
    ctx.addSessionTrade(session.sessionId, {
      symbol,
      side: 'buy',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
    });

    // Update stats
    session.stats.totalTrades++;

    // Sync portfolio after trade
    setTimeout(() => ctx.syncPortfolio(sessionId), 2000);
  } catch (error) {
    const errorMsg = error.message || '';

    // Identify PDT/buying power errors for throttling
    const isPDTError = errorMsg.includes('day trading') ||
                       errorMsg.includes('buying power') ||
                       errorMsg.includes('insufficient');

    // Throttle repeated PDT errors to avoid log spam
    if (isPDTError) {
      if (!ctx.shouldThrottleError(sessionId, `pdt_error_${symbol}`)) {
        tradingLogger.logError(`BUY order blocked (PDT) for ${symbol}`, {
          sessionId,
          sessionName: session.name,
          symbol,
          error: errorMsg,
        });
        websocketServer.sendAlert(session.userId, {
          type: 'warning',
          title: 'PDT Limit',
          message: `[${session.name}] Cannot buy ${symbol}: ${errorMsg}`,
          severity: 'medium',
        });
      }
    } else {
      // Non-PDT errors always log (but still throttle if repeated)
      if (!ctx.shouldThrottleError(sessionId, errorMsg)) {
        tradingLogger.logError(`BUY order failed for ${symbol}`, {
          sessionId,
          sessionName: session.name,
          symbol,
          error: errorMsg,
        });
        websocketServer.sendAlert(session.userId, {
          type: 'error',
          title: 'Order Failed',
          message: `[${session.name}] Failed to buy ${symbol}: ${errorMsg}`,
          severity: 'high',
        });
      }
    }
  }
}

/**
 * Execute exit trade
 * @param {string} sessionId - Session identifier
 * @param {string} symbol - Stock symbol
 * @param {object} decision - Exit decision
 */
async function executeExit(sessionId, symbol, decision) {
  const session = ctx.sessions.get(sessionId);
  if (!session) return;

  // Per-symbol exit lock: prevents multiple sessions racing to SELL the same
  // Alpaca position in one tick ("insufficient qty available" errors).
  const exitCheck = ctx.canExitGlobally(symbol, sessionId);
  if (!exitCheck.allowed) {
    tradingLogger.logInfo(`[AI Engine] Exit for ${symbol} blocked — in-flight by another session; will retry next tick`, { sessionId, sessionName: session?.name, symbol });
    return;
  }
  ctx.claimExitLock(symbol, sessionId);

  try {
  // Determine if this is a stop loss exit (critical risk management)
  const isStopLoss = decision.exitReason?.toLowerCase().includes('stop loss') ||
                     decision.reason?.toLowerCase().includes('stop loss') ||
                     (decision.reasons && decision.reasons.some(f => f.toLowerCase().includes('stop loss')));

  // Determine if this is an end-of-day exit
  const isEodExit = decision.exitReason?.toLowerCase().includes('end-of-day') ||
                    decision.reason?.toLowerCase().includes('end-of-day');

  // Check if auto-trade is enabled (or if stop loss/EOD override is allowed)
  const allowStopLossExit = session.config.allowStopLossExit !== false; // Default true
  const allowEodExit = session.config.exitBeforeClose !== false; // Default true
  const isEmergencyExit = (isStopLoss && allowStopLossExit) || (isEodExit && allowEodExit);
  if (!session.config.autoTrade && !isEmergencyExit) {
    websocketServer.sendAlert(session.userId, {
      type: 'warning',
      title: 'Exit Signal',
      message: `SELL signal for ${symbol}: ${decision.exitReason || decision.reason}. Enable auto-trade to execute.`,
      severity: 'medium',
      actionRequired: true,
    });
    return;
  }

  // If executing emergency exit with autoTrade off, send critical alert
  if (isEmergencyExit && !session.config.autoTrade) {
    const exitType = isStopLoss ? 'STOP LOSS' : 'END-OF-DAY';
    tradingLogger.logRisk(`EMERGENCY ${exitType}`, { sessionId, sessionName: session.name, symbol, reason: `${exitType} executing while autoTrade is off`, action: 'Force selling' });
    websocketServer.sendAlert(session.userId, {
      type: 'error',
      title: `EMERGENCY ${exitType}`,
      message: `Executing ${exitType.toLowerCase()} for ${symbol}: ${decision.exitReason || decision.reason}`,
      severity: 'critical',
      actionRequired: false,
    });
  }

  // SIMULATION MODE GATE: Log the signal but do NOT place real orders
  if (session.config.simulationMode) {
    tradingLogger.logInfo(`[AI Engine] SIMULATION: Would SELL ${symbol} (${decision.exitReason || decision.reason}) — skipping real order`, { sessionId, sessionName: session.name, symbol });
    ctx.releaseExitLock(symbol, sessionId);
    return;
  }

  try {
    // Get the trading mode for this session (needed for all Alpaca calls)
    const tradingMode = ctx.getSessionTradingMode(session);
    const assetType = session.config.assetType || 'stocks';

    // Normalize symbol for the asset type
    const normalizedSymbol = assetUtils.normalizeSymbol(symbol, assetType, 'alpaca');

    // Get the actual position from Alpaca to get accurate quantity
    let quantity = decision.quantity;
    if (!quantity || quantity <= 0) {
      // Fetch position from Alpaca directly using session-specific mode
      try {
        const alpacaPosition = await alpacaClient.getPosition(
          normalizedSymbol,
          tradingMode
        );
        quantity =
          parseFloat(alpacaPosition.qty) || parseFloat(alpacaPosition.quantity);
      } catch (e) {
        // Check if this is a "position not found" error - means local state is stale
        const errorMsg = e.message || '';
        if (errorMsg.includes('position') && errorMsg.includes('not found')) {
          // Clear stale position state to prevent repeated errors
          ctx.clearStalePositionState(sessionId, symbol);
          if (!ctx.shouldThrottleError(sessionId, `no_position_${symbol}`)) {
            tradingLogger.logInfo(`[AI Engine] Position ${symbol} not found in Alpaca - cleared stale local state`, { sessionId, sessionName: session.name, symbol });
          }
        } else if (!ctx.shouldThrottleError(sessionId, errorMsg)) {
          tradingLogger.logError(`[AI Engine] Could not get position for ${normalizedSymbol}`, { sessionId, sessionName: session.name, symbol: normalizedSymbol, error: e.message });
        }
        return;
      }
    }

    if (!quantity || quantity <= 0) {
      tradingLogger.logError('[AI Engine] No valid quantity to sell', { sessionId, sessionName: session.name, symbol: normalizedSymbol });
      return;
    }

    // PARTIAL EXIT: If this is a partial exit, sell only a percentage
    const isPartialExit = decision.partialExit === true;
    let originalQuantity = quantity;
    if (isPartialExit) {
      const partialPercent = (session.config.partialExitPercent || 50) / 100;
      quantity = Math.max(1, Math.floor(quantity * partialPercent));
      tradingLogger.logInfo(`[AI Engine] Partial exit: selling ${quantity} of ${originalQuantity} shares (${(partialPercent * 100).toFixed(0)}%)`, { sessionId, sessionName: session.name, symbol });
    }

    // Cancel any pending orders for this symbol to free up shares for the sell
    // (e.g., limit take-profit orders that lock shares and block stop-loss market sells)
    try {
      const openOrders = await alpacaClient.getOrders({ status: 'open', symbols: normalizedSymbol }, tradingMode);
      const pendingForSymbol = (openOrders || []).filter(o => o.symbol === normalizedSymbol);
      for (const pendingOrder of pendingForSymbol) {
        await alpacaClient.cancelOrder(pendingOrder.id);
        tradingLogger.logInfo(`[AI Engine] Cancelled pending ${pendingOrder.side} order for ${normalizedSymbol} to free shares for exit`, { sessionId, sessionName: session.name, symbol: normalizedSymbol, orderId: pendingOrder.id });
      }
    } catch (e) {
      // Non-fatal — proceed with sell attempt anyway
      tradingLogger.logInfo(`[AI Engine] Could not cancel pending orders for ${normalizedSymbol}: ${e.message}`, { sessionId, sessionName: session.name, symbol: normalizedSymbol });
    }

    // Cross-session sell guard: compare session's tracked qty vs Alpaca's actual position
    // If session owns less than broker total, use partial sell to avoid closing other sessions' shares
    let result;
    let brokerQty = quantity;
    try {
      const alpacaPos = await alpacaClient.getPosition(normalizedSymbol, tradingMode);
      brokerQty = parseFloat(alpacaPos.qty) || parseFloat(alpacaPos.quantity) || 0;
    } catch (e) {
      // If position lookup fails, fall through to close
    }

    const sessionAllowsExtHours = session.config?.extendedHours === true;
    const outsideRegularHours = !ctx.isMarketOpen() && ctx.isExtendedHoursOpen();
    const useExtendedHoursSell =
      sessionAllowsExtHours &&
      outsideRegularHours &&
      !assetUtils.isCrypto(assetType);

    if (quantity < brokerQty && quantity > 0) {
      // Partial sell — other sessions hold remaining shares
      tradingLogger.logInfo(`[AI Engine] Partial sell: session owns ${quantity} of ${brokerQty} total ${normalizedSymbol} shares`, { sessionId, sessionName: session.name, symbol: normalizedSymbol });
      result = await ctx.placeOrderForAsset(
        {
          symbol: normalizedSymbol,
          qty: quantity,
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
          _sessionAllowsExtendedHours: sessionAllowsExtHours,
          _referencePrice: decision.currentPrice,
        },
        tradingMode,
        assetType
      );
    } else if (useExtendedHoursSell) {
      // Full close via explicit sell order (closePosition API doesn't support extended hours)
      tradingLogger.logInfo(`[AI Engine] Extended-hours full close: selling ${quantity} ${normalizedSymbol}`, { sessionId, sessionName: session.name, symbol: normalizedSymbol });
      result = await ctx.placeOrderForAsset(
        {
          symbol: normalizedSymbol,
          qty: quantity,
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
          _sessionAllowsExtendedHours: true,
          _referencePrice: decision.currentPrice,
        },
        tradingMode,
        assetType
      );
    } else {
      // Full close — session owns entire position
      result = await ctx.closePositionForAsset(normalizedSymbol, tradingMode, assetType);
    }

    tradingLogger.logExecution('SELL_ORDER', symbol, { quantity, price: decision.currentPrice, sessionId, sessionName: session.name, reason: `Exit order (${tradingMode.toUpperCase()})` });

    // Poll for actual fill price (market orders fill quickly)
    let filledPrice = decision.currentPrice; // fallback to signal price
    let filledOrder = null;
    if (result.id) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500)); // wait 500ms
        try {
          filledOrder = await alpacaClient.getOrderById(result.id, tradingMode);
          if (filledOrder.status === 'filled' && filledOrder.filledAvgPrice) {
            filledPrice = filledOrder.filledAvgPrice;
            tradingLogger.logInfo(`[AI Engine] Exit filled: ${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (signal was $${decision.currentPrice.toFixed(2)})`, { sessionId, sessionName: session.name, symbol });
            break;
          }
        } catch (err) {
          // Order might not be ready yet, continue polling
        }
      }
    }

    // For partial exits: mark position, don't set cooldown, don't record W/L yet
    if (isPartialExit) {
      const position = session.portfolio.positions.get(symbol);
      if (position) {
        position.partialExitDone = true;
        position.partialExitPrice = filledPrice;
        position.quantity = originalQuantity - quantity; // Remaining shares
      }

      const entryPrice = decision.entryPrice || position?.averageCost || 0;
      const partialPnl = entryPrice > 0 ? (filledPrice - entryPrice) * quantity : 0;

      tradingLogger.logInfo(`[AI Engine] Partial exit completed: ${quantity} of ${originalQuantity} ${symbol} @ $${filledPrice.toFixed(2)} (P&L: $${partialPnl.toFixed(2)})`, { sessionId, sessionName: session.name, symbol });

      tradingLogger.logExecution('SELL', symbol, {
        quantity,
        price: filledPrice,
        signalPrice: decision.currentPrice,
        orderId: result.id,
        sessionId,
        sessionName: session.name,
        reason: 'Partial exit at profit target',
        pnl: partialPnl,
        partialExit: true,
      });

      websocketServer.sendTradeExecution(session.userId, {
        tradeId: result.id || uuidv4(),
        symbol,
        side: 'sell',
        quantity,
        price: filledPrice,
        totalValue: quantity * filledPrice,
        pnl: partialPnl,
        status: filledOrder?.status === 'filled' ? 'filled' : 'submitted',
        sessionName: session.name,
        sessionId: session.sessionId,
        partialExit: true,
      });

      ctx.addSessionAlert(session.sessionId, {
        type: 'success',
        title: 'Partial SELL',
        message: `${quantity}/${originalQuantity} ${symbol} @ $${filledPrice.toFixed(2)} (+$${partialPnl.toFixed(2)})`,
      });

      ctx.saveSessions();
      setTimeout(() => ctx.syncPortfolio(sessionId), 2000);
      return; // Don't proceed to full exit logic
    }

    // Set cooldown for this symbol to prevent rapid re-entry
    if (!ctx.tradeCooldowns.has(sessionId)) {
      ctx.tradeCooldowns.set(sessionId, new Map());
    }
    ctx.tradeCooldowns.get(sessionId).set(symbol, Date.now());
    tradingLogger.logInfo(`[AI Engine] ${symbol}: Cooldown started (${ctx.TRADE_COOLDOWN_MINUTES} min)`, { sessionId, sessionName: session.name, symbol });

    // Recalculate P&L with actual fill price.
    // Multi-tier fallback so force-exit paths (stale-guard, EOD, sentiment
    // force-exit) that pass a stub decision without entry data still log
    // correct P&L instead of "+$0.00":
    //   1. entryContext      — populated at entry time, most reliable
    //   2. decision.entryPrice — set by evaluateExit
    //   3. session position   — last resort, read from session.portfolio.positions
    const entryContext = ctx.entryContexts.get(sessionId)?.get(symbol) || null;
    const positionState = session.portfolio?.positions?.get?.(symbol) || null;
    const entryPrice =
      entryContext?.entryPrice ||
      decision.entryPrice ||
      positionState?.averageCost ||
      0;
    const actualPnl = entryPrice > 0 ? (filledPrice - entryPrice) * quantity : (decision.pnl || 0);
    const pnl = actualPnl;

    // Log execution to trading logger with actual fill price
    tradingLogger.logExecution('SELL', symbol, {
      quantity,
      price: filledPrice,
      signalPrice: decision.currentPrice,
      orderId: result.id,
      sessionId,
      sessionName: session.name,
      reason: decision.exitReason,
      pnl,
      pnlPercent: entryPrice > 0 ? ((filledPrice - entryPrice) / entryPrice * 100) : decision.pnlPercent,
    });

    // Log complete trade outcome for ML learning
    const holdingPeriodMinutes = entryContext?.entryTime
      ? differenceInMinutes(new Date(), parseISO(entryContext.entryTime))
      : null;

    tradingLogger.logTradeOutcome(symbol, {
      sessionId,
      sessionName: session.name,
      entryContext,
      exitReason: decision.exitReason,
      pnl,
      pnlPercent: decision.pnlPercent,
      holdingPeriodMinutes,
      successful: pnl > 0,
      tradingMode,
    });

    // Clear entry context after trade completes
    if (ctx.entryContexts.has(sessionId)) {
      ctx.entryContexts.get(sessionId).delete(symbol);
    }

    if (pnl > 0) {
      session.stats.wins++;
      session.stats.consecutiveLosses = 0;
    } else {
      session.stats.losses++;
      session.stats.consecutiveLosses++;

      // Check circuit breaker (support both field names for backwards compatibility)
      const consecutiveLimit =
        session.config.maxConsecutiveLosses ||
        session.config.consecutiveLossLimit ||
        3;
      if (session.stats.consecutiveLosses >= consecutiveLimit) {
        ctx.triggerCircuitBreaker(sessionId, 'Consecutive loss limit reached');
      }
    }
    session.stats.totalTrades = session.stats.wins + session.stats.losses;
    session.stats.totalPnL += pnl;

    // Recalculate win rate
    session.stats.winRate = session.stats.totalTrades > 0
      ? parseFloat(((session.stats.wins / session.stats.totalTrades) * 100).toFixed(1))
      : 0;

    // Check daily loss limit
    const dailyPnLPercent =
      (session.stats.totalPnL / session.portfolio.initialValue) * 100;
    if (dailyPnLPercent <= -session.config.dailyLossLimitPercent) {
      ctx.triggerCircuitBreaker(sessionId, 'Daily loss limit reached');
    }

    // Send notification with actual fill price
    websocketServer.sendTradeExecution(session.userId, {
      tradeId: result.id || uuidv4(),
      symbol,
      side: 'sell',
      quantity: quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      pnl: pnl,
      status: filledOrder?.status === 'filled' ? 'filled' : 'submitted',
      sessionName: session.name,
      sessionId: session.sessionId,
    });

    // Store alert and trade in session for persistence with actual fill price
    const pnlSign = pnl >= 0 ? '+' : '';
    ctx.addSessionAlert(session.sessionId, {
      type: 'success',
      title: 'Trade SELL',
      message: `${quantity} ${symbol} @ $${filledPrice.toFixed(2)} (${pnlSign}$${pnl.toFixed(2)})`,
    });
    ctx.addSessionTrade(session.sessionId, {
      symbol,
      side: 'sell',
      quantity,
      price: filledPrice,
      totalValue: quantity * filledPrice,
      pnl,
    });

    // Sync portfolio after trade
    setTimeout(() => ctx.syncPortfolio(sessionId), 2000);
  } catch (error) {
    tradingLogger.logError(`SELL order failed for ${symbol}`, {
      sessionId,
      sessionName: session.name,
      symbol,
      error: error.message,
    });
    // If Alpaca says position doesn't exist, clear it from session portfolio to prevent retry loop
    if (error.message && error.message.includes('insufficient qty available')) {
      tradingLogger.logInfo(`[AI Engine] Clearing ghost position ${symbol} from session portfolio (Alpaca confirms 0 qty)`, { sessionId, sessionName: session.name, symbol });
      if (session.portfolio && session.portfolio.positions) {
        session.portfolio.positions.delete(symbol);
      }
    }
    websocketServer.sendAlert(session.userId, {
      type: 'error',
      title: 'Exit Failed',
      message: `[${session.name}] Failed to sell ${symbol}: ${error.message}`,
      severity: 'high',
    });
  }
  } finally {
    ctx.releaseExitLock(symbol, sessionId);
  }
}

module.exports = { init, executeEntry, executeExit };
