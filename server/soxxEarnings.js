/**
 * SOXX earnings aggregation — next-upcoming + most-recent-past (with the actual
 * 1-day reaction + EPS beat/miss) for each SOXX constituent, from Unusual Whales.
 *
 * Extracted from the /api/soxx/earnings route so the same computation feeds both
 * that route AND the AI analyst's market-context pack (server/semiMarketContext.js).
 * Cached 1h at the module level (the UW client also caches ~6h per symbol).
 */

const unusualWhalesClient = require('./unusualWhalesClient');
const { SOXX_SYMS } = require('./soxxConstituents');

const CACHE_MS = 60 * 60 * 1000; // 1h
let _cache = { at: 0, data: null };

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

module.exports = { computeSoxxEarnings };
