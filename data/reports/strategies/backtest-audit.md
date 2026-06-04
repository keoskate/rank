# Backtest tooling audit — how much can we trust the research?

**Date:** 2026-06-04 · 29-agent adversarial audit (8 lenses, each finding independently verified) ·
prompted by "what if the backtest logic has flaws?"

## Soundness scorecard (0-100, higher = more trustworthy)

| Dimension | Score | One-line |
|---|---:|---|
| Look-ahead / future data | **88** | Clean — no future-data leakage; act-on-next-bar discipline is real |
| Accounting (CAGR/Sharpe/DD math) | 52 | Core math correct; window/data problems distort some headlines |
| Costs | 42 | Portfolio backtests cost-correct; kill-backtests use ZERO cost |
| Faithfulness (backtest vs live) | 42 | Overlay backtests do NOT match the live gates |
| Data integrity | 42 | Split bug fixed; a contaminated META ticker + data floor remain |
| Statistics | 38 | No multiple-testing correction across ~10 screened strategies |
| Survivorship | 38 | "Survivorship-matched control" doesn't actually strip the bias |
| **Overfitting** | **22** | 100% in-sample; best-variant-reported everywhere; no holdout |

## What is SAFE (survives the audit)

- **No look-ahead bias** (88/100). Signals act on the next bar; momentum even skips the last 21d.
  The mechanics are sound.
- **The "KILLED" verdicts (options-flow, insider, dark-pool) are robust.** The flaws there (zero
  transaction cost, *less*-selective entry than live) would only make them look *better* than
  reality — and they still showed no edge. Killing them was correct.
- Core return/Sharpe/drawdown math checks out.

## What is NOT safe (conclusions undermined)

**The "PROVEN" strategies (trend-following, xs-momentum) are NOT rigorously established:**
- **Overfitting (CRITICAL):** zero out-of-sample/walk-forward anywhere. ts-momentum-trend runs 10
  variants and keeps the best Sharpe; insider sweeps a 60-cell grid and reports the top — and that
  grid output was written into the live `insiderFollowing` exit rule.
- **Multiple testing (CRITICAL):** ~10 strategies screened with no FDR/Bonferroni. If all were
  null, ~40% chance ≥1 prints "EDGE" by luck. The two survivors could be among them.
- **Contaminated data (CRITICAL):** Polygon's `META` returns a WRONG instrument (~$12 vs ~$300)
  for 2021-06→2022-06 — META is in the xs-momentum universe, so the headline xs-momentum result
  is contaminated.
- **Survivorship:** the 45 names are today's winners; the "EW-ALL control" removes the average
  survivor lift but NOT momentum's tendency to over-weight the names that survived *because* they
  won. The "clean selection alpha" is overstated.
- **Untested bears:** Polygon silently floored history at 2021-06, so ts-momentum-trend's 2018Q4
  and 2020 "crash protection" windows are **vacuous** — that data wasn't there. Trend was only
  ever really tested on 2022.

**The OVERLAY conclusions don't transfer to the LIVE gates (faithfulness, CRITICAL):**
- The backtest's entropy gate flags "transitioning" ~36% of rebalances vs the live gate's ~0.4%
  (~90× more blocking). **The drawdown protection I measured comes from a gate that blocks far
  more than the live one does** — so the live entropy gate on momentum-rotator likely delivers
  much *less* protection than the backtest implied. This directly undermines the
  keep-entropy-on-momentum decision.
- The FRED overlay rescales the whole book daily in the backtest, but live only sizes *new*
  entries — so the backtested FRED drawdown reduction won't transfer either.

## Bottom line on confidence

- **Mechanics:** high. **"Killed" decisions:** high. 
- **"Proven" strategies:** LOW — plausible hypotheses, not established facts (in-sample, no MTC,
  survivorship, META contamination, only one real bear).
- **Overlay live benefit:** VERY LOW — the backtests don't match the deployed gates.

The honest summary: the tooling is *mechanically* correct but *methodologically* weak. We found
this before risking real money, which is the point of asking — but it means we should treat the
research as directional, not proven.

## Prioritized remediation

1. **Fix the META data contamination** → re-run xs-momentum (cheap, high value).
2. **Reconcile backtest gates with live** (entropy transition sampling, FRED new-entries-only) →
   re-validate overlays; **reconsider keep-entropy-on-momentum** in the meantime.
3. **Add a holdout / walk-forward split** and a multiple-testing haircut before any "proven" label.
4. **Survivorship:** move to a point-in-time universe (or caveat the selection-alpha claim).
5. Charge cost in the kill-backtests (doesn't change verdicts, but stop the double standard).
