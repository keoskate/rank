// scripts/backtests/lib/trialsLedger.js
//
// The honest trial count. Every strategy variant we evaluate — every grid
// point, every backtest run — is one draw from the multiple-testing lottery.
// The deflated-Sharpe gate needs to know how many tickets we bought, not how
// many we chose to remember. Append-only; nothing here ever deletes a trial.

const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(
  __dirname,
  '../../../data/backtests/trials-ledger.json'
);

function _load() {
  if (!fs.existsSync(LEDGER_PATH)) return { trials: [] };
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch (e) {
    return { trials: [] };
  }
}

/**
 * Record evaluated trials. Each entry: { family, strategyId, params,
 * sharpe (annualized, in-sample full period), window, kind }.
 * Dedupes by (family, strategyId, paramsKey) — re-running the same variant
 * updates its row instead of inflating N.
 */
function recordTrials(entries) {
  const ledger = _load();
  const keyOf = e =>
    `${e.family}|${e.strategyId}|${JSON.stringify(e.params || {})}`;
  const byKey = new Map(ledger.trials.map(t => [keyOf(t), t]));
  for (const e of entries) {
    byKey.set(keyOf(e), { ...e, recordedAt: new Date().toISOString() });
  }
  ledger.trials = [...byKey.values()];
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  return ledger.trials.length;
}

/**
 * Trial statistics for deflation.
 * @param {string} [family] - restrict to one strategy family; omit for the
 *        global count (the honest N for "how many strategies have we tried").
 */
function trialStats(family = null) {
  const ledger = _load();
  const trials = family
    ? ledger.trials.filter(t => t.family === family)
    : ledger.trials;
  const sharpes = trials
    .map(t => t.sharpe)
    .filter(s => typeof s === 'number' && isFinite(s));
  let varSR = null;
  if (sharpes.length >= 2) {
    const m = sharpes.reduce((a, b) => a + b, 0) / sharpes.length;
    varSR =
      sharpes.reduce((a, b) => a + (b - m) ** 2, 0) / (sharpes.length - 1);
  }
  // Median trial length in trading days (from each trial's recorded window) —
  // sets the null-noise dispersion the deflation bar is built from.
  const lengths = trials
    .map(t =>
      t.window && t.window.start && t.window.end
        ? Math.round(
            ((new Date(t.window.end) - new Date(t.window.start)) / 864e5) *
              (252 / 365.25)
          )
        : null
    )
    .filter(d => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  const medianTradingDays = lengths.length
    ? lengths[Math.floor(lengths.length / 2)]
    : null;
  return {
    n: trials.length,
    nWithSharpe: sharpes.length,
    varAnnualizedSharpe: varSR, // empirical spread — reporting only; polluted
    //   by deliberate anti-edge trials, so it must NOT set the deflation bar
    medianTradingDays,
    families: [...new Set(ledger.trials.map(t => t.family))],
  };
}

module.exports = { recordTrials, trialStats, LEDGER_PATH };
