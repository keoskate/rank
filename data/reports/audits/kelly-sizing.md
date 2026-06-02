# Audit: Kelly Position Sizing (`server/risk/kellySizing.js`)

**Key:** kelly-sizing
**Scope:** `server/risk/kellySizing.js` and its consumer `server/brokers/simulatedExecutor.js` (the only caller). Cross-checked against `server/orderExecutor.js`, `server/brokers/brokerSchema.js`, `server/brokers/selfMutation.js`.
**Verification harness:** `scripts/backtests/kelly-sizing.js` (pure-math, no market data needed). All numbers below were produced by running it.

---

## What it does

`kellySizing.js` sizes a broker's next entry as a fraction of its bankroll using the classic Kelly criterion:

```
f* = (p·b − q) / b      p=win prob, q=1−p, b=avgWin/avgLoss (payoff ratio)
```

- `kellyFraction(winRate, payoffRatio)` — full-Kelly fraction; returns 0 for non-finite inputs, `winRate ≤ 0 || ≥ 1`, or `payoffRatio ≤ 0`.
- `empiricalStats(session, window=100)` — mines the last ≤100 **closed** trades (`side==='sell'` with numeric `realizedPnL`), computing win rate and a **dollar-based** payoff ratio (avg win $ / avg loss $).
- `computeKellySize(session, opts)` — selects stats source, applies the fractional multiplier and clamps:
  - **n ≥ 20 trades** → pure empirical.
  - **1 ≤ n < 20** → linear blend of prior and empirical, weight `w = n/20`.
  - **n = 0** → Bayesian prior `p=0.51, b=1.0` (fullKelly = 0.02).
  - `rawPct = fullKelly × fractionMult × 100`, then `clamp(minPct=0.5%, maxPct)`.

**Where it runs:** `simulatedExecutor.js:277-296`, only when `sizingStrategy === 'fractional-kelly'`. Default sizing is `confidence-scaled`. The **live** path (`orderExecutor.js`) never calls Kelly — it uses confidence scaling. So Kelly today affects **simulated brokers only**.

---

## Audit findings

### HIGH — Payoff ratio is computed in dollars, not per-trade return; it self-inflates as positions grow
`empiricalStats` (lines 60-70) builds `b` from **raw dollar P&L** (`realizedPnL = proceeds − cost`, `simulatedExecutor.js:441`), not per-trade percentage return. Kelly's `b` is supposed to be the win/loss **ratio per unit staked**. Because position size grows as Kelly's estimated edge grows, winning trades book larger dollar wins, which inflates `b`, which raises Kelly, which enlarges positions — a positive-feedback loop divorced from real edge.

Harness evidence (same 60% win rate, identical % outcomes, only position $ differs):
```
p=0.6 b=1 (equal $):              5.000% ($5000)   payoff=1.00  fullKelly=0.20
p=0.6, win$=5000 loss$=1000:      13.000% ($13000) payoff=5.00  fullKelly=0.52
```
The second broker is sized **2.6× larger** purely because its wins happened on bigger positions — not because it has more edge. **Fix:** compute payoff from `realizedPct` (already recorded at `simulatedExecutor.js:442/517`) or from R-multiples, never raw dollars.

### HIGH — A flawless track record sizes to ZERO (and so does an all-loss record, correctly)
`kellyFraction` returns 0 when `winRate >= 1` (line 31). A broker that has only winning closed trades has empirical `winRate = 1.0`, so:
```
20 wins 0 losses:  0.000% ($0)   wr=1.000 payoff=2.000 fullKelly=0.0000
```
The best-performing brokers get **vetoed entirely** (`kelly.dollars <= 0` → `return`, `simulatedExecutor.js:289-296`). This is a correctness bug from using the raw degenerate guard on a *sampled* win rate. With only ~20 samples, `wr=1.0` is common and not actually a sure thing. **Fix:** shrink the empirical win rate away from 0/1 (e.g. Laplace/Beta posterior `(wins+1)/(n+2)`) before feeding Kelly, or cap `winRate` at e.g. 0.95.

