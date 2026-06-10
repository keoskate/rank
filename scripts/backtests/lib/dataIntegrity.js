// scripts/backtests/lib/dataIntegrity.js
//
// The data-integrity gate. Catches the failure modes the audit actually
// found in this repo, plus their close relatives:
//   - contaminated ticker (Polygon META reading ~$12): cross-source spot
//     check — Alpaca-adjusted vs Polygon-adjusted closes on sampled dates
//     must agree within tolerance.
//   - fake splits in "adjusted" data (Alpaca raw-vs-adjusted bug): for each
//     day the raw/adjusted price ratio shifts (a corporate action), the
//     ADJUSTED series must NOT show a cliff; and any >40% single-day move in
//     the adjusted series with no matching ratio shift is flagged.
//   - silent history floor (Polygon's 2021-06): first bar must be near the
//     requested start (or the symbol's listing is recorded as a warning).
//   - stale/frozen series: long runs of identical closes.
//   - structural: non-positive OHLC, high<low (from marketData.checkBarsSanity).
//
// Verdict per symbol: pass | warn | fail. The gate FAILS if any traded
// symbol fails; warnings are carried into the artifact so they stay visible.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const alpacaClient = require('../../../server/alpacaClient');
const { checkBarsSanity } = require('./marketData');

// Evidence-backed waivers (checked into git, documented). A waiver downgrades
// a matching FAIL finding to WARN — visible forever, blocking never.
const KNOWN_ISSUES_PATH = path.join(__dirname, '../known-data-issues.json');
function _loadKnownIssues() {
  try {
    return JSON.parse(fs.readFileSync(KNOWN_ISSUES_PATH, 'utf8')).issues || [];
  } catch (e) {
    return [];
  }
}

