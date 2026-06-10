// packages/quant-core/src/darkPoolCore.js
//
// THE dark-pool print classifier. Pure function of (raw print rows, opts).
// The live wrapper (server/unusualWhalesClient.analyzeDarkPool) and the
// future B6 event-study backtest (replaying data/darkpool-archive/) MUST
// both call this — same faithfulness contract as trendCore/entropyGateCore.
//
// Implements every classifier fix from the 2026-06-01 audit
// (data/reports/audits/dark-pool.md), which measured NO EDGE (−0.038% vs
// baseline) and traced it to mechanical biases:
//   #2 at-mid prints (12.8% of premium, negotiated crosses with zero
//      directional content) were counted as buys by the `price >= mid` rule
//      → at-mid and missing/zero-NBBO prints are now indeterminate, dropped.
//      (The old fallback mid=price made every missing-NBBO print a "buy".)
//   #4 premium-weighting let one mega-print flip buyShare 7% → 96%
//      → each print's premium contribution is capped at maxSinglePrintShare
//        of the window total, AND the signal additionally requires a
//        count-based majority with >= minPrints on the dominant side.
//   #5/#6 500-print cap truncation + after-hours leakage
//      → windowTruncated flag (raw length at cap, or oldest raw print newer
//        than the requested window start) and an rthOnly guard; lastRthPrice
//        never comes from an after-hours print.
//   Bearish is exactly symmetric to bullish (the old score was bullish-only).
//
// Purity notes: no Date.now() — `asOf` defaults to the newest print's
// executed_at so archived days replay deterministically; the live wrapper
// passes its own clock. Field names (executed_at, price, premium, nbbo_bid,
// nbbo_ask) follow the UW dark-pool print schema treated as plain data; the
// archive stores rows verbatim, so this naming IS the replay contract.

const DEFAULTS = {
  lookbackMinutes: 120,
  minPremium: 1_000_000,
  minBuyShare: 0.6,
  dropAtMid: true,
  maxSinglePrintShare: 0.25,
  minPrints: 5,
  rthOnly: true,
};

// UW returns at most ~500 prints per fetch; a raw batch at that size means
// the window was truncated by the cap.
const FETCH_CAP = 500;

const MID_EPSILON = 1e-6;

const _num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** Minutes-since-midnight ET + weekend flag for an epoch-ms timestamp. */
function _etMinutes(ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(ts));
  const get = t => parts.find(p => p.type === t)?.value;
  const hour = parseInt(get('hour'), 10) % 24;
  const wd = get('weekday');
  return {
    minutes: hour * 60 + parseInt(get('minute'), 10),
    isWeekend: wd === 'Sat' || wd === 'Sun',
  };
}

/** Regular trading hours: weekday 09:30 ≤ t ≤ 16:00 ET (close prints kept). */
function _isRth(ts) {
  const { minutes, isWeekend } = _etMinutes(ts);
  return !isWeekend && minutes >= 570 && minutes <= 960;
}

const _clamp01 = x => Math.min(Math.max(x, 0), 1);

/**
 * Classify a window of dark-pool prints into a directional read.
 *
 * @param {object[]} prints - raw UW rows (any order):
 *   { price, size, premium, executed_at, nbbo_bid, nbbo_ask, ... }
 * @param {object} [opts] - see DEFAULTS; plus:
 * @param {number|string} [opts.asOf] - window end (epoch ms or ISO).
 *   Defaults to the newest executed_at in `prints` (deterministic replay).
 * @returns {object} {
 *   sentiment: 'bullish'|'bearish'|'neutral', score,
 *   buyPremium, sellPremium, totalPremium, buyShare,        // capped sums
 *   buyCount, sellCount, countShare, printCount,
 *   atMidPremium, droppedAtMid, droppedNoNbbo, droppedAfterHours,
 *   windowTruncated, oldestConsideredAt, lastRthPrice, reasons[] }
 */
