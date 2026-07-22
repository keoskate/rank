// scripts/backtests/lib/effectiveN.js
//
// THE gate-5 effective-N estimator — the single frozen definition shared by
// the deflation gate (lib/validateStrategy.js) and the study script
// (scripts/backtests/effective-n-study.js).
//
// Method is BINDING per the pre-registration frozen 2026-06-10
// (data/reports/gate5-effectiveN-preregistration-2026-06.md):
//
//   Meff = N² / Σ_ij ρ̂²_ij      (Patton–Ramadorai form, §2 — no substitution)
//
//   - sum over ALL ordered pairs incl. diagonal (ρ̂_ii = 1)
//   - ρ̂ from Pearson on aligned weekly oosFingerprints (≤150 weeks, 6dp),
//     week ends reconstructed by anchoring at the trial's window.end on the
//     NYSE calendar and stepping back 5 trading days per week
//   - pairs with < 26 matched weeks → ρ̂ = 0 (frozen floor, §2.4)
//   - legacy trials without fingerprints → fully independent (§2.5)
//   - alignment ambiguity → anchor shifts {0,1,2}, take LARGEST Meff (§5.2)
//
// Adopted into gate 5 on 2026-07-22 after the §4 acceptance test passed
// (3.5% false-pass rate ≤ 5% on 200 synthetic all-null ledgers) — see
// data/reports/gate5-effectiveN-study-2026-07-22.md. Per §5.3 the correction
// applies to ALL strategies, no exceptions. Both missing-data rules push
// Meff toward the full count — incomplete data can only RAISE the bar.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');

const MIN_WEEKS = 26; // frozen §2.4 — never tune
const MATCH_TOL = 2; // trading days, frozen §2.2
const ANCHOR_SHIFTS = [0, 1, 2]; // §5.2 alignment variants → take max Meff

/** NYSE trading-day calendar from the newest full-history SPY cache. */
function nyseCalendar() {
  const dir = path.join(ROOT, 'data/backtests/bars-cache');
  const f = fs
    .readdirSync(dir)
    .filter(x => x.startsWith('SPY_2016-01-04_') && x.endsWith('_all.json'))
    .sort()
    .pop();
  if (!f) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map(
    b => b.date
  );
}

function makeCalIndex(cal) {
  const idx = new Map(cal.map((d, i) => [d, i]));
  return date => {
    if (idx.has(date)) return idx.get(date);
    for (let i = cal.length - 1; i >= 0; i--) if (cal[i] <= date) return i;
    return -1;
  };
}

function weekEndIndices(trial, anchorShift, calIdxOnOrBefore) {
  const K = trial.fp.length;
  const anchor = calIdxOnOrBefore(trial.end) - anchorShift;
  const ends = new Array(K);
  for (let i = 0; i < K; i++) ends[i] = anchor - 5 * (K - 1 - i);
  return ends;
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

function rhoPair(a, b, shiftA, shiftB, calIdxOnOrBefore) {
  const endsA = weekEndIndices(a, shiftA, calIdxOnOrBefore);
  const endsB = weekEndIndices(b, shiftB, calIdxOnOrBefore);
  const xs = [];
  const ys = [];
  let j = 0;
  for (let i = 0; i < endsA.length; i++) {
    while (j < endsB.length && endsB[j] < endsA[i] - MATCH_TOL) j++;
    if (j < endsB.length && Math.abs(endsB[j] - endsA[i]) <= MATCH_TOL) {
      xs.push(a.fp[i]);
      ys.push(b.fp[j]);
      j++;
    }
  }
  if (xs.length < MIN_WEEKS) return 0;
  return pearson(xs, ys);
}

/**
 * Meff over a set of trials at one anchor shift.
 * @param {Array<{fp: number[]|null, end: string}>} trials
 */
function meffOf(trials, shift, calIdxOnOrBefore) {
  const N = trials.length;
  let sum = N; // diagonal: every trial contributes ρ̂_ii² = 1
  const withFp = trials.filter(t => t.fp);
  for (let i = 0; i < withFp.length; i++) {
    for (let j = i + 1; j < withFp.length; j++) {
      const r = rhoPair(withFp[i], withFp[j], shift, shift, calIdxOnOrBefore);
      sum += 2 * r * r; // ordered pairs (i,j) + (j,i)
    }
  }
  return (N * N) / sum;
}

/** Ledger rows → the trial shape the estimator consumes. */
function trialsFromLedger(ledgerTrials, fallbackEnd) {
  return ledgerTrials.map(t => ({
    fp: Array.isArray(t.oosFingerprint) ? t.oosFingerprint : null,
    end: (t.window && t.window.end) || fallbackEnd,
  }));
}

/**
 * Compute the pre-registered effective trial count over the CURRENT ledger.
 * @returns {{meff: number, ceil: number, variants: number[], N: number,
 *            fingerprinted: number}|null} null if no calendar/ledger available
 *            (caller must fall back to full N — the conservative direction).
 */
function computeMeff() {
  const ledgerPath = path.join(ROOT, 'data/backtests/trials-ledger.json');
  if (!fs.existsSync(ledgerPath)) return null;
  const cal = nyseCalendar();
  if (!cal || !cal.length) return null;
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (e) {
    return null;
  }
  if (!ledger.trials || !ledger.trials.length) return null;
  const calIdxOnOrBefore = makeCalIndex(cal);
  const trials = trialsFromLedger(ledger.trials, cal[cal.length - 1]);
  const variants = ANCHOR_SHIFTS.map(s => meffOf(trials, s, calIdxOnOrBefore));
  const meff = Math.max(...variants); // §5.2: largest defensible N = harder bar
  return {
    meff,
    ceil: Math.ceil(meff),
    variants,
    N: trials.length,
    fingerprinted: trials.filter(t => t.fp).length,
  };
}

module.exports = {
  computeMeff,
  meffOf,
  rhoPair,
  weekEndIndices,
  trialsFromLedger,
  nyseCalendar,
  makeCalIndex,
  MIN_WEEKS,
  MATCH_TOL,
  ANCHOR_SHIFTS,
};