### HIGH — `avgLoss === 0` payoff fallback of `2` is an arbitrary magic number with no basis
Line 70: `payoffRatio = avgLoss > 0 ? avgWin/avgLoss : (avgWin > 0 ? 2 : 0)`. When a broker has wins but zero losses, payoff is hardcoded to 2. This silently injects a fabricated 2:1 payoff into the math. Combined with the win-rate handling, the blend region produces aggressive sizing off almost no data:
```
n=5 allwins:  8.463%  fullKelly=0.3385   (5 trades, no losses, fabricated payoff)
n=10 allwins: 14.792% fullKelly=0.5917
n=19 allwins: 20.000% (CAPPED) fullKelly=0.9629
```
Nineteen lucky trades drive sizing straight to the cap. **Fix:** require a minimum number of *losing* trades before trusting payoff, or use a regularized estimator.

### HIGH — Single tiny loss makes payoff explode; clamp is the only thing saving it
```
19 wins $2000, 1 loss $1:  20.000% ($20000)  payoff=2000.00  fullKelly=0.9500
```
One $1 loss yields `avgLoss=$1`, `avgWin≈$2000`, payoff=2000, near-full Kelly. The `maxPercent` clamp is the *sole* protection. This is fragile: the clamp is the safety net, but the underlying estimate is nonsense (payoff 2000). With a higher cap or `kellyFraction=1.0`, this sizes catastrophically (see next).

### MED — `kellyFraction` multiplier can be self-mutated to 1.0 (full Kelly); only the % cap restrains it
Schema permits `risk.kellyFraction ∈ (0, 1]` (`brokerSchema.js:191-192`) and it is in the self-mutation allow-list (`selfMutation.js:43`) with no tighter clamp. Brokers can drift toward full Kelly. Harness, full-Kelly + permissive cap:
```
full-Kelly mult=1.0, maxPercent=100, payoff=100, wr=0.95:  94.95% ($94,950)
```
Within the system the real per-position cap is **25%** (`aiTradingEngine.js:270 GLOBAL_MAX_POSITION_PERCENT = 25`, not the `|| 20` fallback in `simulatedExecutor.js:266`), so a single position is capped at 25%. But full Kelly on estimation error is exactly the volatility-blowup Kelly literature warns against. **Fix:** cap the allowed `kellyFraction` at e.g. 0.5 in schema/mutation; the comment in the file even cites "Medallion-style discipline" (0.25) yet the bound allows 1.0.

### MED — No awareness of concurrent exposure: N positions each up to the per-position cap
`computeKellySize` receives only `portfolioValue`/`sizingBase`; it has **no knowledge of already-open positions or deployed capital**. `maxPositions` is allowed up to 20 (`brokerSchema.js:197-199`). Kelly sizes each new entry independently at up to 25% of portfolio; the only backstop on aggregate exposure is the cash-availability check (`simulatedExecutor.js:314-324`). Kelly bankroll math assumes the fraction is of *current* bankroll for *one* bet; sizing several simultaneous correlated leveraged-ETF positions at full per-bet Kelly massively over-bets the portfolio. **Fix:** size against *available* (undeployed) capital, or divide Kelly by expected concurrent positions, or enforce a portfolio-level gross-exposure cap.

### MED — Break-even trades (`realizedPnL === 0`) counted as wins, biasing win rate up
Line 59: `if (t.realizedPnL >= 0)` classifies exact-zero P&L as a win and adds `0` to `winSum` (dragging avgWin down). Harness:
```
10 breakeven(0) + 10 losses:  wr=0.500 payoff=0.000  → 0% (no bet)
```
Here it happens to veto, but in mixed cases break-evens inflate win rate. Minor but wrong. **Fix:** treat `> 0` as win, `< 0` as loss, exclude exact zeros (or count as losses, more conservative).

### LOW — Blend uses raw empirical win rate even at n=1
At `n=1` the empirical stats (single trade) are blended in with weight `1/20=0.05`. A single trade already nudges sizing (`blended(1)` → 2.279% vs prior 0.5%). Defensible but means one trade moves size 4.5×. Acceptable given small weight, noted for completeness.

### LOW — `ROLLING_WINDOW` (100) ignores the `window` arg passed through `computeKellySize`
`computeKellySize` calls `empiricalStats(session)` with no window override (line 96), so the exported `ROLLING_WINDOW` is always used. Not a bug, just dead flexibility.

