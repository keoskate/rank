// server/brokers/simulatedExecutor.js
// Simulated order execution for sessions with `simulationMode: true`.
// Mutates session.portfolio (cash, positions) and stats directly — no Alpaca
// calls. Lets brokers run isolated $100k pools with real P&L tracking.
//
// The existing orderExecutor.js delegates to this module when simulationMode
// is set, instead of its prior no-op stub.

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const kellySizing = require('../risk/kellySizing');
const polygonClient = require('../polygonClient');
const transactionCost = require('../risk/transactionCost');

// Tiny in-process price cache so a flurry of broker ticks doesn't hammer
// the data APIs. 5-second TTL — fresh enough for sim, gentle on rate limits.
const PRICE_CACHE = new Map();
const PRICE_TTL_MS = 5000;

const BASE_POSITION_PERCENT = 8;

// Shared context — populated by init() from aiTradingEngine.js. Stores
// `getLatestQuoteForAsset`, `releaseExitLock`, and `GLOBAL_MAX_POSITION_PERCENT`.
let ctx = null;

function init(context) {
  ctx = context;
}

function _now() {
  return new Date().toISOString();
}

function _positionsValue(session) {
  let v = 0;
  for (const p of session.portfolio.positions.values()) {
    v += parseFloat(p.marketValue) || 0;
  }
  return v;
}

function _portfolioValue(session) {
  return (parseFloat(session.portfolio.cash) || 0) + _positionsValue(session);
}

/**
 * Fetch the most recent price for a symbol. Tries (in order):
 *   1. cache (5s TTL)
 *   2. engine's Alpaca quote helper (mid-of-bid-ask, if available)
 *   3. Polygon's most recent minute bar (works on standard tier)
 *   4. Polygon's previous-day close (works on free tier)
 * Returns 0 only if all sources fail.
 */
async function _getPrice(symbol, assetType) {
  const key = `${symbol}|${assetType || 'stocks'}`;
  const cached = PRICE_CACHE.get(key);
  if (cached && cached.expires > Date.now()) return cached.price;

  let price = 0;

  // 1) Alpaca via engine ctx — paid tiers expose realtime quotes here.
  if (ctx && typeof ctx.getLatestQuoteForAsset === 'function') {
    try {
      const q = await ctx.getLatestQuoteForAsset(symbol, assetType);
      // Alpaca's getLatestQuote returns { askPrice, bidPrice, ... }.
      // Crypto returns askPrice/bidPrice too. Real-time-quote endpoints
      // sometimes return { price } or { last }. Try them all.
      const ask = parseFloat(q?.askPrice ?? q?.ap);
      const bid = parseFloat(q?.bidPrice ?? q?.bp);
      const single = parseFloat(q?.price ?? q?.last ?? q?.lastPrice);
      if (ask > 0 && bid > 0) price = (ask + bid) / 2;
      else if (ask > 0) price = ask;
      else if (bid > 0) price = bid;
      else if (single > 0) price = single;
    } catch (err) {
      // Alpaca often 404s on stocks/quotes/latest for paper-only accounts;
      // fall through to Polygon. Don't spam the log.
    }
  }

  // 2) Polygon minute bar fallback (last close of the most recent minute bar)
  if (price <= 0 && !assetUtils_isCrypto(assetType)) {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
      const bars = await polygonClient.getHistoricalAggregates(
        symbol,
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
        'minute'
      );
      if (Array.isArray(bars) && bars.length > 0) {
        price = parseFloat(bars[bars.length - 1].close) || 0;
      }
    } catch (err) {
      // fall through to daily / prev close
    }
  }

  // 3) Polygon previous-day close (free tier)
  if (price <= 0 && !assetUtils_isCrypto(assetType)) {
    try {
      const p = await polygonClient.getPreviousClose(symbol);
      const v = parseFloat(p?.close ?? p?.c);
      if (v > 0) price = v;
    } catch (err) {
      // last resort exhausted
    }
  }

  if (price > 0) {
    PRICE_CACHE.set(key, { price, expires: Date.now() + PRICE_TTL_MS });
  } else {
    tradingLogger.logError(`[Sim] no price for ${symbol} from any source`, {
      symbol,
    });
  }
  return price;
}

// Light helper — avoids a require cycle on assetUtils when only this check is needed.
function assetUtils_isCrypto(assetType) {
  return assetType === 'crypto';
}

/**
 * Confidence-scaled sizing (same math as live orderExecutor): scale between
 * BASE_POSITION_PERCENT and effectiveMaxPercent based on confidence in [60,90].
 * Caller controls effectiveMaxPercent (already clipped to global cap).
 */
