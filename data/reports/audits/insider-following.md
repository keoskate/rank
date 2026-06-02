# Audit: Insider-Following Signal (`insider-following`)

**Date:** 2026-06-01
**Scope:** `server/strategies/insiderFollowing.js`, `scripts/backtest-insider.js`,
`server/unusualWhalesClient.js` (`analyzeInsiderActivity`, `getRecentInsiderBuyTickers`,
`getInsiderBuySells`).
**Read-only analysis.** New code only under `scripts/backtests/`.

---

## What it does

The strategy buys when company insiders (officers/directors) make **open-market
purchases** (Form 4, `transaction_code === 'P'`) of their own stock. The thesis:
insiders buy ahead of catalysts the tape can't see; sells are ignored (insiders
sell for liquidity/taxes). Long-only; the plugin owns only the entry decision,
universal exit logic handles exits.

**Entry path (`insiderFollowing.js:37-87`):**
- `uw.analyzeInsiderActivity(symbol, {lookbackDays:10, minNotional:100000})` aggregates
  the per-ticker `insider-buy-sells` feed over a lookback window.
- `sentiment === 'bullish'` iff `buyNotional >= minNotional`.
- `confidence = round(50 + score*45)`; `score` is a log-scaled notional strength
  (`unusualWhalesClient.js:324-331`) plus a cluster boost for multiple buy days.
- Enters if `bullish && confidence >= minConfidence(60) && currentPrice > 0`.

**Universe (`getRecentInsiderBuyTickers`, `unusualWhalesClient.js:357-397`):** a
feed-driven scanner pulls tickers with recent qualifying buys from the market-wide
`/api/insider/transactions` feed, ranked by total buy notional. Default
`minNotional 500000`, `lookbackDays 10`, `max 15`.

**Exit policy (`insiderFollowing.js:144-151`):** the plugin now declares a
`holdPolicy` — multi-day, `exitBeforeClose:false`, TP 8% / SL 4%, `maxHoldDays 10`,
`minHoldMinutes 60`. This is the key change vs the old intraday EOD-close behavior.

---

## Audit findings

### Look-ahead / survivorship

- **No look-ahead in the entry timing — verified.** The backtest harness enters at
  the **open of the first session strictly after `filing_date`** (`backtest-insider.js:104-108`).
  I confirmed against the live feed that `filing_date >= transaction_date` in
  **100% of 158 sampled P-events** (0 cases of filing-before-transaction), median
  gap 1-2 days. Filing date is the public-information date, so entering the next
  session is conservative and correct. **PASS.**
- **Stale-filing contamination (LOW→MED).** A handful of events have huge
  filing-vs-transaction gaps (max observed **7,294 days** — a very late/amended
  filing). The production `analyzeInsiderActivity` filters by `filing_date` within
  `lookbackDays` so it's largely protected, but the *original* harness
  (`backtest-insider.js`) does **not** drop these — they enter on a decades-stale
  "signal." My extended harness adds a `lag > 21d` drop filter.
- **Survivorship in the +5d/+10d forward windows (HIGH for those horizons).** The
  UW feed is newest-first and (as tested) **ignores date-range params** — page 39
  of 500-row pages only reaches **3 weeks back** (~500 events/day). The original
  harness fetches bars only `evDate-10d .. evDate+25d`, and the most-recent filings
  have **no forward bars yet** (today = 2026-06-01). Result: the +5d/+10d samples
  silently shrink to the *older* events only — i.e. the ones that survived long
  enough to have a future. That is textbook survivorship and it inflates the longer
  horizons (win rate climbs to 75-90% while std collapses to ~8% as n falls). **The
  +1d and +3d numbers — where n is the full event count — are the only fully
  trustworthy horizons.**

### Correctness bugs in the existing harness (`backtest-insider.js`)

1. **Baseline ignores `--hold` (MED).** `baselineForward` (line 146-156) always
   measures the **+5 session** close (`bars[i+5]`) regardless of the `hold` arg,
   and only samples **10 evenly-spaced** points per ticker. So the headline "Edge
   vs baseline (+5d)" compares a hold-sensitive signal against a fixed +5d baseline,
   and the baseline n is tiny (~10/ticker). My extended harness samples **every
   session with a full +h window** and matches the baseline horizon to the signal
   horizon.
