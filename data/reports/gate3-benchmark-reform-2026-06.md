# Gate-3 benchmark reform (ROADMAP D16) — executed 2026-06-10

Pre-registered during the 2026-06-10 night program (placebo-alarm finding);
executed under the discipline rule: rule frozen before re-runs, all active
verdicts re-run, before/after published, own commit.

## The rule (frozen before any re-run)

Gate 3 (outOfSample) now constructs a **passive control** for every
validation — equal-weight monthly-rebalanced buy-and-hold of the declared
sim universe (`spec.controlUniverse`, default = the universe), 2bps/month —
evaluated on the **identical stitched OOS dates**, and passes iff:

1. OOS Sharpe > 0, AND
2. the strategy beats the control on **incremental Sharpe OR incremental
   Calmar** (both deltas recorded in the gate note and artifact detail).

Repackaged beta fails. A genuine risk-dimension improvement (drawdown
control) counts. The control is deterministic from the universe — not a
ledger trial. For structurally-decaying levered products the control is the
investable passive expression of the same exposure (SVXY for short-vol,
SOXX for the overnight-SOXX spec) — the *harder* direction in both cases.

## Before / after (re-run 2026-06-10, ledger N=97)

| Strategy | ΔSharpe vs control | ΔCalmar vs control | Gate 3 before → after | Verdict |
|---|---|---|---|---|
| trend volrank-23 (deployed) | +0.03 | **+0.23** | pass → **PASS** | FAILED:multipleTesting (unchanged) |
| trend volsize | −0.11 | +0.08 | pass → PASS (via Calmar) | FAILED:multipleTesting (unchanged) |
| diversifier sleeve | −0.15 | −0.07 | pass → **FAIL** | **FAILED:outOfSample (stricter)** |
| combo A+B | −0.11 | −0.03 | pass → **FAIL** | **FAILED:outOfSample (stricter)** |
| xs-momentum | −0.06 | +0.07 | pass → PASS (via Calmar) | FAILED:multipleTesting (unchanged) |
| overnight variants | −1.20 | −0.80 | fail → FAIL | unchanged |
| overnight SOXX-fixed | −0.09 | −0.29 | pass → **FAIL** (vs SOXX B&H) | **FAILED:outOfSample (stricter)** |
| short-vol spike | +0.04 | +0.06 | pass → PASS (vs SVXY B&H) | FAILED:multipleTesting (unchanged) |

Three verdicts stricter, zero more lenient. The reform machine-formalizes
every conclusion previously reached by hand (the sleeve/combo rejections,
the overnight-loses-to-B&H call) and makes the deployed spec's real edge
machine-visible for the first time: **ΔCalmar +0.23 over passive** — the
drawdown-control claim, now a gate-level fact instead of prose.

Superseded scoreboard rows (trend base-18, breadth-23 raw-rank) were not
re-run — they are dominated by volrank-23 and retired. Placebo/diagnostic
rows are calibration, not strategies; the EW control judged against itself
fails by construction, which is correct.

## Secondary-channel instrumentation finding (same session)

Cross-validating our stack against Yahoo Finance (independent vendor) and
^SP500TR: aggregate stats agree (CAGR deltas ≤ 11bps/yr; Sharpe/maxDD to the
third decimal; SPY-vs-TR within expense-ratio tolerance) — **the data+stats
stack is externally validated**. But the check exposed a real gap:
**Alpaca's daily closes deviate from official closing prints by 269–321bps
on COVID circuit-breaker days** (SPY 2020-03-13: official +8.55% vs Alpaca
+5.86%; GLD 2020-03-17 similar), and our Polygon cross-check is structurally
blind there (overlap starts 2021-07). Sims that "trade at the close" on
those few days are using non-official prices. Action items recorded in
ROADMAP D17: add a third-vendor (Yahoo) leg to the integrity gate covering
pre-2021 dates; flag affected dates in known-data-issues.
