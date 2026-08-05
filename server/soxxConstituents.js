/**
 * SOXX constituents (server-side mirror of react-client's soxxConstituents.js).
 *
 * Single source of truth for the ~30 SOXX holdings used by:
 *   - the /api/soxx/earnings aggregation (server/soxxEarnings.js), and
 *   - the AI analyst's market-context pack (server/semiMarketContext.js) for
 *     breadth / sub-sector rotation / concentration.
 *
 * Weights/mcaps are approximate (context only). `group` buckets each name into
 * a semis sub-sector so we can show which pocket is leading/lagging.
 *
 * Keep this in sync with react-client/src/Components/pages/soxxConstituents.js.
 */

const SOXX_TOP = [
  { sym: 'NVDA', weight: 9.5, mcapB: 5300, group: 'GPU/AI' },
  { sym: 'AVGO', weight: 8.0, mcapB: 2000, group: 'Connectivity' },
  { sym: 'AMD', weight: 7.5, mcapB: 750, group: 'GPU/AI' },
  { sym: 'TSM', weight: 6.5, mcapB: 1050, group: 'Foundry/CPU' },
  { sym: 'ASML', weight: 5.5, mcapB: 400, group: 'Equipment' },
  { sym: 'QCOM', weight: 5.0, mcapB: 270, group: 'Connectivity' },
  { sym: 'TXN', weight: 4.5, mcapB: 270, group: 'Analog/Power' },
  { sym: 'MU', weight: 4.5, mcapB: 90, group: 'Memory' },
  { sym: 'INTC', weight: 4.5, mcapB: 600, group: 'Foundry/CPU' },
  { sym: 'AMAT', weight: 4.0, mcapB: 360, group: 'Equipment' },
  { sym: 'LRCX', weight: 4.0, mcapB: 390, group: 'Equipment' },
  { sym: 'KLAC', weight: 4.0, mcapB: 250, group: 'Equipment' },
  { sym: 'ADI', weight: 4.0, mcapB: 200, group: 'Analog/Power' },
  { sym: 'MRVL', weight: 3.5, mcapB: 150, group: 'Connectivity' },
  { sym: 'NXPI', weight: 3.2, mcapB: 55, group: 'Connectivity' },
  { sym: 'MCHP', weight: 3.0, mcapB: 40, group: 'Analog/Power' },
  { sym: 'MPWR', weight: 2.4, mcapB: 45, group: 'Analog/Power' },
  { sym: 'ON', weight: 2.0, mcapB: 30, group: 'Analog/Power' },
  { sym: 'ENTG', weight: 1.6, mcapB: 20, group: 'Equipment' },
  { sym: 'TER', weight: 1.5, mcapB: 25, group: 'Equipment' },
  { sym: 'STM', weight: 1.4, mcapB: 30, group: 'Analog/Power' },
  { sym: 'SWKS', weight: 1.2, mcapB: 15, group: 'Connectivity' },
  { sym: 'QRVO', weight: 1.0, mcapB: 9, group: 'Connectivity' },
  { sym: 'MKSI', weight: 1.0, mcapB: 8, group: 'Equipment' },
  { sym: 'LSCC', weight: 0.9, mcapB: 8, group: 'Connectivity' },
  { sym: 'RMBS', weight: 0.8, mcapB: 7, group: 'Connectivity' },
  { sym: 'AMKR', weight: 0.7, mcapB: 7, group: 'Misc' },
  { sym: 'ALGM', weight: 0.6, mcapB: 5, group: 'Misc' },
  { sym: 'SLAB', weight: 0.6, mcapB: 4, group: 'Analog/Power' },
  { sym: 'WOLF', weight: 0.4, mcapB: 2, group: 'Misc' },
];

// Display order for the sub-sector rotation list.
const GROUP_ORDER = [
  'GPU/AI',
  'Equipment',
  'Memory',
  'Connectivity',
  'Analog/Power',
  'Foundry/CPU',
  'Misc',
];

// The three heaviest weights — used for the concentration / "broad vs narrow"
// read (if these carry most of the move, breadth is fragile).
const MEGA_CAP_SYMS = ['NVDA', 'AVGO', 'AMD'];

// Just the tickers, in weight order — convenience for callers that only need
// the symbol list (earnings fetch, snapshot batch).
const SOXX_SYMS = SOXX_TOP.map(c => c.sym);

// Intraday % change from the open (matches the client pctFromOpen). Works with
// an Alpaca snapshot ({last, open, prevClose}) or any {last|close, open|prevClose}.
// Returns null when the quote is missing/degenerate.
const pctFromOpen = quote => {
  if (!quote) return null;
  const last = Number(quote.last ?? quote.close ?? quote.price);
  const ref = Number(quote.open ?? quote.prevClose);
  if (!Number.isFinite(last) || !Number.isFinite(ref) || ref === 0) return null;
  return ((last - ref) / ref) * 100;
};

module.exports = {
  SOXX_TOP,
  GROUP_ORDER,
  MEGA_CAP_SYMS,
  SOXX_SYMS,
  pctFromOpen,
};
