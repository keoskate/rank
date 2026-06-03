# Strategy-Broker Build Plan — Synthesis

**Date:** 2026-06-03
**Author:** synthesis step over 10 strategy research reports
**Goal:** a consistently profitable automated trader. We are willing to build many
strategy-brokers and prove edges forward. This plan ranks what has REAL edge to build
NOW, what is promising-but-needs-work, and what to drop — and is brutally honest about
ALPHA vs BETA.

---

## TL;DR (read this first)

- **Exactly ONE strategy demonstrably cuts the bear-market left tail across multiple
  independent rule specs: time-series momentum / trend-following (`ts-momentum-trend`).**
  That left-tail cut (2022: roughly flat vs SPY -20% / QQQ -34%, across 4 rule variants)
  is the only genuine alpha *signature* in the whole batch. Build it first.
- **One more has a thin but real SELECTION edge: cross-sectional momentum
  (`xs-momentum`, 6-1 variant).** It beats a survivorship-matched control by ~+0.16
  Sharpe. Worth building, but as a long-beta sleeve with a regime gate, not as a
  standalone money-printer.
- **Everything else that "made money" is BETA** — concentrated long-tech/AI/semi
  exposure that prints in 2023-2026 and craters worse than QQQ in 2022
  (`thematic-buyhold` -45%, `semi-cycle` -52%, `ai-momentum`, `sector-dual-momentum`).
  This is the *same trap that killed insider-following and options-flow*: great numbers
  on a recent-bull-heavy window, MaxDD no better (usually worse) than just holding QQQ.
- **Three are dead on arrival:** `overnight-anomaly` (loses to cost),
  `fomo-gap-momentum` (negative expectancy), `scanner-edge` (buys dips in downtrends,
  -29% in 2022, Sharpe 0.18).
- **The single highest-leverage infrastructure fix is data + a regime gate.** Our
  Polygon plan 403s everything before ~2021-06, so 2018 Q4 and the 2020 COVID crash are
  invisible. Every "alpha" verdict here is provisional on ONE bear (2022). And a free
  **FRED macro regime gate** (`data-and-news`) directly attacks the "fails-in-2022"
  weakness that recurs in every beta strategy.

---

## The ALPHA vs BETA reckoning (the honest part)

The user wants consistent profit. Here is the uncomfortable truth this batch reveals:

**Almost everything that showed a big CAGR is long-tech beta.** `thematic-buyhold`
(+18% CAPM alpha) is 1.44x-QQQ with an NVDA/AI tilt. `semi-cycle` beats SPY/QQQ on raw
return *purely by carrying 2-3x the drawdown* (-50/-55% vs SPY -25%). `ai-momentum`'s
trend overlay is risk-adjusted WORSE than just holding the basket and still ate -29% in
2022. `sector-dual-momentum`'s 49% CAGR is single-lookback luck that concentrates into
whatever ripped (SMH/XLE) and whose bear-protection mechanic *never actually fired in
the tested window*.

**What "it's beta" means concretely for the goal of consistent profit:** these
strategies will print money — possibly a LOT — for as long as the AI/tech bull runs.
Then, in the next real bear, they will give most of it back faster and deeper than the
index, because they are leveraged, concentrated long exposure. That is not consistency;
that is a coin that keeps landing heads until it doesn't. We *just killed two signals*
for exactly this. We must not re-hire the same mistake wearing a "momentum" or "sector
rotation" costume.

**What actual alpha looks like in this batch:** `ts-momentum-trend` is the inverse of
the mirages. The mirages made money in the bull and broke in the bear. Trend-following
*earns its keep in the bear* — it sidestepped 2022 across four independent rule specs
(SMA200-cash, 50/200 cross, dual-mom top3, dual-mom top5), turning -20%/-34% into
roughly flat. Robustness across specifications is the anti-curve-fit tell. Its known
weakness (slow re-entry after a V-bottom, visible in the 2023 give-up: +32% vs
buy-hold +55%) is real and untested against a 2020-style snap-back. `xs-momentum`
(6-1) is genuine but *thin* selection alpha (+0.16 Sharpe over a survivorship-matched
control) and is itself long-beta in drawdowns.

