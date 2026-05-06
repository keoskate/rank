// Re-export shim — real code lives in @keo/quant-core (packages/quant-core/src).
// Keeps existing `require('./technicalIndicatorsService')` callers working
// until they migrate to the package import.
module.exports = require('../packages/quant-core/src/technicalIndicatorsService');
