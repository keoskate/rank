# Cross-Sectional Momentum (xs-momentum)

**Verdict: PROMISING (lean alpha) — but data-constrained. The historical edge over a
survivorship-matched baseline is real but thin (+0.16 Sharpe) and the regime window
we could actually test is incomplete.**

Backtested: yes (2022-01 → 2026-06, daily bars, net of cost).
Edge type: **alpha** (selection edge beyond beta survives the survivorship-matched
control) — but small and only demonstrated over a partial regime span.

---

## What it is

Classic academic cross-sectional momentum (Jegadeesh–Titman). Each month, rank a
broad liquid universe by trailing return, buy the recent winners equal-weight, hold
one month, repeat. The thesis: relative winners keep winning for 3–12 months.

## Exact mechanical rule

- **Universe**: fixed 45 large/mega-cap US equities, diversified across sectors
  (mega-tech, semis, consumer/retail, financials, healthcare, industrials/energy/
  staples). Names chosen to have traded continuously since 2017 (e.g. AAPL, MSFT,
  NVDA, JPM, XOM, UNH, PG, CAT…). See survivorship note.
- **Signal**: at each rebalance day `t`, momentum score = total return from
  `t-LB` to `t-21` trading days. `LB=252` → classic **12-1** momentum; `LB=126` →
  **6-1**. The `-21` skip drops the most recent month to avoid short-term reversal.
- **Entry**: long the **top quintile** (top 20% = 9 of 45 names), **equal-weight**,
  fully invested, no leverage, no cash buffer.
- **Exit / rebalance**: **monthly**, full rebalance — sell anything that fell out of
  the top quintile, rebuy the new top quintile to equal weight. Carried names are not
  re-traded (only turnover is costed).
- **Sizing**: equal weight `1/9` per name.
- **Cost**: `server/risk/transactionCost.js` `bpsPerSide()` (5 bps/side for these
  ordinary equities) charged on the **dollar turnover** at each rebalance.

## Backtest method

`scripts/backtests/xs-momentum.js` — pulls adjusted daily closes from Polygon for all
45 names + SPY + QQQ, builds the SPY trading calendar, computes monthly rebalances at
first-trading-day close, marks the portfolio to market daily for clean Sharpe, and
deducts turnover cost at each rebalance. Benchmarks: buy-and-hold SPY and QQQ over the
identical window (one entry cost each). Sharpe uses rf = 0.

**HARD DATA LIMITATION (must read):** the Polygon plan on this key only returns history
back to **2021-06-04**. The full methodology window (2018 Q4 selloff, 2020 COVID crash,
2021 bull) is **not retrievable**. After burning the lookback, the testable window is:
- 12-1 (LB=252): **2022-07 → 2026-06** (misses H1-2022, the worst of the bear)
- 6-1 (LB=126): **2022-01 → 2026-06** (captures the full 2022 bear — this is the
  meaningful regime read)

So the numbers below are real and net-of-cost, but they span only **one bear (2022)
and one bull (2023–2026)**. We could NOT test 2018 or 2020. Treat regime-robustness as
**unproven outside 2022**.

## Results

### 6-1 momentum, 2022-01-03 → 2026-06-02 (4.41 yrs) — full-2022-bear window

| Strategy | CAGR | Vol | Sharpe | MaxDD | TotalRet |
|---|---|---|---|---|---|
| **XS-MOM (top quintile)** | **+20.2%** | 21.3% | **0.99** | -24.5% | +125.0% |
| EW-ALL universe (same 45 names) | +13.3% | 16.8% | 0.83 | -24.3% | +73.4% |
| SPY buy & hold | +11.1% | 17.7% | 0.69 | -25.4% | +58.9% |
| QQQ buy & hold | +15.1% | 23.2% | 0.72 | -35.3% | +85.7% |

### 12-1 momentum, 2022-07-01 → 2026-06-02 (3.92 yrs) — misses H1-2022

| Strategy | CAGR | Vol | Sharpe | MaxDD | TotalRet |
|---|---|---|---|---|---|
| XS-MOM (top quintile) | +27.9% | 21.9% | 1.25 | -26.4% | +162.2% |
| EW-ALL universe (same 45 names) | +20.8% | 15.6% | **1.29** | -19.4% | +109.4% |
| SPY buy & hold | +19.2% | 16.4% | 1.16 | -19.0% | +99.1% |
| QQQ buy & hold | +28.1% | 21.3% | 1.28 | -22.9% | +164.3% |

### Calendar-year returns (6-1 variant)

| Strategy | 2022 | 2023 | 2024 | 2025 | 2026 (YTD) |
|---|---|---|---|---|---|
| **XS-MOM** | **-10.4%** | +46.2% | +25.4% | +14.4% | +22.0% |
| EW-ALL | -13.8% | +27.9% | +18.1% | +18.2% | +12.7% |
| SPY | -19.9% | +24.3% | +23.3% | +16.4% | +11.4% |
| QQQ | **-33.7%** | +53.8% | +24.8% | +20.2% | +21.5% |

