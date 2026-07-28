/**
 * Options self-improvement heartbeat — the piece that makes the loop run
 * without a human poking it.
 *
 * Once per market day (first check after RUN_HOUR_ET), inside the
 * always-on server process:
 *   1. run one EARNEST options scan with default params -> the day's board
 *      goes on the permanent pick ledger (recordPicks is hooked into the
 *      scan itself)
 *   2. grade everything gradable (evaluatePending via getReport)
 *   3. Telegram the owner the ledger delta — record, calibration gap,
 *      playbook verdict
 *   4. when the ledger reaches CALIBRATION_READY_CLUSTERS independent
 *      underlying-day clusters, say so — fitting the probability shrinkage
 *      is a deliberate, reviewed step, not an unattended model mutation.
 *
 * User-triggered scans still record picks on their own; this heartbeat
 * guarantees at least one consistent board per day so the record samples
 * every market day, not just days someone was watching.
 *
 * Kill switch: OPTIONS_DAILY_LOOP=off.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'options-daily-loop.json');
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const RUN_HOUR_ET = 10; // after the open settles
// Ready to calibrate = enough clusters AND enough distinct entry days.
// Clusters sharing a day share the tape — 40 clusters from 4 sessions is
// four correlated observations wearing forty hats.
const CALIBRATION_READY_CLUSTERS = 30;
const CALIBRATION_READY_DAYS = 10;

let _timer = null;

function _loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function _saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Current date/hour/weekday in ET. */
function _etParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(now).reduce((m, p) => ((m[p.type] = p.value), m), {});
  return {
    dateEt: `${parts.year}-${parts.month}-${parts.day}`,
    hourEt: parseInt(parts.hour, 10),
    isWeekday: !['Sat', 'Sun'].includes(parts.weekday),
  };
}

/** PURE gate for the heartbeat — unit-tested. */
function shouldRunNow(state, { dateEt, hourEt, isWeekday }) {
  return isWeekday && hourEt >= RUN_HOUR_ET && state.lastRunDay !== dateEt;
}

/** Independent evidence units: one per underlying per entry day, graded. */
function countGradedClusters(picks) {
  const clusters = new Set(
    picks.filter(p => p.exit).map(p => `${p.card.underlying}|${p.recordedAt.slice(0, 10)}`)
  );
  return clusters.size;
}

function countGradedDays(picks) {
  return new Set(picks.filter(p => p.exit).map(p => p.recordedAt.slice(0, 10))).size;
}

function calibrationReady(picks) {
  return countGradedClusters(picks) >= CALIBRATION_READY_CLUSTERS
    && countGradedDays(picks) >= CALIBRATION_READY_DAYS;
}

async function _runDaily(dateEt) {
  const { runOptionsScan } = require('./optionsScanRunner');
  const { getReport, STORE_FILE } = require('./optionsTrackRecord');

  const scan = await runOptionsScan({});
  const report = await getReport({ limit: 1 }); // getReport grades everything pending
  const s = report.summary;

  let picks = [];
  try { picks = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { /* message degrades */ }
  const clusters = countGradedClusters(picks);
  const days = countGradedDays(picks);

  let text =
    `🔁 *DAILY OPTIONS LOOP — ${dateEt}*\n` +
    `Board: ${(scan.opportunities || []).length} picks recorded` +
    (scan.error ? ` (scan error: ${scan.error})` : '') + '\n';
  if (s.graded > 0) {
    text +=
      `Ledger: ${s.wins}W/${s.losses}L (${Math.round(s.winRate * 100)}%) · avg ${s.avgReturnPct >= 0 ? '+' : ''}${Math.round(s.avgReturnPct * 100)}%/bet\n` +
      (s.calibration
        ? `Predicted ${Math.round(s.calibration.predictedWinRate * 100)}% vs real ${Math.round(s.calibration.realizedWinRate * 100)}%\n`
        : '');
    if (s.playbooks?.verdict) text += `${s.playbooks.verdict}\n`;
    if (s.attribution?.whenStockWon) {
      text += `Direction right ${Math.round(s.attribution.stockLegWinRate * 100)}% — when right, options avg ${s.attribution.whenStockWon.avgOptionReturnPct >= 0 ? '+' : ''}${Math.round(s.attribution.whenStockWon.avgOptionReturnPct * 100)}%\n`;
    }
  }
  text += `Evidence: ${clusters}/${CALIBRATION_READY_CLUSTERS} clusters over ${days}/${CALIBRATION_READY_DAYS} market days\n`;
  if (calibrationReady(picks)) {
    text += `\n📐 *Enough independent data to fit calibration.* Ask Claude to "calibrate the options scanner" — the fit is a reviewed step, not automatic.`;
  }
  text += `\n/optrecord for the full ledger`;

  try {
    require('../telegramBot').sendAlert(text);
  } catch (err) {
    console.log('[OptionsLoop] Telegram summary failed:', err.message);
  }

  return { picksOnBoard: (scan.opportunities || []).length, graded: s.graded, clusters, days };
}

async function _tick() {
  try {
    const et = _etParts();
    const state = _loadState();
    if (!shouldRunNow(state, et)) return;
    // Claim the day before the (slow) run so a restart can't double-fire.
    state.lastRunDay = et.dateEt;
    _saveState(state);
    const result = await _runDaily(et.dateEt);
    state.lastResult = { ...result, at: new Date().toISOString() };
    _saveState(state);
    console.log(`[OptionsLoop] Daily run complete: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error('[OptionsLoop] Daily run failed:', err.message);
  }
}

function start() {
  if (_timer) return;
  if (String(process.env.OPTIONS_DAILY_LOOP).toLowerCase() === 'off') {
    console.log('[OptionsLoop] Disabled via OPTIONS_DAILY_LOOP=off');
    return;
  }
  setTimeout(_tick, FIRST_CHECK_DELAY_MS);
  _timer = setInterval(_tick, CHECK_INTERVAL_MS);
  console.log('[OptionsLoop] Daily self-improvement heartbeat armed (runs once per market day after 10:00 ET)');
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  start,
  stop,
  shouldRunNow,
  countGradedClusters,
  countGradedDays,
  calibrationReady,
  RUN_HOUR_ET,
  CALIBRATION_READY_CLUSTERS,
  CALIBRATION_READY_DAYS,
};
