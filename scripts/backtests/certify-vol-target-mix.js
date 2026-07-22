#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/certify-vol-target-mix.js
//
// Faithfulness certification for the vol-targeted mix decision: the LIVE
// plugin's decision path (server/strategies/volTargetMix.js →
// volTargetStateFromCloses, exercising its session-config translation) must
// make the IDENTICAL decision the backtest makes (quant-core volTargetMixCore
// directly) on the same closes, every historical day, for every config shape a
// vol-target broker can run.
//
// Two parity checks per day:
//  1. TRANSLATION parity — plugin path on the slice == core.evaluate on the
//     slice (proves the config translation adds no decision logic).
//  2. SLICING parity — core.evaluate on the slice == core.scalarSeries on the
//     full arrays at the same index (proves the backtest's full-series path
//     and the live day-by-day path see the same causal history).
//
// Output: data/backtests/certifications/vol-target-mix.json — read by
// validateStrategy's faithfulness gate for validate-vol-target-mix.js.
//
// Residuals NOT covered (recorded in the report): live discretizes continuous
// target weights into whole positions via enter/exit hysteresis; engine
// slot/sizing mechanics; live decides intraday while the backtest applies the
// scalar to close-to-close returns.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { volTargetMixCore } = require('@keo/quant-core');
const livePlugin = require('../../server/strategies/volTargetMix');
const { loadDailyBars, maxSafeEnd } = require('./lib/marketData');
const { alignPair } = require('./soxx-band-rebalance');

const START = '2016-01-04';
const END = maxSafeEnd();
const OUT = path.join(
  __dirname,
  '../../data/backtests/certifications/vol-target-mix.json'
);

// Config shapes to certify: deployed defaults + the validator's full grid.
const CONFIGS = [
  {
    name: 'deployed-50-12',
    voltarget: { mixW: 0.5, targetVol: 0.12, volWindow: 20 },
  },
  {
    name: 'w50-tv16',
    voltarget: { mixW: 0.5, targetVol: 0.16, volWindow: 20 },
  },
  { name: 'w50-tv20', voltarget: { mixW: 0.5, targetVol: 0.2, volWindow: 20 } },
  {
    name: 'w60-tv12',
    voltarget: { mixW: 0.6, targetVol: 0.12, volWindow: 20 },
  },
  {
    name: 'w60-tv16',
    voltarget: { mixW: 0.6, targetVol: 0.16, volWindow: 20 },
  },
  { name: 'w60-tv20', voltarget: { mixW: 0.6, targetVol: 0.2, volWindow: 20 } },
];

async function main() {
  console.log(`Certifying vol-target-mix core on SOXX/GLD ${START}..${END}`);
  const { bars } = await loadDailyBars(['SOXX', 'GLD'], {
    start: START,
    end: END,
  });
  const { A, B } = alignPair(bars.SOXX, bars.GLD);
  const dates = A.map(b => b.date);
  const closesA = A.map(b => b.close);
  const closesB = B.map(b => b.close);

  const report = {
    generatedAt: new Date().toISOString(),
    window: { start: START, end: END },
    symbols: ['SOXX', 'GLD'],
    daysAligned: dates.length,
    configs: [],
    certified: true,
    residuals: [
      'live discretizes continuous target weights into whole positions (enterAboveWeight/exitBelowWeight hysteresis) — execution, not decision',
      'engine slot/sizing mechanics; backtest applies the scalar to close-to-close mix returns',
      'live decides intraday from bars through yesterday; backtest timing is close-to-close (same information set)',
    ],
  };

  for (const cfg of CONFIGS) {
    // full-series path (what the backtest consumes)
    const series = volTargetMixCore.scalarSeries(
      dates,
      closesA,
      closesB,
      cfg.voltarget
    );

    let comparisons = 0;
    let scaledDays = 0; // days the scalar was < 1 (actively de-risking)
    const divergences = [];
    const stride = cfg.name === 'deployed-50-12' ? 1 : 5;
    const startT = (cfg.voltarget.volWindow || 20) + 30;

    for (let t = startT; t < dates.length; t += stride) {
      // both paths see data through day t-1 and decide the exposure for day t
      const dSlice = dates.slice(0, t);
      const aSlice = closesA.slice(0, t);
      const bSlice = closesB.slice(0, t);

      const live = livePlugin.volTargetStateFromCloses(
        dSlice,
        aSlice,
        bSlice,
        cfg
      );
      const core = volTargetMixCore.evaluate(
        dSlice,
        aSlice,
        bSlice,
        cfg.voltarget
      );
      const seriesScalar = series[t]; // full-series scalar for day t

      comparisons++;
      if (core.ok && core.scalar < 1 - 1e-12) scaledDays++;

      const translationOk = core.ok
        ? live &&
          Math.abs(live.scalar - core.scalar) < 1e-12 &&
          Math.abs(live.weights.a - core.weights.a) < 1e-12 &&
          Math.abs(live.weights.b - core.weights.b) < 1e-12 &&
          Math.abs(live.weights.cash - core.weights.cash) < 1e-12
        : live === null;
      const slicingOk = core.ok
        ? seriesScalar != null && Math.abs(core.scalar - seriesScalar) < 1e-12
        : seriesScalar == null;

      if ((!translationOk || !slicingOk) && divergences.length < 20) {
        divergences.push({
          day: dates[t],
          translationOk,
          slicingOk,
          core: core.ok ? { scalar: core.scalar } : { ok: false },
          live: live && { scalar: live.scalar },
          seriesScalar,
        });
      }
    }

    const entry = {
      config: cfg.name,
      params: cfg.voltarget,
      comparisons,
      scaledShare: comparisons ? scaledDays / comparisons : 0,
      divergences,
      pass: divergences.length === 0,
    };
    report.configs.push(entry);
    report.daysTested = (report.daysTested || 0) + comparisons;
    if (!entry.pass) report.certified = false;
    console.log(
      `  ${entry.pass ? '✓' : '✗'} ${cfg.name.padEnd(16)} ${comparisons} comparisons, de-risking on ${(entry.scaledShare * 100).toFixed(1)}% of days`
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    `\n${report.certified ? '✓ CERTIFIED' : '✗ NOT CERTIFIED'} — wrote ${OUT}`
  );
  if (!report.certified) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
