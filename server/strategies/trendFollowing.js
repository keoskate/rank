/**
 * Trend-Following Strategy Plugin (time-series / dual momentum)
 *
 * The keystone strategy from the edge-research workflow — the ONE thing that
 * showed real alpha by cutting the 2022 bear tail across multiple rule specs.
 * It is NOT a per-symbol intraday signal; it's a portfolio rule:
 *
 *   Hold a name only while it is in an uptrend (close > 200-day SMA AND the
 *   12-1 month momentum > 0). Rank eligible names by momentum; the engine's
 *   candidate sort + maxPositions keeps the top N. Exit to CASH the moment a
 *   holding breaks trend. In a bear, nothing is eligible → 100% cash → the
 *   left tail is gone.
 *
 * Daily-resolution: works off daily bars (cached per day), so the per-minute
 * scan loop just re-affirms the same daily signal cheaply.
 *
 * Owns BOTH the entry (evaluate) and the exit (evaluateExit) — trend strategies
 * must exit on a trend break, not on stop/target/EOD, so the dispatcher hands
 * exits to this plugin instead of the universal technical exit.
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const alpacaClient = require('../alpacaClient');
const { trendCore } = require('@keo/quant-core');

const SLUG = 'trend-following';

// FAITHFULNESS CONTRACT: the trend decision lives in @keo/quant-core
// trendCore.evaluateTrend — a pure function backtests call too, certified by
// scripts/backtests/certify-trend-core.js. This module only fetches closes,
// supplies the realtime price override, and translates session config. It
// must NOT add decision logic of its own.
//
// Data path: Alpaca split+dividend-adjusted daily bars through YESTERDAY
// (the most recent completed session; the free tier blocks recent SIP data
// anyway). The previous version used Polygon split-only aggregates — a
// different adjustment basis than every backtest, i.e. silent divergence.

// Daily-bar cache (one fetch per symbol per ET day).
const barCache = new Map();
function _etDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
async function _dailyCloses(symbol) {
  const key = `${symbol}|${_etDay()}`;
  if (barCache.has(key)) return barCache.get(key);
  const end = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 430 * 864e5).toISOString().slice(0, 10);
  let closes = [];
  try {
    const bars = await alpacaClient.getBars(
      symbol,
      '1Day',
      start,
      end,
      10000,
      'all' // split + dividend adjusted — the SAME basis as the backtests
    );
    closes = (bars || [])
      .map(b => b.close)
      .filter(c => Number.isFinite(c) && c > 0);
  } catch {
    closes = []; // fail-safe: no data → no decision (engine backstops apply)
  }
  barCache.set(key, closes);
  return closes;
}

/**
 * Pure decision from a closes series + session config. Exported so the
 * faithfulness certification harness can prove this module's config
 * translation matches the backtests' direct use of the shared core.
 * @returns {object|null} { currentPrice, sma200, momentum, uptrend }
 */
function trendStateFromCloses(closes, cfg = {}, priceOverride = null) {
  const st = trendCore.evaluateTrend(closes, {
    smaWindow: cfg.trendSmaWindow || 200,
    momLookback: cfg.trendMomentumDays || 252, // ~12 months
    momSkip: cfg.trendMomentumSkipDays ?? 21, // skip most recent ~1 month
    volWindow: cfg.trendVolWindow || 63,
    price: priceOverride > 0 ? priceOverride : undefined,
  });
  if (!st.ok) return null; // not enough history to judge trend
  return {
    currentPrice: st.price,
    sma200: st.sma,
    momentum: st.momentum,
    vol: st.vol,
    rankScore: st.rankScore,
    uptrend: st.uptrend,
  };
}

/**
 * Confidence drives the engine's candidate sort (the "top N" selection).
 * Pure and exported so certify-trend-core.js certifies ORDERING parity
 * against the exact map the engine uses.
 *
 * Default mode: ∝ raw momentum (legacy spec, rounded — preserved verbatim).
 * volAdjusted mode: a MONOTONE INJECTIVE map of the shared core's rankScore
 * so the engine's ordering equals the backtest's exact rankScore sort.
 * BUG FIXED 2026-06-10 (manifest D1): the previous map 65+rankScore*6
 * clamped at 95 — rankScore is momentum/DAILY-vol (typical 10-40), so nearly
 * every uptrend name pinned at 95 and live ordering was undefined. The new
 * map saturates only asymptotically and is NOT rounded.
 */
