# Overnight Return Anomaly — Edge Research Report

**Key:** `overnight-anomaly`
**Date:** 2026-06-03
**Verdict:** **NO-EDGE (cost-eaten).** Gross overnight drift is real but tiny (~2–3.4 bps/day); the round-trip trading cost to harvest it (10 bps/day in this engine's own cost model) is **3–5x larger than the signal**. The anomaly does not survive transaction cost.

---

## 1. What it is

The "overnight drift" anomaly is the well-documented finding that, historically, almost all of an index ETF's long-run return has accrued **overnight** (close → next open) while the **intraday** session (open → close) contributed little or was negative. The proposed strategy monetizes this by holding the ETF **overnight only**: buy at the close, sell at the next open, every single trading day.

The catch the orchestrator flagged is the right one: **this trades every day**, so cost compounds daily. The whole question is whether ~2 bps/day of gross drift survives the cost of a daily round trip.

---

## 2. Exact mechanical rule (as backtested)

Three return streams were decomposed from adjusted daily bars (`adjusted=true` from Polygon):

| Stream | Definition | Trades/day |
|---|---|---|
| **Overnight-only** | `open[t] / close[t-1] − 1` | 1 round trip (buy close t-1, sell open t) |
| **Intraday-only** | `close[t] / open[t] − 1` | 1 round trip (buy open t, sell close t) |
| **Buy & hold** | `close[t] / close[t-1] − 1` | 0 (held continuously) |

- **Universe:** SPY, QQQ (the two index ETFs named in the brief).
- **Sizing:** 100% of equity each day (single-name, fully invested when in position).
- **Cadence:** daily.
- **Cost:** `bpsPerSide(sym)` from `server/risk/transactionCost.js` = **5 bps/side for SPY/QQQ → 10 bps round trip per day** for the overnight and intraday strategies. Buy & hold pays cost once (negligible, ignored). Charged as a fractional deduction from each day's return.

Script: `/Users/keo/projects/rank-app/rank/scripts/backtests/overnight-anomaly.js`

---

## 3. Backtest method & data limitation (read this)

- Prices: `getHistoricalAggregates(sym, start, end, 'day')` from `server/polygonClient.js`, adjusted.
- **Window actually obtained: 2021-06-07 → 2026-06-02 (1,253 trading days).**
- **The 2018-01-01 target window could NOT be honored.** Polygon returns **HTTP 403** for any date before ~2021-06 on this account's plan (verified by probing 2018/2019/2020 directly — all 403). So **2018 Q4 selloff and the 2020 COVID crash are not testable with our data source.**
- **What we DO retain is the regime that matters most:** the **entire 2022 bear market (Jan 3 → Oct 12, 2022, n=196 days)** is inside the window. This is the exact regime that killed the prior insider/options-flow signals, and the overnight strategy is tested against it below.
- Metrics: CAGR, annualized Sharpe (rf≈0), max drawdown on the compounded equity curve. All computed in code that was run.

---

## 4. Results

### 4a. The core number: gross drift vs cost hurdle (per day)

| Symbol | Mean overnight gross | Mean intraday gross | Round-trip cost/day | **Overnight NET** | Cost ÷ overnight drift |
|---|---|---|---|---|---|
| SPY | **+2.07 bps** | +3.22 bps | 10 bps | **−7.93 bps** | **4.83×** |
| QQQ | **+3.35 bps** | +4.07 bps | 10 bps | **−6.65 bps** | **2.98×** |

The signal is real and positive gross. It is also **a fraction of the cost to trade it.** This is the entire story.

### 4b. Full-window strategy stats (2021-06 → 2026-06)

**SPY**
| Strategy | CAGR | Sharpe | MaxDD | Total ret |
|---|---|---|---|---|
| Overnight GROSS | +4.8% | 0.51 | −21% | +26% |
| Overnight **NET** | **−18.6%** | **−1.95** | −65% | −64% |
| Intraday GROSS | +7.4% | 0.57 | −14% | +42% |
| Intraday NET | −16.6% | −1.19 | −63% | −59% |
| **Buy & hold SPY** | **+12.5%** | **0.77** | −25% | +80% |

**QQQ**
| Strategy | CAGR | Sharpe | MaxDD | Total ret |
|---|---|---|---|---|
| Overnight GROSS | +7.9% | 0.64 | −27% | +46% |
| Overnight **NET** | **−16.2%** | **−1.27** | −61% | −58% |
| Intraday GROSS | +8.9% | 0.54 | −24% | +52% |
| Intraday NET | −15.4% | −0.79 | −65% | −56% |
| **Buy & hold QQQ** | **+17.4%** | **0.83** | −36% | +122% |

Net of cost, both overnight strategies **lose ~60% of capital** and post deeply negative Sharpe. Even **gross**, overnight-only underperforms buy & hold on both CAGR and Sharpe — so in this window the classic "overnight beats the full day" pattern is **not even present gross**; intraday actually edged out overnight, and both lost to holding.

### 4c. By year (total return; net is gross minus ~10 bps × #days)

**SPY** — overnight gross / overnight NET / buy&hold
| Year | ON gross | ON net | Buy&hold |
|---|---|---|---|
| 2021(H2) | +7.0% | −7.5% | +12.4% |
| **2022** | **−14.7%** | **−33.7%** | −19.5% |
| 2023 | +4.3% | −18.8% | +24.3% |
| 2024 | +22.3% | −5.0% | +23.3% |
| 2025 | +7.1% | −16.6% | +16.4% |
| 2026(H1) | +1.3% | −8.7% | +11.4% |

**QQQ**
| Year | ON gross | ON net | Buy&hold |
|---|---|---|---|
| 2021(H2) | +6.2% | −8.3% | +18.5% |
| **2022** | **−21.5%** | **−38.9%** | −33.1% |
| 2023 | +10.7% | −13.8% | +53.8% |
| 2024 | +31.4% | +2.1% | +24.8% |
| 2025 | +15.5% | −10.0% | +20.2% |
| 2026(H1) | +4.1% | −6.2% | +21.5% |

Net of cost, **there is not a single full year where the overnight strategy is positive on SPY**, and only one for QQQ (2024, +2.1%, well below buy&hold's +24.8%).

### 4d. Regime behavior

**2022 bear (Jan 3 – Oct 12, 2022, n=196):**
- SPY overnight: gross −18.1%, **net −32.7%** (buy&hold −24.9%).
- QQQ overnight: gross −22.8%, **net −36.6%** (buy&hold −34.0%).
- The overnight book got hit hard in the bear too — overnight gaps were negative during the decline. It did **not** provide downside protection; net of cost it lost more than just holding.

**2020 COVID crash / 2018 Q4:** not testable — Polygon plan returns 403 before 2021-06. This is a genuine gap in regime coverage, disclosed.

---

## 5. vs Buy & Hold (alpha or beta?)

On a risk-adjusted basis the overnight strategy **loses to buy-and-hold even gross** (Sharpe 0.51/0.64 vs 0.77/0.83), and **net of cost it is catastrophically worse** (Sharpe −1.95/−1.27, ~60% capital destruction). It is not alpha. It is not even useful beta — it captures a sliver of the market's return while paying a daily toll that dwarfs it.

**Sensitivity:** even at an unrealistically tight **1 bps/side (2 bps round trip)** — tighter than this engine's own model — SPY's +2.07 bps/day drift still loses (2.07 − 2.0 ≈ +0.07 bps, ~$0 after any real-world slippage/gaps), and QQQ's +3.35 bps barely clears. The anomaly only "works" at near-zero cost, which no retail/paper execution achieves. At the engine's actual 5 bps/side it is hopeless.

---

## 6. Verdict

**NO-EDGE — cost-eaten.** The overnight drift is a real micro-effect (gross-positive, ~2–3 bps/day) but it is **3–5x smaller than the cost of harvesting it**. Every net-of-cost cut — full window, every year, the 2022 bear — is deeply negative and far below buy-and-hold. This is exactly the kind of mirage the audit warned about, except here it doesn't even survive gross on a risk-adjusted basis vs holding. **Do not build it.**

(Honesty note: the prompt floated "~2 bps/day" as the cost to beat. The project's own `transactionCost.js` charges 5 bps/side = 10 bps round trip for SPY/QQQ. At that — the number a real broker plugin in this repo would actually pay — the strategy is dead by a wide margin. It is dead even at the optimistic 2 bps round trip for SPY.)

---

## 7. If someone insists on building it (broker plugin spec — NOT recommended)

Only viable variant would trade **far less often** to amortize cost — e.g., hold overnight only into known high-drift events (FOMC eves, month-end, pre-earnings-season), turning ~250 trades/yr into ~20–30. That is a *different* (event-overnight) strategy and was not what tested positive here; it would need its own multi-regime backtest before any capital. As a literal daily-overnight plugin:

- **Universe:** SPY (or QQQ).
- **Entry:** market-on-close buy each trading day.
- **Exit:** market-on-open sell next trading day.
- **Sizing:** fixed fraction of pool; flat all day.
- **Cadence:** daily.
- **Why it fails:** 250 round trips/yr × 10 bps = ~25%/yr cost drag vs ~5–8%/yr gross drift. Mathematically can't win in this cost regime.

**Recommendation:** drop. Reallocate the slot to a strategy whose gross edge clears the cost band with margin.
