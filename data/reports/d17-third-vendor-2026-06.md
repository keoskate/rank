# D17 — Yahoo third-vendor integrity leg (executed 2026-06-12)

## Why this existed

The secondary-channel cross-validation (2026-06-10, `crosscheck-external.js`)
found Alpaca daily closes off 269–321bps vs official prints on COVID
circuit-breaker days — and the Polygon cross-source leg could never have seen
it, because Polygon's history floors at ~2021-07. Everything before that was
single-vendor trust.

## What was built

1. **`checkCrossSourceYahoo`** in `scripts/backtests/lib/dataIntegrity.js`,
   wired into `runDataIntegrityGate` next to the Polygon leg:
   - Yahoo v8 `adjclose` (cached under `data/backtests/bars-cache-yahoo/`),
     soft-fails to `warn` so an outage can never crash the gate.
   - **Terminal level check** (≤2%): both vendors are split+dividend
     adjusted, so levels compare directly (unlike the Polygon split-only leg).
   - **Every-daily-return check** (≤1%) over the FULL window. Design note:
     the first draft sampled ~24 windows like the Polygon leg; rejected
     before landing because a sampled check catches a single-day close fault
     ~5% of the time — and that fault class is the reason D17 exists.
     Corporate-action windows (raw/adj factor shifts) are skipped; >12
     mismatches collapse to one "basis mismatch" finding.
2. **An evidence-backed corrections layer** —
   `scripts/backtests/known-data-corrections.json`, applied in
   `loadDailyBars` (`applyKnownCorrections`). Unlike a waiver (which only
   annotates a finding), a correction changes the data every backtest sees,
   so the bar is higher: verified vendor fault, correct value established
   from an independent source, and the Yahoo leg regression-tests the result
   on every gate run. The bars cache stays vendor-pure; corrections apply at
   load. Disable with `BACKTEST_DATA_CORRECTIONS=off`.
3. **Diagnostics**: `run-data-integrity.js` (standalone gate runner, any
   universe) and `diagnose-vendor-closes.js` (classifies every disagreement
   by its level-ratio signature: z = alpaca/yahoo vs 60d rolling median —
   one-day transient = bad close print; permanent step = missing adjustment).

## Finding 1 — Alpaca systematically misses SPINOFF distributions

The headline discovery. Alpaca's `'all'` adjustment handles cash dividends
and splits but **not spinoff share distributions** — each one leaves a fake
crash day in the adjusted series:

| Symbol | Ex-date | Spinoff | Fake return | True (Yahoo) | Correction factor |
|---|---|---|---|---|---|
| XLF | 2016-09-19 | XLRE (real-estate carve-out) | **−18.28%** | +0.64% | 0.8119942 |
| PFE | 2020-11-17 | Viatris (0.124079 VTRS/sh) | −3.46% | +1.76% | 0.9486956 |
| MRK | 2021-06-03 | Organon (0.1 OGN/sh) | −2.58% | +2.09% | 0.9542669 |
| IBM | 2021-11-04 | Kyndryl (1 KD per 5 sh) | −4.95% | −0.57% | 0.9559647 |

