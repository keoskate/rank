/**
 * Options pricing/scoring model for the options scanner. Pure math, no I/O.
 *
 * Philosophy: the edge source is the stock scanner's calibrated directional
 * probability — options are the expression vehicle. This module does NOT
 * claim to detect mispriced vol; it prices what a contract is worth UNDER OUR
 * DIRECTIONAL VIEW and compares that to what the market charges, net of the
 * two costs that actually kill option buyers: spread and theta.
 *
 * Key outputs per contract:
 *  - expectedRoi / evPerContract: scenario EV. The stock leg's three outcomes
 *    (target hit @ prob p, stop hit, nothing happens) are revalued with
 *    Black-Scholes at the horizon using the contract's own IV, minus exit
 *    half-spread. The "nothing happens" leg is what the stock scanner's
 *    binary p·RR−(1−p) can't see: theta burns while the thesis stalls.
 *  - popModel vs popMarket: P(profit at expiry) under a lognormal terminal
 *    distribution. popModel applies our directional drift ONLY during the
 *    forecast horizon (risk-neutral after) — extrapolating a 5-day view over
 *    a 45-day option's whole life would overstate the edge. popMarket is the
 *    pure risk-neutral number. popEdge = popModel − popMarket is THE metric:
 *    how much our view beats what's priced in.
 *  - itmProbMarket ≈ |delta|: the market's ITM probability. Caveat: delta is
 *    the risk-neutral N(d1), which slightly overstates the true N(d2).
 *
 * All caveats are features: most contracts get filtered, and a scan that
 * surfaces three rows is working as intended.
 */

const RISK_FREE_RATE = 0.04;
const FILL_FRACTION = 0.5; // assume fill halfway between mid and ask
const STOP_SHARE_Q = 0.5; // of the (1-p) non-target mass, share that hits stop vs drifts flat
// Post-report front-month IV typically drops 25-35%; we price the
// conservative end into exit marks when the report lands before our exit.
const EARNINGS_IV_CRUSH_FACTOR = 0.75;
const DAY_MS = 86400000;

// Liquidity / quality gates
const MIN_OPEN_INTEREST = 100;
const MAX_SPREAD_PCT = 0.15;
const MIN_BID = 0.05;
// Hard delta floor: below this, ranking by model EV degenerates into
// lottery tickets — tiny premiums where any model overconfidence
// multiplies into huge fake ROI. Live-scan tested: without it the board
// filled with delta-0.08 weeklies.
const MIN_DELTA = 0.15;
const MIN_POP_MODEL = 0.25;
const MIN_EXPECTED_ROI = 0.15;
const MAX_PER_UNDERLYING = 2;

// Risk-flag thresholds
const WIDE_SPREAD_PCT = 0.1;
const HIGH_IV_RANK = 80;
const SHORT_DTE = 10;
const LOW_DELTA = 0.25; // lottery-leaning (hard floor is MIN_DELTA)

/** Abramowitz & Stegun 7.1.26 approximation, |err| < 7.5e-8. */
function normalCdf(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * Black-Scholes European option price. At tau <= 0 returns intrinsic value.
 * @param {object} p { S, K, tau (years), sigma, type: 'call'|'put', r }
 */
function bsPrice({ S, K, tau, sigma, type, r = RISK_FREE_RATE }) {
  if (!(S > 0) || !(K > 0)) return 0;
  if (!(tau > 0) || !(sigma > 0)) {
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const sqrtTau = Math.sqrt(tau);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * tau) / (sigma * sqrtTau);
  const d2 = d1 - sigma * sqrtTau;
  if (type === 'call') {
    return S * normalCdf(d1) - K * Math.exp(-r * tau) * normalCdf(d2);
  }
  return K * Math.exp(-r * tau) * normalCdf(-d2) - S * normalCdf(-d1);
}

/** OCC symbol -> { underlying, expiration: 'YYYY-MM-DD', type, strike }, or null. */
function parseOccSymbol(occ) {
  const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(occ || ''));
  if (!m) return null;
  return {
    underlying: m[1],
    expiration: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === 'C' ? 'call' : 'put',
    strike: parseInt(m[6], 10) / 1000,
  };
}