**Bottom line:** the consistent-profit engine is NOT one of the high-CAGR beta
baskets. It is (1) a trend/regime layer that removes the left tail + (2) a couple of
genuine selection sleeves run *underneath* that regime gate. Build the gate and the
trend follower first; let the beta sleeves run only when the gate says risk-on, capped
and clearly labeled.

---

## Tier 1 — BUILD NOW (real edge, ranked)

### 1. `ts-momentum-trend` — Dual-momentum top-5 with CASH out-leg  ⭐ build first
- **Why #1:** the only strategy whose risk-adjusted win comes from cutting the bear
  tail, demonstrated across 4 independent rule specs (anti-curve-fit). Best Sharpe
  among trend variants (DualMom top5 1.13; QQQ-SMA200-cash highest Calmar 1.45).
- **Edge type:** alpha (qualified — one bear tested).
- **Spec:** Universe SPY,QQQ,IWM,DIA,XLK,SMH,XLF,XLE,XLV,XLY,XLP,XLI,XLU,XLB,XLRE,XLC,
  EEM,EFA. Out-asset = **CASH / SHY / BIL, NOT TLT** (TLT fell with stocks in the 2022
  rate shock — every _TLT variant was strictly worse). Eligible if close>200d SMA AND
  12-1 momentum>0; rank eligible by 12-1 momentum; equal-weight top 5; unfilled slots
  to cash. Exit to cash on close<SMA200 OR momentum<=0. 1/N=20%, **no leverage on the
  long leg** (leverage re-introduces the tail trend exists to remove). Rebalance
  monthly, allow intramonth exit on a trend break. Anti-whipsaw: if >3 round-trips/30d
  on a symbol, require close>1.02xSMA200 to re-enter.
- **Simplest viable v1:** single-asset **QQQ SMA200-cash** (Calmar 1.45, 13 trades over
  5yr). Ship this as the MVP, upgrade to dual-mom top5 once wired.

### 2. `xs-momentum` — 6-1 cross-sectional momentum, top quintile  ⭐ build second
- **Why #2:** genuine selection alpha that survives a survivorship-matched control
  (Sharpe 0.99 vs EW-all 0.83, +7% CAGR) AND it *outperformed in the 2022 bear*
  (-10.4% vs SPY -19.9% / QQQ -33.7%) by rotating into energy/staples/defensives.
- **Edge type:** alpha (thin, lookback-sensitive — 6-1 only; 12-1 FAILED the control).
- **Spec:** Universe = fixed 45 large/mega-cap liquid US equities, equal-weight only.
  Monthly, first trading day at close: rank by 6-1 momentum (return t-126..t-21, skip
  most recent ~1mo); buy top quintile (~9 names) equal-weight, fully invested, no
  leverage. At rebalance sell anything out of the top quintile, recycle into entrants;
  NO intramonth stops (would break the factor). 1/N sizing, ~5bps/side on turnover only.
- **Caveat:** long-only equity beta in drawdowns (-24% peak). Edge is relative
  selection, not crash protection. **Run it UNDER the regime gate** (Tier 3 below).

---

## Tier 2 — PROMISING, NEEDS WORK (build as overlays / forward-only)

### 3. FRED macro regime gate (`data-and-news`, deliverable A) — build as a shared overlay
- **Not a standalone strategy — it's the de-risking layer every beta sleeve needs.**
  Free FRED key, decades of history, directly attacks the "fails-in-2022" failure mode
  that recurs in every beta strategy here.
- **Spec:** allow normal entries when yield-curve slope (DGS10-DGS2) positive AND HY
  spread (BAMLH0A0HYM2) below its 6mo MA; risk-off = cut gross to 25% / force flat when
  HY spread spikes or curve deeply inverts. Multiply existing position sizes by a regime
  scalar {1.0 risk-on, 0.25 risk-off}. Daily on macro release, respect publication lag.
- **Action:** add free `FRED_API_KEY` to `.env`, build as a cross-broker overlay. This
  is the single highest-leverage *new* capability — it converts the beta sleeves from
  "prints until it doesn't" into "prints, then gets out of the way."

