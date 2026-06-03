# Dual-Momentum Sector Rotation — Research Report

**Key:** `sector-dual-momentum`
**Date:** 2026-06-03
**Verdict:** `needs-work` / edge type `beta` (with a heavy data-availability caveat — the regime test we most needed is impossible on our data feed)

---

## 1. What it is

Classic Antonacci-style **dual momentum** applied to a sector/theme ETF sleeve:

- **Relative momentum** — each month, hold the single strongest ETF by trailing return.
- **Absolute momentum** — but only if that winner also beats cash/T-bills over the same window; otherwise step out of equities into TLT (or cash). This is the "sidestep the bear" overlay.

The thesis: relative momentum keeps you in whatever's working; absolute momentum is a circuit-breaker that gets you out before a full bear chews through your capital.

## 2. Exact mechanical rule (as coded)

- **Risk universe (8):** SMH, XLK, QQQ, XLE, XLF, XLV, IWM, GLD
- **Safe asset:** TLT (long Treasuries). **Cash fallback:** BIL (1–3mo T-bill ETF, total-return cash proxy).
- **Cadence:** monthly. Decide on the last trading day of each month, **fill at next day's open** (no look-ahead).
- **Signal:** trailing total return over a lookback window (base case 252 trading days ≈ 12 months).
- **Relative:** pick the universe member with the highest trailing return.
- **Absolute:** if winner's trailing return ≤ BIL's trailing return → risk-off. Risk-off goes to TLT if TLT's own absolute momentum is positive, else CASH (BIL).
- **Sizing:** 100% in the single chosen asset (concentrated, classic dual momentum).
- **Cost:** `bpsPerSide(sym)` charged per leg on every switch (5 bps/side for these unleveraged ETFs → 10 bps round trip).

Backtest script: `/Users/keo/projects/rank-app/rank/scripts/backtests/sector-dual-momentum.js`
Result JSON: `/Users/keo/projects/rank-app/rank/scripts/backtests/sector-dual-momentum-result.json`

## 3. Backtest method & the data wall (READ THIS FIRST)

I requested 2017-01-01 → 2026-06-01 (one year of warmup before the 2018 start). **Our Polygon plan only returns ~5 years of daily history: every symbol's data begins 2021-06-04, regardless of the requested start date.**

Consequence — the regimes that matter most for an honest momentum test are **unavailable**:

| Regime | Available? |
|---|---|
| 2018 Q4 selloff | NO (data starts 2021) |
| 2019 bull | NO |
| **2020 COVID crash + recovery** | **NO** ← the single best stress test for an absolute-momentum bear filter |
| 2021 bull | partial (only H2; consumed by lookback warmup) |
| 2022 bear | YES (from Jan 2022, with H2-2021 warmup) |
| 2023–2026 bull | YES |

So the actual usable backtest window with a clean 12-month warmup is **2022-07-01 → 2026-06-01 (~3.9 yrs)**. This is overwhelmingly a **bull window with one bear year bolted on the front**. We cannot validate the bear-sidestep mechanic on 2020 or 2018 at all. This is precisely the failure mode that killed the insider/options-flow signals: a recent-bull-heavy window that flatters a long-biased strategy.

## 4. Results (net of transaction cost)

### Headline (12-month lookback, the parameter that wins)

| Strategy | Window | CAGR | Max DD | Sharpe | Return/\|MaxDD\| | Switches |
|---|---|---|---|---|---|---|
| **Dual-momentum (LB=252)** | 2022-07 → 2026-06 | **49.2%** | **-24.8%** | **1.47** | 1.99 | 3 |
| B&H SPY | same | 19.6% | -19.0% | 1.17 | 1.03 |
| B&H QQQ | same | 28.4% | -22.9% | 1.28 | 1.24 |

On the surface this beats both benchmarks. **It does not survive scrutiny.**

### Lookback robustness — the result is parameter-mined

All four runs below share the *exact same* start (2022-07-01) and benchmark window:

| Lookback | CAGR | Max DD | Sharpe | Beats QQQ Sharpe (1.28)? |
|---|---|---|---|---|
| 63d (3mo) | 33.5% | -24.8% | 1.23 | NO |
| 126d (6mo) | 34.9% | -24.8% | 1.20 | NO |
| 189d (9mo) | 21.6% | -32.4% | 0.83 | NO (much worse, deeper DD) |
| **252d (12mo)** | **49.2%** | -24.8% | **1.47** | yes — the *only* winner |

