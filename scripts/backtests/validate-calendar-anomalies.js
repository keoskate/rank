#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-calendar-anomalies.js
//
// Five-gate validation of the calendar-anomaly composite strategy:
//   (i)  Pre-FOMC drift window: enter at close of (announcement day − 2 trading
//        days), exit at close of the announcement day.  Source: Lucca & Moench
//        (2015) "The Pre-FOMC Announcement Drift", Journal of Finance — the 24h
//        excess return documented pre-2012 persists post-publication (documented
//        in multiple replications through 2022+).
//
//   (ii) Turn-of-Month (TOM) window (optional): enter at close of the calendar
//        month's second-to-last trading day, exit at close of the 3rd trading
//        day of the new month.  Source: Ariel (1987) + Ogden (1990); effect
//        documented across decades and markets.
//
//   Overlaps merge: if both windows are active on the same day, stay long
//   through both (treat as one uninterrupted position).
//
//   Cash (0%) on all other days.
//
// Cost model (bpsPerSide from transactionCost.js):
//   Charged on ENTRY DAY (enter at close → cost applies to the close return of
//   the entry day itself, treated as a friction on the day position is opened)
//   and EXIT DAY (exit at close).  Entry day and exit day costs are independent
//   so overlapping windows can share a leg at no extra cost — tracked by a
//   simple "position already open" flag.
//
// Pre-registered grid (4, immutable):
//   asset ∈ {SPY, QQQ} × windows ∈ {'fomc', 'fomc+tom'}
//
// Run:
//   node scripts/backtests/validate-calendar-anomalies.js

require('dotenv').config();
const { validateStrategy } = require('./lib/validateStrategy');
const { bpsPerSide } = require('../../server/risk/transactionCost');

// ---------------------------------------------------------------------------
// FOMC ANNOUNCEMENT DATES — scheduled 2-day meeting final days only.
// Source: Federal Reserve Board official calendar and historical pages:
//   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
//   https://www.federalreserve.gov/monetarypolicy/fomchistorical20XX.htm
//   (fetched 2026-07-22)
//
// EXCLUDED: unscheduled / emergency meetings (e.g. 2020-03-02, 2020-03-15,
//   2019-10-04 conference call).  NOTE: 2020 had only 7 scheduled meetings;
//   the March 17-18 session was formally cancelled and replaced by emergency
//   actions — that is why there is no March 2020 date below.
//
// SANITY GATES (abort if violated):
//   75-90 total dates for 2016-01..2026-07-22
//   all weekdays
//   strictly increasing
//   7-9 per full calendar year
// ---------------------------------------------------------------------------
const FOMC_DATES = [
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
  // 2020 (7 — March meeting cancelled; two emergency meetings excluded)
  '2020-01-29', '2020-04-29', '2020-06-10', '2020-07-29',
  '2020-09-16', '2020-11-05', '2020-12-16',
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
  // 2026 through 2026-07-22 (4 completed; Jul 28-29 not yet held)
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
];

// ---------------------------------------------------------------------------
// Sanity checks on FOMC_DATES — abort early if violated
// ---------------------------------------------------------------------------
function runFomcSanityChecks(dates) {
  // 1. Total count in [75, 90]
  if (dates.length < 75 || dates.length > 90) {
    throw new Error(
      `FOMC sanity FAIL: expected 75-90 dates, got ${dates.length}`
    );
  }

  // 2. All dates are weekdays (0=Sun, 6=Sat in JS Date)
  for (const d of dates) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) {
      throw new Error(`FOMC sanity FAIL: ${d} is a weekend (DOW=${dow})`);
    }
  }

  // 3. Strictly increasing
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] <= dates[i - 1]) {
      throw new Error(
        `FOMC sanity FAIL: dates not strictly increasing at index ${i}: ${dates[i - 1]} >= ${dates[i]}`
      );
    }
  }

  // 4. Per full-year count in [7, 9]
  const byYear = {};
  for (const d of dates) {
    const y = d.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
  }
  const fullYears = ['2016', '2017', '2018', '2019', '2020', '2021',
    '2022', '2023', '2024', '2025'];
  for (const y of fullYears) {
    const n = byYear[y] || 0;
    if (n < 7 || n > 9) {
      throw new Error(
        `FOMC sanity FAIL: year ${y} has ${n} meetings (expected 7-9)`
      );
    }
  }

  console.log(
    `[fomc] sanity OK: ${dates.length} dates, ` +
    `years ${Object.keys(byYear).join(', ')} ` +
    `(counts: ${Object.entries(byYear).map(([y, n]) => `${y}:${n}`).join(' ')})`
  );
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/**
 * Build per-date window membership arrays from the master trading calendar.
 *
 * Returns:
 *   fomcWindow[i] = true if date[i] is in a pre-FOMC window
 *     (from i_entry = announcementIdx-2 through i_exit = announcementIdx,
 *      inclusive — both the entry day and exit day are "in window")
 *   tomWindow[i]  = true if date[i] is in a TOM window
 *     (second-to-last trading day of the prev month through 3rd trading day
 *      of the new month, inclusive)
 *
 * @param {string[]} dates
 * @returns {{ fomcWindow: boolean[], tomWindow: boolean[] }}
 */
