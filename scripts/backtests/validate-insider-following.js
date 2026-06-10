#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-insider-following.js
//
// First consumer of the B6 event-study harness (lib/eventStudy.js).
// PRE-REGISTERED: manifest data/backtests/manifests/2026-06-10-avwap-vp-events.json
// (experiment INS-insider-exit-grid, 6 trials) + gate mapping in
// data/reports/event-study-gates-preregistration-2026-06-10.md. Both are
// committed BEFORE this script's first run — do not run otherwise.
//
// Events: UW officer/director open-market purchases (transaction_code 'P'),
// notional >= $500k, filing lag <= 21 days — the same sourcing the 2026-06-01
// audit verified as look-ahead-free — but forward prices via lib/marketData
// loadDailyBars (Alpaca, ONE data path; the audited script's Polygon
// dependency silently floored at 2021-06, ROADMAP D10).
//
// HONEST CAVEATS:
//  - UW's insider feed is recent-only; the sample is whatever it still
//    serves. Gate 3 needs >= 60 events and >= 20 test trades and will report
//    not_run if the feed has aged out. Verdict cannot exceed UNVALIDATED
//    regardless (gate 2: no certified insider core exists).
//  - The audit informally previewed parts of this exit grid on overlapping
//    events (manifest priorArtDisclosure[0]) — results carry that note.
//
// Usage: node scripts/backtests/validate-insider-following.js [--min 500000]

require('dotenv').config();
const uw = require('../../server/unusualWhalesClient');
const { validateEventStrategy } = require('./lib/eventStudy');

const MIN_NOTIONAL = (() => {
  const i = process.argv.indexOf('--min');
  return i > -1 ? Number(process.argv[i + 1]) : 500000;
})();

// The registered 6-policy grid (each point = 1 ledger trial).
const EXIT_GRID = [
  { id: 'tp8sl4h10', tpPct: 8, slPct: 4, maxHoldDays: 10 }, // live broker baseline (audited mis-tuned)
  { id: 'tp10sl4h10', tpPct: 10, slPct: 4, maxHoldDays: 10 },
  { id: 'tp10sl8h10', tpPct: 10, slPct: 8, maxHoldDays: 10 },
  { id: 'tp15sl8h10', tpPct: 15, slPct: 8, maxHoldDays: 10 },
  { id: 'tp15sl8h5', tpPct: 15, slPct: 8, maxHoldDays: 5 },
  { id: 't10', tpPct: 999, slPct: 999, maxHoldDays: 10 }, // pure time exit
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Source qualifying purchase events from the UW insider feed (newest-first
 * pages). Same filters the audit verified: code P, officer/director,
 * notional floor, filing-lag <= 21d, dedupe by (ticker, date, reporter).
 */
async function sourcePurchaseEvents(minNotional, maxPages = 40) {
  const events = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    let res;
    try {
      res = await uw.makeRequest(
        `/api/insider/transactions?limit=500&page=${page}`,
        5 * 60 * 1000
      );
    } catch (e) {
      console.error('feed error:', e.message);
      break;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const r of rows) {
      if (r.transaction_code !== 'P') continue;
      const amount = Number(r.amount);
      const price = parseFloat(r.price) || 0;
      if (!(amount > 0) || !(r.is_officer || r.is_director)) continue;
      const notional = Math.abs(amount) * price;
      if (notional < minNotional) continue;
      const fdate = (r.filing_date || '').slice(0, 10);
      const tdate = (r.transaction_date || '').slice(0, 10);
      const date = fdate || tdate; // public-information date
      if (!date || !r.ticker) continue;
      let lag = null;
      if (fdate && tdate) {
        lag = Math.round((Date.parse(fdate) - Date.parse(tdate)) / 864e5);
      }
      if (lag != null && lag > 21) continue;
      const key = `${r.ticker}|${date}|${r.reporter_cik}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        symbol: r.ticker,
        date,
        meta: { notional: Math.round(notional), lag },
      });
    }
    if (!res.has_more) break;
    await sleep(300);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

async function main() {
  if (!uw.isConfigured()) {
    throw new Error('UNUSUAL_WHALES_API_KEY not configured');
  }
  console.log(
    `Sourcing officer/director purchases >= $${MIN_NOTIONAL.toLocaleString()} (filing lag <= 21d)…`
  );
  const events = await sourcePurchaseEvents(MIN_NOTIONAL);
  console.log(`${events.length} qualifying events`);
  if (!events.length) {
    console.log('No events — the UW feed window has aged out. Nothing run.');
    return;
  }

  // Price window: ~6 weeks before the first event (for integrity context)
  // through the clamped present (exits need forward bars).
  const start = new Date(Date.parse(events[0].date) - 45 * 864e5)
    .toISOString()
    .slice(0, 10);

  const result = await validateEventStrategy({
    family: 'insider-following',
    strategyId: 'insider-eventstudy-v1',
    script: 'scripts/backtests/validate-insider-following.js',
    description:
      'Officer/director open-market purchases >= $500k via the B6 event-study harness (registered 6-policy exit grid).',
    sourceKey: 'insider-following',
    events,
    exitPolicies: EXIT_GRID,
    start,
    notes: [
      'Pre-registered: manifest 2026-06-10-avwap-vp-events.json (INS-insider-exit-grid).',
      'Reused-data note: the 2026-06-01 audit previewed parts of this grid on overlapping events (manifest priorArtDisclosure[0]).',
      'UW insider feed is recent-only — the event sample cannot be extended into history.',
    ],
  });

  console.log(`\nverdict: ${result.verdict}`);
  for (const [g, v] of Object.entries(result.gates)) {
    console.log(`  ${g}: ${v.status} — ${v.note}`);
  }
  console.log(`chosen policy: ${result.chosen.id}`);
  console.log(`run: ${result.runId} (npm run backtest:view ${result.runId})`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
