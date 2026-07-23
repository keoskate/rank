// server/maintenanceJobs.js — self-driving maintenance the humans forget.
//
// Two chores are CRITICAL but were manual (2026-07-23 review: "I won't
// remember to manually do these things"):
//
//  1. INSIDER CAPTURE — UW's insider feed forgets in ~2 weeks; a missed week
//     loses filings forever (see server/insiderArchive.js). Runs daily,
//     in-process, any hour (the feed is a rolling window) + boot catch-up.
//  2. CERT FRESHNESS — gate 2 (faithfulness) rejects certifications older
//     than 30 days (validateStrategy CERT_MAX_AGE_DAYS). Certify scripts are
//     re-run automatically at 25d (buffer), off-hours; a cert ALREADY stale
//     (>30d) is regenerated immediately — the gate is failing anyway, so
//     sooner is strictly better.
//
// Design: one tick every 30 min; jobs serialized (one child process at a
// time); every outcome logged via tradingLogger + persisted to
// data/maintenance-state.json so restarts don't double-run and status tools
// can display last-run times. Failures log and retry after a cooldown —
// nothing here may ever crash the server.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const tradingLogger = require('./tradingLogger');
const insiderArchive = require('./insiderArchive');

const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'maintenance-state.json');

const TICK_MS = 30 * 60 * 1000;
const BOOT_DELAY_MS = 90 * 1000; // let the server settle first
const INSIDER_EVERY_H = 20; // "daily" with slack for restart drift
const CERT_REFRESH_AGE_D = 25; // regenerate before the 30d gate limit
const CERT_STALE_AGE_D = 30; // already failing → regenerate any hour
const CERT_RETRY_COOLDOWN_H = 12; // don't thrash a persistently failing cert
const CERT_TIMEOUT_MS = 20 * 60 * 1000;

// cert name (data/backtests/certifications/<name>.json) → certify script.
const CERTS = {
  'trend-core': 'scripts/backtests/certify-trend-core.js',
  'vol-target-mix': 'scripts/backtests/certify-vol-target-mix.js',
  'entropy-gate': 'scripts/backtests/certify-entropy-gate.js',
};

let state = null;
let childRunning = false;

function loadState() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    state = { certRuns: {} };
  }
  if (!state.certRuns) state.certRuns = {};
  return state;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    /* state loss = at worst one duplicate run */
  }
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 36e5 : Infinity;
}

/** ET hour (0-23) — cert children stay out of market hours unless stale. */
function etHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10
  );
}
function isMarketHoursEt() {
  const h = etHour();
  return h >= 9 && h < 17; // generous RTH envelope incl. open/close edges
}

async function runInsiderCapture() {
  const s = loadState();
  if (hoursSince(s.lastInsiderCaptureAt) < INSIDER_EVERY_H) return;
  try {
    const r = await insiderArchive.captureOnce();
    s.lastInsiderCaptureAt = new Date().toISOString();
    s.lastInsiderResult = r.error
      ? { error: r.error }
      : { rowsAdded: r.rowsAdded, newest: r.newestFiling };
    saveState();
    tradingLogger.logInfo(
      r.error
        ? `Maintenance: insider capture FAILED — ${r.error}`
        : `Maintenance: insider capture ok — ${r.rowsAdded} new filings (feed ${r.oldestFiling}..${r.newestFiling})`,
      { job: 'insider-capture', ...s.lastInsiderResult }
    );
  } catch (e) {
    tradingLogger.logError(`Maintenance: insider capture crashed`, {
      job: 'insider-capture',
      error: e.message,
    });
  }
}

function certAgeDays(name) {
  try {
    const c = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'data/backtests/certifications', `${name}.json`),
        'utf8'
      )
    );
    return (Date.now() - Date.parse(c.generatedAt)) / 864e5;
  } catch (e) {
    return Infinity; // missing/corrupt cert = maximally stale
  }
}

function refreshCert(name, script, ageDays) {
  childRunning = true;
  const s = loadState();
  s.certRuns[name] = {
    ...(s.certRuns[name] || {}),
    lastAttemptAt: new Date().toISOString(),
  };
  saveState();
  tradingLogger.logInfo(
    `Maintenance: refreshing certification '${name}' (age ${ageDays.toFixed(1)}d) — node ${script}`,
    { job: 'cert-refresh', cert: name }
  );
  execFile(
    'node',
    [script],
    { cwd: ROOT, timeout: CERT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    (err, stdout) => {
      childRunning = false;
      const ok = !err;
      s.certRuns[name].lastResult = ok ? 'certified' : `failed: ${err.message}`;
      s.certRuns[name].lastFinishedAt = new Date().toISOString();
      saveState();
      const tail = (stdout || '').trim().split('\n').slice(-2).join(' | ');
      if (ok) {
        tradingLogger.logInfo(
          `Maintenance: certification '${name}' refreshed — ${tail}`,
          { job: 'cert-refresh', cert: name }
        );
      } else {
        // A FAILED certify run is a live==backtest divergence or a data
        // problem — loud, because gate 2 will (correctly) start failing.
        tradingLogger.logError(
          `Maintenance: certification '${name}' refresh FAILED — ${err.message} — ${tail}`,
          { job: 'cert-refresh', cert: name }
        );
      }
    }
  );
}

function runCertRefreshes() {
  if (childRunning) return; // one child at a time
  const s = loadState();
  for (const [name, script] of Object.entries(CERTS)) {
    if (!fs.existsSync(path.join(ROOT, script))) continue;
    const age = certAgeDays(name);
    if (age < CERT_REFRESH_AGE_D) continue;
    const urgent = age >= CERT_STALE_AGE_D;
    if (!urgent && isMarketHoursEt()) continue; // aging-but-valid waits for off-hours
    if (
      hoursSince((s.certRuns[name] || {}).lastAttemptAt) < CERT_RETRY_COOLDOWN_H
    )
      continue;
    refreshCert(name, script, age);
    return; // serialize: next tick picks up the next one
  }
}

async function tick() {
  try {
    await runInsiderCapture();
  } catch (e) {
    /* logged inside */
  }
  try {
    runCertRefreshes();
  } catch (e) {
    tradingLogger.logError('Maintenance: cert scheduler crashed', {
      error: e.message,
    });
  }
}

/** Current job state for status tools. */
function maintenanceStatus() {
  const s = loadState();
  return {
    lastInsiderCaptureAt: s.lastInsiderCaptureAt || null,
    lastInsiderResult: s.lastInsiderResult || null,
    certs: Object.fromEntries(
      Object.keys(CERTS).map(n => [
        n,
        {
          ageDays: Math.round(certAgeDays(n) * 10) / 10,
          ...(s.certRuns[n] || {}),
        },
      ])
    ),
    childRunning,
  };
}

function start({ logger = console } = {}) {
  loadState();
  logger.log(
    `🔧 Maintenance jobs armed: insider capture every ${INSIDER_EVERY_H}h, cert refresh at ${CERT_REFRESH_AGE_D}d (urgent at ${CERT_STALE_AGE_D}d)`
  );
  setTimeout(tick, BOOT_DELAY_MS); // boot catch-up
  setInterval(tick, TICK_MS);
}

module.exports = { start, tick, maintenanceStatus };
