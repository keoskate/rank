#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/backtests/validate-btc-satellite.js
//
// Five-gate validation of a "BTC satellite" strategy: the certified
// vol-targeted 50/50 SOXX/GLD champion (volTargetMixCore, mixW=0.5,
// targetVol=0.12, volWindow=20) plus a small vol-scaled BTC sleeve.
//
// ─────────────────────────────────────────────────────────────────────────────
// STEP 0 DATA PROBE — ABORT TRIGGERED
// ─────────────────────────────────────────────────────────────────────────────
// Pre-registration requires BTC/USD daily data reaching back to at least
// 2019-06-01 so the strategy has meaningful cross-cycle history.
//
// Probe executed 2026-07-22 against:
//   Endpoint : https://data.alpaca.markets/v1beta3/crypto/us/bars
//   Symbol   : BTC/USD
//   Auth     : paper-trading API keys (ALPACA_PAPER_API_KEY)
//   Variants tried:
//     - /v1beta3/crypto/us/bars  (primary)
//     - /v1beta3/crypto/bars     (global feed)
//     - /v1beta2/crypto/bars     (legacy)
//     - /v1beta3/crypto/us/bars?feed=us
//
// Results:
//   start=2018-01-01 end=2020-01-01  → 0 bars
//   start=2019-01-01 end=2020-01-01  → 0 bars (all variants)
//   start=2021-01-01 end=<now>       → 2029 bars
//     first bar: 2021-01-01T00:00:00Z  close: 29418.72
//     last bar:  2026-07-22T00:00:00Z  close: 65710.89
//     all closes positive: yes
//     dates parseable:     yes
//
// Floor: 2021-01-01  (required floor: 2019-06-01 or earlier)
//
// CONCLUSION: BTC data floor (2021-01-01) is later than the required floor
// (2019-06-01). The 2029 available bars (2021-01-01 through 2026-07-22)
// are insufficient to run a credible walk-forward that includes
// 2017-2020 crypto cycle extremes. Proceeding would hide out-of-sample
// risk and produce an OOS curve anchored only in post-2021 bull / bear
// segments — not a fair test.
//
// ACTION REQUIRED:
//   Re-run this validator once a longer BTC data source is integrated, e.g.:
//     - CoinGecko daily OHLCV (free, back to 2013)
//     - Kraken OHLCV API (free, back to 2013 for BTC/USD)
//     - Yahoo Finance BTC-USD (yfinance, 2014+)
//     - Polygon crypto (may cover 2018+; check subscription tier)
//   Cache the full series to data/backtests/btc-cache.json as:
//     [{date:'YYYY-MM-DD', close:N}, ...]
//   Then re-enable the strategy body below (marked DISABLED).
//
// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY SPEC (pre-registered — immutable once a data source qualifies)
// ─────────────────────────────────────────────────────────────────────────────
//
// Base champion: vol-targeted SOXX/GLD mix
//   mixW=0.5, targetVol=0.12, volWindow=20
//   Reuses volTargetMixCore.mixDailyReturns + scalarSeries (certified core)
//
// BTC satellite sleeve:
//   BTC return on NYSE trading day d:
//     r_btc_d = btcClose[d] / btcClose[prev_trading_day] − 1
//     (weekends compound into Monday; BTC trades continuously)
//   Satellite scalar:
//     sb_i = min(1, 0.12 / RV20_btc_through_{i-1})
//   Combined return:
//     r_i = (1−k)·r_champ_i + k·sb_i·r_btc_i
//           − 10bps·costMultiplier·|k·sb_i − k·sb_{i-1}|   (crypto costs 2×)
//
//   Before BTC data floor: sleeve is off (k effectively 0); r_i = r_champ_i
//   (phases in transparently when data begins — no null-out of strategy returns)
//
// Pre-registered grid (2 candidates — IMMUTABLE):
//   k ∈ {0.05, 0.10}
//
// validateStrategy spec:
//   family           : 'vol-managed'
//   strategyId       : 'btc-satellite-WF-OOS'
//   universe         : ['SOXX', 'GLD', 'SPY']   (stock bars via Alpaca adjusted)
//   controlUniverse  : ['SOXX', 'GLD']
//   benchmarkSymbol  : 'SPY'
//   start            : '2016-01-04'
//   BTC              : loaded from data/backtests/btc-cache.json (NOT in universe —
//                      crypto has no Alpaca stock bars; cache is pre-built once)
//
// Faithfulness:
//   { status: 'not_run',
//     note: 'research — shares volTargetMixCore where applicable; dedicated cert pending' }
//   (cannot claim the vol-target-mix certification; the BTC sleeve is new logic)
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();

