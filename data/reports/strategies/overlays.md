# Overlay backtest — entropy gate & FRED macro gate

**Key:** `overlays` · **Updated:** 2026-06-04 · `scripts/backtests/overlays.js` (+ `overlays.results.json`)

A/B of the two live strategies with vs without each overlay. **Data ceiling broken:**
switched from Polygon (2021-06 floor) to **Alpaca (history to 2016-01-04)**, so this
run covers **three** stress regimes — the 2018-Q4 selloff, the 2020 COVID V-bottom, and
the 2022 bear — not just one. FRED arm still pending `FRED_API_KEY` (keyless host blocked
here; the script uses the reachable api.stlouisfed.org host once a key is set).

> ⚠️ **The earlier 2022-only result was a mirage.** On the recent window entropy looked
> like near-free alpha (xs-mom Sharpe 1.24→1.61). Over the full 2016-2026 sample it is a
> **return-for-drawdown trade**, and on the trend book it is a **net drag**. This is exactly
> why one bear isn't enough.

## Results (2016-2026, ~9.5yr)

**Trend-following** (2017-01 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | 2018Q4 | 2020 crash | 2022 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 11.4% | **0.71** | −23.6% | **0.48** | 89% | −12.9% | −23.3% | −9.8% |
| +entropy | 8.6% | 0.68 | −21.0% | 0.41 | 54% | −8.0% | −18.6% | −6.2% |

**Cross-sectional momentum** (2016-07 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | TotRet | 2020 crash | 2022 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 30.1% | 1.13 | **−35.6%** | 0.84 | 100% | 1228% | −34.3% | −5.3% |
| +entropy | 20.4% | **1.20** | −24.8% | 0.82 | 48% | 523% | −22.5% | +6.1% |

## Revised verdict

- **TREND + entropy = net drag. Turn it OFF.** Over the full sample the gate lowers Sharpe
  (0.71→0.68) *and* Calmar (0.48→0.41) *and* CAGR (11.4→8.6%). It does shave every bear
  drawdown, but trend already self-de-risks via its SMA200/momentum cash leg, so the gate
  mostly adds whipsaw drag in the long bull. Base trend's −23.6% MaxDD is already within the
  25% doctrine on its own — it doesn't need the gate. **The trend IS the regime filter.**

- **XS-MOM + entropy = NOT free alpha, but justified risk discipline. Keep it ON.** The full
  sample is far more sober than 2022-only: Sharpe only 1.13→1.20 (+0.07), Calmar flat, and it
  **halves total return** (1228%→523%) by sitting in cash ~half the time. BUT — base xs-mom
  draws down **−35.6%**, which *breaches its own 25% max-drawdown doctrine and trips the 30%
  FIRE line*; the gated version holds **−24.8%**, within mandate. The always-invested strategy
  has no other downside control, and a −35% single-broker drawdown is unacceptable. So entropy
  here is the price of honoring the risk limit — keep it, but framed as drawdown discipline,
  not as an edge.

- **2020 V-bottom confirmed the suspicion (partly):** entropy *reduced* the 2020 loss
  (−22.5% vs −34.3%) but could not dodge a crash that fast, and its slow re-entry into the
  rip is a big part of why total return halved. It is insurance with a real premium.

## Net change from this study
- trend-follower: entropy **OFF** (was on — reversed on full-sample evidence).
- momentum-rotator: entropy **ON** (keeps it inside its 25% drawdown mandate).
