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
const { KEO_FUND_SYMS } = require('./keoFundHoldings');

// Earnings universe = SOXX constituents ∪ Keo Fund holdings (deduped). Each row
// carries `inSoxx` so the panel can dot the semiconductor (SOXX) members.
const SOXX_SET = new Set(SOXX_SYMS);
const EARNINGS_SYMS = [...new Set([...SOXX_SYMS, ...KEO_FUND_SYMS])];
// Per-symbol last-known-good rows — carried forward when a fetch fails, so a major
// name (e.g. NVDA) never silently vanishes on a transient UW error + gets cached out.
const _bySym = new Map(); // sym -> { upcoming: row|null, past: row|null }

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
  const batch = 6;

  for (let i = 0; i < EARNINGS_SYMS.length; i += batch) {
    const syms = EARNINGS_SYMS.slice(i, i + batch);
    const rowsArr = await Promise.all(
      // null = fetch FAILED (transient); [] = succeeded with no earnings.
      syms.map(s => unusualWhalesClient.getEarnings(s).then(r => r || []).catch(() => null))
    );
    syms.forEach((sym, j) => {
      const rows = rowsArr[j];
      if (rows === null) return; // failed → keep last-known-good (carry forward)
      const inSoxx = SOXX_SET.has(sym);
      const future = rows
        .filter(r => r.report_date && r.report_date >= today)
        .sort((a, b) => a.report_date.localeCompare(b.report_date));
      const done = rows
        .filter(r => r.report_date && r.report_date < today && r.post_earnings_move_1d != null)
        .sort((a, b) => b.report_date.localeCompare(a.report_date));

      const entry = { upcoming: null, past: null };
      if (future[0]) {
        entry.upcoming = {
          sym,
          inSoxx,
          date: future[0].report_date,
          time: future[0].report_time || 'unknown',
          expectedMovePct: num(future[0].expected_move_perc) != null ? num(future[0].expected_move_perc) * 100 : null,
          estimated: !!future[0].is_date_estimate,
        };
      }
      if (done[0]) {
        const r = done[0];
        const eps = num(r.actual_eps);
        const est = num(r.street_mean_est);
        entry.past = {
          sym,
          inSoxx,
          date: r.report_date,
          reaction1d: num(r.post_earnings_move_1d) != null ? num(r.post_earnings_move_1d) * 100 : null,
          // 1-week follow-through after the report (UW), to see if the reaction held.
          postMove1w: num(r.post_earnings_move_1w) != null ? num(r.post_earnings_move_1w) * 100 : null,
          eps,
          estimate: est,
          beat: eps != null && est != null ? eps >= est : null,
          expectedMovePct: num(r.expected_move_perc) != null ? num(r.expected_move_perc) * 100 : null,
        };
      }
      _bySym.set(sym, entry);
    });
  }

  // Flatten from the carried-forward per-symbol map.
  const upcoming = [];
  const past = [];
  for (const entry of _bySym.values()) {
    if (entry.upcoming) upcoming.push(entry.upcoming);
    if (entry.past) past.push(entry.past);
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

// Evenly downsample an array to at most n points (for a compact sparkline).
const downsample = (arr, n = 16) => {
  if (!Array.isArray(arr) || arr.length <= n) return arr || [];
  const out = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
};

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
      let spark = [];
      if (b.length > 1) {
        const closes = b.map(x => x.close);
        const last = closes[closes.length - 1];
        const prior = closes[Math.max(0, closes.length - 1 - RUNUP_BARS)];
        runupSoFar = pctChange(prior, last);
        spark = downsample(closes.slice(-RUNUP_BARS - 1));
      }
      upcoming.push({ ...r, mcapB: MCAP_B[r.sym] ?? null, runupSoFar, spark });
    });
  }

  // Past — report-date close + ~1-month run-up into the report.
  const past = [];
  for (let i = 0; i < base.past.length; i += batch) {
    const chunk = base.past.slice(i, i + batch);
    const barsArr = await Promise.all(
      chunk.map(r => {
        const t = new Date(`${r.date}T00:00:00Z`).getTime();
        // widen the window to +18d so we can also read the ~10 trading days AFTER
        return dailyBars(r.sym, iso(t - 45 * DAY_MS), iso(t + 18 * DAY_MS));
      })
    );
    chunk.forEach((r, j) => {
      const b = barsArr[j];
      let priceThen = null;
      let runupPct = null;
      let spark = [];
      let after = []; // post-earnings daily path (up to 10 trading days after)
      if (b.length) {
        const idx = b.findIndex(x => new Date(x.timestamp).toISOString().slice(0, 10) === r.date);
        const rptIdx = idx >= 0 ? idx : b.length - 1;
        priceThen = b[rptIdx].close;
        const startIdx = Math.max(0, rptIdx - RUNUP_BARS);
        runupPct = pctChange(b[startIdx].close, priceThen);
        // series is the run-up INTO the report (window start → report date)
        spark = downsample(b.slice(startIdx, rptIdx + 1).map(x => x.close));
        for (let k = rptIdx + 1; k < b.length && after.length < 10; k++) {
          const p = pctChange(b[k - 1].close, b[k].close);
          if (p != null) after.push({ date: new Date(b[k].timestamp).toISOString().slice(0, 10), pct: p });
        }
      }
      past.push({ ...r, mcapB: MCAP_B[r.sym] ?? null, priceThen, runupPct, spark, after });
    });
  }

  const data = { upcoming, past, asOf: base.asOf };
  _enrichedCache = { at: Date.now(), data };
  return data;
}

module.exports = { computeSoxxEarnings, computeSoxxEarningsEnriched };
