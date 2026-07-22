#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-cross-sectional.js
//
// Five-gate validation of the GBDT cross-sectional ranker (Phase 1).
//
// Claim under test: "ranking the 45-name universe by a LightGBM factor model and
// holding the top-N beats holding the same universe equal-weight." This is the
// GBDT analogue of validate-xs-momentum.js — SAME universe, SAME survivorship-
// matched EW-all control, SAME monthly-rebalance portfolio mechanics — so the
// two verdicts are directly comparable (does a learned ranker beat a 12-1
// momentum sort on identical ground?).
//
// The model scores are produced OUT-OF-SAMPLE and deterministically offline:
//   1. node scripts/backtests/export-bars-for-rank.js   (bars → data/rank-cache/_bars.json)
//   2. python3 python/research/build_rank_scores.py      (scores → data/rank-cache/scores.json)
// Each score for date R was fit only on rows whose label window closed before R
// (expanding-window retrain, embargo). This script then runs the usual five
// gates ON TOP: walk-forward picks top-N per fold, 2x-cost stress, deflated
// Sharpe vs the trials ledger. Two independent OOS layers, no leakage.
//
// Selection routes through @keo/quant-core rankerCore.selectBasket — the SAME
// pure core the future live plugin will call (faithfulness contract). Gate 2 is
// not_run for now: no live broker executes this yet, so the curve is not
// deployable and this cannot reach VALIDATED until Phase 3 wires the plugin +
// certify-ranker.js. That is intentional (mirrors xs-momentum).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { rankerCore } = require('@keo/quant-core');
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { validateStrategy } = require('./lib/validateStrategy');
const { resolveUniverse } = require('./lib/rankUniverse');

const {
  name: UNIVERSE_NAME,
  START,
  UNIVERSE,
  ALL,
  RANK_CACHE_DIR,
} = resolveUniverse();

const SCORES_PATH = path.join(RANK_CACHE_DIR, 'scores.json');
const META_PATH = path.join(RANK_CACHE_DIR, 'model-meta.json');
const EW_SYM = 'EW_ALL'; // survivorship-matched EW control pseudo-symbol

const TOP_N_GRID = [5, 9, 14]; // each point is a ledger trial (matches xs-momentum)

function loadScores() {
  if (!fs.existsSync(SCORES_PATH)) {
    throw new Error(
      `missing ${SCORES_PATH}\n` +
        `Run:\n  node scripts/backtests/export-bars-for-rank.js\n  python3 python/research/build_rank_scores.py`
    );
  }
  return JSON.parse(fs.readFileSync(SCORES_PATH, 'utf8'));
}

// ── portfolio mechanics: copied VERBATIM from validate-xs-momentum.js so the
// GBDT book and the momentum book share identical rebalance/turnover/cost
// semantics. Any change here must be mirrored there (mechanical parity is what
// makes the two verdicts comparable). ──────────────────────────────────────

function firstIndexMap(series) {
  const out = {};
  for (const s of Object.keys(series)) {
    out[s] = series[s].findIndex(v => v != null);
  }
  return out;
}

function rebalanceIndices(dates) {
  const idx = [];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) idx.push(i);
  }
  return idx;
}

function monthlyPortfolioReturns(series, dates, rebalSet, selector, costMultiplier) {
  const out = new Array(dates.length).fill(null);
  let weights = null;
  let prevSet = new Set();
  let started = false;
  for (let i = 1; i < dates.length; i++) {
    if (started && weights) {
      let r = 0;
      for (const [s, w] of Object.entries(weights)) {
        const p0 = series[s][i - 1];
        const p1 = series[s][i];
        if (p0 != null && p1 != null) r += w * (p1 / p0 - 1);
      }
      out[i] = r;
    }
    if (rebalSet.has(i)) {
      const picks = selector(i);
      if (picks && picks.length) {
        const newSet = new Set(picks);
        if (started) {
          let turnover = 0;
          for (const s of prevSet)
            if (!newSet.has(s)) turnover += 1 / Math.max(prevSet.size, 1);
          for (const s of newSet) if (!prevSet.has(s)) turnover += 1 / picks.length;
          const avgBps = picks.reduce((a, s) => a + bpsPerSide(s), 0) / picks.length;
          const cost = turnover * (avgBps / 10000) * costMultiplier;
          out[i] = (1 + (out[i] || 0)) * (1 - cost) - 1;
        }
        weights = {};
        for (const s of picks) weights[s] = 1 / picks.length;
        prevSet = newSet;
        started = true;
      }
    }
  }
  return out;
}

// ── GBDT selection: read the score cache for the rebalance date, keep only
// names that are scored AND priced at i, and route through rankerCore. ───────

