# Audit: `technical-indicators` entry signal

**Files:** `server/strategies/technicalIndicators.js`, `server/technicalIndicatorsService.js` (shim → `packages/quant-core/src/technicalIndicatorsService.js`)
**Backtest:** `scripts/backtests/technical-indicators.js`
**Date:** 2026-06-01 · **Status:** read-only analysis + real backtest

---

## What it does

The legacy entry signal used by the 5 original brokers. `evaluate(session, symbol, ctx)`:

1. Fetches ~24h of 5-minute candles via `ctx.getAggregatesForAsset(symbol, 5, 'minute', …)`. Bails if `< 50` candles.
2. Computes the full indicator stack (`getAllIndicators`): RSI(14), MACD(12/26/9), Bollinger(20,2σ), ATR(14), EMA 9/21/50/200, VWAP, Stochastic, ADX, OBV, volume ratio (last bar vs trailing-20 avg).
3. Branches on `cfg.entryStrategy`:
   - **dip / conservative:** RSI `< 45` (dip) or `< rsiOversold` (conservative) **AND** price below VWAP → `strategyMatch`.
   - **momentum / aggressive:** RSI in `(50, 65)` → `strategyMatch`.
   - **orb:** opening-range-breakout, long-only (handled separately).
   - **balanced:** primary = RSI `< 45` + below VWAP; secondary = RSI `(30, 40)` + bullish MACD + volume spike.
4. Adds confirming signals (each bumps `signalCount` + a weighted `signalScore`): volume spike (≥`volumeMultiplier`, default 1.5×), RSI oversold/divergence, MACD bullish/crossover, Bollinger `%B < 0.2`.
5. `confidence = min(50 + signalScore, 95)`, then layers options-flow (`±10/15`), regime alignment (`±10/20`), and time-of-day (`±5`) adjustments. Hard filters block counter-trend + weak-volume / sub-80-confidence.
6. Enters if `strategyMatch && signalCount ≥ minSignalsRequired (2) && confidence ≥ minConfidence`. Exits are universal (TP/SL/EOD/hold), with an ORB target override.

It owns ONLY the enter decision; the dispatcher owns cooldown + exits.

---

## Audit findings

### HIGH
- **`balanced` is a dead alias of `dip`.** The "momentum-bounce" secondary branch (RSI 30–40 + bullish MACD + volume spike, `technicalIndicators.js:213-225`) fires **0 distinct entries** in 6 months of replay (measured: `dip/balanced primary` fired 10,494 times; momentum branch firing *without* the dip branch already matching = **0**). Reason: RSI 30–40 is a strict subset of RSI < 45, and an intraday momentum bounce off a dip is essentially always below VWAP, so the dip branch always catches it first. The backtest confirms `dip` and `balanced` produce byte-identical results (n=1376, exp +0.065%, same exit mix). The "balanced" preset is marketing, not a distinct strategy.

- **VWAP has no daily reset (look-ahead-adjacent staleness bug).** `calculateVWAP` (`technicalIndicatorsService.js:156-169`) runs `ti.VWAP.calculate` over the *entire* candle window the engine passes in — ~24h / ~2 trading days of 5-min bars — with no session boundary. Library VWAP is cumulative, so by late in day 2 the "VWAP" is anchored to yesterday's open and is meaningless as an intraday reference. Since `belowVwap` is a **mandatory gate** for the dip/balanced presets (the only presets with any edge), this directly corrupts the primary entry condition for ~half the candles. (My harness replicates this faithfully; a daily-reset variant is the recommended fix to test.)

### MEDIUM
- **No transaction-cost or slippage model anywhere in the live path.** Entry is taken at `currentPrice` (real-time WS or candle close) and exits at exact TP/SL prices. On leveraged ETFs (SOXL/TQQQ) spreads + slippage are material; the backtest shows the gross edge is entirely inside the cost band (see results).
- **`minConfidence` is structurally easy to clear.** A single dip match (+20 strategy weight) → `confidence = 70`, already ≥ the default 60. So `confidence` adds almost no selectivity beyond `strategyMatch` itself; the gate is effectively "did the strategy branch match + 2 signals," which the confirming signals (volume/RSI<40/MACD/BB) trivially supply on a dip. This is why the signal trades extremely often (1376 entries / 66 days ≈ 21/day across 8 symbols).
- **Same-bar TP/SL resolution is ambiguous in the live exit logic too.** When a 5-min bar's range spans both stop and target, the realized fill is path-dependent and unknowable from OHLC. My harness assumes stop-first (pessimistic); live fills depend on intrabar path. This adds variance the confidence scoring doesn't acknowledge.
- **`requireTrendAlignment` is documented as a no-op** (`technicalIndicators.js:237-240`: "always true in uptrends, not a distinct signal") yet remains a config knob brokers can toggle — dead surface area.
- **Time-of-day uses `new Date()` (wall clock), not candle time** (`technicalIndicators.js:355-358`). Correct for live trading, but means the +5/−5 conf adjustments are non-reproducible and untestable, and would silently mis-fire if the engine ever evaluated stale/replayed candles.

