#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/diagnose-placebo-alarm.js
//
// BUG-HUNT DIAGNOSTIC for the 2026-06-10 placebo alarm (manifest R1).
//
// The block-shuffle placebos (within-symbol, independent across symbols)
// scored OOS Sharpe 1.05-1.46 vs the real spec's 0.89. Two hypotheses:
//   H-bug:  the pipeline leaks future information (all results suspect).
//   H-null: the placebo null was mis-specified — independent per-symbol
//           shuffles DESTROY cross-asset correlation (no shared crashes →
//           fake diversification) while permutation PRESERVES each symbol's
//           total drift, so a long-only top-5 rotation on 23 independent
//           upward-drifting series legitimately scores 1.0+.
//
// Discriminator: a DAY-SHUFFLE placebo — ONE shared permutation of calendar
// days applied to every symbol's return simultaneously. This preserves each
// day's cross-asset correlation matrix EXACTLY and every symbol's total
// drift, but destroys all temporal structure (trend persistence).
//   If day-shuffle ALSO scores ~0.9 → the strategy's Sharpe is mostly
//     diversified drift, not trend timing (and the pipeline is clean).
//   If day-shuffle collapses (~0.0-0.4) → trend persistence in real data is
//     load-bearing; the pipeline is clean; the block-shuffle alarm was a
//     mis-specified null (fake diversification), as the red-team critique
//     originally warned.
//   A LEAK would show up as day-shuffle ≈ real (timing impossible yet
//     Sharpe preserved) AND the passive control NOT explaining the level.
//
// Also runs the PASSIVE CONTROL the alarm exposed as missing: always-long
// equal-weight of the same 23 ETFs (monthly rebalanced), real bars — how
// much Sharpe does zero-skill buy-and-hold diversification earn here?
//
// Universe note: day-shuffle needs every symbol present on every shuffled
// day; XLC lists 2018-06, so the shuffle universe is the 22 full-history
// ETFs (recorded). All runs recorded as trials (kind placebo-control /
// control) — the bar impact is accepted; this is a bug hunt.

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE,
} = require('./validate-trend');

const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE23 = [...BASE, ...DIVERSIFIERS];
const UNIVERSE22 = UNIVERSE23.filter(s => s !== 'XLC'); // full-history only
const START = '2016-01-04';
const SPEC = { ...DEPLOYED, rankBy: 'volAdjusted' };

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One shared permutation of return-days across ALL symbols: preserves each
 * day's cross-sectional return vector (correlation matrix intact) and each
 * symbol's total drift; destroys temporal ordering.
 */
function dayShuffleTransform(ctx, universe, seed) {
  const rand = lcg(seed);
  const n = ctx.dates.length;
  // returns matrix on the master calendar (forward-filled series → returns)
  const rets = {};
  for (const sym of universe) {
    const px = ctx.series[sym];
    const r = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      r[i] = px[i] != null && px[i - 1] != null ? px[i] / px[i - 1] - 1 : 0;
    }
    rets[sym] = r;
  }
  // shared permutation of day indices 1..n-1 (Fisher-Yates, seeded)
  const order = [];
  for (let i = 1; i < n; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // recompose prices per symbol from its true first price
  const bars = {};
  const series = {};
  for (const sym of universe) {
    const first = ctx.series[sym].find(v => v != null);
    const closes = new Array(n);
    closes[0] = first;
    for (let i = 1; i < n; i++) {
      closes[i] = closes[i - 1] * (1 + rets[sym][order[i - 1]]);
    }
    bars[sym] = ctx.dates.map((date, i) => ({ date, close: closes[i] }));
    series[sym] = closes;
  }
  return { dates: ctx.dates, bars, series };
}

