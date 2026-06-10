#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/monitorExecutionFaithfulness.js
//
// Execution-faithfulness monitor — ROADMAP Phase A item 2, pre-registered as
// manifest D5 (data/backtests/manifests/2026-06-10-night.json).
//
// WHAT: replays the DEPLOYED backtest spec (volrank-23: validate-trend's
// exported simulateDeployed with rankBy=volAdjusted over the 23-ETF
// universe, from 2016) and diffs what it implies against what the sim-tier
// trend-follower broker actually executed over the live window (deployment
// date 2026-06-10 onward). Reports per-day decision-match (expected vs
// actual holdings set: Jaccard + exact) and per-trade implementation
// residual in bps ((fill / backtest-close - 1) * 1e4) with p50/p95/max of
// |residual|, plus unmatched trades. Markdown goes to stdout AND to
// data/reports/execution-faithfulness-<latest-bar-date>.md.
//
// WHY: decision faithfulness is certified (certify-trend-core), but the
// engine's slot/refill/sizing mechanics and its intraday execution timing
// are only EMULATED in the backtest. This residual is the promotion-gate
// input (ROADMAP A3).
//
// HONEST CAVEATS (from the manifest):
//  - No live window exists yet at build time (spec deployed 2026-06-10);
//    until live-window fills exist this prints "no executed trades yet" and
//    exits 0 — the harness existing is the deliverable; the first real diff
//    accrues with the forward test.
//  - Bars come from lib/marketData, which clamps the end date to T-3d
//    (Alpaca free tier), so the monitor lags live by ~3 days by design.
//  - The expected book is the backtest's steady-state book (replayed from
//    2016): positions it entered before 2026-06-10 carry into the live
//    window, while the live broker's book was seeded 2026-06-03 under the
//    prior raw-rank spec. Seeding mismatches decay as trends roll over; the
//    4-week tolerance applies to the steady state.
//  - The replay calls the exported engine at costMultiplier=1, which appends
//    to the engine-invocation sidecar; the params are the already-ledgered
//    deployed spec, not a new trial (manifest D5: trials=0).
//  - The 2016-2026 OOS window backing the deployed spec was reused for spec
//    selection three times (priorArtDisclosure[1]); this monitor and data
//    arriving after 2026-06-10 are the pristine evidence streams.
//
// SESSION DATA READ (data/ai-sessions.json, inspected 2026-06-10):
//  - Top level is { <sessionId>: session, ... }. The broker is the session
//    with session.config.brokerSlug === 'trend-follower'.
//  - session.tradingLog[] — executed fills as written by
//    server/brokers/simulatedExecutor.js:
//      buys:  { tradeId, side: 'buy', symbol, quantity, price, cost,
//               confidence, reason, timestamp, simulated }
//      sells: { tradeId, side: 'sell', symbol, quantity, price, proceeds,
//               realizedPnL, realizedPct, exitReason, entryPrice,
//               holdSeconds, timestamp, simulated, partial, source }
//    Fields read here: side, symbol, quantity, price, timestamp, partial.
//  - session.portfolio.positions — a Map serialized as entries
//    [symbol, { symbol, quantity, averageCost, entryTime, ... }]; used only
//    to tie out the tradingLog replay against the engine's current book.
//  - data/broker-ledger.json is NOT used: that is the tier-change /
//    self-mutation audit log, not a trade record.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  simulateDeployed,
  DEPLOYED,
  UNIVERSE: BASE_UNIVERSE,
} = require('./backtests/validate-trend');
const {
  loadDailyBars,
  buildCalendar,
  alignCloses,
} = require('./backtests/lib/marketData');
const {
  enrichFillsWithVwap,
  summarizeAbsBps,
  writeExecutionReport,
} = require('./backtests/lib/executionBenchmark');

const START = '2016-01-04';
const LIVE_START = '2026-06-10'; // volrank-23 deployment date (manifest D5)
const BROKER_SLUG = 'trend-follower';
const DIVERSIFIERS = ['GLD', 'SLV', 'TLT', 'IEF', 'DBC'];
const UNIVERSE = [...BASE_UNIVERSE, ...DIVERSIFIERS];
const SPEC = { ...DEPLOYED, rankBy: 'volAdjusted' };

