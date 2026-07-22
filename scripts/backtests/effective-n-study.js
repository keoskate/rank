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
// The §2 estimator lives in lib/effectiveN.js — the SAME definition gate 5
// consumes (one-definition rule; adopted 2026-07-22). This script keeps only
// what the study adds on top: the §4 acceptance test and the §5.4 report.
const {
  meffOf: libMeffOf,
  rhoPair: libRhoPair,
  nyseCalendar,
  makeCalIndex,
  MIN_WEEKS,
  MATCH_TOL,
} = require('./lib/effectiveN');

const ROOT = path.join(__dirname, '../..');
const LEDGER = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/backtests/trials-ledger.json'), 'utf8')
);

const CAL = nyseCalendar();
const calIdxOnOrBefore = makeCalIndex(CAL);

// Thin local adapters preserving this script's original call shapes.
function rhoPair(a, b, shiftA = 0, shiftB = 0) {
  // lib signature takes equal shifts per §5.2 variants; the study only ever
  // calls with shiftA === shiftB, matching the pre-registered variants.
  return libRhoPair(a, b, shiftA, shiftB, calIdxOnOrBefore);
}

function meffOf(trials, shiftFn) {
  const shift = shiftFn({ fp: null, end: null }) || 0;
  return libMeffOf(trials, shift, calIdxOnOrBefore);
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
    'vol-target-soxx-gld-mix-WF-OOS', // champion — must appear first per §5.4
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

  // ---- Markdown study report (required output) ----
  const champion = rows.find(
    r => r.strategy === 'vol-target-soxx-gld-mix-WF-OOS'
  );
  const structureGroups = groupStructure(realTrials);
  const nFingerprinted = realTrials.filter(t => t.fp).length;
  const nLegacy = realTrials.filter(t => !t.fp).length;
  const N = realTrials.length;

  // Pairwise correlation stats from the real-ledger computation
  // Recompute with stats collection for the report
  const pairRhos = [];
  const withFp = realTrials.filter(t => t.fp);
  for (let i = 0; i < withFp.length; i++) {
    for (let j = i + 1; j < withFp.length; j++) {
      // Use variant 0 (anchor shift 0) for stats — actual Meff used max variant
      const r = rhoPair(withFp[i], withFp[j], 0, 0);
      if (r !== 0) pairRhos.push(r); // non-zero means had >=26 weeks overlap
    }
  }
  const meanRho = pairRhos.length
    ? pairRhos.reduce((a, b) => a + b, 0) / pairRhos.length
    : 0;
  const sortedRho = [...pairRhos].sort((a, b) => a - b);
  const medianRho = sortedRho.length
    ? sortedRho[Math.floor(sortedRho.length / 2)]
    : 0;
  const totalCanonicalPairs = (withFp.length * (withFp.length - 1)) / 2;
  const skippedPairs = totalCanonicalPairs - pairRhos.length;

  const tableLines = rows
    .map(
      r =>
        `| ${r.strategy.padEnd(48)} | ${r.oosSharpe.toFixed(3)} | ${(r.dsrBefore * 100).toFixed(1)}% | ${(r.dsrAfter * 100).toFixed(1)}% | ${r.dsrBefore < 0.95 ? 'FAIL' : 'PASS'} → ${r.dsrAfter < 0.95 ? 'FAIL' : 'PASS'}${r.verdictFlips ? ' ***' : ''} |`
    )
    .join('\n');

  const dsrNote = champion
    ? `DSR at raw N=${N}: **${(champion.dsrBefore * 100).toFixed(2)}%** (SR* ann. ${champion.srStarBefore.toFixed(4)}) — **${champion.dsrBefore >= 0.95 ? 'PASS' : 'FAIL'}**
DSR at Meff ceil=${nEff}: **${(champion.dsrAfter * 100).toFixed(2)}%** (SR* ann. ${champion.srStarAfter.toFixed(4)}) — **${champion.dsrAfter >= 0.95 ? 'PASS' : 'FAIL'}**`
    : '(champion not found in run index)';

  const flipCount = rows.filter(r => r.verdictFlips).length;
  const adoptionText =
    acc.rate <= 0.05
      ? champion && champion.verdictFlips
        ? `The champion (vol-target-soxx-gld-mix-WF-OOS) **flips from FAIL to PASS** under ceil(Meff)=${nEff}. Adoption is methodologically warranted. Per §5: apply in a dedicated commit, applies to ALL strategies (no per-strategy exceptions). ${flipCount} strategy/strategies flip verdict.`
        : `The acceptance test passes. ceil(Meff)=${nEff} is a valid corrected bar. The champion does **not** flip verdict (DSR ${champion ? (champion.dsrAfter * 100).toFixed(2) : '?'}% < 95%). ${flipCount > 0 ? flipCount + ' other strateg' + (flipCount === 1 ? 'y flips' : 'ies flip') + ' verdict.' : 'No verdicts flip.'} Adoption lowers the bar legitimately but does not change the champion's outcome — user may still choose to adopt for correctness.`
      : `Acceptance test FAILED — Meff is abandoned per §4. Gate 5 retains full N=${N}. No further action.`;

  const mdReport = `# Gate 5 effective-N study
**Generated:** 2026-07-22
**Script:** scripts/backtests/effective-n-study.js
**Pre-registration:** data/reports/gate5-effectiveN-preregistration-2026-06.md (FROZEN 2026-06-10, temporal two-key §5.1)

---

## Method (binding — citing pre-registration §2)

Single frozen estimator (no substitution permitted):

\`\`\`
Meff = N² / Σ_ij ρ̂²_ij   (Patton–Ramadorai form)
\`\`\`

Sum over ALL ordered pairs (i,j) including diagonal (ρ̂_ii = 1).
Input series: each trial's \`oosFingerprint\` (weekly compounded OOS returns, ≤150 weeks).
Week alignment: NYSE trading-day calendar anchored at \`window.end\`, stepping back 5 NYSE days per week. Overlap tolerance: ≤${MATCH_TOL} trading days. Minimum overlap: **${MIN_WEEKS} weeks** (§2.4) — short-overlap pairs set to ρ̂=0.
Grid siblings (same run, same strategyId): share fingerprint → ρ̂=1 by design (§2 known approximation).
Legacy trials (no fingerprint): ρ̂=0 off-diagonal, ρ̂_ii=1 (§2.5, conservative).
Alignment ambiguity (§5.2): tried anchor shifts 0/1/2 NYSE days → take variant giving LARGEST Meff (harder bar).

---

## 1. Fingerprint coverage

| Metric | Value |
|--------|-------|
| Total ledger trials (N) | **${N}** |
| Trials with oosFingerprint | **${nFingerprinted}** (${((nFingerprinted / N) * 100).toFixed(1)}%) |
| Legacy trials (no fingerprint) | **${nLegacy}** (${((nLegacy / N) * 100).toFixed(1)}%) |
| Distinct fingerprint groups (K) | **${structureGroups.length}** |

${nLegacy} pre-2026-06-10 legacy rows carry no fingerprint and are counted fully independent (conservative per §2.5). This keeps Meff denominator from shrinking relative to the full N.

---

## 2. Pairwise correlation distribution

${withFp.length} fingerprinted trials → ${totalCanonicalPairs} canonical pairwise comparisons.

| Metric | Value |
|--------|-------|
| Pairs with ≥${MIN_WEEKS}-week overlap (used) | **${pairRhos.length}** |
| Pairs set to ρ̂=0 (short overlap or no overlap) | **${skippedPairs}** |
| Mean ρ̂ (used pairs) | **${meanRho.toFixed(4)}** |
| Median ρ̂ (used pairs) | **${medianRho.toFixed(4)}** |

---

## 3. Effective-N (Meff)

Alignment variants (anchor shifts 0/1/2 NYSE days): ${variants.map(v => v.toFixed(2)).join(' / ')}
→ Meff = **${meff.toFixed(4)}** (taking largest per §5.2)
→ ceil(Meff) = **${nEff}**
→ Reduction from full N: **${N - nEff}** fewer trials (${(((N - nEff) / N) * 100).toFixed(1)}%)

The modest reduction reflects that ${nLegacy} legacy rows (${((nLegacy / N) * 100).toFixed(1)}% of N) are forced fully independent — they inflate the denominator Σρ̂² by exactly 1 each regardless of actual correlation structure. As fingerprint coverage grows, Meff will diverge further from N.

---

## 4. Acceptance test (pre-registration §4)

200 synthetic all-null ledgers. Same group structure (${structureGroups.length} groups with same sizes), same ${nLegacy} legacy-independent trials. Common-factor generator (λ=0.5 loading): cross-group weekly correlation ≈0.5 — **the most conservative setting** (maximises false-pass rate, hardest version of the test). Within-group ρ̂=1 (shared fingerprint per grid block). LCG seeds 1..200 × 7919 (frozen).

| Metric | Value |
|--------|-------|
| Synthetic ledgers | 200 |
| False passes (DSR ≥ 0.95 on null best trial) | **${acc.falsePasses}** |
| False-pass rate | **${(acc.rate * 100).toFixed(1)}%** |
| Threshold | ≤ 5% |
| **Acceptance verdict** | **${acc.rate <= 0.05 ? 'PASS' : 'FAIL'}** |

${
  acc.rate <= 0.05
    ? 'The estimator controls Type I error at the required rate. Meff adoption is statistically warranted per the pre-registration.'
    : 'FAILED — Meff is abandoned per §4. Gate 5 retains full N=' +
      N +
      '. No second estimator may be evaluated.'
}

---

## 5. Champion DSR table (full before/after per §5.4)

${dsrNote}

### All scoreboard strategies (full N=${N} vs ceil(Meff)=${nEff})

| Strategy | OOS Sharpe (ann.) | DSR raw N=${N} | DSR Meff=${nEff} | Verdict |
|----------|-----------------:|---------------|----------------|---------|
${tableLines}

*** = verdict flips from FAIL to PASS under Meff.

---

## RECOMMENDATION

${adoptionText}

---

## Honest caveats (pre-registration §8)

1. **Reused OOS window**: 2016–2026 walk-forward window reused multiple times. Meff corrects trial *count* only — cannot undo window reuse. Pristine evidence: forward-sim broker + data post-2026-06-10.
2. **Young fingerprint coverage**: ${nFingerprinted}/${N} trials fingerprinted; early Meff values sit close to full N by design. Estimate will improve as more fingerprinted trials accumulate.
3. **Weekly downsampling**: discards intraweek correlation; frozen to keep stored rows small and damp daily-alignment noise.
4. **Grid-block approximation**: within-run siblings set to ρ̂=1 (may overstate intra-grid correlation for orthogonal grids).
5. **Acceptance test generator**: λ=0.5 common factor is intentionally maximally conservative — real between-group correlations are lower on average (mean ρ̂=${meanRho.toFixed(3)}), so the acceptance test sees a harder problem than reality.

---

*Binding pre-registration: data/reports/gate5-effectiveN-preregistration-2026-06.md*
*JSON artifact: data/reports/gate5-effectiveN-result-2026-06.json*
`;

  const MD_PATH = path.join(
    ROOT,
    'data/reports/gate5-effectiveN-study-2026-07-22.md'
  );
  fs.writeFileSync(MD_PATH, mdReport);

  console.log(
    `\nSR* (annualized): ${rows[0] ? rows[0].srStarBefore.toFixed(2) : '?'} → ${rows[0] ? rows[0].srStarAfter.toFixed(2) : '?'}`
  );
  console.log('wrote data/reports/gate5-effectiveN-result-2026-06.json');
  console.log('wrote data/reports/gate5-effectiveN-study-2026-07-22.md');
  console.log(
    '\nADOPTION (per §5): if accepted, validateStrategy gate 5 should use nTrials = max(ceil(Meff), grid size) going forward — apply in the SAME dedicated commit as this result.'
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
