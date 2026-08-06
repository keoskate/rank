/**
 * SOXX sub-sector rotation OVER TIME — per-sub-sector cumulative performance over
 * ~30 trading sessions, plus SPY as the broad-tech benchmark. Where SoxxInternals
 * shows today's snapshot, this shows the trajectory: which pocket of semis is being
 * bought vs sold, and whether the group is leading or lagging the market (rotation
 * cycles / "is memory cycling out").
 *
 * The pure core (computeSectorSeries) is also the raw material for the predictor's
 * rotation features (server/soxxFeatures.js), so live == what the model learns on.
 * Cached ~2h (daily data).
 */

const alpacaClient = require('./alpacaClient');
const { SOXX_TOP, GROUP_ORDER } = require('./soxxConstituents');

const DAY_MS = 86400000;
const WINDOW_SESSIONS = 30; // trading days shown
const LOOKBACK_DAYS = 48; // calendar days to cover ~30 sessions + slack
const CACHE_MS = 2 * 60 * 60 * 1000;
const BENCH = 'SPY';

let _cache = { at: 0, data: null };

const iso = ms => new Date(ms).toISOString().slice(0, 10);
const barDate = b => new Date(b.timestamp).toISOString().slice(0, 10);

async function dailyBars(symbol, start, end) {
  try {
    const bars = await alpacaClient.getBars(symbol, '1Day', start, end, 80);
    return Array.isArray(bars) ? bars.filter(b => Number.isFinite(b.close)) : [];
  } catch {
    return [];
  }
}

/**
 * Pure core. Given close-by-date maps per symbol ({ sym: { 'YYYY-MM-DD': close } })
 * and an ordered `dates` calendar, compute each sub-sector's weighted cumulative-
 * return trajectory (rebased to 0 at the window start) + the benchmark's, and each
 * sector's final return and lead/lag vs the benchmark.
 *
 * @returns {{ benchmark: {cum, series}, sectors: Array<{name, members, cum, vsSpy, series}> }}
 */
function computeSectorSeries(closesBySym, dates, benchSym = BENCH) {
  // per-symbol daily simple returns aligned to `dates` (length dates.length-1)
  const retBySym = {};
  for (const sym of Object.keys(closesBySym)) {
    const m = closesBySym[sym];
    const rets = [];
    for (let i = 1; i < dates.length; i++) {
      const c0 = m[dates[i - 1]];
      const c1 = m[dates[i]];
      rets.push(Number.isFinite(c0) && Number.isFinite(c1) && c0 > 0 ? (c1 - c0) / c0 : null);
    }
    retBySym[sym] = rets;
  }

  // cumulative %-return trajectory from a per-day return series (nulls = flat)
  const cumSeries = rets => {
    let g = 1;
    const series = [{ date: dates[0], pct: 0 }];
    for (let d = 0; d < dates.length - 1; d++) {
      g *= 1 + (rets[d] == null ? 0 : rets[d]);
      series.push({ date: dates[d + 1], pct: (g - 1) * 100 });
    }
    return { cum: (g - 1) * 100, series };
  };

  const present = new Set(SOXX_TOP.map(c => c.group));
  const order = GROUP_ORDER.filter(g => present.has(g));

  const sectors = order.map(name => {
    const members = SOXX_TOP.filter(c => c.group === name);
    // weighted group daily return series
    const groupRets = [];
    for (let d = 0; d < dates.length - 1; d++) {
      let wSum = 0;
      let wRet = 0;
      for (const mbr of members) {
        const r = retBySym[mbr.sym] ? retBySym[mbr.sym][d] : null;
        if (r == null) continue;
        wSum += mbr.weight;
        wRet += mbr.weight * r;
      }
      groupRets.push(wSum > 0 ? wRet / wSum : null);
    }
    const { cum, series } = cumSeries(groupRets);
    return { name, members: members.length, cum, series };
  });

  const bench = cumSeries(retBySym[benchSym] || []);
  sectors.forEach(s => {
    s.vsSpy = s.cum - bench.cum;
  });
  sectors.sort((a, b) => b.cum - a.cum);
  return { benchmark: { cum: bench.cum, series: bench.series }, sectors };
}

/**
 * Fetch + compute the cached sub-sector rotation history.
 * @returns {Promise<{asOf, sessions, from, to, benchmarkSym, benchmark, sectors}>}
 */
async function getSectorHistory(force = false) {
  if (!force && _cache.data && Date.now() - _cache.at < CACHE_MS) return _cache.data;

  const nowMs = Date.now();
  const start = iso(nowMs - LOOKBACK_DAYS * DAY_MS);
  const end = iso(nowMs + DAY_MS);
  const syms = [BENCH, ...SOXX_TOP.map(c => c.sym)];

  const closesBySym = {};
  const batch = 6;
  for (let i = 0; i < syms.length; i += batch) {
    const chunk = syms.slice(i, i + batch);
    const barsArr = await Promise.all(chunk.map(s => dailyBars(s, start, end)));
    chunk.forEach((s, j) => {
      const m = {};
      for (const b of barsArr[j]) m[barDate(b)] = b.close;
      closesBySym[s] = m;
    });
  }

  // Trading-day calendar = the benchmark's dates (fallback: union of all symbols).
  let dates = Object.keys(closesBySym[BENCH] || {}).sort();
  if (dates.length < 2) {
    const set = new Set();
    Object.values(closesBySym).forEach(m => Object.keys(m).forEach(d => set.add(d)));
    dates = [...set].sort();
  }
  dates = dates.slice(-(WINDOW_SESSIONS + 1));

  if (dates.length < 2) {
    const data = { asOf: new Date().toISOString(), sessions: 0, from: null, to: null, benchmarkSym: BENCH, benchmark: null, sectors: [] };
    _cache = { at: Date.now(), data };
    return data;
  }

  const { benchmark, sectors } = computeSectorSeries(closesBySym, dates, BENCH);
  const data = {
    asOf: new Date().toISOString(),
    sessions: dates.length - 1,
    from: dates[0],
    to: dates[dates.length - 1],
    benchmarkSym: BENCH,
    benchmark,
    sectors,
  };
  _cache = { at: Date.now(), data };
  return data;
}

module.exports = { getSectorHistory, computeSectorSeries };
