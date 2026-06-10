#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-combo.js
//
// Manifest 2026-06-10-night.json, PC2 combo: sleeve A (deployed volrank-23)
// + sleeve B (frozen diversifier sleeve) under CAUSAL inverse-vol risk
// parity. ONE candidate, exactly ONE ledger trial.
//
// WHAT: combo daily return c(i) = wA(i)*rA(i) + wB(i)*rB(i). Both sleeves
// are simulated JOINTLY inside one buildCandidates on ONE buildCalendar date
// vector (no stored-artifact arithmetic). Weights are causal inverse-vol:
// at day i, vol of each sleeve's returns over days i-63..i-1 (data through
// i-1 only); below 40 observations the script-declared warmup convention (NOT in the manifest; declared here ex-ante)
// wA=0.7/wB=0.3 applies. Allocator turnover is charged at 5bps per side of
// the reallocation.
//
// WHY: sleeve A is the deployed edge but is ~100% equity-trend; the combo
// tests whether the pre-registered low-correlation B sleeve plus a
// mechanical risk-parity allocator improves risk-adjusted return over A
// alone. The honest decision control is SLEEVE A ALONE on identical OOS
// dates (printed post-run below); the artifact benchmark stays SPY by
// pipeline convention only.
//
// HONEST CAVEATS (from the manifest):
// - faithfulness not_run: no live allocator exists (ROADMAP C8); the sleeves
//   individually run certified cores but the combination layer is emulation.
//   The combo CANNOT deploy regardless of result.
// - Reused OOS: the 2016-2026 walk-forward OOS window has been used for spec
//   selection three times (raw18 -> breadth23 -> volrank23); this result
//   carries that reuse. Pristine evidence = the forward sim broker and data
//   arriving after 2026-06-10.
// - The 1x engine invocations for rA and rB re-run specs already priced in
//   the trials ledger (volrank-23 trial; diversifier-sleeve trial) — no new
//   sleeve params are introduced here; the combo itself is the one new trial.

require('dotenv').config();
const { equityStats } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
} = require('./validate-trend');
const { SLEEVE_B, SPEC: SPEC_B } = require('./validate-trend-diversifiers');

const START = '2016-01-04';

// Sleeve A: the deployed volrank-23 spec (validate-trend-volrank.js).
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE23 = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const SPEC_A = { ...DEPLOYED, rankBy: 'volAdjusted' };

// Allocator constants — all pre-registered in the manifest.
const VOL_WINDOW = 63; // sleeve-vol lookback: days i-63..i-1
const MIN_OBS = 40; // fewer non-null obs than this -> warmup default
const WARMUP_WA = 0.7; // declared warmup split: wA=0.7 / wB=0.3
const ALLOC_FEE_PER_SIDE = 0.0005; // 5bps per side of the reallocation

// Union universe: SPY is already in BASE_UNIVERSE; the Set dedupes the
// sleeve overlap (GLD/SLV/TLT/IEF/DBC appear in both sleeves' universes).
const COMBO_UNIVERSE = [...new Set([...UNIVERSE23, ...SLEEVE_B, 'SPY'])];

function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance =
    xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function pearson(xs, ys) {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}

/**
 * Causal inverse-vol combination of two sleeve return vectors.
 *
 * Weight timing: wA(i) uses only returns through day i-1 (sd over the
 * VOL_WINDOW calendar days i-63..i-1, non-null days only). Degenerate vols
 * (zero/negative) fall back to the warmup default — never look forward.
 *
 * Allocator turnover convention (declared): the charge is
 * ALLOC_FEE_PER_SIDE * (|dwA| + |dwB|) per day; since wB = 1 - wA, dwB =
 * -dwA, so this equals 10bps on |dwA|. The first active day charges zero —
 * sleeve-level entry costs are already paid inside each sleeve's exact
 * dollar ledger; the allocator fee prices reallocation between funded
 * sleeves only. The fee scales with costMultiplier so the gate-4 2x stress
 * stresses ALL costs (pipeline contract, HOWTO iron rule 2).
 */
