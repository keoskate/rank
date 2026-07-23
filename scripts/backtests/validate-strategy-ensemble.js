#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-strategy-ensemble.js
//
// Five-gate validation of a FIXED-RULE ensemble portfolio.
//
// Three sleeves, each with its deployed spec FROZEN — only the COMBINER
// varies across the 4 pre-registered candidates. Mechanism: breadth across
// uncorrelated return streams (squared IRs add for uncorrelated strategies,
// Grinold's law of active management).
//
// SLEEVE A — vol-targeted 50/50 SOXX/GLD champion
//   Base mix: simulateMonthlyPair(SOXX, GLD, 0.5, costMultiplier)
//   Scalar:   volTargetMixCore.scalarSeries(mixW=0.5, targetVol=0.12, volWindow=20)
//   Overlay cost: 5bps × |Δscalar| × costMultiplier
//   (Reproduces validate-vol-target-mix.js champion exactly.)
//
// SLEEVE B — trend volrank-23 (breadth spec)
//   simulateDeployed on the 23-ETF breadth universe (18 base + GLD/SLV/TLT/IEF/DBC)
//   params: { ...DEPLOYED, rankBy: 'volAdjusted' }
//   (Imports from validate-trend; same certified core.)
//
// SLEEVE C — calendar (FOMC + turn-of-month) on SPY, FIXED config
//   Enter at close of announcement−2 (2 days before each FOMC day),
//   exit at close of announcement day.
//   Turn-of-month: enter at close of second-to-last trading day of the month,
//   exit at close of the 3rd trading day of the new month.
//   Overlapping windows merge (hold through combined period).
//   Flat (0%) otherwise.
//   Cost: bpsPerSide('SPY')/1e4 × costMultiplier on each entry day and exit day (one side each).
//
// COMBINER — PRE-REGISTERED GRID (4 candidates, DO NOT ALTER):
//   sleeves ∈ { [A,B], [A,B,C] } × weighting ∈ { 'equal', 'invVol63' }
//   'equal': w_j = 1/K, fixed.
//   'invVol63': at each month's first trading day, w_j ∝ 1/stdev(sleeve j trailing
//               63 daily returns through prior day), normalized; sleeves with <63
//               obs get weight 0 until ready.
//   Combined return r_i = Σ w_j · r_j,i  (sleeve null treated as 0 AFTER that
//   sleeve has started; before all selected sleeves start, output null).
//   Combiner turnover cost: 2bps × Σ|Δw_j| × costMultiplier on rebalance days.
//
// BUILD ONLY — do not run (trials-ledger writes must be serialized).
// node --check scripts/backtests/validate-strategy-ensemble.js

require('dotenv').config();
const { volTargetMixCore } = require('@keo/quant-core');
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { validateStrategy } = require('./lib/validateStrategy');
const { simulateMonthlyPair, alignPair } = require('./soxx-band-rebalance');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: TREND_BASE_UNIVERSE,
} = require('./validate-trend');