function _sizeByConfidence(portfolioValue, confidence, maxPercent) {
  const scale = Math.min(Math.max((confidence - 60) / 30, 0), 1.0);
  const scaledPct =
    BASE_POSITION_PERCENT + (maxPercent - BASE_POSITION_PERCENT) * scale;
  return portfolioValue * (scaledPct / 100);
}

/**
 * Execute a simulated BUY: decrements cash, adds a position to session.portfolio.
 */
async function simulatedEntry(session, symbol, decision) {
  const sessionId = session.sessionId;
  const assetType = session.config.assetType || 'stocks';
  const confidence = decision.confidence || 70;

  // Hard stop: don't enter if the consecutive-losses circuit breaker has tripped.
  // (Was a silent gap: the breaker would trip on exit but new entries kept firing.)
  if (session.circuitBreakerTriggered) {
    tradingLogger.logRisk('Circuit breaker active — entry blocked', {
      sessionId,
      sessionName: session.name,
      symbol,
      consecutiveLosses: session.stats?.consecutiveLosses,
      action: 'Blocked entry',
    });
    return;
  }

  // Don't double-open
  if (session.portfolio.positions.has(symbol)) {
    tradingLogger.logInfo(`[Sim] already long ${symbol} — skipping entry`, {
      sessionId,
      sessionName: session.name,
      symbol,
    });
    return;
  }

  // Cap on number of concurrent positions
  const maxPositions = session.config.maxPositions || 5;
  if (session.portfolio.positions.size >= maxPositions) {
    tradingLogger.logInfo(
      `[Sim] max positions (${maxPositions}) hit — skipping ${symbol}`,
      { sessionId, sessionName: session.name, symbol }
    );
    return;
  }

  // EOD entry block: don't open new positions in the final stretch of the
  // session. The engine has an EOD *exit* window (default 15 min before close)
  // that force-closes positions, but had no matching entry guard — so the
  // engine would enter at 3:45 PM, get force-exited at 3:50 PM at the same
  // price, $0 P&L, re-enter, repeat. Claude flagged this pattern repeatedly
  // in self-mutations on 2026-05-27 through 2026-06-01.
  //
  // Default block = 30 min before close (configurable per-broker via
  // session.config.eodEntryBlockMinutes). Stocks only; crypto skips since
  // it trades 24/7.
  const eodBlockMins = parseFloat(session.config.eodEntryBlockMinutes ?? 30);
  if (!assetUtils_isCrypto(assetType) && eodBlockMins > 0) {
    const now = new Date();
    // Market close is 4:00 PM ET = 20:00 UTC during EDT (March-Nov), 21:00 UTC during EST
    // Compute via local time (server should be in ET) for correctness across DST.
    const closeHour = 16; // 4:00 PM ET
    const close = new Date(now);
    close.setHours(closeHour, 0, 0, 0);
    const minutesUntilClose = (close - now) / 60000;
    if (minutesUntilClose > 0 && minutesUntilClose < eodBlockMins) {
      tradingLogger.logRisk(
        `EOD entry block: ${minutesUntilClose.toFixed(0)} min to close — skipping ${symbol}`,
        {
          sessionId,
          sessionName: session.name,
          symbol,
          minutesUntilClose,
          threshold: eodBlockMins,
          action: 'Blocked entry',
        }
      );
      return;
    }
  }

  const price = await _getPrice(symbol, assetType);
  if (price <= 0) {
    tradingLogger.logError(`[Sim] no price for ${symbol} — skipping entry`, {
      sessionId,
      sessionName: session.name,
      symbol,
    });
    return;
  }

  // Falling-knife guard: refuse new longs when the symbol is down sharply on the
  // day. Catches the 2026-05-27 SOXL case: a -11% intraday move kept triggering
  // "RSI oversold + below VWAP" buys that all got stopped out within minutes.
  // Threshold is per-broker (default -3% — i.e. block longs if price is below
  // today's open by 3%+). Crypto skips this since it trades 24/7 (no clean "open").
  const maxDayDownPct = parseFloat(session.config.maxDayDownEntryPct ?? 3);
  if (!assetUtils_isCrypto(assetType) && maxDayDownPct > 0) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const bars = await polygonClient.getHistoricalAggregates(
        symbol,
        today,
        today,
        'minute'
      );
      if (Array.isArray(bars) && bars.length > 0) {
        const open = parseFloat(bars[0].open) || 0;
        if (open > 0) {
          const dayChangePct = ((price - open) / open) * 100;
          if (dayChangePct <= -maxDayDownPct) {
            tradingLogger.logRisk(
              `Falling-knife guard tripped: ${symbol} down ${dayChangePct.toFixed(2)}% on the day`,
              {
                sessionId,
                sessionName: session.name,
                symbol,
                dayChangePct,
                threshold: -maxDayDownPct,
                action: 'Blocked entry',
              }
            );
            return;
          }
        }
      }
    } catch (err) {
      // Best-effort guard. If polygon fails, fall through and let the trade
      // attempt — better than over-blocking on transient API errors.
    }
  }

  const portfolioValue = _portfolioValue(session);
  const sessionMaxPct = session.config.maxPositionSizePercent || 10;
  const globalCap = (ctx && ctx.GLOBAL_MAX_POSITION_PERCENT) || 20;
  const effectiveMaxPct = Math.min(sessionMaxPct, globalCap);

  const allocCap = session.config.allocatedCapital || portfolioValue;
  const sizingBase = Math.min(portfolioValue, allocCap);

  // Dispatch on the broker's chosen sizing strategy. Default is confidence-scaled
  // (matches the live orderExecutor's math). Fractional Kelly draws from the
  // session's own trade history with a Bayesian prior for new agents.
  const strategy = session.config.sizingStrategy || 'confidence-scaled';
  let targetValue;
  if (strategy === 'fractional-kelly') {
    const kelly = kellySizing.computeKellySize(session, {
      portfolioValue: sizingBase,
      kellyFraction: session.config.kellyFraction || 0.25,
      maxPercent: effectiveMaxPct,
      minPercent: 0.5,
    });
    targetValue = kelly.dollars;
    tradingLogger.logInfo(
      `[Sim] kelly: ${kelly.source} winRate=${(kelly.stats.winRate * 100).toFixed(1)}% payoff=${kelly.stats.payoffRatio.toFixed(2)} fullKelly=${kelly.stats.fullKelly.toFixed(3)} → ${kelly.percent.toFixed(2)}% ($${kelly.dollars.toFixed(0)})`,
      { sessionId, sessionName: session.name, symbol }
    );
    if (kelly.dollars <= 0) {
      // Kelly says don't bet — respect it.
      tradingLogger.logInfo(
        `[Sim] kelly veto: edge non-positive (${kelly.stats.winRate.toFixed(2)} winRate × ${kelly.stats.payoffRatio.toFixed(2)} payoff) — skipping`,
        { sessionId, sessionName: session.name, symbol }
      );
      return;
    }
  } else if (strategy === 'fixed') {
    targetValue = sizingBase * (effectiveMaxPct / 100);
  } else {
    targetValue = _sizeByConfidence(sizingBase, confidence, effectiveMaxPct);
  }

  // Macro (FRED) risk-on/off overlay: shrink the position in a risk-off regime.
  // decision.macroSizeScalar is attached by the engine's macro gate; 1 (or
  // undefined) is a no-op, so this is inert unless the broker opts in.
  const macroScalar = decision.macroSizeScalar;
  if (typeof macroScalar === 'number' && macroScalar >= 0 && macroScalar < 1) {
    targetValue *= macroScalar;
  }

  // Quantity (integer for stocks; fractional for crypto via existing assetUtils)
  let quantity = Math.floor(targetValue / price);
  if (quantity <= 0) {
    tradingLogger.logInfo(
      `[Sim] computed qty 0 for ${symbol} (target=$${targetValue.toFixed(2)}, px=$${price}) — skipping`,
      { sessionId, sessionName: session.name, symbol }
    );
    return;
  }

  const cost = quantity * price;
  if (session.portfolio.cash < cost) {
    // Reduce quantity to fit available cash (preserve at least $1 buffer)
    quantity = Math.floor((session.portfolio.cash - 1) / price);
    if (quantity <= 0) {
      tradingLogger.logInfo(
        `[Sim] insufficient cash for ${symbol}: have $${session.portfolio.cash.toFixed(2)}, need $${cost.toFixed(2)}`,
        { sessionId, sessionName: session.name, symbol }
      );
      return;
    }
  }
  const finalCost = quantity * price;

  // Mutate state
  session.portfolio.cash -= finalCost;
  const position = {
    symbol,
    quantity,
    averageCost: price,
    currentPrice: price,
    marketValue: finalCost,
    unrealizedPnL: 0,
    unrealizedPnLPercent: 0,
    side: 'long',
    entryTime: _now(),
    highWaterMark: price,
    partialExitDone: false,
    partialExitPrice: null,
    simulated: true,
    entryConfidence: confidence,
    entryReason: decision.reason || decision.reasons?.join(', ') || '',
    // Strategy plugin that generated this entry — carried through to the
    // closed-trade record so realized P&L can be attributed by signal source.
    source: decision.source || 'unknown',
  };
  session.portfolio.positions.set(symbol, position);

  // Stats
  session.stats.totalTrades = (session.stats.totalTrades || 0) + 1;
  session.stats.simTrades = (session.stats.simTrades || 0) + 1;
  session.stats.openTrades = (session.stats.openTrades || 0) + 1;

  // Per-session trade log (read by self-improvement engine later)
  session.tradingLog = session.tradingLog || [];
  session.tradingLog.push({
    tradeId: `sim-${sessionId.slice(0, 8)}-${Date.now()}`,
    side: 'buy',
    symbol,
    quantity,
    price,
    cost: finalCost,
    confidence,
    reason: position.entryReason,
    timestamp: position.entryTime,
    simulated: true,
  });

  tradingLogger.logExecution('BUY (sim)', symbol, {
    sessionId,
    sessionName: session.name,
    quantity,
    price,
    reason: position.entryReason,
  });

  // Broadcast to TUI / clients
  try {
    websocketServer.sendTradeExecution &&
      websocketServer.sendTradeExecution(session.userId, {
        tradeId: `sim-${sessionId.slice(0, 8)}-${Date.now()}`,
        symbol,
        side: 'buy',
        quantity,
        price,
        sessionId,
        sessionName: session.name,
        simulated: true,
        timestamp: _now(),
      });
  } catch (err) {
    // Non-fatal: broadcast is best-effort
  }

  // Persist so the trade survives a server restart.
  if (ctx && typeof ctx.saveSessions === 'function') {
    try {
      ctx.saveSessions();
    } catch (err) {
      // Non-fatal: persistence will retry on next mutation
    }
  }
}

