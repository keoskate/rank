// packages/quant-core/src/entropyGateCore.js
//
// THE entropy-gate decision. Pure function of (daily closes, config).
//
// Both the live gate (server/strategies/entropyGate.js) and every backtest
// MUST call this — that is the faithfulness contract. The audit found the
// previous arrangement blocked ~90x more in backtest than live because the
// two sides computed ΔH at different cadences: live chained "previous H"
// across engine CALLS (minutes apart → ΔH≈0 → the transition block almost
// never fired), while backtests chained it across DAYS. The regime spec is
// daily, so ΔH is defined here as normH(today) − normH(yesterday), both
// derived from the same closes series. No hidden per-session state.

const {
  entropySnapshot,
  classifyRegime,
  DEFAULT_BINS,
} = require('./shannonEntropy');

const DEFAULT_WINDOWS = [21, 63, 252];

/**
 * Evaluate the entropy regime gate on a daily close series.
 *
 * @param {number[]} closes - daily closes of the regime reference symbol,
 *        oldest→newest, ending at the decision day's close. Needs at least
 *        max(windows)+2 points; otherwise the gate allows (fail-open, same
 *        as the live gate's "entropy unavailable" behavior).
 * @param {object} cfg
 * @param {number[]} [cfg.windows=[21,63,252]]
 * @param {'low-entropy'|'high-entropy'|'neutral'|'any'} [cfg.preferredRegime='any']
 * @param {boolean} [cfg.blockOnTransition=true]
 * @param {number} [cfg.bins=20]
 * @param {object} [cfg.thresholds] - {lowCut, highCut, transitionDelta}
 * @returns {{allow: boolean, regime: object, reason: string}}
 */
function evaluateEntropyGate(closes, cfg = {}) {
  const windows =
    Array.isArray(cfg.windows) && cfg.windows.length
      ? cfg.windows
      : DEFAULT_WINDOWS;
  const bins = cfg.bins || DEFAULT_BINS;
  const preferred = cfg.preferredRegime || 'any';
  const blockOnTransition = cfg.blockOnTransition !== false;
  const maxWindow = Math.max(...windows);

  if (!closes || closes.length < maxWindow + 2) {
    return {
      allow: true,
      regime: { state: 'unknown', confidence: 0, normH: 0, deltaH: 0 },
      reason: 'entropy unavailable',
    };
  }

  const activeWindow = Math.min(...windows);
  const snapNow = entropySnapshot(closes, windows, bins);
  const snapPrev = entropySnapshot(closes.slice(0, -1), windows, bins);
  const H = snapNow[activeWindow];
  const prevH = snapPrev[activeWindow];
  if (H == null) {
    return {
      allow: true,
      regime: { state: 'unknown', confidence: 0, normH: 0, deltaH: 0 },
      reason: 'entropy unavailable',
    };
  }

  const regime = classifyRegime(H, snapNow.Hmax, prevH, cfg.thresholds || {});

  if (blockOnTransition && regime.state === 'transitioning') {
    return {
      allow: false,
      regime,
      reason: `regime transitioning (ΔH=${regime.deltaH.toFixed(3)}) — blocking entry`,
    };
  }
  if (preferred === 'any') {
    return { allow: true, regime, reason: 'any-regime broker' };
  }
  if (regime.state === preferred) {
    return {
      allow: true,
      regime,
      reason: `regime ${regime.state} matches preferred`,
    };
  }
  return {
    allow: false,
    regime,
    reason: `regime ${regime.state} (normH=${regime.normH.toFixed(2)}) ≠ preferred ${preferred}`,
  };
}

module.exports = { evaluateEntropyGate, DEFAULT_WINDOWS };
