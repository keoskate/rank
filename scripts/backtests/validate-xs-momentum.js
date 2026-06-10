#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-xs-momentum.js
//
// Re-validation of the cross-sectional momentum claim through the five gates.
//
// Claim under test: "ranking large caps by 12-1 momentum and holding the top
// names beats holding the same universe equal-weight" (the Jegadeesh-Titman
// selection edge).
//
// SURVIVORSHIP HANDLING: the universe is survivorship-tinted (today's mega
// caps). Both the momentum portfolio AND the benchmark share that bias, so
// the BENCHMARK here is the equal-weight-ALL portfolio of the SAME universe,
// monthly rebalanced — [momentum − EW-all] isolates the selection edge free
// of survivor inflation. SPY buy & hold is reported in extra for context.
//
// Candidate grid (every point is a ledger trial): lookback ∈ {126, 252} ×
// topN ∈ {5, 9, 14}, skip = 21 days, monthly rebalance, bpsPerSide turnover
// cost. Walk-forward selects per fold; stitched OOS is the headline.

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2016-01-04';

// Fixed universe from scripts/backtests/xs-momentum.js (45 names, frozen).
const UNIVERSE = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'META',
  'NVDA',
  'AMD',
  'INTC',
  'QCOM',
  'TXN',
  'ORCL',
  'CSCO',
  'IBM',
  'ADBE',
  'CRM',
  'WMT',
  'HD',
  'NKE',
  'MCD',
  'SBUX',
  'COST',
  'TGT',
  'LOW',
  'JPM',
  'BAC',
  'GS',
  'MS',
  'V',
  'MA',
  'AXP',
  'JNJ',
  'PFE',
  'MRK',
  'UNH',
  'ABBV',
  'LLY',
  'BA',
  'CAT',
  'GE',
  'XOM',
  'CVX',
  'PG',
  'KO',
  'PEP',
  'DIS',
];
const ALL = [...UNIVERSE, 'SPY'];

/** First index of each symbol's real (non-forward-filled) history. */
function firstIndexMap(series) {
  const out = {};
  for (const s of Object.keys(series)) {
    out[s] = series[s].findIndex(v => v != null);
  }
  return out;
}

/** First trading day of each month (rebalance at that day's close). */
function rebalanceIndices(dates) {
  const idx = [];
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7)) idx.push(i);
  }
  return idx;
}

/**
 * Monthly-rebalanced selection portfolio, same engine semantics as
 * xs-momentum.js simulate(): weights fixed between rebalances, turnover
 * cost = turnoverWeight x avg bpsPerSide of the new picks.
 *
 * selector(i) -> array of symbols to equal-weight, or null to keep holdings.
 */
function monthlyPortfolioReturns(
  series,
  dates,
  rebalSet,
  selector,
  costMultiplier
) {
  const out = new Array(dates.length).fill(null);
  let weights = null; // sym -> w
  let prevSet = new Set();
  let started = false;
  for (let i = 1; i < dates.length; i++) {
    // daily return from held weights
    if (started && weights) {
      let r = 0;
      for (const [s, w] of Object.entries(weights)) {
        const p0 = series[s][i - 1];
        const p1 = series[s][i];
        if (p0 != null && p1 != null) r += w * (p1 / p0 - 1);
      }
      out[i] = r;
    }
    // rebalance at this close
    if (rebalSet.has(i)) {
      const picks = selector(i);
      if (picks && picks.length) {
        const newSet = new Set(picks);
        if (started) {
          let turnover = 0;
          for (const s of prevSet)
            if (!newSet.has(s)) turnover += 1 / Math.max(prevSet.size, 1);
          for (const s of newSet)
            if (!prevSet.has(s)) turnover += 1 / picks.length;
          const avgBps =
            picks.reduce((a, s) => a + bpsPerSide(s), 0) / picks.length;
          const cost = turnover * (avgBps / 10000) * costMultiplier;
          out[i] = (1 + (out[i] || 0)) * (1 - cost) - 1;
        }
        weights = {};
        for (const s of picks) weights[s] = 1 / picks.length;
        prevSet = newSet;
        started = true;
      }
    }
  }
  return out;
}

function buildAll({ dates, series, costMultiplier }) {
  const firstIdx = firstIndexMap(series);
  const rebalSet = new Set(rebalanceIndices(dates));

  const momScore = (s, i, lb) => {
    if (firstIdx[s] < 0 || i - lb < firstIdx[s]) return null;
    const pEnd = series[s][i - 21];
    const pStart = series[s][i - lb];
    if (!(pEnd > 0) || !(pStart > 0)) return null;
    return pEnd / pStart - 1;
  };

  const eligible = (i, lb) =>
    UNIVERSE.filter(s => series[s] && momScore(s, i, lb) != null);

  const candidates = [];
  for (const lb of [126, 252]) {
    for (const topN of [5, 9, 14]) {
      const selector = i => {
        const scored = eligible(i, lb)
          .map(s => ({ s, m: momScore(s, i, lb) }))
          .sort((a, b) => b.m - a.m);
        if (scored.length < topN) return null;
        return scored.slice(0, topN).map(x => x.s);
      };
      candidates.push({
        params: { lookback: lb, skip: 21, topN },
        returns: monthlyPortfolioReturns(
          series,
          dates,
          rebalSet,
          selector,
          costMultiplier
        ),
      });
    }
  }

  // EW-all control: same universe, same engine, no selection. This is the
  // survivorship-matched benchmark.
  const ewReturns = monthlyPortfolioReturns(
    series,
    dates,
    rebalSet,
    i => {
      const avail = eligible(i, 252);
      return avail.length ? avail : null;
    },
    costMultiplier
  );

  return { candidates, ewReturns };
}

async function main() {
  let ewCloses = null;

  await validateStrategy({
    family: 'xs-momentum',
    strategyId: 'top-momentum-WF-OOS',
    script: 'scripts/backtests/validate-xs-momentum.js',
    description:
      'Cross-sectional 12-1 momentum, monthly top-N of a frozen 45-name large-cap universe. Benchmark is EW-ALL of the SAME universe (survivorship-matched) — the verdict measures selection edge only.',
    universe: ALL,
    start: START,
    buildCandidates: ctx => {
      const { candidates, ewReturns } = buildAll(ctx);
      // Inject the EW-all control as a pseudo-symbol so the benchmark
      // overlay/stats are computed on the identical stitched OOS dates.
      if (!ewCloses) {
        ewCloses = new Array(ctx.dates.length).fill(null);
        let eq = null;
        for (let i = 0; i < ctx.dates.length; i++) {
          if (ewReturns[i] != null) {
            eq = (eq == null ? 1 : eq) * (1 + ewReturns[i]);
            ewCloses[i] = eq;
          } else if (eq != null) {
            ewCloses[i] = eq;
          }
        }
      }
      ctx.series['EW_ALL_45'] = ewCloses;
      return ctx.costMultiplier === 1 ? candidates : candidates; // same grid at any cost multiplier
    },
    benchmarkSymbol: 'EW_ALL_45',
    notes: [
      'Claim under test: momentum SELECTION beats holding the same names equal-weight.',
      'Universe is survivorship-tinted; the EW-all benchmark shares the identical bias, so the comparison isolates selection edge. Absolute returns of both legs are inflated — do not quote them as achievable.',
      'Faithfulness not_run: no live broker plugin currently executes cross-sectional momentum.',
    ],
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
