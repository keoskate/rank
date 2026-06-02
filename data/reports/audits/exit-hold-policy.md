# Audit: Exit & Hold-Policy Logic (`exit-hold-policy`)

Scope: `server/signalEvaluator.js` (`evaluateExit` + max-hold-days block), strategy
plugins' `holdPolicy` exports (`server/strategies/insiderFollowing.js`,
`server/strategies/darkPool.js`), and the WS fast-path exit in
`server/aiTradingEngine.js`. Read-only analysis + a real exit-sensitivity grid
backtest on the multi-day insider signal.

---

## What it does

### Exit pipeline (`signalEvaluator.evaluateExit`, lines 90–578)

Order of operations per evaluation tick (5-min cadence):

1. **Fetch candles** — needs `candles.length >= 50` 5-min bars or returns
   `shouldExit:false` (line 112). PnL itself comes from `position.unrealizedPnLPercent`
   (set by broker sync / WS fast-path), not from candles.
2. **Hard stop-loss (pre-hold-gate)** — `pnlPercent <= -stopLossPercent` fires
   immediately, bypassing min-hold (lines 141–162).
3. **Min-hold gate** — `minHoldMinutes` (default 30, counter-trend 15); returns
   `shouldExit:false` if not reached (lines 167–195).
4. **Max-hold-days** — multi-day only; force-exit at `holdDays >= maxHoldDays`
   (lines 200–224).
5. **Scored exits** — accumulate `exitScore` / `criticalExitScore`:
   take-profit (30/100), stop-loss (+100 again), trailing stop (35), RSI
   overbought (20), EOD (+100/+50), low-volume distribution (10), counter-trend
   pressure (10/10/15), AI-discretion holds (−20/−15).
6. **Trend dampening** — non-critical score scaled by `trendDampeningFactor`
   (default 0.4) when profitable + ADX trending + regime-aligned (lines 427–453).
7. **Min-profit protection** — if `0 < pnl < minProfitForExitPercent`, threshold
   raised to 95; else 70 (lines 459–471).
8. **Exit if `exitScore >= effectiveExitThreshold`.**

A **WS fast-path** (`aiTradingEngine.js` 3955–4026) independently fires hard
stop-loss and trailing stop on every real-time tick, outside `evaluateExit`.

### Hold policies

| Plugin | horizon | TP% | SL% | maxHoldDays | minHoldMin | exitBeforeClose |
|---|---|---|---|---|---|---|
| insiderFollowing | multi-day | 8 | 4 | 10 | 60 | false |
| darkPool | multi-day | 4 | 2 | 5 | 30 | false |
| intraday plugins | (none) | engine default 2 | 1 | — | 30 | true |

`brokerSchema.js:443–453` merges `holdPolicy` into `session.config`, so multi-day
plugins disable EOD and use day-scale max-hold. Intraday plugins inherit engine
defaults.

---

## Audit findings

### HIGH — Stop-loss leverage scaling is inconsistent between the two exit paths
- `evaluateExit` uses **raw** `stopLossPercent` (line 139: `cfg.stopLossPercent || 1`)
  with no leverage multiply.
- The WS fast-path uses **leverage-scaled** stop (lines 3974–3977:
  `Math.max(rawStopLoss, rawStopLoss * leverage)`).
- Take-profit in `evaluateExit` IS leverage-scaled (lines 233–236), but stop is not.

Result for a 3x ETF with `stopLossPercent:1`: the slow path stops at −1%, the WS
path stops at −3%. Whichever fires first wins, so the **effective stop is the
tighter −1%** in the slow path — defeating the WS path's intent and making the
stop asymmetric vs the leverage-scaled take-profit. The exit behavior depends on
which evaluator happens to run first, which is non-deterministic.

### HIGH — Tight stops are mis-tuned for the multi-day horizon (confirmed by backtest)
The dark-pool policy (SL 2%, TP 4%) and insider tight-stop variants stop out of
the very drift the signal is supposed to capture. Backtest (below): SL 2% →
**−0.15% expectancy, 31% win, 45/65 trades stopped**. Widening to SL 6% →
**+4.38%, 80% win**. This is a parameter bug, not just a tuning preference: a
2% stop on a daily-bar multi-day thesis is inside one day's noise band for the
small/mid-caps insiders buy.

### MED — `maxHoldDays` can never fire intraday-only and depends on a live tick
`maxHoldDays` (line 200) is only checked inside `evaluateExit`, which requires
50 fresh 5-min candles and an un-stale data feed. If a position's symbol stops
streaming (delisted, halted, illiquid) the eval throws and only the
`EXIT_EVAL_MAX_FAILURES` force-exit (line 557) saves it. There is no calendar
timer; max-hold is best-effort, gated on data availability. A multi-day position
in an illiquid name can outlive its `maxHoldDays` until the failure counter trips.

### MED — Trailing stop double-implemented with different semantics
Two separate trailing stops exist:
- `evaluateExit` (lines 293–321): trail = "% of gains to lock in," only arms after
  `trailingStopMinProfitPercent` (default 2%), worth 35 pts (non-guaranteed unless
  combined).
