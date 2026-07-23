/**
 * Vol-Targeted Mix Strategy Plugin (SOXX/GLD, validated OOS Sharpe 1.30)
 *
 * Portfolio rule, not a per-symbol signal: hold a monthly-rebalanced two-asset
 * mix (deployed: 50% SOXX / 50% GLD) and scale TOTAL exposure by a volatility
 * target — scalar = min(1, targetVol / trailing realized vol of the mix). High
 * vol → scale toward cash; calm → full mix. The 2026-07-21 sharpe-hunt verdict:
 * stitched WF-OOS Sharpe 1.30 vs EW(SOXX,GLD) control 1.22 (ΔCalmar +0.15),
 * cost-robust at 2x; fails only gate 5 (multiplicity) pending forward evidence.
 *
 * FAITHFULNESS CONTRACT: the decision lives in @keo/quant-core
 * volTargetMixCore (pure; the backtest validate-vol-target-mix.js calls the
 * SAME function), certified by scripts/backtests/certify-vol-target-mix.js.
 * This module only fetches aligned daily closes, translates session config,
 * and DISCRETIZES the continuous target weights into engine enter/exit
 * decisions. Recorded residuals (execution, not decision): entry/exit weight
 * hysteresis, engine slot sizing, intraday timing.
 *
 * Discretization: the backtest holds continuous weights; the engine holds
 * whole positions. A leg is entered while its target weight >= enterAboveWeight
 * and exited once it falls below exitBelowWeight (hysteresis prevents churn
 * when the scalar hovers at a threshold).
 */

const tradingLogger = require('../tradingLogger');
const websocketServer = require('../websocketServer');
const alpacaClient = require('../alpacaClient');
const { volTargetMixCore } = require('@keo/quant-core');

const SLUG = 'vol-target-mix';

const EXEC_DEFAULTS = {
  pairA: 'SOXX',
  pairB: 'GLD',
  enterAboveWeight: 0.2, // enter a leg when its target weight >= this
  exitBelowWeight: 0.15, // exit a leg when its target weight < this
};

// Daily aligned-pair cache (one fetch per pair per ET day).
const pairCache = new Map();
function _etDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Fetch split+dividend-adjusted daily bars for both legs through YESTERDAY
 * (same basis as every backtest) and align them on their common dates.
 * @returns {{dates: string[], closesA: number[], closesB: number[]}|null}
 */
async function _alignedPair(symA, symB) {
  const key = `${symA}|${symB}|${_etDay()}`;
  if (pairCache.has(key)) return pairCache.get(key);
  const end = new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10);
  // ~1.5 trading months of vol window + monthly resets need little history,
  // but a generous window keeps month boundaries + warmup well covered.
  const start = new Date(Date.now() - 430 * 864e5).toISOString().slice(0, 10);
  let out = null;
  try {
    const [barsA, barsB] = await Promise.all([
      alpacaClient.getBars(symA, '1Day', start, end, 10000, 'all'),
      alpacaClient.getBars(symB, '1Day', start, end, 10000, 'all'),
    ]);
    const mapB = new Map(
      (barsB || [])
        .filter(b => b && b.timestamp && b.close > 0)
        .map(b => [b.timestamp.slice(0, 10), b.close])
    );
    const dates = [];
    const closesA = [];
    const closesB = [];
    for (const b of barsA || []) {
      if (!b || !b.timestamp || !(b.close > 0)) continue;
      const d = b.timestamp.slice(0, 10);
      const pb = mapB.get(d);
      if (pb == null) continue; // both legs must have the bar (shared calendar)
      dates.push(d);
      closesA.push(b.close);
      closesB.push(pb);
    }
    if (dates.length) out = { dates, closesA, closesB };
  } catch {
    out = null; // fail-safe: no data → no decision (engine backstops apply)
  }
  pairCache.set(key, out);
  return out;
}

/** Session-config translation → execution params (pure). */
function execParams(cfg = {}) {
  const vt = cfg.voltarget || {};
  return {
    pairA: (vt.pairA || EXEC_DEFAULTS.pairA).toUpperCase(),
    pairB: (vt.pairB || EXEC_DEFAULTS.pairB).toUpperCase(),
    enterAboveWeight: vt.enterAboveWeight ?? EXEC_DEFAULTS.enterAboveWeight,
    exitBelowWeight: vt.exitBelowWeight ?? EXEC_DEFAULTS.exitBelowWeight,
  };
}

/**
 * Pure decision from aligned series + session config. Exported so
 * certify-vol-target-mix.js can prove this module's config translation matches
 * the backtests' direct use of the shared core. Adds NO decision logic beyond
 * the core call.
 * @returns {object|null} { scalar, realizedVol, weights:{a,b,cash} }
 */
function volTargetStateFromCloses(dates, closesA, closesB, cfg = {}) {
  const vt = cfg.voltarget || {};
  const st = volTargetMixCore.evaluate(dates, closesA, closesB, {
    mixW: vt.mixW || volTargetMixCore.DEFAULTS.mixW,
    targetVol: vt.targetVol || volTargetMixCore.DEFAULTS.targetVol,
    volWindow: vt.volWindow || volTargetMixCore.DEFAULTS.volWindow,
  });
  if (!st.ok) return null;
  return {
    scalar: st.scalar,
    realizedVol: st.realizedVol,
    weights: st.weights,
  };
}

async function _state(cfg) {
  const { pairA, pairB } = execParams(cfg);
  const pair = await _alignedPair(pairA, pairB);
  if (!pair) return null;
  return volTargetStateFromCloses(pair.dates, pair.closesA, pair.closesB, cfg);
}

