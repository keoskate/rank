/**
 * SOXX next-DAY prediction loop — the daily sibling of soxxPredictionLoop. Once per
 * trading day, late in the session (≈3:30–3:57 ET), it records a pre-registered
 * next-trading-day direction call (close-to-close), when the day's features are
 * mature. A companion evaluator scores each one after the following session fully
 * closes. Additive and fully decoupled from the trading engine (display/research
 * only — no orders).
 *
 * V1 shares soxxPredictorCore.predict with the hourly loop (a forward-test baseline);
 * the recorded feature snapshot carries the daily-relevant signals (weekday for
 * seasonality, the dot-derived momentum, sub-sector rotation over ~30d) so a
 * daily-specific learner can weight them later.
 */

const { phaseTracker } = require('./semiconductorSentiment');
const { assembleFeatures } = require('./soxxFeatures');
const { predict, probUp } = require('./soxxPredictorCore');
const cal = require('./soxxCalibration');
const store = require('./soxxDailyPredictions');

const firedDays = new Set(); // etDate → fire once per trading day
let currentPrediction = null;
let seq = 0;

// Late-session window so the day's data is mature and we're forecasting the NEXT
// session. currentTimeET is decimal ET hours from MarketPhaseTracker.
function predictWindow(phase) {
  return (
    phase &&
    phase.currentTimeET >= 15.5 &&
    phase.currentTimeET <= 15.95 &&
    ['OPEN', 'SETTLE', 'ACTIVE', 'WIND_DOWN'].includes(phase.phase)
  );
}

async function recordPrediction() {
  const { soxxPrice, features } = await assembleFeatures();
  if (soxxPrice == null) return null; // no price → can't evaluate later, skip
  const prediction = predict(features);
  // Phase B: calibrated probability alongside the raw one (metadata only; N=0 → raw).
  const calHist = cal.historyFrom(store.loadRecent(90));
  const calibration = { probUp: cal.calibrateProb(probUp(prediction), calHist), n: calHist.length };
  const tsMs = Date.now();
  const rec = {
    id: `${tsMs}|${seq++}`,
    ts: new Date(tsMs).toISOString(),
    horizon: 'next-day',
    fromDate: store.etDate(new Date(tsMs)),
    predForDate: null, // set by the evaluator to the realized next-session date
    soxxPriceAtT: soxxPrice,
    features,
    prediction,
    calibration,
    evaluated: false,
  };
  store.appendPrediction(rec);
  currentPrediction = rec;
  console.log(
    `🔮📅 SOXX next-day prediction: ${prediction.direction} ${(prediction.probability * 100).toFixed(0)}% → ${prediction.action} (from $${soxxPrice})`
  );
  return rec;
}

async function runPredictionIfDue() {
  const phase = phaseTracker.getCurrentPhase();
  if (!predictWindow(phase)) return;
  const key = store.etDate();
  if (firedDays.has(key)) return;
  firedDays.add(key);
  await recordPrediction();
}

async function runEvaluations() {
  const preds = store.loadRecent(8);
  const todayET = store.etDate();
  for (const p of preds) {
    if (p.evaluated) continue;
    const fromDate = p.fromDate || store.etDate(new Date(p.ts));
    const next = await store.dailyCloseAfter(fromDate);
    // require the next session to be a COMPLETED past day (strictly before today ET)
    if (!next || !(next.date < todayET) || !p.soxxPriceAtT) continue;
    const realizedReturn = ((next.close - p.soxxPriceAtT) / p.soxxPriceAtT) * 100;
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
      predForDate: next.date,
      priceAtEval: next.close,
      realizedReturn,
      realizedDir,
      correct,
    });
    if (currentPrediction && currentPrediction.id === p.id) {
      currentPrediction = { ...currentPrediction, evaluated: true, predForDate: next.date, priceAtEval: next.close, realizedReturn, realizedDir, correct };
    }
    console.log(
      `✓📅 SOXX next-day ${p.id} evaluated: predicted ${p.prediction.direction}, realized ${realizedDir} (${realizedReturn >= 0 ? '+' : ''}${realizedReturn.toFixed(2)}%) → ${correct ? 'HIT' : 'miss'}`
    );
  }
}

async function tick() {
  try {
    await runPredictionIfDue();
  } catch (e) {
    console.error('[SOXX daily prediction] predict error:', e.message);
  }
  try {
    await runEvaluations();
  } catch (e) {
    console.error('[SOXX daily prediction] eval error:', e.message);
  }
}

function startSoxxDailyPredictionLoop() {
  try {
    const recent = store.loadRecent(5);
    if (recent.length) currentPrediction = recent[recent.length - 1];
  } catch {
    /* ignore */
  }
  setInterval(tick, 60000); // check each minute; guards handle "once per day"
  tick();
  console.log('🔮📅 SOXX next-day prediction loop started');
}

function getCurrent() {
  return { prediction: currentPrediction || null };
}

module.exports = { startSoxxDailyPredictionLoop, getCurrent, recordPrediction, runEvaluations, tick };