- WS fast-path (lines 4002–4025): trail = "% drop from high-water-mark," arms
  immediately, fires unconditionally.

Same config key `trailingStopPercent` feeds **two different formulas**. A value of
`5` means "lock 5% of gains" in one path and "exit on 5% drop from high" in the
other. These can disagree badly. The backtest shows a 5%-from-high trail is
actively harmful on the multi-day signal (+0.43% vs +2.77% un-trailed; 27/65
trailed out early).

### MED — Counter-trend pressure has no notion of multi-day horizon
Lines 402–421 add up to +35 exit pressure for counter-trend positions and even
set `exitReason = 'Taking quick profit on counter-trend trade'` at +0.5% profit.
For a multi-day swing this is wrong: a +0.5% "scalp" exit directly contradicts the
hold thesis. Multi-day plugins don't trade leveraged ETF pairs today (so `etfType`
is usually `neutral` and this is skipped), but the code has no `holdHorizon` guard —
if a multi-day broker ever trades a mapped ETF, it would scalp out on day one.

### LOW — EOD window only protects during RTH; gap-risk on overnight holds is unmanaged
EOD exits require `minutesUntilClose > 0` (lines 353–366). After the close
`getMinutesUntilClose()` is negative, so nothing fires. For multi-day plugins this
is intentional (`exitBeforeClose:false`), but it means stop-loss protection is
**blind to overnight gaps** — the hard stop only re-checks when 5-min candles
resume next session, by which point price has already gapped through the stop. The
backtest's intrabar stop is therefore optimistic vs production (production fills
worse on gaps).

### LOW — `entryTime` undefined fallback silently disables the hold gate
Lines 173–184: if `entryTime` is missing it defaults to `Date.now()`, which makes
`holdMinutes ≈ 0` and **bypasses min-hold for that tick**. It logs a risk event but
the position becomes immediately eligible to exit on any weak signal. Rare, but a
position re-hydrated from disk without `entryTime` loses hold protection.

### LOW — Partial-exit quantity mutated before broker confirms
`orderExecutor.js:917` sets `position.quantity = originalQuantity - quantity`
in-memory immediately after a partial sell, before `syncPortfolio` reflects the
real broker quantity. A concurrent eval between the partial fill and the next sync
sees the optimistic remaining quantity. Low impact (sync overwrites within seconds)
but a transient inconsistency.

### Observations (not bugs)
- Stop-loss is correctly placed before the min-hold gate (good — a falling
  position is never trapped by min-hold).
- `criticalExitScore` correctly shields stop/trailing/EOD/TP from dampening.
- Force-exit on `EXIT_EVAL_MAX_FAILURES` is a sound stuck-position backstop.

---

## Backtest: method & results

**Script:** `/Users/keo/projects/rank-app/rank/scripts/backtests/exit-hold-policy.js`

**Signal:** insider officer/director open-market purchases (code `P`, ≥ $50k) —
the canonical multi-day entry, and the only one with backtestable history.
**Point-in-time, no look-ahead:** enter at the *next* session's open after the
filing date. Walk daily bars day-by-day applying each exit profile with
**conservative intrabar ordering** (stop checked before target when a bar
straddles both). Baseline = identical exit grid on evenly-spaced random entry
days on the same tickers, so the `edge_vs_base` column isolates the exit profile's
contribution net of the signal.

**Data limitation (important):** the UW insider feed is **shallow in practice** —
despite the docstring claiming "deep history," it only reaches ~3 weeks back
before pagination exhausts / 429s. Entries newer than ~16 calendar days have no
full forward window, so the usable sample is small. The run below used 25 tickers
/ 65 signal entries dated 2026-05-12 → 2026-05-15. A 27-trade run on an even more
recent window produced the same ordering. **Profile rankings are a paired
comparison (every profile runs on the identical entry set), so the relative
ordering is robust even though absolute expectancy has wide error bars at n=65.**
`hold:15/20` profiles are biased low here because the forward window truncates at
"today."

### Grid results (n=65 signal entries, paired)

