#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-overnight.js
//
// Five-gate validation of the OVERNIGHT DRIFT anomaly ("Night Moves: Is the
// Overnight Drift the Grandmother of All Market Anomalies?" — Haghani,
// Ragulin, Dewey, Elm Wealth 2022) and its refinements:
//
//   - baseline: long close -> next open, every night
//   - intraday control: long open -> close (the paper says this leg is dead)
//   - weekday variants: hold only the night INTO a given weekday (the paper
//     finds strong day-of-week structure)
//   - trend-filtered: hold overnight only while the symbol is in an uptrend
//     per the CERTIFIED shared trend core (SMA200 + 12-1 momentum, decided
//     on completed closes with the entry price as the realtime proxy — the
//     same semantics as the live plugin)
//
// Universe: SPY, QQQ (index), SOXX (semis), SOXL (3x semis — leveraged ETF,
// 15bps/side, i.e. 30bps per nightly round trip; if the drift can't pay that
// toll the gates will say so).
//
// Cost reality: the all-nights variants do ~250 round trips/year (~25%/yr
// drag at 5bps/side; ~75%/yr on SOXL). Weekday variants ~50/yr. The gross
// decomposition (the science) lives in extra.decomposition; the gates judge
// the NET strategies. Days not held earn 0 (cash) so Sharpe is comparable
// across holding frequencies.
//
// HONESTY NOTE ON GRID SIZE: 32 candidates is a fishing expedition by
// design — every one is recorded in the trials ledger, which raises the
// deflated-Sharpe bar for this run AND every future strategy. That is the
// correct price of fishing.

