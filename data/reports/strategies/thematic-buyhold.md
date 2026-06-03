# Thematic Buy-and-Hold: Core Semis/AI Basket (key: `thematic-buyhold`)

**Ideas covered:** #2 "time in market" + #8 "Singularity bet"
**Verdict:** **BETA** (high-beta long-tech exposure with regime-limited, concentration-driven excess return — NOT durable, risk-adjusted alpha we can trust)
**Backtested:** yes, but over a TRUNCATED window (see data limitation)

---

## What it is

Long-hold an equal-weight basket of quality semiconductor / AI names plus a few
hyperscalers, rebalanced monthly back to equal weight (trim winners, add to
laggards). It is the purest expression of "just be long the AI/semis theme and
stay invested." The research question is **not** "does it make money" (obviously
yes in a tech bull) — it is **"does it beat just holding QQQ on a risk-adjusted
basis, or is it the same beta with more single-name risk and a worse bear?"**

## Exact mechanical rule

- **Universe (16):** NVDA, AMD, AVGO, TSM, ASML, MU, AMAT, LRCX, KLAC, MRVL,
  ARM, SMCI, MSFT, GOOGL, META, AMZN.
- **Entry / weighting:** equal-weight across the names that have price data on
  the rebalance date. A name enters the basket the first month it has history
  (ARM enters 2023-09, the rest at window start).
- **Rebalance:** first trading day of each month — reset every held name back to
  `totalValue / N` target weight. This trims winners and tops up laggards.
- **Exit:** none. Buy-and-hold core; the only trades are monthly rebalances.
- **Sizing:** fully invested, no cash, no leverage.
- **Cost:** `bpsPerSide(sym)` (5 bps/side for ordinary equities) charged on the
  `|delta|` notional traded at each rebalance, plus a one-time entry cost.

## Backtest method

- Script: `/Users/keo/projects/rank-app/rank/scripts/backtests/thematic-buyhold.js`
- Source: Polygon **adjusted** daily bars (splits/dividends baked in).
- Benchmarks: SPY and QQQ buy-and-hold (single entry, hold to end, net of one
  entry cost). Also an equal-weight basket **without** rebalancing, to isolate
  the rebalance contribution.
- CAPM regression of daily basket returns on QQQ/SPY daily returns to separate
  alpha from beta.

### DATA LIMITATION (must read first)

The intended window was **2018-01-01 → today** to span the 2018 Q4 selloff and
the 2020 COVID crash. **Polygon returns HTTP 403 for any date earlier than
~5 years ago on this account's plan.** Verified directly: requests for SPY in
2018/2019/2020/early-2021 all 403. **The usable window is 2021-06-04 →
2026-06-02.**

Consequence: the two deepest non-2022 stress tests (2018 Q4, 2020 COVID) are
**not testable** with our data. The window we DO have still contains the single
most important regime check the prompt cares about — **the full 2022 rate-driven
bear** — so the alpha-vs-beta question is still answerable, but with less
regime breadth than ideal. Treat every "bull year" number with the skepticism
the insider/options-flow post-mortem demands.

## Results (2021-06-04 → 2026-06-02, net of cost)

| Strategy | CAGR | Vol | Sharpe | MaxDD | Total Ret |
|---|---|---|---|---|---|
| **BASKET (monthly rebal)** | **+45.2%** | 35.7% | **1.23** | **-45.6%** | +544% |
| BASKET (no rebal) | +44.9% | 44.3% | 1.06 | -49.6% | +538% |
| SPY buy&hold | +12.5% | 17.1% | 0.77 | -25.4% | +80% |
| QQQ buy&hold | +17.4% | 22.4% | 0.83 | -35.6% | +122% |

Monthly rebalancing adds Sharpe (1.23 vs 1.06) and cuts maxDD (-45.6% vs -49.6%)
versus buy-and-forget, almost entirely by mechanically de-risking out of the
parabolic single names — a real, if small, improvement.

### Per-year total return

| Year | BASKET | SPY | QQQ | Regime |
|---|---|---|---|---|
| 2021 (H2) | +28.0% | +12.4% | +18.5% | bull/mania |
| **2022** | **-35.0%** | **-19.5%** | **-33.1%** | **BEAR (rates)** |
| 2023 | +100.7% | +24.3% | +53.8% | bull |
| 2024 | +42.4% | +23.3% | +24.8% | bull |
| 2025 | +50.4% | +16.4% | +20.2% | bull |
| 2026 YTD | +80.3% | +11.4% | +21.5% | YTD |

### Intra-year max drawdown

