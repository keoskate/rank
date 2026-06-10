#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-volume-profile-events.js
//
// Volume-profile event trials VP1 + VP2 through the B6 event-study harness.
// PRE-REGISTERED: manifest data/backtests/manifests/2026-06-10-avwap-vp-events.json
// (VP1-value-area-acceptance: 2 trials, VP2-naked-poc-revisit: 2 trials) +
// data/reports/event-study-gates-preregistration-2026-06-10.md. Committed
// BEFORE the first run — do not run otherwise.
//
// VP1 — value-area acceptance: EVENT at day d when close(d) > VAH_d AND
//   close(d-1) > VAH_{d-1} AND close(d-2) <= VAH_{d-2}, where VAH_k is the
//   value-area high of the profile over the 20 sessions ENDING k-1 (strictly
//   prior data — no look-ahead). Exit grid: t5, t10 (pure time exits).
// VP2 — naked-POC revisit: EVENT at day d when the symbol is in a certified
//   uptrend (trendCore, deployed defaults), an untested prior-session POC p
//   (quant-core nakedPocs, age <= 60 sessions) sits below price, and
//   0 < close(d) - p <= 0.25 * ATR14(d). Exit grid: t5, tp6sl3h10.
//
// Profiles: quant-core buildVolumeProfile (40 bins, 70% VA) on RTH minute
// bars via lib/marketData loadMinuteBars (Alpaca, 'all'). Window 2018-01-02+
// (pre-registered; full 2016 minute history costs hours of prefetch for
// marginal gate-3 benefit). Symbols are processed one at a time — minute
// series are released after the per-day profile rows are extracted.
//
// EXPECTED OUTCOME (stated up front, per the manifest priors): LOW. The
// deliverable is the honest verdict on practitioner lore, not a pass.
//
// Usage:
//   node scripts/backtests/validate-volume-profile-events.js            # both
//   node scripts/backtests/validate-volume-profile-events.js --trial VP1
//   node scripts/backtests/validate-volume-profile-events.js --start 2018-01-02

require('dotenv').config();
const { trendCore, volumeProfile } = require('@keo/quant-core');
const { loadDailyBars, loadMinuteBars, etInfo } = require('./lib/marketData');
const { validateEventStrategy } = require('./lib/eventStudy');

const argv = process.argv.slice(2);
const argOf = (k, dflt) => {
  const i = argv.indexOf(`--${k}`);
  return i > -1 ? argv[i + 1] : dflt;
};
const START = argOf('start', '2018-01-02');
const ONLY = argOf('trial', null);

const PROFILE_WINDOW = 20; // sessions per VP1 profile
const NAKED_MAX_AGE = 60; // sessions a POC stays eligible (VP2)
const ATR_LEN = 14;

const VP1_GRID = [
  { id: 't5', tpPct: 999, slPct: 999, maxHoldDays: 5 },
  { id: 't10', tpPct: 999, slPct: 999, maxHoldDays: 10 },
];
const VP2_GRID = [
  { id: 't5', tpPct: 999, slPct: 999, maxHoldDays: 5 },
  { id: 'tp6sl3h10', tpPct: 6, slPct: 3, maxHoldDays: 10 },
];

/** Wilder-free simple ATR(14) series aligned to daily bars (null warmup). */
function atrSeries(bars, len = ATR_LEN) {
  const out = new Array(bars.length).fill(null);
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].close;
    trs.push(
      Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc))
    );
    if (trs.length >= len) {
      const w = trs.slice(-len);
      out[i] = w.reduce((a, x) => a + x, 0) / len;
    }
  }
  return out;
}

/**
 * Per-session profile rows for one symbol from its minute bars:
 * [{date, pocPrice, vah, val}] — one row per RTH session.
 */
function sessionProfiles(minuteBars) {
  const bySession = new Map();
  for (const b of minuteBars) {
    const d = etInfo(b.t).date;
    if (!bySession.has(d)) bySession.set(d, []);
    bySession.get(d).push(b);
  }
  const rows = [];
  for (const [date, bars] of bySession) {
    const p = volumeProfile.buildVolumeProfile(bars);
    if (p.ok) rows.push({ date, pocPrice: p.pocPrice, vah: p.vah, val: p.val });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, bySession };
}

/** Rolling VAH_k over the PROFILE_WINDOW sessions ending k-1 (no look-ahead). */
function rollingVah(sessionDates, bySession) {
  const vahByDate = new Map();
  for (let k = PROFILE_WINDOW; k < sessionDates.length; k++) {
    const windowBars = [];
    for (let j = k - PROFILE_WINDOW; j < k; j++) {
      windowBars.push(...(bySession.get(sessionDates[j]) || []));
    }
    const p = volumeProfile.buildVolumeProfile(windowBars);
    if (p.ok) vahByDate.set(sessionDates[k], p.vah);
  }
  return vahByDate;
}