**Three of four lookbacks fail to beat buy-and-hold QQQ on a risk-adjusted basis**, and the 9-month variant is dramatically worse with a -32% drawdown. A durable edge is not this fragile to one knob. The 12-month win is a single point on a noisy surface, not a robust signal.

### What the strategy actually did — only 3 trades in ~4 years

| Date | Switch |
|---|---|
| 2023-06-01 | XLE → SMH |
| 2025-02-03 | SMH → GLD |
| 2026-04-01 | GLD → SMH |

It held **XLE through all of 2022** (energy was the one sector up in the 2022 bear), then **SMH (semiconductors)** through the 2023–2025 AI/semi melt-up, with a brief GLD detour. The entire outperformance is two concentrated bets — energy in 2022, semis in 2023–25 — that happened to be the right call in this specific window.

### Days held per asset (base case)

SMH 47% · GLD 30% · XLE 23%. **It never once triggered the absolute-momentum bear exit to TLT/cash** in the usable window — because there was no sustained bear after mid-2022. The "sidestep the bear" mechanic, the entire reason to prefer this over a sector-rotation-with-no-filter, **was never exercised and therefore is completely unvalidated.**

### By regime (period return)

| Regime | Strat | SPY | QQQ |
|---|---|---|---|
| 2022 BEAR (from Jan, partial) | +20.5% | +0.3% | -5.6% |
| 2023 bull | +9.8% | +24.8% | +54.8% |
| 2024 bull | +43.3% | +24.0% | +27.0% |
| 2025–26 YTD | +162.0% | +29.7% | +45.6% |
| 2018 / 2019 / 2020 | n/a — DATA UNAVAILABLE | | |

Note 2023: the strategy **lagged badly** (+9.8% vs QQQ +54.8%) because it was still riding XLE while semis ran — relative momentum is slow to rotate. The huge 2025–26 number is pure SMH beta in a semiconductor melt-up.

## 5. Alpha-or-beta verdict

**Beta, dressed up — and unproven where it counts.**

1. **It's a concentrated long-equity bet.** 100% in one high-beta sector at a time, ~80%+ of days in SMH/XLE/GLD. The outperformance is "we held the highest-beta thing that ripped," not a risk-adjusted edge. On a Sharpe basis it beats QQQ in only 1 of 4 lookback settings.
2. **The defensive overlay is untested.** The absolute-momentum bear filter — the only thing that would distinguish this from naive sector chasing — never fired, because our data has no real bear after mid-2022. The 2020 crash, the textbook test for this mechanic, is unavailable.
3. **Parameter-fragile.** Sharpe swings from 0.83 to 1.47 across reasonable lookbacks. That's mining, not edge.
4. **Drawdown is no better than the benchmark.** Max DD -24.8% vs QQQ -22.9% — the strategy did not deliver the downside protection that is its entire selling point.

This is the same trap that killed insider-following and options-flow: great-looking numbers on a recent-bull-dominated window that collapse the moment you stress the parameter or ask for the missing bear regime.

## 6. If we still want to pursue it — how to build it as a broker plugin

The concept (dual momentum) is academically real over 1971–present in the literature; our problem is purely that **we cannot backtest the bear-protection here.** Two honest paths:

### Path A — Forward test only (recommended before any capital)
Run it live in simulation tier and *wait for a real risk-off month* to confirm the absolute-momentum exit actually moves it to TLT/cash. Until that fires at least once, treat the bear thesis as unproven.

### Path B — Plugin spec (sim tier, paper-money, do NOT promote on this backtest)
- **Universe:** SMH, XLK, QQQ, XLE, XLF, XLV, IWM, GLD; safe = TLT; cash = BIL.
- **Entry:** monthly (last trading day → next open). Rank by 12-month trailing total return. Buy the top name **iff** its 12mo return > BIL's 12mo return.
- **Exit / risk-off:** if no risk asset beats cash, hold TLT (if TLT 12mo > BIL 12mo) else BIL. Exit current holding whenever the monthly rank changes.
- **Sizing:** to reduce the concentration/fragility risk, hold **top-2 equal-weight** instead of top-1 (smooths the lookback sensitivity materially). Cap any single sector at 50%.
- **Cadence:** monthly; ignore intramonth.
- **Cost:** `bpsPerSide` per leg, already modeled.

### Hard gating recommendation
Do **not** route real paper/live money on the strength of this backtest. The decisive regimes (2020, 2018) are absent, the defensive mechanic never fired, and 3 of 4 lookbacks underperform QQQ risk-adjusted. If pursued, it must be **forward-only** in the simulated tier until it logs at least one genuine risk-off rotation and shows it across multiple lookbacks.
