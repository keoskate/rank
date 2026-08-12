/**
 * Keo Fund holdings — the fund's positions from the constitution (KEO_FUND.md).
 * Used to broaden the earnings panel beyond SOXX constituents to the fund's own
 * names (semis + AI platforms + networking/power + a few thematics). ETFs like
 * GLD/SGOV are included but simply produce no earnings rows.
 *
 * Keep in sync with KEO_FUND.md when the fund rebalances.
 */

const KEO_FUND_SYMS = [
  // Layer 1 — equipment
  'ASML', 'AMAT', 'LRCX', 'KLAC', 'TER',
  // Layer 2 — foundry & silicon IP
  'TSM', 'ARM', 'STM', 'ON',
  // Layer 3 — compute
  'NVDA', 'AMD', 'AVGO', 'MU', 'LSCC',
  // Layer 4 — networking & physical plant
  'ANET', 'VRT', 'CEG',
  // Layer 5 — AI platforms
  'MSFT', 'GOOGL', 'AMZN', 'META', 'PLTR',
  // Thematics / satellites
  'TSLA', 'ISRG', 'CGNX', 'ANET', 'IONQ', 'QBTS', 'RGTI', 'RKLB', 'IREN', 'CRWV',
  'HIMX', 'PI', 'TSEM', 'BE', 'UEC',
  // Ballast (ETFs — no earnings, harmless)
  'GLD', 'SGOV',
];

module.exports = { KEO_FUND_SYMS: [...new Set(KEO_FUND_SYMS)] };
