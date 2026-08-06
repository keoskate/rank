/**
 * SOXX prediction ledger — append-only, immutable, never-delete (the honest
 * forward-test record). Daily JSONL files at data/soxx-predictions/YYYY-MM-DD.jsonl,
 * one pre-registered prediction per line; the evaluator patches a line in place
 * once the 1-hour horizon elapses. Plus track-record stats (accuracy, Brier).
 */

const fs = require('fs');
const path = require('path');
const alpacaClient = require('./alpacaClient');
const { probUp } = require('./soxxPredictorCore');

const DIR = path.join(__dirname, '..', 'data', 'soxx-predictions');

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
  const dateStr = etDate(new Date(patch.__ts || id.split('|')[0] || Date.now()));
  // id is `${ts}|${seq}` so the ts prefix gives the day; fall back to a scan.
  const tryDays = [dateStr, etDate(new Date(Date.now() - 86400000)), etDate()];
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

// SOXX price ~atMs (via 5-min bars around the target). Returns close or null.
async function priceAt(atMs) {
  try {
    const from = new Date(atMs - 20 * 60000).toISOString().slice(0, 10);
    const to = new Date(atMs + 24 * 3600000).toISOString().slice(0, 10);
    const bars = await alpacaClient.getBars('SOXX', '5Min', from, to, 2000);
    if (!Array.isArray(bars) || !bars.length) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const b of bars) {
      const t = new Date(b.timestamp).getTime();
      const diff = Math.abs(t - atMs);
      if (diff < bestDiff && Number.isFinite(b.close)) {
        best = b.close;
        bestDiff = diff;
      }
    }
    // only accept a bar within ~20 min of the target
    return bestDiff <= 20 * 60000 ? best : null;
  } catch {
    return null;
  }
}

const NEUTRAL_BAND = 0.1; // % — |1hr move| under this reads flat

// Track-record stats over the recorded predictions.
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

  // accuracy by ET hour
  const byHour = {};
  for (const p of directional) {
    const h = p.features?.etHour ?? null;
    if (h == null) continue;
    byHour[h] = byHour[h] || { n: 0, correct: 0 };
    byHour[h].n += 1;
    if (p.correct) byHour[h].correct += 1;
  }

  const recent = evaluated
    .slice(-12)
    .reverse()
    .map(p => ({
      ts: p.ts,
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
    byHour,
    recent,
  };
}

module.exports = {
  appendPrediction,
  loadRecent,
  updatePrediction,
  priceAt,
  computeStats,
  etDate,
  NEUTRAL_BAND,
  DIR,
};
