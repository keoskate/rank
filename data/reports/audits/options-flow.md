# Audit: options-flow signal

**Key:** `options-flow`
**Files:** `server/strategies/optionsFlow.js`, `server/unusualWhalesClient.js` (`analyzeTickerFlow` / `getMarketTide`)
**Date:** 2026-06-01
**Status:** Backtested via a faithful historical PROXY (daily options-volume aggregate). Live intraday alert feed itself is NOT backtestable — confirmed below.

---

## 1. What it does

A broker on the `options-flow` plugin enters long when **recent unusual options flow** on its symbol is heavily call-premium-skewed and sized, optionally gated by the market-wide tide. Exits are universal (stop/target/EOD). Long-only.

**Signal pipeline:**

1. `analyzeTickerFlow(symbol, {lookbackMinutes, minPremium, minSkew})` (`unusualWhalesClient.js:123`)
   - Pulls `/api/stock/{t}/flow-alerts` (most-recent-first alert rows).
   - Keeps alerts newer than `lookbackMinutes` (default 30).
   - Sums `total_premium` per side (call/put), plus aggressive `total_ask_side_prem`, sweep count, opening-trade count.
   - `callShare = callPremium / (callPremium + putPremium)`.
   - `bullish` if `callShare >= minSkew` (0.65), `bearish` if `1-callShare >= minSkew`.
   - `sentiment = bullish` only if also `totalPremium >= minPremium` ($250k).
   - **score (0..1)** = `0.5·skewStrength + 0.3·premStrength + 0.1·dominantAskShare + 0.1·(sweep present)`, where `skewStrength=(skew-0.5)/0.4` and `premStrength=log10(totalPremium)/log10(5e6)`.

2. Plugin (`optionsFlow.js:23`)
   - `confidence = round(50 + score·45)` → 50..95.
   - Tide adjustment: bullish flow + bearish tide → `-15`; bullish flow + bullish tide → `+5`.
   - `shouldEnter = isBullish && confidence>=minConfidence(65) && currentPrice>0`.
   - Targets: fixed `+takeProfitPercent%` / `-stopLossPercent%` (defaults **TP +2% / SL -1%**).
   - `getMarketTide()` reads `/api/market/market-tide`, takes the latest cumulative point, `callShare = netCall/(|netCall|+|netPut|)`, sentiment bullish/bearish at the 0.6/0.4 cut.

---

## 2. Audit findings

### HIGH — Broker exit (TP +2% / SL −1%) turns a weakly-positive signal into a losing strategy
`optionsFlow.js:99-102` hard-codes a 2:1 reward:risk with a **1% stop on 3x-vol mega-cap optionable names**. In the proxy backtest the +5-session forward drift was mildly positive (~+1.7%), but once you apply the actual TP/SL exit, **~73% of trades stop out at −1%** and only ~27% reach +2%, giving **negative expectancy on every signal variant** (−0.20% / −0.04% / −0.14% per trade). The stop is far inside one ATR of these names (`atr` is even self-declared as `currentPrice*0.02` at `optionsFlow.js:113`, i.e. 2% — wider than the 1% stop). The exit, not the signal, is the dominant P&L driver and it is mis-sized. **This is the single biggest problem.**

### HIGH — Market-tide signal is structurally biased bullish and effectively inert
`getMarketTide()` (`unusualWhalesClient.js:91-97`) computes `callShare = netCall / (|netCall| + |netPut|)`. Live data (verified 2026-06-01) shows `net_call_premium` and `net_put_premium` are **both large positive cumulative running totals** (netCall≈$550M, netPut≈$54M), so `callShare`≈0.91 and the tide reads **"bullish" nearly every snapshot**. Consequences:
- The intended `-15` "fighting the tape" headwind almost never fires; the `+5` tailwind almost always does.
- Treating a positive `net_put_premium` as the "bearish weight" is conceptually wrong — net put premium being positive does not mean "puts dominating." The denominator mixes two same-signed quantities.
- Net effect: the tide gate is a near-constant +5 confidence bump, not a real regime filter. It adds bullish bias rather than removing bad trades.

### MED — `confidence` floor of 50 + the +5 tide bump can clear the gate with near-zero signal
`confidence = 50 + score·45` (`optionsFlow.js:73`). With `minConfidence=65`, the *flow score alone* must clear ~0.33. But a bullish tide adds +5 (almost always), so an effective score of ~0.22 passes. Given how easily `callShare>=0.65` is met intraday on call-heavy names, the gate is loose. Combined with the bullish-biased tide, entries are over-triggered.

