// scripts/backtests/lib/rankUniverse.js
//
// The ONE definition of the cross-sectional ranking universes + window, shared
// by the bars exporter, the Python producer/diagnostics, the faithfulness cert
// and the five-gate validator. Defining it once here is the same discipline
// marketData.js applies to bars: no drift between the data the Python producer
// sees and the universe the backtest ranks.
//
// Select a universe with the RANK_UNIVERSE env var (default 'mega45'). Each
// universe gets its OWN cache namespace (data/rank-cache/<name>/) so switching
// universes never clobbers another's bars/scores.
//
//   mega45      — 45 highly-correlated large caps (== validate-xs-momentum.js
//                 universe). VERDICT: no cross-sectional edge (every factor's
//                 |IC t| < 1.4). Kept for comparability, not because it works.
//   diverseEtf  — cross-asset ETF basket (equity sectors + intl + bonds +
//                 commodities). Real dispersion across asset classes → where
//                 cross-sectional / dual momentum is actually documented to
//                 survive (Asness "Value & Momentum Everywhere", Moskowitz TSMOM).

const path = require('path');

const START = '2016-01-04';

const UNIVERSES = {
  // Frozen 45-name large-cap universe (matches validate-xs-momentum.js).
  mega45: {
    bench: 'SPY',
    benchTradable: false, // SPY is calendar/benchmark only, not ranked
    tradables: [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'AMD', 'INTC', 'QCOM',
      'TXN', 'ORCL', 'CSCO', 'IBM', 'ADBE', 'CRM', 'WMT', 'HD', 'NKE', 'MCD',
      'SBUX', 'COST', 'TGT', 'LOW', 'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'AXP',
      'JNJ', 'PFE', 'MRK', 'UNH', 'ABBV', 'LLY', 'BA', 'CAT', 'GE', 'XOM',
      'CVX', 'PG', 'KO', 'PEP', 'DIS',
    ],
  },
  // Diversified, liquid, all-pre-2016 ETF basket across asset classes.
  diverseEtf: {
    bench: 'SPY',
    benchTradable: true, // SPY (US equity beta) is a legitimate rankable asset here
    tradables: [
      // broad equity + US sectors
      'SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP',
      'XLI', 'XLU', 'XLB', 'SMH', 'XBI', 'IYR',
      // international equity
      'EEM', 'EFA', 'EWJ', 'FXI', 'EWZ',
      // fixed income
      'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'AGG',
      // commodities / metals
      'GLD', 'SLV', 'DBC', 'USO',
    ],
  },
};

/**
 * Resolve the active universe from RANK_UNIVERSE (default 'mega45').
 * @returns {{name, bench, benchTradable, UNIVERSE: string[], ALL: string[],
 *            RANK_CACHE_DIR: string, START: string}}
 */
function resolveUniverse() {
  const name = process.env.RANK_UNIVERSE || 'mega45';
  const u = UNIVERSES[name];
  if (!u) {
    throw new Error(
      `unknown RANK_UNIVERSE '${name}' — have: ${Object.keys(UNIVERSES).join(', ')}`
    );
  }
  // ALL = tradables plus the bench if it isn't already a tradable (calendar anchor).
  const ALL = u.tradables.includes(u.bench)
    ? [...u.tradables]
    : [...u.tradables, u.bench];
  const RANK_CACHE_DIR = path.join(__dirname, '../../../data/rank-cache', name);
  return {
    name,
    bench: u.bench,
    benchTradable: !!u.benchTradable,
    UNIVERSE: u.tradables,
    ALL,
    RANK_CACHE_DIR,
    START,
  };
}

module.exports = { START, UNIVERSES, resolveUniverse };
