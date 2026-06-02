# Audit: Edge Gate & Tier Promotion (`edge-gate-promotion`)

**Scope:** `server/brokers/tierPromotion.js` — sim→paper promotion, demotion/fire thresholds, per-source edge gate (`evaluateEdgeGate`/`aggregateBySource`), and `computeSharpe`. Read-only analysis plus a synthetic unit-test harness.

**Harness:** `scripts/backtests/edge-gate-promotion.js` (run with `node`; imports only pure functions). Every number below was produced by running it or one-off node snippets against the real code and `data/ai-sessions.json`.

---

## What it does

`runTierEvaluation` walks every broker `.md`, finds its live session, and calls `evaluateBroker(broker, session, ledger)` which returns one of `promote | demote | fire | hold`:

- **Promote (sim → paper)** when ALL of: `computeSharpe ≥ 1.5`, win-rate ≥ 0.52, `stats.maxDrawdown ≤ 15`, total trades ≥ 100, days-since-start ≥ 20 — **AND** the per-source edge gate passes.
- **Edge gate** (`evaluateEdgeGate`): `aggregateBySource` buckets closed (`side:'sell'`) legs by `t.source`; `primarySource` = the bucket with the most trades; gate passes if that primary source has ≥ 50 trades and mean `realizedPct` > 0 (falls back to sign of mean `$` P&L when `realizedPct` is absent).
- **Demote (paper → sim)** when days ≥ 10 and (`stats.maxDrawdown > 20` OR `sharpe < 0.5`).
- **Fire** (any tier) when `stats.maxDrawdown > 30` OR ≥ 2 demotions in the ledger in 30 days.
- `computeSharpe` = `mean(realizedPct/100) / stdev * sqrt(252)` over closed legs (population stdev, ≥ 2 trades required).
- On promote, `engine.transitionToPaperTier` wipes sim positions, resets cash + `peakValue` to the paper allocation, flips `simulationMode:false`, and **preserves `stats` history** (incl. `maxDrawdown`).

---

## Audit findings

### HIGH — `computeSharpe` returns ~1e16 (not `null`) for constant/near-constant returns → guaranteed promotion
`tierPromotion.js:104-110`. The guard is `if (!isFinite(stdev) || stdev <= 0) return null`, but for N identical returns the population stdev computed via `Math.sqrt(sq/n)` is a floating-point residue (~1e-16), **not exactly 0**, so the guard does not fire.

Measured:
- 50 identical `realizedPct:1.0` → `computeSharpe = 4.58e16` (expected `null`).
- A plausible broker that always exits at a fixed +2% target (110 trades, no slippage in sim) → `computeSharpe = 2.29e16`, and full `evaluateBroker` returns **`promote`** (`wr=100% dd=0%`, edge gate passes at 2.0%/trade).

A fixed-take-profit strategy with zero realized variance — common in a frictionless simulator — gets an effectively infinite Sharpe and is auto-promoted to real money. This is the single most dangerous path to a bad promotion.

### HIGH — Sharpe `sqrt(252)` annualization assumes one trade per day; intraday churners get a fake Sharpe
`tierPromotion.js:96,110` and the inline caveat at 108-109. Brokers in this system churn many trades per day (claude-quant has 90 sells; the self-mutation note in the ledger explicitly describes "near-zero-duration" 1–4 minute trades). Annualizing a *per-trade* Sharpe by `sqrt(252)` treats 200 trades as 200 days.

Measured: mean `+0.1%`/trade, std `1.0%`, n=200 → annualized Sharpe **1.67**, which clears the `≥ 1.5` gate. The honest per-trade Sharpe is 0.10. A 0.1%/trade edge — well inside round-trip cost for a 3x ETF — passes the promotion bar. In the full `evaluateBroker` run, the "churner" (0.184%/trade) was **promoted**.

The result: the headline promotion criterion (`Sharpe ≥ 1.5`) is not measuring what it claims and is trivially gamed by turnover.

### HIGH — Demotion reads cumulative all-time `maxDrawdown`, not "rolling 10 days"; promotion does not reset it
Comment at `tierPromotion.js:6-7` says demote is evaluated "over rolling 10 days," but the code reads `session.stats.maxDrawdown` (`:259`, `:322`), which `simulatedExecutor.js:505` maintains as an all-time peak-to-trough high-water value. `transitionToPaperTier` (aiTradingEngine.js:3705-3737) resets `peakValue` but **not** `stats.maxDrawdown`.