function _utcMs(dateStr) {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Trading-days horizon -> calendar days (5 trading days ≈ 7 calendar). */
function horizonCalendarDays(horizonDays) {
  return Math.ceil(horizonDays * (7 / 5));
}

/**
 * Resolve UW earnings rows into scanner context for one underlying.
 * The move lands the session AFTER a postmarket (or unknown-time) report.
 *
 * @param {Array} earningsRows - UW /api/earnings/{ticker} rows (any order)
 * @param {object} opts { today: 'YYYY-MM-DD', horizonDays, underlyingPrice }
 * @returns {object|null} { nextReportDate, reportTime, earnMoveDate,
 *   expectedMovePct } or null when no upcoming report is known.
 */
function resolveEarningsContext(earningsRows, { today, horizonDays, underlyingPrice }) {
  if (!Array.isArray(earningsRows) || earningsRows.length === 0) return null;
  const todayMs = _utcMs(today);
  const upcoming = earningsRows
    .filter(r => r && r.report_date && _utcMs(r.report_date) >= todayMs)
    .sort((a, b) => _utcMs(a.report_date) - _utcMs(b.report_date))[0];
  if (!upcoming) return null;

  const reportTime = upcoming.report_time || 'unknown';
  const reportMs = _utcMs(upcoming.report_date);
  const earnMoveMs = reportTime === 'premarket' ? reportMs : reportMs + DAY_MS;
  const move = parseFloat(upcoming.expected_move);
  const expectedMovePct =
    Number.isFinite(move) && underlyingPrice > 0 ? move / underlyingPrice : null;

  return {
    nextReportDate: upcoming.report_date,
    reportTime,
    earnMoveDate: new Date(earnMoveMs).toISOString().slice(0, 10),
    withinHorizon: earnMoveMs <= todayMs + horizonCalendarDays(horizonDays) * DAY_MS,
    expectedMovePct,
  };
}

/**
 * Score one contract against the stock scanner's directional view.
 *
 * @param {object} stock { symbol, direction, probability, currentPrice,
 *   targetPrice, stopPrice, horizonDays }
 * @param {object} contract { occSymbol, strike, expiration ('YYYY-MM-DD'),
 *   type ('call'|'put'), bid, ask, greeks|null, iv|null, openInterest|null,
 *   dayVolume|null }
 * @param {object} context { today: 'YYYY-MM-DD', ivRank|null,
 *   earnings (resolveEarningsContext result)|null }
 * @param {object} filters { minOpenInterest, maxSpreadPct, maxDebit|null,
 *   minDelta }
 * @returns {{ ok: true, row: object } | { ok: false, reason: string }}
 */
function scoreContract(stock, contract, context, filters = {}) {
  const minOpenInterest = filters.minOpenInterest ?? MIN_OPEN_INTEREST;
  const maxSpreadPct = filters.maxSpreadPct ?? MAX_SPREAD_PCT;
  const maxDebit = filters.maxDebit ?? null;
  const minDelta = filters.minDelta ?? MIN_DELTA;

  const { greeks, iv, bid, ask } = contract;
  if (!greeks || !Number.isFinite(greeks.delta) || !Number.isFinite(iv) || iv <= 0) {
    return { ok: false, reason: 'noGreeks' };
  }
  if (Math.abs(greeks.delta) < minDelta) {
    return { ok: false, reason: 'lowDelta' };
  }
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid < MIN_BID || ask <= bid) {
    return { ok: false, reason: 'zeroBid' };
  }
  const openInterest = Number.isFinite(+contract.openInterest) ? +contract.openInterest : 0;
  if (openInterest < minOpenInterest) {
    return { ok: false, reason: 'illiquid' };
  }

  const mid = (bid + ask) / 2;
  const halfSpread = (ask - bid) / 2;
  const spreadPct = (ask - bid) / mid;
  if (spreadPct > maxSpreadPct) {
    return { ok: false, reason: 'wideSpread' };
  }
  const entryDebit = mid + FILL_FRACTION * halfSpread;
  const costPerContract = 100 * entryDebit;
  if (maxDebit != null && costPerContract > maxDebit) {
    return { ok: false, reason: 'overBudget' };
  }

  const S0 = stock.currentPrice;
  const T = stock.targetPrice;
  const X = stock.stopPrice;
  const p = stock.probability;
  const q = STOP_SHARE_Q;
  const K = contract.strike;
  const type = contract.type;

  const todayMs = _utcMs(context.today);
  const expMs = _utcMs(contract.expiration);
  const dte = Math.max(Math.round((expMs - todayMs) / DAY_MS), 0);
  const hCal = horizonCalendarDays(stock.horizonDays);
  const tauExp = dte / 365;
  // Exit at the horizon, or at expiry if it comes first.
  const effCal = Math.min(dte, hCal);
  const tauRem = Math.max(dte - hCal, 0) / 365;
  // A contract that expires mid-horizon only captures part of the expected
  // move. The target model scales moves with √t (ATR×√h), so pro-rate the
  // same way — without this, short-DTE contracts get credited with the full
  // horizon move at intrinsic and their EV explodes (live-scan verified).
  const moveScale = hCal > 0 ? Math.sqrt(effCal / hCal) : 1;
  const spotAtExit = S => S0 + (S - S0) * moveScale;

  const earnings = context.earnings
    ? {
        ...context.earnings,
        spansEarnings: _utcMs(context.earnings.earnMoveDate) <= expMs,
      }
    : null;
  // When the report lands before our exit, exit marks carry post-crush IV.
  const crushAtExit =
    earnings && _utcMs(earnings.earnMoveDate) <= todayMs + effCal * DAY_MS;
  const scenarioSigma = crushAtExit ? iv * EARNINGS_IV_CRUSH_FACTOR : iv;

  // --- Scenario EV: revalue at exit (pro-rated marks, minus exit
  // half-spread), floor at zero (an option can't be worth less than nothing).
  const scenarioValue = S =>
    Math.max(bsPrice({ S: spotAtExit(S), K, tau: tauRem, sigma: scenarioSigma, type }) - halfSpread, 0);
  const valueAtTarget = scenarioValue(T);
  const valueAtStop = scenarioValue(X);
  const valueFlat = scenarioValue(S0);
  const expectedExit = p * valueAtTarget + (1 - p) * q * valueAtStop + (1 - p) * (1 - q) * valueFlat;
  const expectedRoi = (expectedExit - entryDebit) / entryDebit;
  const evPerContract = 100 * (expectedExit - entryDebit);

  // --- Probability of profit at expiry (lognormal terminal distribution).
  // Our drift applies only during the forecast horizon; risk-neutral after.
  const breakeven = type === 'call' ? K + entryDebit : K - entryDebit;
  if (!(breakeven > 0)) return { ok: false, reason: 'noGreeks' }; // deep-ITM put artifact
  const expectedSpotAtHorizon = p * T + (1 - p) * q * X + (1 - p) * (1 - q) * S0;
  // Same √t pro-rating as the scenario EV: only part of the expected move
  // can land before an early expiry.
  const modelLogDrift = Math.log(spotAtExit(expectedSpotAtHorizon) / S0);
  const sigmaSqrtTau = iv * Math.sqrt(Math.max(tauExp, 1e-6));

  const popWithDrift = horizonLogDrift => {
    const meanShift =
      horizonLogDrift + RISK_FREE_RATE * tauRem - ((iv * iv) / 2) * tauExp;
    const z = (Math.log(breakeven / S0) - meanShift) / sigmaSqrtTau;
    // P(S > BE) for calls, P(S < BE) for puts
    return type === 'call' ? 1 - normalCdf(z) : normalCdf(z);
  };
  const popModel = popWithDrift(modelLogDrift);
  const popMarket = popWithDrift(RISK_FREE_RATE * Math.min(tauExp, hCal / 365));
  const popEdge = popModel - popMarket;

  const thetaBurnPct = Number.isFinite(greeks.theta)
    ? Math.min((Math.abs(greeks.theta) * Math.min(hCal, dte)) / entryDebit, 1)
    : null;

  const riskFlags = [];
  if (spreadPct > WIDE_SPREAD_PCT) riskFlags.push('WIDE_SPREAD');
  if (Number.isFinite(context.ivRank) && context.ivRank > HIGH_IV_RANK) riskFlags.push('HIGH_IV_RANK');
  if (earnings?.spansEarnings) riskFlags.push('EARNINGS_IV_CRUSH');
  if (dte < SHORT_DTE) riskFlags.push('SHORT_DTE');
  if (Math.abs(greeks.delta) < LOW_DELTA) riskFlags.push('LOW_DELTA');

  const reasons = [
    `Stock scan: ${(p * 100).toFixed(0)}% ${stock.direction} edge, target $${T.toFixed(2)}`,
    `Model PoP ${(popModel * 100).toFixed(0)}% vs ${(popMarket * 100).toFixed(0)}% market-implied`,
    `Needs ${((breakeven / S0 - 1) * 100).toFixed(1)}% move to breakeven by ${contract.expiration}`,
  ];
  if (earnings?.spansEarnings) {
    reasons.push(
      `Earnings ${earnings.nextReportDate}${earnings.expectedMovePct != null ? ` (market prices ±${(earnings.expectedMovePct * 100).toFixed(1)}%)` : ''}`
    );
  }
  if (crushAtExit) {
    reasons.push('IV-crush haircut priced in (report lands before exit)');
  }

  return {
    ok: true,
    row: {
      contractSymbol: contract.occSymbol,
      underlying: stock.symbol,
      type,
      direction: stock.direction,
      strike: K,
      expiration: contract.expiration,
      dte,
      bid: +bid.toFixed(2),
      ask: +ask.toFixed(2),
      mid: +mid.toFixed(3),
      spreadPct: +spreadPct.toFixed(4),
      entryDebit: +entryDebit.toFixed(3),
      costPerContract: +costPerContract.toFixed(2),
      maxLossPerContract: +costPerContract.toFixed(2),
      openInterest,
      dayVolume: contract.dayVolume ?? null,
      greeks: {
        delta: +greeks.delta.toFixed(4),
        gamma: Number.isFinite(greeks.gamma) ? +greeks.gamma.toFixed(4) : null,
        theta: Number.isFinite(greeks.theta) ? +greeks.theta.toFixed(4) : null,
        vega: Number.isFinite(greeks.vega) ? +greeks.vega.toFixed(4) : null,
      },
      iv: +iv.toFixed(4),
      ivRank: Number.isFinite(context.ivRank) ? +context.ivRank.toFixed(1) : null,
      underlyingPrice: +S0.toFixed(4),
      targetPrice: +T.toFixed(4),
      stopPrice: +X.toFixed(4),
      stockProbability: +p.toFixed(4),
      breakeven: +breakeven.toFixed(2),
      breakevenMovePct: +(breakeven / S0 - 1).toFixed(4),
      popModel: +popModel.toFixed(4),
      popMarket: +popMarket.toFixed(4),
      popEdge: +popEdge.toFixed(4),
      itmProbMarket: +Math.abs(greeks.delta).toFixed(4),
      scenarioValues: {
        target: +valueAtTarget.toFixed(3),
        flat: +valueFlat.toFixed(3),
        stop: +valueAtStop.toFixed(3),
      },
      expectedRoi: +expectedRoi.toFixed(4),
      evPerContract: +evPerContract.toFixed(2),
      thetaBurnPct: thetaBurnPct != null ? +thetaBurnPct.toFixed(4) : null,
      earnings,
      riskFlags,
      reasons,
    },
  };
}

module.exports = {
  normalCdf,
  bsPrice,
  parseOccSymbol,
  horizonCalendarDays,
  resolveEarningsContext,
  scoreContract,
  RISK_FREE_RATE,
  FILL_FRACTION,
  STOP_SHARE_Q,
  EARNINGS_IV_CRUSH_FACTOR,
  MIN_OPEN_INTEREST,
  MAX_SPREAD_PCT,
  MIN_DELTA,
  MIN_POP_MODEL,
  MIN_EXPECTED_ROI,
  MAX_PER_UNDERLYING,
};
