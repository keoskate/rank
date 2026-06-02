// server/risk/kellySizing.js
// Fractional Kelly position sizing for broker agents.
//
// Math: f* = (p·b - q) / b
//   p = win probability
//   q = 1 - p
//   b = average-win / average-loss (payoff ratio)
//
// f* is the fraction of bankroll that maximizes log-growth in repeated bets.
// Full Kelly is volatile under estimation error; we clamp to a fractional
// multiple (default 0.25) per the Medallion-style discipline.
//
// New agents (insufficient trade history) fall back to a weak Bayesian prior:
//   p = 0.51, b = 1.0  → tiny positive edge, very small f*.
// This is the "51% edge, bet repeatedly" prior — agents don't size big until
// they've earned a track record on their own trades.

const MIN_TRADES_FOR_EMPIRICAL = 20;
const MIN_LOSSES_FOR_PAYOFF = 5; // need real losses before trusting empirical payoff
const MAX_WIN_RATE = 0.95; // never feed a 100% win rate into Kelly
const PRIOR_WIN_RATE = 0.51;
const PRIOR_PAYOFF_RATIO = 1.0;
const ROLLING_WINDOW = 100;

/**
 * Standard Kelly fraction from a win rate and payoff ratio.
 * @param {number} winRate probability of win, in (0, 1)
 * @param {number} payoffRatio average win / average loss
 * @returns {number} optimal full-Kelly fraction. Negative means "don't bet."
 */
function kellyFraction(winRate, payoffRatio) {
  if (!isFinite(winRate) || !isFinite(payoffRatio)) return 0;
  if (winRate <= 0 || winRate >= 1 || payoffRatio <= 0) return 0;
  const q = 1 - winRate;
  return (winRate * payoffRatio - q) / payoffRatio;
}

/**
 * Empirical win rate + payoff ratio from the most recent N closed trades in
 * the session's trading log. Only sell-side entries with realizedPnL are used.
 *
 * @param {object} session the engine session
 * @param {number} window max number of recent trades to consider
 * @returns {{ winRate: number|null, payoffRatio: number|null, sample: number }}
 */
function empiricalStats(session, window = ROLLING_WINDOW) {
  const log = (session && session.tradingLog) || [];
  // Only count completed trades. Payoff must be computed from per-trade RETURN
  // (realizedPct), never raw dollars — dollar payoff self-inflates as Kelly
  // grows the position size, a feedback loop divorced from real edge.
  const closed = log
    .filter(t => t && t.side === 'sell' && typeof t.realizedPct === 'number')
    .slice(-window);

  if (closed.length === 0) {
    return { winRate: null, payoffRatio: null, sample: 0 };
  }

  let wins = 0;
  let losses = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const t of closed) {
    const r = t.realizedPct;
    if (r > 0) {
      wins++;
      winSum += r;
    } else if (r < 0) {
      losses++;
      lossSum += Math.abs(r);
    }
    // exact-zero break-evens are excluded from both win and loss counts
  }
  const decided = wins + losses;
  if (decided === 0) return { winRate: null, payoffRatio: null, sample: 0 };

  // Regularize the win rate (Laplace) so a small flawless sample neither sizes
  // to zero (winRate≥1 → fullKelly 0) nor a lucky streak straight to the cap.
  const winRate = Math.min((wins + 1) / (decided + 2), MAX_WIN_RATE);
  const avgWin = wins > 0 ? winSum / wins : 0;
  const avgLoss = losses > 0 ? lossSum / losses : 0;
  // Only trust the empirical payoff once there are enough real losses; otherwise
  // fall back to the neutral prior payoff (no fabricated 2:1).
  const payoffRatio =
    losses >= MIN_LOSSES_FOR_PAYOFF && avgLoss > 0
      ? avgWin / avgLoss
      : PRIOR_PAYOFF_RATIO;

  return { winRate, payoffRatio, sample: decided };
}

/**
 * Compute a position size in dollars using fractional Kelly. Falls back to a
 * weak Bayesian prior for agents that don't have enough trades yet.
 *
 * @param {object} session  engine session
 * @param {object} opts
 * @param {number} opts.portfolioValue current portfolio total value
 * @param {number} opts.kellyFraction broker's fractional Kelly multiplier (e.g. 0.25)
 * @param {number} opts.maxPercent hard cap on % of portfolio per position
 * @param {number} opts.minPercent minimum % when full Kelly is positive (so we still place a bet)
 * @returns {{ dollars: number, percent: number, source: string, stats: object }}
 */
function computeKellySize(session, opts = {}) {
  const portfolioValue = Math.max(0, parseFloat(opts.portfolioValue) || 0);
  const fractionMult = Math.min(
    1,
    Math.max(0, parseFloat(opts.kellyFraction) || 0.25)
  );
  const maxPct = Math.min(100, Math.max(0, parseFloat(opts.maxPercent) || 25));
  const minPct = Math.max(0, parseFloat(opts.minPercent) || 0.5);

  const emp = empiricalStats(session);
  let winRate;
  let payoffRatio;
  let source;

  if (emp.sample >= MIN_TRADES_FOR_EMPIRICAL) {
    winRate = emp.winRate;
    payoffRatio = emp.payoffRatio;
    source = `empirical(${emp.sample})`;
  } else if (emp.sample > 0) {
    // Blend prior + empirical when we have some data but not enough to trust.
    const w = emp.sample / MIN_TRADES_FOR_EMPIRICAL; // 0..1
    winRate = PRIOR_WIN_RATE * (1 - w) + emp.winRate * w;
    payoffRatio = PRIOR_PAYOFF_RATIO * (1 - w) + emp.payoffRatio * w;
    source = `blended(${emp.sample})`;
  } else {
    winRate = PRIOR_WIN_RATE;
    payoffRatio = PRIOR_PAYOFF_RATIO;
    source = 'prior';
  }

  const fullKelly = kellyFraction(winRate, payoffRatio);
  if (fullKelly <= 0) {
    return {
      dollars: 0,
      percent: 0,
      source,
      stats: {
        winRate,
        payoffRatio,
        fullKelly,
        fractionMult,
        sample: emp.sample,
      },
    };
  }

  // Apply fractional multiplier and clamp
  const rawPct = fullKelly * fractionMult * 100; // percent of portfolio
  const clampedPct = Math.min(maxPct, Math.max(minPct, rawPct));
  const dollars = portfolioValue * (clampedPct / 100);

  return {
    dollars,
    percent: clampedPct,
    source,
    stats: {
      winRate,
      payoffRatio,
      fullKelly,
      fractionMult,
      sample: emp.sample,
    },
  };
}

module.exports = {
  kellyFraction,
  empiricalStats,
  computeKellySize,
  MIN_TRADES_FOR_EMPIRICAL,
  PRIOR_WIN_RATE,
  PRIOR_PAYOFF_RATIO,
  ROLLING_WINDOW,
};
