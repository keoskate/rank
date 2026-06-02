# Portfolio Audit — Automated Trading System

**Date:** 2026-06-01
**Scope:** Synthesis of 8 dimension audits (signals, exit logic, sizing, promotion gate, self-mutation).
**Status:** All trading simulated/paper. No real money at risk. Goal: deploy only signals/logic with proven edge.

---

## TL;DR

**Exactly one signal has real, repeatable, look-ahead-free edge: insider-following.** Everything else is
either noise (technical-indicators, options-flow, dark-pool) or infrastructure that is currently mis-tuned
or unsafe (exits, Kelly sizing, the promotion gate, self-mutation). The single highest-value action is to
ship insider-following with a **widened stop (4%→6-8%)** and a **$500k notional floor**, while
simultaneously fixing the promotion gate so the system stops certifying noise-traders as "promotable."

The recurring root cause across four of the eight audits is **stops set inside the signal's noise band**
(1-4% stops on instruments whose 1-day std is 18-23% for insider names, or 2-3% intraday noise on 3x ETFs).
Tight stops are the single biggest P&L destroyer in the codebase.

The second recurring theme is **measurement that certifies illusory edge**: no transaction-cost model
anywhere, a Sharpe calculation that returns ~1e16 for constant returns and is gameable by turnover, and a
Kelly sizer whose payoff ratio feeds back on its own position dollars.

---

## DEPLOY NOW (real edge, ship after the one-line fix)

### 1. Insider-following — the only signal with proven alpha
- **Evidence:** Point-in-time backtest, no look-ahead (filing_date ≥ transaction_date in 100% of 158
  sampled events). Full-sample horizons: **+1d +1.75% / +3d +5.03%** at $300k notional vs a baseline of
  **−0.37% / −0.54%** → edge **+5.40% at +3d**. At $500k floor: **+1d +3.77%, +3d +6.87%**. Edge is
  monotonically notional-graded.
- **Caveat:** +5d/+10d numbers are survivorship-truncated (feed is newest-first, only older events have
  forward bars) — do **not** trust them. Only +1d/+3d are honest. All events sit in one ~3-week bull-ish
  window (feed pagination cap), so this is single-regime validation, not all-weather.
