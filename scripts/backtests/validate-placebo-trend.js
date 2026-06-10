#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-placebo-trend.js
//
// Manifest R1-placebo (data/backtests/manifests/2026-06-10-night.json):
// PIPELINE CALIBRATION. Four placebos with no real signal by construction
// are pushed through validateStrategy with the EXACT deployed volrank-23
// spec on the same 23-ETF universe as validate-trend-volrank.js. An honest
// pipeline must score them ~0 OOS; a high score means the pipeline (not the
// market) is the edge, and the night pivots to bug-hunting.
//
//   1-3. Seeded WITHIN-SYMBOL stationary block shuffle (fixed 21-trading-day
//        blocks; seeds 101/202/303, each plus a per-symbol index offset so
//        every symbol draws a different permutation) of each symbol's daily
//        simple returns, recomposed into a price path anchored at the
//        symbol's TRUE first close. Dates are unchanged (real calendar).
//        Destroys time-series trend persistence; preserves the marginal
//        return distribution and approximate vol clustering (within blocks).
//   4.   Shuffled-rankScore placebo on REAL bars: the engine's
//        rankBy='placeboShuffle' mode (seed 404) replaces the rankScore
//        ordering of ELIGIBLE names with a deterministic seeded hash each
//        refill day — isolates whether the ranking stage adds value over a
//        random pick of trend-eligible names.
//
// Pre-registered alarm rule (frozen in the manifest BEFORE any run): the
// null stitched OOS Sharpe at ~1594d has sd = sqrt(252/1594) ~ 0.40 and
// E[max of 4] ~ 0.41; the conservative pre-registered threshold is 0.85
// (the real spec's neighborhood). If ANY placebo reaches it, tonight's
// strategy headlines are VOID. Placebo seeds are never re-rolled.
//
// Honest caveats (stated in the manifest, repeated in every run's notes):
//   - Placebos exercise gates 3-5 only: gate 1 (data integrity) runs on the
//     real loaded bars, not the transformed paths; gate 2 (faithfulness) is
//     a certification lookup, deliberately left not_run here.
//   - All randomness is a deterministic LCG (repo convention, see
//     packages/quant-core/__tests__), so the 1x and 2x cost passes see the
//     identical shuffled paths and re-runs reproduce exactly.

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { alignCloses } = require('./lib/marketData');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
} = require('./validate-trend');

const START = '2016-01-04';
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE23 = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const VOLRANK_SPEC = { ...DEPLOYED, rankBy: 'volAdjusted' };

const BLOCK_LEN = 21; // trading days, frozen in the manifest
const ALARM_SHARPE = 0.85; // pre-registered threshold, never re-rolled

// Deterministic LCG (repo convention: packages/quant-core/__tests__).
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Within-symbol stationary block shuffle of one symbol's bars: daily simple
 * returns are cut into consecutive BLOCK_LEN-day blocks (the tail block may
 * be shorter and shuffles along with the rest — still an exact permutation
 * of all returns), block ORDER is permuted with the seeded LCG, and closes
 * are recomposed from the symbol's true first close. Original dates are
 * kept — only the path of closes changes.
 */
function blockShuffleBars(bars, rand) {
  const rets = [];
  for (let k = 1; k < bars.length; k++) {
    rets.push(bars[k].close / bars[k - 1].close - 1);
  }
  const blocks = [];
  for (let k = 0; k < rets.length; k += BLOCK_LEN) {
    blocks.push(rets.slice(k, k + BLOCK_LEN));
  }
  shuffleInPlace(blocks, rand);
  const shuffled = blocks.flat();
  const out = [{ date: bars[0].date, close: bars[0].close }];
  for (let k = 0; k < shuffled.length; k++) {
    out.push({
      date: bars[k + 1].date,
      close: out[k].close * (1 + shuffled[k]),
    });
  }
  return out;
}

/**
 * Transform a validateStrategy ctx into its shuffled twin: every universe
 * symbol gets its own permutation stream (seed + 1000 * symbol index), and
 * the aligned series is rebuilt over the ORIGINAL calendar with the same
 * forward-fill construction as lib/marketData.alignCloses.
 */
function blockShuffleCtx(ctx, seed) {
  const tBars = {};
  UNIVERSE23.forEach((sym, idx) => {
    const orig = ctx.bars[sym];
    if (!orig || !orig.length) return;
    tBars[sym] = blockShuffleBars(orig, seededRandom(seed + 1000 * idx));
  });
  return { bars: tBars, series: alignCloses(tBars, ctx.dates) };
}

