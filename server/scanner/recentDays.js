/**
 * Last-n-trading-days direction history: +1 (up) / 0 (flat) / -1 (down),
 * oldest first. Feeds the scanner cards' dot-history strip.
 */

const RECENT_DAYS_N = 14;
const NEUTRAL_DAY_PCT = 0.15; // |day change| below this reads as flat

function recentDaysFromBars(bars, n = RECENT_DAYS_N) {
  if (!Array.isArray(bars) || bars.length < 2) return [];
  const out = [];
  for (let i = Math.max(bars.length - n, 1); i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const chg = prev > 0 ? ((bars[i].close - prev) / prev) * 100 : 0;
    out.push(chg > NEUTRAL_DAY_PCT ? 1 : chg < -NEUTRAL_DAY_PCT ? -1 : 0);
  }
  return out;
}

module.exports = { recentDaysFromBars, RECENT_DAYS_N, NEUTRAL_DAY_PCT };
