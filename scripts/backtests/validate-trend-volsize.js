#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-volsize.js
//
// Manifest 2026-06-10-night, experiment PC1-volsized-slots: INVERSE-VOL SLOT
// SIZING on the breadth-23 vol-ranked trend spec.
//
// One change vs the deployed volrank-23 spec (validate-trend-volrank.js):
// slot sizing. At each refill day, the would-be top-N book (current holdings
// + best fills) is sized target_j = equityNow * min(cap, (1/vol_j) /
// sum_k(1/vol_k)) where vol_j is trendCore st.vol from the same states map
// the decisions use (closes through day i-1). Funded from cash only (gross
// <= 100% by construction), positions NEVER resized after entry, exits
// unchanged. Primary cap=0.35 (1 trial); one pre-registered in-sample
// sensitivity cap=0.25 (1 recorded trial). Trial cost of this script: 2.
//
// HONEST CAVEATS (pre-registered in the manifest):
// - CANNOT DEPLOY tonight regardless of result: the live engine has NO
//   per-slot sizing hook (broker schema exposes a fixed
//   maxPositionSizePercent only). The trend-core certification covers the
//   decision/ranking parity, not this sizing leg. Outcome label: research
//   candidate pending engine sizing support + re-certification.
// - The 2016-2026 walk-forward OOS window has been reused for spec selection
//   three times (raw18 -> breadth23 -> volrank23); results here carry that
//   reuse. Pristine evidence = the forward sim broker + post-2026-06-10 data.
// - Controls: head-to-head vs breadth23_volRank fixed-20% on identical
//   dates, plus a 10%-vol-targeted SPY control on the identical stitched OOS
//   dates (printed post-run, NOT a ledger trial — it is not a selectable
//   strategy). Vol targeting alone lifts Sharpe; the spec must beat that
//   control's lift to claim the sizing mechanism did the work.
// - Engine asserts cash >= 0 and gross exposure <= 100% every day; the 1x
//   sim's dollar ledger must tie to its equity curve (gap < $1 throws).

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { recordTrials } = require('./lib/trialsLedger');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
  CAPITAL,
} = require('./validate-trend');

const START = '2016-01-04';
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const SPEC = {
  ...DEPLOYED,
  rankBy: 'volAdjusted',
  sizing: 'invVol',
  sizeCap: 0.35,
};
// The incumbent: deployed volrank-23 with fixed 20% slots (already a
// recorded ledger trial from validate-trend-volrank.js; re-simulated here
// only for the identical-window head-to-head, not re-recorded).
const SPEC_FIXED = { ...DEPLOYED, rankBy: 'volAdjusted' };

const fmt = s =>
  `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%  Calmar ${s.calmar.toFixed(2)}`;

