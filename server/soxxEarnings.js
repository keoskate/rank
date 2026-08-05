/**
 * SOXX earnings aggregation — next-upcoming + most-recent-past (with the actual
 * 1-day reaction + EPS beat/miss) for each SOXX constituent, from Unusual Whales.
 *
 * Extracted from the /api/soxx/earnings route so the same computation feeds both
 * that route AND the AI analyst's market-context pack (server/semiMarketContext.js).
 * Cached 1h at the module level (the UW client also caches ~6h per symbol).
 */

const unusualWhalesClient = require('./unusualWhalesClient');
const alpacaClient = require('./alpacaClient');
const { SOXX_SYMS, SOXX_TOP } = require('./soxxConstituents');

const CACHE_MS = 60 * 60 * 1000; // 1h
let _cache = { at: 0, data: null };
let _enrichedCache = { at: 0, data: null };

// Static approximate market caps ($B) keyed by symbol — no live shares-outstanding
// source, so these are context-only and shown with a "~".
const MCAP_B = Object.fromEntries(SOXX_TOP.map(c => [c.sym, c.mcapB]));

const num = v => (v != null && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);

/**
 * @param {boolean} forceRefresh - bypass the 1h module cache
 * @returns {Promise<{upcoming: Array, past: Array, asOf: string}>}
 */
async function computeSoxxEarnings(forceRefresh = false) {
  if (!forceRefresh && _cache.data && Date.now() - _cache.at < CACHE_MS) {
    return _cache.data;
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [];
  const past = [];
  const batch = 6;

  for (let i = 0; i < SOXX_SYMS.length; i += batch) {
    const syms = SOXX_SYMS.slice(i, i + batch);
    const rowsArr = await Promise.all(
      syms.map(s => unusualWhalesClient.getEarnings(s).catch(() => []))
    );
    syms.forEach((sym, j) => {
      const rows = rowsArr[j] || [];
      const future = rows
        .filter(r => r.report_date && r.report_date >= today)
        .sort((a, b) => a.report_date.localeCompare(b.report_date));
      if (future[0]) {
        upcoming.push({
          sym,
          date: future[0].report_date,
          time: future[0].report_time || 'unknown',
          expectedMovePct: num(future[0].expected_move_perc) != null ? num(future[0].expected_move_perc) * 100 : null,
          estimated: !!future[0].is_date_estimate,
        });
      }
      const done = rows
        .filter(r => r.report_date && r.report_date < today && r.post_earnings_move_1d != null)
        .sort((a, b) => b.report_date.localeCompare(a.report_date));
      if (done[0]) {
        const r = done[0];
        const eps = num(r.actual_eps);
        const est = num(r.street_mean_est);
        past.push({
          sym,
          date: r.report_date,
          reaction1d: num(r.post_earnings_move_1d) != null ? num(r.post_earnings_move_1d) * 100 : null,
          // 1-week follow-through after the report (UW), to see if the reaction held.
          postMove1w: num(r.post_earnings_move_1w) != null ? num(r.post_earnings_move_1w) * 100 : null,
          eps,
          estimate: est,
          beat: eps != null && est != null ? eps >= est : null,
          expectedMovePct: num(r.expected_move_perc) != null ? num(r.expected_move_perc) * 100 : null,
        });
      }
    });
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  past.sort((a, b) => b.date.localeCompare(a.date));
  const data = { upcoming, past, asOf: new Date().toISOString() };
  _cache = { at: Date.now(), data };
  return data;
}

const DAY_MS = 86400000;
const RUNUP_BARS = 21; // ~1 trading month
const iso = ms => new Date(ms).toISOString().slice(0, 10);

// Best-effort daily bars [start, end] (YYYY-MM-DD), oldest first; [] on failure.
async function dailyBars(symbol, start, end) {
  try {
    const bars = await alpacaClient.getBars(symbol, '1Day', start, end, 80);
    return Array.isArray(bars) ? bars.filter(b => Number.isFinite(b.close)) : [];
  } catch {
    return [];
  }
}

const pctChange = (from, to) =>
  Number.isFinite(from) && Number.isFinite(to) && from > 0 ? ((to - from) / from) * 100 : null;

/**
 * Enriched earnings for the DISPLAY route only (kept off the AI-context path so
 * that stays lean). Per row, fetches one daily-bars window and derives:
 *   - upcoming: current approx mcap + trailing ~1-month run-up INTO the print
 *   - past: close on report date (`priceThen`), the ~1-month run-up INTO the
 *     report, and approx mcap. (1-week follow-through comes from UW in the lean fn.)
 * Cached 1h.
 */
async function computeSoxxEarningsEnriched(forceRefresh = false) {
  if (!forceRefresh && _enrichedCache.data && Date.now() - _enrichedCache.at < CACHE_MS) {
    return _enrichedCache.data;
  }
  const base = await computeSoxxEarnings(forceRefresh);
  const batch = 6;

  // Upcoming — trailing ~1-month run-up so far (window up to today).
  const nowMs = Date.now();
  const upcoming = [];
  for (let i = 0; i < base.upcoming.length; i += batch) {
    const chunk = base.upcoming.slice(i, i + batch);
    const barsArr = await Promise.all(
      chunk.map(r => dailyBars(r.sym, iso(nowMs - 45 * DAY_MS), iso(nowMs + DAY_MS)))
    );
    chunk.forEach((r, j) => {
      const b = barsArr[j];
      let runupSoFar = null;
      if (b.length > 1) {
        const last = b[b.length - 1].close;
        const prior = b[Math.max(0, b.length - 1 - RUNUP_BARS)].close;
        runupSoFar = pctChange(prior, last);
      }
      upcoming.push({ ...r, mcapB: MCAP_B[r.sym] ?? null, runupSoFar });
    });
  }

  // Past — report-date close + ~1-month run-up into the report.
  const past = [];
  for (let i = 0; i < base.past.length; i += batch) {
    const chunk = base.past.slice(i, i + batch);
    const barsArr = await Promise.all(
      chunk.map(r => {
        const t = new Date(`${r.date}T00:00:00Z`).getTime();
        return dailyBars(r.sym, iso(t - 45 * DAY_MS), iso(t + 4 * DAY_MS));
      })
    );
    chunk.forEach((r, j) => {
      const b = barsArr[j];
      let priceThen = null;
      let runupPct = null;
      if (b.length) {
        const idx = b.findIndex(x => new Date(x.timestamp).toISOString().slice(0, 10) === r.date);
        const rptIdx = idx >= 0 ? idx : b.length - 1;
        priceThen = b[rptIdx].close;
        runupPct = pctChange(b[Math.max(0, rptIdx - RUNUP_BARS)].close, priceThen);
      }
      past.push({ ...r, mcapB: MCAP_B[r.sym] ?? null, priceThen, runupPct });
    });
  }

  const data = { upcoming, past, asOf: base.asOf };
  _enrichedCache = { at: Date.now(), data };
  return data;
}

module.exports = { computeSoxxEarnings, computeSoxxEarningsEnriched };
