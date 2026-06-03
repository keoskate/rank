# Strategy Research: Local Probability Scanner (key: `scanner-edge`)

**Verdict: NO-EDGE.** The scanner is a long-only oversold-dip / mean-reversion
ranker. Backtested over the deepest window the data allows (2021-09 → 2026-06,
4.68y, including the full 2022 bear), it returned **+5.2% total (1.09% CAGR,
Sharpe 0.18, -44.3% maxDD)** while SPY did **+74.8% (12.69% CAGR, Sharpe 0.77,
-25.4% DD)** and QQQ did **+107.7% (16.92% CAGR, Sharpe 0.80, -35.6% DD)**. It
loses to buy-and-hold on return AND risk-adjusted AND drawdown, and it bled
through the 2022 bear (-29% vs SPY -19.9%) — worse than the index it was
supposed to time. Do NOT wire a broker to its raw output.

---

## What it is

The "Local probability scanner" (`server/scanner/`) fetches ~120 calendar days
of daily bars for a fixed symbol universe, scores each name with a log-odds
ensemble of textbook technical indicators, derives an ATR-based target/stop,
ranks by expected value (EV) in R-units, and returns the top opportunities.
It is surfaced at `POST /api/scanner/scan` (`server/routes/scanner.js`) and the
`/scanner` UI. Results are persisted to `data/scanner-results/`.

### What signal it actually computes (read from the code)

`probabilityModel.computeProbability` sums six logit components:

| Component | Source | Effect |
|---|---|---|
| `signal` | `signalEvaluator.evaluateSymbolStateless` (0–0.7) | RSI momentum/dip + volume spike + MACD + lower-BB |
| `pattern` | `patternRecognitionService.predictPattern` (optional, ±1.2) | ML pattern model; wrapped in try/catch, often absent |
| `rsiExtreme` | RSI<35 → +, RSI>65 → − | **mean-reversion: buy oversold** |
| `bbBreakout` | %B<0.2 → +, %B>0.8 → − | **mean-reversion: buy at lower band** |
| `trendAlign` | short/med trend (±0.4) | trend-following |
| `divergence` | RSI divergence (±0.5) | reversal |

Direction = sign of the summed logit; probability = `sigmoid(|logit|)` clamped
to [0.40, 0.85]; `hasEdge` if `|logit| >= 0.2`. `targetModel.deriveTargets`
sets target = `ATR·√horizon·1.2` (snapped to a 20-bar swing if within 15%) and
stop = `1·ATR`, requiring R:R ≥ 1.5. The scanner then keeps opportunities with
`probability ≥ 0.55`, `EV > 0.2`, and ranks by `EV = p·RR − (1−p)`.

**The dominant terms are `rsiExtreme` (+0.7 deep / +0.4) and `bbBreakout`
(+0.5).** They are large enough to overpower the bearish `trendAlign` (−0.4).
This is visible in the live `latest.json`: every top pick (WMT, UVIX, QBTZ) is
`LONG` with reason `"RSI oversold; BB at lower band; Trend aligned BEARISH"`.
**In plain terms: the scanner buys dips in downtrends.** That is the entire
edge thesis, and it is a known loser when trends persist (2022).

### What it produces

A ranked list of LONG (occasionally SHORT) opportunities with entry/target/stop
and a probability/EV score. It is a *discretionary stock screener*, not a
closed-loop strategy — but it is fully mechanical, so it is backtestable.

---

## (c) Does it store historical scans for a forward test?

Partly. `scanStore` keeps the last 50 scans in `data/scanner-results/`. But:

1. **No realized outcomes are stored** — only the picks and their *predicted*
   target/stop. There is no field recording what actually happened.
2. **The history is sparse and recent** — all stored scans are from 13 days
   (May 13–29, 2026), clustered on a handful of timestamps. Far too little to
   measure forward returns with any confidence.

So a stored-scan forward test is not viable today. Instead I **replayed the
exact scanner logic historically** (next section), which is strictly better.

---

## (b) Backtest — method & results

### Method

`scripts/backtests/scanner-edge.js` reuses the **real server modules**
(`technicalIndicatorsService.getAllIndicators`, `signalEvaluator
.evaluateSymbolStateless`, `probabilityModel.computeProbability`,
`targetModel.deriveTargets`) against trailing 80-bar windows, reproducing
`scanRunner._scoreSymbol` exactly. The optional `patternPred` is set to `null`
(the live scanner wraps it in try/catch and runs without it — the common case).

Mechanical rule simulated:
- **Universe:** 42 survivorship-aware symbols from the scanner universe with
  full history (drops post-2021 IPOs/leveraged ETFs that would bias to the
  bull; e.g. PLTR, UBER, IONQ, RGTI, QBTS, SOXL/SOXS).
- **Entry:** each day, score the universe; keep LONG picks with `p≥0.55`,
  `EV>0.2`, `RR≥1.5`; rank by EV; take top 5; enter at **next open**.
- **Exit:** stop (intraday low ≤ stop, checked first — conservative), target
  (intraday high ≥ target), or **horizon = 5 trading bars** at close.
