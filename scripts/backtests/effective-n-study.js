#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/effective-n-study.js
//
// THE GATE-5 EFFECTIVE-N STUDY — executes the pre-registration frozen at
// data/reports/gate5-effectiveN-preregistration-2026-06.md (2026-06-10).
// Run in a LATER session per the temporal two-key rule (§5.1). This script
// follows the frozen document exactly; deviations are impossible-by-design
// choices documented inline, always resolved toward the HARDER bar.
//
// ORDER OF OPERATIONS (per §4: acceptance BEFORE any real-ledger number):
//   1. Read ONLY the real ledger's STRUCTURE (group sizes, fingerprint
//      lengths, availability mix, anchors) — explicitly permitted by §4.
//   2. Acceptance test: 200 synthetic all-null ledgers (seeds 1..200,
//      frozen LCG), matched structure; false-pass rate at DSR>=0.95 must be
//      <= 5% (<= 10 of 200) or Meff is ABANDONED (no second estimator).
//   3. Only if accepted: compute Meff on the real ledger (§2), alignment
//      variants resolved by largest-N (§5.2), and the full before/after DSR
//      table for every scoreboard strategy (§5.3-5.4).
//
// GENERATOR CHOICE (the pre-registration's reviewer flagged this as a
// freedom; frozen here, conservatively): synthetic groups share a common
// factor with loading sqrt(0.5) => cross-group weekly correlation ~0.5 —
// HIGH correlation shrinks synthetic Meff, lowers the synthetic bar, and
// MAXIMIZES the chance of false passes, i.e. the hardest version of the
// acceptance test. Within-group correlation is 1 by construction (shared
// fingerprint), matching §2's grid-as-one-bet semantics.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { significance } = require('@keo/quant-core');

const ROOT = path.join(__dirname, '../..');
const LEDGER = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/backtests/trials-ledger.json'), 'utf8')
);

// NYSE trading-day calendar from the SPY cache (the repo's master calendar).
function nyseCalendar() {
  const dir = path.join(ROOT, 'data/backtests/bars-cache');
  const f = fs
    .readdirSync(dir)
    .filter(x => x.startsWith('SPY_2016-01-04_') && x.endsWith('_all.json'))
    .sort()
    .pop();
  return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map(
    b => b.date
  );
}
const CAL = nyseCalendar();
const CAL_IDX = new Map(CAL.map((d, i) => [d, i]));
function calIdxOnOrBefore(date) {
  if (CAL_IDX.has(date)) return CAL_IDX.get(date);
  for (let i = CAL.length - 1; i >= 0; i--) if (CAL[i] <= date) return i;
  return -1;
}

// ---- §2: pairwise rho on aligned weekly fingerprints ----
const MIN_WEEKS = 26;
const MATCH_TOL = 2; // trading days

