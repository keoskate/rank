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
//
// MINUTE BARS (loadMinuteBars): same one-path discipline, sharded cache under
// data/backtests/minute-bars-cache/<SYM>/<YYYY-MM>_<adj>.json. RTH only
// (09:30–16:00 ET inclusive of the 16:00 auction bar) — extended-hours bars
// are dropped at fetch; a consumer that needs pre/post-market must extend
// this loader, not fetch around it. Adjustment guidance:
//   - research/backtests: 'all' (consistent with the daily sim path)
//   - execution benchmarking: 'raw' — tradingLog fill prices are unadjusted
//     live prices; a later dividend would shift 'all'-adjusted minute bars
//     away from the recorded fills and inject phantom bps.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const alpacaClient = require('../../../server/alpacaClient');

const CACHE_DIR = path.join(__dirname, '../../../data/backtests/bars-cache');
const MINUTE_CACHE_DIR = path.join(
  __dirname,
  '../../../data/backtests/minute-bars-cache'
);
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
const CORRECTIONS_PATH = path.join(__dirname, '../known-data-corrections.json');
let _corrections = null;
function _loadCorrections() {
  if (_corrections) return _corrections;
  try {
    _corrections = JSON.parse(
      fs.readFileSync(CORRECTIONS_PATH, 'utf8')
    ).corrections;
  } catch (e) {
    _corrections = [];
  }
  return _corrections;
}

/**
 * Apply evidence-backed vendor-fault corrections (known-data-corrections.json)
 * to a freshly loaded series, in place. The cache stays vendor-pure; the
 * correction is applied at load time so EVERY consumer sees the same fixed
 * data. The integrity gate's third-vendor leg regression-tests the result.
 * Disable with BACKTEST_DATA_CORRECTIONS=off (for reproducing uncorrected
 * results, e.g. sensitivity runs).
 */
function applyKnownCorrections(symbol, series, quiet = false) {
  if (process.env.BACKTEST_DATA_CORRECTIONS === 'off') return [];
  const applied = [];
  for (const c of _loadCorrections()) {
    if (c.symbol !== symbol) continue;
    if (c.action === 'scale-before') {
      let n = 0;
      for (const b of series) {
        if (b.date >= c.exDate) break;
        for (const f of ['open', 'high', 'low', 'close']) {
          if (b[f] != null) b[f] *= c.factor;
        }
        n++;
      }
      if (n) {
        applied.push(`scale-before ${c.exDate} x${c.factor} (${n} bars)`);
        if (!quiet) {
          console.log(
            `  ✚ ${symbol}: known-data correction applied — scale x${c.factor.toFixed(6)} before ${c.exDate} (${n} bars)`
          );
        }
      }
    }
  }
  return applied;
}

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
    const applied = applyKnownCorrections(sym, series, quiet);
    if (applied.length) integrity.corrections = integrity.corrections || {};
    if (applied.length) integrity.corrections[sym] = applied;
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

// ─────────────────────────────────────────────────────────────────
// Minute bars
// ─────────────────────────────────────────────────────────────────

// One reused ET formatter (Intl construction is expensive; format is not).
const ET_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ET calendar date + minutes-since-midnight for an ISO timestamp. */
function etInfo(iso) {
  const parts = ET_FMT.formatToParts(new Date(iso));
  const get = t => parts.find(p => p.type === t)?.value;
  const hour = parseInt(get('hour'), 10) % 24;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + parseInt(get('minute'), 10),
  };
}

// RTH window in ET minutes: 09:30 (570) … 16:00 (960), inclusive of the
// 16:00 bar which carries the closing auction print.
const RTH_START_MIN = 570;
const RTH_END_MIN = 960;

