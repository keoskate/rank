/**
 * Shared fixture normalization.
 *
 * Both the capture script and the validation tests apply this so the two
 * sides agree on shape:
 *  - Sets → sorted arrays   (JSON.stringify(set) === '{}', useless)
 *  - non-deterministic fields stripped (timestamps captured at call time)
 *  - Date objects → ISO strings (round-trip safe with JSON)
 *
 * Add a field to NON_DETERMINISTIC_KEYS when you discover a value that
 * changes per call (Date.now(), random IDs, etc.) but isn't part of the
 * function's logical output.
 */

const NON_DETERMINISTIC_KEYS = new Set(['timestamp', 'createdAt', 'updatedAt']);

function normalize(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Set) return [...v].map(normalize).sort();
  if (v instanceof Map) {
    const obj = {};
    for (const [k, val] of [...v.entries()].sort()) obj[k] = normalize(val);
    return obj;
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (NON_DETERMINISTIC_KEYS.has(k)) continue;
      out[k] = normalize(v[k]);
    }
    return out;
  }
  return v;
}

module.exports = { normalize, NON_DETERMINISTIC_KEYS };