Consequence: a broker promoted after a clean recent run, but whose *simulated history* once dipped 20–30%, is demoted (or fired) on its **first** paper eval with **zero** paper losses. Measured: healthy paper broker (Sharpe 11.2) with stale `maxDrawdown:22` → decision `demote — drawdown 22.0% > 20%`. At `maxDrawdown:31` the same broker is **fired**. Good strategies are punished for ancient sim drawdown.

### MED — Edge gate has no economic floor; expectancy of 0.001% passes
`tierPromotion.js:44-47,204`. `minExpectancyPct:0` means any mean > 0 passes. Measured: a deterministic 0.015%/trade source passes the gate. Real round-trip cost (spread + slippage + the leverage decay on SOXL/SOXS/QBTX) far exceeds that. The gate proves "not negative in a frictionless sim," not "has tradeable edge." It needs a cost-aware floor (e.g. ≥ 0.10–0.20%/trade) and ideally a statistical-significance check (t-stat / lower CI bound > 0), since 50 noisy trades can show a positive mean by chance.

### MED — `FIRE` has no minimum track-record guard; fires on noise
`tierPromotion.js:275-281`. The drawdown-fire check runs before any min-trades/min-days gate and applies to every tier. Measured: a 1-day-old broker with 2 trades and a 31% mark-to-market dip is **fired** immediately. A single bad mark on a thin position permanently archives a broker (and, with `breed`, replaces it). FIRE should require a minimum number of trades/days, and ideally distinguish realized drawdown from a transient unrealized mark.

### MED — Edge gate degenerates to an aggregate gate on the real data (no `source` attribution present)
`aggregateBySource` keys on `t.source`. Inspecting `data/ai-sessions.json`: across **226** sell legs in all sessions, **0** carry a `source` field; the 90 claude-quant sells collapse to a single `unknown` bucket. The plumbing exists (strategy plugins emit `source: SLUG`; `simulatedExecutor.js:347,525` and `orderExecutor.js:551,1103` propagate it), but all *currently persisted* broker trades predate it. So today the "per-source" protection the gate advertises (`:40-43`) is not actually engaged — it's just an aggregate expectancy check. This is latent, not wrong, but it means the headline safety feature is unverified on live data. Going forward, multi-source brokers will be gated only on their **most-traded** source; a heavily-traded losing primary correctly blocks promotion (verified: primary `bad-strat` at −0.219%/trade blocks even though aggregate is +22%), but a broker could still be promoted on a strong primary while a smaller secondary source quietly loses money in paper.

### LOW — `computeSharpe` uses population stdev and assumes zero risk-free rate
`:106`. Divides by `N` not `N-1`; with the `sqrt(252)` issue dwarfing it this is immaterial, but it biases Sharpe slightly high for small samples. No excess-return adjustment (fine at current rates, worth noting).

### LOW — Promotion win-rate is recomputed correctly; persisted percent field is (correctly) ignored
Verified as a non-bug: `evaluateBroker` recomputes `winRate = wins/(wins+losses)` as a fraction (`:258`) and compares to `0.52`. The persisted `stats.winRate` (stored as a **percent**, e.g. 76.6) is never read by the gate, so there is no 0.52% vs 52% unit bug here. Flagging only because the dual representation is a trap for future edits — anyone who "simplifies" `:258` to use `stats.winRate` introduces a 100x error.

### LOW — `pickTopPerformer` for breeding ranks on the same broken Sharpe
`:379-394`. Breeding selects the parent by `computeSharpe`, so the constant-return/churn inflation above means the *worst* offender (a fixed-TP or high-churn broker) is most likely to be chosen as breeding stock, propagating the artifact.

---

## Backtest method & results

No price backtest is required for this dimension (it is decision logic, not a signal). Instead I built a deterministic **synthetic-session unit harness** (`scripts/backtests/edge-gate-promotion.js`) that constructs sessions with controlled return distributions and asserts gate behavior, plus one-off node probes against the live functions. Results (real, reproducible):

