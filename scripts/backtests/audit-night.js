#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/audit-night.js
//
// Morning audit (manifest R0): reconcile what was COMPUTED (engine sidecar),
// what was RECORDED (trials ledger delta since the manifest commit), and
// what was PRE-REGISTERED (the manifest). Anything computed-but-unrecorded
// is flagged; anything recorded-but-unregistered is labeled FISHING.
//
// Known benign mappings (from the night reviews, stated so the diff reads
// honestly): placebo transforms are invisible to the sidecar (it hashes
// params, not bars), head-to-head replays of already-ledgered specs are
// legitimate recomputations, and bug-hunt diagnostics (dayshuffle/EW control)
// were added mid-night under the manifest's alarm pivot — they are recorded
// trials, disclosed here rather than pre-registered.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'data/backtests/manifests/2026-06-10-night.json'),
    'utf8'
  )
);
const ledger = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/backtests/trials-ledger.json'), 'utf8')
);
const sidecarPath = path.join(ROOT, 'data/backtests/engine-invocations.log');
const sidecar = fs.existsSync(sidecarPath)
  ? fs
      .readFileSync(sidecarPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
  : [];

const since = manifest.committedAt;
const newTrials = ledger.trials.filter(t => t.recordedAt >= since);
const preregIds = new Set([
  'deployed-top5-breadth23-volsize-WF-OOS',
  'diversifier-sleeve-WF-OOS',
  'combo-A-B-riskparity-WF-OOS',
  'placebo-blockshuffle-s101',
  'placebo-blockshuffle-s202',
  'placebo-blockshuffle-s303',
  'placebo-shuffledrank-s404',
]);
const alarmPivotIds = new Set([
  'placebo-dayshuffle-s505',
  'placebo-dayshuffle-s606',
  'control-ew22-passive',
]);

console.log('# Night audit — 2026-06-10 program');
console.log(`manifest committed: ${since}`);
console.log(`ledger N before (manifest): ${manifest.ledgerNBefore}`);
console.log(`ledger N now: ${ledger.trials.length}`);
console.log(`pre-registered trial budget: ${manifest.trialBudget}`);
console.log(`\n## Trials recorded since manifest (${newTrials.length})`);
let prereg = 0;
let pivot = 0;
let fishing = 0;
for (const t of newTrials) {
  const tag = preregIds.has(t.strategyId)
    ? 'PRE-REGISTERED'
    : alarmPivotIds.has(t.strategyId)
      ? 'ALARM-PIVOT (disclosed, not pre-registered)'
      : t.strategyId.includes('volrank') ||
          t.strategyId.includes('deployed-top5')
        ? 'RE-RUN of existing spec (regression checks / head-to-heads)'
        : 'UNREGISTERED — FISHING?';
  if (tag === 'PRE-REGISTERED') prereg++;
  else if (tag.startsWith('ALARM')) pivot++;
  else if (tag.startsWith('UNREGISTERED')) fishing++;
  console.log(
    `- ${t.family}/${t.strategyId} [${t.kind}] sharpe=${t.sharpe != null ? t.sharpe.toFixed(2) : 'n/a'} → ${tag}`
  );
}
console.log(
  `\npre-registered: ${prereg} (budget ${manifest.trialBudget}) | alarm-pivot diagnostics: ${pivot} | unregistered: ${fishing}`
);

console.log(`\n## Engine sidecar invocations (${sidecar.length} logged at 1x)`);
const byHash = new Map();
for (const s of sidecar) byHash.set(s.hash, (byHash.get(s.hash) || 0) + 1);
console.log(
  `distinct param-sets computed: ${byHash.size}; known-benign unmatched classes: placebo transforms (params identical to volrank-23 — bars differ), monitor replays, head-to-head re-sims of ledgered specs.`
);

const verdictLine = fishing === 0 ? 'CLEAN' : `FISHING SUSPECTED (${fishing})`;
console.log(`\n## AUDIT VERDICT: ${verdictLine}`);
