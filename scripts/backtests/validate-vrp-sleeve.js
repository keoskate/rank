#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-vrp-sleeve.js
//
// VRP SLEEVE TEST (strategy-slate #2) — the FREE test that precedes any
// options-data purchase. PRE-REGISTERED HERE, trial budget 1.
//
// The decision in front of us is not "can we simulate put-writing" — it is
// "does a volatility-risk-premium sleeve earn a slot in our book". That is
// testable with live wrapper ETFs on the existing data path:
//  - PUTW (PUT-index implementation) was DELISTED ~2025-04 — itself a data
//    point on retail VRP wrappers; used as a truncated reference only.
//  - XYLD (S&P 500 BuyWrite, 2016+, alive) is the economic twin by put-call
//    parity (covered call == cash-secured put-write) and is the candidate.
//
// Candidate (1 trial): trend volrank-23 (core) + XYLD B&H (satellite) via
// the C8 allocatorCore at the established conventions (cap 0.20 from
// institutional convention, monthly cadence) — identical to the capped MF
// retest, one variable changed: the satellite.
//
// EX-ANTE EXPECTATION (stated before running): covered-call is short-vol +
// long-equity — corr to our equity-heavy trend book likely 0.6-0.8, so
// REJECTION is the base case, like both prior sleeves. The published VRP
// (PUT index Sharpe 0.65 since 1986) is a premium vs CASH-plus-equity, not
// a diversifier for a trend book. If this rejects, buying options chains is
// justified ONLY for standalone VRP strategy development (delta/tenor
// variations) — a separate, harder case given the gate-5 math.
//
// Diagnostics reported: corr(trend, XYLD), corr(SPY, XYLD) (factor check),
// XYLD standalone stats, truncated-PUTW reference stats.

require('dotenv').config();
const { equityStats, allocatorCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE,
} = require('./validate-trend');

const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE23 = [...BASE, ...DIVERSIFIERS];
const UNION = [...new Set([...UNIVERSE23, 'XYLD', 'PUTW'])];
const START = '2016-01-04';
const SPEC_A = { ...DEPLOYED, rankBy: 'volAdjusted' };
const CAP = 0.2;

function bhReturns(ctx, sym) {
  const n = ctx.dates.length;
  const out = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const px = ctx.series[sym];
    if (px && px[i] != null && px[i - 1] != null) {
      out[i] = px[i] / px[i - 1] - 1;
    }
  }
  return out;
}

function pearson(xs, ys) {
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

function overlapCorr(a, b) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] != null && b[i] != null) {
      xs.push(a[i]);
      ys.push(b[i]);
    }
  }
  return { corr: xs.length > 2 ? pearson(xs, ys) : null, n: xs.length };
}

async function main() {
  let stashedRA = null;
  let stashedDates = null;
  let diag = null;

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'vrp-sleeve-capped-WF-OOS',
    script: 'scripts/backtests/validate-vrp-sleeve.js',
    description:
      'VRP sleeve test (slate #2, free pre-purchase test): trend book (core) + XYLD covered-call B&H (satellite) via C8 allocatorCore at cap 0.20, monthly cadence. One variable changed vs the capped MF retest: the satellite.',
    universe: UNION,
    start: START,
    controlUniverse: UNION,
    buildCandidates: ctx => {
      const rA = simulateDeployed(
        ctx,
        SPEC_A,
        ctx.costMultiplier,
        UNIVERSE23
      ).returns;
      const rXyld = bhReturns(ctx, 'XYLD');
      const { wSat } = allocatorCore.cappedSatelliteWeights(
        ctx.dates,
        rA,
        rXyld,
        { cap: CAP }
      );
      const returns = allocatorCore.combineWithWeights(rA, rXyld, wSat, {
        costMultiplier: ctx.costMultiplier,
      });
      if (ctx.costMultiplier === 1 && !diag) {
        stashedRA = rA;
        stashedDates = ctx.dates;
        const rSpy = bhReturns(ctx, 'SPY');
        const rPutw = bhReturns(ctx, 'PUTW');
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
        const cTrend = overlapCorr(rA, rXyld);
        const cSpy = overlapCorr(rSpy, rXyld);
        const cPutw = overlapCorr(rPutw, rXyld);
        diag = {
          corrTrendVsXyld: cTrend.corr,
          corrSpyVsXyld: cSpy.corr,
          corrXyldVsPutw: cPutw.corr,
          xyldStandalone: statsOf(rXyld),
          putwTruncatedReference: statsOf(rPutw),
        };
        console.log(
          `[mechanism] corr(trend book, XYLD) = ${cTrend.corr.toFixed(3)} (${cTrend.n}d) | corr(SPY, XYLD) = ${cSpy.corr.toFixed(3)} | corr(XYLD, PUTW) = ${cPutw.corr ? cPutw.corr.toFixed(3) : 'n/a'} (factor check)`
        );
        console.log(
          `[standalone] XYLD Sharpe ${diag.xyldStandalone.sharpe.toFixed(2)} CAGR ${(diag.xyldStandalone.cagr * 100).toFixed(1)}% maxDD ${(diag.xyldStandalone.maxDD * 100).toFixed(1)}% | PUTW (truncated, delisted 2025-04) Sharpe ${diag.putwTruncatedReference.sharpe.toFixed(2)}`
        );
      }
      return [
        {
          params: { combo: 'trend+XYLD', cap: CAP, allocator: 'c8-capped' },
          returns,
        },
      ];
    },
    faithfulness: {
      status: 'not_run',
      note: 'allocatorCore pure/certifiable; live C8 job designed-not-enabled; XYLD itself is engine-holdable long-only',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Slate #2 free pre-purchase test: settles whether a VRP sleeve earns a slot BEFORE buying options chains. Chains are only needed for standalone VRP variations (delta/tenor) — a separate decision.',
      'Ex-ante expectation: covered-call carries heavy equity beta (corr to SPY ~0.85 published); rejection is the base case. PUTW delisting (2025-04) noted as a retail-VRP-wrapper data point.',
      'Cap 0.20 and monthly cadence inherited from the frozen C8 conventions — no new parameters introduced.',
    ],
    extraReport: {
      get vrpDiagnostics() {
        return diag;
      },
    },
  });

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
    `  trend+XYLD combo  Sharpe ${c.sharpe.toFixed(2)}  CAGR ${(c.cagr * 100).toFixed(1)}%  maxDD ${(c.maxDD * 100).toFixed(1)}%  Calmar ${c.calmar.toFixed(2)}`
  );
  console.log(
    `  trend book alone  Sharpe ${aStats.sharpe.toFixed(2)}  CAGR ${(aStats.cagr * 100).toFixed(1)}%  maxDD ${(aStats.maxDD * 100).toFixed(1)}%  Calmar ${aStats.calmar.toFixed(2)}`
  );
  console.log(
    `  ΔSharpe ${(c.sharpe - aStats.sharpe).toFixed(2)}  ΔCalmar ${(c.calmar - aStats.calmar).toFixed(2)}`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
