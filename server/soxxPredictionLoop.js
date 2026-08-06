/**
 * SOXX hourly prediction loop — market-hours-aware. At the top of each 60-min
 * slot from the open (9:30, 10:30, … ET), it records a pre-registered next-1hr
 * prediction; a companion evaluator scores each one 60 min later. Additive and
 * fully decoupled from the trading engine (no orders, display/research only).
 */

const { phaseTracker } = require('./semiconductorSentiment');
const { assembleFeatures } = require('./soxxFeatures');
const { predict, probUp } = require('./soxxPredictorCore');
const cal = require('./soxxCalibration');
const store = require('./soxxPredictions');

const HORIZON_MIN = 60;
const firedSlots = new Set(); // `${etDate}|${slot}` → fire once per slot per day
let currentPrediction = null;
let seq = 0;

// Predict from the open (9:30) through ~2:30 ET so the 1h horizon still evaluates
// in-session. (currentTimeET is decimal ET hours from MarketPhaseTracker.)
function predictWindowOpen(phase) {
  return (
    phase &&
    phase.currentTimeET >= 9.5 &&
    phase.currentTimeET <= 14.6 &&
    ['OPEN', 'SETTLE', 'ACTIVE', 'WIND_DOWN'].includes(phase.phase)
  );
}

async function recordPrediction() {
  const { soxxPrice, features } = await assembleFeatures();
  if (soxxPrice == null) return null; // no price → can't evaluate later, skip
  const prediction = predict(features);
  // Phase B: record the empirically-calibrated probability alongside the raw one
  // (metadata only — not acted on yet; graduates to informing calls once the record
  // is thick + significant). At N=0 this equals the raw probUp.
  const calHist = cal.historyFrom(store.loadRecent(60));
  const calibration = { probUp: cal.calibrateProb(probUp(prediction), calHist), n: calHist.length };
  const tsMs = Date.now();
  const rec = {
    id: `${tsMs}|${seq++}`,
    ts: new Date(tsMs).toISOString(),
    soxxPriceAtT: soxxPrice,
    horizonMin: HORIZON_MIN,
    features,
    prediction,
    calibration,
    evaluated: false,
  };
  store.appendPrediction(rec);
  currentPrediction = rec;
  console.log(
    `🔮 SOXX prediction: ${prediction.direction} ${(prediction.probability * 100).toFixed(0)}% → ${prediction.action} (SOXX $${soxxPrice})`
  );
  return rec;
}

async function runPredictionIfDue() {
  const phase = phaseTracker.getCurrentPhase();
  if (!predictWindowOpen(phase)) return;
  const minutesFromOpen = Math.round((phase.currentTimeET - 9.5) * 60);
  if (minutesFromOpen < 0 || minutesFromOpen % 60 > 2) return; // first 2 min of a slot
  const slot = Math.floor(minutesFromOpen / 60);
  const key = `${store.etDate()}|${slot}`;
  if (firedSlots.has(key)) return;
  firedSlots.add(key);
  await recordPrediction();
}

async function runEvaluations() {
  const preds = store.loadRecent(3);
  const now = Date.now();
  for (const p of preds) {
    if (p.evaluated) continue;
    const dueAt = new Date(p.ts).getTime() + (p.horizonMin || HORIZON_MIN) * 60000;
    if (now < dueAt) continue;
    const priceAtEval = await store.priceAt(dueAt);
    if (priceAtEval == null || !p.soxxPriceAtT) {
      // no bar yet → leave pending and retry; give up only if long overdue
      if (now - dueAt > 24 * 3600000) {
        store.updatePrediction(p.id, {
          __ts: new Date(p.ts).getTime(),
          evaluated: true,
          unevaluable: true,
          evaluatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    const realizedReturn = ((priceAtEval - p.soxxPriceAtT) / p.soxxPriceAtT) * 100;
    const realizedDir =
      realizedReturn > store.NEUTRAL_BAND
        ? 'bullish'
        : realizedReturn < -store.NEUTRAL_BAND
          ? 'bearish'
          : 'neutral';
    const correct = p.prediction.direction === realizedDir;
    store.updatePrediction(p.id, {
      __ts: new Date(p.ts).getTime(),
      evaluated: true,
      evaluatedAt: new Date().toISOString(),
      priceAtEval,
      realizedReturn,
      realizedDir,
      correct,
    });
    if (currentPrediction && currentPrediction.id === p.id) {
      currentPrediction = { ...currentPrediction, evaluated: true, priceAtEval, realizedReturn, realizedDir, correct };
    }
    console.log(
      `✓ SOXX prediction ${p.id} evaluated: predicted ${p.prediction.direction}, realized ${realizedDir} (${realizedReturn >= 0 ? '+' : ''}${realizedReturn.toFixed(2)}%) → ${correct ? 'HIT' : 'miss'}`
    );
  }
}

async function tick() {
  try {
    await runPredictionIfDue();
  } catch (e) {
    console.error('[SOXX prediction] predict error:', e.message);
  }
  try {
    await runEvaluations();
  } catch (e) {
    console.error('[SOXX prediction] eval error:', e.message);
  }
}

function startSoxxPredictionLoop() {
  try {
    const recent = store.loadRecent(2);
    if (recent.length) currentPrediction = recent[recent.length - 1];
  } catch {
    /* ignore */
  }
  setInterval(tick, 30000); // check every 30s; guards handle "once per slot"
  tick();
  console.log('🔮 SOXX hourly prediction loop started');
}

function getCurrent() {
  if (!currentPrediction) return { prediction: null };
  const dueAt = new Date(currentPrediction.ts).getTime() + (currentPrediction.horizonMin || HORIZON_MIN) * 60000;
  return {
    prediction: currentPrediction,
    dueAt: new Date(dueAt).toISOString(),
    secondsToEval: Math.max(0, Math.round((dueAt - Date.now()) / 1000)),
  };
}

module.exports = { startSoxxPredictionLoop, getCurrent, recordPrediction, runEvaluations, tick };
