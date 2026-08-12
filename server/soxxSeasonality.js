/**
 * SOXX seasonality — year-over-year overlay for ONE series (the SOXX index or a
 * single sub-sector), so you can compare each calendar year's path on a shared
 * Jan→Dec axis and read cyclical/seasonal tendencies (does memory always rally into
 * a given quarter? is a sector's demand climbing or fading year over year?).
 *
 * For a sub-sector the "level" is a weighted index (start 100, compounding the
 * group's weighted daily returns); for SOXX (or a single symbol) it's the close.
 * Each calendar year is rebased to its first trading day and indexed by trading-day-
 * of-year (doy) so the years line up. Cached per target ~2h.
 */

const alpacaClient = require('./alpacaClient');
const { SOXX_TOP, GROUP_ORDER } = require('./soxxConstituents');

const DAY_MS = 86400000;
const LOOKBACK_DAYS = 3 * 365 + 40; // ~3 calendar years
const CACHE_MS = 2 * 60 * 60 * 1000;
const _cache = new Map();

const iso = ms => new Date(ms).toISOString().slice(0, 10);
const barDate = b => new Date(b.timestamp).toISOString().slice(0, 10);

// Valid targets: the index + each present sub-sector.
function targets() {
  const present = new Set(SOXX_TOP.map(c => c.group));
  return ['SOXX', ...GROUP_ORDER.filter(g => present.has(g))];
}

async function dailyBars(symbol, start, end, limit = 900) {
  try {
    const bars = await alpacaClient.getBars(symbol, '1Day', start, end, limit);
    return Array.isArray(bars) ? bars.filter(b => Number.isFinite(b.close)) : [];
  } catch {
    return [];
  }
}

// Continuous [{date, level}] for the target over [start, end].
async function levelSeries(target, start, end) {
  const members = SOXX_TOP.filter(c => c.group === target);
  if (target !== 'SOXX' && members.length) {
    // Weighted sub-sector index (compounded weighted daily returns).
    const closesBySym = {};
    const batch = 6;
    for (let i = 0; i < members.length; i += batch) {
      const chunk = members.slice(i, i + batch);
      const barsArr = await Promise.all(chunk.map(m => dailyBars(m.sym, start, end)));
      chunk.forEach((m, j) => {
        const map = {};
        for (const b of barsArr[j]) map[barDate(b)] = b.close;
        closesBySym[m.sym] = map;
      });
    }
    const dateSet = new Set();
    Object.values(closesBySym).forEach(m => Object.keys(m).forEach(d => dateSet.add(d)));
    const dates = [...dateSet].sort();
    let level = 100;
    const out = [];
    for (let i = 0; i < dates.length; i++) {
      if (i > 0) {
        let wSum = 0;
        let wRet = 0;
        for (const m of members) {
          const c0 = closesBySym[m.sym][dates[i - 1]];
          const c1 = closesBySym[m.sym][dates[i]];
          if (Number.isFinite(c0) && Number.isFinite(c1) && c0 > 0) {
            wSum += m.weight;
            wRet += m.weight * ((c1 - c0) / c0);
          }
        }
        level *= 1 + (wSum > 0 ? wRet / wSum : 0);
      }
      out.push({ date: dates[i], level });
    }
    return out;
  }
  // SOXX or a single symbol → close.
  const sym = target === 'SOXX' ? 'SOXX' : target;
  const bars = await dailyBars(sym, start, end);
  return bars.map(b => ({ date: barDate(b), level: b.close }));
}

// Calendar day-of-year (1..366) so years align by real date on a shared Jan→Dec axis.
function dayOfYear(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
}

// Split into calendar years, rebase each to its first point, index by calendar doy.
// Keep only Jan-starting years (full years + the current partial), so a leading
// partial year (data starting mid-year) doesn't overlay misaligned.
function toSeasonal(levels) {
  const byYear = {};
  for (const p of levels) {
    const y = p.date.slice(0, 4);
    (byYear[y] = byYear[y] || []).push(p);
  }
  return Object.keys(byYear)
    .sort()
    .map(y => {
      const pts = byYear[y];
      const first = pts[0].level;
      return {
        year: Number(y),
        startsEarly: dayOfYear(pts[0].date) <= 15, // began in early January
        series: pts.map(p => ({ doy: dayOfYear(p.date), date: p.date, pct: first > 0 ? (p.level / first - 1) * 100 : 0 })),
      };
    })
    .filter(yr => yr.startsEarly && yr.series.length >= 20)
    .map(({ startsEarly, ...yr }) => yr); // drop the internal flag
}

async function getSeasonality(target = 'SOXX', force = false) {
  const key = targets().includes(target) ? target : 'SOXX';
  const cached = _cache.get(key);
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  const now = Date.now();
  const start = iso(now - LOOKBACK_DAYS * DAY_MS);
  const end = iso(now + DAY_MS);
  const levels = await levelSeries(key, start, end);
  const years = toSeasonal(levels);
  const data = { target: key, targets: targets(), years, asOf: new Date().toISOString() };
  _cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getSeasonality, targets };