/**
 * Execute a simulated SELL: closes the position, credits cash, updates stats.
 * Supports partial exit when decision.partialExit === true.
 */
async function simulatedExit(session, symbol, decision) {
  const sessionId = session.sessionId;
  const assetType = session.config.assetType || 'stocks';
  const position = session.portfolio.positions.get(symbol);

  if (!position) {
    if (ctx && ctx.releaseExitLock) ctx.releaseExitLock(symbol, sessionId);
    return;
  }

  const price = await _getPrice(symbol, assetType);
  if (price <= 0) {
    tradingLogger.logError(
      `[Sim] no exit price for ${symbol} — using last known $${position.currentPrice}`,
      { sessionId, sessionName: session.name, symbol }
    );
  }
  const exitPrice =
    price > 0 ? price : position.currentPrice || position.averageCost;

  const isPartial = decision.partialExit === true;
  const partialPct = isPartial
    ? (session.config.partialExitPercent || 50) / 100
    : 1;
  const exitQty = isPartial
    ? Math.max(1, Math.floor(position.quantity * partialPct))
    : position.quantity;

  const proceeds = exitQty * exitPrice;
  const cost = exitQty * position.averageCost;
  // Round-trip transaction cost (spread + slippage + commission) so realized
  // P&L is NET — what a real account keeps. Charged against the entry notional.
  const txCost = transactionCost.roundTripCost(symbol, cost);
  const realizedPnL = proceeds - cost - txCost;
  const realizedPct = cost > 0 ? (realizedPnL / cost) * 100 : 0;

  // Mutate state — cash reflects the cost outflow too.
  session.portfolio.cash += proceeds - txCost;

  if (isPartial && exitQty < position.quantity) {
    position.quantity -= exitQty;
    position.marketValue = position.quantity * exitPrice;
    position.partialExitDone = true;
    position.partialExitPrice = exitPrice;
  } else {
    session.portfolio.positions.delete(symbol);
    session.stats.openTrades = Math.max(0, (session.stats.openTrades || 1) - 1);
  }

  // Stats
  session.stats.totalPnL = (session.stats.totalPnL || 0) + realizedPnL;
  if (realizedPnL >= 0) {
    session.stats.wins = (session.stats.wins || 0) + 1;
    session.stats.consecutiveLosses = 0;
  } else {
    session.stats.losses = (session.stats.losses || 0) + 1;
    session.stats.consecutiveLosses =
      (session.stats.consecutiveLosses || 0) + 1;

    // The consecutive-losses limit is enforced by the entry-risk gate in
    // analyzeAndTrade (soft halt: blocks new entries but keeps exits + stops
    // flowing, so open positions aren't stranded). We only track the streak
    // here; a winning exit resets it. This replaced a hard triggerCircuitBreaker
    // that paused the whole session (added after the -$1,634 day on 2026-05-27,
    // when the check was missing entirely) — the gate covers the same failure
    // mode without freezing exits.
  }
  const closedTrades = (session.stats.wins || 0) + (session.stats.losses || 0);
  session.stats.winRate =
    closedTrades > 0 ? (session.stats.wins / closedTrades) * 100 : 0;

  // Peak / drawdown
  const pv = _portfolioValue(session);
  if (pv > (session.stats.peakValue || 0)) session.stats.peakValue = pv;
  const dd =
    session.stats.peakValue > 0
      ? ((session.stats.peakValue - pv) / session.stats.peakValue) * 100
      : 0;
  if (dd > (session.stats.maxDrawdown || 0)) session.stats.maxDrawdown = dd;

  // Trade log
  session.tradingLog = session.tradingLog || [];
  session.tradingLog.push({
    tradeId: `sim-${sessionId.slice(0, 8)}-${Date.now()}`,
    side: 'sell',
    symbol,
    quantity: exitQty,
    price: exitPrice,
    proceeds,
    realizedPnL,
    realizedPct,
    exitReason: decision.exitReason || decision.reason || '',
    entryPrice: position.averageCost,
    holdSeconds: (Date.now() - new Date(position.entryTime).getTime()) / 1000,
    timestamp: _now(),
    simulated: true,
    partial: isPartial,
    // Attribute this realized P&L to the source that opened the position.
    source: position.source || 'unknown',
  });

  tradingLogger.logExecution(
    isPartial ? 'SELL (sim, partial)' : 'SELL (sim)',
    symbol,
    {
      sessionId,
      sessionName: session.name,
      quantity: exitQty,
      price: exitPrice,
      pnl: realizedPnL,
      pnlPercent: realizedPct,
      reason: decision.exitReason || decision.reason,
    }
  );

  try {
    websocketServer.sendTradeExecution &&
      websocketServer.sendTradeExecution(session.userId, {
        tradeId: `sim-${sessionId.slice(0, 8)}-${Date.now()}`,
        symbol,
        side: 'sell',
        quantity: exitQty,
        price: exitPrice,
        pnl: realizedPnL,
        pnlPercent: realizedPct,
        sessionId,
        sessionName: session.name,
        simulated: true,
        timestamp: _now(),
      });
  } catch (err) {
    // Non-fatal
  }

  if (ctx && ctx.releaseExitLock) ctx.releaseExitLock(symbol, sessionId);

  // Persist so the exit + P&L survive a server restart.
  if (ctx && typeof ctx.saveSessions === 'function') {
    try {
      ctx.saveSessions();
    } catch (err) {
      // Non-fatal
    }
  }
}

