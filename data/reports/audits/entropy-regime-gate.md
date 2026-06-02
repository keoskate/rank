# Audit: Entropy Regime Gate (`entropy-regime-gate`)

**Files:** `server/strategies/entropyGate.js`, `packages/quant-core/src/shannonEntropy.js`
**Wiring:** `server/aiTradingEngine.js:3326-3368`, `server/brokers/brokerSchema.js:420-424`
**Scope:** read-only audit + Polygon backtest. No server/agent files modified.

---

## What it does

`shannonEntropy.js` computes Shannon entropy `H = -Σ p·ln(p)` of a histogram of
**log returns** as a chop-vs-trend regime signal:

- `entropySnapshot(closes, [21,63,252])` derives a **shared bin range** of ±4σ
  from the longest available window, then computes `H` for each window's most
  recent slice (`shannonEntropy.js:151-174`). Sharing the range is the right
  idea — it makes narrow-range trend (low H) comparable to wide-range chop
  (high H).
- `classifyRegime(H, Hmax, prevH)` normalizes `normH = H/ln(bins)` and labels
  (`shannonEntropy.js:186-227`):
  - `normH ≤ 0.65` → **low-entropy** (directional / trend)
  - `normH ≥ 0.85` → **high-entropy** (chop)
  - in between → **neutral**
  - `|ΔnormH| ≥ 0.08` between consecutive readings → **transitioning** (checked first).

`entropyGate.js` is the gate. For sessions with `entropyGateEnabled`, it fetches
~300 daily bars of a reference symbol (default `SOXX`), computes the snapshot,
takes the **shortest window** as the active regime (`entropyGate.js:57`), then:

- vetoes if `blockOnRegimeTransition` and state is `transitioning` (`:77-83`)
- allows everything if `preferredRegime === 'any'` (`:85-87`)
- allows only if `regime.state === preferredRegime`, else vetoes (`:89-101`).

The engine calls it per candidate before `executeEntry` and **fails open** on any
error (`aiTradingEngine.js:3331-3362`).

---

## Audit findings

### HIGH — The gate is a complete no-op for every live broker
All 8 persona files in `agents/brokers/*.md` set `preferred: any` **and**
`blockOnTransition: false`. Trace through `entropyGate.js`: transition guard is
skipped (`blockOnTransition=false`), then `preferred==='any'` returns
`{allow:true}` at line 86 **unconditionally**. The entropy computation runs,
caches, and broadcasts `session.entropyRegimeState`, but **never vetoes a single
trade**. It is pure overhead (a Polygon fetch + entropy math every entry cycle)
with zero effect on what gets traded. Whatever edge the gate might have is
currently unrealized because nobody is using a real preference.

### HIGH — The `high-entropy` state is structurally almost unreachable
With 20 bins and a 21-return window, you cannot fill the bins, and the ±4σ range
is *derived from the same small sample*, so most mass lands in central bins.
Measured distributions:
- iid-Gaussian 21d returns (the textbook definition of "chop"): median
  `normH≈0.69`, **0%** of samples reach the 0.85 high cut, p95 only 0.735.
- Real **SOXX** 2022-2024, point-in-time 21d regime over 453 days:
  `low-entropy: 250, neutral: 202, high-entropy: 1`.
- Backtest universe 2021-2024: `high-entropy` fired on **1 of ~1927** signal
  days.

So a broker that prefers `high-entropy` (the natural mean-reversion persona)
would be vetoed ~100% of the time and never trade. The 0.85 cut is mis-calibrated
for these window/bin sizes — it bears no relationship to the realized normH
distribution.

### MED — `neutral` can never satisfy any allowed preference
`classifyRegime` emits four states, but `ALLOWED_REGIMES` (`brokerSchema.js:7`)
only permits `low-entropy | high-entropy | any`. When the regime is `neutral`
(~45% of SOXX days) and a broker prefers either entropy state, the gate vetoes
(`entropyGate.js:97-101`). A "low-entropy momentum" broker therefore sits out
nearly half the tape regardless of signal quality — and the cut placement means
"neutral" is really "mildly random walk", not a clearly bad regime.

### MED — Look-ahead in `entropySnapshot`'s shared range (subtle, self-consistent)
The bin range is computed from the **same window** whose entropy is being scored
(`shannonEntropy.js:160-171`). For the live gate this uses only data up to "now",
so there's no temporal look-ahead. But it means H is measured relative to *its
own* recent volatility, not a fixed external scale — a quietly trending market
and a violently chaotic one can both read mid-range because each is normalized to
itself. This blunts the very chop-vs-trend discrimination the metric claims
(`shannonEntropy.js:5-6`). My backtest reproduces the PIT computation honestly
(closes[0..t] only) so the results below are look-ahead-free.

### MED — Transition detector is fragile to the cache + per-session state
`PREV_BY_SESSION` (`entropyGate.js:15,61-71`) stores the prior `normH` keyed by
`sessionId|symbol|window`, but the snapshot itself is cached for 5 min across all
sessions sharing a reference symbol. ΔH is thus the change *between gate calls for
that session*, whose spacing is the engine's scan cadence — not a fixed Δt. The
`transitionDelta=0.08` threshold has no consistent time meaning. On first-ever
call `prevH` is null so transition can never fire; after a restart all state is
lost. With `blockOnTransition:false` everywhere this is currently moot, but it
would misbehave if enabled.

