/**
 * FRED (Federal Reserve Economic Data) client — macro regime inputs.
 *
 * Pulls the two longest-history, most economically-grounded risk-regime series:
 *   - T10Y2Y       : 10yr−2yr Treasury spread (yield-curve slope). <0 = inverted.
 *   - BAMLH0A0HYM2 : ICE BofA US High-Yield OAS (credit stress). Spikes in risk-off.
 *
 * Free API. Set FRED_API_KEY in .env. Until then EVERYTHING here no-ops:
 * isConfigured() returns false and getMacroSnapshot() returns null, so the macro
 * gate stays completely inert (fails open / allow). Get a key (1 minute, free):
 *   https://fredaccount.stlouisfed.org/apikeys
 *
 * Macro daily series move at most once/day, so we cache the snapshot for hours.
 */

const axios = require('axios');
const tradingLogger = require('../tradingLogger');

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — these series update at most daily
const HY_WINDOW = 126; // ~6 months of trading days for the moving average

let _cache = null; // { snapshot, expires }

function isConfigured() {
  return !!process.env.FRED_API_KEY;
}

/**
 * Fetch the most recent `limit` observations for a series, newest-first, with
 * FRED's missing-value markers ('.') stripped.
 * @returns {Array<{date: string, value: number}>}
 */
async function _fetchSeries(seriesId, limit) {
  const url =
    `${FRED_BASE}?series_id=${seriesId}` +
    `&api_key=${process.env.FRED_API_KEY}` +
    `&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await axios.get(url, { timeout: 10000 });
  const obs = (res.data && res.data.observations) || [];
  return obs
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => Number.isFinite(o.value));
}

/**
 * Current macro snapshot, cached. Returns null when no key is set or the fetch
 * fails — callers treat null as "no opinion" (fail open).
 * @returns {Promise<{curveSlope:number, hySpread:number, hySpread6moMA:number,
 *   asOf:string}|null>}
 */
async function getMacroSnapshot() {
  if (!isConfigured()) return null;
  if (_cache && _cache.expires > Date.now()) return _cache.snapshot;
  try {
    const [curve, hy] = await Promise.all([
      _fetchSeries('T10Y2Y', 5),
      _fetchSeries('BAMLH0A0HYM2', HY_WINDOW + 14),
    ]);
    if (!curve.length || !hy.length) return null;
    const window = hy.slice(0, HY_WINDOW);
    const snapshot = {
      curveSlope: curve[0].value,
      hySpread: hy[0].value,
      hySpread6moMA: window.reduce((a, b) => a + b.value, 0) / window.length,
      asOf: curve[0].date,
    };
    _cache = { snapshot, expires: Date.now() + CACHE_TTL_MS };
    return snapshot;
  } catch (err) {
    tradingLogger.logError('[FRED] macro snapshot fetch failed', {
      error: err.message,
    });
    return null; // fail open — the gate treats this as "allow"
  }
}

function _clearCache() {
  _cache = null;
}

module.exports = { isConfigured, getMacroSnapshot, _clearCache };
