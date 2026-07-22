import { describe, it, expect } from 'vitest';
import {
  normalCdf,
  bsPrice,
  parseOccSymbol,
  horizonCalendarDays,
  resolveEarningsContext,
  scoreContract,
  RISK_FREE_RATE,
} from '../scanner/optionsPricingModel.js';

const baseStock = {
  symbol: 'NVDA',
  direction: 'LONG',
  probability: 0.62,
  currentPrice: 185,
  targetPrice: 198,
  stopPrice: 179,
  horizonDays: 5,
};

const baseContract = {
  occSymbol: 'NVDA260821C00190000',
  strike: 190,
  expiration: '2026-08-21',
  type: 'call',
  bid: 4.1,
  ask: 4.4,
  greeks: { delta: 0.44, gamma: 0.02, theta: -0.09, vega: 0.21 },
  iv: 0.52,
  openInterest: 1250,
  dayVolume: 830,
};

const baseContext = { today: '2026-07-22', ivRank: 61, earnings: null };

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('bsPrice', () => {
  it('satisfies put-call parity', () => {
    const args = { S: 100, K: 105, tau: 0.25, sigma: 0.3 };
    const call = bsPrice({ ...args, type: 'call' });
    const put = bsPrice({ ...args, type: 'put' });
    // C - P = S - K·e^(-rτ)
    const parity = args.S - args.K * Math.exp(-RISK_FREE_RATE * args.tau);
    expect(call - put).toBeCloseTo(parity, 6);
  });

  it('returns intrinsic value at expiry', () => {
    expect(bsPrice({ S: 110, K: 100, tau: 0, sigma: 0.3, type: 'call' })).toBe(10);
    expect(bsPrice({ S: 110, K: 100, tau: 0, sigma: 0.3, type: 'put' })).toBe(0);
    expect(bsPrice({ S: 90, K: 100, tau: 0, sigma: 0.3, type: 'put' })).toBe(10);
  });

  it('increases with volatility', () => {
    const lo = bsPrice({ S: 100, K: 100, tau: 0.25, sigma: 0.2, type: 'call' });
    const hi = bsPrice({ S: 100, K: 100, tau: 0.25, sigma: 0.5, type: 'call' });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('parseOccSymbol', () => {
  it('parses a standard OCC symbol', () => {
    expect(parseOccSymbol('NVDA260821C00195000')).toEqual({
      underlying: 'NVDA',
      expiration: '2026-08-21',
      type: 'call',
      strike: 195,
    });
  });

  it('parses fractional strikes and puts', () => {
    expect(parseOccSymbol('AMD260727P00447500')).toEqual({
      underlying: 'AMD',
      expiration: '2026-07-27',
      type: 'put',
      strike: 447.5,
    });
  });

  it('returns null on garbage', () => {
    expect(parseOccSymbol('not-an-occ')).toBeNull();
    expect(parseOccSymbol('')).toBeNull();
  });
});

describe('horizonCalendarDays', () => {
  it('converts trading days to calendar days', () => {
    expect(horizonCalendarDays(5)).toBe(7);
    expect(horizonCalendarDays(1)).toBe(2);
    expect(horizonCalendarDays(20)).toBe(28);
  });
});

describe('resolveEarningsContext', () => {
  const opts = { today: '2026-07-22', horizonDays: 5, underlyingPrice: 500 };

  it('picks the next upcoming report and computes expected move pct', () => {
    const ctx = resolveEarningsContext(
      [
        { report_date: '2026-08-04', report_time: 'postmarket', expected_move: '69' },
        { report_date: '2026-05-05', report_time: 'postmarket', expected_move: '26' },
      ],
      opts
    );
    expect(ctx.nextReportDate).toBe('2026-08-04');
    expect(ctx.expectedMovePct).toBeCloseTo(69 / 500, 6);
    expect(ctx.withinHorizon).toBe(false);
  });

  it('postmarket report -> move lands next session; premarket -> same day', () => {
    const post = resolveEarningsContext(
      [{ report_date: '2026-07-27', report_time: 'postmarket' }],
      opts
    );
    expect(post.earnMoveDate).toBe('2026-07-28');
    const pre = resolveEarningsContext(
      [{ report_date: '2026-07-27', report_time: 'premarket' }],
      opts
    );
    expect(pre.earnMoveDate).toBe('2026-07-27');
    expect(pre.withinHorizon).toBe(true); // within 7 calendar days
  });

  it('returns null with no upcoming report', () => {
    expect(resolveEarningsContext([{ report_date: '2026-05-05' }], opts)).toBeNull();
    expect(resolveEarningsContext([], opts)).toBeNull();
    expect(resolveEarningsContext(null, opts)).toBeNull();
  });
});

describe('scoreContract', () => {
  it('scores a liquid near-the-money contract', () => {
    const res = scoreContract(baseStock, baseContract, baseContext);
    expect(res.ok).toBe(true);
    const { row } = res;
    // entry between mid and ask
    expect(row.entryDebit).toBeGreaterThan(row.mid);
    expect(row.entryDebit).toBeLessThanOrEqual(row.ask);
    expect(row.maxLossPerContract).toBeCloseTo(row.entryDebit * 100, 1);
    // breakeven above strike for a call
    expect(row.breakeven).toBeCloseTo(190 + row.entryDebit, 2);
    // our bullish view must beat risk-neutral for a call
    expect(row.popModel).toBeGreaterThan(row.popMarket);
    expect(row.popEdge).toBeCloseTo(row.popModel - row.popMarket, 6);
    // target scenario worth more than flat, flat more than stop
    expect(row.scenarioValues.target).toBeGreaterThan(row.scenarioValues.flat);
    expect(row.scenarioValues.flat).toBeGreaterThan(row.scenarioValues.stop);
    expect(row.thetaBurnPct).toBeGreaterThan(0);
  });

  it('rejects null greeks / iv', () => {
    expect(scoreContract(baseStock, { ...baseContract, greeks: null }, baseContext))
      .toEqual({ ok: false, reason: 'noGreeks' });
    expect(scoreContract(baseStock, { ...baseContract, iv: null }, baseContext))
      .toEqual({ ok: false, reason: 'noGreeks' });
  });

  it('rejects zero/crossed quotes, illiquid, wide spread, over budget', () => {
    expect(scoreContract(baseStock, { ...baseContract, bid: 0 }, baseContext).reason)
      .toBe('zeroBid');
    expect(scoreContract(baseStock, { ...baseContract, openInterest: 5 }, baseContext).reason)
      .toBe('illiquid');
    expect(scoreContract(baseStock, { ...baseContract, bid: 3, ask: 6 }, baseContext).reason)
      .toBe('wideSpread');
    expect(
      scoreContract(baseStock, baseContract, baseContext, { maxDebit: 100 }).reason
    ).toBe('overBudget');
  });

  it('rejects lottery-ticket deltas below the hard floor', () => {
    const lotto = {
      ...baseContract,
      greeks: { ...baseContract.greeks, delta: 0.08 },
    };
    expect(scoreContract(baseStock, lotto, baseContext).reason).toBe('lowDelta');
    // 0.15–0.25 band passes but carries the LOW_DELTA warning flag
    const leaning = {
      ...baseContract,
      greeks: { ...baseContract.greeks, delta: 0.18 },
    };
    const res = scoreContract(baseStock, leaning, baseContext);
    expect(res.ok).toBe(true);
    expect(res.row.riskFlags).toContain('LOW_DELTA');
  });

  it('null open interest counts as illiquid', () => {
    expect(scoreContract(baseStock, { ...baseContract, openInterest: null }, baseContext).reason)
      .toBe('illiquid');
  });

  it('flags earnings inside expiry as IV-crush risk', () => {
    const earnings = resolveEarningsContext(
      [{ report_date: '2026-08-04', report_time: 'postmarket', expected_move: '12' }],
      { today: '2026-07-22', horizonDays: 5, underlyingPrice: 185 }
    );
    const res = scoreContract(baseStock, baseContract, { ...baseContext, earnings });
    expect(res.ok).toBe(true);
    expect(res.row.earnings.spansEarnings).toBe(true);
    expect(res.row.riskFlags).toContain('EARNINGS_IV_CRUSH');
  });

  it('earnings after expiry does not span', () => {
    const earnings = resolveEarningsContext(
      [{ report_date: '2026-09-15', report_time: 'postmarket' }],
      { today: '2026-07-22', horizonDays: 5, underlyingPrice: 185 }
    );
    const res = scoreContract(baseStock, baseContract, { ...baseContext, earnings });
    expect(res.row.earnings.spansEarnings).toBe(false);
    expect(res.row.riskFlags).not.toContain('EARNINGS_IV_CRUSH');
  });

  it('a stronger directional view raises popModel and expectedRoi', () => {
    const weak = scoreContract({ ...baseStock, probability: 0.5 }, baseContract, baseContext);
    const strong = scoreContract({ ...baseStock, probability: 0.75 }, baseContract, baseContext);
    expect(strong.row.popModel).toBeGreaterThan(weak.row.popModel);
    expect(strong.row.expectedRoi).toBeGreaterThan(weak.row.expectedRoi);
  });

  it('mirrors for SHORT direction with puts', () => {
    const shortStock = {
      ...baseStock,
      direction: 'SHORT',
      targetPrice: 172,
      stopPrice: 191,
    };
    const put = {
      ...baseContract,
      occSymbol: 'NVDA260821P00180000',
      strike: 180,
      type: 'put',
      greeks: { delta: -0.42, gamma: 0.02, theta: -0.08, vega: 0.2 },
    };
    const res = scoreContract(shortStock, put, baseContext);
    expect(res.ok).toBe(true);
    expect(res.row.breakeven).toBeCloseTo(180 - res.row.entryDebit, 2);
    expect(res.row.popModel).toBeGreaterThan(res.row.popMarket);
    expect(res.row.scenarioValues.target).toBeGreaterThan(res.row.scenarioValues.stop);
  });

  it('contract expiring mid-horizon gets a pro-rated move, not the full-horizon payoff', () => {
    // 20d horizon = 28 calendar days. A 9-DTE contract can only capture
    // √(9/28) ≈ 57% of the expected move — before this fix it was credited
    // with the full move at intrinsic and its ROI exploded ~10x.
    const stock20 = { ...baseStock, horizonDays: 20, targetPrice: 210 };
    const shortDated = { ...baseContract, expiration: '2026-07-31' }; // 9 DTE
    const longDated = { ...baseContract, expiration: '2026-08-31' };  // 40 DTE
    const s = scoreContract(stock20, shortDated, baseContext);
    const l = scoreContract(stock20, longDated, baseContext);
    expect(s.ok).toBe(true);
    expect(l.ok).toBe(true);
    // Short-dated: exit at expiry, intrinsic of the PARTIAL move only.
    // Full move would be 210 (intrinsic 20 vs 190 strike); partial is
    // 185 + 25·√(9/28) ≈ 199.2 → intrinsic ≈ 9.2.
    expect(s.row.scenarioValues.target).toBeLessThan(12);
    expect(s.row.scenarioValues.target).toBeGreaterThan(6);
    // Long-dated survives the whole horizon: full move + remaining time value.
    expect(l.row.scenarioValues.target).toBeGreaterThan(s.row.scenarioValues.target);
    expect(l.row.expectedRoi).toBeGreaterThan(s.row.expectedRoi);
  });

  it('earnings before exit applies the IV-crush haircut to exit marks', () => {
    const earnings = resolveEarningsContext(
      [{ report_date: '2026-07-23', report_time: 'premarket', expected_move: '10' }],
      { today: '2026-07-22', horizonDays: 5, underlyingPrice: 185 }
    );
    const withCrush = scoreContract(baseStock, baseContract, { ...baseContext, earnings });
    const noCrush = scoreContract(baseStock, baseContract, baseContext);
    expect(withCrush.ok).toBe(true);
    // Exit marks are revalued at 75% of IV → every scenario worth less.
    expect(withCrush.row.scenarioValues.flat).toBeLessThan(noCrush.row.scenarioValues.flat);
    expect(withCrush.row.scenarioValues.target).toBeLessThan(noCrush.row.scenarioValues.target);
    expect(withCrush.row.expectedRoi).toBeLessThan(noCrush.row.expectedRoi);
    expect(withCrush.row.reasons.join(' ')).toMatch(/IV-crush haircut/);
  });

  it('earnings after the exit does not haircut (we exit before the report)', () => {
    const earnings = resolveEarningsContext(
      [{ report_date: '2026-08-10', report_time: 'postmarket' }],
      { today: '2026-07-22', horizonDays: 5, underlyingPrice: 185 }
    );
    // Report is inside the contract's life (spansEarnings) but after our
    // 7-calendar-day exit — the plan is to be out before it hits.
    const res = scoreContract(baseStock, baseContract, { ...baseContext, earnings });
    const plain = scoreContract(baseStock, baseContract, baseContext);
    expect(res.row.earnings.spansEarnings).toBe(true);
    expect(res.row.scenarioValues.flat).toBeCloseTo(plain.row.scenarioValues.flat, 6);
  });

  it('scores LEAPS-dated contracts (months out) with remaining time value', () => {
    const leaps = {
      ...baseContract,
      occSymbol: 'NVDA270618C00190000',
      expiration: '2027-06-18', // ~11 months
      bid: 24.0,
      ask: 25.5,
      greeks: { delta: 0.58, gamma: 0.006, theta: -0.03, vega: 0.6 },
      iv: 0.45,
    };
    const res = scoreContract(baseStock, leaps, baseContext);
    expect(res.ok).toBe(true);
    // Almost all the debit survives the 7-day hold: flat exit ≈ entry.
    expect(res.row.scenarioValues.flat).toBeGreaterThan(res.row.entryDebit * 0.9);
    expect(res.row.thetaBurnPct).toBeLessThan(0.05);
    expect(res.row.riskFlags).not.toContain('SHORT_DTE');
  });

  it('short-dated contract gets only pro-rata model drift', () => {
    // Same 2-DTE contract, same target: under a 5d-horizon view only
    // √(2/7) of the move fits before expiry, so popModel must be lower
    // than under a 1d-horizon view where the full drift applies.
    const shortDated = { ...baseContract, expiration: '2026-07-24' };
    const proRated = scoreContract(baseStock, shortDated, baseContext);
    const fullDrift = scoreContract({ ...baseStock, horizonDays: 1 }, shortDated, baseContext);
    expect(proRated.ok).toBe(true);
    expect(proRated.row.riskFlags).toContain('SHORT_DTE');
    expect(proRated.row.popModel).toBeLessThan(fullDrift.row.popModel);
  });
});
