/**
 * Options Flow Strategy Plugin (Unusual Whales)
 *
 * Trades on institutional options positioning, not technical indicators. A
 * broker on this plugin enters when recent unusual options flow on its symbol
 * is heavily call-premium-skewed (smart money buying upside), gated by a
 * minimum premium so we only act on size.
 *
 * Long-only, like the rest of the engine: bullish flow → BUY; bearish flow is
 * reported but skipped (no short orders). Exits are handled by the universal
 * exit logic (stop/target/EOD) — this plugin owns only the entry decision.
 *
 * Contract: evaluate(session, symbol, ctx) => decisionObject  (source: 'options-flow')
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const uw = require('../unusualWhalesClient');

const SLUG = 'options-flow';

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  const cfg = session.config || {};

  // Tunables (also the self-mutation allow-list below).
  const lookbackMinutes = cfg.lookbackMinutes ?? 30;
  const minPremium = cfg.minPremium ?? 250000;
  const minSkew = cfg.minSkew ?? 0.65;
  const minConfidence = cfg.minConfidence ?? 65;
  const useMarketTide = cfg.useMarketTide !== false;

  try {
    if (!uw.isConfigured()) {
      return {
        shouldEnter: false,
        reason: 'Unusual Whales API key not configured',
        source: SLUG,
      };
    }

    const flow = await uw.analyzeTickerFlow(symbol, {
      lookbackMinutes,
      minPremium,
      minSkew,
    });

    const reasons = [...(flow.reasons || [])];

    // Market-wide tide as a soft gate: penalize fighting the overall tape.
    let tide = null;
    if (useMarketTide) {
      tide = await uw.getMarketTide();
      if (tide && tide.sentiment) {
        reasons.push(
          `market tide: ${tide.sentiment} (${(tide.callShare * 100).toFixed(0)}% call)`
        );
      }
    }

    // Current price: prefer the underlying price embedded in the flow data,
    // fall back to the realtime WS price, so targets are computed sensibly.
    const wsPrice = alpacaStream.getLatestPrice(symbol);
    const currentPrice =
      flow.underlyingPrice > 0
        ? flow.underlyingPrice
        : wsPrice && !wsPrice.isStale
          ? wsPrice.price
          : 0;

    // Base confidence from the flow score (0..1 → 50..95).
    let confidence = Math.round(50 + (flow.score || 0) * 45);

    // Tide adjustment: bullish flow + bullish tide = tailwind; bullish flow vs
    // bearish tide = headwind. Mirror for shorts (skipped, but affects logging).
    if (tide && tide.sentiment === 'bearish' && flow.sentiment === 'bullish') {
      confidence = Math.max(confidence - 15, 0);
      reasons.push('headwind: bullish flow against bearish tide (-15)');
    } else if (
      tide &&
      tide.sentiment === 'bullish' &&
      flow.sentiment === 'bullish'
    ) {
      confidence = Math.min(confidence + 5, 95);
      reasons.push('tailwind: bullish flow with bullish tide (+5)');
    }

    const isBullish = flow.sentiment === 'bullish';
    const meetsConfidence = confidence >= minConfidence;
    const hasPrice = currentPrice > 0;
    const shouldEnter = isBullish && meetsConfidence && hasPrice;

    if (flow.sentiment === 'bearish') {
      reasons.push('bearish flow — long-only mode, skipped');
    }

    // Percentage targets (same convention as the technical plugin).
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
        callPremium: flow.callPremium,
        putPremium: flow.putPremium,
        callShare: flow.callShare,
        skew: flow.skew,
        sweeps: flow.sweepCount,
        alerts: flow.alertCount,
        tide: tide?.sentiment || null,
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

    // Verbose log to the frontend trading panel (every evaluation).
    websocketServer.broadcastToAll('trading_log', {
      id: `${Date.now()}-${symbol}-${Math.random().toString(36).substr(2, 9)}`,
      level: shouldEnter ? 'SIGNAL' : 'INFO',
      category: 'ENTRY_ANALYSIS',
      symbol,
      message: shouldEnter
        ? `FLOW BUY: ${confidence}% conf, ${(flow.callShare * 100).toFixed(0)}% call premium`
        : `Flow watch: ${flow.sentiment}, ${flow.alertCount} alerts, conf=${confidence}%`,
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
    tradingLogger.logError(`Options-flow evaluation failed for ${symbol}`, {
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
  // Self-mutation allow-list: the LLM may tune flow thresholds, nothing else.
  // Paths match the broker frontmatter (validated by brokerSchema).
  mutableFields: ['flow.minPremium', 'flow.minSkew', 'flow.lookbackMinutes'],
  evaluate,
};