function weekEndIndices(trial, anchorShift) {
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

function rhoPair(a, b, shiftA = 0, shiftB = 0) {
  const endsA = weekEndIndices(a, shiftA);
  const endsB = weekEndIndices(b, shiftB);
  // match greedily: both step in 5-day increments, so a single relative
  // offset governs all matches
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

function meffOf(trials, shiftFn) {
  // Sum over ALL ordered pairs incl. diagonal. Legacy (no fp): rho=0 vs all,
  // rho_ii=1 -> contributes exactly 1.
  const N = trials.length;
  let sum = N; // diagonal
  const withFp = trials.filter(t => t.fp);
  for (let i = 0; i < withFp.length; i++) {
    for (let j = i + 1; j < withFp.length; j++) {
      const r = rhoPair(
        withFp[i],
        withFp[j],
        shiftFn(withFp[i]),
        shiftFn(withFp[j])
      );
      sum += 2 * r * r; // ordered pairs (i,j) and (j,i)
    }
  }
  return (N * N) / sum;
}

// ---- frozen LCG (repo convention) ----
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gauss(rand) {
  // Box-Muller, deterministic
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function buildRealTrials() {
  return LEDGER.trials.map((t, k) => ({
    id: k,
    fp: Array.isArray(t.oosFingerprint) ? t.oosFingerprint : null,
    end: (t.window && t.window.end) || CAL[CAL.length - 1],
    sharpe: t.sharpe,
  }));
}

// Group trials by identical fingerprint object (grid siblings share one).
function groupStructure(trials) {
  const groups = new Map();
  for (const t of trials) {
    if (!t.fp) continue;
    const key =
      JSON.stringify(t.fp.slice(0, 6)) + '|' + t.fp.length + '|' + t.end;
    if (!groups.has(key))
      groups.set(key, { size: 0, len: t.fp.length, end: t.end });
    groups.get(key).size++;
  }
  return [...groups.values()];
}

function weeklyMoments(xs) {
  return significance.sharpeMoments(xs);
}

// ---- acceptance test (§4) ----
function acceptanceTest(realTrials) {
  const structure = groupStructure(realTrials);
  const nLegacy = realTrials.filter(t => !t.fp).length;
  const medLen = (() => {
    const lens = realTrials
      .filter(t => t.fp)
      .map(t => t.fp.length)
      .sort((a, b) => a - b);
    return lens[Math.floor(lens.length / 2)] || 150;
  })();
  const LAMBDA = 0.5; // common-factor loading^2 -> cross-group rho ~0.5 (conservative: see header)
  let falsePasses = 0;
  const details = [];
  for (let seed = 1; seed <= 200; seed++) {
    const rand = lcg(seed * 7919);
    // common factor long enough for the longest group
    const maxLen = Math.max(...structure.map(g => g.len), medLen);
    const F = Array.from({ length: maxLen }, () => gauss(rand));
    const trials = [];
    let best = -Infinity;
    let bestSeries = null;
    for (const g of structure) {
      // one null weekly series per group, factor-correlated across groups
      const series = Array.from(
        { length: g.len },
        (_, t) => Math.sqrt(LAMBDA) * F[t] + Math.sqrt(1 - LAMBDA) * gauss(rand)
      );
      const m = weeklyMoments(series);
      for (let k = 0; k < g.size; k++) {
        trials.push({ fp: series, end: g.end });
      }
      if (m && m.sr > best) {
        best = m.sr;
        bestSeries = series;
      }
    }
    for (let k = 0; k < nLegacy; k++) {
      // legacy trials: independent null series (affect best-trial selection,
      // not Meff beyond the +1 diagonal each)
      const series = Array.from({ length: medLen }, () => gauss(rand));
      trials.push({ fp: null, end: CAL[CAL.length - 1] });
      const m = weeklyMoments(series);
      if (m && m.sr > best) {
        best = m.sr;
        bestSeries = series;
      }
    }
    const meff = meffOf(trials, () => 0);
    const m = weeklyMoments(bestSeries);
    const srStar = significance.expectedMaxSharpe(
      Math.ceil(meff),
      1 / medLen // null variance of a weekly-SR estimate at median length
    );
    const dsr = significance.psr({
      sr: m.sr,
      srRef: srStar,
      T: m.T,
      skew: m.skew,
      kurt: m.kurt,
    });
    if (dsr >= 0.95) falsePasses++;
    if (seed <= 3)
      details.push({
        seed,
        meff: meff.toFixed(1),
        bestSr: m.sr.toFixed(3),
        dsr: dsr.toFixed(3),
      });
  }
  return { falsePasses, rate: falsePasses / 200, sample: details };
}

async function main() {
  console.log(
    '# Gate-5 effective-N study — executing the frozen pre-registration'
  );
  const realTrials = buildRealTrials();
  console.log(
    `ledger: ${realTrials.length} trials (${realTrials.filter(t => t.fp).length} fingerprinted in ${groupStructure(realTrials).length} groups, ${realTrials.filter(t => !t.fp).length} legacy-independent)`
  );

  // ---- §4 acceptance FIRST ----
  console.log(
    '\n[1/3] acceptance test: 200 synthetic all-null ledgers (seeds 1..200, lambda=0.5 conservative generator)…'
  );
  const acc = acceptanceTest(realTrials);
  console.log(
    `      false passes: ${acc.falsePasses}/200 (${(acc.rate * 100).toFixed(1)}%) — threshold 5% | sample: ${JSON.stringify(acc.sample)}`
  );
  if (acc.rate > 0.05) {
    console.log(
      '\nACCEPTANCE FAILED — per §4 the Meff correction is ABANDONED; gate 5 keeps the full ledger N. No second estimator will be tried.'
    );
    fs.writeFileSync(
      path.join(ROOT, 'data/reports/gate5-effectiveN-result-2026-06.md'),
      `# Effective-N study result: ABANDONED\n\nAcceptance test failed: ${acc.falsePasses}/200 synthetic all-null ledgers passed DSR>=0.95 under the Meff rule (threshold 5%). Per the pre-registration §4, the correction is abandoned and gate 5 keeps the full ledger N. No alternative estimator was or will be evaluated.\n`
    );
    return;
  }
  console.log('      ACCEPTED.');

  // ---- real Meff (§2), alignment variants -> largest N (§5.2) ----
  console.log(
    '\n[2/3] real-ledger Meff (anchor variants 0 / -1 / -2 trading days)…'
  );
  const variants = [0, 1, 2].map(shift => meffOf(realTrials, () => shift));
  const meff = Math.max(...variants);
  const nEff = Math.ceil(meff);
  console.log(
    `      variants: ${variants.map(v => v.toFixed(2)).join(' / ')} → Meff = ${meff.toFixed(2)} → ceil = ${nEff} (full N = ${realTrials.length})`
  );

  // ---- before/after DSR for every scoreboard strategy (§5.3-5.4) ----
  console.log(
    '\n[3/3] before/after DSR table (all strategies, full N vs ceil(Meff))…'
  );
  const idx = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/backtests/runs/index.json'), 'utf8')
  );
  const targets = [
    'deployed-top5-breadth23-volrank-WF-OOS',
    'deployed-top5-breadth23-volsize-WF-OOS',
    'top-momentum-WF-OOS',
    'overnight-variants-WF-OOS',
    'soxx-overnight-fixed-auction-WF-OOS',
    'uvxy-spike-short-WF-OOS',
    'diversifier-sleeve-WF-OOS',
    'combo-A-B-riskparity-WF-OOS',
    'mf-sleeve-capped-WF-OOS',
    'vrp-sleeve-capped-WF-OOS',
  ];
  const { trialStats } = require('./lib/trialsLedger');
  const medDays = trialStats().medianTradingDays;
  const varDaily = significance.nullSharpeVariance(medDays);
  const rows = [];
  for (const sid of targets) {
    const run = idx.runs.find(r => r.strategyId === sid); // newest-first index
    if (!run) continue;
    const art = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'data/backtests/runs', run.runId, 'run.json'),
        'utf8'
      )
    );
    const eq = art.equity.values;
    const rets = [];
    for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
    const m = significance.sharpeMoments(rets);
    const before = significance.deflatedSharpe({
      sr: m.sr,
      T: m.T,
      skew: m.skew,
      kurt: m.kurt,
      nTrials: realTrials.length,
      varTrialsSR: varDaily,
    });
    const after = significance.deflatedSharpe({
      sr: m.sr,
      T: m.T,
      skew: m.skew,
      kurt: m.kurt,
      nTrials: nEff,
      varTrialsSR: varDaily,
    });
    rows.push({
      strategy: sid,
      oosSharpe: m.annualizedSharpe,
      dsrBefore: before.dsr,
      dsrAfter: after.dsr,
      srStarBefore: before.srStarAnnualized,
      srStarAfter: after.srStarAnnualized,
      verdictFlips: before.dsr < 0.95 && after.dsr >= 0.95,
    });
    console.log(
      `  ${sid.padEnd(42)} OOS ${m.annualizedSharpe.toFixed(2)}  DSR ${(before.dsr * 100).toFixed(1)}% → ${(after.dsr * 100).toFixed(1)}%${before.dsr < 0.95 && after.dsr >= 0.95 ? '  *** FLIPS TO PASS ***' : ''}`
    );
  }

  const report = {
    executedAt: new Date().toISOString(),
    preRegistration: 'data/reports/gate5-effectiveN-preregistration-2026-06.md',
    acceptance: {
      falsePasses: acc.falsePasses,
      rate: acc.rate,
      threshold: 0.05,
      generator:
        'common-factor lambda=0.5 (conservative-high cross-correlation)',
      seeds: '1..200 (x7919, frozen LCG)',
    },
    ledger: {
      N: realTrials.length,
      fingerprinted: realTrials.filter(t => t.fp).length,
      groups: groupStructure(realTrials).length,
      legacyIndependent: realTrials.filter(t => !t.fp).length,
    },
    meff: { variants, value: meff, ceil: nEff },
    table: rows,
  };
  fs.writeFileSync(
    path.join(ROOT, 'data/reports/gate5-effectiveN-result-2026-06.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(
    `\nSR* (annualized): ${rows[0] ? rows[0].srStarBefore.toFixed(2) : '?'} → ${rows[0] ? rows[0].srStarAfter.toFixed(2) : '?'}`
  );
  console.log('wrote data/reports/gate5-effectiveN-result-2026-06.json');
  console.log(
    '\nADOPTION (per §5): if accepted, validateStrategy gate 5 should use nTrials = max(ceil(Meff), grid size) going forward — apply in the SAME dedicated commit as this result.'
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
