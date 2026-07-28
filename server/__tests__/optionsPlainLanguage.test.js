import { describe, it, expect } from 'vitest';
import {
  fmtShortDate,
  fmtLevel,
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
} from '../../react-client/src/utils/optionsPlainLanguage.js';
import { recentDaysFromBars } from '../scanner/recentDays.js';

const baseRow = {
  underlying: 'NVDA',
  type: 'call',
  direction: 'LONG',
  strike: 190,
  expiration: '2026-08-21',
  dte: 30,
  breakeven: 194.33,
  costPerContract: 146,
  scenarioValues: { target: 8.6, flat: 3.1, stop: 1.2 },
  popModel: 0.55,
  popMarket: 0.18,
  greeks: { delta: 0.44, theta: -0.12 },
  thetaBurnPct: 0.4,
  riskFlags: [],
  earnings: null,
};

describe('formatting', () => {
  it('fmtShortDate', () => {
    expect(fmtShortDate('2026-08-21')).toBe('Aug 21');
    expect(fmtShortDate('2026-01-05')).toBe('Jan 5');
    expect(fmtShortDate(null)).toBe('');
  });

  it('fmtLevel rounds big prices, keeps cents on small ones', () => {
    expect(fmtLevel(194.33)).toBe('$194');
    expect(fmtLevel(4.851)).toBe('$4.85');
    expect(fmtLevel(NaN)).toBe('—');
  });
});

describe('betSentence', () => {
  it('calls read "above breakeven"', () => {
    expect(betSentence(baseRow)).toBe('NVDA above ~$194 by Aug 21');
  });

  it('puts read "below breakeven"', () => {
    const put = { ...baseRow, underlying: 'PYPL', type: 'put', breakeven: 49.3 };
    expect(betSentence(put)).toBe('PYPL below ~$49 by Aug 21');
  });

  it('small-price names keep cents without the approx tilde', () => {
    const cheap = { ...baseRow, underlying: 'RUN', breakeven: 13.45 };
    expect(betSentence(cheap)).toBe('RUN above $13.45 by Aug 21');
  });
});

describe('payoutIfHit', () => {
  it('is the modeled target exit, with multiple vs cost', () => {
    const { dollars, multiple } = payoutIfHit(baseRow);
    expect(dollars).toBeCloseTo(860, 6);
    expect(multiple).toBeCloseTo(860 / 146, 6);
  });
});

describe('oddsPhrase', () => {
  it('uses a ratio when the market prices a real chance', () => {
    expect(oddsPhrase(baseRow)).toMatch(/~3.*× more likely/);
  });

  it('falls back to points when odds are close', () => {
    expect(oddsPhrase({ ...baseRow, popModel: 0.4, popMarket: 0.37 })).toBe(
      'We give it 3 points better odds than the market'
    );
  });

  it('is honest when there is no edge', () => {
    expect(oddsPhrase({ ...baseRow, popModel: 0.3, popMarket: 0.3 })).toBe(
      'Our estimate is close to what the market is pricing'
    );
  });
});

describe('riskTier boundaries', () => {
  it('maps popModel to tiers', () => {
    expect(riskTier({ popModel: 0.34 }).label).toBe('LONG SHOT');
    expect(riskTier({ popModel: 0.36 }).label).toBe('FAIR SHOT');
    expect(riskTier({ popModel: 0.56 }).label).toBe('BEST ODDS');
  });
});

describe('worstCase', () => {
  it('always states max loss and the flat outcome', () => {
    const w = worstCase(baseRow);
    expect(w.maxLoss).toBe(146);
    expect(w.sentence).toMatch(/Most you can lose: \$146\./);
    expect(w.sentence).toMatch(/get back about \$310/);
  });

  it('says so when theta eats nearly everything', () => {
    const melted = { ...baseRow, scenarioValues: { ...baseRow.scenarioValues, flat: 0.1 } };
    expect(worstCase(melted).sentence).toMatch(/lose nearly all of it/);
  });
});

