# Consistency & Edge Plan — 2026-06-03

Source: 13-agent analysis workflow (`consistency-edge-plan`) over all 12 daily reports,
`daily-history.json`, 10 audit reports, 11 strategy-research docs, the broker ledger,
and live trade state. Ideas ranked by **consistency-adjusted return per unit implementation cost**,
then re-checked adversarially (the corrections below override the original pitches).

---

## TL;DR — the loss is mostly bugs, not bad strategy

0 of 3 profitable days since the cohort went live (Jun 1 −$576, Jun 2 −$147, Jun 3 −$1,728).
But of **$2,468 gross losses**, ~85% is two cheap-to-fix **operational** problems:

| Root cause | $ | % of gross loss | Nature |
|---|---:|---:|---|
| Data-feed force-exit (dead feed → forced liquidation at the open) | −1,221 | 49% | **infra bug** |
| Counter-tide chop entries (buying strength into a falling tape) | −876 | 35% | **entry bug** |
| Stop too tight (1% on noisy single names) | −249 | 10% | tuning |
| Misc (intraday data-failure, no-edge EOD, costs) | −122 | 6% | mixed |
| _(wins, for context)_ | +593 | — | — |

**Fixing the top two (both S-cost) removes most of the bleed AND unmasks whether the
dark-pool / insider signals have any real edge** — today their records are confounded by
forced data-failure exits (Insider's only real loss was a data-failure HOOD overnight; its
four same-day closes were +$507 net).

Second structural problem: **no proven edge is actually engaged yet.** The two brokers built
on the only multi-regime-proven factors (trend-following, xs-momentum) are live but run
**un-gated**, and every other active source is graded NOISE.

---

## Edge inventory (what's real)

- **PROVEN (multi-regime, incl. 2022 bear):**
  - `ts-momentum-trend` (trend-following) — QQQ>SMA200→cash: Sharpe 1.30 vs 0.83, MaxDD −13.6% vs −35.6%, Calmar ~3× buy-hold. **Live as Trend Follower.**
  - `xs-momentum` (6-1, top quintile) — Sharpe 0.99, +0.16 Sharpe over a survivorship-matched control, beat all benchmarks in 2022. **Live as Momentum Rotator.**
- **PROVEN-but-bull-only:** `insider-following` at $500k notional + wide stops (+3.3–4.2%/trade). Forward-validate before real capital. **Live as Insider Tracker.**
- **NOISE (no durable edge):** options-flow, dark-pool, technical-indicators, fomo-gap, scanner, ai-momentum/semi-cycle/thematic (all BETA), entropy-gate (currently a no-op), overnight-anomaly (too small after costs).
- **DEFERRED-but-promising:** FRED macro gate (left-tail insurance, free key), UW short-interest (needs backtest), Polygon quality/value screen, LLM-sentiment broker.

---

## Ranked plan

> Cost: S ≈ <2h · M ≈ half-day · L ≈ multi-day. MVP risk = chance of touching the critical
> trading path (`aiTradingEngine.js`, `index.js`, `signalEvaluator.js`).

### DO NOW — three S-cost fixes that remove ~85% of the bleed and engage the proven edge

**A. Data-feed invariant fix** *(idea #2, score 62)* — **the highest-value fix**
- **What:** Never treat a dead price feed as a thesis break. In `signalEvaluator.js` (~:603–619) the engine force-exits purely off a 3-consecutive-failure counter with no freshness check. Change to HOLD + escalate retry + risk alert; add a quote-freshness guard so no SELL is sent on a stale quote (freshness infra already exists: `alpacaStreamClient.getLatestPrice` returns `{age,isStale}`).
- **Cost:** S · MVP risk **med** (`signalEvaluator.js`, `aiTradingEngine.js`).
- **Return:** med / evidence moderate. **Correction:** the "$1,276 saved" is *overstated* — paper orders fill at live market price, so the loss is real overnight beta, not a stale-pricing artifact. The durable win is the **correct invariant** (never exit on a dead feed) **+ unmasking edge measurement** for dark-pool/insider. Must wire a real escalation so positions don't get stuck (the original code's purpose).
- **Overfit:** med. **Fails if:** holding through a continuing gap grows the loss → needs the freshness guard + sane escalation, not hope of mean-reversion.

