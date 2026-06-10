// packages/quant-core/src/walkForward.js
//
// Walk-forward out-of-sample evaluation. Pure functions, no I/O.
//
// The overfitting antidote: parameters are chosen on TRAIN windows only and
// scored on the following TEST window, with an embargo gap between them so
// signals computed near the boundary can't leak. The stitched sequence of
// test segments is the only equity curve that counts as evidence; the
// in-sample table is reporting, not evidence.
//
// Works on daily-returns series (one per parameter candidate) aligned to a
// shared calendar. Strategies here are stateless maps from history to daily
// positions, so each candidate's full-period return series can be computed
// once and sliced per fold.

const { statsFromEquity, sharpe } = require('./equityStats');

/**
 * Slice helper: returns the non-null returns inside [from, to).
 */
function windowReturns(returns, from, to) {
  const out = [];
  for (let i = from; i < to && i < returns.length; i++) {
    if (returns[i] != null) out.push(returns[i]);
  }
  return out;
}

function equityFromReturns(returns) {
  const eq = [1];
  for (const r of returns) eq.push(eq[eq.length - 1] * (1 + r));
  return eq;
}

/**
 * Walk-forward parameter selection + stitched OOS curve.
 *
 * @param {object} input
 * @param {string[]} input.dates - master calendar (ISO dates), length N
 * @param {Array<{params: object, returns: Array<number|null>}>} input.candidates
 *        one daily simple-returns series per parameter set, aligned to dates
 *        (null before the candidate's warmup completes)
 * @param {number} [input.trainDays=756]   ~3y of trading days
 * @param {number} [input.testDays=126]    ~6mo
 * @param {number} [input.embargoDays=21]  gap between train end and test start
 * @param {boolean} [input.anchored=false] true = expanding train window
 * @param {function} [input.scoreFn]       returns[] -> score (default Sharpe)
 * @param {number} [input.minTrainCoverage=0.6] candidate must have data for
 *        at least this fraction of the train window to be eligible
 *
 * @returns {{
 *   folds: Array<{trainStart,trainEnd,testStart,testEnd,chosen,trainScore,testStats}>,
 *   oos: {dates: string[], returns: number[], equity: number[], stats: object},
 *   inSample: {best: object, stats: object, table: Array},
 *   paramStability: {distinctChosen: number, folds: number, chosenSeq: Array}
 * }|null} null when there is not enough history for a single fold
 */
function walkForwardOOS({
  dates,
  candidates,
  trainDays = 756,
  testDays = 126,
  embargoDays = 21,
  anchored = false,
  scoreFn = rets => sharpe(rets),
  minTrainCoverage = 0.6,
}) {
  if (!dates || !candidates || !candidates.length) return null;
  const N = dates.length;

  // Common start: first index where every candidate has a return. Using the
  // common start keeps the parameter race fair (no credit for short warmup).
  let s0 = 0;
  for (const c of candidates) {
    const first = c.returns.findIndex(r => r != null);
    if (first < 0) return null;
    if (first > s0) s0 = first;
  }

  const firstTestStart = s0 + trainDays + embargoDays;
  if (firstTestStart >= N) return null;

  const folds = [];
  const oosDates = [];
  const oosReturns = [];

  for (let testStart = firstTestStart; testStart < N; testStart += testDays) {
    const testEnd = Math.min(testStart + testDays, N);
    const trainEnd = testStart - embargoDays;
    const trainStart = anchored ? s0 : Math.max(s0, trainEnd - trainDays);
    if (trainEnd - trainStart < trainDays * 0.5) continue;

    // score candidates on the train window only
    let best = null;
    const scores = [];
    for (const c of candidates) {
      const trainRets = windowReturns(c.returns, trainStart, trainEnd);
      if (trainRets.length < (trainEnd - trainStart) * minTrainCoverage) {
        scores.push({ params: c.params, score: null });
        continue;
      }
      const score = scoreFn(trainRets);
      scores.push({ params: c.params, score });
      if (best == null || score > best.score) best = { candidate: c, score };
    }
    if (!best) continue;

    // realize the chosen candidate on the untouched test window
    const segRets = [];
    for (let i = testStart; i < testEnd; i++) {
      const r = best.candidate.returns[i];
      segRets.push(r == null ? 0 : r);
      oosDates.push(dates[i]);
      oosReturns.push(r == null ? 0 : r);
    }
    const segEq = equityFromReturns(segRets);
    folds.push({
      trainStart: dates[trainStart],
      trainEnd: dates[trainEnd - 1],
      testStart: dates[testStart],
      testEnd: dates[testEnd - 1],
      chosen: best.candidate.params,
      trainScore: best.score,
      testStats: statsFromEquity(dates.slice(testStart - 1, testEnd), segEq),
      scores,
    });
  }
  if (!folds.length || oosReturns.length < 40) return null;

  const oosEquity = equityFromReturns(oosReturns);
  // equity has one more point than returns; align by prepending the day
  // before the first OOS date is unavailable, so stats use the returns dates
  // with the initial 1.0 dropped.
  const oosStats = statsFromEquity(oosDates, oosEquity.slice(1));

  // In-sample winner over the full period (REPORTING ONLY — demoted)
  const table = candidates.map(c => {
    const rets = windowReturns(c.returns, s0, N);
    const eq = equityFromReturns(rets);
    return {
      params: c.params,
      stats: statsFromEquity(
        dates.slice(s0, N).slice(0, eq.length - 1),
        eq.slice(1)
      ),
    };
  });
  const inBest = table.reduce((a, b) =>
    (b.stats?.sharpe ?? -Infinity) > (a.stats?.sharpe ?? -Infinity) ? b : a
  );

  const chosenSeq = folds.map(f => JSON.stringify(f.chosen));
  return {
    folds,
    oos: {
      dates: oosDates,
      returns: oosReturns,
      equity: oosEquity.slice(1),
      stats: oosStats,
    },
    inSample: { best: inBest.params, stats: inBest.stats, table },
    paramStability: {
      folds: folds.length,
      distinctChosen: new Set(chosenSeq).size,
      chosenSeq: folds.map(f => f.chosen),
    },
  };
}

module.exports = { walkForwardOOS, equityFromReturns, windowReturns };