require('dotenv').config();
const { bpsPerSide } = require('../../server/risk/transactionCost');
const { equityStats, trendCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');

const START = '2016-01-04';
const UNIVERSE = ['SPY', 'QQQ', 'SOXX', 'SOXL'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']; // night INTO this day
const WARMUP = 260; // uniform start so all variants race on the same window

function weekdayOf(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 1=Mon..5=Fri
}

/**
 * Daily returns for one variant, aligned to the master calendar.
 * Unheld days (after warmup) earn 0 — the strategy sits in cash.
 *
 * variant:
 *   leg: 'overnight' | 'intraday'
 *   weekday: null | 1..5  — hold only the night into that weekday
 *   trendFiltered: bool   — hold only when trendCore says uptrend, decided
 *     on closes completed through t-2 with close[t-1] (the entry print) as
 *     the realtime price proxy, mirroring the live plugin's override
 */
function variantReturns(bars, dates, sym, variant, costMultiplier) {
  const series = bars[sym];
  const byDate = new Map(series.map((b, k) => [b.date, k]));
  const closes = series.map(b => b.close);
  const out = new Array(dates.length).fill(null);
  const cost = ((bpsPerSide(sym) * 2) / 10000) * costMultiplier;

  for (let i = 0; i < dates.length; i++) {
    if (i < WARMUP) continue;
    const k = byDate.get(dates[i]);
    if (k == null || k === 0) continue; // symbol didn't trade today/yesterday
    out[i] = 0; // default: in cash

    if (variant.leg === 'intraday') {
      out[i] = series[k].close / series[k].open - 1 - cost;
      continue;
    }

    // overnight: bought at close[k-1], sold at open[k]
    if (variant.weekday != null && weekdayOf(dates[i]) !== variant.weekday) {
      continue;
    }
    if (variant.trendFiltered) {
      if (k < 2) continue;
      const st = trendCore.evaluateTrend(closes.slice(0, k - 1), {
        price: series[k - 1].close, // entry print as realtime proxy
      });
      if (!st.ok || !st.uptrend) continue;
    }
    out[i] = series[k].open / series[k - 1].close - 1 - cost;
  }
  return out;
}

function statsOf(dates, returns) {
  const eq = [];
  const ds = [];
  let e = 1;
  for (let i = 0; i < dates.length; i++) {
    if (returns[i] == null) continue;
    e *= 1 + returns[i];
    eq.push(e);
    ds.push(dates[i]);
  }
  return equityStats.statsFromEquity(ds, eq);
}

/** Mean bps per HELD night + count — the readable unit for weekday structure. */
function nightStats(returns) {
  const held = returns.filter(r => r != null && r !== 0);
  const mean = held.length ? held.reduce((a, b) => a + b, 0) / held.length : 0;
  return { nights: held.length, meanBpsPerNight: Math.round(mean * 1e6) / 100 };
}

function buildCandidates({ dates, bars, costMultiplier }) {
  const candidates = [];
  for (const sym of UNIVERSE) {
    if (!bars[sym]) continue;
    const push = (variant, label) =>
      candidates.push({
        params: { symbol: sym, ...label },
        returns: variantReturns(bars, dates, sym, variant, costMultiplier),
      });
    push({ leg: 'overnight' }, { leg: 'overnight' });
    push({ leg: 'intraday' }, { leg: 'intraday' });
    push({ leg: 'overnight', trendFiltered: true }, { leg: 'overnight', filter: 'trend' });
    for (let d = 1; d <= 5; d++) {
      push({ leg: 'overnight', weekday: d }, { leg: 'overnight', night: `into-${WEEKDAYS[d - 1]}` });
    }
  }
  return candidates;
}

async function main() {
  let decomposition = null;

  await validateStrategy({
    family: 'overnight-drift',
    strategyId: 'overnight-variants-WF-OOS',
    script: 'scripts/backtests/validate-overnight.js',
    description:
      'Overnight drift (Haghani/Ragulin/Dewey 2022) with weekday and certified-trend-filter variants on SPY/QQQ/SOXX/SOXL, NET of per-night round-trip costs. Headline equity is walk-forward out-of-sample.',
    universe: UNIVERSE,
    start: START,
    buildCandidates: ctx => {
      if (ctx.costMultiplier === 1 && !decomposition) {
        // The science, separated from the trade: GROSS stats per variant.
        decomposition = {};
        for (const sym of UNIVERSE) {
          if (!ctx.bars[sym]) continue;
          const gross = v => variantReturns(ctx.bars, ctx.dates, sym, v, 0);
          const entry = {
            grossOvernight: {
              ...statsOf(ctx.dates, gross({ leg: 'overnight' })),
              ...nightStats(gross({ leg: 'overnight' })),
            },
            grossIntraday: statsOf(ctx.dates, gross({ leg: 'intraday' })),
            grossOvernightTrendFiltered: {
              ...statsOf(ctx.dates, gross({ leg: 'overnight', trendFiltered: true })),
              ...nightStats(gross({ leg: 'overnight', trendFiltered: true })),
            },
            byWeekday: {},
          };
          for (let d = 1; d <= 5; d++) {
            const rets = gross({ leg: 'overnight', weekday: d });
            entry.byWeekday[WEEKDAYS[d - 1]] = {
              ...nightStats(rets),
              sharpe: statsOf(ctx.dates, rets)?.sharpe ?? null,
            };
          }
          decomposition[sym] = entry;
          const wk = WEEKDAYS.map(
            w => `${w} ${entry.byWeekday[w].meanBpsPerNight}bps`
          ).join('  ');
          console.log(
            `[decomposition] ${sym}: overnight ${(entry.grossOvernight.cagr * 100).toFixed(1)}%/yr (Sharpe ${entry.grossOvernight.sharpe.toFixed(2)}) | ` +
              `intraday ${(entry.grossIntraday.cagr * 100).toFixed(1)}%/yr | trend-filtered overnight ${(entry.grossOvernightTrendFiltered.cagr * 100).toFixed(1)}%/yr ` +
              `(${entry.grossOvernightTrendFiltered.nights} nights)`
          );
          console.log(`               per-night gross: ${wk}`);
        }
      }
      return buildCandidates(ctx);
    },
    benchmarkSymbol: 'SPY',
    notes: [
      'Claim under test: overnight drift as a TRADEABLE strategy, including weekday and certified-trend-filter refinements.',
      'Cost model: bpsPerSide round trip per held night (5bps/side index ETFs, 15bps/side SOXL). Gross decomposition (the science) is in extra.decomposition.',
      'Trend filter decides on closes through t-2 with the entry print as realtime proxy — same semantics as the certified live trendCore wrapper.',
      '32-candidate grid = deliberate fishing; all recorded as ledger trials, which raises the deflation bar accordingly.',
      'Faithfulness not_run: no live plugin executes close/open auction pairs (needs MOC/MOO order support).',
    ],
    extraReport: {
      get decomposition() {
        return decomposition;
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