### 4. Tech Mogul sentiment broker (`data-and-news`, deliverable B) — FORWARD-ONLY paper experiment
- **Cannot be backtested honestly:** Polygon LLM-sentiment `insights` only exist from
  ~Oct 2024 (one bull regime). Backtesting it reproduces the exact recent-bull mirage
  that killed insider/options-flow.
- **Action:** run as a logged paper-tier experiment, benchmarked LIVE vs QQQ+SPY,
  conviction>=+0.4 entry, exit <+0.1 or 5-day timeout, fractional-Kelly sizing capped
  10%/name. Promote ONLY on >=6mo risk-adjusted QQQ beat spanning a risk-off episode,
  with pre-committed kill criteria. Low priority vs Tier 1/3.

### 5. UW short-interest / borrow-fee (`data-and-news`) — needs its own multi-regime backtest
- Already-paid data, real time series, distinct mechanism (squeeze/crowding). NOT yet
  tested. Commission a dedicated backtest with an explicit 2022 check before any capital.

### 6. The beta baskets (`thematic-buyhold`, `semi-cycle`, `ai-momentum`,
`sector-dual-momentum`) — build ONLY as capped, regime-gated, clearly-labeled BETA sleeves
- If built at all: cap the sleeve small, hard-wire the FRED gate AND a "hold only while
  QQQ>200d SMA" filter, and NEVER size them on their 2023-2026 realized return. Without
  the gate their -45% to -52% drawdowns are worse than QQQ. These are not edge; they are
  optional bull-market amplifiers. Lowest priority — do not build until the gate exists.

---

## Tier 3 — DROP (no edge, or actively bad)

- **`overnight-anomaly`** — gross drift (~2-3 bps/day) is 3-5x smaller than round-trip
  cost (10 bps/day). Loses every year net, no downside protection. Mathematically
  cannot win at this engine's cost. Dead.
- **`fomo-gap-momentum`** (chase/long) — negative net expectancy at every threshold
  (-0.23%/trade at >=2%, t-stat -3.5 to -4.2). Gap size is a CONTRA signal. The fade
  direction is the only non-negative read and isn't itself proven +EV. Drop the chase.
- **`scanner-edge`** — Sharpe 0.18, -44% maxDD, loses to SPY on return AND risk AND
  drawdown over 4.68yr. Structurally buys oversold dips in downtrends (rsiExtreme +
  bbBreakout overpower bearish trendAlign), which is why it lost -29% in 2022. Keep the
  scanner as a HUMAN idea screener; do NOT wire a broker to its raw output.
- **`sector-dual-momentum`** (as an alpha claim) — 49% CAGR is single-lookback luck
  (Sharpe 0.83-1.47 across lookbacks, 3 of 4 lose to QQQ), bear-protection never fired.
  Demoted to "forward-only beta sleeve" above; drop the alpha framing.
- **`semi-cycle`** / **`thematic-buyhold`** (as alpha claims) — pure leveraged-tech
  beta; rotation adds a thin parameter-fragile tilt that loses sign across lookbacks and
  fails 2022. Drop the alpha framing; keep only as capped gated beta if at all.

---

## Top data-source additions (ranked by edge x regime-robustness / cost)

1. **FRED macro (FREE)** — `FRED_API_KEY` in `.env`. DGS10-DGS2 curve slope +
   BAMLH0A0HYM2 HY spread. Decades of history, a true regime signal, directly fixes the
   fails-in-2022 weakness. **Do this first — it's free and it's the missing layer.**
2. **Deeper price history (>5yr daily bars)** — Polygon 403s before ~2021-06, so EVERY
   verdict here rests on a single bear (2022). 2018 Q4 and 2020 COVID are invisible.
   Upgrade the Polygon plan or source flat-files / TradingView export. This is a
   *blocking* research-infra gap: we cannot confirm durable multi-cycle alpha without it.
3. **UW short-interest / borrow-fee** (`/api/shorts/:sym/data`) — already paid, real
   time series, distinct mechanism. Worth a dedicated backtest.