function buildAll({ dates, series, costMultiplier }, scores) {
  const rebalSet = new Set(rebalanceIndices(dates));

  // scored + priced cross-section at rebalance i
  const crossSection = i => {
    const day = scores[dates[i]];
    if (!day) return null;
    const sc = {};
    for (const s of UNIVERSE) {
      if (day[s] != null && series[s] && series[s][i] != null) sc[s] = day[s];
    }
    return Object.keys(sc).length ? sc : null;
  };

  const candidates = [];
  for (const topN of TOP_N_GRID) {
    const selector = i => {
      const sc = crossSection(i);
      if (!sc) return null;
      const pick = rankerCore.selectBasket(sc, { topN });
      return pick.ok ? pick.longs : null;
    };
    candidates.push({
      params: { topN, rebalance: 'monthly', model: 'lightgbm' },
      returns: monthlyPortfolioReturns(series, dates, rebalSet, selector, costMultiplier),
    });
  }

  // EW-all control: every scored+priced name equal-weight (survivorship-matched).
  const ewReturns = monthlyPortfolioReturns(
    series,
    dates,
    rebalSet,
    i => {
      const sc = crossSection(i);
      return sc ? Object.keys(sc) : null;
    },
    costMultiplier
  );

  return { candidates, ewReturns };
}

async function main() {
  const scores = loadScores();
  const meta = fs.existsSync(META_PATH)
    ? JSON.parse(fs.readFileSync(META_PATH, 'utf8'))
    : {};
  const scoredDates = Object.keys(scores).length;
  console.log(
    `[cross-sectional] ${scoredDates} scored rebalance dates loaded ` +
      `(${meta.firstScoredDate || '?'}..${meta.lastScoredDate || '?'}, ` +
      `${meta.nRetrains || '?'} retrains, ${(meta.features || []).length} features)`
  );

  let ewCloses = null;

  await validateStrategy({
    family: 'cross-sectional-rank',
    strategyId: `gbdt-topN-${UNIVERSE_NAME}-WF-OOS`,
    script: 'scripts/backtests/validate-cross-sectional.js',
    description:
      `GBDT (LightGBM) cross-sectional ranker, monthly top-N of the '${UNIVERSE_NAME}' universe. ` +
      'Scores produced out-of-sample by python/research/build_rank_scores.py (expanding-window ' +
      'retrain, embargo). Benchmark is EW-ALL of the SAME universe (survivorship-matched) — the ' +
      'verdict measures selection edge only. Directly comparable to validate-xs-momentum.js.',
    universe: ALL,
    controlUniverse: UNIVERSE, // D16: EW of the 45 tradables (SPY is calendar/benchmark only)
    start: START,
    buildCandidates: ctx => {
      const { candidates, ewReturns } = buildAll(ctx, scores);
      if (!ewCloses) {
        ewCloses = new Array(ctx.dates.length).fill(null);
        let eq = null;
        for (let i = 0; i < ctx.dates.length; i++) {
          if (ewReturns[i] != null) {
            eq = (eq == null ? 1 : eq) * (1 + ewReturns[i]);
            ewCloses[i] = eq;
          } else if (eq != null) {
            ewCloses[i] = eq;
          }
        }
      }
      ctx.series[EW_SYM] = ewCloses;
      return candidates;
    },
    benchmarkSymbol: EW_SYM,
    faithfulness: {
      status: 'not_run',
      note:
        'selection routes through quant-core rankerCore (shared core ready), but no live broker ' +
        'plugin executes cross-sectional-rank yet — cannot reach VALIDATED until Phase 3 wires ' +
        'server/strategies/crossSectionalRank.js + certify-ranker.js.',
    },
    notes: [
      'Claim under test: a LEARNED GBDT ranker SELECTION beats holding the same names equal-weight.',
      'Model scores are out-of-sample (expanding-window retrain, embargo) — see data/rank-cache/model-meta.json.',
      'Universe is survivorship-tinted; the EW-all benchmark shares the identical bias, so the comparison isolates selection edge. Absolute returns of both legs are inflated — do not quote them as achievable.',
      'Compare the verdict head-to-head with validate-xs-momentum.js (same universe, same control, same mechanics).',
    ],
    extraReport: {
      ranker: {
        model: meta.model,
        labelHorizon: meta.labelHorizon,
        embargo: meta.embargo,
        retrainEveryMonths: meta.retrainEveryMonths,
        features: meta.features,
        nRetrains: meta.nRetrains,
        scoredWindow: [meta.firstScoredDate, meta.lastScoredDate],
        topNGrid: TOP_N_GRID,
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
