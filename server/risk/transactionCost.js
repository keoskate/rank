// server/risk/transactionCost.js
// A simple, honest transaction-cost model. Until this existed, every backtest
// and the live edge gate measured GROSS P&L — and the audit showed the entire
// gross "edge" on technicals/flow lived inside the cost band. Deducting cost at
// trade close makes realized P&L (and therefore stats, the edge gate, Kelly,
// and the daily summary) reflect what a real account would keep.
//
// Cost = spread + slippage + commission, charged round-trip (entry + exit).
// Conservative defaults; leveraged ETFs are wider (thinner books, more decay).

// Leveraged ETFs we trade — wider effective cost than ordinary equities.
const LEVERAGED_ETFS = new Set([
  'SOXL',
  'SOXS',
  'TQQQ',
  'SQQQ',
  'QBTX',
  'QBTZ',
  'TNA',
  'TZA',
  'SPXL',
  'SPXS',
  'LABU',
  'LABD',
  // VIX-futures ETPs: leveraged/inverse vol products with wide effective
  // spreads, daily-rebalance decay, and stress-regime liquidity holes.
  'UVXY',
  'UVIX',
  'SVXY',
  'SVIX',
  'VXX',
  'VIXY',
]);

const BPS_PER_SIDE_DEFAULT = 5; // 0.05% per side → 10bps round trip
const BPS_PER_SIDE_LEVERAGED = 15; // 0.15% per side → 30bps round trip

/**
 * Per-side cost in basis points for a symbol.
 */
function bpsPerSide(symbol) {
  return LEVERAGED_ETFS.has(String(symbol).toUpperCase())
    ? BPS_PER_SIDE_LEVERAGED
    : BPS_PER_SIDE_DEFAULT;
}

/**
 * Round-trip dollar cost for a position of `notional` dollars in `symbol`.
 * Charges both sides against the entry notional (a close-enough approximation —
 * entry and exit notionals are within the position's P&L of each other).
 * @returns {number} cost in dollars (>= 0)
 */
function roundTripCost(symbol, notional) {
  const n = Math.abs(parseFloat(notional) || 0);
  if (n === 0) return 0;
  const roundTripBps = bpsPerSide(symbol) * 2;
  return n * (roundTripBps / 10000);
}

module.exports = {
  roundTripCost,
  bpsPerSide,
  LEVERAGED_ETFS,
  BPS_PER_SIDE_DEFAULT,
  BPS_PER_SIDE_LEVERAGED,
};