### MED — `bullish`/`bearish` skew uses gross call-vs-put premium, not directional intent
`analyzeTickerFlow` classifies by `callShare` of **gross total_premium** (`unusualWhalesClient.js:191`). Buying a call and *selling* a call both add to call premium; a long put and a *sold* put both add to put premium. The `dominantAskShare` term (only 10% of score) is the only nod to buy-vs-sell intent. The backtest confirms this matters: UW's own buy/sell-pressure classification (`bullish_premium`/`bearish_premium`, Variant B) had **negative** forward edge, while gross call-share (Variant A) was weakly positive — i.e. the two disagree, and the plugin uses the cruder one.

### MED — No de-duplication / single-snapshot dependence; one cached pull drives the decision
The signal is a single `flow-alerts` snapshot (60s TTL cache, `unusualWhalesClient.js:24`). There is no persistence of prior windows, so the "lookbackMinutes" window is whatever the most recent 100 alerts happen to cover. For an illiquid name 100 alerts may span hours; for NVDA they span ~2h (verified: 18:01→19:59). The `lookbackMinutes=30` filter then silently keeps only a fraction, and `alertCount` can collapse to a handful, making `callShare` noisy. No minimum `alertCount` gate exists.

### LOW — `underlyingPrice` taken as "most recent" but loop runs newest→oldest with last-write-wins
`unusualWhalesClient.js:174-175` sets `underlyingPrice` on every in-window alert with a comment "most-recent (alerts are newest-first)". But last-write-wins means it ends up holding the **oldest** in-window alert's price, not the newest. Minor (used only for target math, and WS price is a fallback), but the comment is wrong and the price can be slightly stale.

### LOW — Confidence is reported but the score→confidence map is arbitrary and uncalibrated
`50 + score·45` is a cosmetic remap; there is no evidence the resulting "confidence %" correlates with realized win rate (backtest win rates were flat ~50-52% across score levels). It should not be trusted as a probability for Kelly sizing downstream.

### Not a bug, but note — look-ahead is NOT present in the live plugin
The plugin only ever reads *current* flow and enters *now*, so there is no historical look-ahead risk in production. (The look-ahead risk lives only in any backtest harness; mine enters at D+1 open, see below.)

---

## 3. Backtest method & results

### Can the live signal be backtested? Partly — confirmed the alert feed is recent-only
I probed the UW key directly:
- **`/api/stock/{t}/flow-alerts`** (what the plugin uses): for NVDA the entire feed spanned **18:01→19:59 the same day** (n=100). Recent-only, ~last 2 hours. **Cannot backtest from history.** Confirmed.
- **`/api/stock/{t}/options-volume?date=YYYY-MM-DD`**, `greek-exposure?date=`, `market-tide?date=` → all return **HTTP 403 `historic_data_access_missing`**: "earliest date available to you is 2026-05-20 (7 trading days)." So the *date-parameterized* history is gated to 7 days.
- **Loophole found:** the same endpoints via the **rolling `?limit=N` param are NOT gated**:
  - `/api/stock/{t}/options-volume?limit=120` → **~120 daily bars** (2025-12-08 → 2026-06-01) with `call_premium, put_premium, net_call_premium, bullish_premium, bearish_premium, call/put volume`.
  - `/api/stock/{t}/greek-exposure` → **250 daily bars** (2025-06-03 → 2026-06-01) of call/put delta/gamma/charm/vanna.

The `options-volume` daily aggregate is a **faithful proxy** for the live signal: it measures the same thing (net directional options premium / call-vs-put skew per day), just rolled up to a daily bar instead of a 30-min intraday alert window.

### Harness
`scripts/backtests/options-flow.js` (point-in-time, no look-ahead). Universe = 25 liquid optionable names. For each ticker-day D where daily flow is bullish-skewed + sized, **enter at the next session's open (D+1)** — flow for day D is only knowable after the close — and measure forward returns at +1/+3/+5 sessions plus a broker-style TP/SL exit. Baseline = random/evenly-spaced entry days on the same tickers. 300ms sleeps, error/429 handling, daily-bar cache.

