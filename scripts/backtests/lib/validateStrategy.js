// scripts/backtests/lib/validateStrategy.js
//
// validateStrategy() — the source of truth over console P&L.
//
// Runs the five gates IN ORDER and emits a run.json whose verdict is honest:
//   1. dataIntegrity   — lib/dataIntegrity over every symbol the sim touches.
//                        Hard faults fail; warnings pass but stay visible.
//   2. faithfulness    — a live plugin must share the decision core, proven
//                        by a certification report. Research-only strategies
//                        stay not_run (and therefore can never be VALIDATED —
//                        you can't deploy a curve).
//   3. outOfSample     — walk-forward: params chosen on train folds only,
//                        embargo, scored on test. The stitched OOS equity IS
//                        the artifact's headline equity curve; the in-sample
//                        table is demoted to extra.walkForward.inSample.
//   4. realisticCosts  — the whole walk-forward re-runs at 2x transaction
//                        costs; the OOS edge must survive.
//   5. multipleTesting — deflated Sharpe on the OOS returns against the
//                        expected-max-of-N-trials Sharpe, N from the trials
//                        ledger (every grid point ever evaluated counts).
//
// Verdict: VALIDATED only if all five pass; otherwise UNVALIDATED or
// FAILED:<gate>. Expect most strategies to NOT validate. That is the point.

const { equityStats, walkForward, significance } = require('@keo/quant-core');
const { loadDailyBars, buildCalendar, alignCloses } = require('./marketData');
const { runDataIntegrityGate } = require('./dataIntegrity');
const { writeRunArtifact } = require('./runArtifact');
const { recordTrials, trialStats } = require('./trialsLedger');
const fs = require('fs');
const path = require('path');

const CERT_DIR = path.join(__dirname, '../../../data/backtests/certifications');
const CERT_MAX_AGE_DAYS = 30;