function buildCombo(rA, rB, costMultiplier) {
  const n = rA.length;
  const returns = new Array(n).fill(null);
  let prevWA = null;
  const wHistory = [];
  for (let i = 0; i < n; i++) {
    // Sleeves share DEPLOYED's smaWindow/momLookback, so their warmups
    // coincide; skip any day either sleeve has no return.
    if (rA[i] == null || rB[i] == null) continue;
    const winA = [];
    const winB = [];
    for (let j = Math.max(0, i - VOL_WINDOW); j < i; j++) {
      if (rA[j] != null) winA.push(rA[j]);
      if (rB[j] != null) winB.push(rB[j]);
    }
    let wA = WARMUP_WA;
    if (winA.length >= MIN_OBS && winB.length >= MIN_OBS) {
      const volA = sampleSd(winA);
      const volB = sampleSd(winB);
      if (volA > 0 && volB > 0) wA = 1 / volA / (1 / volA + 1 / volB);
    }
    const wB = 1 - wA;
    const dwA = prevWA == null ? 0 : Math.abs(wA - prevWA);
    // |dwA| + |dwB| = 2*|dwA| (see convention note above)
    returns[i] =
      wA * rA[i] + wB * rB[i] - ALLOC_FEE_PER_SIDE * costMultiplier * 2 * dwA;
    prevWA = wA;
    wHistory.push(wA);
  }
  return { returns, wHistory };
}

