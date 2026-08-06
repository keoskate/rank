/**
 * AI analysis ledger — makes the Claude semiconductor analyst its OWN pre-registered
 * forward-test, so we learn over time whether it actually adds value. Every fresh
 * analysis is recorded with the SOXX price at that moment; a companion evaluator
 * scores it against the realized move over a fixed horizon. Crucially it also records
 * the BASE (engine) direction at the same instant, so the stats can attribute
 * edge-vs-base: when the AI diverges from the engine, does it win more?
 *
 * Append-only, immutable, never-delete. data/ai-analyses/YYYY-MM-DD.jsonl.
 * Display/research only — the freshness-guarded confidence adjustment already gates
 * whether the AI touches trading (semiAiAdjustmentGuard.js); this only scores it.
 */

const fs = require('fs');
const path = require('path');
const { priceAt, NEUTRAL_BAND } = require('./soxxPredictions');

const DIR = path.join(__dirname, '..', 'data', 'ai-analyses');
const HORIZON_MIN = 120; // judge the near-term (2h) directional call, uniform for comparability
const DEDUPE_MS = 90 * 1000; // skip near-duplicate records (rapid manual refreshes)

let seq = 0;
let _last = null; // in-memory dedupe guard

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}
function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const fileFor = dateStr => path.join(DIR, `${dateStr}.jsonl`);

