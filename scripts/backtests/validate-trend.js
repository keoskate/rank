#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-trend.js
//
// Re-validation of the trend-following claim through the five gates.
//
// Claim under test: "an SMA trend filter on a broad index improves
// risk-adjusted returns vs buy & hold by sidestepping bear markets."
//
// Candidate grid (the honest parameter space — every point becomes a ledger
// trial): SMA length ∈ {100, 150, 200, 250} and the 50/200 cross, on SPY and
// QQQ, cash when out. Walk-forward picks per fold; stitched OOS is the
// headline.
//
// Tooling faithfulness: before validating, the compact returns-sim used here
// is cross-checked against the instrumented ts-momentum-trend artifact
// (same data path, same math) — final equity must agree to float precision.

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { validateStrategy } = require('./lib/validateStrategy');
const { listRuns, loadRunArtifact } = require('./lib/runArtifact');

const START = '2016-01-04';
const UNIVERSE = ['SPY', 'QQQ', 'TLT'];

function sma(arr, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}

/**
 * Compact daily-returns sim for an SMA/cross trend filter — the SAME math as
 * ts-momentum-trend.js (signal on close[i-1], act at close[i], bpsPerSide per
 * flipped leg). Returns array aligned to `dates` (null before warmup).
 */
function trendReturns(
  series,
  dates,
  { symbol, smaLen, fast, slow },
  costMultiplier = 1
) {
  const px = series[symbol];
  const out = new Array(dates.length).fill(null);
  if (!px) return out;
  let s0 = 0;
  while (px[s0] == null) s0++;
  const warm = slow || smaLen;
  const startI = Math.max(s0 + warm, s0 + 1);
  const cost = (bpsPerSide(symbol) / 10000) * costMultiplier;
  let invested = false;
  for (let i = startI; i < px.length; i++) {
    let want;
    if (slow) {
      const f = sma(px, i - 1, fast);
      const s = sma(px, i - 1, slow);
      want = f != null && s != null && f > s;
    } else {
      const ma = sma(px, i - 1, smaLen);
      want = ma != null && px[i - 1] > ma;
    }
    let mult = invested ? px[i] / px[i - 1] : 1;
    if (want !== invested) {
      mult *= 1 - cost;
      invested = want;
    }
    out[i] = mult - 1;
  }
  return out;
}

function buildCandidates({ dates, series, costMultiplier }) {
  const grid = [];
  for (const symbol of ['SPY', 'QQQ']) {
    for (const smaLen of [100, 150, 200, 250]) {
      grid.push({ symbol, smaLen });
    }
    grid.push({ symbol, fast: 50, slow: 200 });
  }
  return grid.map(params => ({
    params,
    returns: trendReturns(series, dates, params, costMultiplier),
  }));
}

/**
 * Tooling-faithfulness cross-check: this script's compact sim must reproduce
 * the instrumented artifact's equity for SPY SMA200 (same data, same cache).
 */
function crossCheckAgainstArtifact(series, dates) {
  const run = listRuns().find(r => r.strategyId === 'SPY_SMA200_cash');
  if (!run) {
    console.log('[cross-check] no SPY_SMA200_cash artifact found — skipped');
    return;
  }
  const art = loadRunArtifact(run.runId);
  const rets = trendReturns(series, dates, { symbol: 'SPY', smaLen: 200 }, 1);
  let eq = 1;
  for (const r of rets) if (r != null) eq *= 1 + r;
  const artEq =
    art.equity.values[art.equity.values.length - 1] / art.equity.values[0];
  const diff = Math.abs(eq - artEq) / artEq;
  const ok = diff < 1e-6;
  console.log(
    `[cross-check] compact sim vs instrumented artifact (SPY SMA200): ` +
      `${eq.toFixed(6)} vs ${artEq.toFixed(6)} → ${ok ? 'MATCH' : `DIVERGE (${(diff * 100).toFixed(4)}%)`}`
  );
  if (!ok) {
    throw new Error(
      'validator sim diverges from instrumented backtest — fix before trusting any verdict'
    );
  }
}

async function main() {
  await validateStrategy({
    family: 'trend-following',
    strategyId: 'index-trend-filter-WF-OOS',
    script: 'scripts/backtests/validate-trend.js',
    description:
      'SMA trend filter on SPY/QQQ (cash when below trend), parameters walk-forward selected. Headline equity is stitched out-of-sample.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      if (ctx.costMultiplier === 1)
        crossCheckAgainstArtifact(ctx.series, ctx.dates);
      return buildCandidates(ctx);
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Claim under test: trend filter beats buy & hold risk-adjusted by sidestepping bears.',
      'Faithfulness not_run: no live broker plugin currently executes this trend strategy.',
    ],
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