function classifyDarkPool(prints, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rows = Array.isArray(prints) ? prints : [];

  // Window end: explicit asOf, else newest print timestamp (pure replay).
  let asOfMs = null;
  if (cfg.asOf != null) {
    asOfMs = typeof cfg.asOf === 'number' ? cfg.asOf : Date.parse(cfg.asOf);
  } else {
    for (const p of rows) {
      const t = p.executed_at ? Date.parse(p.executed_at) : NaN;
      if (Number.isFinite(t) && (asOfMs == null || t > asOfMs)) asOfMs = t;
    }
  }
  const windowStart =
    asOfMs != null ? asOfMs - cfg.lookbackMinutes * 60 * 1000 : null;

  const base = {
    sentiment: 'neutral',
    score: 0,
    buyPremium: 0,
    sellPremium: 0,
    totalPremium: 0,
    buyShare: null,
    buyCount: 0,
    sellCount: 0,
    countShare: null,
    printCount: 0,
    atMidPremium: 0,
    droppedAtMid: 0,
    droppedNoNbbo: 0,
    droppedAfterHours: 0,
    windowTruncated: rows.length >= FETCH_CAP,
    oldestConsideredAt: null,
    lastRthPrice: 0,
    reasons: [],
  };
  if (rows.length === 0) {
    base.reasons.push('no dark pool prints');
    return base;
  }

  // Pass 1: window + RTH + NBBO filters, raw classification.
  let oldestRawTs = null;
  const classified = []; // { side: 'buy'|'sell', prem, ts, price }
  let atMidPremium = 0;
  let droppedAtMid = 0;
  let droppedNoNbbo = 0;
  let droppedAfterHours = 0;
  let lastRthTs = null;
  let lastRthPrice = 0;

  for (const p of rows) {
    const ts = p.executed_at ? Date.parse(p.executed_at) : NaN;
    if (Number.isFinite(ts) && (oldestRawTs == null || ts < oldestRawTs)) {
      oldestRawTs = ts;
    }
    if (!Number.isFinite(ts)) continue;
    if (windowStart != null && (ts < windowStart || ts > asOfMs)) continue;

    if (cfg.rthOnly && !_isRth(ts)) {
      droppedAfterHours++;
      continue;
    }

    const prem = _num(p.premium);
    if (prem <= 0) continue;
    const price = _num(p.price);
    const bid = _num(p.nbbo_bid);
    const ask = _num(p.nbbo_ask);
    if (!(bid > 0 && ask > 0)) {
      // No NBBO context → indeterminate. (Old code fell back to mid=price,
      // which made every such print a "buy" under price >= mid.)
      droppedNoNbbo++;
      continue;
    }
    const mid = (bid + ask) / 2;

    if (lastRthTs == null || ts > lastRthTs) {
      lastRthTs = ts;
      lastRthPrice = price;
    }

    if (Math.abs(price - mid) <= MID_EPSILON) {
      atMidPremium += prem;
      if (cfg.dropAtMid) {
        droppedAtMid++;
        continue;
      }
      // Legacy behaviour (dropAtMid:false, for A/B trials only): at-mid → buy.
      classified.push({ side: 'buy', prem, ts });
      continue;
    }
    classified.push({ side: price > mid ? 'buy' : 'sell', prem, ts });
  }

  base.atMidPremium = atMidPremium;
  base.droppedAtMid = droppedAtMid;
  base.droppedNoNbbo = droppedNoNbbo;
  base.droppedAfterHours = droppedAfterHours;
  base.lastRthPrice = lastRthPrice;
  // Truncation is a CAP phenomenon (audit #6): an uncapped fetch returned
  // everything UW has, so a sparse/quiet tape is not truncation. Capped AND
  // the oldest raw print newer than the window start ⇒ the cap cut into our
  // window. (A merged archive replay can exceed FETCH_CAP rows while spanning
  // the whole window — that correctly reads as not truncated.)
  base.windowTruncated =
    rows.length >= FETCH_CAP &&
    (windowStart == null || oldestRawTs == null || oldestRawTs > windowStart);

  if (classified.length === 0) {
    base.reasons.push(
      `no classifiable prints in last ${cfg.lookbackMinutes}m` +
        (droppedAtMid ? ` (${droppedAtMid} at-mid dropped)` : '')
    );
    return base;
  }

  base.oldestConsideredAt = new Date(
    Math.min(...classified.map(c => c.ts))
  ).toISOString();

  // Pass 2: capped premium aggregation + counts.
  const rawTotal = classified.reduce((s, c) => s + c.prem, 0);
  const perPrintCap = cfg.maxSinglePrintShare * rawTotal;
  let buyPremium = 0;
  let sellPremium = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const c of classified) {
    const contrib = Math.min(c.prem, perPrintCap);
    if (c.side === 'buy') {
      buyPremium += contrib;
      buyCount++;
    } else {
      sellPremium += contrib;
      sellCount++;
    }
  }
  const totalPremium = buyPremium + sellPremium;
  const buyShare = totalPremium > 0 ? buyPremium / totalPremium : 0.5;
  const printCount = buyCount + sellCount;
  const countShare = printCount > 0 ? buyCount / printCount : 0.5;

  Object.assign(base, {
    buyPremium,
    sellPremium,
    totalPremium,
    buyShare,
    buyCount,
    sellCount,
    countShare,
    printCount,
  });

  // Signal: premium share AND count share must agree, with enough
  // independent prints on the dominant side and enough total premium.
  const bullish =
    buyShare >= cfg.minBuyShare &&
    countShare >= cfg.minBuyShare &&
    buyCount >= cfg.minPrints &&
    totalPremium >= cfg.minPremium;
  const bearish =
    !bullish &&
    1 - buyShare >= cfg.minBuyShare &&
    1 - countShare >= cfg.minBuyShare &&
    sellCount >= cfg.minPrints &&
    totalPremium >= cfg.minPremium;
  base.sentiment = bullish ? 'bullish' : bearish ? 'bearish' : 'neutral';

  if (bullish || bearish) {
    // Count-led score so confidence discriminates (audit finding: the old
    // share+premium score clustered high).
    const dirCountShare = bullish ? countShare : 1 - countShare;
    const dirPremShare = bullish ? buyShare : 1 - buyShare;
    const countStrength = _clamp01((dirCountShare - 0.5) / 0.4);
    const shareStrength = _clamp01((dirPremShare - 0.5) / 0.4);
    const premStrength = _clamp01(
      Math.log10(Math.max(totalPremium, 1)) / Math.log10(50_000_000)
    );
    base.score = Math.min(
      0.5 * countStrength + 0.25 * shareStrength + 0.15 * premStrength + 0.1,
      1
    );
  }

  base.reasons.push(
    `dark pool buy $${Math.round(buyPremium).toLocaleString()} vs sell $${Math.round(sellPremium).toLocaleString()} (${(buyShare * 100).toFixed(0)}% buy, capped)`,
    `${printCount} prints (${buyCount} buy / ${sellCount} sell), ${droppedAtMid} at-mid + ${droppedNoNbbo} no-NBBO + ${droppedAfterHours} AH dropped`
  );
  if (base.windowTruncated) {
    base.reasons.push('window truncated (500-print cap or short fetch)');
  }

  return base;
}

module.exports = { classifyDarkPool, DEFAULTS, FETCH_CAP };
