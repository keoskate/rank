# Gate 5 effective-N — pre-registration (FROZEN 2026-06-10)

**Status: FROZEN.** Registered under `data/backtests/manifests/2026-06-10-night.json`,
experiment `N5-effectiveN-prereg` (kind `methodology-preregistration`, 0 trials).
This document is the rule. The computation happens in a **later session**
(temporal two-key, §5). No real-ledger Meff and no DSR under any new rule was
computed tonight — deliberately (§7).

## 1. What this is and why it is frozen before any number exists

Gate 5 (multiple testing) deflates each strategy's OOS Sharpe against the
expected maximum of N skill-less trials, with N = the **full** trials-ledger
count (77 rows at manifest time). Ledger trials are correlated — grid
neighbors, universe variants, sensitivity rows — so the full count overstates
the number of independent bets and sets the bar higher than the true lottery
warrants. Replacing N with an effective count Meff **lowers the deflation
bar**, which directly benefits the strategies currently being judged
(tonight: the deployed volrank-23 spec and the PC1/PC2 candidates). A
correction whose computation benefits its author must be frozen before the
author can see what it implies. This document freezes the single estimator,
the acceptance test, and the binding application rules — and nothing else
may be substituted later.

## 2. The estimator (SINGLE — no substitution permitted)

```
Meff = N^2 / Σ_ij ρ̂_ij²        (Patton–Ramadorai effective-number-of-comparisons form)
```

The sum runs over **all** ordered pairs (i, j) of ledger trials, including the
diagonal (ρ̂\_ii = 1). ρ̂\_ij is computed exactly as follows:

1. **Input series.** Each trial's stored `oosFingerprint`: its stitched
   walk-forward OOS daily returns downsampled to weekly — every 5 consecutive
   daily returns compounded into one weekly return, the most recent 150 weeks
   kept, rounded to 6dp. The field ships tonight as an additive
   `trialsLedger` column (§6); only trials recorded from 2026-06-10 forward
   carry it.
2. **Alignment.** Week end-dates are reconstructed by anchoring each
   fingerprint's final week at the trial's recorded `window.end` and stepping
   backward 5 NYSE trading days per week. Weeks from two trials are matched
   when their reconstructed end dates differ by ≤ 2 trading days; unmatched
   weeks are dropped. (The recorded window is the full sim period, so this
   anchor can be off by a few days when the last test fold ends short of the
   data end — alignment ambiguity is resolved by rule 2 of §5: compute the
   defensible variants, take the **largest** resulting Meff.)
3. **Pairwise Pearson** correlation on the matched overlapping weeks gives
   ρ̂\_ij, which enters the sum squared.
4. **Pairs without overlap are treated as ρ̂ = 0**, i.e. independent —
   conservative: a zero contribution leaves Σρ̂² smaller, Meff larger, the
   deflation bar **higher**. Frozen sub-rule: pairs with fewer than 26
   matched weeks are also set to ρ̂ = 0, because short-sample Pearson noise
   inflates ρ̂² and would shrink Meff in the beneficiary's favor; the 26-week
   floor is fixed here, pre-computation, so it can never be tuned.
5. **Trials lacking a stored fingerprint** (all ~77 legacy rows) are counted
   as **fully independent**: ρ̂ = 0 against every other trial, ρ̂\_ii = 1 —
   also conservative, for the same reason. Legacy rows are never backfilled.

Properties: 1 ≤ Meff ≤ N; an all-independent ledger gives Meff = N; an
all-identical ledger gives Meff = 1. Both missing-data rules push Meff toward
the full count — incomplete data can only **raise** the bar, never lower it.

**Known approximation, stated now:** every grid row recorded by one
`validateStrategy` run shares that run's chosen-path stitched-OOS fingerprint,
so within-run grid siblings are measured at ρ̂ = 1. That is the intended
semantics — a grid is one book of lottery tickets, not n independent bets —
and the synthetic acceptance ledgers (§4) must reproduce this block structure.

