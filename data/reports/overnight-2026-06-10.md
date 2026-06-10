# Overnight research report — 2026-06-10

Program pre-registered in `data/backtests/manifests/2026-06-10-night.json`
(committed 07:30Z, before any simulation). Audit verdict: **CLEAN** — 8/8
pre-registered trials, 3 disclosed alarm-pivot diagnostics, 0 unregistered
(`node scripts/backtests/audit-night.js`). Ledger N: 77 → 88.

Report contract reminder: every Sharpe below carries its verdict; nothing
here is labeled with the p-word, because no verdict is VALIDATED.

## THE HEADLINE: the placebo alarm fired, and it found the right baseline

Per the manifest's pre-registered alarm rule, three of four placebos scored
above 0.85, **voiding all strategy headlines** and pivoting the night to
investigation. The investigation concluded — with evidence — that the
pipeline is CLEAN and the placebo null was mis-specified, and in doing so
surfaced the most important number this project has produced:

**Passive, zero-skill, equal-weight buy-and-hold of the same 22 ETFs:
stitched OOS Sharpe 0.85 (verdict FAILED:multipleTesting, DSR 58.1%).**

Attribution of the flagship trend spec (volrank-23, OOS Sharpe 0.89):

| Configuration | OOS Sharpe | maxDD | Calmar | Verdict |
|---|---|---|---|---|
| Passive EW-22 (zero skill) | 0.85 | −29.8% | 0.45 | FAILED:multipleTesting |
| Random ranking among trend-eligible | 0.84 | — | — | FAILED:multipleTesting (placebo) |
| Raw-momentum ranking (breadth-23) | 0.85 | — | — | FAILED:multipleTesting |
| **Deployed volrank-23** | **0.89** | **−22.8%** | **0.69** | FAILED:multipleTesting (DSR 62.4%) |

Reading: ~95% of the measured Sharpe is the universe's diversified long
drift. The ranking layer is worth ≈0.04-0.05 Sharpe — within noise of random
selection. **The trend machinery's real, measurable contribution is
drawdown control: maxDD −22.8% vs −29.8% and Calmar 0.69 vs 0.45 (+53%)
against the honest baseline.** That is the classic trend-following value
proposition ("be out of the way in crashes"), now measured against the right
control instead of flattered by a SPY benchmark.

Implication (pre-registered for a LATER session per the discipline rule —
not changed tonight): the out-of-sample gate should judge strategies against
their **passive same-universe control** (incremental Sharpe AND Calmar), not
SPY. Recorded as ROADMAP D16.

## Why the alarm fired (bug hunt, concluded)

- Block-shuffle placebos (within-symbol, independent across symbols): OOS
  1.05–1.46. Cause: independent shuffles destroy cross-asset correlation —
  no shared crashes — handing the portfolio FAKE diversification on top of
  preserved per-symbol drift (permutations keep total return). The red-team
  panel predicted exactly this failure mode for the original design; the
  redesign fixed the seam artifact but not the de-correlation.
- Day-shuffle placebos (one shared permutation across all symbols —
  correlations and drift preserved, timing destroyed): OOS **−0.20 and
  +0.76** — scattered around a drift-dominated null, NOT reproducing 0.89.
  A look-ahead leak would reproduce the real number consistently. No leak.
- Shuffled-rank placebo (real bars): 0.84 — the ranking-attribution finding.

## Pre-registered experiments (all honest nulls; no spec change earned)

| Experiment | Result | Verdict | Disposition |
|---|---|---|---|
| PC1 inverse-vol slot sizing (cap 35%) | OOS 0.75 vs deployed 0.89; in-sample 0.80 vs 0.87; CAGR −2.9pts | FAILED:multipleTesting | REJECTED — overweighting low-vol diversifiers cut drift more than risk. The vol-targeted SPY control showed no generic tailwind (−0.03). |
| PC2 diversifier sleeve B (10 non-equity ETFs) | OOS 0.52 standalone (in expectation band) | FAILED:multipleTesting | Component only; kept for reference. |
| PC2 risk-parity combo A+B | A/B correlation **0.637** (thesis needed 0.2–0.35); combo OOS 0.72 < A alone 0.89 | FAILED:multipleTesting | REJECTED — both books are long-drift trend in the same macro regime; the diversification never existed. |

## Faithfulness work that survives the alarm (not Sharpe claims)

- **D1 bug fix, deployed before market open:** the live volAdjusted
  confidence map saturated at 95 (rankScore is momentum/daily-vol, typical
  10–40), making live candidate ORDERING undefined vs the backtest's exact
  sort. New monotone injective map; certification extended to ordering
  parity (204 ranked-day comparisons, 0 mismatches); server restarted.
- Execution-faithfulness monitor harness built (`scripts/
  monitorExecutionFaithfulness.js`) with the pre-registered promotion
  tolerance in ROADMAP A2. Known limitation recorded in-code: residuals must
  be computed against raw closes (adjusted bars shift retroactively at
  ex-div) — REQUIRED before the first residual is ever quoted.
- Effective-N study pre-registration frozen
  (`data/reports/gate5-effectiveN-preregistration-2026-06.md`); per-trial
  OOS fingerprints now stored on every new ledger row. Nothing computed
  tonight (temporal two-key).
- Anti-fishing sidecar live (`data/backtests/engine-invocations.log`);
  morning audit reconciles it nightly.

## Deployed spec status

Unchanged: volrank-23 remains the sim broker's spec — nothing tonight beat
it, and its drawdown edge vs passive is the genuine story. Its "best spec"
Sharpe framing from yesterday is RETRACTED in favor of the attribution
above: the spec's Sharpe is ≈ beta; its edge is Calmar.

## Operational notes

- A parallel session (the owner's, in another terminal) added quant-core
  indicator modules mid-night; my contamination audit briefly quarantined
  them before the owner identified the work. Restored; their VWAP test fix
  was verified correct and resolves ROADMAP D13. Their in-progress files are
  deliberately NOT committed by this program.
- Reused-OOS disclosure: every number above is computed on the 2016–2026
  walk-forward window that has now been used for spec selection three times.
  The pristine evidence streams are the forward sim broker and post-2026-06
  data.

## What tomorrow's work should be (in order)

1. **D16 benchmark reform** (own session, discipline rule): OOS gate judged
   vs passive same-universe control on Sharpe AND Calmar; re-run all
   verdicts; before/after table.
2. **Effective-N study** (own session, already pre-registered).
3. **D15 promotion rule** (owner decision) — reframe on Calmar/drawdown
   delta vs passive + forward-sim tracking; raw DSR ≥95% remains unreachable
   at N=88 for any beta-dominated long book.
4. Retire Sharpe-delta spec-racing on this universe; the next real lever is
   universes/mechanisms whose PASSIVE baseline is weak (where timing must do
   the work), e.g. long/short structures — pending engine support.
