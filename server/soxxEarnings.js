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

// Daily close on (or just after) a given YYYY-MM-DD — "what the stock was when
// it reported". Best-effort; returns null on any failure.
async function closeOnDate(symbol, date) {
  try {
    const end = new Date(new Date(`${date}T00:00:00Z`).getTime() + 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    const bars = await alpacaClient.getBars(symbol, '1Day', date, end, 10);
    if (!Array.isArray(bars) || !bars.length) return null;
    const onDay = bars.find(
      b => new Date(b.timestamp).toISOString().slice(0, 10) === date
    );
    const bar = onDay || bars[0];
    return Number.isFinite(bar.close) ? bar.close : null;
  } catch {
    return null;
  }
}

/**
 * Enriched earnings for the DISPLAY route only (kept off the AI-context path so
 * that stays lean): adds approximate market cap to every row and, for past
 * reports, the stock's close on the report date (`priceThen`). Cached 1h.
 */
async function computeSoxxEarningsEnriched(forceRefresh = false) {
  if (!forceRefresh && _enrichedCache.data && Date.now() - _enrichedCache.at < CACHE_MS) {
    return _enrichedCache.data;
  }
  const base = await computeSoxxEarnings(forceRefresh);

  const upcoming = base.upcoming.map(r => ({ ...r, mcapB: MCAP_B[r.sym] ?? null }));

  // Fetch the report-date close for each past row in small batches.
  const past = [];
  const batch = 6;
  for (let i = 0; i < base.past.length; i += batch) {
    const chunk = base.past.slice(i, i + batch);
    const prices = await Promise.all(chunk.map(r => closeOnDate(r.sym, r.date)));
    chunk.forEach((r, j) => past.push({ ...r, mcapB: MCAP_B[r.sym] ?? null, priceThen: prices[j] }));
  }

  const data = { upcoming, past, asOf: base.asOf };
  _enrichedCache = { at: Date.now(), data };
  return data;
}

module.exports = { computeSoxxEarnings, computeSoxxEarningsEnriched };