### LOW — Active-regime uses only the shortest window
`entropyGate.js:57` discards the 63/252 windows and classifies off the 21d H
alone. The multi-window snapshot is computed but unused for the decision. The
extra windows cost compute for nothing.

### LOW — `deltaH` sign/threshold uses normalized vs raw inconsistently
`classifyRegime` computes `deltaH = normH - prevH/Hmax` (`:197`) where `prevH` is
passed as a *raw* H (`entropyGate.js:67` passes `prevNormH*Hmax`). It round-trips
correctly, but the API is confusing (param named `prevH` sometimes raw, the
internal math re-normalizes) and invites the kind of unit bug that silently
breaks transition detection.

---

## Backtest method & results

**Harness:** `scripts/backtests/entropy-regime-gate.js` (point-in-time, no
look-ahead). Same signal + same exits across all variants; only the entropy
filter differs.

- Universe: SOXL, SOXS, TQQQ, SQQQ, SPXL, NVDA, AMD, QQQ (8 symbols the brokers
  trade), 2021-01-01 → 2024-12-31 daily bars.
- Base signal: 5-day breakout (`close[t] > max(close[t-5..t-1])`), enter at the
  **next session open**.
- Exit: broker-style TP +8% / SL -4% / 10-day max (identical to
  `scripts/backtest-insider.js`).
- Regime computed PIT from `SOXX` closes up to day `t` only.

### Momentum (breakout) signal — gate variants

| Variant | n | exp/trade | win % | ret/risk |
|---|---|---|---|---|
| A: no gate (baseline) | 1927 | **+0.44%** | 42% | 0.084 |
| B: low-entropy only | 731 | +0.54% | 44% | 0.103 |
| C: high-entropy only | **1** | -4.00% | 0% | — |
| D: block-on-transition | 1420 | +0.37% | 42% | 0.071 |
| E: neutral only | 688 | +0.20% | 40% | 0.038 |

Low-entropy filter improves expectancy modestly (+0.54% vs +0.44%) and ret/risk
(0.103 vs 0.084), keeping 38% of trades. But **significance test** (low-entropy
trades vs all other trades): diff **+0.35%/trade, SE ±0.28%, t = 1.25** — not
significant. Block-on-transition is *worse* (-0.07% edge). High-entropy is dead.

### Mean-reversion (dip-buy) signal — cross-check

Dip-buy (`close[t] < min(close[t-5..t-1])`), same exits:

| Variant | n | exp/trade | SE |
|---|---|---|---|
| A: no gate | 1726 | +0.22% | ±0.13% |
| low-entropy | 603 | +0.14% | ±0.22% |
| neutral | 620 | **+0.54%** | ±0.22% |

Directionally consistent with the entropy thesis: momentum does better in
low-entropy, mean-reversion does better in *higher*-entropy (here `neutral`, since
`high-entropy` never fires). But the effect is weak and the useful bucket is
`neutral` — which the schema doesn't even let a broker select.

---

## Verdict

**Needs work.** The entropy math is reasonable and the chop-vs-trend intuition
shows up *directionally* in the data (momentum↑ in low-entropy, mean-reversion↑
in higher-entropy). But as shipped the gate (a) does literally nothing for any
live broker (`preferred: any` everywhere), (b) has a `high-entropy` threshold
that is unreachable with the configured 20 bins / 21d window, and (c) the one
live-relevant edge (low-entropy momentum) is **not statistically significant**
(t≈1.25). It is currently pure overhead.

## Prioritized recommendations

1. **HIGH — Stop paying for a no-op.** Either give brokers a real `preferred`
   regime or disable `regime.enabled`. Today every broker runs the fetch+compute
   on every entry and gets `allow:true` regardless. Quickest honest move: set
   `regime.enabled:false` until the calibration below is done.
2. **HIGH — Re-calibrate cuts to the realized normH distribution.** With 20 bins
   the empirical PIT normH for SOXX lives ~0.55-0.75. Set cuts from quantiles of
   a long PIT sample (e.g. low = 33rd pctile, high = 66th pctile) rather than the
   fixed 0.65/0.85, OR reduce bins to ~8-10 and/or lengthen the active window so
   `high-entropy` is actually attainable. As-is, `high-entropy` is unusable.
3. **MED — Allow `neutral` as a selectable preference** (or collapse to a
   2-state low/high split via a single median cut). The backtest shows `neutral`
   is where mean-reversion edge concentrates; the schema forbids selecting it.
4. **MED — Drop block-on-transition or fix its Δt.** It costs 26% of trades for a
   *negative* edge and its ΔH has no consistent time base (cache + per-session
   state). Keep disabled.
5. **MED — Use the multi-window snapshot or stop computing it.** Either combine
   21/63/252 (e.g. require agreement) or compute only the active window.
6. **LOW — Validate before trusting.** Before promoting any regime-gated broker,
   require the gated variant to beat the ungated baseline at **t > 2** on a
   held-out period — the current low-entropy edge would not pass.
