#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-volrank.js
//
// Phase C7, second pass: VOL-ADJUSTED RANKING on the breadth-23 universe.
//
// First pass (validate-trend-breadth.js) showed naive breadth is a wash:
// raw 12-1 momentum ranking is volatility-biased, so the added diversifiers
// (GLD/SLV/TLT/IEF/DBC) almost never crack the top-5 against 30%-momentum
// equity sectors. This spec changes exactly ONE thing: eligible names are
// ranked by rankScore = momentum / 63d realized vol (computed inside the
// certified shared trendCore — the live plugin ranks by the same score under
// cfg.trendRankBy = 'volAdjusted', so faithfulness still holds). Eligibility,
// exits, slots, sizing, costs: unchanged.
//
// Single fixed candidate (no selection). A volWindow=126 sensitivity is
// computed in-sample only and recorded as a ledger trial (fishing priced).

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { recordTrials } = require('./lib/trialsLedger');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
} = require('./validate-trend');

const START = '2016-01-04';
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const SPEC = { ...DEPLOYED, rankBy: 'volAdjusted' };

async function main() {
  let comparison = null;

  await validateStrategy({
    family: 'trend-following',
    strategyId: 'deployed-top5-breadth23-volrank-WF-OOS',
    script: 'scripts/backtests/validate-trend-volrank.js',
    description:
      'Deployed trend spec on the 23-ETF breadth universe with vol-adjusted ranking (momentum / 63d vol, computed in the certified trendCore). One change vs the breadth-23 run: the ranking. Eligibility, exits, slots, sizing identical.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      const sim = simulateDeployed(ctx, SPEC, ctx.costMultiplier, UNIVERSE);
      if (ctx.costMultiplier === 1 && !comparison) {
        const f = s =>
          `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%  Calmar ${s.calmar.toFixed(2)}`;
        const head2head = {};
        for (const [label, spec, uni] of [
          ['base18_rawRank', DEPLOYED, BASE_UNIVERSE],
          ['breadth23_rawRank', DEPLOYED, UNIVERSE],
          ['breadth23_volRank', SPEC, UNIVERSE],
          ['base18_volRank', SPEC, BASE_UNIVERSE],
        ]) {
          const s = simulateDeployed(ctx, spec, 1, uni);
          head2head[label] = equityStats.statsFromEquity(s.eqDates, s.eq);
          console.log(
            `[head-to-head] ${label.padEnd(20)} ${f(head2head[label])}`
          );
        }
        // volWindow sensitivity (in-sample only, recorded as a trial)
        const s126 = simulateDeployed(
          ctx,
          { ...SPEC, volWindow: 126 },
          1,
          UNIVERSE
        );
        head2head.breadth23_volRank_vw126 = equityStats.statsFromEquity(
          s126.eqDates,
          s126.eq
        );
        console.log(
          `[sensitivity]  volWindow=126        ${f(head2head.breadth23_volRank_vw126)}`
        );
        recordTrials([
          {
            family: 'trend-following',
            strategyId: 'deployed-top5-breadth23-volrank-WF-OOS',
            params: { ...SPEC, volWindow: 126, universe: 'breadth23' },
            sharpe: head2head.breadth23_volRank_vw126.sharpe,
            window: { start: START, end: ctx.dates[ctx.dates.length - 1] },
            kind: 'sensitivity-grid',
          },
          {
            family: 'trend-following',
            strategyId: 'deployed-top5-breadth23-volrank-WF-OOS',
            params: { ...SPEC, universe: 'base18' },
            sharpe: head2head.base18_volRank.sharpe,
            window: { start: START, end: ctx.dates[ctx.dates.length - 1] },
            kind: 'sensitivity-grid',
          },
        ]);
        comparison = head2head;
      }
      return [
        {
          params: { ...SPEC, universe: 'breadth23' },
          returns: sim.returns,
        },
      ];
    },
    faithfulness: { certification: 'trend-core' },
    benchmarkSymbol: 'SPY',
    notes: [
      'One-change spec variant: rankScore = momentum/vol63 from the certified shared core; the live plugin ranks by the identical score under trendRankBy=volAdjusted (certification covers rankScore parity).',
      'Single fixed candidate. volWindow=126 and base18-universe sensitivities are in-sample only, recorded as ledger trials.',
      'If this clearly beats raw-rank breadth-23 and base-18 OOS, deployment = watchlist + trendRankBy update to agents/brokers/trend-follower.md.',
    ],
    extraReport: {
      get headToHead() {
        return comparison;
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