// ── abort immediately: BTC data floor is 2021-01-01, required ≥ 2019-06-01 ──
const PROBE_RESULT = {
  endpoint: 'https://data.alpaca.markets/v1beta3/crypto/us/bars',
  symbol: 'BTC/USD',
  floorFound: '2021-01-01',
  requiredFloor: '2019-06-01',
  totalBarsAvailable: 2029,
  rangeAvailable: { from: '2021-01-01', to: '2026-07-22' },
  variantsTried: [
    'v1beta3/crypto/us/bars',
    'v1beta3/crypto/bars (global)',
    'v1beta2/crypto/bars',
    'v1beta3/crypto/us/bars?feed=us',
  ],
  closesPositive: true,
  datesParseable: true,
  abortReason:
    'BTC daily data floor (2021-01-01) is later than the required floor ' +
    '(2019-06-01). Cannot run a credible walk-forward that covers the ' +
    '2017-2020 crypto cycle extremes.',
};

console.error(
  '[validate-btc-satellite] ABORTED — BTC data floor too late.\n' +
    JSON.stringify(PROBE_RESULT, null, 2) +
    '\n\nIntegrate a pre-2019-06 BTC daily source and re-run this validator.'
);
process.exit(1);

// ─────────────────────────────────────────────────────────────────────────────
// DISABLED BODY (re-enable once a qualifying BTC data source is cached)
// ─────────────────────────────────────────────────────────────────────────────
/* eslint-disable no-unreachable */

