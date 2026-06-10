// packages/quant-core/src/allocatorCore.js
//
// THE capital allocator (ROADMAP C8). Pure function of (sleeve return
// histories, config) — the same faithfulness contract as trendCore /
// entropyGateCore: the backtest combiner and the future live broker-capital
// reallocation job MUST both call this, certified by a certify-*.js script
// before the live job ever moves a dollar.
//
// DESIGN (frozen 2026-06-10, data/reports/c8-allocator-design-2026-06.md):
// core + satellite, NOT symmetric risk parity. Lessons priced in:
//  - The frozen inverse-vol combo convention handed a low-vol/lower-Sharpe
//    satellite a 54% mean weight and was rejected twice (sleeve corr 0.637
//    and 0.349). Symmetric vol-weighting ignores WHICH sleeve carries the
//    validated edge.
//  - Trailing-mean Sharpe estimation over 63d windows is noise — allocators
//    built on it whipsaw. This core therefore estimates ONLY vol (stable),
//    and bounds the satellite by a conviction CAP set from institutional
//    convention (alternatives sleeves run 10-25% of book), never from the
//    backtest window.
//  - Daily weight drift bleeds allocator fees. Weights recompute on a
//    MONTHLY cadence (first trading day, using returns through the prior
//    day) and hold in between.
//
// w_satellite(month m) = min(cap, invVol share) where
//   invVol share = (1/volS) / (1/volC + 1/volS), vols = sample sd of daily
//   returns over the trailing volWindow days ending the day BEFORE the
//   rebalance day. Insufficient history → warmup weight = cap/2.
// w_core = 1 − w_satellite. Long-only, fully invested, no leverage.

const DEFAULTS = { cap: 0.2, volWindow: 63, minObs: 40 };

function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute the satellite weight series on a monthly cadence.
 *
 * @param {string[]} dates - master calendar (ISO), aligned to both series
 * @param {Array<number|null>} coreReturns
 * @param {Array<number|null>} satReturns
 * @param {object} [cfg] - { cap, volWindow, minObs }
 * @returns {{wSat: Array<number|null>, rebalanceDays: number[]}} wSat[i] is
 *   the satellite weight HELD on day i (null before both sleeves have
 *   data); weight changes only on the first trading day of a month.
 */
function cappedSatelliteWeights(dates, coreReturns, satReturns, cfg = {}) {
  const cap = cfg.cap ?? DEFAULTS.cap;
  const volWindow = cfg.volWindow ?? DEFAULTS.volWindow;
  const minObs = cfg.minObs ?? DEFAULTS.minObs;
  const n = dates.length;
  const wSat = new Array(n).fill(null);
  const rebalanceDays = [];
  let current = null;
  for (let i = 0; i < n; i++) {
    if (coreReturns[i] == null || satReturns[i] == null) continue;
    const isMonthStart =
      i === 0 || dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7);
    if (current == null || isMonthStart) {
      // recompute from data through day i-1 only
      const winC = [];
      const winS = [];
      for (let j = Math.max(0, i - volWindow); j < i; j++) {
        if (coreReturns[j] != null) winC.push(coreReturns[j]);
        if (satReturns[j] != null) winS.push(satReturns[j]);
      }
      let w = cap / 2; // warmup default: half-conviction
      if (winC.length >= minObs && winS.length >= minObs) {
        const volC = sampleSd(winC);
        const volS = sampleSd(winS);
        if (volC > 0 && volS > 0) {
          w = Math.min(cap, 1 / volS / (1 / volC + 1 / volS));
        }
      }
      if (current == null || Math.abs(w - current) > 1e-12) {
        rebalanceDays.push(i);
      }
      current = w;
    }
    wSat[i] = current;
  }
  return { wSat, rebalanceDays };
}

/**
 * Combine core+satellite daily returns under a weight series, charging the
 * allocator fee on weight CHANGES only (rebalance days): feePerSide on each
 * side of the reallocation, i.e. fee * 2 * |Δw|, scaled by costMultiplier
 * (the gate-4 2x stress must stress all costs). First active day uncharged
 * — sleeve-level entry costs live inside the sleeves.
 */
function combineWithWeights(
  coreReturns,
  satReturns,
  wSat,
  { feePerSide = 0.0005, costMultiplier = 1 } = {}
) {
  const n = coreReturns.length;
  const out = new Array(n).fill(null);
  let prevW = null;
  for (let i = 0; i < n; i++) {
    if (coreReturns[i] == null || satReturns[i] == null || wSat[i] == null) {
      continue;
    }
    const w = wSat[i];
    const dw = prevW == null ? 0 : Math.abs(w - prevW);
    out[i] =
      (1 - w) * coreReturns[i] +
      w * satReturns[i] -
      feePerSide * costMultiplier * 2 * dw;
    prevW = w;
  }
  return out;
}

module.exports = { cappedSatelliteWeights, combineWithWeights, DEFAULTS };