// Once-per-ET-day state line so "why no trades" is readable straight from the
// log (2026-07-22 finding: the plugin was silent below the entry bar, and the
// day's 4,668-evaluation funnel was opaque without offline recomputation).
// The decision only changes daily (bars through yesterday), so one line per
// day per session captures it fully — no 10-second-tick spam.
const _stateLoggedDay = new Map(); // sessionId -> ET day already logged
function _logDailyState(session, st, cfg) {
  const day = _etDay();
  if (_stateLoggedDay.get(session.sessionId) === day) return;
  _stateLoggedDay.set(session.sessionId, day);
  const { pairA, pairB, enterAboveWeight } = execParams(cfg);
  const w = st.weights;
  const entering = Math.max(w.a, w.b) >= enterAboveWeight;
  tradingLogger.logInfo(
    `Vol-target state ${day}: mix vol ${(st.realizedVol * 100).toFixed(1)}% → scalar ${(st.scalar * 100).toFixed(0)}% → targets ${pairA} ${(w.a * 100).toFixed(1)}% / ${pairB} ${(w.b * 100).toFixed(1)}% / cash ${(w.cash * 100).toFixed(1)}% — ${entering ? 'ABOVE' : 'below'} the ${(enterAboveWeight * 100).toFixed(0)}% entry bar`,
    {
      sessionId: session.sessionId,
      sessionName: session.name,
      scalar: st.scalar,
      realizedVol: st.realizedVol,
      weights: w,
      enterAboveWeight,
    }
  );
}

/** Target weight for one symbol of the pair (null if not in the pair). */
function _legWeight(st, symbol, cfg) {
  const { pairA, pairB } = execParams(cfg);
  if (symbol === pairA) return st.weights.a;
  if (symbol === pairB) return st.weights.b;
  return null;
}

async function evaluate(session, symbol, ctx) {
  const sessionId = session.sessionId;
  const cfg = session.config || {};
  try {
    const st = await _state(cfg);
    if (!st) {
      return {
        shouldEnter: false,
        reason: 'insufficient daily history for vol-target state',
        source: SLUG,
      };
    }
    _logDailyState(session, st, cfg);
    const w = _legWeight(st, symbol, cfg);
    if (w == null) {
      return {
        shouldEnter: false,
        reason: `${symbol} not part of the vol-target pair`,
        source: SLUG,
      };
    }
    const { enterAboveWeight } = execParams(cfg);
    const shouldEnter = w >= enterAboveWeight;
    // Confidence is a monotone map of the exposure scalar: calm regime (full
    // exposure) → high confidence; vol spike (scaled down) → low.
    const confidence = Math.round(55 + 40 * Math.min(1, st.scalar));
    const reasons = [
      `mix realized vol ${(st.realizedVol * 100).toFixed(1)}% vs target — exposure scalar ${(st.scalar * 100).toFixed(0)}%`,
      `${symbol} target weight ${(w * 100).toFixed(1)}% (enter ≥ ${(enterAboveWeight * 100).toFixed(0)}%)`,
    ];
    const lastPrice = null; // engine executes at market; no price condition here

    const decision = {
      shouldEnter,
      symbol,
      confidence,
      action: 'BUY',
      reasons,
      currentPrice: lastPrice,
      indicators: {
        scalar: st.scalar,
        realizedVol: st.realizedVol,
        targetWeight: w,
      },
      timestamp: new Date(),
      source: SLUG,
    };
    if (shouldEnter && ctx && typeof ctx.logDecision === 'function') {
      ctx.logDecision(sessionId, decision);
      websocketServer.sendAIDecision(session.userId, {
        ...decision,
        sessionName: session.name,
      });
    }
    return decision;
  } catch (error) {
    tradingLogger.logError(`Vol-target evaluation failed for ${symbol}`, {
      sessionId,
      sessionName: session?.name,
      symbol,
      error: error.message,
    });
    return { shouldEnter: false, reason: error.message, source: SLUG };
  }
}

/**
 * Plugin-owned exit: leave a leg once its target weight drops below the
 * hysteresis floor (vol spiked → the core wants much less exposure).
 * Returns null on a data failure so the dispatcher's backstops still apply.
 */
async function evaluateExit(session, symbol, position, _ctx) {
  const cfg = session.config || {};
  const st = await _state(cfg);
  if (!st) return null;
  const w = _legWeight(st, symbol, cfg);
  if (w == null) return null;
  const { exitBelowWeight } = execParams(cfg);
  if (w >= exitBelowWeight) {
    return {
      shouldExit: false,
      reason: `target weight ${(w * 100).toFixed(1)}% ≥ floor ${(exitBelowWeight * 100).toFixed(0)}%`,
    };
  }
  const why = `target weight ${(w * 100).toFixed(1)}% < ${(exitBelowWeight * 100).toFixed(0)}% (vol ${(st.realizedVol * 100).toFixed(1)}% → scalar ${(st.scalar * 100).toFixed(0)}%)`;
  return {
    shouldExit: true,
    symbol,
    action: 'SELL',
    confidence: 100,
    exitReason: `Vol-target de-risk — ${why}`,
    reasons: [`VOL-TARGET EXIT: ${why}`],
    pnlPercent: position.unrealizedPnLPercent || 0,
    source: SLUG,
  };
}

module.exports = {
  slug: SLUG,
  evaluate,
  evaluateExit,
  volTargetStateFromCloses,
  execParams,
  mutableFields: [
    'voltarget.targetVol',
    'voltarget.volWindow',
    'voltarget.enterAboveWeight',
    'voltarget.exitBelowWeight',
  ],
  holdPolicy: {
    horizon: 'position',
    exitBeforeClose: false,
    maxHoldDays: null,
    minHoldMinutes: 60,
  },
};