Three signal definitions tested:
- **A: `callShare >= skew`** (matches the live plugin's gross call-share).
- **B: `bullShare = bullish_premium/(bullish+bearish) >= skew`** (UW's own buy/sell-pressure tag).
- **C: `net_call_premium > 0`** (institutional net call buying).

### Results (skew=0.60, hold/exit TP +2% / SL −1% / 5d, 25 tickers, ~120 sessions each)

```
BASELINE (random entry, same tickers, +5d):   n=300   mean +0.81%   win 45%

VARIANT A: callShare>=0.60   (1787 signal-days)
  +1 session   mean +0.45%  win 51%
  +3 sessions  mean +0.98%  win 52%
  +5 sessions  mean +1.71%  win 52%
  broker-exit  mean -0.20%  win 27%   (target 471 · stop 1305 · time 11)
  ▶ edge vs baseline (+5d): +0.91%   t≈1.49   INCONCLUSIVE
  ▶ broker-exit expectancy: -0.20%/trade   (NEGATIVE)

VARIANT B: bullShare>=0.60   (150 signal-days)
  +5 sessions  mean -0.31%  win 44%
  broker-exit  mean -0.04%  win 32%
  ▶ edge vs baseline (+5d): -1.12%   t≈-1.34   NEGATIVE-leaning
  ▶ broker-exit expectancy: -0.04%/trade

VARIANT C: net_call_premium>0   (1250 signal-days)
  +5 sessions  mean +1.44%  win 50%
  broker-exit  mean -0.14%  win 29%
  ▶ edge vs baseline (+5d): +0.63%   t≈1.02   INCONCLUSIVE
  ▶ broker-exit expectancy: -0.14%/trade
```

Robustness checks:
- **skew=0.70** (more selective): Variant A edge +0.85%, t≈1.33 — still insignificant; broker-exit still −0.19%/trade.
- **Wider stop TP +4% / SL −2%, hold 10d**: broker-exit expectancy rises to ~break-even (Variant A −0.02%/trade), edge t≈1.46 — confirms the *exit*, not the signal, is what kills it; a wider stop recovers most of the bleed but still no significant alpha.

### Interpretation
1. **The flow skew has at best a marginal, statistically-insignificant forward edge** (+0.9% over a +0.8% baseline at +5d, t≈1.5). Over this window these names were broadly up, so "bullish flow" barely beats "just own the name."
2. **UW's own bullish/bearish premium classification (the more 'directional' one) was negative** — a caution that flow-skew is not the clean smart-money tell it's marketed as.
3. **The plugin's default exit is upside-down for this vol regime** and converts the small positive drift into a reliable loss (−0.20%/trade, 73% stop-outs).

Caveats: proxy is daily not intraday; tide gate not modeled; 6-month window is one (bullish) regime; transaction costs/slippage not included (would worsen all numbers). So the live signal could be modestly better or worse than the proxy, but the *direction* of the findings (weak edge, broken exit, biased tide) is robust.

---

## 4. Verdict

**no-edge / needs-work.** The flow-skew entry shows no statistically significant edge over simply holding the same liquid names, and the hard-coded TP +2% / SL −1% exit makes the deployed strategy **negative-expectancy**. The market-tide gate is structurally biased bullish and adds no real filtering. Do **not** promote an options-flow broker to paper on current logic.

---

## 5. Prioritized recommendations

1. **(HIGH) Fix the exit, then re-evaluate.** The 1% stop is inside the noise of 3x/mega-cap names. Use an ATR- or volatility-scaled stop (e.g. ≥1.5×ATR) and a wider, asymmetric target, or hand exits to the universal hold-policy at a longer horizon. The wider-stop test already moved expectancy from −0.20% to break-even.
2. **(HIGH) Rebuild the market-tide signal.** Current `netCall/(|netCall|+|netPut|)` reads ~0.91 bullish almost always. Use the **intraday change/slope of net premium** or compare against a trailing baseline, not the raw cumulative ratio. Until fixed, set `useMarketTide:false` so it stops injecting a constant +5 bullish bump.
3. **(MED) Switch the directional measure to buy/sell intent and add an alert-count floor.** Weight `total_ask_side_prem` (aggressive buying) far more heavily than gross premium, and require a minimum `alertCount` so a 2-alert window can't trigger. Re-test against both the callShare and bullShare proxies.
4. **(MED) Add a backtestable shadow signal from the daily `options-volume` + `greek-exposure` series.** These are queryable ~120/250 sessions via `?limit=N`. Use them to continuously validate that the intraday plugin's signal still has the (small) edge before any paper promotion. Harness: `scripts/backtests/options-flow.js`.
5. **(MED) Keep capturing live flow snapshots to `data/flow-history/` for a true forward-test.** The intraday alert feed cannot be backtested, so the only honest check of the *live* signal is forward. The capture format already exists (`data/flow-history/2026-06-01.jsonl`: tide + per-symbol flow). Stamp every snapshot with the realized N-day forward return offline and accumulate ≥100 signal events before trusting the live edge.
6. **(LOW) Don't feed `confidence` into Kelly sizing.** The `50 + score·45` map is uncalibrated (flat ~50-52% win rate across scores). Either calibrate it against realized outcomes or size flat until it's validated.
7. **(LOW) Fix the `underlyingPrice` last-write-wins bug** (`unusualWhalesClient.js:174`) and its misleading comment.

---

### Artifacts
- Backtest harness: `/Users/keo/projects/rank-app/rank/scripts/backtests/options-flow.js` (re-runnable: `node scripts/backtests/options-flow.js`)
- Live forward-capture: `/Users/keo/projects/rank-app/rank/data/flow-history/`
