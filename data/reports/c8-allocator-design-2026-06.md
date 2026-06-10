# C8 capital allocator — design + pre-registered capped-MF retest

2026-06-10. Status: design frozen, pure core implemented
(`quant-core/allocatorCore.js`), retest pre-registered below. The LIVE
reallocation job is designed here but NOT enabled — moving broker capital is
owner-gated.

## Conflict-of-interest disclosure (read first)

This design follows a rejected run (`mf-sleeve-combo-WF-OOS`,
FAILED:outOfSample) whose diagnostics I have seen: corr(trend book, DBMF) =
0.349, DBMF standalone Sharpe 0.65, mean MF weight 54% under the frozen
inverse-vol convention. To prevent fitting the fix to the observed window:

- The RULE FORM (core+satellite with a hard cap) comes from the structure of
  the failure (symmetric vol-weighting ignores which sleeve carries the
  validated edge) — an argument that holds on any window.
- The CAP (20%) comes from institutional alternatives-sleeve convention
  (10–25% of book), midpoint, NOT from optimizing our data. One sensitivity
  (10%) is recorded as a trial. No other cap values may be evaluated.
- Monthly cadence comes from institutional practice and the observed
  fee-bleed mechanism (daily weight drift), not from tuning.
- Mean-variance/Kelly weighting was REJECTED at design time: 63-day trailing
  mean estimates are statistically meaningless and would whipsaw; the core
  estimates only vol. (Notably, plugging the observed numbers into MV gives
  w*≈50% — close to the weight that already failed — which is itself
  evidence that short-window MV is not trustworthy here.)

## The allocator (pure core: quant-core/allocatorCore.js)

- `cappedSatelliteWeights(dates, coreRets, satRets, {cap=0.20, volWindow=63,
  minObs=40})` → satellite weight held each day; recomputed on the first
  trading day of each month from returns through the prior day; warmup =
  cap/2; long-only, fully invested.
- `combineWithWeights(coreRets, satRets, wSat, {feePerSide=5bps,
  costMultiplier})` → combined daily returns; fee charged on |Δw| at
  rebalance only, scaled by costMultiplier.

## The live mechanism (designed, NOT enabled)

A monthly job (first trading day, after close) that:
1. Reads each participating broker's daily equity history from session state
   (the same numbers the exchange floor shows).
2. Calls `allocatorCore.cappedSatelliteWeights` with the CORE = the
   best-validated broker book, SATELLITE = each approved sleeve.
3. Emits a PROPOSED reallocation of `allocatedCapital` across the broker
   sessions (dry-run report to data/reports/), and — only when the owner
   enables it — applies the change through the existing broker
   capital-allocation path.
4. Every applied decision is logged with inputs, so a certify script can
   replay history through the core and prove zero divergence (the same
   pattern as certify-trend-core).

Faithfulness consequence: combo strategies remain faithfulness=not_run until
this job runs live with certification. The core existing now is what makes
that future certification possible.

## PRE-REGISTERED RETEST (capped MF sleeve) — frozen before execution

- Candidates (2 trials): trend-volrank-23 + DBMF B&H at cap 0.20; trend +
  EW(DBMF,KMLM available-wrappers) at cap 0.20. Both via allocatorCore.
- Sensitivity (1 trial, in-sample only): cap 0.10 on the DBMF candidate.
- Trial budget: 3. No other variants may be evaluated.
- Controls: D16 passive EW of the union universe (gate-built) + sleeve-A
  alone on identical stitched OOS dates (decision control, printed).
- Expectations stated ex-ante: with w_sat ≤ 20%, the combo tracks ~0.8·A;
  the realistic outcomes are a SMALL ΔSharpe/ΔCalmar improvement over
  A-alone or a near-tie; gate 5 fails regardless (N≈103, OOS T≈4y). A
  second rejection here settles the MF-wrapper question until the live C8
  job exists and 2020-class regimes enter the data.
- Same reused-OOS and window caveats as the first MF run (OOS misses
  Jan–Sep 2022 MF rally; covers DBMF's worst stretch).
