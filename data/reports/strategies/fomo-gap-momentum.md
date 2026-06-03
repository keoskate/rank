# FOMO Opening Gap-Up Momentum (idea #5) — key: `fomo-gap-momentum`

**Verdict: NO EDGE (negative expectancy). You buy the top.**
**Edge type: no-edge.** Net of cost, gap-up momentum has *negative* per-trade
expectancy, and the bigger the gap the worse it gets — the textbook signature of
buying euphoria into mean reversion.

---

## What it is

The classic retail "don't fight the FOMO" trade: when a liquid name **gaps up**
hard at the open on a burst of attention/volume, buy at the open and ride the
momentum, exiting same-day-close (or next-close) with a tight stop. The claim is
that opening gap-ups carry intraday momentum you can scalp.

## Exact mechanical rule (point-in-time, no lookahead)

- **Universe:** 40 liquid S&P-100 names across sectors (AAPL, MSFT, AMZN, GOOGL,
  META, NVDA, TSLA, JPM, V, MA, UNH, HD, PG, JNJ, XOM, CVX, KO, PEP, WMT, DIS,
  NFLX, ADBE, CRM, INTC, AMD, QCOM, CSCO, ORCL, TXN, IBM, BAC, WFC, GS, MS, C,
  BA, CAT, GE, MCD, NKE).
- **Signal (known AT the open):** `gap[D] = open[D] / close[D-1] - 1`.
- **Entry:** if `gap[D] >= GAP_PCT`, buy at `open[D]`. Both inputs (`open[D]`,
  `close[D-1]`) are known at the moment of entry — no lookahead.
- **Optional volume gate:** relative volume `= volume[D-1] / avg(volume[D-21..D-2])`.
  Uses the **prior** day's full volume, which IS known at `open[D]` (you cannot use
  day-D volume at the open without lookahead).
- **Exits (three variants, all net of round-trip cost):**
  1. **Same-day close:** `open[D] → close[D]`.
  2. **Next-day close:** `open[D] → close[D+1]`.
  3. **Tight-stop:** intraday stop at `open*(1-STOP%)`; if `low[D] <= stop`, assume
     filled at the stop (conservative), else exit at `close[D]`.
- **Sizing / portfolio:** 1 unit per signal; signals pooled by date; daily
  portfolio return = equal-weight mean of that day's signal returns; no-signal
  days = cash (0%).
- **Cost:** `transactionCost.bpsPerSide('AAPL')` = 5 bps/side → **10 bps round-trip**,
  deducted from every trade.

## Backtest method & data window

- **Engine:** `scripts/backtests/fomo-gap-momentum.js` (run with
  `require('dotenv').config()`, real Polygon daily bars, 200ms sleeps, 429-safe).
- **Requested window:** 2018-01-01 → today.
- **DATA LIMITATION (must be stated):** the Polygon plan on this account only
  returns ~5 years of daily history (≈1254 bars; AAPL's earliest bar is
  **2021-06-04**). So **the 2018-Q4 selloff and the 2020 COVID crash are NOT
  available** and could not be tested. The realized window is **2021-06 → 2026-06**,
  which still spans the **2022 bear** (the single most important stress regime),
  the 2021 melt-up tail, and the 2023–2026 bull. The 2022 bear is the key
  out-of-bull-sample test and the strategy fails it.

### Results — gap ≥ 2%, tight stop −1.5% (1,697 trades)

**Per-trade expectancy (net of cost):**

| Exit | n | mean/trade | win% | t-stat | verdict |
|---|---|---|---|---|---|
| Same-day O→C | 1697 | **−0.23%** | 45.2% | **−3.54** | ❌ statistically −EV |
| Next-day O→C+1 | 1696 | −0.04% | 49.1% | −0.42 | ⚖️ ~zero (coin flip) |
| Tight-stop −1.5% | 1697 | −0.14% | 36.3% | −2.79 | ❌ statistically −EV |

**Same-day (O→C) net mean by year:**

| Year | n | mean/trade | win% |
|---|---|---|---|
| 2021 (H2) | 82 | +0.02% | 44% |
| **2022 (bear)** | 499 | **−0.07%** | 46% |
| 2023 | 240 | +0.07% | 52% |
| 2024 | 286 | −0.35% | 46% |
| 2025 | 384 | −0.84% | 38% |
| 2026 (H1) | 206 | +0.20% | 49% |

