#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-dual-momentum.js
//
// Cross-asset dual momentum through the five gates.
//
// This does NOT introduce a new engine. It runs the DEPLOYED, certified trend
// rule — quant-core trendCore + the exact simulateDeployed portfolio loop from
// validate-trend.js — UNCHANGED, but on a DIVERSIFIED cross-asset universe
// (equity sectors + international + bonds + commodities + gold) instead of the
// 18 equity-only ETFs the deployed test used.
//
// Why that IS dual momentum, for free:
//   - RELATIVE momentum: the engine holds the top-5 assets by momentum/vol rank.
//   - ABSOLUTE momentum: an asset is only eligible while trendCore.uptrend
//     (price > 200d SMA AND 12-1 momentum > 0). When nothing qualifies, the
//     slots sit in CASH (0% return) — the defensive leg. And because bonds
//     (TLT/IEF/SHY), gold (GLD/SLV) and commodities (DBC/USO) are IN the
//     universe, they are held whenever THEY are the trending asset. So the
//     risk-off rotation is intrinsic to the universe + the eligibility filter —
//     no special bond-routing needed.
//
// This is the one cross-asset mechanism never run through the gates. The
// always-invested-equity trend variants pass gates 1-4 and fail gate 5
// (multiplicity). The question here: does spreading the SAME rule across
// asset classes (so it sidesteps 2018Q4 / 2020 / 2022 equity drawdowns by
// rotating to bonds/gold/cash) lift the risk-adjusted return enough to matter?
//
// FAITHFULNESS: identical decision core + engine as validate-trend.js, so the
// certifications/trend-core.json certification applies (gate 2). The universe
// is different but the decision FUNCTION is the same symbol-independent core.
//
// DISCIPLINE: ONE pre-registered candidate (the deployed spec, top-5). No
// parameter grid — every grid point is a ledger trial that raises the gate-5
// bar. Run with the cross-asset universe:
//   RANK_UNIVERSE=diverseEtf node scripts/backtests/validate-dual-momentum.js

require('dotenv').config();
const { simulateDeployed, DEPLOYED } = require('./validate-trend');
const { validateStrategy } = require('./lib/validateStrategy');
const { resolveUniverse } = require('./lib/rankUniverse');

const { name: UNIVERSE_NAME, START, UNIVERSE, ALL } = resolveUniverse();

// The deployed, certified trend rule, UNCHANGED (top-5, 200/252/21). A single
// fixed candidate — this is not parameter selection, it is the deployed rule on
// a new universe, so the walk-forward OOS is simply unseen data under the rule.
const SPEC = { ...DEPLOYED };

async function main() {
  if (UNIVERSE_NAME === 'mega45') {
    console.warn(
      '[warn] running on mega45 (single-asset-class). This test is meant for a ' +
        'cross-asset universe — use RANK_UNIVERSE=diverseEtf.'
    );
  }
  console.log(
    `[dual-momentum] universe '${UNIVERSE_NAME}' (${UNIVERSE.length} assets), deployed top-${SPEC.maxPositions} trend rule`
  );

  await validateStrategy({
    family: 'trend-following', // same family + core as validate-trend.js
    strategyId: `crossasset-dualmom-${UNIVERSE_NAME}-WF-OOS`,
    script: 'scripts/backtests/validate-dual-momentum.js',
    description:
      `Cross-asset dual momentum: the DEPLOYED, certified trend rule (top-${SPEC.maxPositions} while ` +
      'price > 200d SMA and 12-1 momentum > 0, else cash) run UNCHANGED on the ' +
      `'${UNIVERSE_NAME}' diversified ETF universe (equities + international + bonds + commodities + gold). ` +
      'Absolute momentum → cash in risk-off; bonds/gold/commodities are held when THEY trend. ' +
      'Benchmark/control is EW-of-universe (gate 3).',
    universe: ALL,
    controlUniverse: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      const sim = simulateDeployed(ctx, SPEC, ctx.costMultiplier, UNIVERSE);
      return [{ params: { ...SPEC, universe: UNIVERSE_NAME }, returns: sim.returns }];
    },
    faithfulness: { certification: 'trend-core' },
    benchmarkSymbol: 'SPY',
    notes: [
      'Same certified engine + core as validate-trend.js (simulateDeployed / quant-core trendCore); NEW universe: cross-asset ETFs.',
      'Defensive rotation is intrinsic: absolute-momentum filter → cash when nothing trends; bonds/gold/commodities held when they are the trending assets (all in the universe).',
      'ONE fixed candidate (deployed spec, top-5) — no parameter selection; OOS is unseen data under the fixed rule. Minimal ledger N by design.',
      'Head-to-head reference: validate-trend.js runs the identical rule on 18 equity-only ETFs (passes gates 1-4, fails gate 5). This tests whether cross-asset breadth changes that.',
    ],
    extraReport: {
      crossAsset: {
        universe: UNIVERSE_NAME,
        assets: UNIVERSE.length,
        spec: SPEC,
        defensiveLeg: 'cash (0%) when no asset is uptrending; bonds/gold/commodities held when trending',
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
