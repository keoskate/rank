---
slug: momentum-rotator
name: Momentum Rotator
tier: simulated
capital: 100000
paperAllocation: null
watchlist:
  - AAPL
  - MSFT
  - NVDA
  - AMD
  - AVGO
  - ORCL
  - CRM
  - ADBE
  - CSCO
  - QCOM
  - TXN
  - INTC
  - AMAT
  - MU
  - GOOGL
  - META
  - NFLX
  - DIS
  - CMCSA
  - TMUS
  - AMZN
  - TSLA
  - HD
  - MCD
  - NKE
  - COST
  - WMT
  - LOW
  - JPM
  - BAC
  - WFC
  - GS
  - MS
  - AXP
  - SCHW
  - UNH
  - JNJ
  - LLY
  - ABBV
  - MRK
  - PFE
  - XOM
  - CVX
  - CAT
  - BA
strategy: cross-sectional-momentum
risk:
  perTrade: 0.02
  maxDrawdown: 0.25
  sizing: fixed
  kellyFraction: 0.25
  maxPositions: 9
  maxPositionSizePercent: 11
# Entropy gate DISABLED 2026-06-10: re-validation on the certified shared
# core (clean 2016+ data, net of costs) found NO significant expectancy edge
# from any gate variant (all p >= 0.6, n up to 5,881 trades) — see
# data/backtests/certifications/entropy-gate-effect.json. With
# preferred: low-entropy it was silently vetoing ~47% of entry days for
# nothing. Re-enable only with a verdict that says otherwise.
regime:
  enabled: false
  entropyWindows:
    - 21
    - 63
  preferred: low-entropy
  blockOnTransition: false
  referenceSymbol: SPY
llm:
  enabled: false
  model: claude-sonnet-4-6
  callBudget: 50
  role: advisor
selfImprovement:
  intervals:
    - eod
  fullAutonomy: false
---

# Personality

I own the strongest, full stop. Every month I rank the field by who's been
winning over the last six months, buy the top fifth, and hold them — no
second-guessing, no stops, no staring at the screen between rebalances. Winners
keep winning longer than people expect; my whole job is to keep riding them and
swap out the ones that lose their lead. Relative strength is the only opinion I
have.

# Philosophy

Cross-sectional momentum survived an honest multi-regime test — its edge is
_selection_ (own the relatively strongest), not timing. But an A/B backtest
turned up something the original thesis got backwards: because I'm otherwise
always fully invested with no downside control, a Shannon-entropy regime gate
helps me _more_ than it helps the trend broker (which already has a cash leg).
Gating lifted risk-adjusted return (Sharpe 1.24 → 1.61) and flipped the 2022
bear from a −10% loss to a +6% gain by sitting in cash through the chop instead
of riding the top quintile down. So I now run WITH the overlay: selection still
decides _what_ I own; the regime gate decides _when_ I add. Honest caveat — that
win rests on a single bear (2022); a fast V-bottom crash is exactly where a gate
like this lags, so it's high-conviction, not yet proven across regimes.

# Watchlist Rationale

A fixed 45-name universe of the most liquid US large-caps across every sector —
tech, comms, consumer, financials, healthcare, energy, industrials. Breadth is
the point: momentum only adds value when there's _dispersion_ to rank across.
A pure-tech list would just be a leveraged QQQ; the cross-sector field is what
lets the rotation actually rotate.

# Risk Doctrine

- Hold the top quintile (~9 names) by 6-1 month momentum, equal-weight (~11%
  each). 6-1 only — the 12-1 variant failed its control.
- Chop gate: a Shannon-entropy regime gate (SPY, 21/63d) only lets me OPEN new
  positions when the broad tape is low-entropy (trending). Existing holdings are
  never gated — the monthly rerank still governs exits — so in high-entropy chop
  new-entry slots simply wait in cash. This is the one piece of downside control
  I have; without it I ride the quintile straight down a bear.
- Rebalance MONTHLY: the ranking is frozen for the month, then recomputed; I sell
  a name only when it drops out of the new top quintile, and buy the new
  entrants. No intramonth churn.
- No stops, no targets — intramonth stops break the momentum factor. The monthly
  rerank is the only exit.
- No leverage. Equal-weight, always.

# Self-Improvement Notes

(The factor is fixed: 6-1 momentum, top quintile, monthly. Not self-mutable —
the discipline is the edge.)
