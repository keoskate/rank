#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-mf-sleeve-capped.js
//
// CAPPED MF SLEEVE RETEST — pre-registered in
// data/reports/c8-allocator-design-2026-06.md (read it; the
// conflict-of-interest disclosure and the frozen rule live there).
//
// One change vs the rejected mf-sleeve-combo run: the allocator. The frozen
// symmetric inverse-vol convention (54% mean MF weight) is replaced by the
// C8 core+satellite allocator (quant-core/allocatorCore): satellite weight
// = min(cap 0.20, invVol share), recomputed MONTHLY, core = the deployed
// trend book. Trial budget 3: two candidates + one cap-0.10 in-sample
// sensitivity. No other variants may be evaluated.

require('dotenv').config();
const { equityStats, allocatorCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { recordTrials } = require('./lib/trialsLedger');
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
const CAP = 0.2;

/** B&H returns of the available MF wrappers, EW with monthly rebalance —
 * identical to validate-mf-sleeve.js. */
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
        r -= 0.0002;
      }
    }
    out[i] = r;
  }
  return out;
}

function combo(ctx, rA, rSat, cap, costMultiplier) {
  const { wSat } = allocatorCore.cappedSatelliteWeights(ctx.dates, rA, rSat, {
    cap,
  });
  return {
    returns: allocatorCore.combineWithWeights(rA, rSat, wSat, {
      costMultiplier,
    }),
    wSat,
  };
}

async function main() {
  let stashedRA = null;
  let stashedDates = null;
  let diag = null;

  const result = await validateStrategy({
    family: 'trend-following',
    strategyId: 'mf-sleeve-capped-WF-OOS',
    script: 'scripts/backtests/validate-mf-sleeve-capped.js',
    description:
      'Capped MF sleeve retest via the C8 allocatorCore: trend book (core) + DBMF / EW(DBMF,KMLM) satellite at cap 0.20, monthly cadence. One change vs the rejected symmetric-inverse-vol run. Pre-registered in c8-allocator-design-2026-06.md.',
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
      const rDbmf = mfReturns(ctx, ['DBMF']);
      const rEw = mfReturns(ctx, MF);
      const c1 = combo(ctx, rA, rDbmf, CAP, ctx.costMultiplier);
      const c2 = combo(ctx, rA, rEw, CAP, ctx.costMultiplier);
      if (ctx.costMultiplier === 1 && !diag) {
        stashedRA = rA;
        stashedDates = ctx.dates;
        const active = c1.wSat.filter(w => w != null);
        const meanW = active.reduce((s, w) => s + w, 0) / (active.length || 1);
        diag = {
          meanSatWeight: meanW,
          capBindShare:
            active.filter(w => Math.abs(w - CAP) < 1e-12).length /
            (active.length || 1),
        };
        console.log(
          `[allocator] mean satellite weight ${(meanW * 100).toFixed(1)}% (was 54% in the rejected run); cap binds on ${(diag.capBindShare * 100).toFixed(0)}% of days`
        );
        // cap-0.10 sensitivity: in-sample only, recorded as a trial
        const s10 = combo(ctx, rA, rDbmf, 0.1, 1);
        const eq = [];
        const ds = [];
        let e = 1;
        for (let i = 0; i < ctx.dates.length; i++) {
          if (s10.returns[i] == null) continue;
          e *= 1 + s10.returns[i];
          eq.push(e);
          ds.push(ctx.dates[i]);
        }
        const sens = equityStats.statsFromEquity(ds, eq);
        console.log(
          `[sensitivity] cap=0.10 in-sample: Sharpe ${sens.sharpe.toFixed(2)}  Calmar ${sens.calmar.toFixed(2)}`
        );
        recordTrials([
          {
            family: 'trend-following',
            strategyId: 'mf-sleeve-capped-WF-OOS',
            params: { combo: 'trend+DBMF', cap: 0.1, allocator: 'c8-capped' },
            sharpe: sens.sharpe,
            window: { start: START, end: ctx.dates[ctx.dates.length - 1] },
            kind: 'sensitivity-grid',
          },
        ]);
      }
      return [
        {
          params: { combo: 'trend+DBMF', cap: CAP, allocator: 'c8-capped' },
          returns: c1.returns,
        },
        {
          params: {
            combo: 'trend+EW(DBMF,KMLM)',
            cap: CAP,
            allocator: 'c8-capped',
          },
          returns: c2.returns,
        },
      ];
    },
    faithfulness: {
      status: 'not_run',
      note: 'allocatorCore is pure and certifiable, but the live C8 reallocation job is designed-not-enabled — combos stay not_run until it runs live with certification',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Pre-registered retest (c8-allocator-design-2026-06.md): cap 0.20 from institutional convention, monthly cadence, rule form from the failure structure — none fit to the observed window; full conflict-of-interest disclosure in the design doc.',
      'Ex-ante expectation: combo tracks ~0.8x the trend book; realistic outcomes are a small improvement over A-alone or a near-tie; gate 5 fails regardless at N~104. A second rejection settles the MF-wrapper question for now.',
      'Same window caveats as the first MF run: OOS misses the Jan-Sep 2022 MF rally and covers DBMF/KMLM weak years.',
    ],
    extraReport: {
      get allocatorDiagnostics() {
        return diag;
      },
    },
  });

  // decision control: sleeve A alone on identical stitched OOS dates
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
    `  capped combo     Sharpe ${c.sharpe.toFixed(2)}  CAGR ${(c.cagr * 100).toFixed(1)}%  maxDD ${(c.maxDD * 100).toFixed(1)}%  Calmar ${c.calmar.toFixed(2)}`
  );
  console.log(
    `  sleeve A alone   Sharpe ${aStats.sharpe.toFixed(2)}  CAGR ${(aStats.cagr * 100).toFixed(1)}%  maxDD ${(aStats.maxDD * 100).toFixed(1)}%  Calmar ${aStats.calmar.toFixed(2)}`
  );
  console.log(
    `  ΔSharpe ${(c.sharpe - aStats.sharpe).toFixed(2)}  ΔCalmar ${(c.calmar - aStats.calmar).toFixed(2)}`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