const SHARED_NOTES = [
  'PIPELINE-CALIBRATION PLACEBO (manifest R1-placebo, kind=placebo-control): no real signal by construction; expected stitched OOS Sharpe ~0 +/- 0.40 (null sd = sqrt(252/1594) at the stitched length).',
  `Pre-registered ALARM rule: if the stitched OOS Sharpe >= ${ALARM_SHARPE}, tonight's strategy headlines are VOID and the night pivots to bug-hunting.`,
  'Gates 1-2 are NOT exercised by the placebo transform: data integrity runs on the real loaded bars and faithfulness is a certification lookup left not_run on purpose. Only gates 3-5 are calibrated here.',
  'Placebo seeds (101/202/303/404) are frozen in the pre-registration manifest and never re-rolled.',
  'Reused-OOS disclosure (manifest priorArtDisclosure): the 2016-2026 walk-forward window has been used for spec selection three times (raw18 -> breadth23 -> volrank23); for a placebo the null holds by construction, but the note travels with every result.',
];

const PLACEBOS = [101, 202, 303].map(seed => ({
  id: `placebo-blockshuffle-s${seed}`,
  description:
    `Placebo control: deployed volrank-23 spec run on a seeded within-symbol stationary block shuffle (${BLOCK_LEN}d blocks, seed ${seed}) of each symbol's daily returns, recomposed from the true first close on the real calendar. ` +
    'Trend persistence destroyed; marginal return distribution and approximate vol clustering preserved.',
  buildCandidates: ctx => {
    const t = blockShuffleCtx(ctx, seed);
    const sim = simulateDeployed(
      { dates: ctx.dates, series: t.series, bars: t.bars },
      VOLRANK_SPEC,
      ctx.costMultiplier,
      UNIVERSE23
    );
    return [
      {
        params: { ...VOLRANK_SPEC, placebo: 'blockShuffle', seed },
        returns: sim.returns,
      },
    ];
  },
}));

PLACEBOS.push({
  id: 'placebo-shuffledrank-s404',
  description:
    'Placebo control: deployed volrank-23 mechanics on REAL bars with the eligible set ranked by a deterministic seeded hash instead of rankScore (rankBy=placeboShuffle, seed 404) on each refill day. ' +
    'Tests whether the ranking stage adds value over a random pick of trend-eligible names.',
  buildCandidates: ctx => {
    const spec = { ...DEPLOYED, rankBy: 'placeboShuffle', placeboSeed: 404 };
    const sim = simulateDeployed(ctx, spec, ctx.costMultiplier, UNIVERSE23);
    return [
      {
        params: { ...spec, placebo: 'shuffledRank', seed: 404 },
        returns: sim.returns,
      },
    ];
  },
});

async function main() {
  const results = [];

  for (const p of PLACEBOS) {
    const { wfResult } = await validateStrategy({
      family: 'placebo-control',
      strategyId: p.id,
      trialKind: 'placebo-control', // manifest R1: ledger rows so labeled
      script: 'scripts/backtests/validate-placebo-trend.js',
      description: p.description,
      universe: UNIVERSE23,
      start: START,
      buildCandidates: p.buildCandidates,
      benchmarkSymbol: 'SPY',
      notes: SHARED_NOTES,
    });
    const oosSharpe = wfResult.oos.stats.sharpe;
    const alarm = oosSharpe >= ALARM_SHARPE;
    if (alarm) {
      console.log(
        `\n!!! ALARM (manifest R1-placebo): ${p.id} stitched OOS Sharpe ${oosSharpe.toFixed(2)} >= ${ALARM_SHARPE} — tonight's strategy headlines are VOID; pivot to bug-hunting.`
      );
    }
    results.push({ id: p.id, oosSharpe, alarm });
  }

  console.log('\n=== R1-placebo summary ===');
  console.log('placebo id                 | OOS Sharpe | alarm');
  console.log('---------------------------+------------+------');
  for (const r of results) {
    console.log(
      `${r.id.padEnd(27)}| ${r.oosSharpe.toFixed(2).padStart(10)} | ${r.alarm ? 'YES' : 'no'}`
    );
  }
  const fired = results.filter(r => r.alarm);
  if (fired.length) {
    console.log(
      `\nALARM FIRED (${fired.map(r => r.id).join(', ')}): per the manifest, tonight's strategy headlines are VOID and the report leads with the bug investigation.`
    );
  } else {
    console.log(
      `\nNo alarm: all placebo OOS Sharpes are below the pre-registered ${ALARM_SHARPE} threshold — pipeline calibration is consistent with an honest null.`
    );
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