- **Do not ship at the current SL=4%** — that exit halves the edge (see Fix #1). Ship with SL=6-8%.

**This is the one place to allocate paper capital now.** It is also the only signal that survived its own backtest.

---

## FIX FIRST (promising, but bugged/mis-tuned — high ROI to repair)

### 1. Exit / hold-policy stops are too tight (kills edge on the one good signal)
- **insider SL 4%→6-8%, keep TP 8-10%, maxHold 10, trailing OFF.** Backtest: SL2 = −0.15% exp (net
  negative); SL4 = +2.77%; **SL6 = +4.38% exp, 80% win, best Sharpe 0.91.** Widening the stop roughly
  **doubles** expectancy. One-field change in the persona `.md` / `holdPolicy`.
- **dark-pool SL 2%→4%, TP 4%→6%** (even though dark-pool itself has no edge — see Kill list — its default
  exit is net-negative and would poison anything using it).
- **HIGH code bug:** stop-loss leverage scaling is inconsistent — `evaluateExit` uses raw stop, the WS
  fast-path leverage-scales it (`aiTradingEngine.js:3974-3977` vs `signalEvaluator.js:139`). For a 3x ETF
  the effective stop is non-deterministic (−1% vs −3% depending on evaluator race order) while TP is
  already scaled. Unify so both paths use `Math.max(raw, raw*leverage)`.
- **MED:** trailing stop is double-defined with conflicting semantics on the same key
  (`trailingStopPercent` = "% of gains locked" in one path, "% drop from high" in the other). 5% trail cut
  expectancy from +2.77% to +0.43%. Disable for multi-day; unify the formula.

### 2. Promotion / edge gate certifies noise as "promotable" (lets bad strategies reach real money)
- **HIGH:** `computeSharpe` returns ~1e16 for constant returns (float-residue stdev guard misses ~1e-16);
  a fixed +2% TP broker auto-PROMOTES. Return null when `stdev < 1e-9`.
- **HIGH:** `sqrt(252)` annualization assumes one trade/day, but brokers churn intraday (90 sells, 1-4 min
  holds). A 0.1%/trade edge (inside cost) annualizes to Sharpe 1.67 and clears the ≥1.5 gate. Compute
  Sharpe on daily-aggregated returns, or treat ≥1.5 as ≈per-trade-Sharpe ≥0.1 and raise the bar.
- **HIGH:** demote/fire read all-time `stats.maxDrawdown` despite a "rolling 10 days" comment;
  `transitionToPaperTier` resets peakValue but not maxDrawdown, so a healthy paper broker is fired on its
  first eval on a stale sim-era drawdown. Reset/segregate paper-era drawdown.
- **MED:** edge gate has **no cost floor and no significance test** — a 0.015%/trade frictionless source
  passes. Add `minExpectancy ≥ ~0.10-0.20%/trade` for 3x ETFs plus `mean − 1.64·stdev/√n > 0`, and raise
  minTrades toward 100.
- **MED:** the per-source edge gate is **inert on live data** — 0 of 226 persisted sell legs carry a
  `source` field, so it degenerates to one "unknown" bucket. Backfill/enforce `source`.

### 3. Kelly sizing math is self-referential and unsafe
- **HIGH:** payoff ratio is computed from raw **dollar** P&L, not per-trade return — as Kelly grows
  positions, wins book bigger dollars → payoff inflates → positions grow. Verified: identical 60% win rate
  sizes 5% vs 13% purely on position-dollar differences. Use `realizedPct` / R-multiples (already stored at
  `simulatedExecutor.js:517`).
- **HIGH:** a flawless record sizes to **zero** (winRate≥1 → fullKelly 0 → hard veto). Best performers get
  blocked. Regularize win rate via `(wins+1)/(n+2)` and cap at ~0.90-0.95.
- **HIGH:** `avgLoss===0` hardcodes a fabricated `payoffRatio=2`; a single $1 loss explodes payoff to 2000.
  Require ≥5 losing trades before trusting empirical payoff.
- **MED:** schema allows `kellyFraction` up to 1.0 and it's self-mutable, contradicting the file's own 0.25
  discipline. Tighten to ≤0.5 and clamp in self-mutation. Add portfolio-level gross-exposure awareness
  (currently only cash availability backstops N concurrent per-bet-Kelly positions).

### 4. Self-mutation has inert safety controls and no velocity cap
- **HIGH:** `fullAutonomy` and LLM `confidence` are collected/stored but **gate nothing** — a broker can
  grant itself full autonomy or apply a confidence=0.0 proposal with no effect/check. Wire confidence
  threshold (~0.6) and make fullAutonomy real or delete it.
- **HIGH:** no step-size/velocity cap — `risk.perTrade` can jump 0.02→0.10 (5x) in one validated proposal;
  over nightly runs a broker ratchets every knob to schema extreme. Enforce ±30%/proposal and ≤3
  applied/day in code, not in the prompt.
- **HIGH:** `llm.callBudget` is self-mutable and the daily counter is in-process only (resets on restart) —
  budget is bypassable. Remove from mutable fields, persist counter to disk.
- **MED:** persona notes written verbatim (no sanitization) → confirmed prompt-injection feedback loop
  (a note can inject a fake `## heading` into the system prompt). Strip newlines/heading markers, cap length.

---

## KILL OR REWORK (no demonstrated edge — do not allocate capital)

### 1. Technical-indicators (dip/momentum/balanced presets) — NO EDGE
- 66-day, 5-min replay, basket of 8 names. Baseline +0.007%/trade. **dip +0.065% gross (t=2.01)** —
  marginal — but **−0.035%/trade NET after 10bps cost** (NEGATIVE). momentum +0.018% (t=0.70, pure noise).
  Matches the live −0.23% lifetime expectancy.
- **balanced is a dead alias of dip** — its momentum-bounce branch fires 0 distinct entries in 6 months.
- **VWAP has no daily reset** — the mandatory `belowVwap` gate for the only signal-bearing branch is
  corrupted by day 2 (anchored to a prior session).
- **Action:** Stop allocating to momentum/aggressive brokers; retire them. Treat balanced==dip. **Before
  killing dip outright**, fix the VWAP daily-reset bug and add a cost model, then re-run the A/B — a correct
  VWAP could plausibly move dip above costs. Until then, no capital.

### 2. Options-flow — NO EDGE (and not backtestable live)
- Live flow-alerts feed is recent-only — un-backtestable. Daily proxy backtest: callShare≥0.60 variant
  +0.91% edge but **t≈1.49 (insignificant)**; broker exit TP2/SL1 = **−0.20%/trade, 73% stop-outs**.
- **Market-tide gate is structurally biased bullish and inert** — `callShare = netCall/(|netCall|+|netPut|)`
  on cumulative running totals reads ~0.91 ("bullish") nearly every snapshot, so the +5 tailwind always
  fires and the −15 "fight the tape" never does.
- Direction uses gross call-vs-put premium (conflates bought vs sold); UW's own buy/sell tag disagreed and
  was negative in backtest.
- **Action:** Do not promote. Rework requires: replace tide with intraday slope-vs-baseline, weight ask-side
  buying, widen stops, and run a continuous shadow backtest on the un-gated daily options-volume series
  before any paper promotion.

### 3. Dark-pool — NO EDGE
- 120 ticker-day cells. Bullish reads (n=28) **+0.281% vs +0.319% baseline = −0.04% edge** (worse than
  random next session).
- **Classifier counts price≥mid as BUY** — ~12.8% of premium prints at exactly mid (negotiated crosses) are
  mis-tagged as buying, biasing a long-only strategy bullish (AAPL/TSLA showed 93-96% buyShare on bias
  alone). The premise (off-exchange price≥mid = buyer-initiated accumulation) is unsupported for dark-pool
  blocks/internalization/late prints.
- **Action:** Do not promote beyond pure simulation. If reworked: drop at-mid prints, add count-confirmation
  + per-print premium caps, then accumulate 30-60 labeled sessions via a nightly snapshot and forward-test.

### 4. Entropy-regime gate — currently a NO-OP, weak even when wired
- All 8 live brokers set `preferred:any` + `blockOnTransition:false`, so the gate **never vetoes a trade** —
  pure overhead (a Polygon fetch + entropy math per entry that always returns allow:true).
- High-entropy state (normH≥0.85) is **structurally unreachable** (1/1927 events); "neutral" (~45% of days,
  where the mean-reversion edge actually lives) is **not selectable** by the schema.
- Best measured effect (low-entropy momentum) is +0.35%/trade at **t=1.25 (not significant)**.
- **Action:** Either set `regime.enabled:false` to stop paying for a no-op, or recalibrate cuts to the
  realized PIT distribution (percentile-based), allow "neutral," and require the gated variant to beat the
  ungated baseline at t>2 before any regime-gated broker is promoted.

---

## Prioritized improvement backlog (do these in order to make money)

| # | Action | Why it matters | Est. effort |
|---|--------|----------------|-------------|
| **1** | **Widen insider stop 4%→6%, raise notional floor to $500k, trailing OFF** | Doubles expectancy on the only profitable signal (+2.77%→+4.38% exp, 80% win). One-line `.md` change. | Trivial |
| **2** | **Fix `computeSharpe` constant-return (1e16) bug + add cost-aware significance floor to edge gate** | Stops the system from auto-promoting noise/fixed-TP brokers to real money. | Low |
| **3** | **Unify stop-loss leverage scaling across `evaluateExit` and WS fast-path** | Removes non-deterministic stop level on 3x ETFs; makes risk symmetric vs TP. | Low |
| **4** | **Add a transaction-cost model (≥5bps/side, more for leveraged ETFs) to broker P&L + optimizer + edge gate** | Every apparent edge in technicals/flow is inside the cost band; without this, all backtests are illusory and reproduce live −0.23% drag. | Medium |
| **5** | **Reset/segregate paper-era `maxDrawdown` in `transitionToPaperTier`; guard FIRE with min track record (≥30 trades/≥10 days)** | Stops healthy paper brokers being fired on stale sim drawdown and new brokers being killed on a single transient mark. | Low |
| **6** | **Kelly: payoff from per-trade returns (not dollars), Laplace win-rate, drop the avgLoss=0→payoff=2 fallback, clamp kellyFraction ≤0.5** | Removes the self-inflating dollar feedback loop, the flawless-record→$0 veto, and full-Kelly blowup mode. | Medium |
| **7** | **Self-mutation: gate on `confidence≥0.6`, enforce ±30%/proposal + ≤3/day velocity cap, remove `callBudget` from mutable fields, sanitize persona notes** | Closes the ratchet-to-extreme path, the inert safety gates, and the prompt-injection loop. | Medium |
| **8** | **Fix VWAP daily-reset in technicals, then re-run dip A/B with the cost model** | The only marginal technical branch is gated on a broken VWAP; decide kill-vs-keep on corrected numbers. | Low |
| **9** | **Retire momentum/aggressive brokers; treat balanced==dip; set `regime.enabled:false` (or recalibrate)** | Stops allocating to zero-edge strategies and paying for a no-op gate. | Trivial |
| **10** | **Backfill `source` on persisted trades + startup assertion; stand up forward-fill loggers for insider (+10d), options-flow, dark-pool into `data/flow-history/`** | Makes the per-source gate real and builds the only honest (forward, look-ahead-free) test for the recent-only signals. | Medium |

---

## Cross-cutting root causes (fix the class, not just the instance)

1. **Stops set inside the signal's noise band** — the dominant P&L killer in insider, dark-pool, options-flow,
   and intraday technicals. Adopt ATR/volatility-scaled stops per horizon; never use a 1-4% fixed stop on a
   multi-day or 3x-ETF position.
2. **No transaction-cost model anywhere** — every backtest and the live optimizer overstate edge by ~10bps
   round-trip; on 3x ETFs this is the entire gross edge.
3. **Measurement that rewards the wrong thing** — Sharpe gameable by turnover and broken on constant returns,
   Kelly payoff feeding back on its own dollars, an edge gate with no cost/significance floor. The
   promotion/sizing layer will keep certifying noise until these are fixed.
4. **Fake ATR (`price*0.02`) hardcoded in every strategy plugin** — mis-scales any downstream sizing/exit on
   the volatile small-caps these signals actually trade.

---

## Bottom line

Ship **insider-following with a widened stop and $500k floor** — it is the only thing here that makes money.
In parallel, fix the **promotion gate and cost model** so the system stops promoting noise to real capital.
Retire the technical/momentum brokers, hold options-flow and dark-pool in pure simulation pending a rework
+ forward-test, and turn off the no-op entropy gate. The infrastructure (exits, sizing, mutation) is salvageable
but currently mis-tuned and unsafe; the backlog above sequences the repairs by dollar impact.
