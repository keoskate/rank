#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-avwap.js
//
// AV1-3: anchored-VWAP overlays on the DEPLOYED volrank-23 trend spec.
// PRE-REGISTERED: manifest data/backtests/manifests/2026-06-10-avwap-vp-events.json
// (AV-avwap-overlay, 3 trials) — committed before this script's first run.
// The opt-in params.avwap engine branch was proven byte-identical with
// avwap unset (artifact diff 20260610-091558 vs 20260610-091729: stats,
// equity, trades, yearly all identical) before any AV trial ran.
//
//   AV1 entryFilter@high252 — a candidate may only ENTER while yesterday's
//       close >= AVWAP anchored at the trailing-252d closing high.
//   AV2 entryFilter@yearStart — same filter, anchored at the calendar-year
//       first bar.
//   AV3 exitOverlay@entry — positions additionally EXIT when close falls
//       below the AVWAP anchored at their own entry bar.
//
// Faithfulness is deliberately NOT claimed: the live plugin has no AVWAP
// logic, so the trend-core certification does not cover these variants —
// gate 2 stays not_run and none of them can reach VALIDATED (research-only,
// per the manifest). PRIOR: LOW — registered to measure, not to confirm.
//
// Control (not a trial): deployed volrank-23 head-to-head on identical dates.

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
} = require('./validate-trend');

const START = '2016-01-04';
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const VOLRANK = { ...DEPLOYED, rankBy: 'volAdjusted' };

const VARIANTS = [
  {
    id: 'av1-entry-high252',
    avwap: { anchor: 'high252', mode: 'entryFilter' },
    blurb: 'entry filter: close >= AVWAP anchored at trailing-252d high',
  },
  {
    id: 'av2-entry-yearstart',
    avwap: { anchor: 'yearStart', mode: 'entryFilter' },
    blurb: 'entry filter: close >= AVWAP anchored at calendar-year start',
  },
  {
    id: 'av3-exit-entryanchor',
    avwap: { anchor: 'entry', mode: 'exitOverlay' },
    blurb: 'exit overlay: additionally exit when close < entry-anchored AVWAP',
  },
];

async function main() {
  const f = s =>
    `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%`;

  for (const v of VARIANTS) {
    const SPEC = { ...VOLRANK, avwap: v.avwap };
    let control = null;
    console.log(`\n================ ${v.id} ================`);
    const result = await validateStrategy({
      family: 'trend-following',
      strategyId: `deployed-top5-volrank23-${v.id}-WF-OOS`,
      script: 'scripts/backtests/validate-trend-avwap.js',
      description: `Deployed volrank-23 trend spec + anchored-VWAP overlay (${v.blurb}). One change vs the deployed spec; eligibility core, exits (AV1/AV2), slots, sizing, costs unchanged. Research-only: the live plugin has no AVWAP logic, so faithfulness is not claimed.`,
      universe: UNIVERSE,
      start: START,
      buildCandidates: ctx => {
        const sim = simulateDeployed(ctx, SPEC, ctx.costMultiplier, UNIVERSE);
        if (ctx.costMultiplier === 1 && !control) {
          // head-to-head control on identical dates (not a ledger trial)
          const base = simulateDeployed(ctx, VOLRANK, 1, UNIVERSE);
          control = {
            variant: equityStats.statsFromEquity(sim.eqDates, sim.eq),
            deployedVolrank23: equityStats.statsFromEquity(
              base.eqDates,
              base.eq
            ),
            variantTrades: sim.trades.length,
            baseTrades: base.trades.length,
          };
          console.log(
            `[head-to-head] ${v.id.padEnd(24)} ${f(control.variant)} (${sim.trades.length} trades)`
          );
          console.log(
            `[head-to-head] deployed-volrank23       ${f(control.deployedVolrank23)} (${base.trades.length} trades)`
          );
        }
        return [{ params: SPEC, returns: sim.returns }];
      },
      benchmarkSymbol: 'SPY',
      notes: [
        'Pre-registered: manifest 2026-06-10-avwap-vp-events.json (AV-avwap-overlay).',
        'Engine safety: params.avwap defaults off; deployed-path byte-identity proven by artifact diff before this run (see manifest/commit).',
        'Faithfulness intentionally not claimed — no live AVWAP core exists; cannot reach VALIDATED by design.',
      ],
      extraReport: {
        get headToHead() {
          return control;
        },
      },
    });
    console.log(`${v.id} verdict: ${result.verdict ?? '(see artifact)'}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