```
tp/sl/hold/minH/trail       n      exp   win  sharpe  tgt/stp/trl/tim   edge_vs_base
8/4/10/0/0   (insider def) 65   +2.77%  62%   0.52   30/20/0/15          +1.53%
4/2/5/0/0    (darkpool def)65   -0.15%  31%  -0.06   20/45/0/0           +0.04%
6/3/10/0/0                 65   +0.82%  43%   0.19   24/32/0/9           +0.77%
10/5/10/0/0                65   +4.22%  72%   0.72   26/11/0/28          +2.34%
12/6/15/0/0  (bias low)    65   +5.22%  78%   0.82   25/7/0/33           +2.75%
8/4/5/0/0                  65   +2.18%  63%   0.45   19/20/0/26          +1.20%
8/4/20/0/0   (bias low)    65   +2.97%  65%   0.54   33/23/0/9           +1.62%
8/6/10/0/0                 65   +4.38%  80%   0.91   37/6/0/22           +2.61%
8/3/10/0/0                 65   +1.42%  43%   0.28   22/32/0/11          +1.03%
8/4/10/1/0   (1d min-hold) 65   +3.07%  66%   0.60   30/17/0/18          +1.52%
8/4/10/0/5   (5% trail)    65   +0.43%  40%   0.10   14/17/27/7          +0.01%
99/4/10/0/0  (stop-only)   65   +2.91%  58%   0.41   0/22/0/43           +0.73%
8/99/10/0/0  (target-only) 65   +4.88%  83%   1.14   39/0/0/26          +2.36%
99/99/5/0/0  (pure time 5d)65   +3.94%  80%   0.69   0/0/0/65           +1.99%
99/99/10/0/0 (pure time10d)65   +5.56%  78%   0.76   0/0/0/65           +1.86%
```

### What the numbers say
1. **Stops dominate the outcome; tighter is worse.** Monotonic: SL2 −0.15% →
   SL3 +1.42% → SL4 +2.77% → SL6 +4.38%. The dark-pool default (SL2) is
   *net-negative* and stops out 69% of trades. The signal drift lives outside a
   2–3% band.
2. **A stop costs more edge than it saves.** Target-only (no stop, tp8/sl99) has
   the best Sharpe (**1.14**) and 83% win — removing the stop entirely beat every
   stopped variant on risk-adjusted return *on this signal*. Caveat: this ignores
   tail/gap risk that daily-bar backtests understate, so "no stop" is not a live
   recommendation — but it proves the stop is currently set far too tight.
3. **Trailing stop is harmful here.** 5%-from-high trail dropped expectancy to
   +0.43% by exiting 27/65 trades early. Do not enable trailing for multi-day.
4. **Min-hold (1 day) is neutral-to-slightly-positive** (+3.07 vs +2.77) and
   reduces day-1 stop-outs (20→17). Cheap insurance.
5. **Longer time-stop helps** (hold 5 → 10 raises both time-exit capture and
   expectancy), consistent with a multi-session drift.

---

## Verdict

**promising — exits work mechanically but the multi-day stop/TP defaults are
mis-tuned, and one HIGH leverage-scaling inconsistency can make stops behave
non-deterministically.** The exit state machine itself is sound (ordering,
critical-score shielding, force-exit backstop). The problems are parameter
choices (stops too tight for the horizon) and two code-level inconsistencies
(stop leverage scaling differs between paths; trailing-stop double-defined with
conflicting formulas).

---

## Prioritized recommendations

### Recommended default exit params per horizon

| Horizon | TP% | SL% | maxHoldDays | minHold | trailing | exitBeforeClose |
|---|---|---|---|---|---|---|
| **Multi-day (insider)** | 8–10 | **6** | 10 | 60 min (≈1 day) | **off** | false |
| **Multi-day (dark-pool)** | **6** (was 4) | **4** (was 2) | 5 | 30 min | off | false |
| **Intraday/leveraged** | 2×lev | 1×lev (scaled) | n/a | 30 min | optional | true |

Rationale: SL6/TP8 gave +4.38% exp, 80% win, best Sharpe (0.91) among *stopped*
profiles and edge +2.61% — it keeps risk control while letting the drift breathe.
The current dark-pool SL2/TP4 is net-negative and must be widened.

1. **[HIGH] Widen multi-day stops.** Change `darkPool.holdPolicy` SL 2→4, TP 4→6;
   keep `insiderFollowing` TP8 but widen SL 4→6. (Config only, in plugin
   `holdPolicy` — out of this audit's write scope; flag for owner.)
2. **[HIGH] Make stop-loss leverage scaling consistent.** In `evaluateExit`
   compute `stopLossPercent` with the same `Math.max(raw, raw*leverage)` the WS
   path uses (line 139 vs 3974–3977), so the two evaluators agree.
3. **[MED] Disable trailing stop for multi-day horizons** (or gate it on
   `holdHorizon !== 'multi-day'`). Backtest shows it strictly hurts the drift.
4. **[MED] Unify the two trailing-stop formulas** behind one config semantic;
   document whether `trailingStopPercent` means "% of gains locked" or "% drop
   from high" — today it means both depending on path.
5. **[MED] Add a calendar-based max-hold backstop** independent of candle
   availability, so an illiquid multi-day position can't outlive `maxHoldDays`
   waiting on the data-failure counter.
6. **[MED] Guard counter-trend quick-scalp pressure with `holdHorizon`** so a
   multi-day broker never scalps out at +0.5%.
7. **[LOW] Persist `entryTime` on rehydration**; don't silently default to
   `Date.now()` (disables the hold gate).
8. **[LOW] Re-run this grid once UW insider history deepens** (or feed it a
   different multi-day signal with real depth). n=65 has wide error bars; the
   *ordering* is trustworthy, the absolute expectancies are not.