function buildWindows(dates) {
  const n = dates.length;
  const fomcWindow = new Array(n).fill(false);
  const tomWindow = new Array(n).fill(false);

  // Build index
  const dateIndex = new Map(dates.map((d, i) => [d, i]));

  // --- FOMC windows ---
  // For each announcement date that falls in the calendar, mark indices
  // [announcementIdx - 2 .. announcementIdx] (clipped to [0, n-1]).
  for (const annDate of FOMC_DATES) {
    const annIdx = dateIndex.get(annDate);
    if (annIdx == null) continue; // announcement date not in this calendar slice
    const entryIdx = Math.max(0, annIdx - 2);
    for (let i = entryIdx; i <= annIdx; i++) {
      fomcWindow[i] = true;
    }
  }

  // --- TOM windows ---
  // For each pair of consecutive months in the calendar:
  //   entry = second-to-last trading day of month M
  //   exit  = 3rd trading day of month M+1
  // We identify month boundaries by looking for a date[i] and date[i+1] where
  // the month changes (date[i].slice(0,7) !== date[i+1].slice(0,7)).
  // Then:
  //   The last trading day of month M is at the boundary index i.
  //   Second-to-last = i - 1.
  //   First trading day of month M+1 = i + 1.
  //   Third trading day of month M+1 = i + 3.
  for (let i = 0; i < n - 1; i++) {
    const curMonth = dates[i].slice(0, 7);
    const nextMonth = dates[i + 1].slice(0, 7);
    if (curMonth !== nextMonth) {
      // i is the LAST trading day of curMonth
      // i+1 is the FIRST trading day of nextMonth
      const entryIdx = i - 1; // second-to-last of month M
      const exitIdx = i + 3;  // 3rd trading day of month M+1

      const clampedEntry = Math.max(0, entryIdx);
      const clampedExit = Math.min(n - 1, exitIdx);
      for (let j = clampedEntry; j <= clampedExit; j++) {
        tomWindow[j] = true;
      }
    }
  }

  return { fomcWindow, tomWindow };
}

// ---------------------------------------------------------------------------
// Pre-registered grid (immutable)
// ---------------------------------------------------------------------------
const GRID = [
  { asset: 'SPY', windows: 'fomc' },
  { asset: 'SPY', windows: 'fomc+tom' },
  { asset: 'QQQ', windows: 'fomc' },
  { asset: 'QQQ', windows: 'fomc+tom' },
];