- **Sizing:** equal-weight, max 5 concurrent positions, capital/5 per slot.
- **Costs:** `transactionCost.bpsPerSide(sym)` (5 bps) per side, entry + exit.
- **Benchmarks:** buy-and-hold SPY and QQQ over the identical window.

### Data limitation (important)

The Polygon plan attached to this key only returns **~5 years** of daily bars
(earliest available bar = **2021-06-04**, confirmed for SPY/SOXX/META). The
requested 2018-2020 regimes (Q4-2018 selloff, 2020 COVID crash) are **not
retrievable** — every symbol is capped at 1254 bars. The backtest therefore
runs **2021-09-29 → 2026-06-03 (4.68y)**. This still cleanly spans the
decisive **2022 bear** plus 2021/2023-26 bull, which is enough to separate
alpha from beta.

### Overall results (net of cost)

| Strategy | Final ($100k) | Total | CAGR | Sharpe | Max DD |
|---|---|---|---|---|---|
| **SCANNER** | $105,190 | **+5.2%** | **1.09%** | **0.18** | **-44.3%** |
| SPY B&H | $174,835 | +74.8% | 12.69% | 0.77 | -25.4% |
| QQQ B&H | $207,682 | +107.7% | 16.92% | 0.80 | -35.6% |

### By year / regime (period return %)

| Regime | Scanner | (Scanner DD) | SPY | QQQ |
|---|---|---|---|---|
| 2021 (partial bull) | -2.6% | 15.1% | +9.3% | +10.7% |
| **2022 (BEAR)** | **-29.0%** | **31.8%** | -19.9% | -33.7% |
| 2023 (bull) | +5.0% | 17.4% | +24.8% | +54.8% |
| 2024 (bull) | -3.8% | 19.4% | +24.0% | +27.0% |
| 2025-26 | +49.5% | 17.6% | +29.9% | +46.2% |

*(2018-2020 rows are n/a — data unavailable, see limitation above.)*

### Trade stats
- 1,777 trades; **win rate 40.3%**; avg trade +0.16%.
- Exit reasons: **stop 945 / horizon 782 / target only 50.** The R:R≥1.5
  ATR targets are rarely reached in a 5-day horizon — targets are too far,
  stops too close. The strategy dies by a thousand stop-outs.

---

## vs buy-and-hold — alpha or beta?

**Neither — it's worse than beta.**

- **Return:** scanner +5.2% over 4.68y vs SPY +74.8% / QQQ +107.7%. It captured
  almost none of the bull it was long into.
- **Risk-adjusted:** Sharpe 0.18 vs 0.77 (SPY) / 0.80 (QQQ). Drawdown -44.3% vs
  -25.4% / -35.6% — *deeper* than either index.
- **Bear test (the whole point):** in 2022 it lost **-29%, WORSE than SPY's
  -19.9%**, with a -31.8% intra-year DD. Buying oversold dips in a persistent
  downtrend is exactly the failure mode, and it materialized.
- **Bull test:** even in the 2023/2024 bull it returned +5% and -3.8% while the
  indices compounded 24-55%. Its only good year (2025-26, +49.5%) merely beat
  SPY in one cherry-pickable window and still trailed it badly cumulatively.

This is not a long-exposure proxy that "just makes market money" (that would at
least be honest beta). The constant stop-outs and far ATR targets bleed it
below the market it is long. **No-edge.**

---

## How you *would* build it as a broker plugin (NOT recommended as-is)

For completeness — the mechanical spec, since the task asks for it. **Do not
deploy this without fixing the structural problems below.**

- **Universe:** liquid large/mid-caps (the 42-name survivorship-clean subset).
- **Entry:** scanner LONG picks, `p≥0.55`, `EV>0.2`, `RR≥1.5`, top-5 by EV,
  enter next open.
- **Exit:** stop = 1·ATR, target = ATR·√5·1.2, hard horizon 5 bars.
- **Sizing:** equal-weight, ≤5 concurrent.
- **Cadence:** daily scan at the close, orders at next open.

**Why not to ship it / what to fix first (research-grade, unproven):**
1. **Kill the "buy oversold in a downtrend" mode.** Add a hard regime gate
   (e.g. only take LONGs when SPY > its 200-DMA, or when `trendAlign ≥ 0`).
   The bearish-trend longs are the 2022 bleed.
2. **Rebalance the target/stop asymmetry.** Target hit only 3% of the time;
   either tighten targets (lower RR) or widen stops, then re-measure.
3. **Calibrate the logit weights.** The code itself flags this as unfinished
   ("calibrate weights via Brier score… Left as Phase-2 work"). The weights are
   hand-picked, not fit — there is no evidence they're predictive.

None of these are validated. Until they are backtested and shown to beat SPY
risk-adjusted across regimes, the scanner's raw output should **not** drive a
broker. It is a useful *idea-generation screener for a human*, not an edge.

---

## Files
- Backtest script: `/Users/keo/projects/rank-app/rank/scripts/backtests/scanner-edge.js`
- This report: `/Users/keo/projects/rank-app/rank/data/reports/strategies/scanner-edge.md`
- Scanner source: `server/scanner/{scanRunner,probabilityModel,targetModel,universe,scanStore,scanCache}.js`, `server/routes/scanner.js`