async function main() {
  const results = [];

  // ---- D1/D2: day-shuffle placebos (correlation-preserving null) ----
  for (const seed of [505, 606]) {
    const { wfResult, verdict } = await validateStrategy({
      family: 'placebo-control',
      strategyId: `placebo-dayshuffle-s${seed}`,
      trialKind: 'placebo-control',
      script: 'scripts/backtests/diagnose-placebo-alarm.js',
      description: `Day-shuffle placebo (seed ${seed}): one shared permutation of calendar days across all 22 full-history ETFs — cross-asset correlations and drift preserved, temporal structure destroyed. Discriminates pipeline-leak vs mis-specified-null for the 2026-06-10 alarm.`,
      universe: UNIVERSE22,
      start: START,
      buildCandidates: ctx => {
        const t = dayShuffleTransform(ctx, UNIVERSE22, seed);
        const sim = simulateDeployed(t, SPEC, ctx.costMultiplier, UNIVERSE22);
        return [
          {
            params: {
              ...SPEC,
              placebo: 'dayShuffle',
              seed,
              universe: 'full22',
            },
            returns: sim.returns,
          },
        ];
      },
      benchmarkSymbol: 'SPY',
      notes: [
        'BUG-HUNT diagnostic for the manifest R1 alarm — not a strategy.',
        'Preserves cross-asset correlation + drift; destroys trend persistence. If this scores near the real 0.89, the strategy Sharpe is mostly diversified drift; if it collapses, trend timing is real and the alarm was a mis-specified null.',
        'XLC excluded (lists 2018-06; day-shuffle needs full-history symbols). 22-ETF universe.',
      ],
    });
    results.push({
      id: `dayshuffle-s${seed}`,
      oosSharpe: wfResult.oos.stats.sharpe,
      verdict,
    });
  }

  // ---- C1: passive control — always-long EW-22, monthly rebalance, real bars ----
  const { wfResult: ewWf, verdict: ewVerdict } = await validateStrategy({
    family: 'placebo-control',
    strategyId: 'control-ew22-passive',
    trialKind: 'control',
    script: 'scripts/backtests/diagnose-placebo-alarm.js',
    description:
      'Passive control: always-long equal-weight of the same 22 full-history ETFs, monthly rebalanced, real bars. Measures how much Sharpe zero-skill diversified drift earns on this universe — the attribution baseline the alarm exposed as missing.',
    universe: UNIVERSE22,
    start: START,
    buildCandidates: ctx => {
      const n = ctx.dates.length;
      const rets = new Array(n).fill(null);
      const w = 1 / UNIVERSE22.length;
      let rebalMonth = '';
      // weights reset monthly (equal), drift within month — close enough to
      // the engine's spirit; cost: 5bps on turnover ~ negligible, charged at
      // 2bps/month flat for honesty at both cost multipliers
      const monthlyCost = 0.0002 * ctx.costMultiplier;
      for (let i = 260; i < n; i++) {
        let r = 0;
        let cnt = 0;
        for (const sym of UNIVERSE22) {
          const px = ctx.series[sym];
          if (px[i] != null && px[i - 1] != null) {
            r += w * (px[i] / px[i - 1] - 1);
            cnt++;
          }
        }
        if (!cnt) continue;
        const m = ctx.dates[i].slice(0, 7);
        if (m !== rebalMonth) {
          rebalMonth = m;
          r -= monthlyCost;
        }
        rets[i] = r;
      }
      return [
        {
          params: { control: 'ew22-passive', universe: 'full22' },
          returns: rets,
        },
      ];
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Attribution baseline, not a strategy claim: zero-skill equal-weight drift on the identical universe and window.',
    ],
  });
  results.push({
    id: 'ew22-passive',
    oosSharpe: ewWf.oos.stats.sharpe,
    verdict: ewVerdict,
  });

  console.log(
    '\n=== DIAGNOSTIC SUMMARY (vs real volrank-23 OOS Sharpe 0.89) ==='
  );
  for (const r of results) {
    console.log(
      `${r.id.padEnd(22)} OOS Sharpe ${r.oosSharpe.toFixed(2).padStart(6)}  ${r.verdict}`
    );
  }
  void equityStats;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