/** ['2024-03', '2024-04', ...] covering start..end inclusive. */
function monthSpan(start, end) {
  const out = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number);
  const last = end.slice(0, 7);
  for (;;) {
    const tag = `${y}-${String(m).padStart(2, '0')}`;
    out.push(tag);
    if (tag === last) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function lastDayOfMonth(tag) {
  const [y, m] = tag.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

async function fetchMinuteMonth(symbol, fetchStart, fetchEnd, adjustment) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const raw = await alpacaClient.getBars(
        symbol,
        '1Min',
        fetchStart,
        fetchEnd,
        100000,
        adjustment
      );
      return (raw || [])
        .filter(b => b && b.timestamp && b.close > 0)
        .map(b => ({
          t: b.timestamp,
          open: round4(b.open),
          high: round4(b.high),
          low: round4(b.low),
          close: round4(b.close),
          volume: b.volume ?? 0,
          vwap: b.vwap ?? null,
        }))
        .filter(b => {
          const { minutes } = etInfo(b.t);
          return minutes >= RTH_START_MIN && minutes <= RTH_END_MIN;
        });
    } catch (e) {
      await sleep(1500 * (attempt + 1));
    }
  }
  return null;
}

/**
 * Structural sanity for a minute-bar series (already RTH-filtered).
 * Returns findings as {level: 'fail'|'warn', text} so waivers can apply.
 */
function checkMinuteBarsSanity(symbol, bars) {
  const findings = [];
  if (!bars.length) {
    findings.push({ level: 'warn', text: 'empty minute series' });
    return findings;
  }
  const dayCounts = new Map();
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i > 0 && b.t <= bars[i - 1].t) {
      findings.push({
        level: 'fail',
        text: `non-increasing timestamps at ${b.t}`,
      });
      break;
    }
    if (!(b.close > 0) || !(b.open > 0) || !(b.high > 0) || !(b.low > 0)) {
      findings.push({ level: 'fail', text: `non-positive OHLC at ${b.t}` });
      break;
    }
    if (b.high < b.low) {
      findings.push({ level: 'fail', text: `high < low at ${b.t}` });
      break;
    }
    const { date, minutes } = etInfo(b.t);
    if (minutes < RTH_START_MIN || minutes > RTH_END_MIN) {
      findings.push({
        level: 'fail',
        text: `bar outside RTH at ${b.t} (loader filter broken)`,
      });
      break;
    }
    dayCounts.set(date, (dayCounts.get(date) || 0) + 1);
  }
  // Coverage floor per day: full session ≈ 390 bars, half-days ≈ 210.
  // < 200 catches real intraday gaps without flagging scheduled half-days.
  for (const [date, n] of dayCounts) {
    if (n < 200) {
      findings.push({
        level: 'warn',
        text: `only ${n} RTH minute bars on ${date} (gap or halt?)`,
      });
    }
  }
  return findings;
}

/**
 * Load RTH minute bars for symbols over [start, end], sharded month cache.
 * Fully-elapsed months are immutable cache hits; the month containing `end`
 * is cached with a `_to-<end>` suffix and refetched as `end` advances
 * (stale partials for the same month are pruned).
 *
 * Cross-check (adjustment 'all' only): on sampled days, RTH minute volume
 * must be within 10% of the daily-path volume (warn) and the last RTH
 * minute close within 0.5% of the daily close (fail, waivable via
 * known-data-issues.json) — minute and daily paths must describe the same
 * market.
 *
 * @returns {Promise<{bars: Object<string, Array>, integrity: Object}>}
 *   bars: sym -> [{t, open, high, low, close, volume, vwap}]
 */
