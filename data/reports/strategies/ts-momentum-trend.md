# Time-Series Momentum / Trend-Following — Edge Research

**Key:** `ts-momentum-trend`
**Backtest script:** `/Users/keo/projects/rank-app/rank/scripts/backtests/ts-momentum-trend.js`
**Results JSON:** `/Users/keo/projects/rank-app/rank/scripts/backtests/ts-momentum-trend.results.json`
**Verdict:** **alpha (qualified)** — trend-following delivers a genuine *risk-adjusted* improvement over buy-and-hold in this window, primarily by sidestepping the 2022 bear. But the window is shorter than intended and contains only ONE bear, so confidence is moderate, not high.

---

## 1. What it is

The most academically-documented systematic edge: **time-series momentum (TSMOM)** and the closely-related **moving-average trend filter**. The thesis is mechanical and regime-aware:

- Hold risk assets when they are in an uptrend (price above a long moving average, or positive 12-1 month return).
- Move to cash / defensive (treasuries) when they break trend.

The whole *point* — the reason this is the strongest a-priori candidate after we killed two beta-mirage signals — is that trend-following is supposed to **cut the left tail**: it should dodge the worst of 2022 and 2020 and therefore beat buy-and-hold on a *risk-adjusted* basis even if it gives up some upside. That is exactly what we test.

---

## 2. Exact mechanical rules tested

Signals are computed on daily *closes* and acted on the **next bar's close** (no lookahead). Round-trip transaction cost from `server/risk/transactionCost.js` `bpsPerSide()` is charged on every position change (5 bps/side for plain ETFs).

Universe loaded (21 ETFs): SPY, QQQ, IWM, DIA, XLK, SMH, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLB, XLRE, XLC, GLD, TLT, IEF, EEM, EFA.

| Variant | Rule |
|---|---|
| **SPY/QQQ SMA200 (cash)** | Long the ETF when close > 200-day SMA; else 0% (cash). |
| **SPY/QQQ SMA200 (TLT)** | Same, but the "out" leg holds TLT instead of cash. |
| **SPY/QQQ 50/200 cross** | Long when SMA50 > SMA200 (golden cross); else cash. |
| **DualMom topN (TLT)** | Monthly: rank the equity/sector sleeve by 12-1 momentum (`P[t-21]/P[t-252]-1`). Eligible = momentum>0 **AND** close>SMA200. Equal-weight the top N. Unfilled slots go to TLT if TLT itself is in an uptrend, else cash. |
| **DualMom topN (cash)** | Same, unfilled slots always go to cash. |

12-1 momentum = skip the most recent month (to avoid 1-month reversal), measure the prior 11 months — the canonical Jegadeesh/Titman / Moskowitz-Ooi-Pedersen formulation.

---

## 3. Backtest method & the data-coverage problem (READ THIS)

I requested 2018-01-01 → today. **Polygon's plan on this key is hard-capped at ~5 years and returns 403 for anything older.** Verified directly:

```
getHistoricalAggregates('SPY','2018-01-01','2026-06-03','day')
  -> 1254 bars, first = 2021-06-04, last = 2026-06-02
getHistoricalAggregates('SPY','2015-01-01','2016-01-01','day') -> HTTP 403
```

**Actual tested window: 2021-06-04 → 2026-06-02 (4.99 years).** This means:

- ❌ **2018 Q4 selloff — NOT in data.**
- ❌ **2020 COVID crash & recovery — NOT in data.**
- ❌ **2021 bull (most of it) — NOT in data** (we get only the June-Dec 2021 tail).
- ✅ **2022 bear — fully covered** (this is the one real stress regime we have).
- ✅ **2023–2026 bull — fully covered.**

So the strict "multi-regime" mandate is only *partially* satisfiable on this data feed. We have exactly **one bear** (2022). That is enough to falsify a pure-beta hypothesis (does it dodge a drawdown?) but **not enough to claim durable multi-cycle alpha**. The honest grade reflects that.

---

## 4. Results — full window (2021-06 → 2026-06, net of cost)

**Benchmarks (buy & hold):**

| | CAGR | Vol | Sharpe | MaxDD | Calmar |
|---|---|---|---|---|---|
| SPY | 12.5% | 17.1% | 0.77 | **-25.4%** | 0.49 |
| QQQ | 17.4% | 22.4% | 0.83 | **-35.6%** | 0.49 |

**Strategies:**

