# Gate-5 revision (ROADMAP D14): null-noise deflation bar

2026-06-10. Changed under the discipline rule: own commit, own merits, all
verdicts re-run, before/after published.

## What was wrong

The deflated-Sharpe bar SR\* = E[max Sharpe of N skill-less trials] needs the
dispersion of *skill-less* Sharpe estimates. The old estimator used the
empirical variance of all ledger trial Sharpes. Once the ledger accumulated
deliberate anti-edge trials (intraday falsification controls, cost-destroyed
SOXL variants — 18 of 65 trials below −0.5), the distribution became bimodal
and the empirical sd inflated to 0.81 → SR\* ≈ 1.93 annualized, a bar nothing
real can clear. A robust (MAD) estimator does not fix bimodality (robust sd
was 0.94 — worse). The conceptual error: a strategy that is deterministically
dead (true SR ≪ 0 by cost construction) contributes nothing to the
distribution of the MAXIMUM — it can never be the lucky best — so it must not
widen the null.

## The revision

`varTrialsSR = 1/T̄` (per-period), the sampling variance of a zero-skill
Sharpe at the ledger's median trial length T̄ (= 2,625 trading days →
annualized null sd ≈ 0.31). N remains the FULL ledger count even though
trials are highly correlated (effective N is smaller) — deliberately
conservative. The empirical trial sd is still computed and printed in every
gate note for transparency, marked "not used".

New bar at N=65, T̄=2625: **SR\* ≈ 0.74 annualized.** Fishing is still
priced: SR\* grows with every recorded trial.

## Before / after (re-run 2026-06-10, ledger N=65 throughout)

| Strategy | OOS Sharpe | Gate 5 before (rule/ledger at its last run) | Gate 5 after (new rule, N=65) | Verdict before → after |
|---|---|---|---|---|
| trend-following deployed-top5 | 0.82 | 92.3% (N=28, SR\* 0.23) — unstable: same rule at N=65 gave 0.4% | **57.9%** (SR\* 0.74) | FAILED:multipleTesting → unchanged |
| xs-momentum top-momentum | 0.86 | 95.0% PASS (N=16, young ledger) | **62.3%** FAIL | UNVALIDATED → **FAILED:multipleTesting** (stricter — the old pass was a young-ledger artifact) |
| overnight variants (32-grid) | −0.29 | 0.0% (N=64, SR\* 1.93) | 0.4% | FAILED:outOfSample → unchanged |
| SOXX overnight fixed (auction-cost-conditional) | 0.88 | 0.4% (N=65, SR\* 1.93) | **62.7%** | FAILED:multipleTesting → unchanged |

Nothing flipped to pass. Three strategies with OOS Sharpe 0.82–0.88 now
receive nearly identical deflation probabilities (58–63%) — cross-strategy
stability the old rule lacked entirely (92.3% / 95.0% / 0.4% for the same
quality of evidence, depending on when they ran).

## What it now takes to validate (honest math)

With N=65 trials burned and SR\* = 0.74: DSR ≥ 95% requires OOS Sharpe ≈ 1.4
at ~6 years of OOS data, ≈ 1.27 at ~10 years. A true Sharpe of 0.82 can
essentially never prove itself against best-of-65 luck — the margin over the
bar is too thin. Implications, stated plainly:

1. The fishing already done has a permanent price. Only strategies clearly
   better than what we have (breadth-expanded trend, Phase C7, is the obvious
   candidate) can reach VALIDATED at this trial count.
2. OPEN DECISION (do not resolve silently): ROADMAP A3's promotion rule
   ("DSR ≥ 95%") may be unreachable for trend-following as-is. Either the
   strategy must improve, or the promotion rule changes to something like
   "4/5 gates + K months of in-tolerance forward sim evidence" — that is a
   policy choice for the owner, not a statistical one, and lowering it must
   be a deliberate, documented decision.
3. Possible future refinement (own-merits rule applies): estimate effective N
   from trial correlation (our 65 trials are maybe ~10–15 independent bets),
   which would lower the bar honestly. Requires storing per-trial return
   series or fold-level stats; not done today.
