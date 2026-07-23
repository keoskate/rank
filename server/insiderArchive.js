// server/insiderArchive.js — Point-in-time forward capture of insider filings.
//
// UW's /api/insider/transactions feed is newest-first with NO date-range
// parameter; pagination (10 pages x 500 rows) reaches back only ~3 weeks at
// typical Form 4 volumes (2026-07-22 data inventory + the insider-eventstudy-v1
// post-mortem: a "9-week" study actually drew every event from ~3 weeks).
// There is no local store, so every unarchived day beyond that horizon is
// evidence lost forever. Same forward-capture discipline as darkPoolArchive —
// but filings are low-volume and the feed is deep enough that ONE capture per
// day (any time) loses nothing.
//
// Layout (data/insider-archive/):
//   YYYY-MM-DD.json    one file per FILING date:
//     { date, updatedAt, captures: [{ at, added }], rows: [raw UW rows,
//       deduped, verbatim] }
//   _meta.json         { firstCapturedAt, lastCapturedAt, captureCount }
//
// Rows are stored VERBATIM (all UW fields kept) so future signal variants
// (officer-only, size floors, cluster-buys) can be replayed against the same
// raw records. No filtering at capture time — filters belong to strategies.
//
// Entry points: scripts/capture-insider.js (CLI / cron). Deliberately NOT
// wired into server/index.js yet — that file has concurrent in-flight work;
// a daily CLI run (or the floor script) fully covers the ~3-week feed depth.

const fs = require('fs');
const path = require('path');
const uw = require('./unusualWhalesClient');

const DIR = path.resolve(__dirname, '..', 'data', 'insider-archive');
const MAX_PAGES = 10; // feed hard-stops ~here (~5,000 rows ≈ 3 weeks)
const PAGE_SLEEP_MS = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Stable identity for a filing row (feed has no tracking id). */
function dedupeKey(r) {
  return [
    r.ticker || '',
    r.filing_date || '',
    r.transaction_date || '',
    r.owner_name || r.owner || '',
    r.transaction_code || '',
    r.amount || '',
    r.price || '',
  ].join('|');
}

function filingDateOf(r) {
  const d = (r.filing_date || r.transaction_date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function loadDayFile(date) {
  const p = path.join(DIR, `${date}.json`);
  if (!fs.existsSync(p)) {
    return { date, updatedAt: null, captures: [], rows: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { date, updatedAt: null, captures: [], rows: [] };
  }
}

/**
 * Pull the full paginated feed once and merge every row into its
 * filing-date shard. Idempotent: re-running only adds unseen rows.
 * @returns {{pagesFetched:number, rowsSeen:number, rowsAdded:number,
 *            dates:string[], oldestFiling:string|null, newestFiling:string|null}}
 */
async function captureOnce() {
  if (!uw.isConfigured()) {
    return { error: 'UW not configured', rowsSeen: 0, rowsAdded: 0 };
  }
  fs.mkdirSync(DIR, { recursive: true });

  const rowsByDate = new Map();
  let pagesFetched = 0;
  let rowsSeen = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await uw.makeRequest(
      `/api/insider/transactions?limit=500&page=${page}`,
      60 * 1000
    );
    const rows = Array.isArray(res && res.data) ? res.data : [];
    pagesFetched++;
    if (!rows.length) break;
    for (const r of rows) {
      rowsSeen++;
      const d = filingDateOf(r);
      if (!d) continue;
      if (!rowsByDate.has(d)) rowsByDate.set(d, []);
      rowsByDate.get(d).push(r);
    }
    if (!res.has_more) break;
    await sleep(PAGE_SLEEP_MS);
  }

  const now = new Date().toISOString();
  let rowsAdded = 0;
  const dates = [...rowsByDate.keys()].sort();
  for (const date of dates) {
    const file = loadDayFile(date);
    const seen = new Set(file.rows.map(dedupeKey));
    let added = 0;
    for (const r of rowsByDate.get(date)) {
      const k = dedupeKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      file.rows.push(r);
      added++;
    }
    if (added > 0 || !file.updatedAt) {
      file.updatedAt = now;
      file.captures.push({ at: now, added });
      fs.writeFileSync(
        path.join(DIR, `${date}.json`),
        JSON.stringify(file, null, 2)
      );
    }
    rowsAdded += added;
  }

  // meta
  const metaPath = path.join(DIR, '_meta.json');
  let meta = { firstCapturedAt: now, captureCount: 0 };
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (e) {
      /* rebuild */
    }
  }
  meta.lastCapturedAt = now;
  meta.captureCount = (meta.captureCount || 0) + 1;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return {
    pagesFetched,
    rowsSeen,
    rowsAdded,
    dates,
    oldestFiling: dates[0] || null,
    newestFiling: dates[dates.length - 1] || null,
  };
}

/** Archive summary for status displays / the future event study. */
function archiveStats() {
  if (!fs.existsSync(DIR)) return { days: 0, rows: 0, first: null, last: null };
  const files = fs
    .readdirSync(DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  let rows = 0;
  for (const f of files) {
    try {
      rows += JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).rows
        .length;
    } catch (e) {
      /* skip corrupt */
    }
  }
  return {
    days: files.length,
    rows,
    first: files[0] ? files[0].slice(0, 10) : null,
    last: files.length ? files[files.length - 1].slice(0, 10) : null,
  };
}

module.exports = { captureOnce, archiveStats, DIR };