**B. Counter-tide hard veto** *(idea #4, score 58 — veto half only)*
- **What:** In `optionsFlow.js` (~:77–79) flip the existing −15 soft penalty into `shouldEnter=false` when `tide=bearish && flow=bullish`. Stops the documented −$876 chop category at the source.
- **Cost:** S · MVP risk **low** (plugin-local, no MVP file).
- **Return:** med / evidence moderate. **Correction:** the bundled "widen stop to 2.5–3% ATR as a one-field .md change" is **verifiably false** — options-flow has no such knob; that ATR stop doesn't exist. **Ship the veto; skip the stop tweak.** Tuning a stop on a negative-edge source is overfit hope.
- **Overfit:** med. **Fails if:** the veto rarely binds (slow retirement) or starves the broker to dormancy — which, given options-flow is graded noise, is an acceptable outcome (lean toward retiring it).

**C. Engage the proven low-freq sleeve** *(idea #1, score 82 — best cost:evidence in the set)*
- **What:** Flip `regime.enabled: false → true` on `trend-follower.md` + `momentum-rotator.md` so the (real, wired) entropy gate engages. **Drop the cited FRED dependency — it does not exist in the codebase.**
- **Cost:** S · MVP risk **low** (persona `.md` only).
- **Return:** med / evidence **strong** (the only two proven winners). **Correction:** consistency lift is **lumpy, not smooth** — trend-following only earns its keep on rare crash days (sits in cash otherwise); xs-momentum carries full equity beta (no cash leg). 0 trades on this live system yet — all numbers are backtest/literature.
- **Overfit:** low. **Fails if:** choppy non-trending markets cause whipsaw drag (a string of small losing days) — the exact regime that dominates calendar time.

### BUILD NEXT — M-cost risk controls (after the DO-NOW bundle proves out)

**D. Auto-defund proven-negative sources** *(idea #6, score 52 — part 2 only)*
- `tierPromotion.js`: add a ~40-line "retire/pause" branch when `edge.expectancyLowerCB < 0` after ≥8 trades (`evaluateBroker` already computes it; `pauseSession()` + ledger wiring exist). **Correction:** the bundled per-trade size-throttle is mis-scoped (sizing lives in the executors, not `tierPromotion.js`) — treat that as a separate experiment. The worst offenders (Flow/Volume) are already paused, so this mostly *formalizes* current state. Needs a re-instatement path.

**E. FRED macro regime gate** *(idea #3, score 62)*
- New `fredClient.js` + `macroGate.js` (cache pattern copyable from `entropyGate.js`) + schema fields. Curve slope (T10Y2Y) + HY spread (BAMLH0A0HYM2) → risk-on/off. Free key (not yet in `.env`). **Correction:** the cheap **binary veto** wires at `aiTradingEngine.js:3331`; the valuable **graduated 1.0→0.25 size scalar** lives in `orderExecutor.executeEntry` (MVP Tier-1) — score the M/L version, not the deceptive binary one. Cuts the left tail, barely moves median days.

**F. Vol-target / inverse-vol sizing** *(idea #5, score 58)*
- One branch in the `simulatedExecutor.js` sizing switch + schema. **Correction / blocker:** the proven plugins attach a **hardcoded `atr = price*0.02`** — with identical vol on every name, vol-targeting is a **silent no-op**. Must first plumb real ATR (`indicators.atr.value`) into `trendFollowing.js` + `xsMomentum.js`. Benefits multi-asset brokers (xs-momentum) only; near-zero for single-name/leveraged pairs.

### SKIP / EXPERIMENT-ONLY

- **#7 Chop/ATR entry filter** (score 42, overfit **high**): "ATR already computed" is false (placeholder), knobs aren't schema-mapped → true M not S. Post-hoc loss-bucketing with no out-of-sample test; chop and breakout-fuel look identical ex-ante. **Free alternative:** the zero-code `regime.enabled` flip (idea C) isolates whether regime-gating alone helps — A/B that first.
- **#8 Insider Tracker tweaks** (score 22, **SKIP**): stop-widen + $500k floor are already shipped; leverage-unify is a verified no-op (no leveraged ETFs in its watchlist); **forced same-day exits would destroy the proven multi-day edge.** Salvage only a cheap `>$5` min-price + per-name notional cap.

### NOT AVAILABLE CHEAPLY (capability gaps)

- **Market-neutral long/short overlay** — the system is **long-only**; `simulatedExecutor` hardcodes `side:'long'`. Shorting (to profit on down days) is an **L build**. Noted as the real structural answer to "profit on down days," but not a quick enable.
- **Portfolio-level capital allocation by edge/correlation** — doesn't exist (fixed $100k silos); **L build.**

---

## Recommended sequence

1. **DO-NOW bundle (A + B + C)** — all S-cost, removes ~85% of the bleed, unmasks edge, engages the proven sleeve. Lowest regret.
2. Let it run a few sessions; re-measure per-source expectancy now that data-failure exits no longer confound it.
3. **BUILD-NEXT (D → E → F)** as risk controls once there's clean data.
4. Defer the L-builds (shorts, portfolio allocation) until a positive-edge engine is confirmed live.
