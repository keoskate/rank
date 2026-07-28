/**
 * Plain-language translations for the options scanner's Simple mode.
 * Pure functions over a scan opportunity row — no React.
 *
 * CommonJS on purpose: this is the ONE source of truth for the betting
 * language, shared by the web Simple-mode cards (webpack's CJS interop
 * handles the `import { … }` side) AND the server's Telegram /options
 * commands (plain `require`). Tested from
 * server/__tests__/optionsPlainLanguage.test.js.
 *
 * Tone: clean and simple (no slang), PrizePicks-shaped framing. Honesty
 * guardrails: the bet line uses BREAKEVEN (where you actually profit), the
 * payout is the modeled target exit (not max-theoretical), and the
 * nothing-happens outcome is always spelled out.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtShortDate(isoDate) {
  const [, m, d] = String(isoDate || '').split('-');
  if (!m || !d) return '';
  return `${MONTHS[+m - 1]} ${+d}`;
}

/** "$194" for larger prices, "$4.85" for small ones. */
function fmtLevel(n) {
  if (!Number.isFinite(n)) return '—';
  return n >= 20 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

/** "NVDA above ~$194 by Aug 21" — breakeven, not strike. */
function betSentence(row) {
  const dir = row.type === 'call' ? 'above' : 'below';
  const approx = row.breakeven >= 20 ? '~' : '';
  return `${row.underlying} ${dir} ${approx}${fmtLevel(row.breakeven)} by ${fmtShortDate(row.expiration)}`;
}

/** Modeled payout if the stock-scan target hits: { dollars, multiple }. */
function payoutIfHit(row) {
  const dollars = (row.scenarioValues?.target ?? 0) * 100;
  const cost = row.costPerContract || 1;
  return { dollars, multiple: dollars / cost };
}

/** "We think this is ~3× more likely to pay than the market is pricing." */
function oddsPhrase(row) {
  const ours = row.popModel;
  const market = row.popMarket;
  if (!Number.isFinite(ours) || !Number.isFinite(market)) return '';
  if (market >= 0.05 && ours / market >= 1.15) {
    const ratio = ours / market;
    const shown = ratio >= 3 ? Math.round(ratio) : +ratio.toFixed(1);
    return `We think this is ~${shown}× more likely to pay than the market is pricing`;
  }
  const pp = Math.round((ours - market) * 100);
  if (pp > 0) return `We give it ${pp} points better odds than the market`;
  return 'Our estimate is close to what the market is pricing';
}

/** Tier badge from our probability of profit. */
function riskTier(row) {
  const p = row.popModel ?? 0;
  if (p < 0.35) return { label: 'LONG SHOT', tone: 'error' };
  if (p < 0.55) return { label: 'FAIR SHOT', tone: 'warning' };
  return { label: 'BEST ODDS', tone: 'success' };
}

/**
 * "Most you can lose: $146." plus the honest nothing-happens outcome.
 * Returns { maxLoss, flatBack, sentence }.
 */
function worstCase(row) {
  const maxLoss = row.costPerContract ?? 0;
  const flatBack = (row.scenarioValues?.flat ?? 0) * 100;
  const sym = row.underlying;
  let sentence = `Most you can lose: ${fmtMoney(maxLoss)}.`;
  if (maxLoss > 0) {
    const ratio = flatBack / maxLoss;
    if (ratio < 0.15) {
      sentence += ` If ${sym} doesn't move, you lose nearly all of it.`;
    } else {
      sentence += ` If ${sym} doesn't move, you'd get back about ${fmtMoney(flatBack)}.`;
    }
  }
  return { maxLoss, flatBack, sentence };
}

/**
 * Risk warnings as { text, level: 'high'|'medium' }[], worst first.
 * Null-safe: earnings, theta, ivRank may all be missing.
 */
function plainWarnings(row) {
  const warnings = [];
  const flags = row.riskFlags || [];
  const sym = row.underlying;

  const e = row.earnings;
  if (e && e.spansEarnings) {
    const swing = e.expectedMovePct != null
      ? ` — the market expects a ±${(e.expectedMovePct * 100).toFixed(1)}% swing`
      : ' — could move the stock sharply either way';
    warnings.push({
      text: `Earnings ${fmtShortDate(e.nextReportDate)}${swing}`,
      level: e.withinHorizon ? 'high' : 'medium',
    });
  }

  const thetaDollars = Number.isFinite(row.greeks?.theta) ? Math.abs(row.greeks.theta) * 100 : null;
  if (thetaDollars != null && thetaDollars >= 0.5) {
    const perDay = thetaDollars >= 1 ? fmtMoney(thetaDollars) : `$${thetaDollars.toFixed(2)}`;
    warnings.push({
      text: `Loses about ${perDay}/day in value if ${sym} stays put`,
      level: (row.thetaBurnPct ?? 0) > 0.5 ? 'high' : 'medium',
    });
  }

  if (flags.includes('SHORT_DTE')) {
    warnings.push({ text: `Short fuse — expires in ${row.dte} days`, level: 'high' });
  }
  if (flags.includes('LOW_DELTA')) {
    warnings.push({ text: 'Needs a big move to pay out', level: 'medium' });
  }
  if (flags.includes('WIDE_SPREAD')) {
    warnings.push({ text: 'Costs extra to get in and out (wide spread)', level: 'medium' });
  }
  if (flags.includes('HIGH_IV_RANK')) {
    warnings.push({ text: `Options on ${sym} are pricier than usual right now`, level: 'medium' });
  }

  return warnings.sort((a, b) => (a.level === 'high' ? 0 : 1) - (b.level === 'high' ? 0 : 1));
}

function expiresIn(row) {
  return row.dte === 1 ? 'Expires tomorrow' : `Expires in ${row.dte} days`;
}

/**
 * IV in lay terms: the swing the market is paying for, qualified by where
 * that pricing sits in the 12-month range (IV rank) when we know it.
 * "Priced for a ±9% swing by Aug 21 — pricier than usual."
 */
function pricedForSwing(row) {
  if (!Number.isFinite(row.iv) || !Number.isFinite(row.dte)) return '';
  const swingPct = row.iv * Math.sqrt(row.dte / 365) * 100;
  let text = `Priced for a ±${swingPct.toFixed(1)}% swing by ${fmtShortDate(row.expiration)}`;
  const rank = row.ivRank;
  if (Number.isFinite(rank)) {
    if (rank >= 80) text += ' — near the priciest it has been all year';
    else if (rank >= 50) text += ' — pricier than usual';
    else if (rank >= 20) text += ' — normal pricing for this stock';
    else text += ' — cheap vs its usual range';
  }
  return text;
}

/**
 * How far the stock is from the profit line, from a LIVE price when given.
 * Returns { gapPct (signed, + = still needs to move), phrase }.
 */
function breakevenGap(row, livePrice) {
  const price = Number.isFinite(livePrice) ? livePrice : row.underlyingPrice;
  if (!(price > 0) || !Number.isFinite(row.breakeven)) return { gapPct: null, phrase: '' };
  const isCall = row.type === 'call';
  const gapPct = isCall
    ? ((row.breakeven - price) / price) * 100
    : ((price - row.breakeven) / price) * 100;
  if (gapPct <= 0) {
    return { gapPct, phrase: `already past the breakeven line (${fmtLevel(row.breakeven)})` };
  }
  const dir = isCall ? 'climb' : 'drop';
  return { gapPct, phrase: `needs to ${dir} ${gapPct.toFixed(1)}% to break even` };
}

/** Dot history for Telegram: 🟢 up · 🔴 down · ⚪ flat, oldest first. */
function dotsEmoji(recentDays) {
  if (!Array.isArray(recentDays) || !recentDays.length) return '';
  return recentDays.map(d => (d > 0 ? '🟢' : d < 0 ? '🔴' : '⚪')).join('');
}

module.exports = {
  fmtShortDate,
  fmtLevel,
  fmtMoney,
  betSentence,
  payoutIfHit,
  oddsPhrase,
  riskTier,
  worstCase,
  plainWarnings,
  expiresIn,
  pricedForSwing,
  breakevenGap,
  dotsEmoji,
};
