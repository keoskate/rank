#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-mf-sleeve.js
//
// MANAGED-FUTURES SLEEVE validation (strategy-slate #1, 2026-06-10).
//
// Claim under test (portfolio-level, externally motivated): adding a
// managed-futures wrapper sleeve (DBMF, KMLM — longable ETFs replicating
// long/short multi-asset trend) to the deployed trend book improves the
// combined book, because the external record shows ~0 equity correlation
// and crisis-convexity (SG Trend +27.3% in 2022) that our long-only
// self-built sleeve could NOT manufacture (it failed at corr 0.637 and was
// rejected under D16 as repackaged worse-beta).
//
// PRE-REGISTRATION (frozen here, before any simulation; trial cost = 2):
//   Candidate MF1: combo of rA = deployed trend volrank-23 and
//     rMF = DBMF buy-and-hold, using the IDENTICAL frozen combo conventions
//     from validate-trend-combo.js (causal 63d inverse-vol weights, >=40 obs
//     else wA=0.7, 5bps/side allocator fee on |dw|, fee scales with
//     costMultiplier, first active day uncharged).
//   Candidate MF2: same, with rMF = equal-weight of the AVAILABLE wrappers
//     (DBMF from 2019-05; +KMLM from 2020-12; monthly EW rebalance between
//     them at 2bps/month — the same control convention).
//   Controls (not trials): D16 passive EW of the full union universe (built
//     by the gate itself), PLUS the decision control printed post-run:
//     sleeve A (trend book) alone on the identical stitched OOS dates.
//   Expectations, stated before running: measured corr(rA, rMF) should be
//     ~0.0-0.3 if the external claim transfers; gate 3 passes only if the
//     combo beats the passive control on Sharpe or Calmar; gate 5 will
//     almost certainly FAIL (ledger N=101, OOS T only ~3.7y) — the
//     deliverable is the gate-3 diversification question, not a VALIDATED
//     label. Faithfulness is not_run: both legs are engine-executable
//     long-only holdings, but no live allocator exists (ROADMAP C8).
//   Window honesty: DBMF lists 2019-05 (KMLM 2020-12) — the combo's OOS
//     window (~2022-09+) contains the 2022 bear (good) but NOT 2020; and
//     2022 is the single best year in managed-futures history, so the
//     sleeve's measured contribution is likely FLATTERED by this window.
//     Stated here, repeated in the artifact notes.

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
const MF = ['DBMF', 'KMLM'];
const UNION = [...new Set([...UNIVERSE23, ...MF])];
const START = '2016-01-04';
const SPEC_A = { ...DEPLOYED, rankBy: 'volAdjusted' };
const VOL_WINDOW = 63;
const MIN_OBS = 40;
const WARMUP_WA = 0.7;
const ALLOC_FEE_PER_SIDE = 0.0005;

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

/** B&H returns of the available MF wrappers, EW with monthly rebalance. */
function mfReturns(ctx, symbols) {
  const n = ctx.dates.length;
  const out = new Array(n).fill(null);
  let rebalMonth = '';
  for (let i = 1; i < n; i++) {
    const avail = symbols.filter(
      s =>
        ctx.series[s] &&
        ctx.series[s][i] != null &&
        ctx.series[s][i - 1] != null
    );
    if (!avail.length) continue;
    let r = 0;
    for (const s of avail) {
      r += (1 / avail.length) * (ctx.series[s][i] / ctx.series[s][i - 1] - 1);
    }
    if (avail.length > 1) {
      const m = ctx.dates[i].slice(0, 7);
      if (m !== rebalMonth) {
        rebalMonth = m;
        r -= 0.0002; // 2bps/month EW rebalance (control convention)
      }
    }
    out[i] = r;
  }
  return out;
}

/** Identical frozen combo conventions as validate-trend-combo.js. */
function buildCombo(rA, rB, costMultiplier) {
  const n = rA.length;
  const returns = new Array(n).fill(null);
  let prevWA = null;
  const wHistory = [];
  for (let i = 0; i < n; i++) {
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
    returns[i] =
      wA * rA[i] + wB * rB[i] - ALLOC_FEE_PER_SIDE * costMultiplier * 2 * dwA;
    prevWA = wA;
    wHistory.push(wA);
  }
  return { returns, wHistory };
}

