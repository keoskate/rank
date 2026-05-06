// Re-export shim — real code lives in @kpe/quant-core (packages/quant-core/src).
// Keeps existing `require('./tradingCalculations')` callers working until
// they migrate to the package import.
module.exports = require('../packages/quant-core/src/tradingCalculations');