function confidenceFromState(st, cfg = {}) {
  if (cfg.trendRankBy === 'volAdjusted' && st.rankScore != null) {
    return 65 + 30 * (1 - Math.exp(-Math.max(0, st.rankScore) / 20));
  }
  return Math.max(65, Math.min(95, Math.round(65 + st.momentum * 30)));
}

/**
 * Compute the trend state for a symbol from daily closes.
 * @returns {object|null} { currentPrice, sma200, momentum, uptrend }
 */
async function _trendState(symbol, cfg) {
  const closes = await _dailyCloses(symbol);
  // realtime price preferred for a timely trend break; fall back to last close
  const ws = alpacaStream.getLatestPrice(symbol);
  const priceOverride = ws && !ws.isStale && ws.price > 0 ? ws.price : null;
  return trendStateFromCloses(closes, cfg, priceOverride);
}

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  const cfg = session.config || {};
  try {
    const st = await _trendState(symbol, cfg);
    if (!st) {
      return {
        shouldEnter: false,
        reason: 'insufficient daily history',
        source: SLUG,
      };
    }
    const confidence = confidenceFromState(st, cfg);
    const shouldEnter = st.uptrend;
    const reasons = [
      `${symbol} ${st.currentPrice.toFixed(2)} vs 200d SMA ${st.sma200.toFixed(2)} (${st.currentPrice > st.sma200 ? 'above' : 'below'})`,
      `12-1 momentum ${(st.momentum * 100).toFixed(1)}%`,
    ];

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons,
      currentPrice: st.currentPrice,
      // No %-based target/stop — the trend exit (evaluateExit) governs risk.
      profitTarget: st.currentPrice * 100,
      stopLoss: st.currentPrice * 0.01,
      atr: st.currentPrice * 0.02,
      indicators: { sma200: st.sma200, momentum: st.momentum },
      timestamp: new Date(),
      source: SLUG,
    };
    if (shouldEnter) {
      ctx.logDecision(sessionId, decision);
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
        ? `TREND BUY: ${symbol} uptrend, mom ${(st.momentum * 100).toFixed(0)}%`
        : `Trend watch: ${symbol} ${st.currentPrice > st.sma200 ? 'above' : 'below'} 200d SMA, mom ${(st.momentum * 100).toFixed(0)}%`,
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
    tradingLogger.logError(`Trend evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
    return { shouldEnter: false, reason: error.message, source: SLUG };
  }
}

/**
 * Plugin-owned exit: leave to CASH the moment the holding breaks trend
 * (close < 200d SMA OR 12-1 momentum <= 0). This is what removes the bear tail.
 * Returns null on a data failure so the dispatcher's backstops still apply.
 */
async function evaluateExit(session, symbol, position, _ctx) {
  const cfg = session.config || {};
  const st = await _trendState(symbol, cfg);
  if (!st) return null; // can't judge → let the engine's failure-counter backstop handle it

  const shouldExit = !st.uptrend; // exit if not (above SMA AND momentum>0)
  const pnlPercent = position.unrealizedPnLPercent || 0;
  if (!shouldExit) {
    return {
      shouldExit: false,
      reason: 'trend intact',
      currentPrice: st.currentPrice,
    };
  }
  const why =
    st.currentPrice <= st.sma200
      ? `close ${st.currentPrice.toFixed(2)} < 200d SMA ${st.sma200.toFixed(2)}`
      : `12-1 momentum ${(st.momentum * 100).toFixed(1)}% ≤ 0`;
  return {
    shouldExit: true,
    symbol,
    action: 'SELL',
    confidence: 100,
    exitReason: `Trend break — ${why}`,
    reasons: [`TREND EXIT: ${why}`],
    currentPrice: st.currentPrice,
    pnlPercent,
    isPartialExit: false,
    source: SLUG,
  };
}

module.exports = {
  slug: SLUG,
  trendStateFromCloses, // exported for faithfulness certification
  confidenceFromState, // exported for ordering-parity certification
  mutableFields: [], // trend params are not self-mutable (regime-rule, not tunable)
  // Disable the engine's intraday risk exits — the trend exit governs. (The
  // dispatcher routes exits to evaluateExit above, but set these so any
  // fall-through can't EOD-close or stop a multi-month trend position.)
  holdPolicy: {
    horizon: 'position',
    exitBeforeClose: false,
    maxHoldDays: 99999,
    minHoldMinutes: 0,
  },
  evaluate,
  evaluateExit,
};