const RAW_CACHE_DIR = path.join(
  __dirname,
  '../../../data/backtests/bars-cache-raw'
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function _fetchRawCloses(symbol, start, end) {
  fs.mkdirSync(RAW_CACHE_DIR, { recursive: true });
  const cp = path.join(RAW_CACHE_DIR, `${symbol}_${start}_${end}_raw.json`);
  if (fs.existsSync(cp)) return JSON.parse(fs.readFileSync(cp, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bars = await alpacaClient.getBars(
        symbol,
        '1Day',
        start,
        end,
        10000,
        'raw'
      );
      const out = (bars || [])
        .filter(b => b && b.timestamp && b.close > 0)
        .map(b => ({ date: b.timestamp.slice(0, 10), close: b.close }));
      fs.writeFileSync(cp, JSON.stringify(out));
      await sleep(150);
      return out;
    } catch (e) {
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

/**
 * Raw-vs-adjusted consistency for one symbol.
 * Returns { issues: [], corporateActions: n } — issues are FAIL-level.
 */
function checkAdjustmentConsistency(adjBars, rawCloses) {
  const issues = [];
  if (!rawCloses || !rawCloses.length) {
    return {
      issues: ['raw series unavailable for adjustment check'],
      level: 'warn',
    };
  }
  const rawByDate = new Map(rawCloses.map(b => [b.date, b.close]));
  let prevRatio = null;
  let prevDate = null;
  let corporateActions = 0;
  for (let i = 0; i < adjBars.length; i++) {
    const b = adjBars[i];
    const raw = rawByDate.get(b.date);
    if (raw == null) continue;
    const ratio = raw / b.close; // cumulative adjustment factor
    if (prevRatio != null) {
      const ratioShift = ratio / prevRatio - 1;
      const adjMove = i > 0 ? adjBars[i].close / adjBars[i - 1].close - 1 : 0;
      if (Math.abs(ratioShift) > 0.02) {
        corporateActions++;
        // a real corporate action: adjusted series must be smooth across it
        if (Math.abs(adjMove) > 0.4) {
          issues.push(
            `corporate action ${prevDate}->${b.date} (factor shift ${(ratioShift * 100).toFixed(0)}%) but adjusted series still moves ${(adjMove * 100).toFixed(0)}% — adjustment NOT applied`
          );
        }
      } else if (Math.abs(adjMove) > 0.4) {
        // huge move with no factor shift: real crash or contamination — at
        // minimum it deserves eyes
        issues.push(
          `${(adjMove * 100).toFixed(0)}% single-day move at ${b.date} with no corporate-action factor shift (real event or contamination?)`
        );
      }
    }
    prevRatio = ratio;
    prevDate = b.date;
  }
  return { issues, corporateActions, level: issues.length ? 'fail' : 'pass' };
}

/**
 * Cross-source spot check against Polygon over the overlap window (Polygon
 * floors ~2021-06). Catches contaminated tickers (e.g. META @ $12).
 *
 * IMPORTANT: Alpaca 'all' is split+dividend adjusted; Polygon adjusted=true
 * is split-only — historical LEVELS legitimately drift apart by cumulative
 * dividend yield (TLT diverges ~18% at 2021). So we do NOT compare old
 * levels. Instead:
 *   (a) returns agreement on ~12 sampled 5-day windows — both vendors must
 *       see the same price moves (ex-dividend days cause sub-1% wiggle,
 *       garbage data does not survive this);
 *   (b) level agreement on the most recent common date, where both
 *       adjustment conventions anchor to the actual traded price — catches
 *       wrong-scale contamination outright.
 */
async function checkCrossSource(polygonClient, symbol, adjBars, rawCloses) {
  const overlap = adjBars.filter(b => b.date >= '2021-07-01');
  if (overlap.length < 50) {
    return {
      level: 'warn',
      issues: ['no Polygon overlap window to cross-check'],
    };
  }
  // Dates where the raw/adjusted factor shifts >1% are corporate actions
  // (dividends/splits). Alpaca-adjusted vs Polygon-split-only returns
  // legitimately diverge across them (e.g. DBC's ~4.7% annual distribution),
  // so return windows straddling one are skipped, not flagged.
  const factorShiftDates = new Set();
  if (rawCloses && rawCloses.length) {
    const rawByDate = new Map(rawCloses.map(b => [b.date, b.close]));
    let prevRatio = null;
    for (const b of adjBars) {
      const raw = rawByDate.get(b.date);
      if (raw == null) continue;
      const ratio = raw / b.close;
      if (prevRatio != null && Math.abs(ratio / prevRatio - 1) > 0.01) {
        factorShiftDates.add(b.date);
      }
      prevRatio = ratio;
    }
  }
  try {
    const start = overlap[0].date;
    const end = overlap[overlap.length - 1].date;
    const pBars = await polygonClient.getHistoricalAggregates(
      symbol,
      start,
      end,
      'day'
    );
    if (!pBars || pBars.length < 50) {
      return {
        level: 'warn',
        issues: ['Polygon returned too little data to cross-check'],
      };
    }
    const pByDate = new Map(pBars.map(b => [b.date, b.close ?? b.c]));
    const issues = [];

    // (b) level check at the most recent common date
    let lastCommon = null;
    for (let i = overlap.length - 1; i >= 0 && !lastCommon; i--) {
      const p = pByDate.get(overlap[i].date);
      if (p > 0) lastCommon = { a: overlap[i].close, p, date: overlap[i].date };
    }
    if (lastCommon) {
      const diff = Math.abs(lastCommon.p - lastCommon.a) / lastCommon.a;
      if (diff > 0.02) {
        issues.push(
          `cross-source LEVEL mismatch at ${lastCommon.date}: alpaca ${lastCommon.a} vs polygon ${lastCommon.p} (${(diff * 100).toFixed(1)}%) — contaminated series?`
        );
      }
    }

    // (a) returns agreement on sampled 5-day windows
    const step = Math.max(5, Math.floor(overlap.length / 12));
    let checked = 0;
    for (let i = 0; i + 5 < overlap.length; i += step) {
      const a0 = overlap[i];
      const a1 = overlap[i + 5];
      const p0 = pByDate.get(a0.date);
      const p1 = pByDate.get(a1.date);
      if (!(p0 > 0) || !(p1 > 0)) continue;
      // skip windows straddling a corporate action (see factorShiftDates)
      if (overlap.slice(i + 1, i + 6).some(b => factorShiftDates.has(b.date))) {
        continue;
      }
      checked++;
      const aRet = a1.close / a0.close - 1;
      const pRet = p1 / p0 - 1;
      if (Math.abs(aRet - pRet) > 0.02) {
        issues.push(
          `cross-source RETURN mismatch ${a0.date}->${a1.date}: alpaca ${(aRet * 100).toFixed(1)}% vs polygon ${(pRet * 100).toFixed(1)}%`
        );
      }
    }
    if (!checked)
      return { level: 'warn', issues: ['no comparable cross-source dates'] };
    return { level: issues.length ? 'fail' : 'pass', issues, checked };
  } catch (e) {
    return {
      level: 'warn',
      issues: [`cross-source check errored: ${e.message}`],
    };
  }
}

/** Frozen-series check: N+ consecutive identical closes. */
function checkStaleRuns(adjBars, maxRun = 6) {
  let run = 1;
  let worst = 1;
  let worstDate = null;
  for (let i = 1; i < adjBars.length; i++) {
    if (adjBars[i].close === adjBars[i - 1].close) {
      run++;
      if (run > worst) {
        worst = run;
        worstDate = adjBars[i].date;
      }
    } else run = 1;
  }
  if (worst >= maxRun) {
    return {
      level: 'warn',
      issues: [
        `${worst} consecutive identical closes ending ${worstDate} (frozen feed?)`,
      ],
    };
  }
  return { level: 'pass', issues: [] };
}

/**
 * Run the full integrity gate over the adjusted bars a backtest will use.
 *
 * @param {Object<string, Array>} bars - sym -> adjusted OHLCV bars
 * @param {object} opts - { start, end, symbols (default: all), crossSource
 *        (default true if POLYGON_API_KEY present) }
 * @returns {{ status: 'pass'|'warn'|'fail', perSymbol, summary }}
 */
async function runDataIntegrityGate(bars, opts = {}) {
  const symbols = opts.symbols || Object.keys(bars);
  const start = opts.start;
  const end = opts.end;
  const doCross = opts.crossSource ?? Boolean(process.env.POLYGON_API_KEY);
  let polygonClient = null;
  if (doCross) {
    // lazy-require so the gate works without polygon configured
    polygonClient = require('../../../server/polygonClient');
  }

  const knownIssues = _loadKnownIssues();
  const perSymbol = {};
  let worst = 'pass';
  const bump = level => {
    if (level === 'fail') worst = 'fail';
    else if (level === 'warn' && worst === 'pass') worst = 'warn';
  };

  for (const sym of symbols) {
    const adj = bars[sym];
    if (!adj || !adj.length) {
      perSymbol[sym] = { level: 'fail', issues: ['no data'] };
      bump('fail');
      continue;
    }
    const findings = []; // { level, text }
    const add = (lvl, list) => {
      for (const text of list) findings.push({ level: lvl, text });
    };

    // structural (history floor is warn-level: late listings are legitimate)
    for (const s of checkBarsSanity(sym, adj, start || adj[0].date)) {
      add(s.startsWith('history starts') ? 'warn' : 'fail', [s]);
    }

    // raw vs adjusted
    const raw = await _fetchRawCloses(
      sym,
      start || adj[0].date,
      end || adj[adj.length - 1].date
    );
    const adjCheck = checkAdjustmentConsistency(adj, raw);
    if (adjCheck.level !== 'pass') add(adjCheck.level, adjCheck.issues);

    // stale runs
    const stale = checkStaleRuns(adj);
    if (stale.level !== 'pass') add(stale.level, stale.issues);

    // cross-source
    if (polygonClient) {
      const cross = await checkCrossSource(polygonClient, sym, adj, raw);
      if (cross.level !== 'pass') add(cross.level, cross.issues);
      await sleep(150);
    } else {
      add('warn', ['cross-source check skipped (no POLYGON_API_KEY)']);
    }

    // apply documented waivers: FAIL -> WARN, never hidden
    const waivers = knownIssues.filter(w => w.symbol === sym);
    for (const f of findings) {
      if (f.level !== 'fail') continue;
      const w = waivers.find(wv => wv.contains && f.text.includes(wv.contains));
      if (w) {
        f.level = 'warn';
        f.text = `waived(${w.status}): ${f.text} — ${w.note.split('.')[0]}`;
      }
    }

    const level = findings.some(f => f.level === 'fail')
      ? 'fail'
      : findings.some(f => f.level === 'warn')
        ? 'warn'
        : 'pass';
    perSymbol[sym] = {
      level,
      issues: findings.map(f => f.text),
      corporateActions: adjCheck.corporateActions,
    };
    bump(level);
  }

  return {
    status: worst,
    checkedAt: new Date().toISOString(),
    perSymbol,
    summary: {
      pass: symbols.filter(s => perSymbol[s].level === 'pass').length,
      warn: symbols.filter(s => perSymbol[s].level === 'warn').length,
      fail: symbols.filter(s => perSymbol[s].level === 'fail').length,
    },
  };
}

module.exports = {
  runDataIntegrityGate,
  checkAdjustmentConsistency,
  checkStaleRuns,
};
