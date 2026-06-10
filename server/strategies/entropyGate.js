// server/strategies/entropyGate.js
// Shannon-entropy-based regime gate. Reads each broker's regime config and
// vetoes entries that don't match the preferred entropy state.
//
// Only fires for sessions with config.entropyGateEnabled=true. Non-broker
// sessions short-circuit immediately with allow=true.
//
// FAITHFULNESS CONTRACT: the decision itself lives in
// @keo/quant-core entropyGateCore.evaluateEntropyGate — a pure function of
// (daily closes, config) that backtests call too. This module only fetches
// the closes and caches them. It must NOT add decision logic of its own.
// (The previous version chained ΔH across engine calls minutes apart, while
// backtests chained it across days — the audit measured ~90x divergence in
// block rate. ΔH is now defined per trading day inside the shared core.)

const polygonClient = require('../polygonClient');
const { entropyGateCore } = require('@keo/quant-core');
const tradingLogger = require('../tradingLogger');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — entropy changes slowly
const closesCache = new Map(); // key: symbol|days → { closes, expires }

/**
 * Pure decision from a closes series + session config. Exported so the
 * faithfulness certification harness can drive this module's exact
 * config translation on historical series and compare it against the
 * backtests' direct use of the shared core.
 */
function decideFromCloses(closes, sessionConfig = {}) {
  return entropyGateCore.evaluateEntropyGate(closes, {
    windows:
      Array.isArray(sessionConfig.entropyWindows) &&
      sessionConfig.entropyWindows.length
        ? sessionConfig.entropyWindows
        : undefined,
    preferredRegime: sessionConfig.preferredRegime,
    blockOnTransition: sessionConfig.blockOnRegimeTransition !== false,
  });
}

/**
 * Decide whether the current entropy regime matches the broker's preference.
 * Returns { allow, regime, reason }.
 */
async function checkEntropyGate(session, symbol) {
  const cfg = session.config || {};
  if (!cfg.entropyGateEnabled) return { allow: true };

  const refSymbol = (cfg.regimeReferenceSymbol || symbol).toUpperCase();
  const windows =
    Array.isArray(cfg.entropyWindows) && cfg.entropyWindows.length
      ? cfg.entropyWindows
      : entropyGateCore.DEFAULT_WINDOWS;

  const closes = await _getCloses(refSymbol, Math.max(...windows));
  if (!closes) {
    // Could not fetch (transient data issue). Fail open, same as before.
    return {
      allow: true,
      regime: { state: 'unknown', confidence: 0, normH: 0 },
      reason: 'entropy unavailable',
    };
  }

  return decideFromCloses(closes, cfg);
}

async function _getCloses(refSymbol, maxWindow) {
  const days = Math.max(maxWindow * 2, 300);
  const key = `${refSymbol}|${days}`;
  const cached = closesCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.closes;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const bars = await polygonClient.getHistoricalAggregates(
      refSymbol,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
      'day'
    );
    if (!bars || !bars.length) return null;
    const closes = bars.map(b => b.close || b.c).filter(x => x > 0);
    if (closes.length < maxWindow + 2) return null;
    closesCache.set(key, { closes, expires: Date.now() + CACHE_TTL_MS });
    return closes;
  } catch (err) {
    tradingLogger.logError(`[EntropyGate] fetch failed for ${refSymbol}`, {
      error: err.message,
    });
    return null;
  }
}

function clearCache() {
  closesCache.clear();
}

module.exports = { checkEntropyGate, decideFromCloses, clearCache };