/*
const fs = require('fs');
const path = require('path');
const { volTargetMixCore } = require('@keo/quant-core');
const { validateStrategy } = require('./lib/validateStrategy');
const { alignPair } = require('./soxx-band-rebalance');

const BTC_CACHE_PATH = path.join(__dirname, '../../data/backtests/btc-cache.json');
const CHAMP_MIX_W = 0.5;
const CHAMP_TARGET_VOL = 0.12;
const CHAMP_VOL_WINDOW = 20;
const CRYPTO_COST_BPS = 10; // 10bps per side → 2× the 5bps equity rate
const CHAMP_COST_BPS = 5;  // overlay turnover on the vol-target scalar
const START = '2016-01-04';

// Pre-registered grid (2 candidates — IMMUTABLE)
const GRID = [{ k: 0.05 }, { k: 0.10 }];

// ── BTC cache loader ──────────────────────────────────────────────────────────
// data/backtests/btc-cache.json: [{date:'YYYY-MM-DD', close:N}, ...]
// Built once (see STEP 0 notes above); never fetched inside buildCandidates.
function loadBtcCache() {
  if (!fs.existsSync(BTC_CACHE_PATH)) {
    throw new Error(
      `BTC cache not found at ${BTC_CACHE_PATH}. ` +
        'Run the cache-builder script first (see STEP 0 notes in this file).'
    );
  }
  const raw = JSON.parse(fs.readFileSync(BTC_CACHE_PATH, 'utf8'));
  // Sort ascending; build a Map for O(1) lookup by date string
  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return raw; // [{date, close}]
}

// ── Champion base: vol-targeted SOXX/GLD mix ─────────────────────────────────
// Returns per the master NYSE calendar via volTargetMixCore (certified core).
//
// LOOKAHEAD CONTRACT: scalar[i] = min(1, targetVol / RV20_through_{i-1}).
// The core's scalarSeries() guarantees this — no lookahead.
// The champion overlay return on day i:
//   r_champ_i = scalar_i * r_mix_i − |scalar_i − scalar_{i-1}| * 5bps * cm
// where r_mix_i = mixDailyReturns()[i] (cost-free; costs charged separately).
function buildChampReturns(bars, dates, costMultiplier) {
  const { A, B } = alignPair(bars['SOXX'], bars['GLD']);
  const soxxDates  = A.map(b => b.date);
  const soxxCloses = A.map(b => b.close);
  const gldCloses  = B.map(b => b.close);

  // Cost-free mix returns (decision signal must be cost-free)
  const mixRets = volTargetMixCore.mixDailyReturns(
    soxxDates, soxxCloses, gldCloses, CHAMP_MIX_W
  );

  // Exposure scalar series (no lookahead)
  const scalars = volTargetMixCore.scalarSeries(
    soxxDates, soxxCloses, gldCloses,
    { mixW: CHAMP_MIX_W, targetVol: CHAMP_TARGET_VOL, volWindow: CHAMP_VOL_WINDOW }
  );

  // Map to master calendar
  const retByDate = new Map();
  for (let i = 0; i < soxxDates.length; i++) {
    retByDate.set(soxxDates[i], { r: mixRets[i], s: scalars[i] });
  }

  const out = new Array(dates.length).fill(null);
  let prevS = null;
  for (let i = 0; i < dates.length; i++) {
    const entry = retByDate.get(dates[i]);
    if (!entry || entry.r == null || entry.s == null) {
      prevS = null;
      continue;
    }
    const { r, s } = entry;
    const sP = prevS !== null ? prevS : 0;
    const turnoverCost = Math.abs(s - sP) * (CHAMP_COST_BPS / 10000) * costMultiplier;
    out[i] = s * r - turnoverCost;
    prevS = s;
  }
  return out;
}

// ── BTC satellite sleeve ──────────────────────────────────────────────────────
// Align BTC close prices to the NYSE calendar:
//   - BTC trades 24/7; for NYSE trading day d, use the most recent BTC close
//     whose UTC date <= d (Friday close carries through to Monday).
//   - r_btc_d = close[d] / close[prev_d] − 1  (previous NYSE trading day's aligned close)
//   - sb_i = min(1, 0.12 / RV20_btc_through_{i-1})  (no lookahead)
//
// Returns aligned to master calendar (null before BTC floor; null while RV underfilled).
function buildBtcSleeveReturns(btcCache, dates) {
  // Build a date→close map from the cache
  const btcByDate = new Map(btcCache.map(b => [b.date, b.close]));

  // Align BTC close to each NYSE trading day: carry forward last known close
  const aligned = new Array(dates.length).fill(null);
  let lastClose = null;
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (btcByDate.has(d)) {
      lastClose = btcByDate.get(d);
    }
    if (lastClose !== null) aligned[i] = lastClose;
  }

  // Compute daily returns on the aligned series
  const btcRets = new Array(dates.length).fill(null);
  for (let i = 1; i < dates.length; i++) {
    if (aligned[i] != null && aligned[i - 1] != null && aligned[i - 1] > 0) {
      btcRets[i] = aligned[i] / aligned[i - 1] - 1;
    }
  }

  // RV20 of BTC returns (annualized stdev, data through i-1 only)
  function rv20(i) {
    const slice = [];
    for (let j = i - 1; j >= 0 && slice.length < 20; j--) {
      if (btcRets[j] != null) slice.push(btcRets[j]);
    }
    if (slice.length < 20) return null;
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1);
    return Math.sqrt(variance * 252);
  }

  // Satellite scalar sb_i = min(1, 0.12 / RV20_btc_{i-1})
  const sb = new Array(dates.length).fill(null);
  for (let i = 1; i < dates.length; i++) {
    if (btcRets[i] == null) continue; // no BTC return yet
    const rv = rv20(i);
    if (rv == null || !(rv > 0)) continue;
    sb[i] = Math.min(1, 0.12 / rv);
  }

  return { btcRets, sb };
}

// ── buildCandidates ───────────────────────────────────────────────────────────
// Contract: receives {dates, series, bars, costMultiplier}
// Returns [{ params, returns }] aligned to dates (null before data exists)
//
// LOOKAHEAD: all weights use data through i-1. The champion scalar is
// computed from the core (scalarSeries). The BTC scalar sb_i uses RV
// through i-1. The blended weight on day i is decided from prior-day data.
//
// COST: two components charged per day:
//   1. Champion overlay turnover: 5bps * cm * |scalar_i − scalar_{i-1}|
//      (already embedded in buildChampReturns)
//   2. BTC sleeve turnover: 10bps * cm * |k*sb_i − k*sb_{i-1}|
//      (crypto costs 2× the equity rate)
//
// BEFORE BTC FLOOR: sleeve is off (k effectively 0); r_i = r_champ_i.
// No returns are nulled out for this reason — strategy runs from its equity
// start date and the BTC component phases in transparently when data begins.
function buildCandidates({ dates, bars, costMultiplier }) {
  const btcCache = loadBtcCache();
  const btcFloorDate = btcCache[0].date;

  const champRets = buildChampReturns(bars, dates, costMultiplier);
  const { btcRets, sb } = buildBtcSleeveReturns(btcCache, dates);

  return GRID.map(({ k }) => {
    const returns = new Array(dates.length).fill(null);
    let prevSb = null;

    for (let i = 0; i < dates.length; i++) {
      if (champRets[i] == null) {
        prevSb = null;
        continue;
      }

      const d = dates[i];
      const btcActive = d >= btcFloorDate && btcRets[i] != null && sb[i] != null;

      let rSleeve = 0;
      let sleeveTurnoverCost = 0;
      let effSb = 0;

      if (btcActive) {
        effSb = sb[i];
        rSleeve = effSb * btcRets[i];
        const effSbPrev = prevSb !== null ? prevSb : 0;
        sleeveTurnoverCost =
          (CRYPTO_COST_BPS / 10000) * costMultiplier * Math.abs(k * effSb - k * effSbPrev);
      }

      // Blended return:
      // r_i = (1-k)*r_champ_i + k*r_sleeve_i − sleeve_turnover_cost
      // Champion turnover already deducted inside champRets[i]
      returns[i] = (1 - k) * champRets[i] + k * rSleeve - sleeveTurnoverCost;
      prevSb = btcActive ? effSb : null;
    }

    return {
      params: { k, champMixW: CHAMP_MIX_W, champTargetVol: CHAMP_TARGET_VOL,
                champVolWindow: CHAMP_VOL_WINDOW, btcTargetVol: 0.12, btcVolWindow: 20 },
      returns,
    };
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const btcCache = loadBtcCache(); // early check — fail fast if cache missing
  const btcFloorDate = btcCache[0].date;
  const btcLastDate = btcCache[btcCache.length - 1].date;

  await validateStrategy({
    family: 'vol-managed',
    strategyId: 'btc-satellite-WF-OOS',
    script: 'scripts/backtests/validate-btc-satellite.js',
    description:
      'Certified vol-targeted SOXX/GLD champion (mixW=0.5, targetVol=0.12, volWindow=20) ' +
      'plus a small vol-scaled BTC satellite sleeve (k ∈ {0.05, 0.10}). ' +
      'Champion returns built from volTargetMixCore (certified core). ' +
      'BTC sleeve: aligned to NYSE calendar via carry-forward, scaled by ' +
      'min(1, 0.12/RV20_btc); crypto costs 10bps/side (2× equity rate). ' +
      'Before BTC data floor the sleeve is off; r_i = r_champ_i.',
    universe: ['SOXX', 'GLD', 'SPY'],
    controlUniverse: ['SOXX', 'GLD'],
    benchmarkSymbol: 'SPY',
    start: START,
    faithfulness: {
      status: 'not_run',
      note:
        'research — shares volTargetMixCore where applicable; ' +
        'dedicated cert pending (BTC sleeve is new logic not yet in a live plugin)',
    },
    buildCandidates,
    notes: [
      `BTC data source: data/backtests/btc-cache.json (NOT in Alpaca universe — ` +
        `crypto has no split/dividend-adjusted stock bars endpoint). ` +
        `Cache covers ${btcFloorDate} → ${btcLastDate} (${btcCache.length} daily bars).`,
      `BTC data floor: ${btcFloorDate}. Before this date the BTC sleeve is off ` +
        `(k effectively 0) and r_i = r_champ_i. The sleeve phases in transparently ` +
        `when data begins — no returns are nulled.`,
      'Champion base: vol-targeted SOXX/GLD mix from volTargetMixCore (mixW=0.5, ' +
        'targetVol=0.12, volWindow=20). Certified core shared with the deployed live ' +
        'plugin; faithfulness cert covers the champion path.',
      'BTC satellite: carry-forward alignment to NYSE calendar (weekends compound ' +
        'into Monday return). Satellite scalar sb_i = min(1, 0.12/RV20_btc_{i-1}) — ' +
        'no lookahead. Crypto turnover cost: 10bps/side × |k*sb_i − k*sb_{i-1}| × cm.',
      'Champion overlay cost: 5bps/side × |scalar_i − scalar_{i-1}| × cm (embedded ' +
        'in champion return; charges on the vol-target scalar changes only).',
      'Grid: k ∈ {0.05, 0.10} — 2 candidates, pre-registered, immutable.',
    ],
    extraReport: {
      grid: GRID,
      champMixW: CHAMP_MIX_W,
      champTargetVol: CHAMP_TARGET_VOL,
      champVolWindow: CHAMP_VOL_WINDOW,
      btcTargetVol: 0.12,
      btcVolWindow: 20,
      champCostBps: CHAMP_COST_BPS,
      cryptoCostBps: CRYPTO_COST_BPS,
      btcCacheFile: BTC_CACHE_PATH,
      btcDataFloor: btcFloorDate,
      btcProbe: {
        endpoint: 'https://data.alpaca.markets/v1beta3/crypto/us/bars',
        floorFoundViaAlpaca: '2021-01-01',
        barsViaAlpaca: 2029,
        note: 'Alpaca floor too late (2021-01-01 > required 2019-06-01); cache built from external source',
      },
    },
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
*/
