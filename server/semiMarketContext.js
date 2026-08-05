/**
 * Semiconductor market-context pack — the REAL data the AI analyst reasons over.
 *
 * Assembles, from live sources, a compact snapshot of:
 *   - breadth      : advance/decline across the ~30 SOXX constituents (+ by weight)
 *   - rotation     : weighted day% per semis sub-sector (leaders / laggards)
 *   - concentration: mega-cap (NVDA/AVGO/AMD) share of the move → narrow vs broad
 *   - macro        : SPY/QQQ/IWM/DIA/SMH/VIXY/GLD/TLT/UUP day% + risk regime,
 *                    semis-vs-tech spread, VIX confirmation, safe-haven flag
 *   - earnings     : upcoming SOXX reports (with expected move) + recent reactions
 *
 * Derivations are ported verbatim from the client panels that already display
 * this (SoxxInternals.jsx, MacroContextPanel.jsx) so the AI sees the SAME reads
 * the human does.
 *
 * Cheapness/safety: module-cached ~3min (breadth/macro don't need finer grain
 * for AI reasoning, and the analyst is only triggered on phase/direction changes)
 * and TIME-BOXED — getSemiContext() never blocks a trade decision longer than
 * maxWaitMs; on a cold miss it returns stale/null and lets the refresh finish in
 * the background to warm the cache for next time (stale-while-revalidate).
 */

const alpacaClient = require('./alpacaClient');
const { computeSoxxEarnings } = require('./soxxEarnings');
const {
  SOXX_TOP,
  GROUP_ORDER,
  MEGA_CAP_SYMS,
  SOXX_SYMS,
  pctFromOpen,
} = require('./soxxConstituents');

const MACRO = [
  { sym: 'SPY', label: 'S&P', group: 'Equities' },
  { sym: 'QQQ', label: 'Nasdaq', group: 'Equities' },
  { sym: 'IWM', label: 'Rus2k', group: 'Equities' },
  { sym: 'DIA', label: 'Dow', group: 'Equities' },
  { sym: 'SMH', label: 'Semis', group: 'Semis' },
  { sym: 'VIXY', label: 'VIX', group: 'Volatility' },
  { sym: 'GLD', label: 'Gold', group: 'Safe-haven' },
  { sym: 'TLT', label: 'Bonds', group: 'Rates' },
  { sym: 'UUP', label: 'Dollar', group: 'Dollar' },
];

const CACHE_MS = 3 * 60 * 1000; // context freshness window
let _cache = { at: 0, data: null };
let _inflight = null;

async function fetchSnapshots(syms) {
  const entries = await Promise.all(
    syms.map(async s => {
      try {
        return [s, await alpacaClient.getSnapshot(s)];
      } catch {
        return [s, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

// Breadth / rotation / concentration — port of SoxxInternals.jsx:66-113.
function computeBreadth(quotes) {
  let up = 0;
  let down = 0;
  let scored = 0;
  let wUp = 0;
  let wTotal = 0;
  let absContribTotal = 0;
  let megaAbsContrib = 0;
  const groups = new Map();

  for (const { sym, weight, group } of SOXX_TOP) {
    const pct = pctFromOpen(quotes[sym]);
    if (pct == null) continue;
    scored++;
    if (pct > 0) up++;
    else if (pct < 0) down++;
    wTotal += weight;
    if (pct > 0) wUp += weight;
    const contrib = (pct * weight) / 100;
    absContribTotal += Math.abs(contrib);
    if (MEGA_CAP_SYMS.includes(sym)) megaAbsContrib += Math.abs(contrib);
    const g = groups.get(group) || { wSum: 0, wPctSum: 0 };
    g.wSum += weight;
    g.wPctSum += weight * pct;
    groups.set(group, g);
  }

  const rotation = GROUP_ORDER.map(name => {
    const g = groups.get(name);
    return { name, pct: g && g.wSum > 0 ? g.wPctSum / g.wSum : null };
  })
    .filter(r => r.pct != null)
    .sort((a, b) => b.pct - a.pct);

  const megaShare = absContribTotal > 0 ? megaAbsContrib / absContribTotal : 0;

  return {
    breadth: {
      up,
      down,
      scored,
      pctGreen: scored > 0 ? (up / scored) * 100 : null,
      wPctGreen: wTotal > 0 ? (wUp / wTotal) * 100 : null,
      megaShare,
      narrow: megaShare >= 0.5,
    },
    rotation,
  };
}

// Macro cross-asset reads — port of MacroContextPanel.jsx:69-116.
function computeMacro(quotes) {
  const g = sym => pctFromOpen(quotes[sym]);
  const items = MACRO.map(m => ({ sym: m.sym, label: m.label, group: m.group, pct: g(m.sym) }));

  const eqVals = ['SPY', 'QQQ', 'IWM', 'DIA'].map(g).filter(v => v != null);
  const equity = eqVals.length ? eqVals.reduce((a, b) => a + b, 0) / eqVals.length : null;
  const vix = g('VIXY');
  const gold = g('GLD');
  const semis = g('SMH');
  const qqq = g('QQQ');

  let regime = 'MIXED';
  if (equity != null) {
    const eqUp = equity > 0.1;
    const eqDown = equity < -0.1;
    const vixUp = vix != null && vix > 1;
    const goldBid = gold != null && gold > 1;
    if (eqUp && !vixUp) regime = 'RISK-ON';
    else if (eqDown && (vixUp || goldBid)) regime = 'RISK-OFF';
  }

  const spread = semis != null && qqq != null ? semis - qqq : null;
  const vixConfirm =
    vix == null || equity == null
      ? 'n/a'
      : (equity >= 0 && vix <= 0) || (equity < 0 && vix > 0)
        ? 'confirming'
        : 'diverging';
  const safeHaven =
    (gold != null && gold > 1) ||
    (gold != null && gold > 0.5 && equity != null && equity < -0.1);

  return { items, equity, vix, gold, semis, qqq, regime, spread, vixConfirm, safeHaven };
}

async function refresh() {
  const [soxxQuotes, macroQuotes, earnings] = await Promise.all([
    fetchSnapshots(SOXX_SYMS),
    fetchSnapshots(MACRO.map(m => m.sym)),
    computeSoxxEarnings().catch(() => null),
  ]);
  const { breadth, rotation } = computeBreadth(soxxQuotes);
  const macro = computeMacro(macroQuotes);
  const data = { breadth, rotation, macro, earnings, asOf: new Date().toISOString() };
  _cache = { at: Date.now(), data };
  return data;
}

/**
 * Get the market-context pack. Returns a fresh cache instantly; otherwise kicks
 * off (or joins) a background refresh and waits up to maxWaitMs before falling
 * back to the stale cache (marked) or null. Never throws.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxWaitMs=2500] - trade path uses the short default;
 *   user-initiated refreshes pass a larger value to get grounded data on first hit.
 * @returns {Promise<object|null>}
 */
async function getSemiContext({ maxWaitMs = 2500 } = {}) {
  if (_cache.data && Date.now() - _cache.at < CACHE_MS) return _cache.data;

  if (!_inflight) {
    _inflight = refresh().finally(() => {
      _inflight = null;
    });
  }

  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve('__timeout__'), maxWaitMs);
  });
  try {
    const result = await Promise.race([_inflight, timeout]);
    if (result !== '__timeout__') return result;
    return _cache.data ? { ..._cache.data, stale: true } : null;
  } catch {
    return _cache.data ? { ..._cache.data, stale: true } : null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getSemiContext };
