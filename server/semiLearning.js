/**
 * Semiconductor learning view aggregator — one payload for the "Learning" tab that
 * shows whether the self-improving systems are actually improving. Reads the three
 * append-only forward-test ledgers (hourly predictor, next-day predictor, AI analyst)
 * and, on top of each system's own computeStats, derives:
 *   - a learning curve (cumulative directional accuracy over evaluated calls), and
 *   - a reliability curve (predicted probability vs realized, for the probabilistic
 *     predictors) — the honest "is the confidence calibrated" read.
 * Read-only; nothing here feeds trading.
 */

const soxxPred = require('./soxxPredictions');
const soxxDaily = require('./soxxDailyPredictions');
const aiLedger = require('./aiAnalysisLedger');
const cal = require('./soxxCalibration');

// Cumulative directional accuracy over evaluated calls, oldest → newest.
// getDir/getCorrect adapt to each ledger's record shape.
function learningCurve(records, getDir, getCorrect) {
  const ev = records
    .filter(r => r.evaluated && Number.isFinite(r.realizedReturn) && getDir(r) && getDir(r) !== 'neutral')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  let hits = 0;
  return ev.map((r, i) => {
    if (getCorrect(r)) hits += 1;
    return { ts: r.ts, n: i + 1, acc: hits / (i + 1) };
  });
}

const predDir = r => r.prediction && r.prediction.direction;
const predCorrect = r => r.correct;
const aiDir = r => r.ai && r.ai.direction;
const aiCorrect = r => r.aiCorrect;

function build() {
  const hRecs = soxxPred.loadRecent(90);
  const dRecs = soxxDaily.loadRecent(120);
  const aRecs = aiLedger.loadRecent(90);

  return {
    asOf: new Date().toISOString(),
    systems: [
      {
        key: 'hourly',
        label: '1-hour predictor',
        horizon: 'next 60 min',
        breakdownKey: 'byHour',
        breakdownLabel: 'by ET hour',
        ...soxxPred.computeStats(hRecs),
        curve: learningCurve(hRecs, predDir, predCorrect),
        reliability: cal.reliability(cal.historyFrom(hRecs)),
      },
      {
        key: 'daily',
        label: 'Next-day predictor',
        horizon: 'close → close',
        breakdownKey: 'byWeekday',
        breakdownLabel: 'by weekday',
        ...soxxDaily.computeStats(dRecs),
        curve: learningCurve(dRecs, predDir, predCorrect),
        reliability: cal.reliability(cal.historyFrom(dRecs)),
      },
      {
        key: 'ai',
        label: 'AI analyst',
        horizon: '2 h',
        breakdownKey: 'byRisk',
        breakdownLabel: 'by risk level',
        ...aiLedger.computeStats(aRecs),
        curve: learningCurve(aRecs, aiDir, aiCorrect),
        reliability: [],
      },
    ],
  };
}

module.exports = { build, learningCurve };