No year is reliably positive; the only clearly profitable-ish reads (2023, 2026)
are swamped by losing years. There is no stable sign.

**Portfolio equity curve vs buy-and-hold (full window):**

| Strategy | CAGR | Sharpe | maxDD | total |
|---|---|---|---|---|
| Gap same-day (O→C) | **−10.29%** | −0.23 | −65.3% | −41.8% |
| Gap next-day (O→C+1) | +0.20% | 0.21 | −68.4% | +1.0% |
| Gap tight-stop −1.5% | −3.44% | −0.04 | −46.8% | −16.0% |
| **Buy-hold SPY** | **+12.50%** | **0.77** | −25.4% | +79.7% |
| **Buy-hold QQQ** | **+17.42%** | **0.83** | −35.6% | +122.3% |

### Bigger gaps are WORSE — gap ≥ 3% + relvol ≥ 1.5× (223 trades)

| Exit | n | mean/trade | win% | t-stat |
|---|---|---|---|---|
| Same-day O→C | 223 | **−0.88%** | 36.3% | **−4.15** |
| Next-day O→C+1 | 223 | −0.05% | 46.6% | −0.15 |
| Tight-stop −2% | 223 | −0.67% | 26.5% | −4.25 |

Portfolio: same-day CAGR −13.4% / Sharpe −0.75; tight-stop CAGR −14.5% /
Sharpe −1.02. **Tightening the FOMO filter makes the loss larger and more
statistically significant** — the cleanest possible evidence that you are buying
the top. Volume confirmation does not rescue it.

### 2022 bear behavior (the stress test that matters)

- Same-day: −0.07%/trade over 499 trades (cumulative −33% additive). Slow bleed.
- Next-day: −0.34%/trade, cumulative −171% additive — catastrophic. Holding a
  gap-up overnight in a bear means eating the next day's gap-down.
- Tight-stop: −0.10%/trade, win 37%. The stop just locks in many small losses.

## Alpha-or-beta verdict

Neither. It is **not even beta** — beta would at least make money long in a bull.
This loses money outright (negative same-day expectancy in most years, including
the bull years 2024–2025), and is destroyed in the 2022 bear. On a risk-adjusted
basis it is dominated by simply holding SPY or QQQ across every metric: CAGR,
Sharpe, and max drawdown. The next-day variant nets to ~0% / Sharpe 0.21, which is
"a coin flip with a −68% drawdown" — strictly worse than cash.

**Mechanism:** opening gap-ups are, on average, *overreactions*. Same-day O→C
reverts (the median same-day trade loses), and the reversion intensifies with gap
size (−0.88% at ≥3% vs −0.23% at ≥2%). This is consistent with the well-documented
short-term reversal / "gap fade" literature: the tradable edge, if any, is on the
*fade* side, not the *chase* side.

## How to build it as a broker plugin

**Do not build the long/chase version.** If a broker wants to touch opening gaps,
the only direction with a non-negative read here is to **fade** them, and even that
is not demonstrated to be +EV after cost in this test — it would need its own
dedicated backtest before risking capital. Recommendation: **drop**.

If forced to spec the (rejected) chase plugin for completeness:
- **Universe:** S&P-100 liquid names.
- **Entry:** at/just-after open, `open/prevClose - 1 >= 2%`.
- **Exit:** same-day close, hard stop −1.5%.
- **Sizing:** small fixed fraction, equal-weight across same-day signals.
- **Cadence:** evaluated each session at the open.

This spec is documented only to be explicit about what was tested and rejected.

## Honest caveats

1. **No 2018/2020 data** on this Polygon plan — the COVID crash and 2018-Q4
   selloff could not be tested. The conclusion rests on 2021-H2 → 2026, including
   the full 2022 bear.
2. Daily-bar same-day O→C is a proxy for an intraday strategy; real intraday
   entries near the open could differ, but the directional signal (gap-ups fade)
   is robust across thresholds and the effect strengthens with gap size, which is
   hard to reconcile with any chase edge.
3. Cost (10 bps round-trip) is modest and ordinary-equity; even at zero cost the
   same-day mean stays negative (−0.13% gross at ≥2%), so cost is not the killer —
   the signal itself is.
