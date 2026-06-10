// scripts/backtests/lib/executionBenchmark.js
//
// VWAP/close execution residuals for sim (and later paper) fills — the
// machine-readable input to the ROADMAP A3 sim→paper promotion rule.
//
// Consumed by scripts/monitorExecutionFaithfulness.js, which already matches
// tradingLog fills against the deployed backtest's expected trades. This
// module adds, per matched fill:
//   - closeResidualBps: fill vs the ACTUAL 16:00 ET close (raw minute bar),
//   - vwapResidualBps:  fill vs VWAP(fill time → close) from raw minute bars
//     via the quant-core anchoredVwap definition (the one VWAP definition).
// Both are side-signed: positive = the fill was WORSE than the benchmark
// (paid more on a buy / received less on a sell).
//
// ADJUSTMENT IS LOAD-BEARING: tradingLog fills are unadjusted live prices,
// so the minute bars here MUST be adjustment:'raw'. The monitor's original
// residual (vs the dividend-adjusted backtest close) is kept separately —
// after any ex-div the two will legitimately diverge by the dividend.
//
// Also writes the machine-readable report the promotion rule consumes:
//   data/reports/execution-faithfulness/<lastBarDate>.json  (dated history)
//   data/reports/execution-faithfulness/latest.json         (stable pointer)
// consecutiveWeeksInTolerance derives from the dated history files.

const fs = require('fs');
const path = require('path');
const { anchoredVwap } = require('@keo/quant-core');
const { loadMinuteBars, etInfo } = require('./marketData');

const REPORT_DIR = path.join(
  __dirname,
  '../../../data/reports/execution-faithfulness'
);

// PRE-REGISTERED A3 tolerance (manifest 2026-06-10-night D5): promotion
// discussion requires decision-match >= 95% and median |residual| <= 25 bps
// over >= 4 consecutive weeks.
const TOLERANCE = { minDecisionMatchRate: 0.95, maxMedianAbsResidualBps: 25 };

/**
 * Pure per-fill residual math against one day's RTH minute bars.
 *
 * @param {{timestamp: string, side: 'buy'|'sell', price: number}} fill
 * @param {object[]} dayBars - that ET day's RTH minute bars (chronological)
 * @returns {{actualClose: number|null, closeResidualBps: number|null,
 *            vwapToClose: number|null, vwapResidualBps: number|null}}
 */
function residualForFill(fill, dayBars) {
  const out = {
    actualClose: null,
    closeResidualBps: null,
    vwapToClose: null,
    vwapResidualBps: null,
  };
  if (!Array.isArray(dayBars) || dayBars.length === 0) return out;
  const sign = fill.side === 'sell' ? -1 : 1;

  const last = dayBars[dayBars.length - 1];
  out.actualClose = last.close;
  out.closeResidualBps = sign * (fill.price / last.close - 1) * 1e4;

  let fillIdx = dayBars.findIndex(b => b.t >= fill.timestamp);
  if (fillIdx === -1) fillIdx = dayBars.length - 1; // fill after last bar
  const vwap = anchoredVwap.vwapBetween(dayBars, fillIdx, dayBars.length - 1);
  if (vwap != null) {
    out.vwapToClose = vwap;
    out.vwapResidualBps = sign * (fill.price / vwap - 1) * 1e4;
  }
  return out;
}

/**
 * Enrich matched fills (each {date, timestamp, symbol, side, price, ...})
 * with raw-minute-bar residuals. Fetches one (symbol, month) shard per
 * unique fill month via loadMinuteBars(adjustment:'raw').
 */
async function enrichFillsWithVwap(fills, { quiet = true } = {}) {
  const out = [];
  const cache = new Map(); // `${sym}|${date}` -> dayBars
  for (const f of fills) {
    const key = `${f.symbol}|${f.date}`;
    if (!cache.has(key)) {
      const { bars } = await loadMinuteBars([f.symbol], {
        start: f.date,
        end: f.date,
        adjustment: 'raw',
        crossCheck: false,
        quiet,
      });
      const series = bars[f.symbol] || [];
      cache.set(
        key,
        series.filter(b => etInfo(b.t).date === f.date)
      );
    }
    out.push({ ...f, ...residualForFill(f, cache.get(key)) });
  }
  return out;
}

/** |x| quantile summary used for every residual block. */
function summarizeAbsBps(values) {
  const abs = values
    .filter(v => Number.isFinite(v))
    .map(Math.abs)
    .sort((a, b) => a - b);
  if (!abs.length) return { p50: null, p95: null, max: null, n: 0 };
  const q = p => {
    const idx = (abs.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return abs[lo] + (abs[hi] - abs[lo]) * (idx - lo);
  };
  return { p50: q(0.5), p95: q(0.95), max: abs[abs.length - 1], n: abs.length };
}

/** ISO-week key (YYYY-Www) for a YYYY-MM-DD date string. */
function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Walk the dated history files newest-first and count consecutive ISO weeks
 * meeting the pre-registered tolerance. A week counts iff its newest report
 * has fills (nMatched > 0), decisionMatchRate >= 95% and median
 * |vwapResidualBps| <= 25. Any gap or miss breaks the streak.
 */
function consecutiveWeeksInTolerance(reportDir = REPORT_DIR, tol = TOLERANCE) {
  let files;
  try {
    files = fs
      .readdirSync(reportDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();
  } catch {
    return 0;
  }
  const newestByWeek = new Map();
  for (const f of files) {
    const wk = isoWeekKey(f.slice(0, 10));
    if (!newestByWeek.has(wk)) {
      try {
        newestByWeek.set(
          wk,
          JSON.parse(fs.readFileSync(path.join(reportDir, f), 'utf8'))
        );
      } catch {
        newestByWeek.set(wk, null);
      }
    }
  }
  let streak = 0;
  for (const [, rep] of newestByWeek) {
    const ok =
      rep &&
      rep.nMatched > 0 &&
      rep.decisionMatchRate != null &&
      rep.decisionMatchRate >= tol.minDecisionMatchRate &&
      rep.residuals?.vsVwapToClose?.p50 != null &&
      rep.residuals.vsVwapToClose.p50 <= tol.maxMedianAbsResidualBps;
    if (!ok) break;
    streak++;
  }
  return streak;
}

/**
 * Write the dated JSON + latest.json the A3 promotion rule consumes.
 * `payload` must include lastBarDate; consecutiveWeeksInTolerance is
 * computed AFTER writing the dated file so the current week counts itself.
 */
function writeExecutionReport(payload, reportDir = REPORT_DIR) {
  if (!payload || !payload.lastBarDate) {
    throw new Error('writeExecutionReport: payload.lastBarDate required');
  }
  fs.mkdirSync(reportDir, { recursive: true });
  const dated = path.join(reportDir, `${payload.lastBarDate}.json`);
  fs.writeFileSync(dated, JSON.stringify(payload, null, 2));
  const full = {
    ...payload,
    consecutiveWeeksInTolerance: consecutiveWeeksInTolerance(reportDir),
    tolerance: TOLERANCE,
  };
  fs.writeFileSync(dated, JSON.stringify(full, null, 2));
  fs.writeFileSync(
    path.join(reportDir, 'latest.json'),
    JSON.stringify(full, null, 2)
  );
  return full;
}

module.exports = {
  residualForFill,
  enrichFillsWithVwap,
  summarizeAbsBps,
  consecutiveWeeksInTolerance,
  writeExecutionReport,
  isoWeekKey,
  REPORT_DIR,
  TOLERANCE,
};
