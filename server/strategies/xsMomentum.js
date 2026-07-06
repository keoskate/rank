/**
 * Cross-Sectional Momentum Strategy Plugin (6-1, top quintile)
 *
 * Broker #2 from the edge-research workflow — genuine (if thin) SELECTION
 * alpha: it beat a survivorship-matched control by +0.16 Sharpe / +7% CAGR and
 * actually OUTPERFORMED in the 2022 bear by rotating into energy/staples.
 *
 * The rule: rank a fixed ~45-name liquid large-cap universe by 6-1 month
 * momentum (return from t-126 to t-21 — 6 months, skipping the most recent
 * month to dodge short-term reversal). Hold the TOP QUINTILE (~9 names),
 * equal-weight, fully invested. REBALANCE MONTHLY — the ranking is frozen for
 * the month, then recomputed on the first scan of the next month, so a name is
 * sold only when it drops out of the new top quintile. No intramonth stops
 * (they break the factor).
 *
 * Use 6-1 ONLY — the 12-1 variant failed the survivorship control.
 *
 * Unlike trend-following this is RELATIVE selection, not absolute trend: it's
 * always fully long the strongest names even in a downturn (no cash leg). That
 * means it carries normal equity drawdowns — the regime gate (future) is what
 * would de-risk it; until then it runs un-gated, by design.
 *
 * Owns entry (in-quintile) and exit (dropped-out-of-quintile).
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaStream = require('../alpacaStreamClient');
const polygonClient = require('../polygonClient');
const { trimCore } = require('@keo/quant-core');

const SLUG = 'cross-sectional-momentum';

const MOM_LOOKBACK = 126; // ~6 months
const MOM_SKIP = 21; // skip most recent ~1 month

// Daily-bar cache (one fetch per symbol per ET day) + monthly quintile cache.
const barCache = new Map();
const quintileCache = new Map(); // `${sessionId}|${YYYY-MM}` -> { set:Set, ranks:Map }

function _etDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
function _etMonth() {
  return _etDay().slice(0, 7); // YYYY-MM
}

async function _dailyCloses(symbol) {
  const key = `${symbol}|${_etDay()}`;
  if (barCache.has(key)) return barCache.get(key);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 300 * 864e5).toISOString().slice(0, 10);
  let bars = [];
  try {
    bars = await polygonClient.getHistoricalAggregates(
      symbol,
      start,
      end,
      'day'
    );
  } catch {
    bars = [];
  }
  const closes = Array.isArray(bars)
    ? bars.map(b => b.close).filter(Number.isFinite)
    : [];
  barCache.set(key, closes);
  return closes;
}

function _momentum(closes) {
  const n = closes.length;
  if (n < MOM_LOOKBACK + 5) return null;
  const pOld = closes[n - 1 - MOM_LOOKBACK];
  const pRecent = closes[n - 1 - MOM_SKIP];
  if (!(pOld > 0) || !(pRecent > 0)) return null;
  return pRecent / pOld - 1;
}

/**
 * Top-quintile membership for this month, cached. Computes 6-1 momentum for the
 * whole watchlist on the first call of the month, freezes it for the month.
 * @returns {Promise<{ set:Set<string>, ranks:Map<string,number> }>}
 */