describe('plainWarnings', () => {
  it('translates every risk flag', () => {
    const row = {
      ...baseRow,
      riskFlags: ['SHORT_DTE', 'LOW_DELTA', 'WIDE_SPREAD', 'HIGH_IV_RANK'],
      dte: 8,
    };
    const texts = plainWarnings(row).map(w => w.text).join(' | ');
    expect(texts).toMatch(/Short fuse — expires in 8 days/);
    expect(texts).toMatch(/Needs a big move/);
    expect(texts).toMatch(/wide spread/);
    expect(texts).toMatch(/pricier than usual/);
  });

  it('earnings with expected move, red when inside the hold window', () => {
    const row = {
      ...baseRow,
      earnings: {
        nextReportDate: '2026-08-04',
        spansEarnings: true,
        withinHorizon: true,
        expectedMovePct: 0.071,
      },
    };
    const w = plainWarnings(row).find(x => x.text.startsWith('Earnings'));
    expect(w.text).toBe('Earnings Aug 4 — the market expects a ±7.1% swing');
    expect(w.level).toBe('high');
  });

  it('theta bleed shows dollars per day', () => {
    const w = plainWarnings(baseRow).find(x => x.text.includes('/day'));
    expect(w.text).toBe('Loses about $12/day in value if NVDA stays put');
  });

  it('null-safe on missing earnings/greeks', () => {
    expect(() => plainWarnings({ ...baseRow, greeks: null, earnings: null })).not.toThrow();
  });

  it('high-severity warnings sort first', () => {
    const row = { ...baseRow, riskFlags: ['WIDE_SPREAD', 'SHORT_DTE'], dte: 8 };
    const levels = plainWarnings(row).map(w => w.level);
    expect(levels.indexOf('high')).toBe(0);
  });
});

describe('expiresIn', () => {
  it('handles singular and plural', () => {
    expect(expiresIn({ dte: 1 })).toBe('Expires tomorrow');
    expect(expiresIn({ dte: 12 })).toBe('Expires in 12 days');
  });
});

describe('pricedForSwing', () => {
  it('translates IV into an expected swing with a rank qualifier', () => {
    // iv 0.52, dte 30 → 0.52·√(30/365) ≈ 14.9%
    expect(pricedForSwing({ ...baseRow, iv: 0.52, ivRank: 61 })).toBe(
      'Priced for a ±14.9% swing by Aug 21 — pricier than usual'
    );
    expect(pricedForSwing({ ...baseRow, iv: 0.52, ivRank: 85 })).toMatch(/priciest it has been all year/);
    expect(pricedForSwing({ ...baseRow, iv: 0.52, ivRank: 10 })).toMatch(/cheap vs its usual range/);
  });

  it('works without an IV rank and degrades on missing IV', () => {
    expect(pricedForSwing({ ...baseRow, iv: 0.52, ivRank: null })).toBe(
      'Priced for a ±14.9% swing by Aug 21'
    );
    expect(pricedForSwing({ ...baseRow, iv: null })).toBe('');
  });
});

describe('breakevenGap', () => {
  it('computes the climb for calls from the live price', () => {
    const { gapPct, phrase } = breakevenGap(baseRow, 185); // BE 194.33
    expect(gapPct).toBeCloseTo(((194.33 - 185) / 185) * 100, 4);
    expect(phrase).toMatch(/needs to climb 5\.0% to break even/);
  });

  it('mirrors as a drop for puts and detects already-past-breakeven', () => {
    const put = { ...baseRow, type: 'put', breakeven: 49 };
    expect(breakevenGap(put, 51).phrase).toMatch(/needs to drop 3\.9% to break even/);
    expect(breakevenGap(put, 47).phrase).toMatch(/already past the breakeven line/);
    expect(breakevenGap(baseRow, 200).phrase).toMatch(/already past the breakeven line/);
  });

  it('falls back to the scan-time price', () => {
    const { gapPct } = breakevenGap({ ...baseRow, underlyingPrice: 185 }, null);
    expect(gapPct).toBeGreaterThan(0);
  });
});

describe('dot history', () => {
  const bars = closes => closes.map(c => ({ close: c }));

  it('classifies up/down/flat days from bars', () => {
    // 100→102 up, 102→101 down, 101→101.05 flat (+0.05% < 0.15%)
    expect(recentDaysFromBars(bars([100, 102, 101, 101.05]))).toEqual([1, -1, 0]);
  });

  it('caps at n most recent days and handles short/empty input', () => {
    const many = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
    expect(recentDaysFromBars(many, 14)).toHaveLength(14);
    expect(recentDaysFromBars(bars([100]))).toEqual([]);
    expect(recentDaysFromBars(null)).toEqual([]);
  });

  it('renders emoji dots for Telegram', () => {
    expect(dotsEmoji([1, -1, 0, 1])).toBe('🟢🔴⚪🟢');
    expect(dotsEmoji([])).toBe('');
    expect(dotsEmoji(null)).toBe('');
  });
});
