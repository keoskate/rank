// packages/quant-core/src/volumeProfile.js
//
// Volume profile with a proper 70% value area — THE single profile/value-area
// implementation, shared by the volume-profile research trials and the
// /api/volume-profile chart endpoint. Do not fork: if a consumer needs a
// different binning, extend this module.
//
// Distinct from technicalIndicatorsService.calculateVolumeProfile (legacy
// 20-zone close-binned summary kept for old UI callers): this one bins each
// bar's volume at its per-bar vwap (or HLC/3 typical price when vw is
// absent), computes POC plus a value area expanded greedily around it, and
// is designed to run on minute bars. Daily-bar profiles are a stated
// approximation — a whole day's volume lands at one typical price, which
// smears the value area; callers must say so when they use daily bars.

const { barPrice } = require('./anchoredVwap');

const DEFAULTS = { bins: 40, valueAreaPct: 0.7 };

/**
 * Build a volume-at-price profile over `bars`.
 *
 * @param {object[]} bars - bars with {high, low, close, volume[, vwap]}
 * @param {object} [opts]
 * @param {number} [opts.bins=40]
 * @param {number} [opts.valueAreaPct=0.7]
 * @param {function} [opts.price] - bar => bin price (default barPrice)
 * @returns {{ok: boolean, bins: {pLo:number,pHi:number,vol:number}[],
 *            pocIndex: number, pocPrice: number|null,
 *            vah: number|null, val: number|null, totalVolume: number}}
 *
 * Value-area algorithm: start at the POC bin, repeatedly absorb whichever
 * neighbouring bin (above vs below) carries more volume, until cumulative
 * volume >= valueAreaPct of the total. VAH = top of the highest included
 * bin, VAL = bottom of the lowest included bin.
 */
function buildVolumeProfile(bars, opts = {}) {
  const nBins = opts.bins || DEFAULTS.bins;
  const vaPct = opts.valueAreaPct || DEFAULTS.valueAreaPct;
  const price = opts.price || barPrice;
  const empty = {
    ok: false,
    bins: [],
    pocIndex: -1,
    pocPrice: null,
    vah: null,
    val: null,
    totalVolume: 0,
  };
  if (!Array.isArray(bars) || bars.length === 0) return empty;

  const pts = [];
  for (const b of bars) {
    const v = Number(b.volume);
    const p = price(b);
    if (Number.isFinite(v) && v > 0 && Number.isFinite(p)) pts.push([p, v]);
  }
  if (pts.length === 0) return empty;

  let pMin = Infinity;
  let pMax = -Infinity;
  for (const [p] of pts) {
    if (p < pMin) pMin = p;
    if (p > pMax) pMax = p;
  }

  // Degenerate single-price window: one bin carrying everything.
  if (pMax === pMin) {
    const vol = pts.reduce((s, [, v]) => s + v, 0);
    return {
      ok: true,
      bins: [{ pLo: pMin, pHi: pMax, vol }],
      pocIndex: 0,
      pocPrice: pMin,
      vah: pMax,
      val: pMin,
      totalVolume: vol,
    };
  }

  const width = (pMax - pMin) / nBins;
  const bins = Array.from({ length: nBins }, (_, i) => ({
    pLo: pMin + i * width,
    pHi: pMin + (i + 1) * width,
    vol: 0,
  }));
  let totalVolume = 0;
  for (const [p, v] of pts) {
    const idx = Math.min(Math.floor((p - pMin) / width), nBins - 1);
    bins[idx].vol += v;
    totalVolume += v;
  }

  let pocIndex = 0;
  for (let i = 1; i < nBins; i++) {
    if (bins[i].vol > bins[pocIndex].vol) pocIndex = i;
  }

  // Greedy value-area expansion around the POC.
  let lo = pocIndex;
  let hi = pocIndex;
  let covered = bins[pocIndex].vol;
  const target = vaPct * totalVolume;
  while (covered < target && (lo > 0 || hi < nBins - 1)) {
    const below = lo > 0 ? bins[lo - 1].vol : -1;
    const above = hi < nBins - 1 ? bins[hi + 1].vol : -1;
    if (above >= below) {
      hi++;
      covered += bins[hi].vol;
    } else {
      lo--;
      covered += bins[lo].vol;
    }
  }

  return {
    ok: true,
    bins,
    pocIndex,
    pocPrice: (bins[pocIndex].pLo + bins[pocIndex].pHi) / 2,
    vah: bins[hi].pHi,
    val: bins[lo].pLo,
    totalVolume,
  };
}

/**
 * Naked (untested) POCs: prior-day POCs that price has never traded back
 * through on any later day up to and including `throughIdx`.
 *
 * @param {object[]} days - chronological per-day rows
 *   {date, pocPrice, low, high} — low/high are that DAY's session range.
 * @param {number} [throughIdx=days.length-1] - evaluate "as of" this day
 * @returns {{date: string, pocPrice: number, age: number}[]} naked POCs,
 *   oldest first; age = trading days elapsed since the POC's day.
 */
function nakedPocs(days, throughIdx = (days ? days.length : 0) - 1) {
  if (!Array.isArray(days) || days.length === 0) return [];
  const end = Math.min(throughIdx, days.length - 1);
  const out = [];
  for (let k = 0; k < end; k++) {
    const poc = Number(days[k].pocPrice);
    if (!Number.isFinite(poc)) continue;
    let touched = false;
    for (let j = k + 1; j <= end; j++) {
      if (Number(days[j].low) <= poc && poc <= Number(days[j].high)) {
        touched = true;
        break;
      }
    }
    if (!touched) out.push({ date: days[k].date, pocPrice: poc, age: end - k });
  }
  return out;
}

module.exports = { buildVolumeProfile, nakedPocs, DEFAULTS };
