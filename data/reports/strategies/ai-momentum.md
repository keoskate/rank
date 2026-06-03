# AI/semi momentum — "bubble rider" (key: `ai-momentum`)

**Verdict: NEEDS-WORK. Edge type: mostly BETA, with a weak risk-adjusted improvement only in the ranking ("top-half") variant.** The trend overlay does NOT avoid the 2022 bear and is risk-adjusted *worse* than simply buy-and-holding the same basket. It is long AI/semi exposure with a leaky timing filter, not durable alpha.

> Data caveat up front (matters a lot): our Polygon plan returns **HTTP 403 for any daily bar before ~2021-06-04** (5-year lookback cap). The methodology's full window (2018→today) is **not backtestable** with our data source. We therefore could NOT test 2018 Q4 or the 2020 COVID crash at all. We *did* capture the full **2022 bear**, which is the most important regime test, plus 2021 H2 topping and 2023-2026 bull. All numbers below are over **2021-06-04 → 2026-06-02** (1254 trading days, ~5y). Treat this as a partial-regime test, not the full-regime test the methodology asked for.

## What it is

"Ride the AI bubble" as a mechanical long-only trend overlay on an AI + semiconductor basket. Hold the names that are trending up; rotate the rest to cash. (Options/hedge leg explicitly out of scope per the assignment — this tests only the long-momentum engine.)

## Exact mechanical rule

- **Universe (31 names):** NVDA, AMD, AVGO, QCOM, TXN, MU, INTC, AMAT, LRCX, KLAC, ASML, TSM, ADI, MRVL, NXPI, MCHP, ON, MSFT, GOOGL, META, AMZN, CRM, NOW, ORCL, SMH, SOXX, plus newer AI names PLTR, SNOW, NET, ARM, SMCI (each eligible only once it has ≥50 bars of its own history — no look-ahead, no holding a name before it trades).
- **Eligibility:** a name is eligible on a rebalance date if it has ≥50 daily bars of history.
- **Signal (two variants tested):**
  - `MA`: a name is **IN** if `close > 50-day SMA`, else **OUT**.
  - `TopHalf`: rank eligible names by 3-month (63-bar) return; **IN** = top half **and** 3-month return > 0.
- **Sizing:** equal weight **across all eligible sleeves** = 1/N each. An IN sleeve is invested long; an OUT sleeve's 1/N sits in **cash** (0% return). This is the honest control vs buy-and-hold of the *same* basket, which always invests every eligible sleeve.
- **Cadence:** rebalance every 21 trading days (monthly) or 5 (weekly). Between rebalances sleeves drift with price.
- **Cost:** `transactionCost.bpsPerSide(sym)` (5 bps/side equities) charged on the dollar turnover of each sleeve every time it flips IN↔OUT or re-weights. Folded into that day's return.

Script: `/Users/keo/projects/rank-app/rank/scripts/backtests/ai-momentum.js` (run with `cd /Users/keo/projects/rank-app/rank && node scripts/backtests/ai-momentum.js`).

## Backtest method & results (2021-06-04 → 2026-06-02, net of cost)

Daily bars from `polygonClient.getHistoricalAggregates(sym,…,'day')` (adjusted). Equity compounded daily; cost deducted at rebalance turnover. Sharpe = annualized daily mean/std (rf=0).

### Headline (full available window)

| strategy | CAGR | Sharpe | maxDD | final |
|---|---|---|---|---|
| **MA-monthly** | +16.81% | 0.91 | −32.10% | 2.17x |
| **MA-weekly** | +16.78% | 0.91 | −29.06% | 2.16x |
| **TopHalf-monthly** | +16.63% | **1.12** | **−23.97%** | 2.15x |
| BuyHold-basket | **+34.64%** | 1.07 | −42.34% | 4.39x |
| BuyHold-SPY | +12.52% | 0.77 | −25.36% | 1.80x |
| BuyHold-QQQ | +17.43% | 0.83 | −35.62% | 2.22x |

### By year (total return)

| year | MA-monthly | MA-weekly | TopHalf | BuyHold-basket | SPY | QQQ |
|---|---|---|---|---|---|---|
| 2021 (H2) | +4.65% | +3.75% | +6.86% | +15.73% | +12.39% | +18.55% |
| **2022 BEAR** | **−29.03%** | −26.77% | −21.41% | −33.29% | −19.48% | −33.07% |
| 2023 | +48.14% | +37.33% | +32.37% | +79.70% | +24.29% | +53.79% |
| 2024 | +23.11% | +15.63% | +17.08% | +34.44% | +23.30% | +24.84% |
| 2025 | +10.79% | +20.24% | +12.91% | +40.64% | +16.35% | +20.16% |
| 2026 (YTD) | +44.29% | +49.07% | +46.24% | +67.27% | +11.39% | +21.46% |

### By regime (total return | maxDD)