Plus one missed cash distribution: **DBMF 2019-12-27** ($2.29 ≈ 8.2%) —
verified against Yahoo's dividend records: Alpaca applied every later DBMF
distribution (2021–2025 raw/adj shifts all match Yahoo's events) but has no
adjustment at 2019-12-27 (factor 0.9189142, from 15d median vendor parity).

Why three layers of defense never saw these: the Polygon leg is blind
pre-2021-07; raw==adjusted "consistency" is exactly what a *missing*
adjustment looks like; and `checkAdjustmentConsistency` only alarms on
unadjusted moves >40%. All five corrections verified by permanent
level-ratio steps at the ex-date with exact vendor agreement after.

## Finding 2 — the COVID close-print fault is a class (~57 bad closes)

The full-window daily scan across 76 symbols (23-ETF trend universe,
44-stock xs-momentum universe, vol ETPs, sleeve satellites) found Alpaca
closes deviating 0.5–12.6% from Yahoo/official on specific days inside
2020-03-09..2020-03-19 — every one a one-day transient (gone next session),
the signature of a consolidated-tape last trade recorded instead of the
official closing auction print. Worst: XLRE 2020-03-16 z=+7.19%, SOXL
2020-03-16 z=+12.55% (3x-magnified). Attribution corrected along the way:
the original "SPY 2020-03-13 / GLD 2020-03-17" flags blamed the returns;
the bad closes were 2020-03-12 and 2020-03-16.

All are `known-vendor-deviation` waivers in `known-data-issues.json`
(FAIL→WARN, visible forever, one entry per bad close with its z). Plus
verified-real-event waivers (cross-instrument leverage-ratio checks) for
UVXY Brexit 2016-06-24 (+43.7%, SVXY −26.4%), Volmageddon 2018-02-05/08
(+66.7%/+50.3%), and SVXY's documented −83% NAV collapse into 2018-02-06.

## Finding 3 — DBMF/KMLM data is unreliable; gate-1 FAIL stands unwaived

Three-vendor majority vote (Polygon as tiebreaker, post-2021-07):

- **KMLM: Alpaca's prints are stale.** Polygon sides with Yahoo on 11/11
  disagreement days — Alpaca prints 0.00% on days the fund moved ~−1.1%
  (consistent with the "10 consecutive identical closes" frozen-feed
  finding). KMLM via Alpaca is unusable.
- **DBMF: post-2021-07 the three vendors agree exactly** (0 disagreement
  days). The chronic ~1% noise is all in the tiny-fund 2019-05..2021-06 era
  where no third vendor reaches — genuinely unresolvable.

These two keep **FAIL** (no waiver): any backtest using them deserves to
fail gate 1 until better data exists.

## Materiality — every verdict re-run, nothing flipped

- **XLF on the deployed trend spec: zero.** Trade books byte-identical
  (same sha256 over 357 trades, corrected vs uncorrected; first XLF
  selection 2022-01-25, five years past the fault's distortion window).
  Full-window stats identical to 3 decimals (Sharpe 0.870, maxDD −22.8%).
- **trend volrank-23 (headline)**: VERDICT unchanged `FAILED:multipleTesting`
  4/5. Stitched OOS Sharpe 0.88, ΔSharpe +0.02 / ΔCalmar +0.22 vs passive
  EW-23 control, survives 2x costs (0.86), DSR 58.8% at N=107 (was 62.4% at
  N=77 — ledger growth, not data).
- **xs-momentum**: VERDICT unchanged `FAILED:multipleTesting`; still no
  selection edge (OOS 0.87 vs EW-45 control 0.93, ΔSharpe −0.06 vs −0.07
  before — the PFE/MRK/IBM corrections lifted candidate and control alike).
- **capped MF retest**: the rejection's robustness test. Even with DBMF's
  +8.2% correction, the decision control is *identical*: ΔSharpe −0.01 /
  ΔCalmar +0.02 vs trend-alone (the fault sat in warmup, outside stitched
  OOS). Verdict label is now **FAILED:dataIntegrity** — with KMLM stale and
  early-DBMF unresolvable, MF wrappers are untestable on our stack today,
  which supersedes the performance near-tie as the honest reason.

## Gate state after D17

- 23-ETF trend universe: **0 fail / 17 warn / 6 pass** (warns = documented
  waivers + XLC's legitimate 2018 listing).
- 53-symbol extended survey: **only DBMF and KMLM fail**, by design.

## What this buys going forward

- The 2016–2021 single-vendor blind spot is closed permanently; any future
  missing adjustment or bad close in either vendor surfaces as a
  daily-return mismatch on the next gate run.
- The corrections layer is the template for the next fault of this class:
  verify against the independent vendor, derive the factor from parity, let
  the gate regression-test it.
- Standing caution: **single-day returns sampled on the waived COVID dates
  are unreliable** — any future strategy keying on 2020-03 daily moves
  (e.g. crash-day event studies) must account for this.
