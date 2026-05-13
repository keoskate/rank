/**
 * Tiny LRU cache for scanner bar data.
 * Keyed by `symbol|dateKey` (e.g. "NVDA|2026-05-13"), TTL ~10 min.
 * Module-local — no external deps.
 */

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map(); // key -> { value, expiresAt }

function _evictIfFull() {
  if (store.size <= MAX_ENTRIES) return;
  // Drop oldest insertion-ordered entry
  const firstKey = store.keys().next().value;
  if (firstKey != null) store.delete(firstKey);
}

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  // Move to MRU position
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function set(key, value) {
  if (store.has(key)) store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  _evictIfFull();
}

function size() {
  return store.size;
}

function clear() {
  store.clear();
}

module.exports = { get, set, size, clear, TTL_MS, MAX_ENTRIES };
