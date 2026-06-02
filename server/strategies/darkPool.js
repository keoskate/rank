/**
 * Dark Pool Strategy Plugin (Unusual Whales)
 *
 * Buys when large institutional size is being accumulated in the dark pool —
 * off-exchange block prints executing at/above the NBBO midpoint (buyer-
 * initiated). This reveals where big money is positioning quietly, before it
 * shows up on the lit tape.
 *
 * Each print is classified buy-side vs sell-side by price vs NBBO mid. A
 * dominant buy-side premium above a size floor = accumulation = long signal.
 * Long-only; owns only the entry decision.
 *
 * Contract: evaluate(session, symbol, ctx) => decisionObject (source: 'dark-pool')
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const uw = require('../unusualWhalesClient');

const SLUG = 'dark-pool';

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  const cfg = session.config || {};
  const lookbackMinutes = cfg.darkpoolLookbackMinutes ?? 120;
  const minPremium = cfg.darkpoolMinPremium ?? 1_000_000;
  const minBuyShare = cfg.darkpoolMinBuyShare ?? 0.6;
  const minConfidence = cfg.minConfidence ?? 65;

  try {
    if (!uw.isConfigured()) {
      return {
        shouldEnter: false,
        reason: 'Unusual Whales API key not configured',
        source: SLUG,
      };
    }

    const dp = await uw.analyzeDarkPool(symbol, {
      lookbackMinutes,
      minPremium,
      minBuyShare,
    });
    const reasons = [...(dp.reasons || [])];

    // Prefer realtime WS price; fall back to the most recent print price.
    const ws = alpacaStream.getLatestPrice(symbol);
    const currentPrice =
      ws && !ws.isStale && ws.price > 0 ? ws.price : dp.lastPrice || 0;

    const confidence = Math.round(50 + (dp.score || 0) * 45);
    const isBullish = dp.sentiment === 'bullish';
    const shouldEnter =
      isBullish && confidence >= minConfidence && currentPrice > 0;

    if (dp.sentiment === 'bearish')
      reasons.push('net distribution — long-only, skipped');

    const takeProfitPercent = cfg.takeProfitPercent || 2;
    const stopLossPercent = cfg.stopLossPercent || 1;
    const profitTarget = currentPrice * (1 + takeProfitPercent / 100);
    const stopLoss = currentPrice * (1 - stopLossPercent / 100);

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons,
      currentPrice,
      profitTarget,
      stopLoss,
      atr: currentPrice * 0.02,
      indicators: {
        buyPremium: dp.buyPremium,
        sellPremium: dp.sellPremium,
        buyShare: dp.buyShare,
        prints: dp.printCount,
      },
      timestamp: new Date(),
      source: SLUG,
    };

    if (shouldEnter) {
      ctx.logDecision(sessionId, decision);
      tradingLogger.logSignal('ENTRY', symbol, {
        sessionId,
        sessionName: session.name,
        confidence,
        reasons,
        currentPrice,
        profitTarget,
        stopLoss,
        shouldEnter,
      });
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }

    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldEnter ? 'SIGNAL' : 'INFO',
      category: 'ENTRY_ANALYSIS',
      symbol,
      message: shouldEnter
        ? `DARK POOL BUY: ${confidence}% conf, ${(dp.buyShare * 100).toFixed(0)}% buy-side`
        : `Dark pool watch: ${dp.sentiment}, ${dp.printCount} prints`,
      sessionId: session.sessionId,
      sessionName: session.name,
      data: {
        shouldEnter,
        confidence,
        source: SLUG,
        reasons,
        indicators: decision.indicators,
      },
    });

    return decision;
  } catch (error) {
    tradingLogger.logError(`Dark-pool evaluation failed for ${symbol}`, {
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
  mutableFields: [
    'darkpool.lookbackMinutes',
    'darkpool.minPremium',
    'darkpool.minBuyShare',
  ],
  // Dark-pool accumulation plays out over a few sessions, not minutes — hold
  // a swing horizon rather than force-closing at the bell. (No backtest yet;
  // shorter/tighter than insider, revisit once we have dark-pool history.)
  holdPolicy: {
    horizon: 'multi-day',
    exitBeforeClose: false,
    takeProfitPercent: 4,
    stopLossPercent: 2,
    maxHoldDays: 5,
    minHoldMinutes: 30,
  },
  evaluate,
};
