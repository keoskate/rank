// server/darkPoolArchive.js — Point-in-time forward capture of dark-pool prints.
//
// UW's /api/darkpool/{symbol} returns only the most recent ~500 prints with no
// historical access — the 2026-06-01 audit (data/reports/audits/dark-pool.md)
// showed a single near-close fetch on a liquid name reaches back only to
// ~15:40 ET. The only way to get an honest, backtestable dataset is to capture
// intraday snapshots going forward and merge them. Every day not archived is
// evidence lost; the B6 event-study harness needs >= 60 archived days before
// it can issue a verdict.
//
// Layout (data/darkpool-archive/):
//   YYYY-MM-DD/<SYMBOL>.json   merged day file:
//     { symbol, date,
//       captures: [{ at, count, capped, oldestExecutedAt, newestExecutedAt }],
//       coverage: { firstExecutedAt, lastExecutedAt, uniquePrints, cappedFetches },
//       prints: [ raw UW rows, deduped, sorted by executed_at asc ] }
//   YYYY-MM-DD/_meta.json      { universe, captureCount, finalizedAt }
//   YYYY-MM-DD/_market.jsonl   one trimmed /api/darkpool/recent snapshot per
//                              capture — lets the B6 study reconstruct which
//                              tickers the scanner would have surfaced.
//
// Prints are stored VERBATIM (tracking_id, sale conditions, NBBO fields kept)
// so future classifier variants can be replayed against the same raw data.
//
// Driven by a 15-min interval in server/index.js during market hours, plus a
// manual CLI / cron fallback: node scripts/capture-darkpool.js [--finalize]

const fs = require('fs');
const path = require('path');
const uw = require('./unusualWhalesClient');

const DIR = path.resolve(__dirname, '..', 'data', 'darkpool-archive');

// UW returns at most ~500 prints per fetch; a fetch at that count means the
// window was truncated and earlier prints are unrecoverable from this capture.
const CAP_COUNT = 500;

// Hard cap on symbols per capture: ~20 sequential requests every 15 min is
// trivial against the 120 req/min budget shared with brokers + scanners.
const MAX_SYMBOLS = 20;

// Always-archive base set (volume-hunter's watchlist). Scanner + session
// watchlists are merged on top per capture.
const BASE_SYMBOLS = [
  'NVDA',
  'AMD',
  'TSLA',
  'AAPL',
  'META',
  'MSFT',
  'AMZN',
  'PLTR',
];

const SLEEP_BETWEEN_FETCHES_MS = 150;

const etDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** ET calendar date of an ISO timestamp, or null if unparseable. */
function etDateOf(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/** Stable identity for a print row; tracking_id when present, else a composite. */
function dedupeKey(p) {
  return (
    p.tracking_id || `${p.executed_at || ''}|${p.price || ''}|${p.size || ''}`
  );
}

/**
 * Merge two print arrays (existing day file + fresh fetch), dedupe by
 * dedupeKey, sort ascending by executed_at (rows without a timestamp sort
 * last, in insertion order). Pure.
 */
function mergePrints(existing, incoming) {
  const byKey = new Map();
  for (const p of existing || []) byKey.set(dedupeKey(p), p);
  for (const p of incoming || []) {
    const k = dedupeKey(p);
    if (!byKey.has(k)) byKey.set(k, p);
  }
  return [...byKey.values()].sort((a, b) => {
    const ta = a.executed_at ? Date.parse(a.executed_at) : Infinity;
    const tb = b.executed_at ? Date.parse(b.executed_at) : Infinity;
    return ta === tb ? 0 : ta - tb;
  });
}

/** Coverage summary over merged prints + capture log. Pure. */
function coverageOf(prints, captures) {
  const stamped = (prints || []).filter(p => p.executed_at);
  return {
    firstExecutedAt: stamped.length ? stamped[0].executed_at : null,
    lastExecutedAt: stamped.length
      ? stamped[stamped.length - 1].executed_at
      : null,
    uniquePrints: (prints || []).length,
    cappedFetches: (captures || []).filter(c => c.capped).length,
  };
}

/**
 * Per-fetch metadata for the capture log. `rawCount` is the size of the raw
 * UW response BEFORE date filtering — cap detection must see it, because a
 * 500-row fetch is truncated even if some rows belong to a prior day. Pure.
 */
function captureMetaOf(keptPrints, at, rawCount = (keptPrints || []).length) {
  const stamps = (keptPrints || [])
    .map(p => p.executed_at)
    .filter(Boolean)
    .sort();
  return {
    at,
    count: rawCount,
    kept: (keptPrints || []).length,
    capped: rawCount >= CAP_COUNT,
    oldestExecutedAt: stamps[0] || null,
    newestExecutedAt: stamps[stamps.length - 1] || null,
  };
}

function _readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic write (tmp + rename) so a crash mid-write never corrupts a day file.
function _writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

/**
 * Universe for one capture: base list ∪ live dark-pool session watchlists
 * (passed in by the server) ∪ today's top scanner tickers. Capped at
 * MAX_SYMBOLS with base symbols guaranteed a slot.
 */
async function resolveUniverse(extraSymbols = []) {
  let scanner = [];
  try {
    scanner = await uw.getTopDarkPoolTickers({ max: 12 });
  } catch {
    /* scanner optional */
  }
  const seen = new Set();
  const ordered = [];
  for (const s of [...BASE_SYMBOLS, ...extraSymbols, ...scanner]) {
    const sym = String(s || '').toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    ordered.push(sym);
    if (ordered.length >= MAX_SYMBOLS) break;
  }
  return { symbols: ordered, base: BASE_SYMBOLS, extra: extraSymbols, scanner };
}

/**
 * Capture one snapshot for the resolved universe and merge it into today's
 * archive. Never throws — returns a small status object.
 */
async function captureOnce(extraSymbols = []) {
  if (!uw.isConfigured()) return { captured: 0, skipped: 'no-uw-key' };
  const date = etDate();
  const at = new Date().toISOString();
  const dayDir = path.join(DIR, date);
  const universe = await resolveUniverse(extraSymbols);

  let captured = 0;
  const cappedSymbols = [];
  for (const symbol of universe.symbols) {
    try {
      // ttlMs=0 bypasses the 60s endpoint cache — we want a fresh fetch.
      const raw = await uw.getDarkPoolPrints(symbol, 0);
      if (!Array.isArray(raw) || raw.length === 0) continue;
      // Keep only prints executed on this ET date — the endpoint returns the
      // most recent ~500 regardless of day, so an early-morning or cron run
      // would otherwise pollute today's folder with yesterday's tape.
      const prints = raw.filter(p => etDateOf(p.executed_at) === date);
      if (prints.length === 0) continue;
      const file = path.join(dayDir, `${symbol}.json`);
      const existing = _readJson(file, {
        symbol,
        date,
        captures: [],
        coverage: {},
        prints: [],
      });
      const meta = captureMetaOf(prints, at, raw.length);
      existing.captures.push(meta);
      existing.prints = mergePrints(existing.prints, prints);
      existing.coverage = coverageOf(existing.prints, existing.captures);
      _writeJsonAtomic(file, existing);
      captured++;
      if (meta.capped) cappedSymbols.push(symbol);
    } catch {
      /* skip symbol on transient error */
    }
    await sleep(SLEEP_BETWEEN_FETCHES_MS);
  }

  // Market-wide snapshot (1 request) for point-in-time scanner reconstruction.
  // Only when something captured — otherwise an off-hours cron run would
  // create a day folder holding nothing but a stale market snapshot.
  try {
    if (captured === 0) throw new Error('skip');
    const res = await uw.makeRequest('/api/darkpool/recent', 0);
    const rows = Array.isArray(res.data) ? res.data : [];
    if (rows.length) {
      const trimmed = rows.map(r => ({
        ticker: r.ticker,
        price: r.price,
        size: r.size,
        premium: r.premium,
        executed_at: r.executed_at,
      }));
      fs.mkdirSync(dayDir, { recursive: true });
      fs.appendFileSync(
        path.join(dayDir, '_market.jsonl'),
        JSON.stringify({ at, rows: trimmed }) + '\n'
      );
    }
  } catch {
    /* market snapshot is optional */
  }

  if (captured > 0) {
    const metaFile = path.join(dayDir, '_meta.json');
    const meta = _readJson(metaFile, {
      date,
      universe: {},
      captureCount: 0,
      finalizedAt: null,
    });
    meta.universe = {
      base: universe.base,
      extra: universe.extra,
      scanner: universe.scanner,
    };
    meta.captureCount += 1;
    _writeJsonAtomic(metaFile, meta);
  }

  return { captured, date, symbols: universe.symbols, cappedSymbols, at };
}

/**
 * Mark a day's archive finalized (idempotent — safe to call repeatedly from
 * the post-close poll). No data is mutated; this just stamps _meta.json so
 * downstream consumers know no further captures are expected.
 */
async function finalizeDay(dateStr = etDate()) {
  const metaFile = path.join(DIR, dateStr, '_meta.json');
  if (!fs.existsSync(path.join(DIR, dateStr)))
    return { finalized: false, skipped: 'no-archive', date: dateStr };
  const meta = _readJson(metaFile, {
    date: dateStr,
    universe: {},
    captureCount: 0,
    finalizedAt: null,
  });
  if (meta.finalizedAt)
    return { finalized: false, skipped: 'already-finalized', date: dateStr };
  meta.finalizedAt = new Date().toISOString();
  _writeJsonAtomic(metaFile, meta);
  return { finalized: true, date: dateStr };
}

/** Count archived (capture-bearing) days — the B6 progress denominator is 60. */
function archivedDayCount() {
  try {
    return fs.readdirSync(DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .length;
  } catch {
    return 0;
  }
}

module.exports = {
  captureOnce,
  finalizeDay,
  resolveUniverse,
  archivedDayCount,
  // pure helpers (exported for tests)
  mergePrints,
  dedupeKey,
  coverageOf,
  captureMetaOf,
  etDateOf,
  BASE_SYMBOLS,
  CAP_COUNT,
  DIR,
};
