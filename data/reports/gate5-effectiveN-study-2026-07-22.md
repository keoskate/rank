# Gate 5 effective-N study
**Generated:** 2026-07-22
**Script:** scripts/backtests/effective-n-study.js
**Pre-registration:** data/reports/gate5-effectiveN-preregistration-2026-06.md (FROZEN 2026-06-10, temporal two-key §5.1)

---

## Method (binding — citing pre-registration §2)

Single frozen estimator (no substitution permitted):

```
Meff = N² / Σ_ij ρ̂²_ij   (Patton–Ramadorai form)
```

Sum over ALL ordered pairs (i,j) including diagonal (ρ̂_ii = 1).
Input series: each trial's `oosFingerprint` (weekly compounded OOS returns, ≤150 weeks).
Week alignment: NYSE trading-day calendar anchored at `window.end`, stepping back 5 NYSE days per week. Overlap tolerance: ≤2 trading days. Minimum overlap: **26 weeks** (§2.4) — short-overlap pairs set to ρ̂=0.
Grid siblings (same run, same strategyId): share fingerprint → ρ̂=1 by design (§2 known approximation).
Legacy trials (no fingerprint): ρ̂=0 off-diagonal, ρ̂_ii=1 (§2.5, conservative).
Alignment ambiguity (§5.2): tried anchor shifts 0/1/2 NYSE days → take variant giving LARGEST Meff (harder bar).

---

## 1. Fingerprint coverage

| Metric | Value |
|--------|-------|
| Total ledger trials (N) | **195** |
| Trials with oosFingerprint | **157** (80.5%) |
| Legacy trials (no fingerprint) | **38** (19.5%) |
| Distinct fingerprint groups (K) | **41** |

38 pre-2026-06-10 legacy rows carry no fingerprint and are counted fully independent (conservative per §2.5). This keeps Meff denominator from shrinking relative to the full N.

---

## 2. Pairwise correlation distribution

157 fingerprinted trials → 12246 canonical pairwise comparisons.

| Metric | Value |
|--------|-------|
| Pairs with ≥26-week overlap (used) | **12246** |
| Pairs set to ρ̂=0 (short overlap or no overlap) | **0** |
| Mean ρ̂ (used pairs) | **0.2576** |
| Median ρ̂ (used pairs) | **0.1719** |

---

## 3. Effective-N (Meff)

Alignment variants (anchor shifts 0/1/2 NYSE days): 9.78 / 9.78 / 9.78
→ Meff = **9.7831** (taking largest per §5.2)
→ ceil(Meff) = **10**
→ Reduction from full N: **185** fewer trials (94.9%)

The modest reduction reflects that 38 legacy rows (19.5% of N) are forced fully independent — they inflate the denominator Σρ̂² by exactly 1 each regardless of actual correlation structure. As fingerprint coverage grows, Meff will diverge further from N.

---

## 4. Acceptance test (pre-registration §4)

200 synthetic all-null ledgers. Same group structure (41 groups with same sizes), same 38 legacy-independent trials. Common-factor generator (λ=0.5 loading): cross-group weekly correlation ≈0.5 — **the most conservative setting** (maximises false-pass rate, hardest version of the test). Within-group ρ̂=1 (shared fingerprint per grid block). LCG seeds 1..200 × 7919 (frozen).

| Metric | Value |
|--------|-------|
| Synthetic ledgers | 200 |
| False passes (DSR ≥ 0.95 on null best trial) | **8** |
| False-pass rate | **4.0%** |
| Threshold | ≤ 5% |
| **Acceptance verdict** | **PASS** |

The estimator controls Type I error at the required rate. Meff adoption is statistically warranted per the pre-registration.

---

## 5. Champion DSR table (full before/after per §5.4)

DSR at raw N=195: **88.41%** (SR* ann. 0.8535) — **FAIL**
DSR at Meff ceil=10: **98.49%** (SR* ann. 0.4874) — **PASS**

### All scoreboard strategies (full N=195 vs ceil(Meff)=10)

| Strategy | OOS Sharpe (ann.) | DSR raw N=195 | DSR Meff=10 | Verdict |
|----------|-----------------:|---------------|----------------|---------|
| vol-target-soxx-gld-mix-WF-OOS                   | 1.304 | 88.4% | 98.5% | FAIL → PASS *** |
| deployed-top5-breadth23-volrank-WF-OOS           | 0.882 | 52.7% | 82.7% | FAIL → FAIL |
| deployed-top5-breadth23-volsize-WF-OOS           | 0.750 | 40.1% | 73.6% | FAIL → FAIL |
| top-momentum-WF-OOS                              | 0.870 | 51.7% | 83.0% | FAIL → FAIL |
| overnight-variants-WF-OOS                        | -0.287 | 0.2% | 2.3% | FAIL → FAIL |
| soxx-overnight-fixed-auction-WF-OOS              | 0.878 | 52.4% | 83.3% | FAIL → FAIL |
| uvxy-spike-short-WF-OOS                          | 0.635 | 31.5% | 62.8% | FAIL → FAIL |
| diversifier-sleeve-WF-OOS                        | 0.517 | 21.2% | 52.8% | FAIL → FAIL |
| combo-A-B-riskparity-WF-OOS                      | 0.719 | 37.7% | 70.5% | FAIL → FAIL |
| mf-sleeve-capped-WF-OOS                          | 0.757 | 42.7% | 69.4% | FAIL → FAIL |
| vrp-sleeve-capped-WF-OOS                         | 0.916 | 56.0% | 84.8% | FAIL → FAIL |

*** = verdict flips from FAIL to PASS under Meff.

---

## RECOMMENDATION

The champion (vol-target-soxx-gld-mix-WF-OOS) **flips from FAIL to PASS** under ceil(Meff)=10. Adoption is methodologically warranted. Per §5: apply in a dedicated commit, applies to ALL strategies (no per-strategy exceptions). 1 strategy/strategies flip verdict.

---

## Honest caveats (pre-registration §8)

1. **Reused OOS window**: 2016–2026 walk-forward window reused multiple times. Meff corrects trial *count* only — cannot undo window reuse. Pristine evidence: forward-sim broker + data post-2026-06-10.
2. **Young fingerprint coverage**: 157/195 trials fingerprinted; early Meff values sit close to full N by design. Estimate will improve as more fingerprinted trials accumulate.
3. **Weekly downsampling**: discards intraweek correlation; frozen to keep stored rows small and damp daily-alignment noise.
4. **Grid-block approximation**: within-run siblings set to ρ̂=1 (may overstate intra-grid correlation for orthogonal grids).
5. **Acceptance test generator**: λ=0.5 common factor is intentionally maximally conservative — real between-group correlations are lower on average (mean ρ̂=0.258), so the acceptance test sees a harder problem than reality.

---

*Binding pre-registration: data/reports/gate5-effectiveN-preregistration-2026-06.md*
*JSON artifact: data/reports/gate5-effectiveN-result-2026-06.json*
