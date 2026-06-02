# Dark-Pool Signal Audit (key: `dark-pool`)

**Files:** `server/strategies/darkPool.js`, `server/unusualWhalesClient.js` (`analyzeDarkPool`, `getDarkPoolPrints`)
**Date:** 2026-06-01 · read-only audit + bounded live backtest

---

## What it does

A long-only entry plugin. It pulls recent dark-pool (off-exchange / TRF) prints
for a symbol from Unusual Whales (`GET /api/darkpool/{ticker}`), classifies each
print as **buy-side** vs **sell-side** by where it executed relative to the NBBO
midpoint, and fires a BUY when buy-side **premium** dominates above a size floor.

Core logic in `analyzeDarkPool` (`unusualWhalesClient.js:424-515`):

- Window: keep prints with `executed_at >= now - lookbackMinutes` (default 120m).
- Per print: `mid = (nbbo_ask + nbbo_bid)/2`; **`price >= mid` → buyPremium, else sellPremium`** (`:465-466`).
- `buyShare = buyPremium / (buyPremium + sellPremium)`.
- `bullish` if `buyShare >= minBuyShare (0.6)` **and** `totalPremium >= minPremium ($1M)`.
- `score = 0.5*shareStrength + 0.4*premStrength + 0.1` (premStrength = `log10(total)/log10(50M)`).

The plugin (`darkPool.js`) maps `score`→confidence (`50 + score*45`, `:52`), enters when
bullish & confidence≥minConfidence(65) & price>0, and sets a swing exit
(hold multi-day, TP +4% / SL -2%, maxHold 5d, no force-close at the bell — `:144-151`).

---

## Audit findings

### HIGH

1. **The signal has no measurable forward edge (backtest below).** Over 120
   ticker-day cells on a 20-name large-cap basket, bullish cells returned
   **+0.281%** next session vs a **+0.319%** baseline — an edge of **-0.04%**
   (negative/inconclusive). The strategy ships with a comment admitting "No
   backtest yet" (`darkPool.js:142`); this audit is that backtest, and it does
   not clear random.

2. **`price >= mid` mis-classifies at-mid and tie prints as buys, inflating
   buyShare.** (`unusualWhalesClient.js:465`). Dark-pool blocks very frequently
   print **exactly at the midpoint** (negotiated crosses) or exactly at the
   prior NBBO bid/ask. In the live data, **~13% of premium per name printed
   exactly at mid** and is silently counted as buying. Measured single-day
   counts: AAPL had 25/500 prints at-mid + 24 exactly-at-bid, yet 93% premium
   buyShare; TSLA 96%. Mid/at-tick prints carry **zero directional
   information** — a true Lee-Ready style classifier would mark at-mid as
   indeterminate (drop) and use a tick test for ties. Using `>=` systematically
   biases the score bullish, which matters for a **long-only** strategy that can
   only act on bullish reads.

3. **Dark-pool "buy at/above mid" is not a reliable proxy for buyer-initiated
   accumulation.** Unlike lit-market trades, off-exchange/TRF prints are often
   pre-negotiated blocks, ATS internalization, and **delayed/late-reported
   prints** whose `price` is stamped against a *current* NBBO that may not be the
   NBBO at execution. The premise in the file header ("above mid = buyer-
   initiated", `:9-10`, `:416-417`) is an assumption the data does not support;
   the backtest is consistent with it being noise.

### MEDIUM

4. **Premium-weighting lets one mega-print flip the whole signal.** `buyShare`
   is dollar-weighted (`:482`), so a single large block dominates. Across the
   basket buyShare swung from 7% (NVDA) to 96% (TSLA) on the *same day* purely
   from a handful of large prints. There is no per-print cap, count-confirmation,
   or robustness check (e.g. require N independent prints on the same side).

5. **No point-in-time guard against late-reported / after-hours prints in
   live use.** `analyzeDarkPool` filters only by `lookbackMinutes` from "now"
   (`:449`). During RTH the 120m window will include extended-hours and TRF
   late prints with stale NBBO context, and the plugin's `lastPrice` is just
   the newest print's price (`:460`, `darkPool.js:50`) — which in the data is
   frequently an **after-hours** print (the endpoint's newest rows are 23:59
   UTC = 19:59 ET). Entering off an AH print price while the strategy is
   "long-only swing" can set TP/SL off a non-RTH reference.

6. **500-print API cap silently truncates the window.** `getDarkPoolPrints`
   takes whatever `res.data` returns; the endpoint caps at **500 prints,
   newest-first** (verified). For liquid names that 500 only reaches back to
   **~15:40 ET**, so a `lookbackMinutes=120` request issued at, say, 11:00 ET
   may get a window that is *shorter than requested at the front* on heavy
   days, or on a quiet symbol may reach further than 120m — the lookback is not
   actually enforced against the cap. No warning is surfaced.

### LOW

7. **`at-mid` handling also breaks the bearish branch symmetry.** `bearish`
   requires `buyShare <= 1 - minBuyShare` (`:486`). Because at-mid premium is
   pushed into buy, the sell side is understated and bearish almost never
   triggers — confirmed live: only 7/120 cells classified bearish vs 28
   bullish. (Bearish is informational only since the strategy is long-only,
   but it pollutes any future use.)

8. **Confidence is a near-constant.** `confidence = round(50 + score*45)` with
   `score` floored at `0.5*0 + 0.4*premStrength + 0.1`. For any bullish trigger
   `premStrength` is high (≥$1M premium), so confidence clusters in the high-70s
   to high-80s regardless of signal quality — it does not discriminate.

9. **`atr: currentPrice * 0.02` is a hardcoded fake ATR** (`darkPool.js:74`).
   Any downstream sizing/exit logic that trusts `atr` is getting a flat 2% of
   price, not realized volatility.

---

## Backtest method & results

**Harness:** `scripts/backtests/dark-pool.js` (point-in-time, no look-ahead).

**The hard data limitation, stated honestly:** `GET /api/darkpool/{ticker}?date=`
returns **at most the last 500 prints of that session, newest-first**. For liquid
large-caps the 500-cap only reaches back to **~15:40–16:00 ET**. A true *midday*
point-in-time snapshot is therefore **impossible** from this endpoint for these
names. The earliest reconstructable decision is **at/near the regular-session
close (~16:00 ET)**. I built the test around that, which actually mirrors a
broker polling dark-pool near the close and entering the next open.

**Method:**
1. Basket: 20 large/mega-caps. Days: 6 recent sessions (2026-05-20 → 05-28).
2. For each (ticker, day) reconstruct `analyzeDarkPool` **faithfully** (same
   `price >= mid` rule, same $1M / 0.6 thresholds) using **only prints with
   `executed_at <= 20:00 UTC (16:00 ET)`** — strict point-in-time, no AH leakage.
3. Forward return = **next session open→close** (broker enters next open).
4. Baseline = the same next-session return on **every** cell, signal or not.
5. 700ms sleeps + 429 backoff; 120 valid cells after rate-limit retries.

**Results (120 ticker-day cells):**

| Bucket | n | mean next-session ret | win rate |
|---|---|---|---|
| **BULLISH** signal | 28 | **+0.281%** | 57% |
| BEARISH signal | 7 | +0.871% | 43% |
| **BASELINE** (all) | 120 | **+0.319%** | 49% |

- **Bullish edge vs baseline: −0.038%** → inconclusive / no edge.
- Bearish cells (n=7) had the *highest* forward return — the opposite of the
  signal's claim (tiny n, but no hint of inverse-edge either).
- Mean reconstructed `buyShare` = 54.2%; **mean at-mid premium share = 12.8%**,
  all of it counted as "buy" — direct confirmation of finding #2.

**Caveat:** n=28 bullish over 6 sessions is far too small to be significant; a
truncated earlier run (rate-limited to 47 cells) spuriously showed +0.225% edge,
which vanished once the full sample loaded. That fragility is itself the point:
there is **no robust signal here**, and flow-alerts being recent-only means we
can't extend the history.

---

## Verdict

**no-edge** (on available evidence). The classifier is biased bullish by the
`price >= mid` tie rule, the premise (off-exchange print vs NBBO mid = buyer
accumulation) is weak for TRF/block data, and the bounded backtest shows the
bullish read does **not beat a random-day baseline** next session. Do **not**
deploy real capital on this signal as written.

---

## Prioritized recommendations

1. **[HIGH] Do not promote dark-pool to paper/real.** It currently has no
   demonstrated edge. Keep it in pure simulation only.
2. **[HIGH] Fix the classifier.** Treat `price == mid` (and exact bid/ask ties)
   as **indeterminate** and drop them, or apply a tick test against the prior
   print. Re-measure buyShare after — expect it to fall toward ~50%.
3. **[MED] Add count-confirmation + per-print cap.** Require ≥N independent
   prints on the buy side and cap any single print's premium weight so one block
   can't flip the read (finding #4).
4. **[MED] Forward-test instead of backtest.** Since flow/intraday dark-pool is
   recent-only, stand up a nightly job that snapshots each watched name's
   close-time buyShare into `data/flow-history/` and accumulates 30–60 sessions
   of labeled (signal, next-day return) data, then re-run this harness for real
   significance.
5. **[MED] Enforce the lookback against the 500-cap.** Detect when the oldest
   returned print is newer than `now - lookbackMinutes` (window truncated by the
   cap) and flag low-confidence; reject after-hours prints for `lastPrice`.
6. **[LOW] Replace the hardcoded `atr = price*0.02`** with a real ATR, and make
   `confidence` actually scale with buyShare strength rather than clustering high.

**Artifacts:** backtest `scripts/backtests/dark-pool.js`; this report
`data/reports/audits/dark-pool.md`.
