// scripts/backtests/lib/marketData.js
//
// THE one validated data path for backtests.
//
// Every backtest that wants daily bars goes through loadDailyBars(). This is
// where the lessons from the data audit are encoded once instead of
// re-discovered per script:
//  - Source: Alpaca (reaches 2016-01-04). Polygon's getHistoricalAggregates
//    silently floors at ~2021-06 — scripts that used it thought they tested
//    2018+ but didn't.
//  - adjustment: 'all' (split + dividend adjusted). Without it Alpaca returns
//    RAW prices and every split looks like a -75/-95% crash.
//  - Full OHLCV is returned (not just closes) so the run artifact can carry
//    real candles for the viewer — the chart shows the exact bars the sim saw.
//  - Sanity checks run on every fetch (see checkBarsSanity). Part 2 of the
//    reliability work expands these into a blocking integrity gate; for now
//    failures are recorded and surfaced in the run artifact.
//
// Bars are cached per (symbol, start, end, adjustment) under
// data/backtests/bars-cache/ so re-runs are instant and deterministic.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const alpacaClient = require('../../../server/alpacaClient');

const CACHE_DIR = path.join(__dirname, '../../../data/backtests/bars-cache');
const ADJUSTMENT = 'all';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Latest end date the Alpaca free tier will serve without erroring
 * ("subscription does not permit querying recent SIP data"). Daily bars for
 * the current/most-recent sessions aren't final anyway, so backtests should
 * not see them. 3 days back matches the convention proven in overlays.js.
 */
function maxSafeEnd() {
  return new Date(Date.now() - 3 * 864e5).toISOString().split('T')[0];
}

function cachePath(symbol, start, end) {
  return path.join(CACHE_DIR, `${symbol}_${start}_${end}_${ADJUSTMENT}.json`);
}

/**
 * Cheap structural sanity checks on a bar series. Returns a list of issue
 * strings (empty = clean). These catch the failure modes the audit found:
 * contaminated tickers (absurd price levels / jumps), fake splits in
 * supposedly-adjusted data, and truncated history.
 */
function checkBarsSanity(symbol, bars, start) {
  const issues = [];
  if (!bars.length) {
    issues.push('empty series');
    return issues;
  }
  // History floor: first bar should be within ~10 trading days of requested
  // start (for symbols that existed then).
  const firstDate = bars[0].date;
  const reqStart = new Date(start);
  const gotStart = new Date(firstDate);
  const lagDays = (gotStart - reqStart) / 864e5;
  if (lagDays > 21) {
    issues.push(
      `history starts ${firstDate}, ${Math.round(lagDays)}d after requested ${start} (floor or late listing)`
    );
  }
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!(b.close > 0) || !(b.open > 0) || !(b.high > 0) || !(b.low > 0)) {
      issues.push(`non-positive OHLC at ${b.date}`);
      break;
    }
    if (b.high < b.low) {
      issues.push(`high < low at ${b.date}`);
      break;
    }
  }
  // Split-shaped cliffs in adjusted data: a close-to-close move beyond ±60%
  // in a mega-cap daily series is almost always a data fault, not a price.
  for (let i = 1; i < bars.length; i++) {
    const r = bars[i].close / bars[i - 1].close - 1;
    if (r < -0.6 || r > 1.5) {
      issues.push(
        `suspicious ${(r * 100).toFixed(0)}% close-to-close jump ${bars[i - 1].date} -> ${bars[i].date} (unadjusted split or contamination?)`
      );
    }
  }
  return issues;
}

async function fetchOne(symbol, start, end) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await alpacaClient.getBars(
        symbol,
        '1Day',
        start,
        end,
        10000,
        ADJUSTMENT
      );
      return (raw || [])
        .filter(b => b && b.timestamp && b.close > 0)
        .map(b => ({
          date: b.timestamp.slice(0, 10),
          open: round4(b.open),
          high: round4(b.high),
          low: round4(b.low),
          close: round4(b.close),
          volume: b.volume ?? null,
        }));
    } catch (e) {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

/**
 * Load split+dividend-adjusted daily OHLCV bars for a list of symbols.
 *
 * @returns {Promise<{bars: Object<string, Array>, integrity: Object}>}
 *   bars: sym -> [{date, open, high, low, close, volume}]
 *   integrity: { source, adjustment, checkedAt, symbols: {sym: {ok, issues}},
 *                failures: [sym] }
 */
async function loadDailyBars(symbols, { start, end, quiet = false } = {}) {
  if (!start) throw new Error('loadDailyBars: start is required');
  const safeEnd = maxSafeEnd();
  if (!end || end > safeEnd) {
    if (end && !quiet) {
      console.warn(
        `  end ${end} clamped to ${safeEnd} (Alpaca free tier blocks recent SIP data)`
      );
    }
    end = safeEnd;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const bars = {};
  const integrity = {
    source: 'alpaca',
    adjustment: ADJUSTMENT,
    timeframe: '1Day',
    window: { start, end },
    checkedAt: new Date().toISOString(),
    symbols: {},
    failures: [],
  };

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const cp = cachePath(sym, start, end);
    let series = null;
    if (fs.existsSync(cp)) {
      series = JSON.parse(fs.readFileSync(cp, 'utf8'));
    } else {
      series = await fetchOne(sym, start, end);
      if (series) fs.writeFileSync(cp, JSON.stringify(series));
      await sleep(150);
    }
    if (!series || !series.length) {
      integrity.failures.push(sym);
      integrity.symbols[sym] = { ok: false, issues: ['fetch failed or empty'] };
      if (!quiet) console.warn(`  ✗ ${sym}: fetch failed/empty`);
      continue;
    }
    const issues = checkBarsSanity(sym, series, start);
    integrity.symbols[sym] = {
      ok: issues.length === 0,
      issues,
      bars: series.length,
    };
    if (issues.length && !quiet) {
      for (const iss of issues) console.warn(`  ⚠ ${sym}: ${iss}`);
    }
    bars[sym] = series;
    if (!quiet && (i + 1) % 10 === 0) {
      console.log(`  …${i + 1}/${symbols.length} symbols loaded`);
    }
  }
  return { bars, integrity };
}

/**
 * Build the master trading-day calendar from a reference symbol (SPY).
 */
function buildCalendar(bars, refSym = 'SPY') {
  if (!bars[refSym]) throw new Error(`buildCalendar: no ${refSym} bars`);
  return bars[refSym].map(b => b.date);
}

/**
 * Align close series onto the master calendar with forward-fill.
 * @returns {Object<string, Array<number|null>>}
 */
function alignCloses(bars, dates) {
  const series = {};
  for (const sym of Object.keys(bars)) {
    const m = {};
    for (const b of bars[sym]) m[b.date] = b.close;
    const arr = [];
    let last = null;
    for (const d of dates) {
      if (m[d] != null) last = m[d];
      arr.push(last);
    }
    series[sym] = arr;
  }
  return series;
}

module.exports = {
  loadDailyBars,
  buildCalendar,
  alignCloses,
  checkBarsSanity,
  maxSafeEnd,
  CACHE_DIR,
};