| Scenario | Input | Result | Finding |
|---|---|---|---|
| Constant returns | 50× +1.0% | Sharpe **4.58e16** (not null) | HIGH bug |
| Fixed +2% TP, 110 trades | dd 0, wr 100% | **promote**, Sharpe 2.29e16 | HIGH — bad promotion |
| Intraday churn | mean 0.1%, std 1.0%, n=200 | annualized Sharpe **1.67** (≥1.5) | HIGH — annualization |
| Churner full eval | 0.184%/trade | **promote** | HIGH confirmed |
| Mixed sources | primary −0.22%, secondary +2% | edge **blocks** (primary picked) | gate works as intended |
| Thin edge | 0.015%/trade | edge **passes** | MED — no cost floor |
| 49 vs 50 trades | — | 49 blocked, 50 passes | boundary correct |
| Newborn + 31% dd | 2 trades, 1 day | **fire** | MED — no track-record guard |
| Stale-dd paper broker | Sharpe 11.2, dd=22 (sim-era) | **demote** | HIGH — cumulative dd |
| Legacy data | 90 real-shape sells, no source | 1 `unknown` bucket | MED — gate degenerates |

Harness summary line: `15 passed, 2 failed` — both "failures" are themselves findings (the constant-return Sharpe explosion, and a noise-dominated thin-edge case), not harness defects.

---

## Verdict

**needs-work.** The edge gate's *intent* is sound and its primary-source logic correctly blocks an aggregate-masked loser, but the promotion criteria it sits behind are unsafe: `computeSharpe` can return ~1e16 for zero-variance strategies and is inflated by `sqrt(252)` for high-turnover brokers, so a strategy with no real edge can be promoted to real money. Simultaneously, healthy brokers can be demoted/fired on stale or transient drawdown. The "per-source" protection is also currently inert on live data because no persisted trade carries a `source`. None of this risks real money *today* (all sessions are still simulated), but it must be fixed before any broker is allowed onto the paper account by this engine.

---

## Prioritized recommendations

1. **(HIGH) Fix the constant-return Sharpe explosion.** In `computeSharpe`, treat near-zero stdev as undefined: e.g. `if (!isFinite(stdev) || stdev < 1e-9 || stdev/Math.abs(mean||1) < 1e-6) return null;`. A strategy with no variance should not be promotable on Sharpe alone.

2. **(HIGH) Stop `sqrt(252)`-annualizing a per-trade Sharpe, or cap it.** Either compute Sharpe on **daily** aggregated returns (bucket realized P&L by calendar day, then annualize by `sqrt(252)`), or annualize by `sqrt(actual trades/year)` derived from session duration. Until fixed, treat the current "Sharpe ≥ 1.5" as roughly a "per-trade Sharpe ≥ 0.1" bar and tighten accordingly.

3. **(HIGH) Use a *fresh* drawdown metric for demote/fire on paper.** Reset `stats.maxDrawdown` (or track a separate `paperMaxDrawdown` from the paper start) inside `transitionToPaperTier`, and make demote/fire read that rolling/paper-era value. Fix the comment at `:6-7` or the code to actually agree.

4. **(MED) Add an economic floor + significance to the edge gate.** Raise `minExpectancyPct` to a cost-aware value (≥ ~0.10–0.20% for 3x ETFs) and require the lower bound of the mean (e.g. `mean - 1.64·stdev/√n > 0`) so 50 noisy trades can't pass on luck. Consider `minTrades` ≥ 100 to match the aggregate gate.

5. **(MED) Guard FIRE with a minimum track record** (e.g. ≥ 30 trades and ≥ 10 days) and prefer realized over unrealized drawdown, so a single transient mark on a new/thin broker can't permanently archive it.

6. **(MED) Backfill/enforce `source` on every trade and verify the per-source gate on real data.** Today it degenerates to an aggregate check because no persisted sell leg has `source`. Add a startup assertion or a one-time migration so the advertised per-source protection is actually exercised.

7. **(LOW) Decouple breeding selection from the broken Sharpe** (`pickTopPerformer`) — rank parents on net expectancy / realized P&L after the Sharpe fixes land, otherwise the most-inflated broker becomes breeding stock.
