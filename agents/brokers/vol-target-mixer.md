---
slug: vol-target-mixer
name: Vol-Target Mixer
tier: simulated
capital: 100000
paperAllocation: null
watchlist:
  - SOXX
  - GLD
strategy: vol-target-mix
voltarget:
  pairA: SOXX
  pairB: GLD
  mixW: 0.5
  targetVol: 0.12
  volWindow: 20
  enterAboveWeight: 0.2
  exitBelowWeight: 0.15
risk:
  perTrade: 0.02
  maxDrawdown: 0.25
  sizing: fixed
  kellyFraction: 0.25
  maxPositions: 2
  # Two legs, each up to half the book at full exposure. The engine's slot
  # sizing is the recorded execution residual vs the backtest's continuous
  # weights (see certifications/vol-target-mix.json).
  maxPositionSizePercent: 50
  # All three rails ARMED (promotion-eligibility requires them):
  maxPortfolioDrawdown: 0.20
  dailyLossLimit: 0.05
  maxConsecutiveLosses: 8
  trimAtProfitPercent: null
  trimFraction: 0.5
regime:
  enabled: false
macro:
  enabled: false
llm:
  enabled: false
selfImprovement:
  intervals:
    - eod
  fullAutonomy: false
---

# Vol-Target Mixer

The forward-confirmation broker for the sharpe-hunt winner (2026-07-21): a
volatility-targeted 50/50 SOXX/GLD mix.

## Thesis

Semiconductors and gold are ~0.1-correlated, positive-Sharpe assets — the
diversification free lunch. On top of the monthly-rebalanced 50/50 mix, exposure
is scaled by `min(1, 12% / trailing 20d realized vol)`: calm markets → full mix,
vol spikes → scale toward cash. Both mechanisms are documented economics, not
mined patterns.

## Evidence (pre-registered, five-gate)

- Stitched walk-forward OOS 2019-03→2026-07: **Sharpe 1.30, CAGR 19.5%,
  maxDD −17.5%, Calmar 1.11** — beat the passive EW(SOXX,GLD) control on BOTH
  ΔSharpe (+0.09) and ΔCalmar (+0.15); robust at 2× costs (1.30→1.27).
- Gates 1/2/3/4 PASS (decision core certified: quant-core `volTargetMixCore`,
  zero divergence over 5,199 day-comparisons — `certify-vol-target-mix.js`).
- Gate 5 FAILS at 88.7% deflated-Sharpe confidence vs the 95% bar (N=173
  ledger trials). **This broker's forward sim record IS the missing evidence** —
  out-of-mining-sample by construction.

## Mandate

Trade the certified rule mechanically. No discretion, no parameter drift; the
EOD self-mutation loop may tune only the execution hysteresis
(`enterAboveWeight`/`exitBelowWeight`), never the decision params
(`mixW`/`targetVol`/`volWindow`) — those are frozen to the validated spec until
a re-validation says otherwise.

## Exit / demotion

Standard survival mechanics. If the live sim's rolling Sharpe materially
undershoots the OOS expectation (≈1.3) for two consecutive quarters, demote and
re-examine rather than tune.