/**
 * Refresh unrealized P&L on all simulated positions. Called from syncPortfolio
 * in place of the Alpaca call when simulationMode is on.
 */
async function markToMarket(session) {
  if (!session.portfolio || !session.portfolio.positions) return;
  const assetType = session.config.assetType || 'stocks';
  let unrealized = 0;
  for (const [symbol, pos] of session.portfolio.positions) {
    const price = await _getPrice(symbol, assetType);
    if (price > 0) {
      pos.currentPrice = price;
      pos.marketValue = pos.quantity * price;
      pos.unrealizedPnL = (price - pos.averageCost) * pos.quantity;
      pos.unrealizedPnLPercent =
        pos.averageCost > 0
          ? ((price - pos.averageCost) / pos.averageCost) * 100
          : 0;
      if (price > (pos.highWaterMark || 0)) pos.highWaterMark = price;
    }
    unrealized += pos.unrealizedPnL || 0;
  }
  session.stats.unrealizedPnL = unrealized;
  session.stats.totalPnLWithUnrealized =
    (session.stats.totalPnL || 0) + unrealized;

  // Drawdown tracking on mark-to-market
  const pv = _portfolioValue(session);
  if (pv > (session.stats.peakValue || 0)) session.stats.peakValue = pv;
  const dd =
    session.stats.peakValue > 0
      ? ((session.stats.peakValue - pv) / session.stats.peakValue) * 100
      : 0;
  if (dd > (session.stats.maxDrawdown || 0)) session.stats.maxDrawdown = dd;
}

module.exports = {
  init,
  simulatedEntry,
  simulatedExit,
  markToMarket,
};