async function main() {
  let comparison = null;
  let stash = null; // ctx captured at 1x cost for the post-run SPY control

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'deployed-top5-breadth23-volsize-WF-OOS',
    script: 'scripts/backtests/validate-trend-volsize.js',
    description:
      'Deployed trend spec on the 23-ETF breadth universe with vol-adjusted ranking AND inverse-vol slot sizing (per-slot weight = min(0.35, normalized 1/vol over the would-be top-5 book), vol from the certified trendCore states, closes through i-1). One change vs volrank-23: the sizing. Eligibility, ranking, exits, slots identical. NOT deployable: live engine has no per-slot sizing hook.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      const sim = simulateDeployed(ctx, SPEC, ctx.costMultiplier, UNIVERSE);
      if (ctx.costMultiplier === 1 && !stash) {
        // manifest assertion: the dollar ledger must tie to the equity curve
        const realized = sim.trades.reduce((a, t) => a + (t.pnl || 0), 0);
        const unreal = sim.openPositions.reduce(
          (a, p) => a + p.unrealizedPnl,
          0
        );
        const equityPnl = sim.eq[sim.eq.length - 1] * CAPITAL - CAPITAL;
        const gap = equityPnl - (realized + unreal);
        console.log(
          `[ledger-check] realized ${realized.toFixed(2)} + unrealized ${unreal.toFixed(2)} vs equity Δ ${equityPnl.toFixed(2)} → gap ${gap.toFixed(2)}`
        );
        if (Math.abs(gap) > 1) {
          throw new Error(
            'volsize-sim ledger does not tie to its equity curve — fix before trusting any verdict'
          );
        }

        // head-to-head on identical window (in-sample, full period)
        const head2head = {};
        head2head.breadth23_volSize_cap35 = equityStats.statsFromEquity(
          sim.eqDates,
          sim.eq
        );
        const fixedSim = simulateDeployed(ctx, SPEC_FIXED, 1, UNIVERSE);
        head2head.breadth23_volRank_fixed20 = equityStats.statsFromEquity(
          fixedSim.eqDates,
          fixedSim.eq
        );
        console.log(
          `[head-to-head] breadth23_volRank_fixed20 ${fmt(head2head.breadth23_volRank_fixed20)}`
        );
        console.log(
          `[head-to-head] breadth23_volSize_cap35   ${fmt(head2head.breadth23_volSize_cap35)}`
        );

        // sizeCap sensitivity (in-sample only, recorded as a ledger trial)
        const s25 = simulateDeployed(
          ctx,
          { ...SPEC, sizeCap: 0.25 },
          1,
          UNIVERSE
        );
        head2head.breadth23_volSize_cap25 = equityStats.statsFromEquity(
          s25.eqDates,
          s25.eq
        );
        console.log(
          `[sensitivity]  sizeCap=0.25              ${fmt(head2head.breadth23_volSize_cap25)}`
        );
        recordTrials([
          {
            family: 'trend-following',
            strategyId: 'deployed-top5-breadth23-volsize-WF-OOS',
            params: { ...SPEC, sizeCap: 0.25, universe: 'breadth23' },
            sharpe: head2head.breadth23_volSize_cap25.sharpe,
            window: { start: START, end: ctx.dates[ctx.dates.length - 1] },
            kind: 'sensitivity-grid',
          },
        ]);
        comparison = head2head;
        stash = { ctx };
      }
      return [
        {
          params: { ...SPEC, universe: 'breadth23' },
          returns: sim.returns,
        },
      ];
    },
    // Night-review finding: the cert covers decision/ranking parity, NOT the
    // invVol sizing leg (no engine hook) — not_run is the honest status.
    faithfulness: {
      status: 'not_run',
      note: 'trend-core cert covers decision/ranking parity; per-slot invVol sizing has no live engine hook yet — research candidate pending engine support + re-certification',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'One-change spec variant vs volrank-23: inverse-vol slot sizing capped at 0.35, vol = trendCore st.vol (63d, closes through i-1, same states map as the decisions). Funded from cash; gross <= 100% by construction; entries never resized; exits unchanged.',
      'DEPLOYMENT BLOCKED REGARDLESS OF RESULT: the live engine has no per-slot sizing hook (schema exposes fixed maxPositionSizePercent only). The trend-core certification covers decision/ranking parity, NOT this sizing leg. Outcome label: research candidate pending engine sizing support + re-certification.',
      'Single fixed candidate. sizeCap=0.25 sensitivity is in-sample only, recorded as a ledger trial. Trial cost of this script: 2 (primary + cap sensitivity). The fixed-20% head-to-head re-sim is an already-recorded ledger trial, not re-recorded.',
      'Reused-OOS disclosure (manifest priorArtDisclosure): the 2016-2026 walk-forward OOS window has been used for spec selection three times (raw18 -> breadth23 -> volrank23); this result carries that reuse.',
    ],
    extraReport: {
      get headToHead() {
        return comparison;
      },
      spyVolTargetControl:
        'computed post-run on the identical stitched OOS dates and printed to console ([CONTROL] lines) — NOT a ledger trial (not a selectable strategy); the artifact is written before the OOS dates reach the caller, so the numbers live in the night report, not here',
    },
  });

  // ---- CONTROL: 10%-vol-targeted SPY on the identical stitched OOS dates ----
  // NOT a ledger trial: this is not a selectable strategy, it is a mechanism
  // control. Vol targeting alone lifts Sharpe; the spec must beat this
  // control's lift over raw SPY to claim its sizing adds anything beyond
  // generic vol targeting. Scale on day i uses SPY closes through i-1 only.
  const { ctx } = stash;
  const oosDates = result.wfResult.oos.dates;
  const idx = new Map(ctx.dates.map((d, i) => [d, i]));
  const spy = ctx.series['SPY'];
  const VOL_TARGET = 0.1;
  const VOL_WINDOW = 63;
  const ctrlEq = [];
  const rawEq = [];
  let ctrl = 1;
  let raw = 1;
  for (const d of oosDates) {
    const i = idx.get(d);
    if (i == null || i < VOL_WINDOW + 1) {
      throw new Error(`SPY control: insufficient history at ${d}`);
    }
    const rets = [];
    for (let j = i - VOL_WINDOW; j <= i - 1; j++) {
      rets.push(spy[j] / spy[j - 1] - 1);
    }
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(
      rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)
    );
    const vol = sd * Math.sqrt(252); // trailing 63d realized vol, annualized
    if (!(vol > 0)) {
      throw new Error(`SPY control: degenerate trailing vol at ${d}`);
    }
    const scale = Math.min(1, VOL_TARGET / vol);
    const r = spy[i] / spy[i - 1] - 1;
    ctrl *= 1 + scale * r;
    raw *= 1 + r;
    ctrlEq.push(ctrl);
    rawEq.push(raw);
  }
  const ctrlStats = equityStats.statsFromEquity(oosDates, ctrlEq);
  const rawStats = equityStats.statsFromEquity(oosDates, rawEq);
  const specOosSharpe = result.wfResult.oos.stats.sharpe;
  console.log(
    `\n[CONTROL] 10%-vol-targeted SPY on the identical stitched OOS dates (${oosDates.length}d) — not a ledger trial:`
  );
  console.log(`[CONTROL]   SPY raw           ${fmt(rawStats)}`);
  console.log(`[CONTROL]   SPY vol-targeted  ${fmt(ctrlStats)}`);
  console.log(
    `[CONTROL]   vol-targeting lift = ${(ctrlStats.sharpe - rawStats.sharpe).toFixed(2)} Sharpe; spec stitched OOS Sharpe ${specOosSharpe.toFixed(2)} — the spec must beat this lift to claim the sizing mechanism, not generic vol targeting, did the work.`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