### LOW
- Volume ratio = last bar / trailing-20 average → on the very first bars after open this is noisy/spiky; no guard.
- ATR fallback `currentPrice * 0.02` (`:426`) is only used for the `atr` field, not targets (targets are %-based), so it's cosmetic — fine, but misleading in the decision object.
- RSI-divergence detector was recently hardened (range floor, mutual exclusivity) — looks correct now; not a finding.

---

## Backtest: method & results

**Harness:** `scripts/backtests/technical-indicators.js`. Point-in-time replay on 5-minute RTH bars (aggregated from Polygon 1-min, filtered 09:30–16:00 ET).

- **Coverage:** 66 distinct trading days, 2024-12-02 → 2025-05-23, sampled as twelve 7-calendar-day windows (Polygon's 1-min endpoint caps at 5000 rows/call with no pagination ≈ 8 days, so contiguous windows are kept as independent segments and spread across the full 6 months to avoid a "first-two-weeks-only" sample). Basket: SOXL, TQQQ, NVDA, AMD, AAPL, TSLA, SPY, QQQ.
- At each bar `i ≥ 60`, feed `bars[i-60..i]` to `getAllIndicators` and re-implement the exact dip/momentum/balanced branches + confirming-signal weights + `minSignalsRequired=2` / `minConfidence=60` gates. Enter at signal-bar close; universal exit TP +2% / SL −1% / 24-bar (~2h) / EOD; 12-bar (1h) cooldown.
- **Baseline:** same TP/SL/hold from evenly-spaced random entry bars on the same tickers/window.
- **Fidelity gaps (documented, not reproducible from price history):** options-flow boost, regime ±, intraday time-of-day ±5. These net ≈0 across many trades. VWAP-no-reset bug is reproduced faithfully.

### Results (gross, no costs)

| Preset | n | Expectancy/trade | Win % | Edge vs baseline | Welch t |
|---|---|---|---|---|---|
| **baseline (random)** | 4935 | +0.007% | 48.6% | — | — |
| **dip** | 1376 | **+0.065%** | 49.9% | +0.057% | **2.01** |
| **momentum** | 1492 | +0.025% | 50.1% | +0.018% | 0.70 |
| **balanced** | 1376 | +0.065% | 49.9% | +0.057% | 2.01 (≡ dip) |

Exit mix (dip/balanced): target 141 · stop 383 · eod 357 · time 495 → **stops 2.7× targets**, win rate only ~50% despite a 2:1 TP:SL ratio.

### Cost sensitivity (the decisive number)

A conservative 10bps round-trip cost (spread + slippage; leveraged ETFs are wider):

| Preset | Net expectancy/trade |
|---|---|
| dip | **−0.035%** |
| balanced | **−0.035%** |
| momentum | ≈ −0.075% |

**The entire gross edge lives inside realistic transaction costs.** The dip edge is only marginally significant (t≈2.0, p≈0.045) before costs and flips negative after — exactly consistent with the reported live lifetime expectancy of **−0.23%**.

---

## Verdict

**no-edge.** No preset has a deployable edge.
- `momentum`/`aggressive` is pure noise (t=0.70, edge +0.018%).
- `dip`/`balanced` has a marginal pre-cost edge (+0.057%, t≈2.0) that is **fully consumed by transaction costs** and is identical between the two presets (balanced's second branch is dead code). The 50% win rate with a 2:1 reward:risk and 2.7× more stops than targets means the signal is timing entries no better than random — it just collects the asymmetric TP/SL geometry, which costs erase.

This is the textbook "weak technical-indicator soup" result: lots of confirming signals that all co-move, an over-permissive confidence gate, and a corrupted VWAP reference on the only branch with any signal. It explains the live −0.23%.

---

## Prioritized recommendations

1. **(High) Stop allocating capital to `momentum`/`aggressive` brokers.** Zero edge, costs negative. Demote/retire.
2. **(High) Treat `balanced` and `dip` as the same strategy** in broker configs and fix or delete the dead momentum-bounce branch (`technicalIndicators.js:213-225`); right now it advertises a diversification that doesn't exist.
3. **(High) Fix VWAP daily reset** in `calculateVWAP` before drawing any conclusion about the dip branch. The only branch with marginal signal is gated on a broken VWAP — a daily-reset VWAP could plausibly move the edge above costs (worth one A/B backtest run; my harness has the hook).
4. **(High) Add an explicit cost model** (≥5bps/side, more for SOXL/SOXS/TQQQ) to the broker P&L and to any optimizer. Without it every "edge" here is illusory.
5. **(Med) Make `minConfidence` actually selective** — a single dip match clears the default 60. Either raise the floor well above 70 or require ≥2 *independent* signal families (current confirming signals all co-move with the dip).
6. **(Med) Re-examine the 2% TP / 1% SL geometry.** 2.7× stops vs targets on a ~50% timer means the 1% stop is too tight for 5-min noise on 3× ETFs; an ATR-scaled stop is already computed but unused for sizing.
7. **(Low) Remove the no-op `requireTrendAlignment` knob.**