| Strategy | CAGR | Vol | Sharpe | MaxDD | Calmar | Exposure | Trades |
|---|---|---|---|---|---|---|---|
| SPY SMA200 (cash) | 9.1% | 10.8% | 0.87 | **-14.1%** | 0.65 | 75% | 27 |
| SPY SMA200 (TLT) | 3.6% | 14.8% | 0.31 | -29.3% | 0.12 | 75% | 27 |
| QQQ SMA200 (cash) | 19.6% | 14.8% | **1.30** | **-13.6%** | **1.45** | 74% | 13 |
| QQQ SMA200 (TLT) | 12.0% | 17.9% | 0.73 | -33.0% | 0.37 | 74% | 13 |
| SPY 50/200 (cash) | 11.7% | 12.9% | 0.93 | -19.0% | 0.62 | 74% | 3 |
| QQQ 50/200 (cash) | 19.6% | 16.5% | 1.17 | -22.9% | 0.85 | 72% | 3 |
| **DualMom top3 (TLT/cash)** | **20.0%** | 19.0% | 1.06 | -19.9% | 1.01 | 90% | 49 |
| **DualMom top5 (TLT/cash)** | 18.1% | 16.0% | **1.13** | **-17.0%** | **1.07** | 85% | 49 |

(DualMom TLT and cash variants are identical because TLT was itself below its 200-SMA whenever the equity sleeve was risk-off — i.e. in 2022 — so the "defensive" leg correctly fell back to cash. Good sign the gating works; bad sign for "bonds diversify equities" in a rate-shock bear.)

### vs buy-and-hold — risk-adjusted

The headline comparisons, like-for-like:

- **QQQ SMA200 (cash)** vs **buy-hold QQQ**: nearly the same CAGR (19.6% vs 17.4%) but **Sharpe 1.30 vs 0.83** and **maxDD -13.6% vs -35.6%**. Calmar **1.45 vs 0.49** — roughly **3x** the return-per-unit-drawdown. This is the textbook trend-following win: you keep the upside, you skip the cliff.
- **SPY SMA200 (cash)** vs **buy-hold SPY**: lower CAGR (9.1% vs 12.5%) but Sharpe 0.87 vs 0.77 and maxDD -14.1% vs -25.4%. Risk-adjusted win, absolute-return give-up. SPY trades whipsaw more (27 trades) than QQQ (13) because SPY chopped around its 200-SMA more.
- **DualMom top5** beats *both* benchmarks on Sharpe (1.13) and crushes them on drawdown (-17%) while matching QQQ on CAGR (18.1%).

## 5. Regime stress — the 2022 bear (the only one we have)

Return / max-drawdown *within* calendar 2022:

| | 2022 return | 2022 maxDD |
|---|---|---|
| Buy-hold SPY | -19.9% | -25.4% |
| Buy-hold QQQ | -33.7% | -35.2% |
| SPY SMA200 (cash) | **-4.8%** | -7.8% |
| QQQ SMA200 (cash) | **-3.6%** | -3.6% |
| SPY 50/200 (cash) | **0.0%** | 0.0% |
| QQQ 50/200 (cash) | **0.0%** | 0.0% |
| DualMom top5 | **-3.3%** | -9.9% |
| DualMom top3 | -5.2% | -15.3% |

**This is the core finding.** In the single bear in our data, every trend variant turned a -20% to -34% buy-and-hold loss into roughly flat-to-down-5%. The 50/200 cross got *completely* out (death cross in early 2022, no re-entry until 2023) and sat in cash the whole year. The SMA200 filter took a small clipping on the way out and on a couple of false re-entries but still lost only low single digits.

This is the behavior that separates **alpha from beta**: a pure-beta "makes money in the bull" signal would have eaten the full 2022 drawdown. These did not.

### Calendar-year returns (full available history)

| | 2021* | 2022 | 2023 | 2024 | 2025 | 2026* |
|---|---|---|---|---|---|---|
| BH SPY | (partial) | -19.9% | 24.8% | 24.0% | 16.6% | 11.2% |
| BH QQQ | (partial) | -33.7% | 54.8% | 27.0% | 20.4% | 21.7% |
| QQQ SMA200 cash | | -3.6% | 32.0% | 27.0% | 14.7% | 17.2% |
| DualMom top5 | | -3.3% | 14.2% | 25.6% | 12.9% | 24.9% |

*2021 partial (data starts June), 2026 partial (through June). The give-up shows up in 2023: trend was out of QQQ during part of the early-2023 rip (52-week low was Oct 2022), so QQQ-SMA200 made 32% vs buy-hold's 55% — the cost of waiting for trend confirmation after a bottom. That re-entry lag is the known weakness of trend-following and it is visible here.

