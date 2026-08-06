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
const CACHE_MS = 2 * 60 * 60 * 1000;
const BENCH = 'SPY';

// Selectable trailing windows — 30 days alone doesn't tell the rotation story, so
// quarter / multi-quarter / year views show the cycle. sessions = trading days
// shown; lookbackDays = calendar span to cover them + slack.
const WINDOWS = {
  '30d': { label: '30d', sessions: 30, lookbackDays: 48 },
  '1Q': { label: '1Q', sessions: 63, lookbackDays: 100 },
  '2Q': { label: '2Q', sessions: 126, lookbackDays: 195 },
  '1Y': { label: '1Y', sessions: 252, lookbackDays: 380 },
};
const DEFAULT_WINDOW = '30d';
const WINDOW_KEYS = Object.keys(WINDOWS);

const _cache = new Map(); // windowKey -> { at, data }

const iso = ms => new Date(ms).toISOString().slice(0, 10);
const barDate = b => new Date(b.timestamp).toISOString().slice(0, 10);

async function dailyBars(symbol, start, end, limit = 450) {
  try {
    const bars = await alpacaClient.getBars(symbol, '1Day', start, end, limit);
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
 * Fetch + compute the cached sub-sector rotation history for a trailing window
 * (30d / 1Q / 2Q / 1Y). Cached per window ~2h.
 * @param {boolean} force
 * @param {string} windowKey - one of WINDOW_KEYS (default 30d)
 * @returns {Promise<{asOf, window, sessions, from, to, benchmarkSym, benchmark, sectors}>}
 */
async function getSectorHistory(force = false, windowKey = DEFAULT_WINDOW) {
  const key = WINDOWS[windowKey] ? windowKey : DEFAULT_WINDOW;
  const w = WINDOWS[key];
  const cached = _cache.get(key);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const nowMs = Date.now();
  const start = iso(nowMs - w.lookbackDays * DAY_MS);
  const end = iso(nowMs + DAY_MS);
  const limit = w.sessions + 80;
  const syms = [BENCH, ...SOXX_TOP.map(c => c.sym)];

  const closesBySym = {};
  const batch = 6;
  for (let i = 0; i < syms.length; i += batch) {
    const chunk = syms.slice(i, i + batch);
    const barsArr = await Promise.all(chunk.map(s => dailyBars(s, start, end, limit)));
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
  dates = dates.slice(-(w.sessions + 1));

  if (dates.length < 2) {
    const data = { asOf: new Date().toISOString(), window: key, sessions: 0, from: null, to: null, benchmarkSym: BENCH, benchmark: null, sectors: [] };
    _cache.set(key, { at: Date.now(), data });
    return data;
  }

  const { benchmark, sectors } = computeSectorSeries(closesBySym, dates, BENCH);
  const data = {
    asOf: new Date().toISOString(),
    window: key,
    sessions: dates.length - 1,
    from: dates[0],
    to: dates[dates.length - 1],
    benchmarkSym: BENCH,
    benchmark,
    sectors,
  };
  _cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getSectorHistory, computeSectorSeries, WINDOW_KEYS };
