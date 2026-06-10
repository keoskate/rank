# Event-study gate mapping — pre-registration (2026-06-10)

**Status: BINDING.** This document freezes how the five validation gates apply
to EVENT-driven strategies (insider-following, dark-pool, options-flow,
volume-profile events) BEFORE the first event-study run. It is the
methodological contract for `scripts/backtests/lib/eventStudy.js`
(`validateEventStrategy`), mirroring the role
`data/reports/gate5-revision-2026-06.md` plays for equity-curve strategies.
Changing any rule below after results exist requires a new dated revision
document — never a silent edit.

Authority: pre-registration doc + manifest
(`data/backtests/manifests/2026-06-10-avwap-vp-events.json`), per the
operating rules in ROADMAP.md. Committed before the first run; the git
history is the timestamp.

## Why a separate mapping

Event strategies produce a sparse trade list (entry events + an exit policy),
not a continuously-invested curve. Sharpe on a mostly-cash curve is
ill-behaved, and walk-forward folds over calendar time make no sense when the
unit of evidence is an event. The five gates keep their MEANING — data
honesty, live parity, out-of-sample discipline, cost realism, multiple-testing
control — with event-shaped mechanics.

## The mapping

| # | Gate | Application to event strategies |
|---|------|--------------------------------|
| 1 | dataIntegrity | **Unchanged.** `runDataIntegrityGate` over the event symbols' daily bars (Alpaca, one data path), waivers via `known-data-issues.json` — FAIL→WARN visible, never hidden. |
| 2 | faithfulness | **Unchanged semantics.** `not_run` unless a fresh (≤30d) `certify-*.js` report proves the live plugin shares the decision core. Event sources without a certified core **cannot reach VALIDATED** — honest by design. (Dark-pool's core exists — `quant-core darkPoolCore` — but its certification is deferred until ≥60 archived days make an event study possible; the parity vitest is the interim stand-in, and is NOT a gate-2 pass.) |
| 3 | outOfSample | **Redefined for events:** chronological event split. The exit policy is CHOSEN on the train events (first `trainFrac`=60% by event date); an embargo of 21 calendar days after the last train event is skipped; the chosen policy is SCORED on the test events. `not_run` when total events < 60 or test trades < 20 — small samples report honestly instead of passing weakly. Pass = test mean **net** return > 0. |
| 4 | realisticCosts | **Unchanged intent:** the chosen policy's TEST trades rebuilt at 2× `costBpsPerSide` must keep a positive mean. |
| 5 | multipleTesting | **Bootstrap form.** For EVERY policy in the exit grid: one-sided p = P(null mean ≥ observed test mean) under a null that applies the SAME exit policy at seeded-random entry dates on the SAME symbols (hold-matched by construction — the policy dictates the hold; 10,000 resamples, LCG seed recorded in the artifact). Benjamini–Hochberg across the grid at q = 0.05; pass iff the CHOSEN policy is rejected. Deflated Sharpe is reported informationally only. **Every grid point is recorded in the trials ledger (`kind: 'event-grid'`), never deleted.** |

## Trade-construction conventions (also binding)

- Entry at the OPEN of the first session strictly after the event's
  public-information date (filing date for insiders; signal-day close for
  profile events).
- Exit walk on daily OHLC, CONSERVATIVE: gap-through opens fill at the open;
  when stop and target are both touchable within one bar, the stop fills.
- Net return subtracts `2 × costBpsPerSide` (round trip).
- Portfolio aggregation for the artifact: fixed slots (`maxConcurrent`,
  default 10), each active trade 1/maxConcurrent of equity, surplus events
  skipped deterministically (oldest-first wins), idle capital earns 0.

## Registry consequence

A full VALIDATED verdict (all five gates) is the ONLY thing that writes
`data/backtests/validated-sources.json` — the registry
`tierPromotion.evaluateValidationGate` requires before any event-driven
broker (dark-pool, options-flow, insider-following) can promote sim → paper.
The harness writes it; nothing else may.

## Known limitations of harness v1 (deferred, not hidden)

- Exit policies are fixed tp/sl/maxHold percentages. Level-relative exits
  ("close back below VAH", "POC − 0.5×ATR") are not representable and are
  explicitly deferred in the manifest rather than silently approximated.
- The bootstrap null preserves the symbol mix and policy mechanics but not
  event clustering in time; if events cluster in regimes, p-values are
  anti-conservative. Flagged for the effective-N follow-on (N5 study).
- UW event feeds (insider, dark-pool) are recent-only; until the dark-pool
  archive reaches ≥60 days, dark-pool event studies are impossible — its
  events exist only from `data/darkpool-archive/` capture days forward.