---

## 6. Alpha-or-beta verdict

**Alpha (qualified / moderate confidence).**

Reasoning:
- It is **not** pure beta. A beta signal eats the bear; these sidestepped 2022 (-3% to flat vs -20%/-34%). The risk-adjusted improvement (Sharpe 1.1-1.3 vs 0.77-0.83, Calmar ~3x on QQQ) is the signature of real trend-following, and it is consistent across four independent rule formulations (SMA200, 50/200 cross, dual-momentum top3/top5) — that robustness across specifications argues against curve-fitting.
- It is **net of transaction cost** and the trade counts are low (3-49 over 5 years), so cost is not hiding the edge.
- **Why only "qualified":** the window is 5 years with **exactly one bear (2022)**. Polygon's 403 wall makes 2020/2018 untestable on this feed. One bear cannot distinguish "robust trend edge" from "got the 2022 rate-shock decline right, which had an unusually clean down-trend." The academic literature (Moskowitz-Ooi-Pedersen 2012; AQR) supports TSMOM across 100+ years and many assets, which is why I lean *alpha* rather than *needs-work* — but our own data does not independently confirm multi-cycle durability. The known weakness (slow re-entry after a V-bottom — visible in the 2023 give-up and a likely problem in a 2020-style snap-back, which we couldn't test) is real and would hurt in a sharp-recovery regime.
- **Bonds are not a reliable defensive leg.** The "_TLT" variants were strictly worse — in a 2022-style rate shock, long treasuries fell with stocks. The defensive leg should be **cash (or T-bills/short duration)**, not TLT/IEF.

Net: this is the genuine-edge candidate we were looking for. It is the opposite of the insider/flow mirages — those made money *in the bull and broke in the bear*; this one specifically *earns its keep in the bear*. Recommend building it, with cash (not bonds) as the out-leg, and with eyes open that a V-bottom regime (the one we couldn't test) is its weak spot.

---

## 7. How to build it as a broker plugin

Recommended config: **QQQ (or a small sleeve) SMA200-cash filter**, optionally upgraded to the **dual-momentum top-5** portfolio. The single-asset QQQ-SMA200-cash is the highest Calmar (1.45) and the simplest to operate; dual-momentum top-5 is the best Sharpe and diversifies single-ETF risk.

- **Universe:** SPY, QQQ, IWM, DIA, XLK, SMH, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLB, XLRE, XLC, EEM, EFA (equity/sector sleeve). Out-asset = **CASH** (or SHY/BIL short-duration), **not TLT**.
- **Entry:** at the daily close, compute each candidate's 200-day SMA and 12-1 momentum from `getHistoricalAggregates(sym,…,'day')`. Enter (next session) any asset with `close > SMA200 AND mom12_1 > 0`. For the single-asset version, just `QQQ close > QQQ SMA200`.
- **Ranking / selection:** rank eligible by 12-1 momentum, hold equal-weight **top 5**. Unfilled slots stay in cash.
- **Exit:** flip a holding to cash when `close < SMA200` OR `mom12_1 <= 0`, evaluated on the close, executed next session.
- **Sizing:** equal-weight 1/N across held slots (N=5). For single-asset, 100% on / 0% off (or scale by the broker's risk budget). Trend-following is already vol-reducing; do NOT add leverage on the long leg — it would re-introduce the left tail this strategy exists to remove.
- **Cadence:** signals daily, **rebalance monthly** (month-end) to cap turnover; allow an intramonth exit if a holding's close drops below its SMA200 (trend break) so you don't ride a crash for three weeks waiting for month-end.
- **Cost discipline:** charge `bpsPerSide(sym)` round-trip on every switch; expected turnover is low (the 5-year backtest did 13-49 trades), so cost is a non-issue at this cadence.
- **Kill/guard:** because re-entry lags after V-bottoms, add a simple guard the backtest can't see — if it gets whipsawed (e.g. >3 round-trips in 30 days on the same symbol) widen the band (require close > 1.02×SMA200 to re-enter) to cut churn.

### Forward-validation requirement before real capital
Because we could only test one bear, treat this as **promising → forward-validate**: paper-trade the dual-momentum top-5 for a full cycle, and specifically watch its behavior on the next sharp-down-then-snap-back episode (the 2020-analog we couldn't backtest). If it re-enters within ~1-2 months of a bottom without excessive whipsaw, promote it. The 2022 evidence already shows the down-protection works; the open question is up-capture after a V.
