// packages/quant-core/src/significance.js
//
// Multiple-testing-aware significance for strategy returns. Pure, no I/O.
//
// The problem this solves: try ~10 strategies and the best one looks great by
// luck alone (~40% chance one clears Sharpe 1 in-sample if all are null).
// These tools quantify that:
//  - PSR (Probabilistic Sharpe Ratio, Bailey & López de Prado 2012): the
//    probability the true Sharpe exceeds a benchmark given T observations and
//    the non-normality of returns (skew/kurtosis widen the error bars).
//  - DSR (Deflated Sharpe Ratio): PSR against the Sharpe you'd EXPECT the best
//    of N random trials to show. Requires an honest trial count N — that is
//    what the trials ledger exists for.
//  - Benjamini-Hochberg FDR for batch testing across a strategy family.
//
// Convention: sr, skew, kurt here are in PER-PERIOD units (daily for daily
// returns). Annualized Sharpe ≈ sr * sqrt(252) — annualize only for display.

/** Standard normal CDF (Abramowitz-Stegun erf approximation). */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  let p =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

/** Inverse standard normal CDF (Acklam's approximation). */
function normInv(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pl = 0.02425;
  let q;
  let r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Per-period Sharpe + higher moments of a returns sample.
 */
function sharpeMoments(returns) {
  const T = returns.length;
  if (T < 3) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / T;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const r of returns) {
    const d = r - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= T;
  m3 /= T;
  m4 /= T;
  const sd = Math.sqrt(m2);
  if (sd === 0) return null;
  return {
    sr: mean / sd,
    skew: m3 / Math.pow(sd, 3),
    kurt: m4 / (m2 * m2), // raw kurtosis (normal = 3)
    T,
    annualizedSharpe: (mean / sd) * Math.sqrt(252),
  };
}

/**
 * Probabilistic Sharpe Ratio: P(true SR > srRef | observed sr, T, skew, kurt).
 * All in per-period units.
 */
function psr({ sr, srRef = 0, T, skew = 0, kurt = 3 }) {
  if (!(T > 1)) return null;
  const denom = Math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr);
  if (!(denom > 0)) return null;
  return normCdf(((sr - srRef) * Math.sqrt(T - 1)) / denom);
}

const EULER_GAMMA = 0.5772156649015329;

/**
 * Expected maximum Sharpe of nTrials independent null strategies whose trial
 * Sharpes have variance varTrialsSR (per-period units).
 * E[max] ≈ sqrt(var) * ((1-γ)Φ⁻¹(1-1/N) + γΦ⁻¹(1-1/(N·e)))
 */
function expectedMaxSharpe(nTrials, varTrialsSR) {
  if (!(nTrials > 1) || !(varTrialsSR > 0)) return 0;
  const sd = Math.sqrt(varTrialsSR);
  return (
    sd *
    ((1 - EULER_GAMMA) * normInv(1 - 1 / nTrials) +
      EULER_GAMMA * normInv(1 - 1 / (nTrials * Math.E)))
  );
}

/**
 * Deflated Sharpe Ratio: PSR measured against the expected-max-of-N-trials
 * Sharpe instead of zero. dsr >= 0.95 ≈ "unlikely to be the lucky best of N".
 */
function deflatedSharpe({ sr, T, skew = 0, kurt = 3, nTrials, varTrialsSR }) {
  const srStar = expectedMaxSharpe(nTrials, varTrialsSR);
  return {
    dsr: psr({ sr, srRef: srStar, T, skew, kurt }),
    srStar,
    srStarAnnualized: srStar * Math.sqrt(252),
    nTrials,
  };
}

/**
 * Benjamini-Hochberg FDR control. Input p-values; returns which are rejected
 * (declared significant) at false-discovery rate q.
 */
function benjaminiHochberg(pvals, q = 0.1) {
  const idx = pvals.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const m = pvals.length;
  let cut = -1;
  for (let k = 0; k < m; k++) {
    if (idx[k].p <= ((k + 1) / m) * q) cut = k;
  }
  const rejected = new Array(m).fill(false);
  for (let k = 0; k <= cut; k++) rejected[idx[k].i] = true;
  return { rejected, threshold: cut >= 0 ? idx[cut].p : 0, q };
}

module.exports = {
  normCdf,
  normInv,
  sharpeMoments,
  psr,
  expectedMaxSharpe,
  deflatedSharpe,
  benjaminiHochberg,
};