async function loadMinuteBars(
  symbols,
  { start, end, adjustment = ADJUSTMENT, quiet = false, crossCheck = true } = {}
) {
  if (!start) throw new Error('loadMinuteBars: start is required');
  const safeEnd = maxSafeEnd();
  if (!end || end > safeEnd) {
    if (end && !quiet) console.warn(`  end ${end} clamped to ${safeEnd}`);
    end = safeEnd;
  }
  // Lazy require to avoid a cycle (dataIntegrity imports checkBarsSanity).
  const { applyWaivers } = require('./dataIntegrity');

  const bars = {};
  const integrity = {
    source: 'alpaca',
    adjustment,
    timeframe: '1Min',
    rth: '09:30-16:00 ET inclusive',
    window: { start, end },
    checkedAt: new Date().toISOString(),
    symbols: {},
    failures: [],
  };

  for (const sym of symbols) {
    const symDir = path.join(MINUTE_CACHE_DIR, sym);
    fs.mkdirSync(symDir, { recursive: true });
    const series = [];
    let fetchFailed = false;

    for (const month of monthSpan(start, end)) {
      const monthEnd = lastDayOfMonth(month);
      const complete = monthEnd <= end;
      const shard = complete
        ? path.join(symDir, `${month}_${adjustment}.json`)
        : path.join(symDir, `${month}_${adjustment}_to-${end}.json`);

      let monthBars = null;
      if (fs.existsSync(shard)) {
        monthBars = JSON.parse(fs.readFileSync(shard, 'utf8'));
      } else {
        monthBars = await fetchMinuteMonth(
          sym,
          `${month}-01`,
          complete ? monthEnd : end,
          adjustment
        );
        if (monthBars) {
          if (!complete) {
            // prune stale partial shards for this month+adjustment
            for (const f of fs.readdirSync(symDir)) {
              if (f.startsWith(`${month}_${adjustment}_to-`)) {
                fs.unlinkSync(path.join(symDir, f));
              }
            }
          }
          fs.writeFileSync(shard, JSON.stringify(monthBars));
          await sleep(150);
        } else {
          fetchFailed = true;
          break;
        }
      }
      series.push(...monthBars);
    }

    if (fetchFailed) {
      integrity.failures.push(sym);
      integrity.symbols[sym] = { ok: false, issues: ['minute fetch failed'] };
      if (!quiet) console.warn(`  ✗ ${sym}: minute fetch failed`);
      continue;
    }

    // Slice to the requested window (shards hold whole months).
    const windowed = series.filter(
      b => b.t.slice(0, 10) >= start && b.t.slice(0, 10) <= end
    );
    const findings = checkMinuteBarsSanity(sym, windowed);

    // Cross-check vs the daily path on sampled days ('all' only — the daily
    // cache has no raw variant here).
    if (crossCheck && adjustment === 'all' && windowed.length) {
      const daily = (await loadDailyBars([sym], { start, end, quiet: true }))
        .bars[sym];
      if (daily && daily.length) {
        const dailyByDate = new Map(daily.map(d => [d.date, d]));
        const byDay = new Map();
        for (const b of windowed) {
          const d = etInfo(b.t).date;
          if (!byDay.has(d)) byDay.set(d, []);
          byDay.get(d).push(b);
        }
        const days = [...byDay.keys()].filter(d => dailyByDate.has(d));
        const samples = [
          days[0],
          days[Math.floor(days.length / 2)],
          days[days.length - 1],
        ].filter((d, i, a) => d && a.indexOf(d) === i);
        for (const d of samples) {
          const mins = byDay.get(d);
          const dly = dailyByDate.get(d);
          const minVol = mins.reduce((s, b) => s + (b.volume || 0), 0);
          if (dly.volume > 0) {
            // RTH-only minute volume legitimately runs 10-20% under the
            // consolidated daily figure (pre/post-market, odd lots) —
            // measured 11.5-17.9% on SPY 2026-05/06. Flag only beyond 25%.
            const dv = Math.abs(minVol / dly.volume - 1);
            if (dv > 0.25) {
              findings.push({
                level: 'warn',
                text: `${d}: RTH minute volume ${(dv * 100).toFixed(1)}% off daily volume`,
              });
            }
          }
          const lastClose = mins[mins.length - 1].close;
          const dc = Math.abs(lastClose / dly.close - 1);
          if (dc > 0.005) {
            findings.push({
              level: 'fail',
              text: `${d}: last RTH minute close ${lastClose} vs daily close ${dly.close} (${(dc * 100).toFixed(2)}% — adjustment drift or contamination?)`,
            });
          }
        }
      }
    }

    applyWaivers(sym, findings);
    const ok = !findings.some(f => f.level === 'fail');
    integrity.symbols[sym] = {
      ok,
      issues: findings.map(f => `${f.level}: ${f.text}`),
      bars: windowed.length,
    };
    if (!ok) integrity.failures.push(sym);
    if (findings.length && !quiet) {
      for (const f of findings) console.warn(`  ⚠ ${sym}: ${f.text}`);
    }
    bars[sym] = windowed;
  }
  return { bars, integrity };
}

module.exports = {
  loadDailyBars,
  loadMinuteBars,
  buildCalendar,
  alignCloses,
  applyKnownCorrections,
  checkBarsSanity,
  checkMinuteBarsSanity,
  etInfo,
  maxSafeEnd,
  CACHE_DIR,
  MINUTE_CACHE_DIR,
};
