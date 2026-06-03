# Semiconductor Cycle Hunter (key: `semi-cycle`)

**Verdict: BETA (with a thin, fragile momentum tilt that does NOT survive the regime test).**
The semi basket is just leveraged tech/AI exposure. Sub-sector relative-strength rotation adds a small, parameter-dependent return bump but provides **zero downside protection** — it crashed as hard as (slightly harder than) the equal-weight basket in the 2022 bear, with a Sharpe near -1.1. "Knowing the cycle" via trailing relative strength does not capture the cycle in a way that beats just holding the whole basket on a risk-adjusted basis.

---

## What it is
The thesis: semiconductor sub-sectors lead and lag each other through the chip cycle (memory bottoms first, equipment leads on capex, logic/foundry and design ride end-demand). If that's real and tradable, ranking sub-groups by relative strength and rotating into the strongest — trimming rather than fully exiting the laggards — should beat passively equal-weighting the whole semi basket.

We test that mechanically and skeptically: is the rotation actually capturing cycle leadership, or is it just riding the same semiconductor beta with extra turnover?

## Exact rule (mechanical, codeable)
**Universe — 4 equal-weight sub-group sleeves:**
- `memory`: MU, WDC, STX
- `logic_foundry`: TSM, INTC
- `equipment`: AMAT, LRCX, KLAC
- `design`: NVDA, AMD, AVGO  *(ARM excluded — IPO'd 2023-09, breaks full-window comparability)*

**Signal:** each sleeve = equal-weight, daily-reconstituted return stream. Rank the 4 sleeves by trailing 63-day (~3-month) total return.

**Entry/weights (ROTATE-TOP2-TRIM, the primary variant):** top-2 sleeves get 40% each; bottom-2 keep a 10% floor (trim, not exit). Normalized to sum to 1.
Also tested ROTATE-TOP1-TRIM (top sleeve 55%, others 15% floor) and the null EW-BASKET (25% each, always).

**Exit / rebalance cadence:** monthly (first trading day of each month). At each rebalance, re-rank and reset to target weights. **Trim, never full-exit** — every sleeve always retains its floor weight.

**Sizing/cost:** weights are fractions of NAV. Turnover at each rebalance is charged round-trip at `transactionCost.bpsPerSide()` = 5 bps/side for these ordinary equities (avg sleeve cost 5.0 bps/side, verified at runtime). 60 monthly rebalances over the window.

**Benchmarks:** EW-BASKET (the null hypothesis the prompt demands), SPY buy&hold (market beta), QQQ buy&hold (tech beta — the real bar).

## Backtest method & data caveat
- Script: `/Users/keo/projects/rank-app/rank/scripts/backtests/semi-cycle.js` (run with `require('dotenv').config()`).
- Prices via `server/polygonClient.getHistoricalAggregates(sym,start,end,'day')`, adjusted daily closes; common-date intersection calendar across all 11 semis + SPY + QQQ.
- **DATA LIMITATION (verified at runtime, not assumed):** the Polygon plan on this key returns `NOT_AUTHORIZED` ("Your plan doesn't include this data timeframe") for any date before ~**2021-06**. I probed 2018, 2020, early-2021 directly — all 403. So **2018 Q4 selloff and the 2020 COVID crash are NOT testable** on this key. The realized window is **2021-06-04 → 2026-06-02 (4.99 yrs, 1254 common trading days)**. Crucially this **does** cover the full **2022 bear** — the single most important regime stress — plus 2021 tail, 2023 recovery, and the 2024-2026 AI bull.

## Results — overall (full window, net of cost)

| Strategy            | CAGR   | Sharpe | MaxDD  | TotalRet |
|---------------------|--------|--------|--------|----------|
| EW-BASKET (null)    | +48.2% | 1.26   | -50.5% | +612%    |
| ROTATE-TOP2-TRIM    | +53.0% | 1.31   | -54.6% | +736%    |
| ROTATE-TOP1-TRIM    | +57.6% | 1.37   | -52.7% | +869%    |
| **SPY** (buy&hold)  | +12.5% | 0.77   | -25.4% | +80%     |
| **QQQ** (buy&hold)  | +17.4% | 0.83   | -35.6% | +122%    |

## Results — by regime (period return / maxDD)

| Regime                  | EW-BASKET | ROTATE-TOP2 | ROTATE-TOP1 | SPY    | QQQ    |
|-------------------------|-----------|-------------|-------------|--------|--------|
| 2021 tail (→12/31)      | +17.4%    | +26.4%      | +29.3%      | +12.4% | +18.5% |
| **2022 BEAR (full yr)** | **-42.4%**| **-43.8%**  | **-41.3%**  |**-19.9%**|**-33.7%**|
|   2022 maxDD            | -50.5%    | -54.4%      | -52.5%      | -25.4% | -35.2% |
| 2023 recovery           | +90.0%    | +98.9%      | +105.2%     | +24.8% | +54.8% |
| 2024 AI bull            | +19.9%    | +18.5%      | +21.8%      | +24.0% | +27.0% |
| 2025 bull               | +107.7%   | +110.5%     | +110.4%     | +16.6% | +20.4% |
| 2026 YTD                | +112.2%   | +126.2%     | +130.1%     | +11.2% | +21.7% |

## Per-year Sharpe (the risk-adjusted test)

| Year | EW-BASKET | ROTATE-TOP2 | ROTATE-TOP1 | SPY   | QQQ   |
|------|-----------|-------------|-------------|-------|-------|
| 2022 | -1.12     | -1.15       | -1.04       | -0.80 | -1.13 |
| 2023 | 2.48      | 2.50        | 2.59        | 1.77  | 2.57  |
| 2024 | 0.70      | 0.65        | 0.73        | 1.78  | 1.43  |
| 2025 | 2.01      | 2.04        | 1.98        | 0.89  | 0.91  |

## Sleeve leadership by year (did sub-groups actually rotate?)

| Year | memory   | logic_foundry | equipment | design   |
|------|----------|---------------|-----------|----------|
| 2022 | -50.3%   | -45.7%        | -32.3%    | -42.7%   |
| 2023 | +69.6%   | +65.8%        | +70.5%    | +158.9%  |
| 2024 | +10.4%   | -6.2%         | +5.0%     | +80.0%   |
| 2025 | +220.6%  | +74.5%        | +93.5%    | +58.8%   |

Leadership genuinely rotates (design dominated 2023-24, memory exploded in 2025). The problem isn't that the cycle is fake — it's that **3-month trailing relative strength doesn't anticipate the turns**; it chases what already ran, so the rotation only marginally beats the null.

## Lookback sensitivity (robustness)
Rotation "edge" is fragile. ROTATE-TOP2-TRIM Sharpe across lookbacks: 21d→1.40, 42d→1.22, 63d→1.31, 126d→1.33, 189d→1.32, 252d→1.35, vs **EW-null 1.26**. At the 42-day lookback the rotation *underperforms* the null. The signal hovers right at the null and flips sign with the parameter — characteristic of noise, not durable edge.

## Alpha-or-beta verdict: **BETA**
- **It's overwhelmingly beta.** All four semi strategies (incl. the null) blow away SPY/QQQ in CAGR (+48–58% vs +12–17%) — but that's leveraged-tech exposure in a once-in-a-decade AI bull, not skill. The give-back is in the drawdown: -50% to -55% maxDD vs SPY -25% / QQQ -36%.
- **The rotation tilt is NOT alpha.** vs the honest null (EW-BASKET), ROTATE adds ~+5–9% CAGR and ~+0.05–0.11 Sharpe — but (a) it *fails the regime test*: in the 2022 bear it lost MORE than the EW basket (-43.8% vs -42.4%, worse maxDD), and worse than QQQ; (b) it's parameter-fragile (loses at 42-day lookback, loses in 2024); (c) the bump is concentration-into-momentum riding the same AI names, not cycle-timing. This is exactly the "looks great on the recent bull, craters in 2022" mirage the mandate warns against.
- **Risk-adjusted, across regimes, it does not beat buy-and-hold as *edge*.** It beats on raw return purely by carrying ~2-3x more downside risk in a bull. In 2022 every variant had a deeply negative Sharpe (-1.0 to -1.15) and a >50% drawdown.

**Conclusion:** the rotation does not capture the cycle in a tradable, durable way. The basket is a high-beta semiconductor long. If you want the exposure, fine — but don't dress momentum-chasing rotation up as alpha. **Drop the rotation claim; treat as beta.** A defensible improvement worth separate research: a *regime overlay* (e.g. cut total semi exposure to the floor when SOXX/QQQ is below its 200-day MA) — that targets the -52% drawdown, which is the actual problem, rather than the sleeve-selection, which isn't.

## If built as a broker plugin (spec — but gate it behind a regime filter)
- **Universe:** 4 EW sleeves — memory (MU/WDC/STX), logic_foundry (TSM/INTC), equipment (AMAT/LRCX/KLAC), design (NVDA/AMD/AVGO).
- **Entry/ranking:** monthly, rank sleeves by trailing 63-day total return; top-2 → 40% each, bottom-2 → 10% floor (trim, not exit).
- **Exit/rebalance:** monthly reset to target; trim laggards, never full-exit.
- **Sizing:** weights × NAV; round-trip cost 5 bps/side on turnover.
- **REQUIRED overlay (not optional):** a market-regime gate — when SOXX (or the basket) closes below its 200-day SMA, collapse all sleeve weights to a defensive floor / cash, because the unhedged version takes a -52% drawdown in a bear and that, not sleeve selection, is what kills the account. Without this gate, do **not** promote past the simulated tier.