| Year | BASKET | SPY | QQQ |
|---|---|---|---|
| 2021 | -8.9% | -5.4% | -7.7% |
| **2022** | **-45.3%** | -25.4% | -35.2% |
| 2023 | -14.2% | -10.3% | -10.9% |
| 2024 | -26.4% | -8.4% | -13.6% |
| 2025 | -33.1% | -19.0% | -22.9% |
| 2026 | -13.7% | -9.1% | -11.8% |

## The 2022 bear: this is the tell

| Window | BASKET ret / DD | SPY ret / DD | QQQ ret / DD |
|---|---|---|---|
| 2022 full year | -36.2% / -45.3% | -19.9% / -25.4% | -33.7% / -35.2% |
| 2022 peak→trough | -42.7% / -44.3% | -23.4% / -25.4% | -33.1% / -34.6% |

**In the one real bear we can test, the basket fell HARDER than QQQ (-45% DD vs
-35%) and far harder than SPY (-25%).** It is unambiguously more painful to hold
through a tech bear than QQQ. Every dollar of extra return in 2023-2026 was paid
for with extra downside in 2022. This is the classic high-beta signature: you
get paid in bull years and punished in bear years.

## Alpha or beta?

CAPM regression on daily returns over the window:

| Benchmark | Beta | Annualized alpha |
|---|---|---|
| vs QQQ | **1.44** | +18.3% |
| vs SPY | 1.73 | +22.1% |

Read carefully:

- **Beta 1.44 to QQQ** confirms the basket is, mechanically, ~1.4x leveraged
  long-Nasdaq. The 2022 -45% DD and the 35.7% vol are consistent with this.
- The **+18.3% annualized "alpha" is real in this window but is a mirage for our
  purposes.** It is overwhelmingly NVDA + the AI-infrastructure complex
  (AVGO, SMCI, ARM) re-rating from 2023 on. That is not a repeatable structural
  edge — it is a single thematic bet that happened to be the best trade of the
  decade during exactly the window we can see. There is no mean-reversion,
  signal, or inefficiency being harvested; it is concentrated theme exposure.
- The window is ~80% bull. Per the insider/options-flow post-mortem, "recent
  bull-only backtests lie." We **cannot** see 2018 or 2020, and the one bear we
  CAN see (2022) is where the basket loses to QQQ on drawdown.

**Risk-adjusted, across regimes: this does NOT clear the alpha bar.** Sharpe
1.23 vs QQQ 0.83 looks great, but it is computed over a window where the basket's
single dominant bet (AI semis) was the winning bet. The honest verdict is
**BETA** — high-beta long-tech exposure with a concentration kicker, not a
durable risk-adjusted edge. It is "fine but not edge," exactly the prompt's
definition of beta. A risk-tolerant account could hold it for the exposure, but
it should not be sold to the broker system as alpha, and it must never be sized
as if its 2023-2026 return is its expected return.

## How to build it as a broker plugin (if desired, as a beta sleeve)

- **Tier:** simulated first; only promote to paper with an explicit
  "this is leveraged tech beta, not alpha" label and a hard exposure cap.
- **Universe:** the 16 names above; gate each on having >= 1 month of price
  history before inclusion (handles future IPOs).
- **Entry:** on plugin start and on the first trading day of each month, compute
  `target = portfolioValue / N_available` and submit orders to move each name to
  target. Equal-weight, long-only.
- **Exit:** none structurally. Rebalance-only. (Optional risk overlay below.)
- **Sizing:** fully invested within the sleeve's allocated capital; NO leverage
  on top (the names already carry ~1.4x QQQ beta). Cap the sleeve at a modest
  fraction of broker capital precisely because of the -45% bear drawdown.
- **Cadence:** monthly rebalance; skip rebalances where total turnover < ~2% to
  avoid paying cost for noise.
- **Strongly recommended risk overlay (to make it less pure-beta):** because the
  bear behavior is the whole problem, gate the sleeve with a regime filter —
  e.g. hold the basket only while QQQ is above its 200-day SMA, move to cash
  (or trim to half weight) when below. That single rule is what would convert
  this from "worse-than-QQQ in 2022" into something defensible. It was NOT part
  of the assigned mechanical rule, so it is not in the headline numbers, but it
  is the obvious next experiment and the only way I'd let this near paper money.

## Bottom line

Makes a lot of money in the tested window, but it is **beta, not edge**: 1.44x
QQQ with a concentration tilt, a worse bear drawdown than QQQ, and an "alpha"
term that is one theme's once-in-a-decade run measured over a mostly-bull window
we can't extend back through 2020/2018. Do not build it as an alpha strategy.
If built at all, build it as a clearly-labeled, capped, regime-gated beta sleeve.
