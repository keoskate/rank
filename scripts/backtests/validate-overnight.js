#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-overnight.js
//
// Five-gate validation of the OVERNIGHT DRIFT anomaly ("Night Moves: Is the
// Overnight Drift the Grandmother of All Market Anomalies?" — Haghani,
// Ragulin, Dewey, Elm Wealth 2022).
//
// The claim: equity index returns accrue overnight (close -> next open);
// intraday (open -> close) contributes little or nothing. The tradeable
// version: buy at the close, sell at the next open, every day.
//
// What makes this the perfect stress test for the cost gate: the strategy
// does ONE FULL ROUND TRIP PER DAY (~250/year). At the repo-standard
// 5bps/side that is ~25%/year of cost drag — so the anomaly can be REAL in
// gross prices and still untradeable in cash ETFs. We therefore report the
// gross decomposition (the science) in extra.decomposition, while the gates
// judge the NET strategy (the tradeable claim) like every other candidate.
// No special treatment: if it dies on costs, that's the verdict.
//
// Candidates (every one a ledger trial): {SPY, QQQ} x {overnight leg,
// intraday leg}. The intraday leg is the paper's control — if the claim
// holds, it should be flat-to-negative even gross.
//
// Replaces the pre-foundation scripts/backtests/overnight-anomaly.js, which
// ran on Polygon data (silent 2021-06 floor — its "2018+" was really 2021+),
// in-sample only, with no verdict.

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2016-01-04';
const UNIVERSE = ['SPY', 'QQQ'];

/**
 * Daily returns for one leg of the decomposition, aligned to the master
 * calendar. No signal, no look-ahead surface: the position is unconditional
 * (always on), using actual open/close prints from adjusted bars.
 *
 * overnight: close[t-1] -> open[t], one round trip per day
 * intraday:  open[t]   -> close[t], one round trip per day
 *
 * costMultiplier 0 = gross (decomposition only; never a gate candidate).
 */
function legReturns(bars, dates, sym, leg, costMultiplier) {
  const byDate = new Map(bars[sym].map(b => [b.date, b]));
  const out = new Array(dates.length).fill(null);
  const cost = ((bpsPerSide(sym) * 2) / 10000) * costMultiplier;
  let prev = null;
  for (let i = 0; i < dates.length; i++) {
    const b = byDate.get(dates[i]);
    if (!b) continue; // symbol didn't trade this calendar day
    if (leg === 'overnight') {
      out[i] = prev ? b.open / prev.close - 1 - cost : null;
    } else {
      out[i] = b.close / b.open - 1 - cost;
    }
    prev = b;
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

function buildCandidates({ dates, bars, costMultiplier }) {
  const candidates = [];
  for (const sym of UNIVERSE) {
    for (const leg of ['overnight', 'intraday']) {
      candidates.push({
        params: { symbol: sym, leg },
        returns: legReturns(bars, dates, sym, leg, costMultiplier),
      });
    }
  }
  return candidates;
}

async function main() {
  let decomposition = null;

  await validateStrategy({
    family: 'overnight-drift',
    strategyId: 'close-to-open-WF-OOS',
    script: 'scripts/backtests/validate-overnight.js',
    description:
      'Overnight drift (Haghani/Ragulin/Dewey 2022): long close->next-open every day, NET of one round trip per day. Intraday leg included as the paper’s control. Headline equity is walk-forward out-of-sample.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      if (ctx.costMultiplier === 1 && !decomposition) {
        // The science, separated from the trade: gross decomposition + a
        // best-case auction-execution sensitivity (~1bp/side), reported but
        // never gated on.
        decomposition = {};
        for (const sym of UNIVERSE) {
          const g = leg => statsOf(ctx.dates, legReturns(ctx.bars, ctx.dates, sym, leg, 0));
          const bh = statsOf(
            ctx.dates,
            ctx.bars[sym].map((b, k) => (k ? b.close / ctx.bars[sym][k - 1].close - 1 : null))
          );
          const netAt1bp = leg => {
            const rets = legReturns(ctx.bars, ctx.dates, sym, leg, 0).map(r =>
              r == null ? null : r - 2 / 10000
            );
            return statsOf(ctx.dates, rets);
          };
          decomposition[sym] = {
            grossOvernight: g('overnight'),
            grossIntraday: g('intraday'),
            buyHoldCloseToClose: bh,
            overnightNetAt1bpPerSide: netAt1bp('overnight'),
          };
          console.log(
            `[decomposition] ${sym}: gross overnight CAGR ${(decomposition[sym].grossOvernight.cagr * 100).toFixed(1)}% ` +
              `(Sharpe ${decomposition[sym].grossOvernight.sharpe.toFixed(2)}) | gross intraday CAGR ${(decomposition[sym].grossIntraday.cagr * 100).toFixed(1)}% ` +
              `(Sharpe ${decomposition[sym].grossIntraday.sharpe.toFixed(2)}) | close-close B&H CAGR ${(bh.cagr * 100).toFixed(1)}%`
          );
        }
      }
      return buildCandidates(ctx);
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Claim under test: "overnight has all the returns" as a TRADEABLE strategy — buy close, sell next open, ~250 round trips/year.',
      'Cost reality: repo-standard 5bps/side means ~25%/yr drag at daily round trips. The gross anomaly (the science) is in extra.decomposition; the gates judge the net strategy. A best-case ~1bp/side auction-execution sensitivity is also recorded — the paper itself implements via futures/auctions.',
      'No instrumented trade-log artifact: a daily-flip strategy produces ~2,400 identical marker pairs, which is noise, not insight.',
      'Faithfulness not_run: no live plugin executes close/open auction pairs (would require MOC/MOO order support in the engine).',
    ],
    extraReport: { get decomposition() { return decomposition; } },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
