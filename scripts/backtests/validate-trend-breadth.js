#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-breadth.js
//
// Phase C7: BREADTH-EXPANDED trend-following. Same deployed spec (same
// params, same certified trendCore decision, same portfolio engine imported
// from validate-trend.js — one implementation), but the universe widens from
// the broker's 18 equity ETFs to 23 by adding non-equity diversifiers:
// GLD, SLV (metals), TLT, IEF (treasuries), DBC (broad commodities).
//
// Rationale (the only evidence-backed route to a VALIDATED label per the
// gate-5 math in data/reports/gate5-revision-2026-06.md): trend-following's
// Sharpe scales with the number of INDEPENDENT trends available, not with
// parameter tuning. Commodities/bonds trend on different cycles than equity
// sectors — in 2022, treasuries crashed while commodities trended up, and an
// equity-only book had nothing to rotate into.
//
// Single fixed candidate (no selection); one new ledger trial. Compared
// head-to-head against the current 18-ETF spec on the identical window in
// extra.breadthComparison.

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

async function main() {
  let comparison = null;

  await validateStrategy({
    family: 'trend-following',
    strategyId: 'deployed-top5-breadth23-WF-OOS',
    script: 'scripts/backtests/validate-trend-breadth.js',
    description:
      'Deployed trend spec (certified trendCore, top-5, exit on trend break) on a 23-ETF universe: the broker’s 18 equity ETFs + GLD/SLV/TLT/IEF/DBC. Fixed params, single candidate. Tests whether breadth — more independent trends — lifts the OOS edge.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      // NOTE: simulateDeployed reads its universe from the bars present in
      // ctx (it iterates the module's UNIVERSE) — pass a patched context so
      // both specs run through the identical engine.
      const simWide = simulateDeployed(
        { ...ctx, bars: ctx.bars },
        DEPLOYED,
        ctx.costMultiplier,
        UNIVERSE
      );
      if (ctx.costMultiplier === 1 && !comparison) {
        const simBase = simulateDeployed(
          { ...ctx, bars: ctx.bars },
          DEPLOYED,
          1,
          BASE_UNIVERSE
        );
        comparison = {
          base18_insample: equityStats.statsFromEquity(
            simBase.eqDates,
            simBase.eq
          ),
          breadth23_insample: equityStats.statsFromEquity(
            simWide.eqDates,
            simWide.eq
          ),
        };
        const f = s =>
          `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%  Calmar ${s.calmar.toFixed(2)}`;
        console.log(
          `[breadth] base 18-ETF in-sample:   ${f(comparison.base18_insample)}`
        );
        console.log(
          `[breadth] wide 23-ETF in-sample:   ${f(comparison.breadth23_insample)}`
        );
      }
      return [
        {
          params: { ...DEPLOYED, universe: 'breadth23' },
          returns: simWide.returns,
        },
      ];
    },
    faithfulness: { certification: 'trend-core' },
    benchmarkSymbol: 'SPY',
    notes: [
      'Spec variant of the deployed trend-follower: identical rules and certified decision core, universe widened with non-equity diversifiers (GLD/SLV/TLT/IEF/DBC).',
      'Single fixed candidate — no parameter selection. The in-sample head-to-head vs the 18-ETF base spec is in extra.breadthComparison.',
      'If this clearly beats the base spec OOS, the deployment step is a one-line watchlist change to agents/brokers/trend-follower.md (hot-reloads into the sim broker).',
    ],
    extraReport: {
      get breadthComparison() {
        return comparison;
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
