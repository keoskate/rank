/**
 * Semiconductor sentiment daily Telegram briefing — three self-improving snapshots
 * per market day (9:30 / 10:10 / 11:11 ET). Mirrors scanner/optionsDailyLoop's
 * pattern (setInterval + wall-clock guard + state file + telegramBot.sendAlert),
 * but reports the RICH semi picture: the current read, the pre-registered hourly +
 * next-day predictions AND their accumulating track record (the self-improvement
 * delta — accuracy/Brier that sharpen as outcomes accrue), breadth, sub-sector
 * rotation over a QUARTER, macro/regime, and the earnings runway.
 *
 * Display/research only — decoupled from the trading engine, no orders. Kill switch:
 * SEMI_DAILY_LOOP=off.
 */

const fs = require('fs');
const path = require('path');

const { sentimentEngine, phaseTracker } = require('./semiconductorSentiment');
const { getSemiContext } = require('./semiMarketContext');
const soxxPredictionLoop = require('./soxxPredictionLoop');
const soxxPredStore = require('./soxxPredictions');
const soxxDailyLoop = require('./soxxDailyPredictionLoop');
const soxxDailyStore = require('./soxxDailyPredictions');
const { getSectorHistory } = require('./soxxSectorHistory');

const STATE_FILE = path.join(__dirname, '..', 'data', 'semi-daily-loop.json');
const CHECK_MS = 60 * 1000;
const CATCHUP_HRS = 0.34; // fire within ~20 min of a slot if we were down at the tick

// The three daily checkpoints (decimal ET hours).
const SLOTS = [
  { key: '0930', et: 9.5, at: '9:30', label: 'Opening read' },
  { key: '1010', et: 10 + 10 / 60, at: '10:10', label: 'First-hour update' },
  { key: '1111', et: 11 + 11 / 60, at: '11:11', label: 'Midday check' },
];

// ── ET clock helpers ──
function etParts(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
    .formatToParts(now)
    .reduce((m, x) => ((m[x.type] = x.value), m), {});
  return {
    dateEt: `${p.year}-${p.month}-${p.day}`,
    isWeekday: !['Sat', 'Sun'].includes(p.weekday),
  };
}
function currentTimeET() {
  try {
    return phaseTracker.getCurrentPhase().currentTimeET;
  } catch {
    return null;
  }
}

// ── state (which slots fired today) ──
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { day: null, fired: {} };
  }
}
function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[semi-daily] state write failed:', e.message);
  }
}