function _loadCertification(name) {
  const p = path.join(CERT_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Weekly OOS fingerprint (pre-registered 2026-06-10, manifest N5): compound
// every 5 consecutive stitched-OOS daily returns into one weekly return, keep
// at most the most recent 150 weeks, round to 6dp. Stored on each ledger
// trial so the future effective-N study can correlate trials without
// re-running sims; trials recorded before this field exists are counted as
// fully independent there (conservative). See
// data/reports/gate5-effectiveN-preregistration-2026-06.md.
function _oosFingerprint(returns) {
  if (!Array.isArray(returns)) return null;
  const weeks = [];
  for (let i = 0; i + 5 <= returns.length; i += 5) {
    let acc = 1;
    for (let j = i; j < i + 5; j++) acc *= 1 + (returns[j] || 0);
    weeks.push(Number((acc - 1).toFixed(6)));
  }
  return weeks.length ? weeks.slice(-150) : null;
}

/**
 * @param {object} spec
 * @param {string} spec.family            e.g. 'trend-following'
 * @param {string} spec.strategyId        e.g. 'SPY-sma-trend-WF-OOS'
 * @param {string} spec.description
 * @param {string[]} spec.universe        symbols to load (validated path)
 * @param {string} spec.start
 * @param {string} [spec.end]
 * @param {function} spec.buildCandidates ({dates, series, bars, costMultiplier})
 *        -> [{ params, returns }] daily simple returns aligned to dates
 * @param {object} [spec.faithfulness]    { certification: 'entropy-gate' } |
 *        { status, note }; default not_run (research-only)
 * @param {object} [spec.wf]              walk-forward overrides
 * @param {string} [spec.benchmarkSymbol='SPY']
 * @param {number} [spec.capital=100000]
 * @param {string[]} [spec.notes]
 * @param {object} [spec.extraReport]     merged into artifact.extra
 */
async function validateStrategy(spec) {
  const {
    family,
    strategyId,
    description = '',
    universe,
    start,
    end,
    buildCandidates,
    faithfulness = null,
    wf = {},
    benchmarkSymbol = 'SPY',
    capital = 100000,
    notes: extraNotes = [],
    extraReport = {},
  } = spec;

  const log = s => console.log(s);
  log(`\n=== validateStrategy: ${family} / ${strategyId} ===`);

  // ---------- data ----------
  log(`[data] loading ${universe.length} symbols (alpaca adjusted, ${start}+)`);
  const { bars, integrity } = await loadDailyBars(universe, { start, end });
  // Loud failure on silent universe shrink (night-review finding): a symbol
  // whose fetch failed would otherwise just vanish from the sim AND from
  // gate 1, producing a wrong number for a pre-registered universe.
  const missing = universe.filter(s => !bars[s] || !bars[s].length);
  if (missing.length) {
    throw new Error(
      `universe incomplete — fetch failed for: ${missing.join(', ')} (refusing to run a silently-shrunken universe)`
    );
  }
  const dates = buildCalendar(bars, bars.SPY ? 'SPY' : universe[0]);
  const series = alignCloses(bars, dates);

  const gates = {};
  const notes = [...extraNotes];

  // ---------- gate 1: data integrity ----------
  log('[gate 1/5] data integrity…');
  const dig = await runDataIntegrityGate(bars, {
    start,
    end: integrity.window.end,
  });
  const digIssues = Object.entries(dig.perSymbol)
    .filter(([, v]) => v.issues.length)
    .map(
      ([s, v]) =>
        `${s}: ${v.issues[0]}${v.issues.length > 1 ? ` (+${v.issues.length - 1})` : ''}`
    );
  gates.dataIntegrity = {
    status: dig.status === 'fail' ? 'fail' : 'pass',
    note:
      dig.status === 'pass'
        ? `clean: ${dig.summary.pass} symbols, raw-vs-adjusted + cross-source + structural checks`
        : `${dig.summary.fail} fail / ${dig.summary.warn} warn — ${digIssues.slice(0, 3).join('; ')}`,
    detail: dig.summary,
  };
  log(
    `        ${gates.dataIntegrity.status.toUpperCase()} — ${gates.dataIntegrity.note}`
  );

  // ---------- gate 2: faithfulness ----------
  log('[gate 2/5] backtest==live faithfulness…');
  if (faithfulness && faithfulness.certification) {
    const cert = _loadCertification(faithfulness.certification);
    const ageDays = cert
      ? (Date.now() - new Date(cert.generatedAt)) / 864e5
      : Infinity;
    if (cert && cert.certified && ageDays <= CERT_MAX_AGE_DAYS) {
      gates.faithfulness = {
        status: 'pass',
        note: `certified zero divergence vs live module (${faithfulness.certification}, ${cert.daysTested} days, ${Math.round(ageDays)}d old)`,
      };
    } else {
      gates.faithfulness = {
        status: 'fail',
        note: cert
          ? cert.certified
            ? `certification stale (${Math.round(ageDays)}d > ${CERT_MAX_AGE_DAYS}d) — re-run certify script`
            : 'certification FAILED — live and backtest decisions diverge'
          : `no certification found for ${faithfulness.certification}`,
      };
    }
  } else if (faithfulness && faithfulness.status) {
    gates.faithfulness = faithfulness;
  } else {
    gates.faithfulness = {
      status: 'not_run',
      note: 'no live plugin shares this decision core yet — a curve is not deployable, so this cannot reach VALIDATED until one does',
    };
  }
  log(
    `        ${gates.faithfulness.status.toUpperCase()} — ${gates.faithfulness.note}`
  );

  // ---------- gate 3: out-of-sample (walk-forward) ----------
  log('[gate 3/5] walk-forward out-of-sample…');
  const candidates = buildCandidates({
    dates,
    series,
    bars,
    costMultiplier: 1,
  });
  const wfResult = walkForward.walkForwardOOS({
    dates,
    candidates,
    trainDays: wf.trainDays ?? 756,
    testDays: wf.testDays ?? 126,
    embargoDays: wf.embargoDays ?? 21,
    anchored: wf.anchored ?? false,
  });
  if (!wfResult) {
    throw new Error('walk-forward produced no folds — not enough history');
  }
  const oosSharpe = wfResult.oos.stats.sharpe;
  const isSharpe = wfResult.inSample.stats.sharpe;
  gates.outOfSample = {
    status: oosSharpe > 0 ? 'pass' : 'fail',
    note:
      `stitched OOS over ${wfResult.folds.length} folds: Sharpe ${oosSharpe.toFixed(2)} ` +
      `(in-sample best ${isSharpe.toFixed(2)} → haircut ${(isSharpe - oosSharpe).toFixed(2)}); ` +
      `params chosen ${wfResult.paramStability.distinctChosen} distinct across ${wfResult.paramStability.folds} folds`,
  };
  log(
    `        ${gates.outOfSample.status.toUpperCase()} — ${gates.outOfSample.note}`
  );

  // ---------- gate 4: realistic costs (2x stress) ----------
  log('[gate 4/5] cost stress (2x)…');
  const candidates2x = buildCandidates({
    dates,
    series,
    bars,
    costMultiplier: 2,
  });
  const wf2x = walkForward.walkForwardOOS({
    dates,
    candidates: candidates2x,
    trainDays: wf.trainDays ?? 756,
    testDays: wf.testDays ?? 126,
    embargoDays: wf.embargoDays ?? 21,
    anchored: wf.anchored ?? false,
  });
  const oos2xSharpe = wf2x ? wf2x.oos.stats.sharpe : null;
  gates.realisticCosts = {
    status: oos2xSharpe != null && oos2xSharpe > 0 ? 'pass' : 'fail',
    note:
      oos2xSharpe == null
        ? '2x-cost walk-forward could not run'
        : `cost model charged on every position change; OOS Sharpe ${oosSharpe.toFixed(2)} → ${oos2xSharpe.toFixed(2)} at 2x costs`,
  };
  log(
    `        ${gates.realisticCosts.status.toUpperCase()} — ${gates.realisticCosts.note}`
  );

  // ---------- gate 5: multiple testing (deflated Sharpe) ----------
  log('[gate 5/5] multiple-testing deflation…');
  // record every grid point as a trial BEFORE deflating — honest N.
  // All grid rows of one run share the run's chosen-path OOS fingerprint:
  // the effective-N study treats a grid as one bet by design.
  const oosFingerprint = _oosFingerprint(wfResult.oos.returns);
  recordTrials(
    wfResult.inSample.table.map(row => ({
      family,
      strategyId,
      params: row.params,
      sharpe: row.stats ? row.stats.sharpe : null,
      window: { start: dates[0], end: dates[dates.length - 1] },
      kind: spec.trialKind || 'grid',
      oosFingerprint,
    }))
  );
  const ledger = trialStats(); // global: how many strategies have we tried
  const moments = significance.sharpeMoments(wfResult.oos.returns);
  let mt = { status: 'fail', note: 'could not compute OOS moments' };
  if (moments) {
    // Trial variance under the NULL (all trials skill-less): the sampling
    // noise of a zero-skill Sharpe at the ledger's median trial length.
    // Revised 2026-06 (ROADMAP D14): the previous estimator used the
    // empirical spread of ledger Sharpes, which deliberate anti-edge trials
    // (cost-destroyed variants, falsification controls) inflate — a
    // deterministically dead strategy can never be the lucky maximum, so it
    // must not widen the bar. Empirical spread is still reported below for
    // transparency. N stays the FULL ledger count even though trials are
    // correlated (effective N is smaller) — deliberately conservative.
    const medT = ledger.medianTradingDays;
    const varDaily = medT ? significance.nullSharpeVariance(medT) : null;
    const nTrials = Math.max(ledger.n, wfResult.inSample.table.length);
    const dsr = varDaily
      ? significance.deflatedSharpe({
          sr: moments.sr,
          T: moments.T,
          skew: moments.skew,
          kurt: moments.kurt,
          nTrials,
          varTrialsSR: varDaily,
        })
      : null;
    const psr0 = significance.psr({
      sr: moments.sr,
      srRef: 0,
      T: moments.T,
      skew: moments.skew,
      kurt: moments.kurt,
    });
    if (dsr && dsr.dsr != null) {
      const empSd =
        ledger.varAnnualizedSharpe != null
          ? Math.sqrt(ledger.varAnnualizedSharpe)
          : null;
      mt = {
        status: dsr.dsr >= 0.95 ? 'pass' : 'fail',
        note:
          `deflated Sharpe prob ${(dsr.dsr * 100).toFixed(1)}% vs expected-max-of-${nTrials}-skill-less-trials ` +
          `(SR* ${dsr.srStarAnnualized.toFixed(2)} ann., null-noise sd ${Math.sqrt((252 * 1) / medT).toFixed(2)} at median trial length ${medT}d); ` +
          `PSR(0) ${(psr0 * 100).toFixed(1)}%; ledger N=${ledger.n} across ${ledger.families.length} families` +
          (empSd != null
            ? ` (empirical trial sd ${empSd.toFixed(2)} reported, not used — polluted by deliberate anti-edge trials)`
            : ''),
        detail: {
          dsr: dsr.dsr,
          srStarAnnualized: dsr.srStarAnnualized,
          nTrials,
          psr0,
          medianTrialDays: medT,
          empiricalTrialSdAnnualized: empSd,
        },
      };
    } else {
      mt = {
        status: 'fail',
        note: `cannot establish the deflation bar (no trial-length data in ledger, N=${ledger.n}); PSR(0)=${(psr0 * 100).toFixed(1)}% recorded, but deflation impossible — treat as unproven`,
        detail: { psr0, nTrials: ledger.n },
      };
    }
  }
  gates.multipleTesting = mt;
  log(`        ${mt.status.toUpperCase()} — ${mt.note}`);

  // ---------- benchmark over the same stitched OOS dates ----------
  const benchPx = series[benchmarkSymbol];
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const benchOOS = [1];
  for (const d of wfResult.oos.dates) {
    const i = dateIdx.get(d);
    const r =
      i > 0 && benchPx[i] != null && benchPx[i - 1] != null
        ? benchPx[i] / benchPx[i - 1] - 1
        : 0;
    benchOOS.push(benchOOS[benchOOS.length - 1] * (1 + r));
  }

  // ---------- emit artifact (headline = stitched OOS) ----------
  notes.push(
    'HEADLINE EQUITY IS WALK-FORWARD OUT-OF-SAMPLE: parameters were chosen on train folds only (embargoed); each segment is unseen data. The in-sample table lives in extra.walkForward.inSample, demoted on purpose.',
    'OOS curve is returns-level (stitched test segments); per-trade logs exist only on in-sample instrumented runs.',
    `Cost model: bpsPerSide round-trip on every position change; 2x stress in gate 4.`
  );

  const {
    runId,
    path: artifactPath,
    artifact,
  } = writeRunArtifact({
    family,
    strategyId,
    script: spec.script || 'scripts/backtests/lib/validateStrategy.js',
    description,
    params: {
      walkForward: {
        trainDays: wf.trainDays ?? 756,
        testDays: wf.testDays ?? 126,
        embargoDays: wf.embargoDays ?? 21,
      },
    },
    capital,
    dates: wfResult.oos.dates,
    equity: wfResult.oos.equity,
    benchmark: { symbol: benchmarkSymbol, values: benchOOS.slice(1) },
    trades: [],
    bars: {},
    data: {
      source: integrity.source,
      adjustment: integrity.adjustment,
      timeframe: integrity.timeframe,
      window: integrity.window,
      symbols: universe,
      integrity: { checkedAt: dig.checkedAt, summary: dig.summary },
    },
    notes,
    gates,
    extra: {
      walkForward: {
        folds: wfResult.folds.map(f => ({
          train: [f.trainStart, f.trainEnd],
          test: [f.testStart, f.testEnd],
          chosen: f.chosen,
          trainScore: f.trainScore,
          testSharpe: f.testStats ? f.testStats.sharpe : null,
        })),
        paramStability: wfResult.paramStability,
        inSample: wfResult.inSample,
        oos2x: wf2x
          ? { sharpe: wf2x.oos.stats.sharpe, stats: wf2x.oos.stats }
          : null,
      },
      ...extraReport,
    },
  });

  const verdict = artifact.validation.verdict;
  log(`\nVERDICT: ${verdict}`);
  log(`artifact: ${artifactPath}`);
  log(`view:     npm run backtest:view ${runId}`);
  return { runId, artifact, wfResult, gates, verdict };
}

module.exports = { validateStrategy };

// Convenience re-export used by validators for stats lines
module.exports.equityStats = equityStats;
