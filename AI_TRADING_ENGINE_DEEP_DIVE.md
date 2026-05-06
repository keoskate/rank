# AI Trading Engine: Complete System Reference & Critical Analysis

> Generated 2026-04-19. Covers the full decision pipeline, every signal, threshold, and config knob — plus identified weak spots and missed opportunities.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [The Tick Loop: What Fires When](#2-the-tick-loop)
3. [Sentiment Gating (SOXX)](#3-sentiment-gating)
4. [Market Phase Windows](#4-market-phase-windows)
5. [Entry Evaluation](#5-entry-evaluation)
6. [Exit Evaluation](#6-exit-evaluation)
7. [Position Sizing & Execution](#7-position-sizing--execution)
8. [WebSocket Fast-Path Exits](#8-websocket-fast-path-exits)
9. [Cross-Session Coordination](#9-cross-session-coordination)
10. [Circuit Breakers & Risk Limits](#10-circuit-breakers--risk-limits)
11. [Config Knobs Reference](#11-config-knobs-reference)
12. [Strategy Presets](#12-strategy-presets)
13. [Technical Indicators Computed](#13-technical-indicators-computed)
14. [Decision Trees (Visual)](#14-decision-trees)
15. [CRITICAL: Weak Spots & Lost Opportunity](#15-critical-weak-spots--lost-opportunity)
16. [Recommended Fixes (Priority Order)](#16-recommended-fixes)

---

## 1. System Architecture

```
                        Alpaca Paper Trading API
                        /          |           \
                   Orders      Positions      Account
                      \           |            /
                       server/alpacaClient.js
                              |
        +---------+-----------+-----------+----------+
        |         |           |           |          |
   aiTradingEngine.js   semiconductorSentiment.js   alpacaStreamClient.js
   (4700+ lines)        (SOXX gating)               (WebSocket prices)
        |         |           |
   technicalIndicatorsService.js    polygonClient.js
   (RSI, MACD, BB, etc.)           (5-min candles)
        |
   websocketServer.js → React Frontend (Socket.IO)
```

**Key files:**
- `server/aiTradingEngine.js` — Core brain. Entry/exit decisions, execution, risk management
- `server/semiconductorSentiment.js` — SOXX sentiment engine for SOXL/SOXS gating
- `server/alpacaStreamClient.js` — Real-time WebSocket price stream (NEW)
- `server/technicalIndicatorsService.js` — 9 technical indicators
- `server/polygonClient.js` — Historical candle data from Polygon
- `server/alpacaClient.js` — Order placement, position queries, account info
- `data/ai-sessions.json` — All session state (no database)

---

## 2. The Tick Loop

Each running session has its own polling loop at adaptive intervals:

| Condition | Tick Rate | Why |
|-----------|-----------|-----|
| Holding leveraged ETFs OR within 30 min of close | **3 seconds** | Maximum vigilance |
| Holding non-leveraged positions | **5 seconds** | Active monitoring |
| No positions (scanning) | **10 seconds** | Conserve API calls |

**Every tick runs this sequence:**

```
tradingTick()
  1. Check market hours → skip if closed (stocks only)
  2. Check circuit breaker → skip if tripped
  3. Stale position guard → force-exit leveraged ETFs held across calendar days
  4. End-of-day exit → force-exit leveraged positions 15 min before close
  5. analyzeAndTrade(sessionId) → THE MAIN BRAIN
  6. Schedule next tick (adaptive rate)
```

### analyzeAndTrade() — The Main Brain

```
analyzeAndTrade(sessionId)
  1. Sync portfolio from Alpaca (get real positions)
  2. Sentiment analysis (SOXX or regime reference)
     - Compute direction + confidence
     - Check market gate (bullish/bearish/any)
     - Auto-switch sessions if sentiment flips
  3. Exit evaluation for all held positions
     - Check SOXS decay limits
     - Check phase-based force exits
     - Run full evaluateExit() with indicators
  4. Entry evaluation for watchlist symbols
     - Filter: already held, opposite ETF, locks, cooldowns
     - Evaluate each candidate
     - Sort by confidence, execute top N
```

---

## 3. Sentiment Gating

### How SOXX Sentiment Works

For semiconductor sessions (SOXL/SOXS), the engine fetches **SOXX 5-minute candles** with a 72-hour lookback and computes:

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| Intraday change (open → current) | 30% | Today's direction |
| Rolling momentum (75-min EMA) | 25% | Recent trend slope |
| Reversal detection (position in day's range) | 25% | Top/bottom of range |
| Strong move confirmation | 20% | Breakout magnitude |

These produce:
- **Direction**: bullish / bearish / neutral
- **Confidence**: 0-100% (starts at 50, signals add/subtract)
- **Recommended symbol**: SOXL (bullish), SOXS (bearish), CASH (neutral)

### Dynamic Thresholds

Thresholds scale with volatility:
```
baseEntryThreshold = 0.35%
scaled = 0.35% * (1 + volatility * 1.2 * 100)
entryThreshold = clamp(scaled, 0.15%, 1.5%)
exitThreshold = 0.6 * entryThreshold
switchThreshold = 1.5 * entryThreshold
```

### Market Gate Config

| `marketGate` value | Behavior |
|-------------------|----------|
| `'bullish'` | Only enter when SOXX sentiment is bullish |
| `'bearish'` | Only enter when SOXX sentiment is bearish |
| `'any'` | Enter in either direction |
| `null` | No sentiment gating |

When gated out, the engine still evaluates exits but blocks new entries. It can auto-pause the gated session and auto-resume a complementary one (e.g., SOXL paused → SOXS resumed).

### Regime Gate (Non-Semiconductor)

For sessions like QBTX/QBTZ, a similar gate uses a reference symbol (e.g., QQQ) instead of SOXX. Same mechanics, different data source.

### Regime Hysteresis

To prevent whipsaw from noisy regime changes:
- Regime must persist for `regimeHysteresisMinutes` (default 10) before confirming
- Uses stabilized regime for all entry/exit decisions
- Raw regime used only for detection

---

## 4. Market Phase Windows

| Phase | Time (ET) | Can Enter? | Can Exit? | Notes |
|-------|-----------|------------|-----------|-------|
| Pre-market | 4:00-9:30 | No | No | |
| Open | 9:30-9:45 | No | No | |
| Settle | 9:45-10:00 | No | No | Volatility settling |
| **Active** | **10:00-15:30** | **Yes** | **Yes** | Main trading window |
| Wind-down | 15:30-15:55 | No | Yes | Exit only |
| Close | 15:55-16:00 | No | **Force exit** | Leveraged ETFs |
| After hours | 16:00-20:00 | No | No | |

**Special rules:**
- SOXS: No new positions after 2:30 PM ET (decay protection)
- SOXS in wind-down: Force exit to avoid overnight decay

---

## 5. Entry Evaluation

### What The Machine Sees

1. **Real-time price** — WebSocket if fresh (<15s), else latest 5-min candle close
2. **24 hours of 5-minute candles** (300+ bars) from Polygon
3. **9 technical indicators** computed from those candles (see [Section 13](#13-technical-indicators-computed))
4. **Market regime** — bull/bear/sideways from sentiment or technicals
5. **SOXX sentiment** — direction + confidence + phase (if semiconductor mode)
6. **Options flow** — CheddarFlow data if available and <24h old
7. **Time of day** — for time-based confidence adjustments
8. **All other sessions' positions** — for cross-session blocking
9. **PDT status** — if live trading, checks day trade count

### Guards (Checked Before Any Analysis)

| Guard | Blocks Entry If... |
|-------|--------------------|
| Position exists | Already holding this symbol |
| Opposite ETF held | SOXL held anywhere → can't buy SOXS |
| Entry lock | Another session is evaluating this symbol (30s timeout) |
| Cooldown | Sold this symbol within last 5 minutes |
| Max positions | Session already at `maxPositions` limit |
| Sentiment gate | SOXX direction doesn't match `marketGate` |
| Phase gate | Not in ACTIVE market phase |
| SOXS time gate | After 2:30 PM ET for SOXS |

### Strategy Signals

| Strategy | Condition | Points |
|----------|-----------|--------|
| `dip` | RSI < 45 AND below VWAP | +20 |
| `momentum` | RSI 50-65 (rising from oversold) | +20 |
| `balanced` | Either dip OR momentum bounce (RSI 30-40 + MACD bullish + volume) | +20 |

### Confirming Signals

| Signal | Weight | Condition |
|--------|--------|-----------|
| Volume spike | +15 | Volume > 1.5x 20-bar average |
| RSI signal | +12 | Bullish divergence or RSI < 40 |
| MACD bullish | +8 | Positive histogram or crossover |
| Bollinger oversold | +10 | %B < 0.2 (below lower band) |
| Regime-aligned | +10 | e.g., bullish ETF in bull regime |
| Counter-trend penalty | -20 | e.g., bullish ETF in bear regime |
| Morning momentum (10-11 AM) | +5 | Momentum strategy only |
| Afternoon dip (2-3:30 PM) | +5 | Dip/conservative strategy only |
| Options flow aligned | +10 | CheddarFlow confirms direction |
| Options flow opposing | -15 | CheddarFlow contradicts direction |

### Confidence Calculation

```
confidence = 50 + sum(signal weights)
capped at 95

Counter-trend: requires (minSignalsRequired + 1) signals
```

### Final Entry Decision

```
shouldEnter =
  strategyMatch (RSI/VWAP condition met)
  AND signalCount >= minSignalsRequired (default 2)
  AND confidence >= minConfidence (default 70)
```

---

## 6. Exit Evaluation

### Exit Scoring System

Each signal contributes points toward an exit. Threshold = **70 points** to exit.

#### Critical Exits (Never Dampened)

| Signal | Points | Condition |
|--------|--------|-----------|
| **Stop loss** | +100 | P&L% <= -stopLossPercent (guaranteed exit) |
| **Profit target** | +100 | P&L% >= takeProfitPercent |
| **Aggressive scalp** | +30 | Quick profit on partial position |
| **Trailing stop** | +35 | Price dropped from high water mark |
| **End of day** | +100 | Within 15 min of close for leveraged |

#### Non-Critical Exits (Subject to Dampening)

| Signal | Points | Condition |
|--------|--------|-----------|
| RSI overbought | +20 | RSI > 70 |
| MACD bearish | +10 | Bearish histogram |
| Volume declining | +10 | Volume < 0.7x average |
| Counter-trend + losing | +10-15 | Wrong side of regime |

### Minimum Hold Time

- **30 minutes** normally (configurable)
- **15 minutes** for counter-trend trades
- Engine will NOT exit before this regardless of signals

### Trailing Stop Logic

```
Activation: position gain >= trailingStopMinProfitPercent (default 2%)

Once active:
  lockedGain = gain * trailingStopPercent (e.g., 50%)
  triggerPrice = highWaterMark - lockedGain
  If price <= triggerPrice → exit

Example: Entry $100, high $105 (+5%), trailing 50%
  Locked: 50% of $5 = $2.50
  Trigger: $105 - $2.50 = $102.50
  Exit if price drops to $102.50
```

### Trend Dampening

When a position is profitable, in a strong trend (ADX > 25), and regime-aligned:
- Non-critical exit signals are multiplied by 0.2-0.7x
- This lets winners run through oscillator noise
- Critical exits (stop loss, profit target, trailing stop) are never dampened

### Minimum Profit Protection

If profit is between 0% and 0.5% (scaled by leverage):
- Exit threshold jumps from 70 → 95
- Prevents exiting with tiny gains on weak signals

### Partial Exit Support

If `partialExitEnabled` and profit target hit:
- Sell `partialExitPercent` (default 50%) of position
- Keep remainder running with trailing stop
- No cooldown set (can re-add on dip)

---

## 7. Position Sizing & Execution

### How Many Shares To Buy

1. **Portfolio value** = cash + positions, capped at `allocatedCapital`
2. **Confidence scaling**: Maps confidence 60-90 to position size 8%-20%
   - 60% confidence → base 8% of portfolio
   - 90% confidence → max 20% of portfolio
3. **ATR-based risk sizing**: `riskAmount / (price - stopLoss)` = shares
4. **Cap checks applied in order:**
   - `maxPositionSizePercent` per position (default 10%)
   - `maxPositionSize` hard dollar cap
   - Aggregate exposure ≤ 25% per symbol across ALL sessions
   - Total portfolio exposure ≤ 40%
5. **Buying power check** against Alpaca account
6. **Market order** placed, polls for fill price up to 5 seconds

### Leverage Scaling

For 3x ETFs, stop-loss and take-profit targets are automatically scaled:
```
stopLossPercent = max(raw, raw * leverage)   // 1% → 3% for 3x
takeProfitPercent = max(raw, raw * leverage)  // 2% → 6% for 3x
```

---

## 8. WebSocket Fast-Path Exits

Independent of the tick loop, every real-time Alpaca trade triggers:

```
fastPathExitCheck(symbol, wsPrice):
  For each running session holding this symbol:
    1. Update position.currentPrice, unrealizedPnL, highWaterMark
    2. Hard stop-loss: pnlPercent <= -stopLossPercent → executeExit()
    3. Trailing stop: price dropped trailingStopPercent from high → executeExit()
```

- Fires in **sub-millisecond** (no candle fetch, no indicators)
- Uses same `globalExitLocks` as polling — no double-exits
- If WS is down, degrades to existing polling behavior
- Stale threshold: 15 seconds (falls back to candle close after that)

---

## 9. Cross-Session Coordination

| Mechanism | Timeout | Purpose |
|-----------|---------|---------|
| Entry locks | 30s | Prevents two sessions evaluating same symbol simultaneously |
| Exit locks | 5s | Prevents two sessions selling same Alpaca position |
| ETF pair guard | — | Can't hold SOXL and SOXS at the same time |
| Aggregate exposure cap | — | All sessions combined ≤ 25% per symbol |
| Sentiment auto-switch | 60s cooldown | SOXL paused → SOXS resumed when sentiment flips |

### Portfolio Sync & Cross-Contamination Prevention

Each session only manages positions for symbols in its own watchlist (unless `manageAllPositions` is set). During sync:
- Local state (entryTime, highWaterMark) is preserved
- Price and market value are refreshed from Alpaca
- Positions not in watchlist are ignored

---

## 10. Circuit Breakers & Risk Limits

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Consecutive losses | ≥ 3 (default) | Pause session, require manual resume |
| Daily loss | ≥ 5% of portfolio (default) | Pause session |
| Daily profit target | Configurable (e.g., 2%) | Close all positions, pause until next day |
| Stale leveraged position | Held across calendar days | Force exit |

---

## 11. Config Knobs Reference

### Entry Parameters

| Parameter | Default | Effect of Raising | Effect of Lowering |
|-----------|---------|-------------------|-------------------|
| `minConfidence` | 70 | Fewer, higher-quality entries | More entries, more noise |
| `minSignalsRequired` | 2 | Fewer false entries | More trades |
| `entryStrategy` | `'balanced'` | — | — |
| `requireVolumeSpike` | true | Only enter on volume | More entries without volume |
| `requireTrendAlignment` | true | Trend-following only | Counter-trend allowed |

### Exit Parameters

| Parameter | Default | Effect of Raising | Effect of Lowering |
|-----------|---------|-------------------|-------------------|
| `takeProfitPercent` | 2% (×leverage) | Hold for bigger wins | Quick scalps |
| `stopLossPercent` | 1% (×leverage) | Wider stops, fewer stop-outs | Tighter risk |
| `trailingStopPercent` | 0 (OFF) | Locks more profit when enabled | Lets profits run further |
| `trailingStopMinProfitPercent` | 2% | Activates later | Activates sooner |
| `minHoldMinutes` | 30 | Prevents whipsaw, delays exits | Faster reactions |
| `counterTrendMinHoldMinutes` | 15 | — | — |

### Position Sizing

| Parameter | Default | Notes |
|-----------|---------|-------|
| `maxPositions` | 5 | Per session |
| `maxPositionSizePercent` | 10% | Per position |
| `maxPositionSize` | — | Hard dollar cap if set |
| `riskPerTradePercent` | 2% | ATR-based sizing |
| `allocatedCapital` | $10,000 | Caps portfolio value for sizing |

### Risk Management

| Parameter | Default | Notes |
|-----------|---------|-------|
| `dailyLossLimitPercent` | 5% | Circuit breaker |
| `maxConsecutiveLosses` | 3 | Circuit breaker |
| `dailyProfitTargetPercent` | — | Optional, pauses on target |

### Sentiment & Regime

| Parameter | Default | Notes |
|-----------|---------|-------|
| `semiconductorMode` | false | Enable SOXX gating |
| `marketGate` | null | `'bullish'` / `'bearish'` / `'any'` |
| `marketGateMinConfidence` | 60 | Min sentiment confidence to trade |
| `regimeGateEnabled` | false | Non-semiconductor regime gating |
| `regimeReferenceSymbol` | — | e.g., QQQ for quantum ETFs |
| `regimeHysteresisMinutes` | 10 | Regime flip-flop prevention |

---

## 12. Strategy Presets

### SOXL_MOMENTUM
- Bullish semiconductor trades, `marketGate='bullish'`
- 3% take profit (→ 9% after leverage scaling), 1.5% stop (→ 4.5%)
- AI sentiment enabled, autoTrade: false

### SOXS_HEDGE
- Bearish hedge, `marketGate='bearish'`
- 2% take profit (→ 6%), 1% stop (→ 3%)
- Max hold: 2 hours (decay protection), autoTrade: false

### SOXL_SOXS_COMBO
- Dynamic both directions, `marketGate='any'`
- AI sentiment enabled, auto-switches between bull/bear sessions

### QBTX_QBTZ_COMBO
- Quantum ETF, `regimeGateEnabled=true`, reference: QQQ
- 2.5% take profit (→ 7.5%), 1% stop (→ 3%)

### INVESTIGATE_TRADER
- General-purpose, no special gating
- **Only preset with trailing stops enabled** (1%)

---

## 13. Technical Indicators Computed

`technicalIndicatorsService.getAllIndicators()` computes from 50+ candles:

| Indicator | Period | Entry Use | Exit Use |
|-----------|--------|-----------|----------|
| RSI | 14 | Oversold (<30) / Momentum zone (50-65) | Overbought (>70) |
| MACD | 12-26-9 | Bullish histogram/crossover | Bearish momentum |
| Bollinger Bands | 20, 2σ | %B < 0.2 (oversold) | Bandwidth squeeze |
| ATR | 14 | Stop placement, volatility sizing | — |
| EMA | 9, 21, 50, 200 | Trend direction (golden cross) | — |
| VWAP | Full series | Below VWAP = dip opportunity | — |
| Stochastic | 14-3 | Oversold %K < 20 | Overbought %K > 80 |
| ADX | 14 | Trend strength (>25 = trending) | Dampening factor |
| Volume Ratio | vs 20-bar avg | Spike (>1.5x) confirms move | Declining (<0.7x) = distribution |

---

## 14. Decision Trees

### Entry Decision Tree

```
Symbol on watchlist
  |
  +-- Already holding? -----> SKIP
  +-- Opposite ETF held? ---> SKIP
  +-- Entry lock held? -----> SKIP
  +-- Cooldown (5 min)? ----> SKIP
  +-- Max positions? -------> SKIP
  |
  +-- Semiconductor mode?
  |     +-- Sentiment gate blocked? --> SKIP (check exits only)
  |     +-- Not ACTIVE phase? -------> SKIP
  |     +-- SOXS after 2:30 PM? ----> SKIP
  |
  +-- Regime gate mode?
  |     +-- Regime blocked? ---------> SKIP (check exits only)
  |
  +-- Fetch 24h of 5-min candles (Polygon)
  +-- Compute 9 indicators
  +-- Get real-time price (WebSocket or candle close)
  |
  +-- Apply strategy rules (dip/momentum/balanced)
  +-- Stack confirming signals
  +-- Adjust for regime/time-of-day/options flow
  +-- Calculate confidence (50 + signal weights, cap 95)
  |
  +-- strategyMatch? -------> NO: SKIP
  +-- signals >= required? -> NO: SKIP
  +-- confidence >= min? ----> NO: SKIP
  |
  YES --> EXECUTE ENTRY (position sizing → market order)
```

### Exit Decision Tree

```
Position held in session
  |
  +-- Hold time < minimum (30/15 min)? --> FORCE HOLD (return early)
  |
  +-- Semiconductor special exits?
  |     +-- SOXS max hold exceeded? ---> EXIT
  |     +-- Force-exit phase? ----------> EXIT
  |
  +-- Fetch candles + compute indicators
  +-- Get real-time price
  |
  +-- Score exit signals:
  |     Stop loss ---------> +100 (guaranteed)
  |     Profit target -----> +100
  |     Trailing stop -----> +35
  |     EOD approaching ---> +100
  |     RSI overbought ----> +20
  |     MACD bearish ------> +10
  |     Volume declining --> +10
  |     Counter-trend -----> +10-15
  |
  +-- Apply trend dampening (if profitable + ADX trending + regime aligned)
  +-- Apply min profit protection (tiny gains → threshold 95)
  |
  +-- exitScore >= threshold (70)? --> EXIT
  |
  NO --> HOLD
```

---

## 15. CRITICAL: Weak Spots & Lost Opportunity

### BUG: Stop Loss Bypassed by Minimum Hold Time

**Severity: CRITICAL**
**File:** `aiTradingEngine.js` lines 3327-3336

The minimum hold time check returns `{ shouldExit: false }` BEFORE the stop loss check runs. A position can breach its stop loss within the first 30 minutes and the engine will not exit:

```javascript
// This fires FIRST and short-circuits the function:
if (holdMinutes < MIN_HOLD_MINUTES) {
  return { shouldExit: false, reason: 'Minimum hold time not reached' };
}
// Stop loss check below NEVER RUNS during first 30 min
```

For a 3x leveraged ETF that can move 5%+ in 30 minutes, this means the stop loss provides ZERO protection during the most dangerous entry window.

**Note:** The new WebSocket fast-path (`fastPathExitCheck`) does NOT have this bug — it checks stop loss with no hold time gate. So this is partially mitigated during market hours when the WS stream is connected. But if WS is down, the polling path silently ignores stop losses for 30 minutes.

**Fix:** Move stop loss check above minimum hold time, or exempt stop losses from the hold time gate.

---

### ISSUE: Regime Flip Whipsaw Is Expensive

**Severity: HIGH**
**Estimated cost: $100-200 per flip cycle**

The trade data shows a clear pattern:
1. Enter SOXL as "regime-aligned bullish ETF in bull market"
2. Regime flips to bear within 30-90 minutes
3. Exit SOXL as "counter-trend bullish ETF in bear market" at a loss
4. Enter SOXS as "regime-aligned bearish ETF in bear market"
5. Regime flips back to bull
6. Exit SOXS at a loss
7. Net result: -$100 to -$200 round trip

The 10-minute hysteresis helps but has a flaw: if the raw regime oscillates (bull → bear → bull → bear), the pending timer resets each time, so the hysteresis never confirms and the engine keeps reacting to noise.

**Example from data:** Apr 10 — regime flipped twice in 2 hours, causing $143 round-trip loss (SOXL -$2.49, then SOXS -$141.26).

**Fix options:**
- Block entries for N minutes after a regime flip (not just hysteresis)
- Require higher confidence (e.g., 80%+) for the first trade after a regime change
- Don't auto-enter the opposite side after exiting for regime change

---

### ISSUE: "RSI Momentum Zone" Is Not a Signal

**Severity: HIGH**
**Impact: Every entry is under-filtered**

The momentum strategy triggers when RSI is between 50 and 65:
```javascript
if (indicators.rsi.value > 50 && indicators.rsi.value < 65) {
  strategyMatch = true;  // This fires on nearly every tick in an uptrend
}
```

RSI 50-65 covers the **majority of trading time** for any trending stock. Looking at the last 25 trades, every SOXL entry used this signal with RSI values from 51.5 to 64.4. It provides zero discriminating power.

Combined with "MACD bullish" (+8, true whenever histogram > 0) and "Regime-aligned" (+10), confidence easily hits 90-95 on every evaluation. The confidence scaling (60→0x, 90→1x) provides no differentiation because confidence is always at the ceiling.

**Fix:** Either narrow the RSI zone (e.g., 45-55 for true momentum recovery) or add a rate-of-change filter (RSI must be rising, not just in range).

---

### ISSUE: Trailing Stops Disabled by Default

**Severity: HIGH**
**Impact: Profit erosion on all semiconductor presets**

`trailingStopPercent` defaults to 0 (OFF). Of 5 strategy presets, only INVESTIGATE_TRADER enables trailing stops. The trade data shows trailing stops are the best profit protection:
- Trades #5, #6: Trailing stop exits captured +2.3% and +2.5% gains
- Trades #14, #15, #23: "Trailing stop waiting (need 2%, have 1.5%)" — the stop was enabled but the gain didn't reach the 2% activation threshold, so weaker oscillator signals forced the exit instead

**Fix:** Enable trailing stops on all presets. Consider a tiered activation:
- At +1% gain: activate loose trailing (lock 30%)
- At +2% gain: tighten to lock 50%
- At +3% gain: tighten to lock 65%

---

### ISSUE: Non-Critical Signals Can't Reach Exit Threshold

**Severity: MEDIUM**
**Impact: Only critical exits (stop loss, profit target, trailing, EOD) can trigger exits**

With the current exit threshold of 70, the maximum non-critical exit score is:
- RSI overbought: +20
- Counter-trend losing: +15
- MACD bearish: +10
- Volume declining: +10
- **Total: 55** (below 70 threshold)

This means oscillator-based exits are effectively dead. Only hard stops, profit targets, trailing stops, and EOD can trigger exits. Whether this is good or bad depends on perspective:
- **Good:** Eliminates premature exits from noisy oscillator signals
- **Bad:** A position that's clearly deteriorating (RSI overbought + MACD bearish + volume dying + counter-trend) still won't exit until it hits a hard stop

**Fix:** Consider threshold of 60, or add weight to the "multiple weak signals agree" scenario.

---

### ISSUE: Trailing Stop Minimum Too High for Many Trades

**Severity: MEDIUM**
**Impact: Trades peaking at 1.5-1.9% get no trailing protection**

The trailing stop only activates after `trailingStopMinProfitPercent` (default 2%) gain. But many trades peak below this:
- Trade #14: peaked at 1.51%, exited on oscillator signals at +$135
- Trade #15: peaked at 1.93%, exited on oscillator signals at +$134
- Trade #23: peaked at 1.51%, exited on oscillator signals at +$113

These trades would have benefited from early trailing activation. They got lucky with oscillator exits, but without those signals (see issue above about non-critical signals not reaching threshold), they'd ride back down to stop loss.

**Fix:** Lower `trailingStopMinProfitPercent` to 1% for leveraged ETFs, or implement tiered trailing.

---

### ISSUE: 5-Minute Candle Staleness for Indicators

**Severity: MEDIUM**

The engine computes RSI, MACD, Bollinger Bands, etc. from 5-minute candles. The most recent candle can be up to 5 minutes old (only completes at minute boundaries). For a 3x ETF moving 0.5-1% per minute during volatile periods, the indicators are 5-10 minutes stale.

The WebSocket price fixes the `currentPrice` variable but NOT the indicator calculations. RSI divergence computed on bars that are 5+ minutes old is essentially stale.

**Mitigation:** The WS fast-path handles the most time-critical exits (stop loss, trailing stop) without indicators. The indicator staleness mainly affects the scoring-based exits, which are less time-critical.

---

### ISSUE: Confidence Scaling Provides No Differentiation

**Severity: MEDIUM**

The position sizing scales with confidence from 60% (0x) to 90% (1x). But in practice, every entry has confidence 90-95 because:
- Base: 50
- Strategy match: +20 (fires on nearly every tick)
- MACD bullish: +8
- RSI signal: +12
- Regime-aligned: +10
- **Total: 100, capped at 95**

The confidence system is binary: either entry is blocked (below 70) or full size (90+). The 60-90 scaling range is never used.

**Fix:** Either recalibrate signal weights to produce more variance, or use a different sizing model that doesn't depend on confidence.

---

### ISSUE: Duplicate Buy Decisions (Race Condition)

**Severity: LOW**
**Impact: Log bloat, potential duplicate orders**

On Apr 17, the EXP-B session logged 76 BUY decisions for SOXL in 50 minutes (~one per tick). The pending order check or position existence check has a race condition where the evaluation starts before the previous order fills.

The pending order tracking (`pendingOrders` Map with 60s timeout) should prevent this, but if the order fills quickly and the position sync hasn't run yet, the next tick re-evaluates and re-enters.

**Fix:** Add a secondary guard: skip entry evaluation if a BUY decision for this symbol was logged within the last 60 seconds.

---

### ISSUE: Counter-Trend Blocking Is Too Weak

**Severity: MEDIUM**

Counter-trend trades require `minSignalsRequired + 1` signals (e.g., 3 instead of 2) and get a -20 confidence penalty. But since most entries already have 4-5 signals, adding +1 barely raises the bar. The -20 penalty (95 → 75) still exceeds the 70 minConfidence threshold.

**Fix options:**
- Block entries entirely for 30 minutes after a regime flip
- Require confidence ≥ 85 for counter-trend trades
- Require minimum 4 signals for counter-trend (not just +1)

---

### ISSUE: Leverage Scaling Makes Take Profit Unreachable

**Severity: LOW-MEDIUM**

Take profit of 2.5% for QBTX scales to 7.5% after leverage scaling. A 7.5% move on a 3x ETF requires a 2.5% move in the underlying, which rarely happens intraday. Most trades exit via other signals long before reaching this target.

For SOXL_MOMENTUM, take profit of 3% scales to 9%, requiring a 3% SOXX move in one day (happens maybe once a month).

**Impact:** The take profit signal (+100 exit points) almost never fires. Exits are driven entirely by other signals (oscillators, trailing stops, EOD).

**Fix:** Set take profit targets that are achievable intraday. For 3x ETFs, 3-4% total (not 3-4% raw that scales to 9-12%) is a realistic intraday target.

---

## 16. Recommended Fixes (Priority Order)

### P0 — Fix Immediately

| # | Issue | Fix | Risk |
|---|-------|-----|------|
| 1 | ~~Stop loss bypassed during hold time~~ | ~~Move stop loss check above min hold time gate~~ | **FIXED 2026-04-19** |
| 2 | ~~Trailing stops disabled on all semiconductor presets~~ | ~~Enable `trailingStopPercent: 50` on SOXL/SOXS/combo presets~~ | **FIXED 2026-04-19** |

### P1 — Fix This Week

| # | Issue | Fix | Risk |
|---|-------|-----|------|
| 3 | Regime flip whipsaw | Add 30-min cooldown after regime change before new entries | Medium — may miss some real reversals |
| 4 | RSI momentum zone fires on every tick | Narrow to RSI 45-58, require RSI rising over last 3 bars | Medium — fewer entries |
| 5 | Trailing stop min too high | Lower `trailingStopMinProfitPercent` to 1% for leveraged ETFs | Low |

### P2 — Fix This Sprint

| # | Issue | Fix | Risk |
|---|-------|-----|------|
| 6 | Non-critical exits can't reach threshold | Lower exit threshold to 60, or add "convergence bonus" when 3+ weak signals agree | Medium |
| 7 | Take profit unreachable | Set explicit `leveragedTakeProfitPercent` that isn't auto-scaled (e.g., 3% for 3x) | Low |
| 8 | Confidence provides no differentiation | Recalibrate signal weights: strategy match +10 (not +20), add new higher-weight signals | Medium |
| 9 | Counter-trend too permissive | Require confidence ≥ 85 + 30-min post-flip cooldown | Low |

### P3 — Backlog

| # | Issue | Fix | Risk |
|---|-------|-----|------|
| 10 | Duplicate buy decisions | Add 60s decision dedup guard | Low |
| 11 | 5-min indicator staleness | Compute indicators from 1-min candles (more API calls) | Medium — rate limits |
| 12 | Confidence scaling unused | Redesign sizing model based on signal quality score instead of confidence | High — changes position sizes |