4. **Polygon fundamentals** (`vX/reference/financials`) — deep history; build a
   quality/value screen using `filing_date` (not period_end) to avoid look-ahead. Most
   bear-durable known anomaly class.
5. **(Future vendor) earnings estimate-revisions** — PEAD is durable, but we lack a
   historical consensus-estimate source (would need Benzinga/Zacks/FMP). Flag and defer.

**SKIP:** Polygon news sentiment / Tech-Mogul as a *backtest* (insights only from Oct
2024 = recent-bull mirage), congressional trades (lagged up to 45d, limit-capped, same
family as killed insider signal), options IV/skew/greeks (only ~250d history, skew
empty for AAPL — not multi-regime testable).

---

## Concrete roadmap — order of operations + validate → promote

**Phase 0 — Infrastructure (do before any new broker):**
1. Add free `FRED_API_KEY` to `.env`; build the FRED regime gate as a shared overlay
   (size scalar {1.0 risk-on, 0.25 risk-off}). This de-risks everything downstream.
2. Flag the >5yr price-history gap as a tracked infra task; until fixed, every promotion
   is gated on FORWARD evidence, not backtest CAGR.

**Phase 1 — Build broker #1: `ts-momentum-trend` (QQQ-SMA200-cash MVP → dual-mom top5).**
- Validate: replay the existing `scripts/backtests/ts-momentum-trend.js` numbers in the
  sim tier; confirm it goes to cash on a trend break.
- Promote: paper-tier when sim matches backtest behavior. To REAL: only after one full
  cycle of forward data, specifically watching up-capture after the next V-bottom (the
  live weakness). This is the keystone broker — it removes the left tail for the book.

**Phase 2 — Build broker #2: `xs-momentum` 6-1 top-quintile, running UNDER the FRED gate.**
- Validate: sim-tier, survivorship-clean forward record (live data has no survivor bias).
- Promote: run sim >=6-12 months; promote on a survivorship-clean forward Sharpe beat of
  the EW-all control, NOT on backtest. Use 6-1 ONLY (12-1 failed the control).

**Phase 3 — Stand up the forward-only experiments in paper, logged vs QQQ+SPY:**
- Tech Mogul sentiment broker (kill criteria pre-committed) and a dedicated UW
  short-interest backtest. These run in parallel, low priority, purely to gather
  out-of-sample evidence. No real capital until >=6mo risk-adjusted QQQ beat spanning a
  risk-off episode.

**Phase 4 — Only if the bull persists and the gate is proven: add ONE capped beta sleeve**
(e.g. `xs-momentum` already covers the selection tilt; a small gated `semi-cycle` /
`thematic-buyhold` could be added as a labeled amplifier). Hard cap, FRED + 200d-SMA
gated, never sized on realized bull returns. This is the "make hay while the sun shines"
slot, explicitly accepted as beta, not edge.

**Promotion discipline (applies to ALL):** sim → paper → real. No promotion past
simulated without (a) the regime gate wired and (b) forward evidence through at least
one >=10% basket drawdown. Kill any broker that only wins in an uninterrupted bull —
that is the insider/options-flow failure mode, and it is the default failure mode of
every beta sleeve in this batch.

---

## One-line verdict map

| Strategy | Edge | Action |
|---|---|---|
| ts-momentum-trend | alpha (1 bear) | **BUILD #1** (keystone, left-tail cut) |
| xs-momentum (6-1) | alpha (thin) | **BUILD #2** under regime gate |
| FRED regime gate | overlay | **BUILD (infra)** — free, de-risks everything |
| Tech Mogul sentiment | forward-only | paper experiment, kill criteria |
| UW short-interest | untested | dedicated backtest first |
| sector-dual-momentum | beta | drop alpha claim; forward-only gated sleeve |
| thematic-buyhold | beta | capped gated beta only, or drop |
| semi-cycle | beta | capped gated beta only, or drop |
| ai-momentum | beta | needs-work; not build-now |
| overnight-anomaly | no-edge | **DROP** (loses to cost) |
| fomo-gap-momentum | no-edge | **DROP** (negative expectancy) |
| scanner-edge | no-edge | **DROP** as broker; keep as human screener |
