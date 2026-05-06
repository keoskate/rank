import { describe, it, expect } from 'vitest';
import {
  getEtfLeverage,
  getOppositeEtf,
  isDST,
  getEasternOffset,
  getEasternMinutes,
  getMarketHolidays,
  getMinutesUntilClose,
  isMarketOpen,
  isExtendedHoursOpen,
  canSessionTradeNow,
  calculateQuantity,
  BULLISH_ETFS,
  BEARISH_ETFS,
} from '../tradingCalculations.js';

// --- ETF Functions ---

describe('getEtfLeverage', () => {
  it('returns 3 for known 3x ETFs', () => {
    expect(getEtfLeverage('SOXL')).toBe(3);
    expect(getEtfLeverage('SOXS')).toBe(3);
    expect(getEtfLeverage('QBTX')).toBe(3);
    expect(getEtfLeverage('TQQQ')).toBe(3);
  });

  it('returns 2 for 2x ETFs', () => {
    expect(getEtfLeverage('PLTU')).toBe(2);
  });

  it('returns 1 for unknown symbols', () => {
    expect(getEtfLeverage('AAPL')).toBe(1);
    expect(getEtfLeverage('SPY')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(getEtfLeverage('soxl')).toBe(3);
    expect(getEtfLeverage('Qbtx')).toBe(3);
  });
});

describe('getOppositeEtf', () => {
  it('returns inverse pair', () => {
    expect(getOppositeEtf('SOXL')).toBe('SOXS');
    expect(getOppositeEtf('SOXS')).toBe('SOXL');
    expect(getOppositeEtf('QBTX')).toBe('QBTZ');
    expect(getOppositeEtf('QBTZ')).toBe('QBTX');
  });

  it('returns null for unknown', () => {
    expect(getOppositeEtf('AAPL')).toBeNull();
  });
});

describe('ETF constants', () => {
  it('BULLISH and BEARISH have no overlap', () => {
    const overlap = BULLISH_ETFS.filter(s => BEARISH_ETFS.includes(s));
    expect(overlap).toHaveLength(0);
  });
});

// --- Market Holidays ---

describe('getMarketHolidays', () => {
  it('includes New Years Day', () => {
    const h = getMarketHolidays(2026);
    expect(h.has('2026-01-01')).toBe(true);
  });

  it('includes Independence Day', () => {
    const h = getMarketHolidays(2026);
    expect(h.has('2026-07-04')).toBe(true);
  });

  it('includes Good Friday 2026', () => {
    const h = getMarketHolidays(2026);
    expect(h.has('2026-04-03')).toBe(true);
  });

  it('includes Christmas', () => {
    const h = getMarketHolidays(2025);
    expect(h.has('2025-12-25')).toBe(true);
  });

  it('includes Juneteenth', () => {
    const h = getMarketHolidays(2026);
    expect(h.has('2026-06-19')).toBe(true);
  });

  it('returns a Set with all expected holidays', () => {
    const h = getMarketHolidays(2026);
    expect(h).toBeInstanceOf(Set);
    expect(h.size).toBeGreaterThan(5);
  });
});

// --- DST ---

describe('isDST', () => {
  it('returns true in summer (July)', () => {
    const july = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
    expect(isDST(july)).toBe(true);
  });

  it('returns false in winter (January)', () => {
    const jan = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    expect(isDST(jan)).toBe(false);
  });
});

describe('getEasternOffset', () => {
  it('returns -4 in summer (EDT)', () => {
    const july = new Date(2026, 6, 15);
    expect(getEasternOffset(july)).toBe(-4);
  });

  it('returns -5 in winter (EST)', () => {
    const jan = new Date(2026, 0, 15);
    expect(getEasternOffset(jan)).toBe(-5);
  });
});

// --- Market Hours ---

describe('isMarketOpen', () => {
  it('returns false on Saturday', () => {
    // 2026-04-25 is a Saturday
    const sat = new Date(Date.UTC(2026, 3, 25, 16, 0, 0));
    expect(isMarketOpen(sat)).toBe(false);
  });

  it('returns false on Sunday', () => {
    const sun = new Date(Date.UTC(2026, 3, 26, 16, 0, 0));
    expect(isMarketOpen(sun)).toBe(false);
  });

  it('returns false on a holiday (Good Friday 2026-04-03)', () => {
    // 10am ET = 2pm UTC during EDT
    const goodFriday = new Date(Date.UTC(2026, 3, 3, 14, 0, 0));
    expect(isMarketOpen(goodFriday)).toBe(false);
  });

  it('returns true during regular market hours on a weekday', () => {
    // Tuesday 2026-04-21, 11am ET = 3pm UTC during EDT
    const tues = new Date(Date.UTC(2026, 3, 21, 15, 0, 0));
    expect(isMarketOpen(tues)).toBe(true);
  });

  it('returns false before market open (8am ET)', () => {
    // 8am ET = 12pm UTC during EDT
    const early = new Date(Date.UTC(2026, 3, 21, 12, 0, 0));
    expect(isMarketOpen(early)).toBe(false);
  });

  it('returns false after market close (5pm ET)', () => {
    // 5pm ET = 9pm UTC during EDT
    const late = new Date(Date.UTC(2026, 3, 21, 21, 0, 0));
    expect(isMarketOpen(late)).toBe(false);
  });
});

describe('getMinutesUntilClose', () => {
  it('returns positive during market hours', () => {
    // 2pm ET = 6pm UTC during EDT → 2 hours until 4pm close = 120 min
    const afternoon = new Date(Date.UTC(2026, 3, 21, 18, 0, 0));
    expect(getMinutesUntilClose(afternoon)).toBe(120);
  });
});

describe('isExtendedHoursOpen', () => {
  it('returns true during pre-market (7am ET)', () => {
    // 7am ET = 11am UTC during EDT
    const premarket = new Date(Date.UTC(2026, 3, 21, 11, 0, 0));
    expect(isExtendedHoursOpen(premarket)).toBe(true);
  });

  it('returns true during after-hours (5pm ET)', () => {
    // 5pm ET = 9pm UTC during EDT
    const afterhours = new Date(Date.UTC(2026, 3, 21, 21, 0, 0));
    expect(isExtendedHoursOpen(afterhours)).toBe(true);
  });

  it('returns false on weekend', () => {
    const sat = new Date(Date.UTC(2026, 3, 25, 11, 0, 0));
    expect(isExtendedHoursOpen(sat)).toBe(false);
  });
});

describe('canSessionTradeNow', () => {
  it('returns true during market hours regardless of extendedHours config', () => {
    const tues = new Date(Date.UTC(2026, 3, 21, 15, 0, 0));
    expect(canSessionTradeNow({ config: { extendedHours: false } }, tues)).toBe(true);
  });

  it('returns false in pre-market if extendedHours is false', () => {
    const premarket = new Date(Date.UTC(2026, 3, 21, 11, 0, 0));
    expect(canSessionTradeNow({ config: { extendedHours: false } }, premarket)).toBe(false);
  });

  it('returns true in pre-market if extendedHours is true', () => {
    const premarket = new Date(Date.UTC(2026, 3, 21, 11, 0, 0));
    expect(canSessionTradeNow({ config: { extendedHours: true } }, premarket)).toBe(true);
  });
});

// --- Position Sizing ---

describe('calculateQuantity', () => {
  const base = {
    maxPositionValue: 10000,
    currentPrice: 50,
    riskAmount: 500,
    stopLoss: null,
    isCrypto: false,
  };

  it('calculates simple sizing when no stop loss', () => {
    const qty = calculateQuantity(base);
    expect(qty).toBe(200); // 10000 / 50
  });

  it('calculates risk-based sizing with stop loss', () => {
    const qty = calculateQuantity({ ...base, stopLoss: 48 });
    // riskPerShare=2, sharesFromRisk=floor(500/2)=250, sharesFromMaxSize=floor(10000/50)=200 → 200
    expect(qty).toBe(200);
  });

  it('returns null for NaN maxPositionValue', () => {
    expect(calculateQuantity({ ...base, maxPositionValue: NaN })).toBeNull();
  });

  it('returns null for NaN currentPrice', () => {
    expect(calculateQuantity({ ...base, currentPrice: NaN })).toBeNull();
  });

  it('returns null for zero price', () => {
    expect(calculateQuantity({ ...base, currentPrice: 0 })).toBeNull();
  });

  it('returns null for negative price', () => {
    expect(calculateQuantity({ ...base, currentPrice: -10 })).toBeNull();
  });

  it('returns null for zero maxPositionValue', () => {
    expect(calculateQuantity({ ...base, maxPositionValue: 0 })).toBeNull();
  });

  it('returns null for Infinity maxPositionValue', () => {
    expect(calculateQuantity({ ...base, maxPositionValue: Infinity })).toBeNull();
  });

  it('caps stock quantity at 1000', () => {
    const qty = calculateQuantity({ ...base, maxPositionValue: 1000000, currentPrice: 1 });
    expect(qty).toBe(1000);
  });

  it('returns null when position value cant afford 1 share', () => {
    const qty = calculateQuantity({ ...base, maxPositionValue: 10, currentPrice: 100 });
    // floor(10/100)=0, quantity<=0 → null (can't afford even 1 share)
    expect(qty).toBeNull();
  });

  it('returns fractional quantity for crypto', () => {
    const qty = calculateQuantity({ ...base, isCrypto: true, currentPrice: 50000, maxPositionValue: 1000 });
    expect(qty).toBe(0.02);
  });

  it('returns null for crypto position below $10 minimum', () => {
    const qty = calculateQuantity({ ...base, isCrypto: true, currentPrice: 50000, maxPositionValue: 5 });
    expect(qty).toBeNull();
  });

  it('handles stopLoss >= currentPrice by falling back to simple sizing', () => {
    const qty = calculateQuantity({ ...base, stopLoss: 55 });
    expect(qty).toBe(200);
  });

  it('returns risk-limited quantity when risk sizing is smaller', () => {
    const qty = calculateQuantity({ ...base, stopLoss: 49, riskAmount: 100 });
    // sharesFromRisk=floor(100/1)=100, sharesFromMaxSize=200 → 100
    expect(qty).toBe(100);
  });
});
