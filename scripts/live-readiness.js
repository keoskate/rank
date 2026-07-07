#!/usr/bin/env node
// scripts/live-readiness.js
//
// Is the deployed trend-follower EARNED its way to real money yet?
//
// Reports the pre-registered promotion bar (ROADMAP "Rules", the sim->paper /
// live gate) as a single READY / NOT-READY verdict, reading only artifacts that
// already exist — it does NOT re-run any backtest:
//
//   Gate 1 — DSR >= 95%      (multiple-testing deflation; the only gate the
//            deployed spec fails today) — from the latest trend five-gate
//            verdict artifact: data/backtests/runs/<trend verdict>/run.json
//            .validation.gates.multipleTesting.
//   Gate 2 — execution faithfulness: >= 4 consecutive weeks in tolerance
//            (decision-match >= 95%, median |residual| <= 25 bps/trade) — from
//            data/reports/execution-faithfulness/latest.json.
//
// Both must pass. No discretionary early promotion — that is the whole point of
// the "earn it" posture. Refresh the inputs first if they look stale:
//   node scripts/backtests/validate-trend.js         # refreshes the DSR
//   node scripts/monitorExecutionFaithfulness.js     # refreshes the streak
//
// Emits data/reports/live-readiness.json for automation and exits non-zero when
// NOT-READY so a cron/loop can gate on it.

const fs = require('fs');
const path = require('path');

const RUNS_DIR = path.join(__dirname, '../data/backtests/runs');
const FAITH_LATEST = path.join(
  __dirname,
  '../data/reports/execution-faithfulness/latest.json'
);
const OUT_JSON = path.join(__dirname, '../data/reports/live-readiness.json');

// Pre-registered bar (ROADMAP). Do not loosen without a documented policy change.
const DSR_BAR = 0.95;
const MIN_WEEKS_IN_TOLERANCE = 4;

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// Newest five-gate verdict artifact for the DEPLOYED trend-following spec.
function latestTrendVerdict() {
  const index = readJson(path.join(RUNS_DIR, 'index.json'));
  const entries = Array.isArray(index) ? index : index?.runs || [];
  const trend = entries
    .filter(e => e.family === 'trend-following')
    // prefer the deployed-spec verdicts over sleeve/combo experiments
    .sort((a, b) => {
      const score = e =>
        (/deployed/.test(e.runId) ? 2 : 0) +
        (/volrank|breadth23|top5/.test(e.runId) ? 1 : 0);
      const ds = score(b) - score(a);
      if (ds !== 0) return ds;
      return String(b.generatedAt).localeCompare(String(a.generatedAt));
    });
  for (const e of trend) {
    const run = readJson(path.join(RUNS_DIR, e.runId, 'run.json'));
    // Skip in-sample "instrumented" artifacts whose gates are intentionally
    // not_run — we need the WF-OOS verdict where multipleTesting is evaluated.
    const mt = run?.validation?.gates?.multipleTesting;
    if (mt && mt.status && mt.status !== 'not_run') return { entry: e, run };
  }
  return null;
}

function pct(x) {
  return x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function main() {
  const out = {
    generatedAt: new Date().toISOString(),
    strategy: 'trend-follower (deployed volrank-23)',
    bar: { dsr: DSR_BAR, weeksInTolerance: MIN_WEEKS_IN_TOLERANCE },
    gates: {},
    ready: false,
  };

  // ---- Gate 1: DSR (multiple-testing) + the other four gates for context ----
  const verdict = latestTrendVerdict();
  if (!verdict) {
    out.gates.dsr = {
      pass: false,
      status: 'missing',
      note: 'no trend five-gate verdict artifact — run scripts/backtests/validate-trend.js',
    };
  } else {
    const g = verdict.run.validation.gates;
    const mt = g.multipleTesting || {};
    const dsr = mt.detail?.dsr ?? null;
    out.gates.dsr = {
      pass: mt.status === 'pass',
      status: mt.status || 'unknown',
      dsr,
      bar: DSR_BAR,
      note: `deflated-Sharpe prob ${pct(dsr)} vs ${pct(DSR_BAR)} bar (N=${
        mt.detail?.nTrials ?? '?'
      } trials)`,
      source: verdict.entry.runId,
      asOf: verdict.entry.generatedAt,
    };
    // the supporting 4/5 gates — context only, not part of the live bar
    out.gates.otherBacktestGates = Object.fromEntries(
      ['dataIntegrity', 'faithfulness', 'outOfSample', 'realisticCosts'].map(
        k => [k, g[k]?.status ?? 'unknown']
      )
    );
  }

  // ---- Gate 2: execution faithfulness streak ----
  const faith = readJson(FAITH_LATEST);
  if (!faith) {
    out.gates.faithfulness = {
      pass: false,
      status: 'missing',
      note: 'no execution-faithfulness artifact — run scripts/monitorExecutionFaithfulness.js',
    };
  } else {
    const weeks = faith.consecutiveWeeksInTolerance ?? 0;
    out.gates.faithfulness = {
      pass: weeks >= MIN_WEEKS_IN_TOLERANCE,
      status: weeks >= MIN_WEEKS_IN_TOLERANCE ? 'pass' : 'fail',
      consecutiveWeeksInTolerance: weeks,
      bar: MIN_WEEKS_IN_TOLERANCE,
      decisionMatchRate: faith.decisionMatchRate,
      medianResidualBps: faith.residuals?.vsBacktestClose?.p50 ?? null,
      liveDays: faith.liveDays ?? 0,
      note: `${weeks}/${MIN_WEEKS_IN_TOLERANCE} consecutive weeks in tolerance` +
        (faith.liveDays ? '' : ' (no matched live fills yet)'),
      asOf: faith.lastBarDate,
    };
  }

  out.ready = !!(out.gates.dsr.pass && out.gates.faithfulness.pass);

  try {
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n');
  } catch (err) {
    console.error(`(could not write ${OUT_JSON}: ${err.message})`);
  }

  // ---- human report ----
  const mark = ok => (ok ? '✅ PASS' : '❌ FAIL');
  console.log('\nLIVE READINESS — trend-follower (deployed volrank-23)');
  console.log('='.repeat(56));
  console.log(`Gate 1  DSR >= ${pct(DSR_BAR)}          ${mark(out.gates.dsr.pass)}`);
  console.log(`        ${out.gates.dsr.note}`);
  if (out.gates.dsr.source) {
    console.log(`        source: ${out.gates.dsr.source} (${out.gates.dsr.asOf})`);
  }
  if (out.gates.otherBacktestGates) {
    const og = out.gates.otherBacktestGates;
    console.log(
      `        other gates: ${Object.entries(og)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    );
  }
  console.log(
    `Gate 2  faithfulness >= ${MIN_WEEKS_IN_TOLERANCE}wk   ${mark(
      out.gates.faithfulness.pass
    )}`
  );
  console.log(`        ${out.gates.faithfulness.note}`);
  console.log('-'.repeat(56));
  console.log(
    out.ready
      ? '✅ READY — the pre-registered bar is met. A human may promote to live\n   via POST /api/brokers/trend-follower/transition {to:"live",confirm:...}\n   with ALLOW_LIVE_TIER=1 set on the server.'
      : '⛔ NOT READY — do NOT route real money. Keep it on paper until both\n   gates pass. This is the disciplined "earn it" bar, by design.'
  );
  console.log(`\nwrote: ${path.relative(process.cwd(), OUT_JSON)}\n`);

  process.exit(out.ready ? 0 : 1);
}

main();
