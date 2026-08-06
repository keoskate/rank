/**
 * SOXX next-DAY prediction ledger — the daily-horizon sibling of soxxPredictions.js.
 * Append-only, immutable, never-delete (the honest forward-test record). Daily JSONL
 * files at data/soxx-daily-predictions/YYYY-MM-DD.jsonl, one pre-registered
 * next-trading-day direction call per day; the evaluator patches a line in place
 * once the following session has fully closed (close-to-close). Plus track-record
 * stats (accuracy, Brier, by-weekday for seasonality).
 */

const fs = require('fs');
const path = require('path');
const alpacaClient = require('./alpacaClient');
const { probUp } = require('./soxxPredictorCore');

const DIR = path.join(__dirname, '..', 'data', 'soxx-daily-predictions');

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}
// ET date (YYYY-MM-DD) for a Date — the filename bucket.
function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
const fileFor = dateStr => path.join(DIR, `${dateStr}.jsonl`);

function readDay(dateStr) {
  const f = fileFor(dateStr);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
function writeDay(dateStr, records) {
  ensureDir();
  const tmp = `${fileFor(dateStr)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(tmp, fileFor(dateStr)); // atomic
}

function appendPrediction(rec) {
  ensureDir();
  fs.appendFileSync(fileFor(etDate(new Date(rec.ts))), JSON.stringify(rec) + '\n');
  return rec;
}

// Load predictions from the last nDays (ET) files, newest last.
function loadRecent(nDays = 10) {
  ensureDir();
  const out = [];
  const now = Date.now();
  for (let i = nDays - 1; i >= 0; i--) {
    out.push(...readDay(etDate(new Date(now - i * 86400000))));
  }
  return out;
}

// Patch a prediction (by id) in its day file — for the evaluator's outcome write.
function updatePrediction(id, patch) {
  const dateStr = etDate(new Date(patch.__ts || Number(id.split('|')[0]) || Date.now()));
  const tryDays = [dateStr, etDate(new Date(Date.now() - 86400000)), etDate(new Date(Date.now() - 2 * 86400000)), etDate()];
  for (const day of [...new Set(tryDays)]) {
    const recs = readDay(day);
    const idx = recs.findIndex(r => r.id === id);
    if (idx >= 0) {
      recs[idx] = { ...recs[idx], ...patch };
      delete recs[idx].__ts;
      writeDay(day, recs);
      return recs[idx];
    }
  }
  return null;
}

// SOXX daily close on the first trading session STRICTLY AFTER dateStr (the
// next-day realized close). Returns { date, close } or null.
async function dailyCloseAfter(dateStr) {
  try {
    const endMs = new Date(`${dateStr}T00:00:00Z`).getTime() + 12 * 86400000;
    const end = new Date(endMs).toISOString().slice(0, 10);
    const bars = await alpacaClient.getBars('SOXX', '1Day', dateStr, end, 20);
    if (!Array.isArray(bars)) return null;
    for (const b of bars) {
      const d = new Date(b.timestamp).toISOString().slice(0, 10);
      if (d > dateStr && Number.isFinite(b.close)) return { date: d, close: b.close };
    }
    return null;
  } catch {
    return null;
  }
}

const NEUTRAL_BAND = 0.25; // % — |next-day move| under this reads flat

// Track-record stats over the recorded next-day predictions.
function computeStats(preds) {
  const evaluated = preds.filter(p => p.evaluated && Number.isFinite(p.realizedReturn));
  const directional = evaluated.filter(p => p.prediction && p.prediction.direction !== 'neutral');
  const correct = directional.filter(p => p.correct).length;

  let brierSum = 0;
  let brierN = 0;
  for (const p of evaluated) {
    const up = p.realizedReturn > 0 ? 1 : 0;
    const pu = probUp(p.prediction);
    brierSum += (pu - up) ** 2;
    brierN += 1;
  }

  // accuracy by weekday (seasonality / day-of-week effect)
  const byWeekday = {};
  for (const p of directional) {
    const wd = p.features?.weekday ?? null;
    if (wd == null) continue;
    byWeekday[wd] = byWeekday[wd] || { n: 0, correct: 0 };
    byWeekday[wd].n += 1;
    if (p.correct) byWeekday[wd].correct += 1;
  }

  const recent = evaluated
    .slice(-12)
    .reverse()
    .map(p => ({
      ts: p.ts,
      fromDate: p.fromDate,
      predForDate: p.predForDate,
      direction: p.prediction?.direction,
      probability: p.prediction?.probability,
      action: p.prediction?.action,
      realizedReturn: p.realizedReturn,
      correct: p.correct,
    }));

  return {
    total: preds.length,
    pending: preds.filter(p => !p.evaluated).length,
    evaluated: evaluated.length,
    directional: directional.length,
    accuracy: directional.length ? correct / directional.length : null,
    brier: brierN ? brierSum / brierN : null,
    byWeekday,
    recent,
  };
}

module.exports = {
  appendPrediction,
  loadRecent,
  updatePrediction,
  dailyCloseAfter,
  computeStats,
  etDate,
  NEUTRAL_BAND,
  DIR,
};
