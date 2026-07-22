#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-vol-target.js
//
// Five-gate validation of the Moreira-Muir volatility-targeting strategy.
//
// Strategy: hold weight w_i of a single equity (rest in cash) where:
//   w_i = min(1, targetVol / realizedVol_{i-1})     // NO leverage
//   realizedVol_{i-1} = sqrt(252) * stdev(daily returns, trailing volWindow days ending at i-1)
//
// Pre-registered grid (12 candidates, do not alter):
//   asset  ∈ ['QQQ', 'SOXX']
//   targetVol ∈ [0.15, 0.20, 0.25]
//   volWindow ∈ [20, 60]
//
// node scripts/backtests/validate-vol-target.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { bpsPerSide } = require('../../server/risk/transactionCost');

const GRID = [];
for (const asset of ['QQQ', 'SOXX']) {
  for (const targetVol of [0.15, 0.2, 0.25]) {
    for (const volWindow of [20, 60]) {
      GRID.push({ asset, targetVol, volWindow });
    }
  }
}

/**
 * Compute annualized realized vol of daily simple returns over a trailing
 * window of `n` days, all ending at day `endIdx` (inclusive).
 * Returns null if there are fewer than 2 valid days in the window.
 * NO data from days > endIdx is used (strict no-lookahead).
 */
function realizedVol(returns, endIdx, n) {
  const slice = [];
  for (let i = Math.max(0, endIdx - n + 1); i <= endIdx; i++) {
    if (returns[i] != null) slice.push(returns[i]);
  }
  if (slice.length < 2) return null;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
  return Math.sqrt(252 * variance);
}

async function main() {
  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'vol-target-equity-WF-OOS',
    script: 'scripts/backtests/validate-vol-target.js',
    description:
      'Moreira-Muir volatility targeting: single-asset (QQQ or SOXX) held with weight ' +
      'w_i = min(1, targetVol / realizedVol_{i-1}), remainder in cash (0%). ' +
      'No leverage. Grid: asset{QQQ,SOXX} × targetVol{15,20,25%} × volWindow{20,60}.',
    universe: ['QQQ', 'SOXX', 'SPY'],
    controlUniverse: ['QQQ', 'SOXX'],
    benchmarkSymbol: 'SPY',
    start: '2016-01-04',
    buildCandidates: ({ dates, series, costMultiplier }) => {
      return GRID.map(({ asset, targetVol, volWindow }) => {
        const px = series[asset]; // forward-filled closes, length = dates.length
        const bps = bpsPerSide(asset) / 10000;

        // Pre-compute daily simple returns for the asset (null where price missing)
        const assetReturns = new Array(dates.length).fill(null);
        for (let i = 1; i < dates.length; i++) {
          if (px[i] != null && px[i - 1] != null) {
            assetReturns[i] = px[i] / px[i - 1] - 1;
          }
        }

        const returns = new Array(dates.length).fill(null);
        let prevW = 0; // no position before we have enough vol history

        for (let i = 1; i < dates.length; i++) {
          // realized vol uses returns through day i-1 (no lookahead)
          const rv = realizedVol(assetReturns, i - 1, volWindow);
          if (rv == null || rv === 0) continue; // not enough history yet

          const w = Math.min(1, targetVol / rv);
          const assetRet = assetReturns[i];
          if (assetRet == null) {
            prevW = w; // carry weight even on missing-price day
            continue;
          }

          // Gross return: w * asset daily return
          const gross = w * assetRet;

          // Transaction cost: charged on the absolute change in weight
          const turnover = Math.abs(w - prevW);
          const costDeduction = turnover * bps * costMultiplier;

          returns[i] = gross - costDeduction;
          prevW = w;
        }

        return { params: { asset, targetVol, volWindow }, returns };
      });
    },
    faithfulness: {
      status: 'not_run',
      note: 'research — no live plugin yet',
    },
    notes: [
      'Moreira & Muir (2017): scaling by inverse realized vol reduces left tail ' +
        'without sacrificing mean return, because vol is negatively autocorrelated.',
      'Weight capped at 1 (no leverage). Rest in cash at 0% (conservative — T-bill yield ' +
        'would improve performance).',
      'Control = EW(QQQ, SOXX) monthly-rebalanced, same OOS dates. ' +
        'Gate 3 tests vol-targeting vs naive passive exposure to the same universe.',
    ],
    extraReport: { grid: GRID },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
