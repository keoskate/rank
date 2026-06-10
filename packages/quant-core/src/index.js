// @keo/quant-core — public surface
//
// Pure quant primitives. No I/O, no side effects, no vendor coupling.
// Each module is independently testable; nothing in here imports from
// the application server.
//
// Add new modules here as they get extracted.

const tradingCalculations = require('./tradingCalculations');
const LeveragedEtfStrategy = require('./leveragedEtfStrategy');
const LeveragedEtfRules = require('./leveragedEtfRules');
const technicalIndicators = require('./technicalIndicatorsService');
const RegimeDetector = require('./regimeDetector');
const shannonEntropy = require('./shannonEntropy');
const equityStats = require('./equityStats');
const entropyGateCore = require('./entropyGateCore');
const trendCore = require('./trendCore');
const walkForward = require('./walkForward');
const significance = require('./significance');
const anchoredVwap = require('./anchoredVwap');
const volumeProfile = require('./volumeProfile');
const darkPoolCore = require('./darkPoolCore');

module.exports = {
  // Re-exported for `const { getEtfLeverage, isMarketOpen, calculateRSI } = require('@keo/quant-core')`
  ...tradingCalculations,

  // Class exports
  LeveragedEtfStrategy,
  LeveragedEtfRules,
  RegimeDetector,

  // Indicator namespace — keeps the surface organized so individual
  // function names don't clash with anything else at the top level.
  indicators: technicalIndicators,

  // Shannon entropy on log returns — regime detection (chop vs trend).
  shannonEntropy,

  // Equity-curve statistics (Sharpe, drawdown, CAGR) — the one definition
  // every backtest and report must use.
  equityStats,

  // The entropy-gate decision shared by live trading and backtests
  // (faithfulness contract: one core, zero divergence).
  entropyGateCore,

  // The trend-following decision (SMA + 12-1 momentum) shared by the live
  // trendFollowing plugin and backtests — same faithfulness contract.
  trendCore,

  // Walk-forward OOS evaluation + multiple-testing-aware significance.
  walkForward,
  significance,

  // Anchored VWAP — the one VWAP-aggregation definition (AVWAP trials +
  // the execution benchmark's fill-vs-VWAP residuals).
  anchoredVwap,

  // Volume profile with 70% value area — the one profile implementation
  // (research trials + the /api/volume-profile chart endpoint).
  volumeProfile,

  // The dark-pool print classifier shared by the live UW wrapper and the
  // B6 event-study replay of data/darkpool-archive/ (audit-fix spec).
  darkPoolCore,
};
