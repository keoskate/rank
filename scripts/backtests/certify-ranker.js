#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/certify-ranker.js
//
// Phase-1 certification of the cross-sectional ranker's SELECTION CORE and its
// OOS score cache. This certifies the two properties Phase 1 can actually
// guarantee — and is deliberately honest about the one it cannot yet:
//
//   ✓ DETERMINISM of selection — rankerCore.selectBasket over the score cache is
//     a pure, stable function with a deterministic tie-break (score desc, symbol
//     asc). Two runs pick identical names in identical order. This is what a
//     future live plugin must match to be faithful.
//   ✓ NO-LOOKAHEAD STRUCTURE of the score cache — every scored date is a genuine
//     month-start on the shared calendar, dates are strictly increasing, and the
//     producer declares the expanding-window + embargo contract in model-meta.
//   ✗ LIVE==BACKTEST FAITHFULNESS is NOT certified here — no live broker plugin
//     executes cross-sectional-rank yet. validate-cross-sectional.js therefore
//     keeps gate 2 not_run. Phase 3 adds server/strategies/crossSectionalRank.js
//     and extends this script to certify the live decision path against the
//     backtest (as certify-trend-core.js does for trendFollowing), only THEN can
//     the family reach VALIDATED.
//
// Output: data/rank-cache/selection-cert.json (NOT wired to the faithfulness
// gate — that would overclaim). Exit non-zero on any failure.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rankerCore } = require('@keo/quant-core');
const { resolveUniverse } = require('./lib/rankUniverse');

const { START, RANK_CACHE_DIR } = resolveUniverse();

const BARS_PATH = path.join(RANK_CACHE_DIR, '_bars.json');
const SCORES_PATH = path.join(RANK_CACHE_DIR, 'scores.json');
const META_PATH = path.join(RANK_CACHE_DIR, 'model-meta.json');
const OUT = path.join(RANK_CACHE_DIR, 'selection-cert.json');

const TOP_N_GRID = [5, 9, 14];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function monthStarts(dates) {
  const out = [];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) out.push(dates[i]);
  }
  return out;
}

function main() {
  for (const p of [BARS_PATH, SCORES_PATH, META_PATH]) {
    if (!fs.existsSync(p)) {
      console.error(
        `missing ${p}\nRun: node scripts/backtests/export-bars-for-rank.js && ` +
          `python3 python/research/build_rank_scores.py`
      );
      process.exit(1);
    }
  }

  const bars = JSON.parse(fs.readFileSync(BARS_PATH, 'utf8'));
  const scoresRaw = fs.readFileSync(SCORES_PATH, 'utf8');
  const scores = JSON.parse(scoresRaw);
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));

  const cal = (bars.SPY || []).map(b => b.date);
  const validMonthStarts = new Set(monthStarts(cal));
  const scoreDates = Object.keys(scores).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    scoresSha256: crypto.createHash('sha256').update(scoresRaw).digest('hex'),
    scoredDates: scoreDates.length,
    window: [scoreDates[0], scoreDates[scoreDates.length - 1]],
    checks: {},
    // Explicit: this is NOT the live==backtest faithfulness gate.
    faithfulnessGate: 'not_run — no live plugin executes cross-sectional-rank yet (Phase 3)',
  };

  // ── check 1: no-lookahead STRUCTURE ─────────────────────────────────────
  const notMonthStart = scoreDates.filter(d => !validMonthStarts.has(d));
  const monotonic = scoreDates.every(
    (d, i) => i === 0 || d > scoreDates[i - 1]
  );
  // warmup: first score must sit well after START (the producer needs ~252d of
  // history for long factors plus training rows before it will predict at all).
  const warmupOk =
    scoreDates.length > 0 &&
    new Date(scoreDates[0]) - new Date(START) > 300 * 864e5;
  const contractOk =
    meta.labelHorizon > 0 &&
    meta.embargo >= 0 &&
    typeof meta.noLookahead === 'string' &&
    meta.retrainEveryMonths > 0;

  report.checks.noLookaheadStructure = {
    pass: notMonthStart.length === 0 && monotonic && warmupOk && contractOk,
    monthStartViolations: notMonthStart.slice(0, 10),
    monotonic,
    warmupOk,
    contractDeclared: contractOk,
    note:
      'scored dates are month-starts on the SPY calendar, strictly increasing, ' +
      'after warmup; producer declares expanding-window+embargo contract. ' +
      'True per-row cpos+H<=r-embargo enforcement lives in the Python producer.',
  };
  if (!report.checks.noLookaheadStructure.pass) {
    fail(
      `no-lookahead structure: ${notMonthStart.length} non-month-start dates, ` +
        `monotonic=${monotonic}, warmupOk=${warmupOk}, contract=${contractOk}`
    );
  }

  // ── check 2: selection DETERMINISM + tie-break ─────────────────────────
  let picks = 0;
  let mismatches = 0;
  for (const d of scoreDates) {
    for (const topN of TOP_N_GRID) {
      const a = rankerCore.selectBasket(scores[d], { topN });
      const b = rankerCore.selectBasket(scores[d], { topN });
      if (!a.ok) continue;
      picks++;
      if (a.longs.join(',') !== b.longs.join(',')) mismatches++;
    }
  }
  // explicit tie construction: equal scores must resolve symbol-ascending.
  const tie = rankerCore.selectBasket(
    { ZZZ: 1.0, AAA: 1.0, MMM: 1.0, BBB: 0.5 },
    { topN: 2 }
  );
  const tieOk = tie.ok && tie.longs.join(',') === 'AAA,MMM';

  report.checks.selectionDeterminism = {
    pass: mismatches === 0 && tieOk && picks > 0,
    picksCompared: picks,
    mismatches,
    tieBreakOk: tieOk,
    tieBreakResult: tie.longs,
    note: 'rankerCore.selectBasket is pure; ties resolve score-desc then symbol-asc.',
  };
  if (!report.checks.selectionDeterminism.pass) {
    fail(
      `selection determinism: ${mismatches} mismatches / ${picks} picks, tieOk=${tieOk}`
    );
  }

  report.certified =
    report.checks.noLookaheadStructure.pass &&
    report.checks.selectionDeterminism.pass;

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(
    `  ${report.checks.noLookaheadStructure.pass ? '✓' : '✗'} no-lookahead structure   ` +
      `${scoreDates.length} scored dates ${report.window[0]}..${report.window[1]} (all month-starts, monotonic, post-warmup)`
  );
  console.log(
    `  ${report.checks.selectionDeterminism.pass ? '✓' : '✗'} selection determinism    ` +
      `${picks} picks reproduced, tie-break → ${tie.longs.join(',')}`
  );
  console.log(
    `\n${report.certified ? '✓ CERTIFIED (selection + no-lookahead structure)' : '✗ NOT CERTIFIED'} — wrote ${path.relative(process.cwd(), OUT)}`
  );
  console.log(
    '  note: live==backtest faithfulness is deferred to Phase 3 (needs the live plugin); gate 2 stays not_run.'
  );
  if (!report.certified) process.exit(1);
}

main();
