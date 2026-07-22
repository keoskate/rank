// packages/quant-core/src/rankerCore.js
//
// THE cross-sectional selection decision. Pure function of (scores, config).
//
// A GBDT (or any) model emits one score per symbol per date; this core turns a
// day's cross-section of scores into the basket to hold. Both the backtest
// (scripts/backtests/validate-cross-sectional.js) and — in Phase 3 — the live
// plugin (server/strategies/crossSectionalRank.js) MUST call this, so the
// selection they make from identical scores is bit-for-bit identical. Same
// faithfulness contract as trendCore / entropyGateCore: the model is where the
// edge (if any) lives; the selection rule must never diverge live vs backtest.
//
// The scores themselves are produced out-of-sample and deterministically by
// python/research/build_rank_scores.py (expanding-window retrain, no lookahead)
// and read from data/rank-cache/scores.json. This core does NOT compute scores;
// it only ranks and weights an already-scored cross-section.

const DEFAULTS = {
  topN: 10, // long book size
  bottomN: 0, // short book size (0 = long-only)
  longShort: false, // if true and bottomN>0, dollar-neutral longs/shorts
};

/**
 * Select the basket for one date's cross-section of scores.
 *
 * Deterministic tie-break: score descending, then symbol ascending. Two runs
 * over the same scores.json therefore pick the identical names in the identical
 * order — the property certify-ranker.js checks.
 *
 * @param {Object<string, number>} scores - { sym: score } for the names
 *        available (already-scored) on this date.
 * @param {object} [cfg]
 * @param {number} [cfg.topN=10]
 * @param {number} [cfg.bottomN=0]
 * @param {boolean} [cfg.longShort=false]
 * @returns {{ok: boolean, longs: string[], shorts: string[],
 *            weights: Object<string, number>}}
 *   weights: long-only → +1/topN each; long-short → longs sum +1, shorts sum −1
 *   (dollar-neutral). ok:false when the cross-section is too small to fill the book.
 */
function selectBasket(scores, cfg = {}) {
  const topN = cfg.topN ?? DEFAULTS.topN;
  const bottomN = cfg.bottomN ?? DEFAULTS.bottomN;
  const longShort = !!cfg.longShort && bottomN > 0;

  const entries = Object.entries(scores || {}).filter(
    ([, v]) => v != null && Number.isFinite(v)
  );
  // score desc, symbol asc for ties — fully deterministic ordering.
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  const n = entries.length;
  const need = topN + (longShort ? bottomN : 0);
  if (n < need || topN <= 0) {
    return { ok: false, longs: [], shorts: [], weights: {} };
  }

  const longs = entries.slice(0, topN).map(e => e[0]);
  const shorts = longShort ? entries.slice(n - bottomN).map(e => e[0]) : [];

  const weights = {};
  const lw = 1 / longs.length;
  for (const s of longs) weights[s] = longShort ? lw : lw; // longs sum to +1
  if (longShort) {
    const sw = 1 / shorts.length;
    for (const s of shorts) weights[s] = -sw; // shorts sum to −1 (dollar-neutral)
  }

  return { ok: true, longs, shorts, weights };
}

module.exports = { selectBasket, DEFAULTS };