### Positive findings (things done right)
- Non-finite / out-of-domain inputs correctly return 0 (`NaN winRate → 0`, `Infinity payoff → 0`, verified in harness §6).
- Negative edge correctly produces `fullKelly < 0` → `dollars:0` veto (`p=0.4,b=1 → −0.20`; veto path `simulatedExecutor.js:289`).
- `portfolioValue`, `fractionMult`, `maxPct`, `minPct` are all clamped to sane ranges in `computeKellySize` (lines 88-94).
- The 0.25 default fractional multiplier is reasonable and the prior (0.51/1.0 → 2% full Kelly → 0.5% sized) is appropriately tiny for cold-start brokers (verified: PRIOR → 0.500%).

---

## Backtest method & results

This dimension is **pure position-sizing math**, not a signal — there is no market series to "backtest" for edge. The correct verification is a deterministic numeric audit of the sizing curve and its edge cases, which I built and ran:

**Harness:** `scripts/backtests/kelly-sizing.js` — feeds synthetic closed-trade logs into the real exported functions and prints the resulting size, source, win rate, payoff, and full-Kelly. No look-ahead concerns (no time series). Selected real outputs:

| Scenario | Result | Issue exposed |
|---|---|---|
| No trades (prior) | 0.500% ($500) | OK — tiny cold-start bet |
| 60% wr, equal $ | 5.000% ($5000), fullK 0.20 | OK baseline |
| 60% wr, wins on 5× bigger positions | **13.0%** ($13000), payoff 5.0 | $-payoff self-inflation (HIGH) |
| 20 wins / 0 losses | **0% ($0)** | flawless record vetoed (HIGH) |
| 19 wins $2000 + 1 loss $1 | **20% (capped)**, payoff 2000 | tiny-loss explosion (HIGH) |
| 5 all-wins (blend) | 8.46%, fullK 0.34 | fabricated payoff=2 (HIGH) |
| full-Kelly, payoff 100 | **94.95%** | full-Kelly blowup if cap raised (MED) |
| NaN / Infinity inputs | 0 | OK — safe |

The system-level per-position clamp (25% via `GLOBAL_MAX_POSITION_PERCENT`) does hold in the sim path and prevents the worst single-position outcomes, but it is masking, not fixing, a badly-conditioned edge estimate.

---

## Verdict

**needs-work.** The Kelly *skeleton* is correct (formula, veto on negative edge, prior, NaN safety, clamps) but the **inputs feeding it are mis-estimated**: payoff is computed in dollars (self-inflating), win rate is unregularized (flawless records size to zero, lucky streaks size to the cap), and the `avgLoss=0 → payoff 2` fallback is fabricated. The hard percent cap is currently the only thing standing between the system and dangerous sizing. Because Kelly only drives **simulated** brokers today, the blast radius is contained — but these brokers are exactly the ones being evaluated for *promotion to paper*, so a sizing estimator that rewards lucky dollar-streaks will promote the wrong agents.

---

## Prioritized recommendations

1. **(HIGH) Compute payoff from per-trade returns, not dollars.** Use `realizedPct` (already stored, `simulatedExecutor.js:517`) or R-multiples. Eliminates the self-inflation feedback loop and the tiny-loss explosion's economic meaning.
2. **(HIGH) Regularize the win rate.** Use a Beta/Laplace posterior `(wins+1)/(n+2)` and/or cap winRate at ~0.90–0.95 before Kelly so flawless small samples neither size to zero nor to the cap.
3. **(HIGH) Require real losses before trusting payoff.** Drop the `avgLoss=0 → 2` magic; if there are < (say) 5 losing trades, stay on the prior/blend for payoff instead of fabricating one.
4. **(MED) Tighten the `kellyFraction` bound to ≤ 0.5** in `brokerSchema.js` and clamp it in `selfMutation.js`. Full Kelly contradicts the file's own "0.25 Medallion discipline" comment.
5. **(MED) Make Kelly exposure-aware.** Pass available (undeployed) capital and/or `maxPositions` so concurrent bets don't sum past a portfolio gross-exposure cap; or divide Kelly by expected concurrent positions.
6. **(MED) Fix win/loss classification:** wins = `pnl > 0`, losses = `pnl < 0`, exclude exact-zero break-evens.
7. **(LOW) Add a guardrail unit check** (the harness in `scripts/backtests/kelly-sizing.js` can be promoted to a test) so future edits can't reintroduce dollar-payoff or degenerate-winrate sizing.
