#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/certify-entropy-gate.js
//
// Faithfulness certification: does the LIVE entropy gate make the IDENTICAL
// decision a backtest makes on the same data?
//
// Drives every historical day through both paths:
//   (a) the shared core directly (what a backtest calls):
//       quant-core entropyGateCore.evaluateEntropyGate(closes[0..t], cfg)
//   (b) the live module's decision path (what the trading engine calls,
//       minus the network fetch): entropyGate.decideFromCloses(closes[0..t],
//       sessionConfig) — exercising its config translation too.
//
// Identical inputs must produce identical {allow, state, normH}. Any
// divergence fails certification and is listed. The result is written to
// data/backtests/certifications/entropy-gate.json, which validateStrategy
// reads for the faithfulness gate on entropy-family runs.
//
// Why this matters: the audit measured the previous live gate blocking ~90x
// less than the backtested gate (ΔH chained per engine-call vs per-day), so
// the backtest's "drawdown protection" claim said nothing about production.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { entropyGateCore } = require('@keo/quant-core');
const liveGate = require('../../server/strategies/entropyGate');
const { loadDailyBars, maxSafeEnd } = require('./lib/marketData');

const REF = process.env.CERT_REF || 'SOXX'; // brokers reference SOXX
const START = '2016-01-04';
const END = maxSafeEnd();
const OUT_DIR = path.join(__dirname, '../../data/backtests/certifications');

// Certify every config shape brokers actually use.
const CONFIGS = [
  {
    name: 'low-entropy+transitionBlock',
    preferredRegime: 'low-entropy',
    blockOnRegimeTransition: true,
  },
  {
    name: 'high-entropy+transitionBlock',
    preferredRegime: 'high-entropy',
    blockOnRegimeTransition: true,
  },
  {
    name: 'any+transitionBlock',
    preferredRegime: 'any',
    blockOnRegimeTransition: true,
  },
  {
    name: 'low-entropy,noTransitionBlock',
    preferredRegime: 'low-entropy',
    blockOnRegimeTransition: false,
  },
];

async function main() {
  console.log(`Certifying entropy gate on ${REF} ${START}..${END}`);
  const { bars, integrity } = await loadDailyBars([REF], {
    start: START,
    end: END,
  });
  if (!bars[REF] || bars[REF].length < 300) {
    console.error('insufficient reference bars');
    process.exit(1);
  }
  const series = bars[REF];
  const closes = series.map(b => b.close);
  const dates = series.map(b => b.date);
  const warmup = 254; // max window + 2

  const report = {
    generatedAt: new Date().toISOString(),
    reference: REF,
    window: { start: dates[warmup], end: dates[dates.length - 1] },
    daysTested: 0,
    data: { source: integrity.source, adjustment: integrity.adjustment },
    configs: [],
    certified: true,
  };

  for (const cfg of CONFIGS) {
    const coreCfg = {
      preferredRegime: cfg.preferredRegime,
      blockOnTransition: cfg.blockOnRegimeTransition,
    };
    const sessionCfg = {
      entropyGateEnabled: true,
      preferredRegime: cfg.preferredRegime,
      blockOnRegimeTransition: cfg.blockOnRegimeTransition,
    };
    let days = 0;
    let blocks = 0;
    let transitions = 0;
    const divergences = [];
    for (let t = warmup; t < closes.length; t++) {
      const slice = closes.slice(0, t + 1);
      const core = entropyGateCore.evaluateEntropyGate(slice, coreCfg);
      const live = liveGate.decideFromCloses(slice, sessionCfg);
      days++;
      if (!core.allow) blocks++;
      if (core.regime.state === 'transitioning') transitions++;
      const same =
        core.allow === live.allow &&
        core.regime.state === live.regime.state &&
        Math.abs((core.regime.normH || 0) - (live.regime.normH || 0)) < 1e-12;
      if (!same && divergences.length < 20) {
        divergences.push({
          date: dates[t],
          core: {
            allow: core.allow,
            state: core.regime.state,
            normH: core.regime.normH,
          },
          live: {
            allow: live.allow,
            state: live.regime.state,
            normH: live.regime.normH,
          },
        });
      }
    }
    const entry = {
      config: cfg.name,
      daysTested: days,
      agreement: days ? (days - divergences.length) / days : 0,
      blockRate: days ? blocks / days : 0,
      transitionRate: days ? transitions / days : 0,
      divergences,
      pass: divergences.length === 0,
    };
    report.daysTested = days;
    report.configs.push(entry);
    if (!entry.pass) report.certified = false;
    console.log(
      `  ${entry.pass ? '✓' : '✗'} ${cfg.name.padEnd(32)} agreement ${(entry.agreement * 100).toFixed(2)}%  blockRate ${(entry.blockRate * 100).toFixed(1)}%  transitions ${(entry.transitionRate * 100).toFixed(1)}%`
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'entropy-gate.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    `\n${report.certified ? '✓ CERTIFIED' : '✗ NOT CERTIFIED'} — wrote ${outPath}`
  );
  if (!report.certified) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
