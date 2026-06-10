#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend-diversifiers.js
//
// Manifest 2026-06-10-night.json, PC2 sleeve B: trend-following on a FROZEN
// non-equity diversifier universe.
//
// WHAT: the deployed trend conventions (trendCore eligibility decided on
// closes through yesterday, vol-adjusted ranking = momentum / 63d vol) on 10
// non-equity ETFs, with maxPositions=3 and PC1's inverse-vol slot sizing
// (cap 0.35). Single fixed candidate — no parameter selection, exactly ONE
// ledger trial. The portfolio engine is the exported simulateDeployed from
// validate-trend.js (one implementation, no drift).
//
// WHY: sleeve A (volrank-23) is nearly all equity-trend beta when risk-on.
// This sleeve exists to be the low-correlation B leg of the PC2 A+B combo
// (validate-trend-combo.js). Pre-registered expectation: standalone Sharpe
// only 0.4-0.7 — it is judged as a combo component, not a standalone
// headline.
//
// HONEST CAVEATS (from the manifest):
// - Reused OOS: the 2016-2026 walk-forward OOS window has been used for spec
//   selection three times (raw18 -> breadth23 -> volrank23); this result
//   carries that reuse. Pristine evidence = the forward sim broker and data
//   arriving after 2026-06-10.
// - Prior art: FXE/FXY/UUP/LQD/EMB bars were prefetched before the manifest
//   was committed (priorArtDisclosure[0]); no simulations ran on them
//   pre-registration.
// - Deployment: would be a NEW sim broker (long-only, engine-compatible) if
//   it clears morning review — but the live engine has no per-slot invVol
//   sizing hook yet (schema exposes fixed maxPositionSizePercent only), so
//   live sizing would differ until engine support lands. The certification
//   covers the decision core (eligibility + ranking), not sizing mechanics.

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateDeployed, DEPLOYED } = require('./validate-trend');

const START = '2016-01-04';

// Universe FROZEN by pre-registration (manifest PC2). Rule, verbatim:
// non-equity-index asset classes — metals, treasuries, broad commodities,
// FX, IG/EM credit — inception <= 2010, liquid, non-decay-by-construction;
// HYG and VNQ excluded ex-ante for equity beta.
const SLEEVE_B = [
  'GLD',
  'SLV',
  'TLT',
  'IEF',
  'DBC',
  'FXE',
  'FXY',
  'UUP',
  'LQD',
  'EMB',
];

const SPEC = {
  ...DEPLOYED,
  rankBy: 'volAdjusted',
  sizing: 'invVol',
  sizeCap: 0.35,
  maxPositions: 3,
};

async function main() {
  await validateStrategy({
    family: 'trend-following',
    strategyId: 'diversifier-sleeve-WF-OOS',
    script: 'scripts/backtests/validate-trend-diversifiers.js',
    description:
      'PC2 sleeve B: deployed trend conventions (trendCore eligibility, vol-adjusted ranking) on a frozen 10-ETF non-equity universe, top-3 slots with inverse-vol sizing capped at 35%. Fixed spec, one candidate. Built to be the diversifying leg of the A+B combo, not a standalone headline.',
    // SPY is loaded for the calendar + benchmark only — it is never traded:
    // the simulation universe below is SLEEVE_B alone.
    universe: [...SLEEVE_B, 'SPY'],
    controlUniverse: SLEEVE_B, // D16: passive control over the SIM universe (SPY is calendar-only)
    start: START,
    buildCandidates: ctx => {
      const sim = simulateDeployed(ctx, SPEC, ctx.costMultiplier, SLEEVE_B);
      return [
        {
          params: { ...SPEC, universe: 'sleeveB10' },
          returns: sim.returns,
        },
      ];
    },
    // Night-review finding: cert covers the decision core (never ran on these
    // 10 symbols) and not the invVol sizing leg — not_run is honest.
    faithfulness: {
      status: 'not_run',
      note: 'trend-core cert covers decision/ranking parity on the equity watchlist; invVol sizing has no engine hook and the cert never exercised these symbols — deployable as a new sim broker only after engine sizing support + extended certification',
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Universe FROZEN by pre-registration (data/backtests/manifests/2026-06-10-night.json, PC2): non-equity-index asset classes — metals, treasuries, broad commodities, FX, IG/EM credit — inception <= 2010, liquid, non-decay-by-construction; HYG and VNQ excluded ex-ante for equity beta.',
      'Pre-registered expectation: standalone Sharpe 0.4-0.7. Role = combo component (the B leg of PC2 A+B in validate-trend-combo.js), judged there — not as a standalone headline.',
      'If it clears morning review this would be a NEW sim broker (long-only, engine-compatible; trendCore eligibility + volAdjusted ranking are the certified live paths). Residual: the live engine has no per-slot invVol sizing hook yet (fixed maxPositionSizePercent only), so live sizing would differ until engine support lands.',
      'Reused OOS: the 2016-2026 walk-forward OOS window has been used for spec selection three times (raw18 -> breadth23 -> volrank23); this result carries that reuse. Pristine evidence streams: the forward sim broker, and data arriving after 2026-06-10.',
      'FXE/FXY/UUP/LQD/EMB bars were prefetched at ~07:01Z before the manifest was committed (priorArtDisclosure[0]); no simulations ran on them pre-registration.',
    ],
  });
}

// Exported so validate-trend-combo.js reuses the exact frozen sleeve and
// spec — single source, no drift between the standalone and combo runs.
module.exports = { SLEEVE_B, SPEC };

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