| regime | MA-monthly | TopHalf | BuyHold-basket | SPY | QQQ |
|---|---|---|---|---|---|
| 2018 Q4 selloff | **no data (403)** | — | — | — | — |
| 2020 COVID crash | **no data (403)** | — | — | — | — |
| 2021 bull (H2 only) | +4.65% / −7% | +6.86% / −5% | +15.73% / −8% | +12.39% / −5% | +18.55% / −8% |
| **2022 BEAR** | −29.03% / **−31.5%** | −21.41% / **−23.0%** | −33.29% / −41.6% | −19.48% / −25.4% | −33.07% / −35.3% |
| 2023→2026 bull | +191.5% / −15.8% | +155.9% / −13.8% | **+468.3%** / −31.6% | +98.6% / −19.0% | +180.2% / −22.9% |

### Did the trend filter actually de-risk in 2022? Yes — but it leaked.

Monthly basket exposure (% of core semis above their 50d MA) measured directly: 2022 spent most months at **0–22% invested** (Feb/Mar/May/Sep/Oct all 0%). The filter *did* pull the book to cash. But it still lost −29% because of **whipsaws**:
- **Aug 2022:** exposure flipped to **100%** right before the sharp September selloff — bought the top of a bear-market rally.
- **Dec 2022 → Jan 2023:** 90% invested into a reversal.
Monthly rebalance is too slow to dodge these; weekly only trims the damage to −27%.

## Alpha-or-beta verdict

**Mostly BETA, with at best a marginal risk-adjusted improvement (TopHalf only).**

1. **It does NOT beat buy-and-hold of the same basket risk-adjusted.** MA-monthly Sharpe **0.91 < basket 1.07**. You give up half the return (CAGR 16.8% vs 34.6%, 2.17x vs 4.39x) to cut maxDD from −42% to −32%. That is a poor trade: you paid ~18 pts of CAGR for ~10 pts of drawdown relief.
2. **It does NOT avoid the 2022 bear.** −29% (MA) / −21% (TopHalf) is better than the basket's −33% but worse than SPY's −19%. The headline thesis ("time the trend to dodge 2022") **fails** — the filter only softened the blow, lost to a passive SPY hold, and was whipsawed.
3. **The only honest positive:** the **TopHalf ranking variant** has the best Sharpe (**1.12 > basket 1.07**) and best maxDD (−24%) — a *slim* risk-adjusted edge over the basket, driven entirely by holding fewer, stronger names and sidestepping the worst of 2022. But it is still pure long AI/semi exposure; its Sharpe edge over the basket (1.12 vs 1.07) is within noise and untested across 2018/2020.
4. **Everything that "works" here is the AI/semi run of 2023-2026.** Strip the bull and you're left with a strategy that underperformed SPY through the one bear we could test. That is the exact mirage the audit warned about — a recent-bull tailwind, not edge.

**Why not "drop":** the TopHalf ranking has a defensible (if small) risk-adjusted story and a real mechanism (concentration + trend gate). It is worth a *forward* paper test, but not a build-now, and **not** over a window we couldn't fully backtest.

## How to build it as a broker plugin (if pursued — recommend TopHalf variant only)

- **Universe:** the 31-name AI/semi basket above. Gate each name on `≥50 daily bars` of history before it's eligible (prevents holding pre-IPO/illiquid names).
- **Entry (rebalance, weekly cadence — weekly beat monthly on maxDD):** rank eligible names by 63-day return; select the top 50% with 63-day return > 0. Equal-weight the selected names at `1/N_eligible` each (so a thin trending set holds cash, matching the backtest).
- **Trend confirmation gate (add to reduce 2022-style whipsaw):** require BOTH `close > 50d SMA` AND top-half momentum to enter — combine the two variants. (Backtest the combined gate before shipping; not yet measured here.)
- **Exit:** at each weekly rebalance, drop any held name that falls out of the top half OR closes below its 50d MA; that sleeve goes to cash.
- **Sizing:** equal-weight across eligible sleeves; OUT sleeves → cash. Optionally cap any single name at 15% to avoid NVDA dominating.
- **Cost:** charge `bpsPerSide(sym)` per side on turnover (already in the model).
- **Guardrail (mandatory, given the data gap):** ship to **simulated tier only** and require a forward paper test that includes the next real drawdown before any promotion — we have NOT validated it across 2018 Q4 or 2020 COVID.

## Forward-test design (because the full-regime backtest is impossible here)

Since pre-2021 daily history is paywalled (403), run a **forward paper test** of the combined `TopHalf + 50dMA` weekly strategy on the sim broker for ≥6 months, logging: weekly exposure %, turnover/cost, and rolling 60-day Sharpe vs a buy-hold-basket and QQQ control sleeve. **Promotion gate:** it must beat the buy-hold-basket control on Sharpe through at least one ≥10% basket drawdown. If it only wins in an uninterrupted bull, it is beta — kill it like insider-following and options-flow.