// ─────────────────────────────────────────────────────────────────────────────
// FOMC SCHEDULED DECISION DATES (2016-01 through 2026-07)
// Source: Federal Reserve official calendar pages:
//   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (2021-2026)
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical2020.htm
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical2019.htm
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical2018.htm
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical2017.htm
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical2016.htm
// Fetched 2026-07-22. Scheduled meetings only — no emergency/unscheduled sessions.
// Sanity check: 83 dates, all weekdays, strictly increasing, 7-9/year (full years;
// 2020 had 7 — March cancelled due to COVID). 2026 has 4 dates through July 2026.
const FOMC_DATES = new Set([
  // 2016 (8)
  '2016-01-27', '2016-03-16', '2016-04-27', '2016-06-15',
  '2016-07-27', '2016-09-21', '2016-11-02', '2016-12-14',
  // 2017 (8)
  '2017-02-01', '2017-03-15', '2017-05-03', '2017-06-14',
  '2017-07-26', '2017-09-20', '2017-11-01', '2017-12-13',
  // 2018 (8)
  '2018-01-31', '2018-03-21', '2018-05-02', '2018-06-13',
  '2018-08-01', '2018-09-26', '2018-11-08', '2018-12-19',
  // 2019 (8)
  '2019-01-30', '2019-03-20', '2019-05-01', '2019-06-19',
  '2019-07-31', '2019-09-18', '2019-10-30', '2019-12-11',
  // 2020 (7 scheduled; March 17-18 meeting was cancelled — COVID; March 15 action was
  // an unscheduled emergency session held on a Sunday and is excluded here)
  '2020-01-29', '2020-04-29', '2020-06-10',
  '2020-07-29', '2020-09-16', '2020-11-05', '2020-12-16',
  // 2021 (8)
  '2021-01-27', '2021-03-17', '2021-04-28', '2021-06-16',
  '2021-07-28', '2021-09-22', '2021-11-03', '2021-12-15',
  // 2022 (8)
  '2022-01-26', '2022-03-16', '2022-05-04', '2022-06-15',
  '2022-07-27', '2022-09-21', '2022-11-02', '2022-12-14',
  // 2023 (8)
  '2023-02-01', '2023-03-22', '2023-05-03', '2023-06-14',
  '2023-07-26', '2023-09-20', '2023-11-01', '2023-12-13',
  // 2024 (8)
  '2024-01-31', '2024-03-20', '2024-05-01', '2024-06-12',
  '2024-07-31', '2024-09-18', '2024-11-07', '2024-12-18',
  // 2025 (8)
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18',
  '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  // 2026 (4 through July 2026)
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
]);

// Sanity-check the FOMC date array at module load time (aborts on violation).
;(function sanityCheckFomcDates() {
  const sorted = [...FOMC_DATES].sort();
  const total = sorted.length;
  if (total < 75 || total > 90) {
    throw new Error(
      `FOMC sanity FAIL: expected 75-90 dates, got ${total}. Abort.`
    );
  }
  // All must be weekdays (Mon–Fri, JS getDay 1–5)
  for (const d of sorted) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) {
      throw new Error(`FOMC sanity FAIL: ${d} falls on a weekend. Abort.`);
    }
  }
  // Strictly increasing
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= sorted[i - 1]) {
      throw new Error(
        `FOMC sanity FAIL: dates not strictly increasing at index ${i} (${sorted[i - 1]} >= ${sorted[i]}). Abort.`
      );
    }
  }
  // 7–9 per full calendar year (2016–2025)
  for (let yr = 2016; yr <= 2025; yr++) {
    const count = sorted.filter(d => d.startsWith(String(yr))).length;
    if (count < 7 || count > 9) {
      throw new Error(
        `FOMC sanity FAIL: year ${yr} has ${count} dates (expected 7-9). Abort.`
      );
    }
  }
  console.log(
    `[fomc] sanity OK: ${total} scheduled FOMC decision dates (2016–2026)`
  );
})();

// ─────────────────────────────────────────────────────────────────────────────
// Constants
const START = '2016-01-04';
const VOL_WINDOW = 20; // sleeve A overlay look-back
const SLEEVE_A_COST_BPS = 5; // blended overlay turnover cost (same as champion)
const COMBINER_TURNOVER_BPS = 2; // cost per unit abs weight change on rebalance days

// Breadth universe for sleeve B: 18-ETF base + 5 diversifiers
const TREND_DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const TREND_BREADTH_UNIVERSE = [...TREND_BASE_UNIVERSE, ...TREND_DIVERSIFIERS];

// Union of all symbols touched by any sleeve (+ SPY for benchmark/sleeve C)
const FULL_UNIVERSE = [
  ...new Set([
    'SOXX', 'GLD', // sleeve A
    ...TREND_BREADTH_UNIVERSE, // sleeve B (includes GLD already)
    'SPY', // sleeve C + benchmark
  ]),
];

