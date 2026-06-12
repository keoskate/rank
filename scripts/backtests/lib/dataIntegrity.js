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

/**
 * Apply documented waivers to findings ({level, text}) in place:
 * a matching FAIL is downgraded to WARN with the waiver note appended —
 * visible forever, blocking never. Shared by the daily gate below and the
 * minute-bar path in marketData.loadMinuteBars.
 */
function applyWaivers(symbol, findings, knownIssues = _loadKnownIssues()) {
  const waivers = knownIssues.filter(w => w.symbol === symbol);
  for (const f of findings) {
    if (f.level !== 'fail') continue;
    const w = waivers.find(wv => wv.contains && f.text.includes(wv.contains));
    if (w) {
      f.level = 'warn';
      f.text = `waived(${w.status}): ${f.text} — ${w.note.split('.')[0]}`;
    }
  }
  return findings;
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

// ---- D17 (2026-06-12): THIRD-VENDOR leg — Yahoo Finance adjclose ----
// The Polygon cross-check is blind before ~2021-07 (its overlap floor), and
// the secondary-channel validation proved that blindness hid real faults:
// Alpaca's closes deviate 269-321bps from official prints on COVID
// circuit-breaker days (SPY 2020-03-13, GLD 2020-03-17). This leg covers
// the FULL window with the same two checks (terminal-level + sampled 5-day
// returns, corporate-action windows skipped). Yahoo adjclose is
// split+dividend adjusted — the SAME basis as our Alpaca bars — so levels
// and returns are directly comparable (unlike the Polygon leg).
const YAHOO_CACHE_DIR = path.join(
  __dirname,
  '../../../data/backtests/bars-cache-yahoo'
);

function _yahooFetchAdj(symbol, startDate, endDate) {
  fs.mkdirSync(YAHOO_CACHE_DIR, { recursive: true });
  const cp = path.join(
    YAHOO_CACHE_DIR,
    `${symbol}_${startDate}_${endDate}.json`
  );
  if (fs.existsSync(cp)) {
    return Promise.resolve(JSON.parse(fs.readFileSync(cp, 'utf8')));
  }
  const https = require('https');
  const p1 = Math.floor(new Date(startDate).getTime() / 1000);
  const p2 = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  return new Promise(resolve => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => {
          try {
            const r = JSON.parse(d).chart.result[0];
            const ts = r.timestamp;
            const adj = r.indicators.adjclose[0].adjclose;
            const out = [];
            for (let i = 0; i < ts.length; i++) {
              if (adj[i] == null) continue;
              out.push({
                date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
                close: adj[i],
              });
            }
            fs.writeFileSync(cp, JSON.stringify(out));
            resolve(out);
          } catch (e) {
            resolve(null); // soft-fail: leg degrades to warn, never crashes
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

async function checkCrossSourceYahoo(symbol, adjBars, rawCloses) {
  const yBars = await _yahooFetchAdj(
    symbol,
    adjBars[0].date,
    adjBars[adjBars.length - 1].date
  );
  if (!yBars || yBars.length < 50) {
    return { level: 'warn', issues: ['Yahoo third-vendor check unavailable'] };
  }
  const yByDate = new Map(yBars.map(b => [b.date, b.close]));
  const issues = [];

  // corporate-action windows: skip return comparisons straddling factor
  // shifts (same convention as the Polygon leg)
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

  // (a) terminal level (both vendors dividend-adjusted → directly comparable)
  for (let i = adjBars.length - 1; i >= 0; i--) {
    const y = yByDate.get(adjBars[i].date);
    if (y > 0) {
      const diff = Math.abs(y - adjBars[i].close) / adjBars[i].close;
      if (diff > 0.02) {
        issues.push(
          `yahoo LEVEL mismatch at ${adjBars[i].date}: alpaca ${adjBars[i].close} vs yahoo ${y} (${(diff * 100).toFixed(1)}%)`
        );
      }
      break;
    }
  }

  // (b) EVERY daily return across the FULL window (this is the leg that
  // sees 2016-2021, where Polygon cannot). Both series are dividend+split
  // adjusted, so daily returns should agree to bps; a sampled check would
  // miss single-day close faults (SPY 2020-03-13 class) ~95% of the time,
  // which is the exact fault class D17 exists to catch. Windows touching a
  // corporate action are skipped (vendor adjustment-timing differences).
  const DAILY_TOL = 0.01;
  const mismatches = [];
  for (let i = 1; i < adjBars.length; i++) {
    const a0 = adjBars[i - 1];
    const a1 = adjBars[i];
    const y0 = yByDate.get(a0.date);
    const y1 = yByDate.get(a1.date);
    if (!(y0 > 0) || !(y1 > 0)) continue;
    if (factorShiftDates.has(a0.date) || factorShiftDates.has(a1.date)) {
      continue;
    }
    const aRet = a1.close / a0.close - 1;
    const yRet = y1 / y0 - 1;
    if (Math.abs(aRet - yRet) > DAILY_TOL) {
      mismatches.push(
        `yahoo RETURN mismatch ${a0.date}->${a1.date}: alpaca ${(aRet * 100).toFixed(2)}% vs yahoo ${(yRet * 100).toFixed(2)}%`
      );
    }
  }
  if (mismatches.length > 12) {
    // pervasive disagreement = basis mismatch, not isolated bad prints
    issues.push(
      `yahoo RETURN mismatch on ${mismatches.length} days (basis mismatch?) — first: ${mismatches[0]}`
    );
  } else {
    issues.push(...mismatches);
  }
  return { level: issues.length ? 'fail' : 'pass', issues };
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

    // cross-source (Polygon: 2021-07+ overlap only)
    if (polygonClient) {
      const cross = await checkCrossSource(polygonClient, sym, adj, raw);
      if (cross.level !== 'pass') add(cross.level, cross.issues);
      await sleep(150);
    } else {
      add('warn', ['cross-source check skipped (no POLYGON_API_KEY)']);
    }

    // third-vendor leg (D17, Yahoo: full window incl. 2016-2021)
    const yahoo = await checkCrossSourceYahoo(sym, adj, raw);
    if (yahoo.level !== 'pass') add(yahoo.level, yahoo.issues);
    await sleep(400); // be polite to the unauthenticated endpoint

    // apply documented waivers: FAIL -> WARN, never hidden
    applyWaivers(sym, findings, knownIssues);

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
  checkCrossSourceYahoo,
  applyWaivers,
};