2. **Thin, recent, single-regime sample (MED).** Because of the feed pagination
   limit, every backtested event lands in a **2-3 week window** (2026-05-12 →
   2026-05-26 in my runs). There is no cross-regime validation; the "edge" is one
   bull-ish fortnight. Not a code bug, but a hard limit on what any backtest here
   can claim.

### Strategy / risk-management gaps

3. **Stop-loss is set inside the noise (HIGH — costs real money).** The plugin's
   `holdPolicy` SL is **4%**, but the signal's 1-day std is **18-23%**. A 4% stop
   gets hit by ordinary intraday noise on the way to the multi-day drift. Backtest
   (below) shows widening SL 4%→8% roughly **doubles** per-trade expectancy at every
   TP level. The plugin's own header comment even says "wider stop" — but 4% is not
   wide relative to these names' volatility.
4. **`atr` is faked (LOW).** `atr: currentPrice * 0.02` (`insiderFollowing.js:79`)
   is a hardcoded 2% — not a real ATR. If any downstream sizing/exit logic trusts
   this field, it's mis-scaled for high-vol small-caps (most insider-buy names).
5. **Price source can be a stale previous close (LOW).** `_price` falls back to
   `getPreviousClose` (`insiderFollowing.js:26-35`); the TP/SL anchors are then
   computed off yesterday's close, not the actual fill. Minor in paper, worth noting.
6. **No earnings/blackout or de-dup guard (LOW).** The feed carries
   `next_earnings_date` and `is_10b5_1` (pre-scheduled, lower-signal) flags that are
   unused. 10b5-1 plan buys are mechanical, not discretionary conviction, and dilute
   the signal. Filtering `is_10b5_1 === false` is free alpha to test.
7. **All paper brokers share one Alpaca account (context, not a bug here).** Small-cap
   insider names are thin; concurrent multi-day holds across brokers can concentrate
   illiquid exposure. Position sizing/liquidity caps belong in the exit/risk layer.

---

## Backtest method & results

**Harness:** `scripts/backtests/insider-following.js` (point-in-time, no look-ahead).
Sources officer/director `P` purchases from `/api/insider/transactions`, keeps the
**oldest** `want` events within the 40-page budget (maximizes forward-window
availability), drops filings lagging the transaction by >21 days, enters at the
**next session's open after `filing_date`**, walks intraday H/L for TP/SL exits
(stop checked before target within a bar — conservative), and compares against a
**hold-matched** baseline (every same-ticker session with a full +h window).

### Run 1 — `--min 300000`, 120 events (2026-05-12 → 2026-05-26), 87 tickers, median lag 1d

Raw forward returns (entry = next-session open):

| Horizon | n | mean | median | win% | std | trust |
|--------|----|------|--------|------|-----|-------|
| +1d | 120 | **+1.75%** | +0.86% | 56% | 17.8% | full sample ✅ |
| +3d | 120 | **+5.03%** | +1.89% | 63% | 38.2% | full sample ✅ |
| +5d | 108 | +2.74% | +3.15% | 75% | 8.4% | truncated ⚠️ |
| +10d | 42 | +5.65% | +5.35% | 88% | 8.2% | survivorship ⚠️ |

Hold-matched baseline (same tickers, n≈7,000+): **+3d −0.37%, +5d −0.54%, +10d −1.60%.**

**Edge vs baseline:** +3d **+5.40%**, +5d **+3.28%**, +10d **+7.25%**.

### Run 2 — `--min 500000`, 104 events

| Horizon | n | mean | win% | std |
|--------|----|------|------|-----|
| +1d | 100 | **+3.77%** | 58% | 23.0% |
| +3d | 83 | +6.87% | 64% | 45.7% |
| +5d | 75 | +3.16% | 73% | 8.6% |
| +10d | 29 | +6.45% | 90% | 9.5% |

Higher notional → stronger signal: +1d jumps from +1.75% ($300k) to +3.77% ($500k).
**Reproduces the prior "+4.37% vs baseline at 5d on $500k+ buys."**

### Exit-rule grid (sweep over TP × SL × hold, same 120 events, $300k)

Ranked by mean realized return/trade (ret/risk = mean/std):

