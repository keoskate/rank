#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-overnight-soxx-fixed.js
//
// FIXED-SPEC follow-up to validate-overnight.js: plain SOXX overnight
// (buy the close auction, sell the next open auction), every night, NO
// weekday or trend selection — a single candidate, so this run adds no
// selection bias of its own (the broader 32-variant fishing trip is already
// priced into the trials ledger and this verdict pays that bar).
//
// COST ASSUMPTION (explicit, conditional): 1bp/side via the official
// closing/opening auctions (MOC + MOO orders — Alpaca supports cls/opg TIFs;
// auction prints cross no spread on an ETF as liquid as SOXX). This is NOT
// the repo-standard 5bps/side market-order model; the verdict is conditional
// on auction-grade execution, the 2x gate stresses 2bp/side, and the
// standard-cost (5bps) result is reported in extra.costComparison so nobody
// can quote this verdict without the assumption attached.
//
// Benchmark: SOXX buy & hold on the identical OOS dates — the honest control
// is "if you love semis, why not just hold them?"

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2016-01-04';
const UNIVERSE = ['SPY', 'SOXX']; // SPY anchors the master calendar
const SYMBOL = 'SOXX';
const AUCTION_BPS_PER_SIDE = 1;
const WARMUP = 260; // align with the variants run for comparability

/** Overnight returns: close[t-1] -> open[t], every night, cash otherwise. */
function overnightReturns(bars, dates, costPerSideBps) {
  const series = bars[SYMBOL];
  const byDate = new Map(series.map((b, k) => [b.date, k]));
  const out = new Array(dates.length).fill(null);
  const cost = (costPerSideBps * 2) / 10000;
  for (let i = 0; i < dates.length; i++) {
    if (i < WARMUP) continue;
    const k = byDate.get(dates[i]);
    if (k == null || k === 0) continue;
    out[i] = series[k].open / series[k - 1].close - 1 - cost;
  }
  return out;
}

function statsOf(dates, returns) {
  const eq = [];
  const ds = [];
  let e = 1;
  for (let i = 0; i < dates.length; i++) {
    if (returns[i] == null) continue;
    e *= 1 + returns[i];
    eq.push(e);
    ds.push(dates[i]);
  }
  return equityStats.statsFromEquity(ds, eq);
}

async function main() {
  let costComparison = null;

  await validateStrategy({
    family: 'overnight-drift',
    strategyId: 'soxx-overnight-fixed-auction-WF-OOS',
    script: 'scripts/backtests/validate-overnight-soxx-fixed.js',
    description:
      'SOXX overnight, every night, FIXED spec (no selection). COST-CONDITIONAL: assumes auction execution (MOC+MOO) at 1bp/side; standard 5bps/side result in extra.costComparison. Benchmark is SOXX buy & hold on identical OOS dates.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      if (ctx.costMultiplier === 1 && !costComparison) {
        costComparison = {};
        for (const [label, bps] of [
          ['gross', 0],
          ['auction_1bp_per_side', 1],
          ['repoStandard_5bp_per_side', 5],
        ]) {
          const s = statsOf(
            ctx.dates,
            overnightReturns(ctx.bars, ctx.dates, bps)
          );
          costComparison[label] = s;
          console.log(
            `[cost-comparison] ${label.padEnd(26)} CAGR ${(s.cagr * 100).toFixed(1)}%  Sharpe ${s.sharpe.toFixed(2)}  maxDD ${(s.maxDD * 100).toFixed(1)}%`
          );
        }
      }
      return [
        {
          params: {
            symbol: SYMBOL,
            leg: 'overnight',
            execution: 'MOC+MOO auctions',
            costPerSideBps: AUCTION_BPS_PER_SIDE * ctx.costMultiplier,
          },
          returns: overnightReturns(
            ctx.bars,
            ctx.dates,
            AUCTION_BPS_PER_SIDE * ctx.costMultiplier
          ),
        },
      ];
    },
    benchmarkSymbol: 'SOXX',
    notes: [
      'COST-CONDITIONAL VERDICT: assumes auction execution at 1bp/side (MOC entry, MOO exit). At the repo-standard 5bps/side market-order model this strategy is dead (see extra.costComparison) — do not quote this verdict without the assumption.',
      'Single fixed candidate — no selection in this run. The multiple-testing gate still deflates against the full trials ledger, which includes the 32-variant overnight fishing trip; that is the correct price.',
      'Benchmark is SOXX buy & hold on the same OOS dates: the overnight leg must beat simply holding the ETF to matter.',
      '~250 round trips/year. Faithfulness not_run: the engine has no MOC/MOO order support yet; building it is the prerequisite for ever deploying this.',
    ],
    extraReport: {
      get costComparison() {
        return costComparison;
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