async function main() {
  let diag = null;
  let stashedRA = null;
  let stashedDates = null;

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'mf-sleeve-combo-WF-OOS',
    script: 'scripts/backtests/validate-mf-sleeve.js',
    description:
      'Deployed trend book + managed-futures wrapper sleeve (DBMF / DBMF+KMLM B&H), causal inverse-vol risk parity — the externally-evidenced ~0-correlation sleeve our long-only self-built sleeve could not manufacture. Two candidates, frozen combo conventions.',
    universe: UNION,
    start: START,
    controlUniverse: UNION, // D16: EW of everything tradable here
    buildCandidates: ctx => {
      const rA = simulateDeployed(
        ctx,
        SPEC_A,
        ctx.costMultiplier,
        UNIVERSE23
      ).returns;
      const rDbmf = mfReturns(ctx, ['DBMF']);
      const rEw = mfReturns(ctx, MF);
      const c1 = buildCombo(rA, rDbmf, ctx.costMultiplier);
      const c2 = buildCombo(rA, rEw, ctx.costMultiplier);
      if (ctx.costMultiplier === 1 && !diag) {
        stashedRA = rA;
        stashedDates = ctx.dates;
        // overlap correlation — the headline mechanism number
        const a = [];
        const b = [];
        for (let i = 0; i < ctx.dates.length; i++) {
          if (rA[i] != null && rDbmf[i] != null) {
            a.push(rA[i]);
            b.push(rDbmf[i]);
          }
        }
        const corr = pearson(a, b);
        const statsOf = rets => {
          const eq = [];
          const ds = [];
          let e = 1;
          for (let i = 0; i < ctx.dates.length; i++) {
            if (rets[i] == null) continue;
            e *= 1 + rets[i];
            eq.push(e);
            ds.push(ctx.dates[i]);
          }
          return equityStats.statsFromEquity(ds, eq);
        };
        diag = {
          corrTrendVsDbmf: corr,
          overlapDays: a.length,
          dbmfStandalone: statsOf(rDbmf),
          mfEwStandalone: statsOf(rEw),
          meanWeightMF:
            c1.wHistory.length > 0
              ? 1 - c1.wHistory.reduce((s, w) => s + w, 0) / c1.wHistory.length
              : null,
        };
        console.log(
          `[mechanism] corr(trend book, DBMF) = ${corr.toFixed(3)} over ${a.length}d ` +
            `(self-built sleeve was 0.637; external claim ~0) | DBMF standalone Sharpe ${diag.dbmfStandalone.sharpe.toFixed(2)} | mean MF weight ${(diag.meanWeightMF * 100).toFixed(0)}%`
        );
      }
      return [
        { params: { combo: 'trend+DBMF', ...SPEC_A }, returns: c1.returns },
        {
          params: { combo: 'trend+EW(DBMF,KMLM)', ...SPEC_A },
          returns: c2.returns,
        },
      ];
    },
    faithfulness: {
      status: 'not_run',
      note: 'both legs are engine-executable long-only holdings, but no live allocator exists (ROADMAP C8) — the combination layer is emulation',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Strategy-slate #1: external record (SG Trend +27.3% in 2022, Sharpe>1 that year; DBMF/KMLM live wrappers) motivates the sleeve; this run measures whether the claimed ~0 correlation and the portfolio lift transfer to OUR book on OUR dates.',
      'WINDOW FLATTERY WARNING (pre-registered): the OOS window (~2022-09+) contains the best year in managed-futures history (2022) and omits 2020. The sleeve contribution measured here is likely an UPPER bound.',
      'Walk-forward selects between the two combo candidates per fold — selection priced as 2 ledger trials.',
      'Gate-5 expectation stated ex-ante: FAIL at ledger N~101 with OOS T~3.7y; the deliverable is the gate-3 diversification verdict vs both controls.',
      'Reused-OOS disclosure: sleeve A is the thrice-selected deployed spec; its OOS window reuse carries into this combo.',
    ],
    extraReport: {
      get mfDiagnostics() {
        return diag;
      },
    },
  });

  // decision control: sleeve A alone on the identical stitched OOS dates
  const idx = new Map(stashedDates.map((d, i) => [d, i]));
  const eqA = [];
  let e = 1;
  for (const d of result.wfResult.oos.dates) {
    const i = idx.get(d);
    const r = i != null && stashedRA[i] != null ? stashedRA[i] : 0;
    e *= 1 + r;
    eqA.push(e);
  }
  const aStats = equityStats.statsFromEquity(result.wfResult.oos.dates, eqA);
  const c = result.wfResult.oos.stats;
  console.log(
    `\n[oos-decision-control] identical stitched OOS dates (${result.wfResult.oos.dates.length}d):`
  );
  console.log(
    `  combo            Sharpe ${c.sharpe.toFixed(2)}  CAGR ${(c.cagr * 100).toFixed(1)}%  maxDD ${(c.maxDD * 100).toFixed(1)}%  Calmar ${c.calmar.toFixed(2)}`
  );
  console.log(
    `  sleeve A alone   Sharpe ${aStats.sharpe.toFixed(2)}  CAGR ${(aStats.cagr * 100).toFixed(1)}%  maxDD ${(aStats.maxDD * 100).toFixed(1)}%  Calmar ${aStats.calmar.toFixed(2)}`
  );
  console.log(
    `  ΔSharpe ${(c.sharpe - aStats.sharpe).toFixed(2)}  ΔCalmar ${(c.calmar - aStats.calmar).toFixed(2)} — the sleeve earns its slot only if these are positive.`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
