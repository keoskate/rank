/**
 * Insider Following Strategy Plugin (Unusual Whales / Form 4)
 *
 * Buys when company insiders (officers/directors) are buying their own stock on
 * the open market. Insider purchases are a high-signal, low-noise leading
 * indicator — insiders buy ahead of catalysts they can see and the tape can't.
 * Sells are ignored (insiders sell for liquidity, taxes, diversification).
 *
 * Long-only. Owns only the entry decision; universal exit logic handles exits.
 *
 * NOTE (v1 limitation): the engine's exit logic is intraday (EOD force-close),
 * so this plugin currently tests the *short-term* reaction to insider buying,
 * not the multi-week insider thesis. A per-plugin multi-day hold is a follow-up.
 *
 * Contract: evaluate(session, symbol, ctx) => decisionObject (source: 'insider-following')
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const polygonClient = require('../polygonClient');
const uw = require('../unusualWhalesClient');

const SLUG = 'insider-following';

async function _price(symbol) {
  const ws = alpacaStream.getLatestPrice(symbol);
  if (ws && !ws.isStale && ws.price > 0) return ws.price;
  try {
    const p = await polygonClient.getPreviousClose(symbol);
    return parseFloat(p?.close ?? p?.c) || 0;
  } catch {
    return 0;
  }
}

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  const cfg = session.config || {};
  const lookbackDays = cfg.insiderLookbackDays ?? 10;
  const minNotional = cfg.insiderMinNotional ?? 100000;
  const minConfidence = cfg.minConfidence ?? 60;

  try {
    if (!uw.isConfigured()) {
      return {
        shouldEnter: false,
        reason: 'Unusual Whales API key not configured',
        source: SLUG,
      };
    }

    const insider = await uw.analyzeInsiderActivity(symbol, {
      lookbackDays,
      minNotional,
    });
    const reasons = [...(insider.reasons || [])];
    const currentPrice = await _price(symbol);

    const confidence = Math.round(50 + (insider.score || 0) * 45);
    const isBullish = insider.sentiment === 'bullish';
    const shouldEnter =
      isBullish && confidence >= minConfidence && currentPrice > 0;

    const takeProfitPercent = cfg.takeProfitPercent || 3;
    const stopLossPercent = cfg.stopLossPercent || 2;
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
        buyNotional: insider.buyNotional,
        sellNotional: insider.sellNotional,
        buyDays: insider.buyDays,
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
        ? `INSIDER BUY: ${confidence}% conf, ${insider.buyDays} buy day(s)`
        : `Insider watch: ${insider.sentiment}, $${Math.round(insider.buyNotional || 0).toLocaleString()} bought`,
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
    tradingLogger.logError(`Insider evaluation failed for ${symbol}`, {
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
  mutableFields: ['insider.lookbackDays', 'insider.minNotional'],
  // Multi-day hold: the insider backtest showed the edge is a multi-session
  // drift (+4-6% over 1-5 days) that tight intraday exits stop out of. Hold
  // overnight, wider stop, exit on an 8/4 target or after 10 days.
  holdPolicy: {
    horizon: 'multi-day',
    exitBeforeClose: false,
    takeProfitPercent: 8,
    stopLossPercent: 4,
    maxHoldDays: 10,
    minHoldMinutes: 60,
  },
  evaluate,
};