function readDay(dateStr) {
  const f = fileFor(dateStr);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
function writeDay(dateStr, records) {
  ensureDir();
  const tmp = `${fileFor(dateStr)}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.renameSync(tmp, fileFor(dateStr));
}
function loadRecent(nDays = 10) {
  ensureDir();
  const out = [];
  const now = Date.now();
  for (let i = nDays - 1; i >= 0; i--) out.push(...readDay(etDate(new Date(now - i * 86400000))));
  return out;
}
function updateRecord(id, patch) {
  const dateStr = etDate(new Date(patch.__ts || Number(id.split('|')[0]) || Date.now()));
  for (const day of [...new Set([dateStr, etDate(new Date(Date.now() - 86400000)), etDate()])]) {
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

// Record a fresh AI analysis (no-op on disabled/errored/parse-failed calls, or when
// there's no usable SOXX price, or a near-duplicate within DEDUPE_MS).
function record(analysis, marketData) {
  if (!analysis || analysis.aiDisabled || analysis.error || analysis.parseError) return null;
  const price = parseFloat(marketData && marketData.currentPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const tsMs = Date.now();
  if (_last && tsMs - _last.ts < DEDUPE_MS && _last.dir === analysis.direction && _last.trigger === (analysis.trigger || 'manual')) {
    return null;
  }
  const rec = {
    id: `${tsMs}|${seq++}`,
    ts: new Date(tsMs).toISOString(),
    phase: marketData.phase || null,
    trigger: analysis.trigger || 'manual',
    soxxPriceAtT: price,
    horizonMin: HORIZON_MIN,
    ai: {
      direction: analysis.direction,
      confidenceAdjustment: analysis.confidenceAdjustment,
      riskLevel: analysis.riskLevel,
      holdDuration: analysis.holdDuration,
    },
    base: {
      direction: marketData.direction || null,
      confidence: Number.isFinite(marketData.confidence) ? marketData.confidence : null,
      conflict: !!marketData.conflict,
      reversalOverride: !!marketData.reversalOverride,
    },
    evaluated: false,
  };
  ensureDir();
  fs.appendFileSync(fileFor(etDate(new Date(tsMs))), JSON.stringify(rec) + '\n');
  _last = { ts: tsMs, dir: analysis.direction, trigger: rec.trigger };
  return rec;
}

// Score any records whose horizon has elapsed against the realized SOXX move.
async function evaluatePending() {
  const recs = loadRecent(3);
  const now = Date.now();
  for (const p of recs) {
    if (p.evaluated) continue;
    const dueAt = new Date(p.ts).getTime() + (p.horizonMin || HORIZON_MIN) * 60000;
    if (now < dueAt) continue;
    const priceAtEval = await priceAt(dueAt);
    if (priceAtEval == null || !p.soxxPriceAtT) {
      if (now - dueAt > 24 * 3600000) {
        updateRecord(p.id, { __ts: new Date(p.ts).getTime(), evaluated: true, unevaluable: true, evaluatedAt: new Date().toISOString() });
      }
      continue;
    }
    const realizedReturn = ((priceAtEval - p.soxxPriceAtT) / p.soxxPriceAtT) * 100;
    const realizedDir = realizedReturn > NEUTRAL_BAND ? 'bullish' : realizedReturn < -NEUTRAL_BAND ? 'bearish' : 'neutral';
    const aiCorrect = p.ai.direction === realizedDir;
    const baseCorrect = p.base && p.base.direction ? p.base.direction === realizedDir : null;
    updateRecord(p.id, {
      __ts: new Date(p.ts).getTime(),
      evaluated: true,
      evaluatedAt: new Date().toISOString(),
      priceAtEval,
      realizedReturn,
      realizedDir,
      aiCorrect,
      baseCorrect,
    });
    console.log(`✓🤖 AI analysis ${p.id}: AI ${p.ai.direction} vs base ${p.base?.direction} · realized ${realizedDir} (${realizedReturn >= 0 ? '+' : ''}${realizedReturn.toFixed(2)}%) → AI ${aiCorrect ? 'HIT' : 'miss'}`);
  }
}

// Track record + the key attribution: edge-vs-base when the AI diverges from the engine.
function computeStats(recs) {
  const ev = recs.filter(p => p.evaluated && Number.isFinite(p.realizedReturn));
  const aiDir = ev.filter(p => p.ai && p.ai.direction !== 'neutral');
  const aiCorrect = aiDir.filter(p => p.aiCorrect).length;

  const withBase = ev.filter(p => p.base && p.base.direction);
  const diverged = withBase.filter(p => p.ai.direction !== p.base.direction);
  const divAiWins = diverged.filter(p => p.aiCorrect).length;
  const divBaseWins = diverged.filter(p => p.baseCorrect).length;

  // "cautious" calls (neutral / avoid): count as right when the move stayed in a tight
  // band (it correctly called chop rather than a directional move).
  const cautious = ev.filter(p => p.ai.direction === 'neutral' || p.ai.holdDuration === 'avoid');
  const cautiousRight = cautious.filter(p => Math.abs(p.realizedReturn) <= 0.5).length;

  const byRisk = {};
  for (const p of aiDir) {
    const r = (p.ai.riskLevel || '?');
    byRisk[r] = byRisk[r] || { n: 0, correct: 0 };
    byRisk[r].n += 1;
    if (p.aiCorrect) byRisk[r].correct += 1;
  }

  const recent = ev.slice(-12).reverse().map(p => ({
    ts: p.ts,
    ai: p.ai.direction,
    base: p.base?.direction,
    adj: p.ai.confidenceAdjustment,
    risk: p.ai.riskLevel,
    realizedReturn: p.realizedReturn,
    aiCorrect: p.aiCorrect,
  }));

  return {
    total: recs.length,
    pending: recs.filter(p => !p.evaluated).length,
    evaluated: ev.length,
    directional: aiDir.length,
    accuracy: aiDir.length ? aiCorrect / aiDir.length : null,
    diverged: diverged.length,
    divergedAiWins: divAiWins,
    divergedBaseWins: divBaseWins,
    // + means the AI wins more often than the engine when they disagree (adds value);
    // - means it's second-guessing a better base. The number we actually care about.
    edgeVsBase: diverged.length ? (divAiWins - divBaseWins) / diverged.length : null,
    cautiousN: cautious.length,
    cautiousRight,
    byRisk,
    recent,
  };
}

module.exports = { record, evaluatePending, loadRecent, updateRecord, computeStats, etDate, DIR, HORIZON_MIN };