## Regime behavior (what we could measure)

- **2022 bear (the key test):** XS-MOM **-10.4%** vs SPY -19.9% vs QQQ **-33.7%** vs
  EW-all -13.8%. Momentum *outperformed everything* during the drawdown. It rotated
  into the actual 2022 winners (energy, staples, healthcare, defensives) and out of
  mega-cap tech before the worst of QQQ's collapse. **There was no "momentum crash"
  in 2022** — those happen on violent bear→bull reversals (e.g. spring 2009) where
  beaten-down junk rips and the winners portfolio lags. 2022 was a slow grind-down
  that *rewarded* the momentum tilt. We did NOT get to test a 2009-style reversal.
- **2020 COVID crash & 2018 Q4 selloff:** **not testable** — no data. This is the
  single biggest gap. Momentum is historically vulnerable precisely in sharp V-shaped
  reversals, and we have zero coverage of one.
- **2023–2026 bull:** momentum kept pace or beat (e.g. +46% in 2023 vs SPY +24%),
  driven by riding the AI/semis winners.

## Alpha vs beta — the honest call

The whole point of the EW-ALL control: it holds **all 45 of the same survivor-biased
names**, so it carries the *identical* survivorship inflation as the momentum leg.
Therefore **[XS-MOM − EW-ALL] is clean selection edge**, stripped of survivor bias.

- **6-1 window:** XS-MOM Sharpe **0.99 > EW-all 0.83** and CAGR +20.2% > +13.3%.
  → **Genuine selection alpha of ~+0.16 Sharpe / ~+7% CAGR** beyond just owning the
  survivor basket. This is the strongest evidence and it includes the 2022 bear.
- **12-1 window:** XS-MOM Sharpe **1.25 < EW-all 1.29** — momentum did **not** beat
  the survivor basket risk-adjusted in the calmer post-2022 sub-window (it made more
  raw return but took more vol/DD to get it).

So the edge is **real but lookback- and window-sensitive**, and concentrated in the
turbulent 2022 period. Against the *indices* it looks great; against the *honest
survivorship-matched control* it's a modest, not-overwhelming edge that the 12-1
variant doesn't even clear.

**Bottom line:** lean **alpha**, not beta — but thin, and proven over an incomplete
regime span (no 2018, no 2020, no momentum-crash reversal). Not a mirage like
insider/options-flow (which lived inside the cost band), but not a slam-dunk either.

## How to build it as a broker plugin

- **Universe**: the 45-name fixed liquid large-cap list in the backtest (or expand to
  a real S&P-100 constituents pull if available). Equal-weight only.
- **Cadence**: monthly. On the first trading day of each month, after close (or near
  close), recompute scores and rebalance.
- **Entry**: rank universe by 6-1 momentum (`ret[t-126 … t-21]`); buy the top
  quintile (≈9 names) to equal weight. Prefer **6-1 over 12-1** — it was the variant
  that actually beat the survivorship control and it captures regime rotation faster.
- **Exit**: any held name no longer in the top quintile at rebalance is sold; proceeds
  recycled into new entrants to restore equal weight. No intramonth stops (would
  break the factor; momentum needs to ride).
- **Sizing**: `1/N` of allocation per name, N = quintile size. Fully invested.
- **Cost guard**: only the live system's real turnover incurs cost; carried names stay
  put. Budget ~5 bps/side; turnover is modest (≈45 rebalance-trades over 4.4 yrs in
  the sim).
- **Risk note for the floor**: this is a long-only, fully-invested equity-beta sleeve.
  It will draw down with the market (–24% peak here). Its edge is *relative selection*,
  not crash protection — pair it with the entropy/regime gate if you want to flatten in
  high-entropy regimes, and treat the untested 2020-style V-reversal as the live risk.

## Recommendations

1. **Build it as a paper-tier sim broker on the 6-1 rule** to gather forward, truly
   out-of-sample (and survivorship-clean, since live data has no survivor bias) data.
   The historical edge is plausible but the test window is too narrow to promote to
   real money on its own.
2. **Forward-test priority:** the live forward record is more trustworthy than this
   backtest because (a) it has no survivorship bias and (b) it will eventually sample a
   regime we couldn't (a sharp reversal). Run sim for ≥6–12 months before any tier-up.
3. **Do not over-trust the 12-1 variant** — it failed the survivorship control. Use 6-1.
4. **If a longer history feed becomes available** (paid Polygon tier / point-in-time
   constituents), re-run across 2018 + 2020 before committing capital — momentum's
   known failure mode (V-reversals) is exactly what's missing here.

---
*Backtest script: `scripts/backtests/xs-momentum.js` (run with `MOM_LOOKBACK=126`
for the 6-1 / full-2022 window; default 252 for 12-1). All numbers net of
`transactionCost.bpsPerSide` turnover cost.*