// ── formatting ──
const num = v => (Number.isFinite(v) ? v : null);
const pct = (v, dp = 1) => (num(v) == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`);
const dirWord = d => (d === 'bullish' ? 'BULLISH' : d === 'bearish' ? 'BEARISH' : 'NEUTRAL');
const dirEmoji = d => (d === 'bullish' ? '🟢' : d === 'bearish' ? '🔴' : '⚪');

function predLine(cur, stats, tail) {
  const rec = cur && cur.prediction;
  const p = rec && rec.prediction;
  if (!p) return `_${tail}_`;
  const call = `${dirEmoji(p.direction)} ${dirWord(p.direction)} ${(p.probability * 100).toFixed(0)}% → ${p.action}`;
  const track =
    stats && stats.directional > 0
      ? `${(stats.accuracy * 100).toFixed(0)}% over ${stats.directional}${stats.brier != null ? ` · Brier ${stats.brier.toFixed(2)}` : ''}`
      : 'warming up — no scored calls yet';
  return `${call}\n   track: ${track}`;
}

/**
 * Build the Markdown briefing text for a slot. Pure-ish (reads live data sources).
 * @param {{at:string,label:string}} slot
 * @returns {Promise<string>}
 */
async function buildBriefing(slot = SLOTS[0]) {
  const [sentiment, ctx, sectorQ] = await Promise.all([
    sentimentEngine.getSentiment().catch(() => ({})),
    getSemiContext({ maxWaitMs: 4000 }).catch(() => null),
    getSectorHistory(false, '1Q').catch(() => null),
  ]);
  const hourly = (() => {
    try {
      return soxxPredictionLoop.getCurrent();
    } catch {
      return null;
    }
  })();
  const daily = (() => {
    try {
      return soxxDailyLoop.getCurrent();
    } catch {
      return null;
    }
  })();
  const hStats = soxxPredStore.computeStats(soxxPredStore.loadRecent(60));
  const dStats = soxxDailyStore.computeStats(soxxDailyStore.loadRecent(90));
  const { dateEt } = etParts();

  const b = ctx && ctx.breadth;
  const m = ctx && ctx.macro;
  const price = num(parseFloat(sentiment.currentPrice)) || (hourly && hourly.prediction && hourly.prediction.soxxPriceAtT);

  const lines = [];
  lines.push(`🔬 *SEMI SENTIMENT — ${slot.at} ET · ${slot.label}*`);
  lines.push(`_${dateEt}_`);
  lines.push('');

  // Read
  lines.push(
    `*Read:* ${dirEmoji(sentiment.direction)} ${dirWord(sentiment.direction)} · ${num(sentiment.confidence) != null ? `${Math.round(sentiment.confidence)}% conf` : 'conf —'}`
  );
  const regimeBits = [];
  if (price) regimeBits.push(`SOXX $${Number(price).toFixed(2)}`);
  if (m && m.regime) regimeBits.push(`regime ${m.regime}`);
  if (m && m.vixConfirm && m.vixConfirm !== 'n/a') regimeBits.push(`VIX ${m.vixConfirm}`);
  if (regimeBits.length) lines.push(regimeBits.join(' · '));

  // Breadth
  if (b) {
    lines.push(
      `*Breadth:* ${b.up ?? '—'}▲/${b.down ?? '—'}▼ · ${num(b.pctGreen) != null ? `${b.pctGreen.toFixed(0)}% green` : '—'}${num(b.wPctGreen) != null ? ` (${b.wPctGreen.toFixed(0)}% wtd)` : ''} · ${b.narrow ? '⚠️ narrow (mega-led)' : 'broad'}`
    );
  }
  lines.push('');

  // Predictions + self-improving track record
  lines.push(`*1-hr call:* ${predLine(hourly, hStats, 'posts hourly from the open')}`);
  lines.push(`*Next-day:* ${predLine(daily, dStats, 'posts near the close')}`);
  const readySignals = [];
  if (hStats.directional >= 20) readySignals.push('hourly');
  if (dStats.directional >= 20) readySignals.push('next-day');
  if (readySignals.length) lines.push(`📐 enough data to calibrate the ${readySignals.join(' + ')} predictor`);
  lines.push('');

  // Sub-sector rotation over a quarter (the fuller story than 30d)
  if (sectorQ && sectorQ.sectors && sectorQ.sectors.length) {
    const lead = sectorQ.sectors[0];
    const lag = sectorQ.sectors[sectorQ.sectors.length - 1];
    const beat = sectorQ.sectors.filter(s => s.vsSpy > 0).length;
    lines.push(
      `*Rotation (${sectorQ.window}):* ${lead.name} ${pct(lead.cum)} leads · ${lag.name} ${pct(lag.cum)} lags · ${beat}/${sectorQ.sectors.length} beat SPY`
    );
  }

  // Macro
  if (m) {
    const macroBits = [];
    if (num(m.equity) != null) macroBits.push(`SPY ${pct(m.equity)}`);
    if (num(m.semis) != null) macroBits.push(`SMH ${pct(m.semis)}`);
    if (num(m.spread) != null) macroBits.push(`semis ${m.spread >= 0 ? 'lead' : 'lag'} ${Math.abs(m.spread).toFixed(1)}pt`);
    if (m.safeHaven) macroBits.push('gold bid 🛡️');
    if (macroBits.length) lines.push(`*Macro:* ${macroBits.join(' · ')}`);
  }

  // Earnings runway
  const up = ctx && ctx.earnings && ctx.earnings.upcoming;
  if (Array.isArray(up) && up.length) {
    const soon = up.slice(0, 3).map(e => {
      const move = num(e.expectedMovePct) != null ? ` ±${e.expectedMovePct.toFixed(1)}%` : '';
      return `${e.sym} ${e.date}${move}`;
    });
    lines.push(`*Earnings:* ${soon.join(' · ')}`);
  }

  lines.push('');
  lines.push('_Pre-registered forward-test — records every call, learns from outcomes. Research only, not advice._');
  return lines.join('\n');
}

async function sendBriefing(slot = SLOTS[0]) {
  const text = await buildBriefing(slot);
  try {
    require('./telegramBot').sendAlert(text);
  } catch (e) {
    console.error('[semi-daily] send failed:', e.message);
  }
  return text;
}

async function tick() {
  try {
    const { dateEt, isWeekday } = etParts();
    if (!isWeekday) return;
    const t = currentTimeET();
    if (t == null) return;

    let state = readState();
    if (state.day !== dateEt) state = { day: dateEt, fired: {} };

    for (const slot of SLOTS) {
      if (state.fired[slot.key]) continue;
      if (t >= slot.et && t < slot.et + CATCHUP_HRS) {
        state.fired[slot.key] = new Date().toISOString();
        writeState(state);
        await sendBriefing(slot);
        console.log(`🔬 semi briefing sent: ${slot.at} ET (${slot.label})`);
      }
    }
  } catch (e) {
    console.error('[semi-daily] tick error:', e.message);
  }
}

function start() {
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 5000); // small boot delay so data sources warm up
  console.log('🔬 semi daily briefing loop started (9:30 / 10:10 / 11:11 ET)');
}

module.exports = { start, tick, buildBriefing, sendBriefing, SLOTS };