// PRE-REGISTERED A3 tolerance — manifest D5, verbatim. Do not edit.
const TOLERANCE =
  'promotion discussion requires decision-match >= 95% and median ' +
  '|residual| <= 25bps/trade over >= 4 consecutive weeks';

const SESSIONS_PATH = path.join(__dirname, '../data/ai-sessions.json');
const REPORTS_DIR = path.join(__dirname, '../data/reports');

// Engine timestamps are ISO UTC; sim fills happen during US market hours
// (13:30-21:00 UTC), where the UTC date equals the ET trading date.
const tradeDay = ts => ts.slice(0, 10);

function loadBrokerSession() {
  const all = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
  const session = Object.values(all).find(
    s => s && s.config && s.config.brokerSlug === BROKER_SLUG
  );
  if (!session) {
    throw new Error(`no session with config.brokerSlug === '${BROKER_SLUG}'`);
  }
  return session;
}

/** Normalize tradingLog into sorted fills we can replay. */
function normalizeFills(tradingLog) {
  return (tradingLog || [])
    .filter(
      t =>
        t &&
        t.symbol &&
        t.timestamp &&
        (t.side === 'buy' || t.side === 'sell') &&
        Number.isFinite(t.quantity) &&
        Number.isFinite(t.price)
    )
    .map(t => ({
      date: tradeDay(t.timestamp),
      timestamp: t.timestamp,
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      partial: !!t.partial,
    }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * End-of-day actual holdings per calendar day, replayed from ALL fills
 * (pre-window entries carry into the live window). Partial sells are
 * handled by quantity arithmetic: a symbol leaves the set at qty <= 0.
 */
function actualHoldingsByDay(fills, days) {
  const qty = new Map();
  let k = 0;
  const byDay = new Map();
  for (const d of days) {
    while (k < fills.length && fills[k].date <= d) {
      const f = fills[k++];
      const next =
        (qty.get(f.symbol) || 0) + (f.side === 'buy' ? 1 : -1) * f.quantity;
      if (next > 1e-9) qty.set(f.symbol, next);
      else qty.delete(f.symbol);
    }
    byDay.set(d, new Set(qty.keys()));
  }
  return byDay;
}

/** End-of-day expected holdings per sim day (trades execute at the close). */
function expectedHoldingsByDay(sim) {
  const byDate = new Map();
  for (const t of sim.trades) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  const held = new Set();
  const byDay = new Map();
  for (const d of sim.eqDates) {
    for (const t of byDate.get(d) || []) {
      if (t.side === 'buy') held.add(t.symbol);
      else held.delete(t.symbol);
    }
    byDay.set(d, new Set(held));
  }
  return byDay;
}

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Match trades on (date, symbol, side); duplicates pair off in order. */
function matchTrades(expected, actual) {
  const queue = new Map();
  for (const e of expected) {
    const k = `${e.date}|${e.symbol}|${e.side}`;
    if (!queue.has(k)) queue.set(k, []);
    queue.get(k).push(e);
  }
  const matched = [];
  const actualUnmatched = [];
  for (const a of actual) {
    const q = queue.get(`${a.date}|${a.symbol}|${a.side}`);
    if (q && q.length) {
      const e = q.shift();
      matched.push({
        ...a,
        backtestClose: e.price,
        residualBps: (a.price / e.price - 1) * 1e4,
      });
    } else {
      actualUnmatched.push(a);
    }
  }
  const expectedUnmatched = [...queue.values()].flat();
  return { matched, expectedUnmatched, actualUnmatched };
}

/** Linear-interpolated quantile of a sorted ascending array. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Replay all fills and diff the resulting book vs the engine's positions. */
function tieOutBook(fills, positionEntries) {
  const qty = new Map();
  for (const f of fills) {
    const next =
      (qty.get(f.symbol) || 0) + (f.side === 'buy' ? 1 : -1) * f.quantity;
    if (next > 1e-9) qty.set(f.symbol, next);
    else qty.delete(f.symbol);
  }
  const engine = new Map();
  for (const [sym, pos] of positionEntries || []) {
    if (pos && pos.quantity > 0) engine.set(sym, pos.quantity);
  }
  const diffs = [];
  for (const [sym, q] of qty) {
    const e = engine.get(sym) || 0;
    if (Math.abs(e - q) > 1e-6) {
      diffs.push(`${sym}: replayed qty ${q} vs engine ${e}`);
    }
  }
  for (const sym of engine.keys()) {
    if (!qty.has(sym)) {
      diffs.push(`${sym}: in engine book but absent from tradingLog replay`);
    }
  }
  return diffs;
}

const fmtSet = s => [...s].sort().join(', ') || '(none)';

async function main() {
  const session = loadBrokerSession();
  const fills = normalizeFills(session.tradingLog);
  const liveFills = fills.filter(f => f.date >= LIVE_START);

  console.log(
    `loading bars for ${UNIVERSE.length} symbols (${START} -> T-3d)...`
  );
  const { bars } = await loadDailyBars(UNIVERSE, { start: START, quiet: true });
  // Night-review blocker fix: refuse to compute metrics on a silently
  // shrunken universe (a failed fetch would otherwise vanish from the replay
  // AND the report while the headline still claims the 23-ETF spec).
  const missingSyms = UNIVERSE.filter(s => !bars[s] || !bars[s].length);
  if (missingSyms.length) {
    throw new Error(
      `DATA INCOMPLETE — bars missing for: ${missingSyms.join(', ')}; refusing to report metrics on a shrunken universe`
    );
  }
  // KNOWN LIMITATION (night-review blocker, REQUIRED BEFORE FIRST RESIDUAL):
  // fills are raw prices but these bars are dividend-adjusted; every ex-div
  // retroactively shifts earlier adjusted closes (~30-80bps), so per-trade
  // residuals MUST be computed against raw/split-only closes (separate
  // fetch) or frozen append-only at first sighting. No residuals exist yet
  // (no live fills); this must land before the first one is quoted.
  const dates = buildCalendar(bars);
  const series = alignCloses(bars, dates);
  const lastBarDate = dates[dates.length - 1];

  // Replay expectation: the deployed spec through the exported engine.
  const sim = simulateDeployed({ dates, series, bars }, SPEC, 1, UNIVERSE);
  const liveDates = sim.eqDates.filter(d => d >= LIVE_START);
  const expectedLive = sim.trades
    .filter(t => t.date >= LIVE_START)
    .map(t => ({
      date: t.date,
      symbol: t.symbol,
      side: t.side,
      price: t.price,
    }));

  const L = [];
  // Machine-readable payload for the A3 promotion rule — written in BOTH
  // branches so data/reports/execution-faithfulness/latest.json always
  // exists (no-fills runs report nMatched 0 and break the streak honestly).
  const jsonPayload = {
    lastBarDate,
    window: { start: LIVE_START, end: lastBarDate },
    liveDays: liveDates.length,
    decisionMatchRate: null,
    meanJaccard: null,
    nMatched: 0,
    residuals: {
      vsBacktestClose: summarizeAbsBps([]),
      vsActualClose: summarizeAbsBps([]),
      vsVwapToClose: summarizeAbsBps([]),
    },
    unmatched: { expected: expectedLive.length, actual: 0 },
    tieOutWarnings: 0,
  };
  L.push(
    '# Execution faithfulness — trend-follower (volrank-23 deployed spec)'
  );
  L.push('');
  L.push(
    `- Generated from bars through **${lastBarDate}** (lib/marketData clamps to T-3d; the monitor lags live by ~3 days by design).`
  );
  L.push(
    `- Live window: ${LIVE_START} -> ${lastBarDate} (${liveDates.length} trading days with final bars).`
  );
  L.push(
    `- Expected side: simulateDeployed (validate-trend, certified core) with rankBy=volAdjusted on the ${UNIVERSE.length}-ETF universe, replayed from ${START}.`
  );
  L.push(
    `- Actual side: session ${session.sessionId} tradingLog (engine sim fills; broker-ledger.json is the tier-change log and is not used).`
  );
  L.push('');

  if (liveFills.length === 0) {
    L.push(
      `**The live window has no executed trades yet (spec deployed ${LIVE_START}).**`
    );
    L.push('');
    L.push(
      'The harness is in place; the first real diff accrues with the forward test.'
    );
    if (expectedLive.length) {
      L.push('');
      L.push(
        `Note: the backtest replay already expects ${expectedLive.length} trade(s) in the window — these become unmatched-expected if the broker does not act:`
      );
      for (const t of expectedLive) {
        L.push(`- ${t.date} ${t.side} ${t.symbol} @ close ${t.price}`);
      }
    }
  } else {
    // ---- per-day decision match ----
    const expByDay = expectedHoldingsByDay(sim);
    const actByDay = actualHoldingsByDay(fills, liveDates);
    let exactDays = 0;
    let jSum = 0;
    L.push('## Per-day decision match (end-of-day holdings sets)');
    L.push('');
    L.push('| date | expected | actual | Jaccard | exact |');
    L.push('|---|---|---|---|---|');
    for (const d of liveDates) {
      const e = expByDay.get(d) || new Set();
      const a = actByDay.get(d) || new Set();
      const j = jaccard(e, a);
      const exact = e.size === a.size && [...e].every(x => a.has(x));
      if (exact) exactDays++;
      jSum += j;
      L.push(
        `| ${d} | ${fmtSet(e)} | ${fmtSet(a)} | ${j.toFixed(2)} | ${exact ? 'yes' : 'NO'} |`
      );
    }
    const matchRate = liveDates.length ? exactDays / liveDates.length : null;
    L.push('');
    L.push(
      matchRate == null
        ? '- decision-match: no final bars in the live window yet (bars lag T-3d); day-level comparison pending.'
        : `- decision-match (exact days / window days): ${exactDays}/${liveDates.length} = **${(matchRate * 100).toFixed(1)}%**; mean Jaccard ${(jSum / liveDates.length).toFixed(3)}`
    );
    L.push('');
    jsonPayload.decisionMatchRate = matchRate;
    jsonPayload.meanJaccard = liveDates.length ? jSum / liveDates.length : null;

    // ---- per-trade implementation residual ----
    const { matched, expectedUnmatched, actualUnmatched } = matchTrades(
      expectedLive,
      liveFills.filter(f => f.date <= lastBarDate)
    );
    const pendingFills = liveFills.filter(f => f.date > lastBarDate);
    // Enrich with RAW-minute-bar benchmarks (executionBenchmark lib): fill
    // vs actual 16:00 close and vs VWAP(fillTime→close). Raw adjustment is
    // load-bearing — fills are unadjusted live prices; the adjusted
    // backtest-close residual (kept) drifts by the dividend after ex-div.
    const enriched = matched.length ? await enrichFillsWithVwap(matched) : [];
    L.push(
      '## Per-trade implementation residual (matched on date+symbol+side)'
    );
    L.push('');
    L.push(
      "residual = (fill / benchmark - 1) * 1e4, side-signed (positive = worse than benchmark). Benchmarks: the backtest's adjusted close (decision parity), the actual raw 16:00 close, and raw VWAP(fill→close) — the execution-quality number."
    );
    L.push('');
    if (enriched.length) {
      L.push(
        '| date | symbol | side | fill | backtest close | res (bps) | actual close | res (bps) | vwap→close | res (bps) |'
      );
      L.push('|---|---|---|---|---|---|---|---|---|---|');
      for (const m of enriched) {
        const f1 = x => (x == null ? 'n/a' : x.toFixed(1));
        const f2 = x => (x == null ? 'n/a' : x.toFixed(2));
        L.push(
          `| ${m.date} | ${m.symbol} | ${m.side} | ${m.price} | ${m.backtestClose} | ${m.residualBps.toFixed(1)} | ${f2(m.actualClose)} | ${f1(m.closeResidualBps)} | ${f2(m.vwapToClose)} | ${f1(m.vwapResidualBps)} |`
        );
      }
      const sumBacktest = summarizeAbsBps(enriched.map(m => m.residualBps));
      const sumClose = summarizeAbsBps(enriched.map(m => m.closeResidualBps));
      const sumVwap = summarizeAbsBps(enriched.map(m => m.vwapResidualBps));
      const fmt = s =>
        s.n
          ? `p50 ${s.p50.toFixed(1)} / p95 ${s.p95.toFixed(1)} / max ${s.max.toFixed(1)} bps (n=${s.n})`
          : 'n/a';
      L.push('');
      L.push(`- |residual| vs backtest close: ${fmt(sumBacktest)}`);
      L.push(`- |residual| vs actual close:   ${fmt(sumClose)}`);
      L.push(`- |residual| vs VWAP(fill→close): ${fmt(sumVwap)}`);
      jsonPayload.nMatched = enriched.length;
      jsonPayload.residuals = {
        vsBacktestClose: sumBacktest,
        vsActualClose: sumClose,
        vsVwapToClose: sumVwap,
      };
    } else {
      L.push('- no matched trades in the window.');
    }
    L.push('');
    L.push('## Unmatched trades');
    L.push('');
    if (!expectedUnmatched.length && !actualUnmatched.length) {
      L.push('- none.');
    }
    for (const t of expectedUnmatched) {
      L.push(
        `- expected but not executed: ${t.date} ${t.side} ${t.symbol} @ close ${t.price}`
      );
    }
    for (const t of actualUnmatched) {
      L.push(
        `- executed but not expected: ${t.date} ${t.side} ${t.symbol} @ ${t.price}`
      );
    }
    for (const t of pendingFills) {
      L.push(
        `- executed, awaiting final bars (after ${lastBarDate}): ${t.date} ${t.side} ${t.symbol} @ ${t.price}`
      );
    }
    L.push('');
    L.push('## Notes');
    L.push('');
    L.push(
      "- The expected book is the backtest's steady-state book (replayed from 2016); the live book was seeded 2026-06-03 under the prior raw-rank spec. Seeding mismatches decay as trends roll over; the 4-week tolerance applies to the steady state."
    );
    const tieOut = tieOutBook(
      fills,
      session.portfolio && session.portfolio.positions
    );
    jsonPayload.unmatched = {
      expected: expectedUnmatched.length,
      actual: actualUnmatched.length,
    };
    jsonPayload.tieOutWarnings = tieOut.length;
    L.push(
      tieOut.length
        ? `- tie-out WARNING — tradingLog replay does not reproduce the engine book (log truncation or non-sim fills?): ${tieOut.join('; ')}`
        : "- tie-out OK: tradingLog replay reproduces the engine's current portfolio.positions."
    );
    L.push(
      '- Reused-OOS disclosure (manifest priorArtDisclosure[1]): the 2016-2026 window backing the deployed spec was used for spec selection three times; this monitor and post-2026-06-10 data are the pristine streams.'
    );
  }

  L.push('');
  L.push('---');
  L.push(
    `PRE-REGISTERED tolerance (manifest 2026-06-10-night D5 / ROADMAP A2-A3): ${TOLERANCE}.`
  );
  L.push('');

  const md = L.join('\n');
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(
    REPORTS_DIR,
    `execution-faithfulness-${lastBarDate}.md`
  );
  fs.writeFileSync(reportPath, md + '\n');
  console.log('\n' + md);
  console.log(`\nreport written: ${reportPath}`);

  // Machine-readable report (dated + latest.json) — the A3 promotion-rule
  // input. consecutiveWeeksInTolerance is computed against the dated
  // history by the lib (pre-registered D5 tolerance).
  const jsonReport = writeExecutionReport(jsonPayload);
  console.log(
    `json report: data/reports/execution-faithfulness/${lastBarDate}.json + latest.json — consecutiveWeeksInTolerance=${jsonReport.consecutiveWeeksInTolerance}`
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
