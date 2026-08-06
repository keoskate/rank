/**
 * Shared equity-quote layer — the foundation for a cheaper, more reliable data
 * layer (Phase 1). Two mechanisms:
 *
 *  1) MICRO-BATCH COALESCING: requests that arrive within a ~25ms window are
 *     collected and served by ONE Alpaca batch snapshot call. So the client's
 *     burst of 30 parallel /api/quote/:symbol requests (constituent pool) becomes
 *     a single upstream request instead of 30.
 *  2) SHORT-TTL CACHE (~2s): repeat/near-simultaneous requests for the same
 *     symbol are served from cache without hitting Alpaca again.
 *
 * Plus a SANITY GATE: a non-positive/absurd price is never served as a real
 * number — it's marked `unverified` with `last: null` so the UI shows "—" and
 * the engine never trades on a bad print (the class of bug behind the $0 quote).
 *
 * Display/quote path only — this does NOT change alpacaClient.getSnapshot()'s
 * behavior for the engine's own pricing calls.
 */

const alpacaClient = require('./alpacaClient');

const TTL_MS = parseInt(process.env.QUOTE_CACHE_TTL_MS, 10) || 2000;
const BATCH_MS = parseInt(process.env.QUOTE_BATCH_MS, 10) || 25;
const ABSURD_JUMP = 0.6; // |last-prevClose|/prevClose beyond this = flag unverified

const cache = new Map(); // SYMBOL -> { at, data }
let pending = new Map(); // SYMBOL -> [resolve, ...]
let flushTimer = null;

// Sanity: reject non-positive prices; flag absurd single-day jumps (keep the
// number but mark it unverified so it's visible, not silently trusted).
function sanitize(q) {
  if (!q) return null;
  if (!(Number.isFinite(q.last) && q.last > 0)) {
    return { ...q, last: null, price: null, unverified: true, sanity: 'nonpositive' };
  }
  if (Number.isFinite(q.prevClose) && q.prevClose > 0) {
    const jump = Math.abs(q.last - q.prevClose) / q.prevClose;
    if (jump > ABSURD_JUMP) return { ...q, unverified: true, sanity: `jump:${(jump * 100).toFixed(0)}%` };
  }
  return q;
}

function fresh(sym) {
  const e = cache.get(sym);
  return e && Date.now() - e.at < TTL_MS ? e.data : undefined;
}

async function flush() {
  const batch = pending;
  pending = new Map();
  flushTimer = null;
  const symbols = [...batch.keys()];
  let snaps = {};
  try {
    snaps = await alpacaClient.getSnapshots(symbols);
  } catch (err) {
    snaps = {}; // upstream failure → everyone resolves null (treated as stale)
  }
  const now = Date.now();
  for (const sym of symbols) {
    const data = sanitize(snaps[sym] || null);
    cache.set(sym, { at: now, data });
    for (const resolve of batch.get(sym)) resolve(data);
  }
}

function enqueue(sym) {
  return new Promise(resolve => {
    if (!pending.has(sym)) pending.set(sym, []);
    pending.get(sym).push(resolve);
    if (!flushTimer) flushTimer = setTimeout(flush, BATCH_MS);
  });
}

/** Cached/coalesced single-symbol quote (equities). Returns a snapshot or null. */
async function getQuote(symbol) {
  const sym = String(symbol).toUpperCase();
  const cached = fresh(sym);
  if (cached !== undefined) return cached;
  return enqueue(sym);
}

/** Batch quotes — all symbols flow through the same micro-batch/cache. */
async function getQuotes(symbols) {
  const uniq = [...new Set((symbols || []).map(s => String(s).toUpperCase()))];
  const entries = await Promise.all(uniq.map(async s => [s, await getQuote(s)]));
  return Object.fromEntries(entries);
}

module.exports = { getQuote, getQuotes, TTL_MS };