async function main() {
  let diag = null; // 1x diagnostics for extraReport
  let stash = null; // 1x sleeve-A returns + calendar for the post-run control

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'combo-A-B-riskparity-WF-OOS',
    script: 'scripts/backtests/validate-trend-combo.js',
    description:
      'PC2 combo: sleeve A (deployed volrank-23 trend spec) + sleeve B (frozen 10-ETF non-equity diversifier sleeve) combined by causal inverse-vol risk parity (63d sleeve vols through i-1, warmup wA=0.7), allocator turnover charged at 5bps per side. Both sleeves simulated jointly on one calendar. One candidate. Research-only: no live allocator exists.',
    universe: COMBO_UNIVERSE,
    controlUniverse: COMBO_UNIVERSE, // D16: EW of the full joint sim universe (SPY is tradable in sleeve A)
    start: START,
    buildCandidates: ctx => {
      const simA = simulateDeployed(
        ctx,
        SPEC_A,
        ctx.costMultiplier,
        UNIVERSE23
      );
      const simB = simulateDeployed(ctx, SPEC_B, ctx.costMultiplier, SLEEVE_B);
      const rA = simA.returns;
      const rB = simB.returns;
      if (rA.length !== ctx.dates.length || rB.length !== ctx.dates.length) {
        throw new Error(
          `sleeve/calendar mismatch: rA=${rA.length} rB=${rB.length} dates=${ctx.dates.length} — combo arithmetic would be misaligned`
        );
      }
      const combo = buildCombo(rA, rB, ctx.costMultiplier);

      if (ctx.costMultiplier === 1 && !diag) {
        const xs = [];
        const ys = [];
        for (let i = 0; i < ctx.dates.length; i++) {
          if (rA[i] != null && rB[i] != null) {
            xs.push(rA[i]);
            ys.push(rB[i]);
          }
        }
        const correlation = pearson(xs, ys);
        console.log(
          `[combo] sleeve A/B daily-return correlation (overlap n=${xs.length}): ${correlation != null ? correlation.toFixed(3) : 'n/a'}`
        );

        const f = s =>
          `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%  Calmar ${s.calmar.toFixed(2)}`;
        const statsA = equityStats.statsFromEquity(simA.eqDates, simA.eq);
        const statsB = equityStats.statsFromEquity(simB.eqDates, simB.eq);
        const eq = [];
        const eqDates = [];
        let v = 1;
        for (let i = 0; i < combo.returns.length; i++) {
          if (combo.returns[i] == null) continue;
          v *= 1 + combo.returns[i];
          eq.push(v);
          eqDates.push(ctx.dates[i]);
        }
        const statsC = equityStats.statsFromEquity(eqDates, eq);
        console.log(
          `[head-to-head] sleeveA_volrank23 (DECISION CONTROL) ${f(statsA)}`
        );
        console.log(
          `[head-to-head] sleeveB_diversifier10          ${f(statsB)}`
        );
        console.log(
          `[head-to-head] combo_riskparity               ${f(statsC)}`
        );
        console.log(
          '[head-to-head] full-period on the identical joint calendar; the verdict-relevant A-alone control on stitched OOS dates prints after the run.'
        );
        diag = {
          sleeveCorrelation: { value: correlation, overlapDays: xs.length },
          fullPeriodHeadToHead: {
            sleeveA_volrank23: statsA,
            sleeveB_diversifier10: statsB,
            combo_riskparity: statsC,
          },
          allocatorWeights: {
            meanWA:
              combo.wHistory.reduce((a, b) => a + b, 0) / combo.wHistory.length,
            minWA: Math.min(...combo.wHistory),
            maxWA: Math.max(...combo.wHistory),
          },
          decisionControl:
            'sleeve A alone on identical OOS dates (console, post-run); SPY benchmark is pipeline convention, not the decision control',
        };
        stash = { rA: rA.slice(), dates: ctx.dates };
      }

      return [
        {
          params: {
            combo: 'A+B-riskparity',
            sleeveA: { ...SPEC_A, universe: 'breadth23' },
            sleeveB: { ...SPEC_B, universe: 'sleeveB10' },
            weighting: `causal invVol ${VOL_WINDOW}d (>= ${MIN_OBS} obs, else wA=${WARMUP_WA})`,
            allocatorBpsPerSide: 5,
          },
          returns: combo.returns,
        },
      ];
    },
    faithfulness: {
      status: 'not_run',
      note: 'no live allocator exists (ROADMAP C8); sleeves individually run certified cores but the combination layer is emulation',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Reused OOS: the 2016-2026 walk-forward OOS window has been used for spec selection three times (raw18 -> breadth23 -> volrank23). All results tonight computed on it carry that reuse; the pristine evidence streams are (a) the forward sim broker and (b) data arriving after 2026-06-10.',
      'Honest decision control: the combo is judged head-to-head vs SLEEVE A ALONE on identical stitched OOS dates (printed by this script post-run). The SPY benchmark in this artifact is pipeline convention, not the decision control.',
      'Allocator convention (declared): 5bps per side on |delta w| per sleeve, charged daily; dwB = -dwA so the charge equals 10bps on |dwA|. First active day charges zero (sleeve entry costs are paid inside the sleeve ledgers). The fee scales with the gate-4 costMultiplier.',
      'Both sleeves are simulated jointly inside one buildCandidates on one buildCalendar date vector — no stored-artifact arithmetic.',
      'Deployment: CANNOT deploy regardless of result — no live allocator exists (ROADMAP C8); faithfulness is not_run by design.',
    ],
    extraReport: {
      get comboDiagnostics() {
        return diag;
      },
    },
  });

  // ---- honest decision control: sleeve A alone on IDENTICAL OOS dates ----
  // (the artifact is already written by now, so this lives in the console and
  // is reproducible: artifact OOS dates + a sleeve-A re-sim on this calendar)
  const idx = new Map(stash.dates.map((d, i) => [d, i]));
  const oosDates = result.wfResult.oos.dates;
  const eqA = [];
  let vA = 1;
  for (const d of oosDates) {
    const i = idx.get(d);
    const r = i != null && stash.rA[i] != null ? stash.rA[i] : 0;
    vA *= 1 + r;
    eqA.push(vA);
  }
  const statsAoos = equityStats.statsFromEquity(oosDates, eqA);
  const comboOos = result.wfResult.oos.stats;
  const f = s =>
    `Sharpe ${s.sharpe.toFixed(2)}  CAGR ${(s.cagr * 100).toFixed(1)}%  maxDD ${(s.maxDD * 100).toFixed(1)}%  Calmar ${s.calmar.toFixed(2)}`;
  console.log(
    `\n[oos-control] identical stitched OOS dates (${oosDates[0]} -> ${oosDates[oosDates.length - 1]}, ${oosDates.length}d):`
  );
  console.log(`  combo_riskparity                  ${f(comboOos)}`);
  console.log(`  sleeveA alone (DECISION CONTROL)  ${f(statsAoos)}`);
  console.log(
    '  The combo can only headline if it beats sleeve A alone here — SPY is the artifact benchmark, not the decision bar.'
  );
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
