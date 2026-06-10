#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/certify-trend-core.js
//
// Faithfulness certification for the trend-following decision: the LIVE
// plugin's decision path (server/strategies/trendFollowing.js →
// trendStateFromCloses, exercising its session-config translation) must make
// the IDENTICAL decision the backtests make (quant-core trendCore directly)
// on the same closes, every historical day, for every config shape the
// trend-follower broker can run.
//
// Output: data/backtests/certifications/trend-core.json — read by
// validateStrategy's faithfulness gate for the trend-following family.
//
// Residual difference NOT covered here (recorded in the report): live may
// substitute a realtime intraday price for the latest close when deciding a
// trend break (execution timing), and live order execution uses the engine's
// slot/sizing mechanics. The DECISION on closes is what this certifies.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { trendCore } = require('@keo/quant-core');
const livePlugin = require('../../server/strategies/trendFollowing');
const { loadDailyBars, maxSafeEnd } = require('./lib/marketData');

const START = '2016-01-04';
const END = maxSafeEnd();
const OUT = path.join(
  __dirname,
  '../../data/backtests/certifications/trend-core.json'
);

// The trend-follower broker's watchlist (agents/brokers/trend-follower.md).
const SYMBOLS = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'XLK',
  'SMH',
  'XLF',
  'XLE',
  'XLV',
  'XLY',
  'XLP',
  'XLI',
  'XLU',
  'XLB',
  'XLRE',
  'XLC',
  'EEM',
  'EFA',
];

// Config shapes to certify: deployed defaults + the knobs sessions can set.
const CONFIGS = [
  { name: 'deployed-defaults', session: {}, core: {} },
  {
    name: 'sma150-mom126',
    session: { trendSmaWindow: 150, trendMomentumDays: 126 },
    core: { smaWindow: 150, momLookback: 126 },
  },
  {
    name: 'sma250',
    session: { trendSmaWindow: 250 },
    core: { smaWindow: 250 },
  },
];

async function main() {
  console.log(
    `Certifying trend core on ${SYMBOLS.length} symbols ${START}..${END}`
  );
  const { bars } = await loadDailyBars(SYMBOLS, { start: START, end: END });

  const report = {
    generatedAt: new Date().toISOString(),
    window: { start: START, end: END },
    symbols: SYMBOLS,
    configs: [],
    certified: true,
    residuals: [
      'live may use a realtime intraday price instead of the latest close for trend-break timing',
      'live order execution uses engine slot/sizing mechanics; backtest emulates them (see validate-trend)',
    ],
  };

  for (const cfg of CONFIGS) {
    let days = 0;
    let uptrendDays = 0;
    const divergences = [];
    for (const sym of SYMBOLS) {
      const series = bars[sym];
      if (!series || series.length < 300) continue;
      const closes = series.map(b => b.close);
      // step through history; stride 1 for the deployed config, 5 for the
      // alternates (still thousands of comparisons, just faster)
      const stride = cfg.name === 'deployed-defaults' ? 1 : 5;
      for (let t = 260; t < closes.length; t += stride) {
        const slice = closes.slice(0, t + 1);
        const core = trendCore.evaluateTrend(slice, cfg.core);
        const live = livePlugin.trendStateFromCloses(slice, cfg.session);
        days++;
        if (core.uptrend) uptrendDays++;
        const same = live
          ? core.ok &&
            core.uptrend === live.uptrend &&
            Math.abs(core.sma - live.sma200) < 1e-9 &&
            Math.abs((core.momentum ?? -999) - (live.momentum ?? -999)) <
              1e-12 &&
            Math.abs((core.rankScore ?? -999) - (live.rankScore ?? -999)) < 1e-9
          : !core.ok;
        if (!same && divergences.length < 20) {
          divergences.push({
            symbol: sym,
            day: series[t].date,
            core: {
              ok: core.ok,
              uptrend: core.uptrend,
              sma: core.sma,
              momentum: core.momentum,
            },
            live: live && {
              uptrend: live.uptrend,
              sma200: live.sma200,
              momentum: live.momentum,
            },
          });
        }
      }
    }
    const entry = {
      config: cfg.name,
      comparisons: days,
      uptrendRate: days ? uptrendDays / days : 0,
      divergences,
      pass: divergences.length === 0,
    };
    report.configs.push(entry);
    report.daysTested = (report.daysTested || 0) + days;
    if (!entry.pass) report.certified = false;
    console.log(
      `  ${entry.pass ? '✓' : '✗'} ${cfg.name.padEnd(20)} ${entry.comparisons} comparisons, uptrend ${(entry.uptrendRate * 100).toFixed(1)}% of symbol-days`
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