async function _monthlyQuintile(session) {
  const key = `${session.sessionId}|${_etMonth()}`;
  if (quintileCache.has(key)) return quintileCache.get(key);

  const universe = (session.config?.watchlist || []).map(s => s.toUpperCase());
  const scored = [];
  for (const sym of universe) {
    const mom = _momentum(await _dailyCloses(sym));
    if (mom != null) scored.push([sym, mom]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const topN = Math.max(
    1,
    session.config?.quintileSize || Math.ceil(universe.length / 5)
  );
  const top = scored.slice(0, topN);
  const result = {
    set: new Set(top.map(([s]) => s)),
    ranks: new Map(scored),
  };
  quintileCache.set(key, result);
  tradingLogger.logInfo(
    `[xs-momentum] ${session.name} monthly quintile (${_etMonth()}): ${[...result.set].join(', ')}`,
    { sessionId: session.sessionId, sessionName: session.name }
  );
  return result;
}

async function _price(symbol, closes) {
  const ws = alpacaStream.getLatestPrice(symbol);
  if (ws && !ws.isStale && ws.price > 0) return ws.price;
  return closes && closes.length ? closes[closes.length - 1] : 0;
}

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  try {
    const q = await _monthlyQuintile(session);
    const inTop = q.set.has(symbol.toUpperCase());
    const mom = q.ranks.get(symbol.toUpperCase());
    const closes = await _dailyCloses(symbol);
    const currentPrice = await _price(symbol, closes);
    const confidence =
      mom != null ? Math.max(65, Math.min(95, Math.round(65 + mom * 30))) : 65;
    const shouldEnter = inTop && currentPrice > 0;
    const reasons = [
      `6-1 momentum ${mom != null ? (mom * 100).toFixed(1) + '%' : 'n/a'}`,
      inTop ? 'in top quintile' : 'not in top quintile',
    ];
    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons,
      currentPrice,
      profitTarget: currentPrice * 100, // no %-target; monthly rerank governs
      stopLoss: currentPrice * 0.01, // no stop — intramonth stops break the factor
      atr: currentPrice * 0.02,
      indicators: { momentum61: mom },
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
        ? `MOMENTUM BUY: ${symbol} top-quintile, 6-1 mom ${(mom * 100).toFixed(0)}%`
        : `Momentum watch: ${symbol} ${reasons[1]}`,
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
    tradingLogger.logError(`xs-momentum evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
    return { shouldEnter: false, reason: error.message, source: SLUG };
  }
}

/**
 * Exit when the holding drops out of this month's top quintile. The quintile is
 * frozen for the month, so positions are stable until the monthly rerank.
 */
async function evaluateExit(session, symbol, position, ctx) {
  try {
    const q = await _monthlyQuintile(session);
    const stillIn = q.set.has(symbol.toUpperCase());
    const closes = await _dailyCloses(symbol);
    const currentPrice = await _price(symbol, closes);
    if (stillIn) {
      // Still in the quintile — but if armed, trim a winner once. NOTE: disabled
      // by default (trimAtProfitPercent: null) and intentionally left off on the
      // momentum broker until a dollar-ledger momentum backtest validates it —
      // an intramonth trim is unvalidated against this factor (see plan).
      const trim = trimCore.evaluateTrim(
        {
          unrealizedPnLPercent: position.unrealizedPnLPercent || 0,
          partialExitDone: position.partialExitDone,
        },
        { trimAtProfitPercent: (session.config || {}).trimAtProfitPercent }
      );
      if (trim) {
        return {
          shouldExit: true,
          partialExit: true, // EXECUTABLE flag (not isPartialExit, which is metadata)
          symbol,
          action: 'SELL',
          confidence: 100,
          exitReason: `Trim winner at +${trim.pnlPercent.toFixed(1)}% (≥ ${trim.threshold}%)`,
          reasons: [
            `TRIM: +${trim.pnlPercent.toFixed(1)}% profit, trimming once`,
          ],
          currentPrice,
          pnlPercent: position.unrealizedPnLPercent || 0,
          isPartialExit: true,
          source: SLUG,
        };
      }
      return { shouldExit: false, reason: 'still top quintile', currentPrice };
    }
    return {
      shouldExit: true,
      symbol,
      action: 'SELL',
      confidence: 100,
      exitReason: 'Dropped out of top-quintile momentum (monthly rerank)',
      reasons: ['MOMENTUM EXIT: no longer top quintile'],
      currentPrice,
      pnlPercent: position.unrealizedPnLPercent || 0,
      isPartialExit: false,
      source: SLUG,
    };
  } catch (err) {
    tradingLogger.logError(`xs-momentum exit failed for ${symbol}`, {
      sessionId: session.sessionId,
      symbol,
      error: err.message,
    });
    return null; // let the engine's backstop handle it
  }
}

module.exports = {
  slug: SLUG,
  mutableFields: [], // factor params are fixed (6-1 only); not self-mutable
  // No intramonth stops/targets/EOD — the monthly rerank is the only exit.
  holdPolicy: {
    horizon: 'position',
    exitBeforeClose: false,
    maxHoldDays: 99999,
    minHoldMinutes: 0,
  },
  evaluate,
  evaluateExit,
};