async function collectEvents(universe) {
  const vp1 = [];
  const vp2 = [];
  const { bars: daily } = await loadDailyBars(universe, {
    start: START,
    quiet: true,
  });

  for (const sym of universe) {
    const dBars = daily[sym];
    if (!dBars || dBars.length < 260) {
      console.log(`  ${sym}: insufficient daily history, skipped`);
      continue;
    }
    console.log(`  ${sym}: loading minute bars (cache-sharded)…`);
    const { bars: mBars } = await loadMinuteBars([sym], {
      start: START,
      quiet: true,
    });
    const minuteBars = mBars[sym] || [];
    if (!minuteBars.length) {
      console.log(`  ${sym}: no minute bars, skipped`);
      continue;
    }
    const { rows: sessions, bySession } = sessionProfiles(minuteBars);
    const sessionDates = sessions.map(s => s.date);
    const vahByDate = rollingVah(sessionDates, bySession);

    const dailyByDate = new Map(dBars.map((b, i) => [b.date, i]));
    const closes = dBars.map(b => b.close);
    const atr = atrSeries(dBars);
    // session rows joined with the daily session range (for nakedPocs)
    const pocDays = sessions
      .map(s => {
        const di = dailyByDate.get(s.date);
        return di == null
          ? null
          : {
              date: s.date,
              pocPrice: s.pocPrice,
              low: dBars[di].low,
              high: dBars[di].high,
            };
      })
      .filter(Boolean);
    const pocIdxByDate = new Map(pocDays.map((r, i) => [r.date, i]));

    const aboveVah = d => {
      const vah = vahByDate.get(d);
      const di = dailyByDate.get(d);
      if (vah == null || di == null) return null;
      return dBars[di].close > vah;
    };

    for (let k = 2; k < sessionDates.length; k++) {
      const d = sessionDates[k];
      const di = dailyByDate.get(d);
      if (di == null) continue;

      // VP1: cross above value and hold two consecutive closes
      const a0 = aboveVah(d);
      const a1 = aboveVah(sessionDates[k - 1]);
      const a2 = aboveVah(sessionDates[k - 2]);
      if (a0 === true && a1 === true && a2 === false) {
        vp1.push({ symbol: sym, date: d, meta: { vah: vahByDate.get(d) } });
      }

      // VP2: uptrend + naked POC just below price
      const pi = pocIdxByDate.get(d);
      if (pi != null && pi > 0 && atr[di] != null) {
        const st = trendCore.evaluateTrend(closes.slice(0, di + 1));
        if (st.ok && st.uptrend) {
          const windowStart = Math.max(0, pi - NAKED_MAX_AGE);
          const naked = volumeProfile.nakedPocs(
            pocDays.slice(windowStart, pi + 1)
          );
          const close = dBars[di].close;
          const hit = naked.find(
            n => close - n.pocPrice > 0 && close - n.pocPrice <= 0.25 * atr[di]
          );
          if (hit) {
            vp2.push({
              symbol: sym,
              date: d,
              meta: { poc: hit.pocPrice, age: hit.age, atr: atr[di] },
            });
          }
        }
      }
    }
  }
  return { vp1, vp2 };
}

async function main() {
  // Lazy import: validate-trend.js is the overnight program's workspace —
  // we only read its exported UNIVERSE constant at run time.
  const { UNIVERSE } = require('./validate-trend');
  const universe = [
    ...new Set([...UNIVERSE, 'GLD', 'SLV', 'TLT', 'IEF', 'DBC']),
  ];
  console.log(
    `VP event collection over ${universe.length} symbols from ${START} (minute-bar profiles)…`
  );
  const { vp1, vp2 } = await collectEvents(universe);
  console.log(`VP1 events: ${vp1.length}; VP2 events: ${vp2.length}`);

  const runs = [];
  if (ONLY !== 'VP2' && vp1.length) {
    runs.push(
      await validateEventStrategy({
        family: 'volume-profile',
        strategyId: 'vp1-value-area-acceptance',
        script: 'scripts/backtests/validate-volume-profile-events.js',
        description:
          'VP1: close crosses above the prior-20-session value-area high and holds 2 consecutive closes (minute-bar profiles, 40 bins, 70% VA).',
        events: vp1,
        exitPolicies: VP1_GRID,
        start: START,
        notes: [
          'Pre-registered: manifest 2026-06-10-avwap-vp-events.json (VP1, 2 trials).',
          'The "close back below VAH" exit is NOT testable in harness v1 — deferred per manifest, not approximated.',
        ],
      })
    );
  }
  if (ONLY !== 'VP1' && vp2.length) {
    runs.push(
      await validateEventStrategy({
        family: 'volume-profile',
        strategyId: 'vp2-naked-poc-revisit',
        script: 'scripts/backtests/validate-volume-profile-events.js',
        description:
          'VP2: certified uptrend + price within 0.25×ATR14 above an untested prior-session POC (age <= 60 sessions).',
        events: vp2,
        exitPolicies: VP2_GRID,
        start: START,
        notes: [
          'Pre-registered: manifest 2026-06-10-avwap-vp-events.json (VP2, 2 trials).',
          'POC-relative stop (POC − 0.5×ATR) is per-event-variable, not representable in harness v1 — deferred per manifest.',
        ],
      })
    );
  }

  for (const r of runs) {
    console.log(`\n${r.artifact.strategy.id}: ${r.verdict}`);
    for (const [g, v] of Object.entries(r.gates)) {
      console.log(`  ${g}: ${v.status} — ${v.note}`);
    }
    console.log(`  run: ${r.runId}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