| Exit | mean/trade | win% | target/stop/time | ret/risk |
|------|-----------|------|------------------|----------|
| **15/8/10d** | **+3.80%** | 68% | 23/20/77 | 0.48 |
| 10/8/10d | +3.29% | 68% | 45/20/55 | 0.48 |
| 8/8/10d | +2.90% | 71% | 60/19/41 | 0.48 |
| 6/8/10d | +2.25% | 72% | 71/19/30 | 0.42 |
| **8/4/10d (broker current)** | **+1.18%** | 49% | 40/55/25 | 0.22 |

At $500k: 15/8/10d **+4.16%** (ret/risk 0.55), 8/8/10d +3.03%, **broker current 8/4/10d +1.64%**.

**Dominant result, consistent across both thresholds: the 4% stop is the problem.**
Holding the full 10 days and widening SL to 8% ~doubles expectancy at every TP. The
signal is a high-variance multi-day drift; a 4% stop sits inside the daily noise and
converts winners into losers (8/4/10d stops out 55/120 trades; 8/8/10d only 19/120).

---

## Verdict

**Promising — real, repeatable edge on the signal; exits are mis-tuned and the long
horizons are not yet honestly backtestable from this feed.**

- The **entry timing is clean** (no look-ahead; verified filing_date ≥ transaction_date).
- The **edge is real and notional-graded**: +1d/+3d (full-sample, trustworthy)
  beat a near-zero/negative baseline by ~+1.8%/+5.4% at $300k and ~+3.8%/+6.9% at
  $500k. Bigger buys = bigger edge.
- The **+5d/+10d figures are survivorship-inflated** and must not be trusted at face
  value — they rest on n=29-42 of the older events only.
- The **current exit (TP 8 / SL 4 / 10d) leaves ~half the edge on the table** by
  stopping out winners.

---

## Prioritized recommendations

1. **[HIGH] Widen the stop. Change `holdPolicy` SL from 4% → 8%, keep `maxHoldDays 10`,
   set TP 10-15%.** Best risk-adjusted exit was **TP 10-15% / SL 8% / 10d hold**
   (ret/risk 0.48-0.55, +3.3-4.2%/trade) vs the current +1.2-1.6%/trade. This is a
   one-field change in the persona `.md` / plugin `holdPolicy` and roughly doubles
   simulated expectancy. (Note: cannot edit under `server/` here — change the
   broker's frontmatter or the plugin's `holdPolicy` block.)
2. **[HIGH] Raise `minNotional` to $500k for the entry gate.** The notional gradient
   is monotonic (+1d edge +1.75% → +3.77%). Trade fewer, higher-conviction names.
   `getRecentInsiderBuyTickers` already defaults to $500k; align the per-symbol
   `insiderMinNotional` (currently 100000 in `insiderFollowing.js:41`) to match.
3. **[MED] Filter out 10b5-1 plan buys (`is_10b5_1 === true`) and stale filings
   (filing lag > ~14-21d).** Mechanical/late buys are lower-signal; both flags are
   already in the feed and currently unused.
4. **[MED] Fix the original harness baseline** to honor `--hold` and sample all
   full-window sessions (done in the new harness); deprecate the +5d headline that
   compares a hold-sensitive signal to a fixed +5d, thin baseline.
5. **[MED] Forward-test the +5d/+10d thesis instead of trusting history.** Because
   the feed is newest-first with no working date filter, longer horizons can't be
   cleanly backtested. Stand up a daily logger: snapshot each qualifying
   `getRecentInsiderBuyTickers` event with its filing date and forward-fill returns
   from Polygon over the next 10 sessions into `data/flow-history/insider/`. In ~2-3
   weeks you'll have an un-truncated, look-ahead-free +10d distribution.
6. **[LOW] Replace the hardcoded `atr: price*0.02`** with a real ATR (or drop the
   field) so any downstream sizing isn't mis-scaled for volatile small-caps.
7. **[LOW] Add a liquidity / position-concentration cap** in the risk layer — insider
   names are thin and multiple paper brokers share one Alpaca account.

**Harness:** `/Users/keo/projects/rank-app/rank/scripts/backtests/insider-following.js`
Run: `node scripts/backtests/insider-following.js --events 120 --min 500000`