// PRE-REGISTERED COMBINER GRID — DO NOT ALTER
const GRID = [
  { sleeveSet: ['A', 'B'],      weighting: 'equal'    },
  { sleeveSet: ['A', 'B'],      weighting: 'invVol63' },
  { sleeveSet: ['A', 'B', 'C'], weighting: 'equal'    },
  { sleeveSet: ['A', 'B', 'C'], weighting: 'invVol63' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SLEEVE A: vol-targeted 50/50 SOXX/GLD (champion spec frozen)
// Reproduces validate-vol-target-mix.js champion: mixW=0.5, targetVol=0.12, volWindow=20.

function buildSleeveA(bars, dates, costMultiplier) {
  const { A, B } = alignPair(bars['SOXX'], bars['GLD']);

  // Cost-inclusive monthly-pair returns (the RETURN path)
  const mixEquity = simulateMonthlyPair(A, B, 0.5, costMultiplier, 'SOXX', 'GLD');
  const mixReturnByDate = new Map();
  for (let i = 1; i < A.length; i++) {
    mixReturnByDate.set(A[i].date, mixEquity[i] / mixEquity[i - 1] - 1);
  }

  // Scalar from shared core (cost-free signal path — same as champion)
  const pairDates = A.map(b => b.date);
  const scalars = volTargetMixCore.scalarSeries(
    pairDates,
    A.map(b => b.close),
    B.map(b => b.close),
    { mixW: 0.5, targetVol: 0.12, volWindow: VOL_WINDOW }
  );
  const scalarByDate = new Map();
  for (let i = 0; i < pairDates.length; i++) {
    if (scalars[i] != null) scalarByDate.set(pairDates[i], scalars[i]);
  }

  // Overlay returns on master calendar
  const overlayReturns = new Array(dates.length).fill(null);
  let prevW = null;
  for (let i = 0; i < dates.length; i++) {
    const mixR = mixReturnByDate.get(dates[i]);
    if (mixR === undefined || mixR === null) { prevW = null; continue; }
    const w = scalarByDate.get(dates[i]);
    if (w == null) { prevW = null; continue; }
    const wPrev = prevW !== null ? prevW : 0;
    const turnoverCost = Math.abs(w - wPrev) * (SLEEVE_A_COST_BPS / 10000) * costMultiplier;
    overlayReturns[i] = w * mixR - turnoverCost;
    prevW = w;
  }
  return overlayReturns;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLEEVE B: trend volrank-23 (breadth universe, rankBy='volAdjusted', DEPLOYED params)

function buildSleeveB(ctx, costMultiplier) {
  const sim = simulateDeployed(
    ctx,
    { ...DEPLOYED, rankBy: 'volAdjusted' },
    costMultiplier,
    TREND_BREADTH_UNIVERSE
  );
  return sim.returns;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLEEVE C: calendar (FOMC + turn-of-month) on SPY
//
// FOMC windows: enter at close of (announcement_day − 2 trading days),
// exit at close of announcement_day.
// Turn-of-month windows: enter at close of second-to-last trading day of month,
// exit at close of the 3rd trading day of the new month.
// Overlapping windows merge (hold throughout).
// Cost: bpsPerSide('SPY')/1e4 × costMultiplier charged on each entry day and each
// exit day (one side each).

function buildSleeveC(dates, costMultiplier) {
  const SPY_BPS = bpsPerSide('SPY') / 10000; // 5bps/side

  // Build a set of hold dates (inclusive: all days in any window)
  // and track entry/exit days for cost charging.

  // First, build the sorted FOMC dates array for look-ahead-free window construction.
  const fomcSorted = [...FOMC_DATES].sort();

  // For each calendar date, we need: is it in an FOMC window? in a TOM window?
  // We build these by iterating forward through dates.

  // ── FOMC windows ──
  // For each FOMC date, the window is [fomcDay - 2 tradingDays, fomcDay].
  // "fomcDay - 2 trading days" means: look backwards in the dates array from the
  // FOMC date's index and go 2 steps back (i.e., the day at index fomcIdx - 2).
  // NO LOOKAHEAD: window construction uses only the FOMC calendar, which is known
  // in advance (pre-scheduled). The signal for day i is determined from the
  // pre-scheduled calendar available before day i.
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const holdSet = new Set(); // indices of dates to hold SPY

  for (const fomcDate of fomcSorted) {
    const fi = dateIdx.get(fomcDate);
    if (fi == null) continue; // FOMC date is not in our trading calendar (holiday?)
    // Window: [fi - 2, fi] inclusive
    const startI = fi - 2;
    for (let k = Math.max(0, startI); k <= fi; k++) {
      holdSet.add(k);
    }
  }

  // ── Turn-of-month windows ──
  // Enter at close of second-to-last trading day of the month (i.e., month[-2]).
  // Exit at close of the 3rd trading day of the new month (i.e., nextMonth[2], 0-indexed).
  // Build month groups.
  const monthGroups = new Map(); // 'YYYY-MM' -> [i, i, ...]
  for (let i = 0; i < dates.length; i++) {
    const m = dates[i].slice(0, 7);
    if (!monthGroups.has(m)) monthGroups.set(m, []);
    monthGroups.get(m).push(i);
  }
  const months = [...monthGroups.keys()].sort();

  for (let mi = 0; mi < months.length; mi++) {
    const days = monthGroups.get(months[mi]);
    if (days.length < 2) continue; // not enough days in month to identify second-to-last
    const secondToLast = days[days.length - 2]; // second-to-last trading day of month

    // Exit day: 3rd trading day of the NEXT month (0-indexed → index 2)
    let exitI = null;
    if (mi + 1 < months.length) {
      const nextDays = monthGroups.get(months[mi + 1]);
      if (nextDays.length >= 3) {
        exitI = nextDays[2]; // 3rd trading day (0-indexed)
      } else if (nextDays.length > 0) {
        exitI = nextDays[nextDays.length - 1];
      }
    }

    if (exitI == null) continue;
    // Window: [secondToLast, exitI] inclusive
    for (let k = secondToLast; k <= exitI; k++) {
      holdSet.add(k);
    }
  }

  // ── Build returns with cost on entry/exit transitions ──
  // Held on day i → SPY close-to-close return.
  // Entry day: first day in a new "hold" block (prev was not held or i=0 and held).
  // Exit day: last day in a "hold" block (next is not held or i=last).
  // Cost is one side: bpsPerSide/1e4 × costMultiplier charged on entry day and exit day.

  const returns = new Array(dates.length).fill(null);

  // Align SPY closes from series (need series; will be passed in via closure — see below)
  // We return a function that takes series to keep this clean.
  return function resolveWithSeries(series) {
    const spyPx = series['SPY'];

    for (let i = 1; i < dates.length; i++) {
      const held = holdSet.has(i);
      const prevHeld = holdSet.has(i - 1);
      const nextHeld = holdSet.has(i + 1);

      if (!held) {
        // Flat day — 0% return
        returns[i] = 0;
        continue;
      }

      // Compute SPY close-to-close return for day i
      const px = spyPx[i];
      const pxPrev = spyPx[i - 1];
      let r = 0;
      if (px != null && pxPrev != null && pxPrev > 0) {
        r = px / pxPrev - 1;
      }

      let cost = 0;
      // Entry cost: entering a new hold block (previous day not held, or i is first held day from i=0 edge)
      if (!prevHeld) {
        cost += SPY_BPS * costMultiplier;
      }
      // Exit cost: last day in a hold block (next day not held, or i is the last date)
      if (!nextHeld || i === dates.length - 1) {
        cost += SPY_BPS * costMultiplier;
      }

      returns[i] = r - cost;
    }

    // Before first trading day can have data: leave index 0 as null
    returns[0] = null;

    // Replace 0-return flat days with null only if we want to guard leading nulls;
    // but per spec: flat days return 0 (strategy is in SPY or flat).
    // However, before SPY data starts we should null out.
    // Find first date SPY has data:
    let firstSpyI = 0;
    while (firstSpyI < dates.length && (spyPx[firstSpyI] == null || spyPx[firstSpyI] <= 0)) {
      firstSpyI++;
    }
    for (let i = 0; i < firstSpyI; i++) returns[i] = null;
    // Also null index 0 (can't compute a return without prior close)
    if (returns[0] !== null) returns[0] = null;

    return returns;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINER: weighting logic
//
// 'equal': w_j = 1/K, fixed.
// 'invVol63': at each month's first trading day, recompute w_j ∝ 1/stdev(trailing 63
//             returns through prior day). Sleeves with <63 obs get weight 0.
//
// Combined r_i = Σ w_j * r_j,i
//   - sleeve null treated as 0 AFTER that sleeve has started (first non-null index)
//   - before ALL selected sleeves have started, output null
// Combiner turnover cost: 2bps × Σ|Δw_j| × costMultiplier on rebalance days.

function buildCombinerReturns(dates, sleeveReturns, weighting, costMultiplier) {
  const K = sleeveReturns.length;

  // Find first non-null index for each sleeve
  const sleeveStart = sleeveReturns.map(r => {
    const idx = r.findIndex(v => v !== null);
    return idx < 0 ? Infinity : idx;
  });
  // All sleeves must have started before we output a combined return
  const allStart = Math.max(...sleeveStart);
  if (!isFinite(allStart)) return new Array(dates.length).fill(null);

  // Month groups for invVol63 rebalance
  const monthStart = new Set(); // indices of first trading day of each month
  {
    let prevMonth = '';
    for (let i = 0; i < dates.length; i++) {
      const m = dates[i].slice(0, 7);
      if (m !== prevMonth) { monthStart.add(i); prevMonth = m; }
    }
  }

  let weights = new Array(K).fill(1 / K); // initial equal weights
  const combined = new Array(dates.length).fill(null);

  for (let i = allStart; i < dates.length; i++) {
    // Recompute weights on first day of month (for invVol63), using data through i-1
    if (weighting === 'invVol63' && monthStart.has(i)) {
      const invVols = sleeveReturns.map((r, j) => {
        // Gather trailing 63 non-null returns through i-1
        const window = [];
        for (let k = i - 1; k >= 0 && window.length < 63; k--) {
          if (r[k] !== null) window.push(r[k]);
        }
        if (window.length < 63) return 0; // not enough history → weight 0
        // sample stdev
        const mean = window.reduce((a, v) => a + v, 0) / window.length;
        const variance = window.reduce((a, v) => a + (v - mean) ** 2, 0) / (window.length - 1);
        const sd = Math.sqrt(variance);
        return sd > 0 ? 1 / sd : 0;
      });
      const denom = invVols.reduce((a, v) => a + v, 0);
      const newWeights = denom > 0
        ? invVols.map(v => v / denom)
        : new Array(K).fill(1 / K);

      // Combiner turnover cost: 2bps × Σ|Δw_j|
      const turnover = newWeights.reduce((a, w, j) => a + Math.abs(w - weights[j]), 0);
      const combinerCost = (COMBINER_TURNOVER_BPS / 10000) * turnover * costMultiplier;

      // Compute sleeve portfolio return for day i using NEW weights
      let r = 0;
      for (let j = 0; j < K; j++) {
        const sr = sleeveReturns[j][i] !== null ? sleeveReturns[j][i] : 0;
        r += newWeights[j] * sr;
      }
      combined[i] = r - combinerCost;
      weights = newWeights;
      continue;
    }

    // Non-rebalance day: use current weights
    let r = 0;
    for (let j = 0; j < K; j++) {
      const sr = sleeveReturns[j][i] !== null ? sleeveReturns[j][i] : 0;
      r += weights[j] * sr;
    }
    combined[i] = r;
  }

  return combined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  await validateStrategy({
    family: 'ensemble',
    strategyId: 'strategy-ensemble-WF-OOS',
    script: 'scripts/backtests/validate-strategy-ensemble.js',
    description:
      'Portfolio ensemble of three FIXED-RULE sleeves: ' +
      '(A) vol-targeted SOXX/GLD champion (mixW=0.5, targetVol=0.12), ' +
      '(B) trend volrank-23 (breadth universe, rankBy=volAdjusted, DEPLOYED params), ' +
      '(C) calendar SPY (FOMC 2-day window + turn-of-month window). ' +
      'Sleeves are frozen at deployed specs; only the combiner weighting varies across 4 candidates. ' +
      'Mechanism: breadth across uncorrelated mechanisms — squared IRs add (Grinold).',
    universe: FULL_UNIVERSE,
    controlUniverse: FULL_UNIVERSE,
    benchmarkSymbol: 'SPY',
    start: START,
    faithfulness: {
      status: 'not_run',
      note: 'research — ensemble/calendar cores not yet shared with a live plugin',
    },
    buildCandidates: ({ dates, series, bars, costMultiplier }) => {
      // Build all three sleeves (cost-multiplier passed through to each)
      const sleeveAReturns = buildSleeveA(bars, dates, costMultiplier);
      const sleeveBReturns = buildSleeveB({ dates, series, bars }, costMultiplier);
      const sleeveCBuilder = buildSleeveC(dates, costMultiplier);
      const sleeveCReturns = sleeveCBuilder(series);

      const sleeveMap = {
        A: sleeveAReturns,
        B: sleeveBReturns,
        C: sleeveCReturns,
      };

      return GRID.map(({ sleeveSet, weighting }) => {
        const selectedReturns = sleeveSet.map(id => sleeveMap[id]);
        const combined = buildCombinerReturns(dates, selectedReturns, weighting, costMultiplier);
        return {
          params: { sleeveSet, weighting },
          returns: combined,
        };
      });
    },
    notes: [
      'Sleeves frozen at deployed specs; only the combiner (weighting scheme) is selected walk-forward. Mechanism is breadth (Grinold): uncorrelated return streams aggregate squared IRs.',
      'Sleeve A (vol-targeted SOXX/GLD champion): mixW=0.5, targetVol=0.12, volWindow=20, 5bps overlay turnover cost; scalar from @keo/quant-core volTargetMixCore (same as validate-vol-target-mix.js champion).',
      'Sleeve B (trend volrank-23): DEPLOYED trend params with rankBy=volAdjusted on 23-ETF breadth universe (18 base + GLD/SLV/TLT/IEF/DBC); certified trendCore decision shared with live plugin.',
      'Sleeve C (calendar SPY): hold SPY during (i) 3-day FOMC window (entry−2 to announcement) and (ii) turn-of-month (second-to-last of month through 3rd of new month); windows merge; flat (0%) otherwise; bpsPerSide(SPY)/1e4 × costMultiplier each entry and exit day.',
      'Combiner grid (4): sleeves {A,B} or {A,B,C} × weighting {equal, invVol63}. invVol63 rebalances monthly using trailing 63-day stdev; sleeves with <63 obs get weight 0.',
      'Combiner turnover cost: 2bps × Σ|Δw_j| × costMultiplier on invVol63 rebalance days.',
      'FOMC dates: 83 scheduled decision days 2016-01 through 2026-07 from Federal Reserve official calendars; no emergency/unscheduled sessions (2020 March meeting cancelled — COVID).',
      'No lookahead: combiner weights at day i use data through i-1; FOMC calendar is pre-scheduled (known in advance); sleeve decisions are inherited from their frozen deployed specs (all no-lookahead certified).',
    ],
    extraReport: {
      grid: GRID,
      sleeveSpecs: {
        A: { type: 'vol-target', symbols: ['SOXX', 'GLD'], mixW: 0.5, targetVol: 0.12, volWindow: VOL_WINDOW, costBps: SLEEVE_A_COST_BPS },
        B: { type: 'trend-breadth', universe: 'TREND_BREADTH_UNIVERSE (23 ETFs)', params: { ...DEPLOYED, rankBy: 'volAdjusted' } },
        C: { type: 'calendar-SPY', mechanisms: ['FOMC-2day', 'turn-of-month'], costBpsPerSide: bpsPerSide('SPY') },
      },
      combinerCostBps: COMBINER_TURNOVER_BPS,
      fomcDateCount: FOMC_DATES.size, // 83 (2020 March cancelled; no emergency sessions)
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