**Application, if adopted:** gate 5's `nTrials` becomes `ceil(Meff)`
(rounding up = larger N = harder bar). The null-noise variance
(`nullSharpeVariance` at the ledger's median trial length) is unchanged.

## 3. Rejected alternates (by name — listed so they cannot resurface as "new ideas")

- **Full-matrix eigenvalue ENC** ((Σλ)² / Σλ² on the correlation-matrix
  spectrum) — rejected: requires a complete correlation matrix that legacy
  trials without stored series cannot provide.
- **Hierarchical clustering count** (number of clusters below a correlation
  cutoff) — rejected: the free threshold parameter invites tuning.

## 4. Acceptance test — runs BEFORE any real-ledger computation

Before Meff is ever computed on the real ledger:

- Generate **200 synthetic all-null ledgers** with matched correlation
  structure: same trial count, same within-run grid block structure, same
  overlap pattern and fingerprint-availability mix as the real ledger; every
  return series drawn with **zero true edge**.
- For each synthetic ledger, compute Meff with the §2 estimator, then run the
  gate-5 deflation at `nTrials = ceil(Meff)` on that ledger's best trial.
- **PASS iff the false-pass rate ≤ 5% at the DSR ≥ 0.95 bar.**
- All randomness is a deterministic seeded LCG
  (`s = (s * 1664525 + 1013904223) >>> 0`, the repo convention used in
  `packages/quant-core/__tests__`), seeds recorded in the study script.
- If the acceptance test fails, Meff is **abandoned** and gate 5 keeps the
  full ledger N. No second estimator gets tried — that would be
  estimator-shopping, the exact failure mode this document exists to prevent.

## 5. Binding application rules

1. **Temporal two-key:** the rule is frozen tonight; the computation runs in
   a **later session**. No single session both writes the rule and benefits
   from it.
2. **If a range results** (e.g. from the §2.2 alignment ambiguity), the
   **largest defensible N** is used — ties always break toward the harder bar.
3. **Applied to ALL strategies** in the ledger, no per-strategy exceptions —
   a correction that only fires for favorites is a thumb on the scale.
4. **Full before/after table:** every strategy's DSR at full N and at
   ceil(Meff), published together in the adopting report.
5. **Own commit**, per the repo discipline rule: the Meff adoption is a
   single dedicated commit so the audit trail shows exactly what changed.

## 6. New ledger input shipped tonight: `oosFingerprint`

So the future study has uncontaminated inputs, two additive patches ship
tonight (no simulations were run to produce them):

- `scripts/backtests/lib/trialsLedger.js` — `recordTrials` accepts an
  optional per-entry `oosFingerprint` (array of weekly compounded OOS
  returns) stored **verbatim** on the trial row. Backward compatible;
  existing rows untouched.
- `scripts/backtests/lib/validateStrategy.js` — grid-trial recording attaches
  `oosFingerprint` computed from `wfResult.oos.returns`: every 5 consecutive
  daily returns compounded into one weekly return, capped at the most recent
  150 numbers, rounded to 6dp.

Legacy rows stay as-is and are counted fully independent (§2.5) — backfilling
would mean re-running historical sims in the same program that benefits from
the result.

## 7. Deliberately NOT computed tonight, and why

- **No Meff** over the real ledger — not even a draft or a sanity check.
- **No DSR** for any strategy under any rule other than the current full-N
  rule.
- **Why:** the beneficiary must not peek. Tonight's program evaluates
  strategies whose verdicts a lower bar would flip; seeing the corrected
  numbers before freezing the rule would let the rule be shaped — even
  unconsciously — around the desired outcome. The estimator above was chosen
  on methodological grounds alone, blind to what it implies for any ledger row.
- **Guardrail (manifest):** the morning audit greps tonight's scripts and the
  engine-invocation sidecar to verify no `deflatedSharpe` call ran with a
  non-ledger `varTrialsSR`.

## 8. Honest caveats (carried from the manifest)

- **Reused OOS window** (manifest `priorArtDisclosure[1]`): the 2016–2026
  walk-forward OOS window has been used for spec selection three times
  (raw18 → breadth23 → volrank23). Meff corrects the trial **count** only —
  it does not and cannot undo window reuse. The pristine evidence streams
  remain (a) the forward sim broker and (b) data arriving after 2026-06-10.
- Fingerprints exist only going forward, so early Meff values will sit close
  to full N by construction. That is intended, not a bug.
- Weekly downsampling discards intraweek correlation; weekly is frozen to
  keep stored rows small and to damp daily-alignment noise.
- Grid siblings sharing one fingerprint (§2) makes within-run correlation
  exactly 1 rather than measured — an approximation in the direction of
  treating a grid as a single bet.