// ---------------------------------------------------------------------------
// buildCandidates — called by validateStrategy at 1x and 2x cost
// ---------------------------------------------------------------------------
function buildCandidates({ dates, series, costMultiplier }) {
  // Precompute windows once (they are calendar-derived, not cost-dependent)
  const { fomcWindow, tomWindow } = buildWindows(dates);

  // Combined window (fomc+tom)
  const fomcTomWindow = fomcWindow.map((f, i) => f || tomWindow[i]);

  // Count in-market days for reporting
  const fomcDays = fomcWindow.filter(Boolean).length;
  const tomDays = tomWindow.filter(Boolean).length;
  const fomcTomDays = fomcTomWindow.filter(Boolean).length;
  const totalDays = dates.length;

  console.log(
    `[calendar] in-market fractions: FOMC=${fomcDays}/${totalDays} (${(fomcDays / totalDays * 100).toFixed(1)}%), ` +
    `TOM=${tomDays}/${totalDays} (${(tomDays / totalDays * 100).toFixed(1)}%), ` +
    `FOMC+TOM=${fomcTomDays}/${totalDays} (${(fomcTomDays / totalDays * 100).toFixed(1)}%)`
  );

  return GRID.map(({ asset, windows }) => {
    const closes = series[asset]; // aligned closes, null where no data
    const inWindow = windows === 'fomc' ? fomcWindow : fomcTomWindow;
    const costBps = bpsPerSide(asset); // 5 bps/side for SPY/QQQ

    // Build position returns — using a self-contained closure so
    // costMultiplier is captured correctly per candidate.
    const n = dates.length;
    const rets = new Array(n).fill(null);
    let inPosition = false;

    for (let i = 1; i < n; i++) {
      const prevClose = closes[i - 1];
      const curClose = closes[i];

      if (prevClose == null || curClose == null) {
        inPosition = false;
        continue;
      }

      const grossReturn = curClose / prevClose - 1;
      const costFraction = (costBps / 10000) * costMultiplier;
      const nowInWindow = inWindow[i];

      if (!inPosition && nowInWindow) {
        // Enter: first day long — charge entry cost
        inPosition = true;
        rets[i] = grossReturn - costFraction;
      } else if (inPosition && nowInWindow) {
        // Continue holding
        rets[i] = grossReturn;
      } else if (inPosition && !nowInWindow) {
        // Exit at close of previous day — deduct exit cost from yesterday's return
        inPosition = false;
        if (rets[i - 1] !== null) {
          rets[i - 1] = rets[i - 1] - costFraction;
        }
        // Today: flat
        rets[i] = 0;
      } else {
        // Flat and not in window
        rets[i] = 0;
      }
    }

    // If still in position at the last bar, charge exit cost retroactively
    if (inPosition && n > 1 && rets[n - 1] !== null) {
      const costFraction = (costBps / 10000) * costMultiplier;
      rets[n - 1] = rets[n - 1] - costFraction;
    }

    return {
      params: { asset, windows },
      returns: rets,
    };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Run FOMC sanity checks first — abort before touching any data or ledger
  runFomcSanityChecks(FOMC_DATES);

  // Compute in-market fraction info for the notes (approximate, before full calendar)
  const approxFomcEventsPerYear = FOMC_DATES.length / 10.5; // ~2016-2026
  const approxFomcDaysPerEvent = 3; // entry + 1 mid + exit
  const approxFomcPct = (approxFomcEventsPerYear * approxFomcDaysPerEvent / 252 * 100).toFixed(0);

  await validateStrategy({
    family: 'calendar-anomaly',
    strategyId: 'fomc-tom-WF-OOS',
    script: 'scripts/backtests/validate-calendar-anomalies.js',
    description:
      'Calendar-anomaly composite: pre-FOMC drift + optional turn-of-month. ' +
      'Enter long at close of (FOMC announcement day − 2 trading days); exit at close of announcement day. ' +
      'TOM variant additionally enters at close of the month\'s second-to-last trading day ' +
      'and exits at close of the 3rd trading day of the new month. ' +
      'Overlapping windows merge (stay long). Flat all other days. ' +
      'Universe: SPY, QQQ. Grid (4): asset×windows.',
    universe: ['SPY', 'QQQ'],
    controlUniverse: ['SPY', 'QQQ'],
    benchmarkSymbol: 'SPY',
    start: '2016-01-04',

    faithfulness: {
      status: 'not_run',
      note: 'research — ensemble/calendar cores not yet shared with a live plugin',
    },

    // Walk-forward overrides: keep defaults (trainDays=756, testDays=126,
    // embargoDays=21) to align with framework conventions.

    buildCandidates,

    notes: [
      // Academic grounding
      'PRE-FOMC DRIFT: Lucca & Moench (2015) "The Pre-FOMC Announcement Drift" (J. Finance) documented a large 24h equity premium concentrated in the 24 hours before FOMC rate decisions.  Multiple post-publication replications (Ai, Bansal & Beason 2022; Cieslak, Morse & Vissing-Jorgensen 2019) confirm the pattern persists post-2012 through the 2020s, though magnitude has moderated.',
      'TURN-OF-MONTH (TOM): Ariel (1987) and Ogden (1990) documented excess returns in the last trading day of each month and first few days of the new month, attributed to institutional cash-flow timing.  The effect has been stable across decades and international markets.',
      // In-market fraction context
      `IN-MARKET FRACTION: the FOMC-only variant is invested roughly ${approxFomcPct}% of trading days (≈${approxFomcEventsPerYear.toFixed(1)} events/yr × 3 days each); FOMC+TOM adds ~5-6 days/month overlap.  The absolute Sharpe ratio (computed over ALL calendar days including flat periods) UNDERSTATES the per-deployed-day edge — it is diluted by the large fraction of zero-return flat days.  The in-market fraction is reported in extra.inMarketFractions.`,
      // Gate 3 context
      'GATE 3 BENCHMARK NOTE: comparison is against an always-invested equal-weight SPY/QQQ control on identical OOS dates.  This is a deliberately harsh test for a timing strategy — the control earns continuous equity beta while the calendar strategy earns only during specific windows.  A strategy that times correctly but has a lower absolute Sharpe than always-invested EW is NOT necessarily inferior on a risk-adjusted, per-deployed-dollar basis.  Gate 3 pass/fail should be read alongside the in-market fraction.',
      // Faithfulness note
      'FAITHFULNESS: not_run — this is a pure research validation.  No live plugin currently shares the calendar-window decision core.  The strategy cannot reach VALIDATED status until a certified live plugin exists.',
      // Cost model
      'COST MODEL: 5bps/side (bpsPerSide for SPY/QQQ from transactionCost.js) charged on entry day and exit day independently.  Entry cost deducted from the first held return; exit cost deducted retroactively from the last held return.',
    ],

    extraReport: {
      grid: GRID,
      fomcDates: { count: FOMC_DATES.length, first: FOMC_DATES[0], last: FOMC_DATES[FOMC_DATES.length - 1] },
      // inMarketFractions populated at runtime in buildCandidates console output;
      // approximate values here for the artifact:
      inMarketFractions: {
        note: 'See console output from buildCandidates for exact per-run fractions.',
        approxFomcWindowDays: `~${approxFomcPct}% of trading days`,
        approxTomWindowDays: '~5-7% of trading days (≈6 days/month boundary × 12)',
      },
      source: {
        preFomc: 'Lucca & Moench (2015) J. Finance; replicated post-publication through 2022+',
        turnOfMonth: 'Ariel (1987); Ogden (1990); stable multi-decade international effect',
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
