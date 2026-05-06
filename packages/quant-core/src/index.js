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

module.exports = {
  // Re-exported for `const { getEtfLeverage, isMarketOpen } = require('@keo/quant-core')`
  ...tradingCalculations,

  // Class exports
  LeveragedEtfStrategy,
  LeveragedEtfRules,
};
