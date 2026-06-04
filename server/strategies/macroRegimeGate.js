/**
 * Macro regime gate (FRED). A cross-broker risk-on / risk-off overlay that
 * scales position size — left-tail insurance, NOT a standalone return series.
 *
 * Mirrors entropyGate's contract: checkMacroGate(session) -> { allow, sizeScalar,
 * regime, reason }. Only does anything when a broker opts in
 * (config.macroGateEnabled) AND a FRED_API_KEY is set; otherwise it returns
 * { allow:true, sizeScalar:1 } and is completely inert.
 *
 * Signals (see fredClient): yield-curve slope (T10Y2Y) + HY credit spread
 * (BAMLH0A0HYM2) vs its own 6-month average.
 *   - RISK-ON   (curve positive AND HY below its 6mo MA): full size (×1.0).
 *   - RISK-OFF  (otherwise): trade smaller (×config.macroRiskOffScalar, def 0.25).
 *   - FORCE-FLAT(HY spiking >25% over its 6mo MA, or curve deeply inverted): veto
 *     new entries (allow:false). This is the "credit is breaking" stop.
 *
 * Like the entropy gate this is per-broker opt-in: it suits the absolute-trend
 * broker (cash leg already), not the always-invested cross-sectional one.
 */

const fredClient = require('../macro/fredClient');

const DEEP_INVERSION = -0.5; // T10Y2Y below this = deeply inverted curve
const HY_SPIKE_MULT = 1.25; // HY spread this far over its 6mo MA = credit stress

const ALLOW_FULL = { allow: true, sizeScalar: 1 };

async function checkMacroGate(session) {
  const cfg = (session && session.config) || {};
  if (!cfg.macroGateEnabled) {
    return {
      ...ALLOW_FULL,
      regime: { state: 'disabled' },
      reason: 'macro gate disabled',
    };
  }
  if (!fredClient.isConfigured()) {
    return {
      ...ALLOW_FULL,
      regime: { state: 'no-key' },
      reason: 'FRED_API_KEY not set — macro gate inert',
    };
  }

  const snap = await fredClient.getMacroSnapshot();
  if (!snap) {
    return {
      ...ALLOW_FULL,
      regime: { state: 'unavailable' },
      reason: 'macro data unavailable — fail open',
    };
  }

  const { curveSlope, hySpread, hySpread6moMA } = snap;
  const riskOffScalar = cfg.macroRiskOffScalar ?? 0.25;
  const deepInversion = curveSlope < DEEP_INVERSION;
  const hySpike = hySpread > hySpread6moMA * HY_SPIKE_MULT;

  const base = {
    state: null,
    curveSlope,
    hySpread,
    hySpread6moMA,
    asOf: snap.asOf,
  };

  if (curveSlope > 0 && hySpread < hySpread6moMA) {
    return {
      allow: true,
      sizeScalar: 1,
      regime: { ...base, state: 'risk-on' },
      reason: `risk-on (curve +${curveSlope.toFixed(2)}, HY ${hySpread.toFixed(2)} < 6mo MA ${hySpread6moMA.toFixed(2)})`,
    };
  }
  if (hySpike || deepInversion) {
    return {
      allow: false,
      sizeScalar: 0,
      regime: { ...base, state: 'force-flat' },
      reason: hySpike
        ? `force-flat: HY ${hySpread.toFixed(2)} spiking >${Math.round((HY_SPIKE_MULT - 1) * 100)}% over 6mo MA ${hySpread6moMA.toFixed(2)}`
        : `force-flat: curve deeply inverted (${curveSlope.toFixed(2)})`,
    };
  }
  return {
    allow: true,
    sizeScalar: riskOffScalar,
    regime: { ...base, state: 'risk-off' },
    reason: `risk-off (curve ${curveSlope.toFixed(2)}, HY ${hySpread.toFixed(2)} vs 6mo MA ${hySpread6moMA.toFixed(2)}) → size ×${riskOffScalar}`,
  };
}

module.exports = { checkMacroGate };
