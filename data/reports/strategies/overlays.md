# Overlay backtest — entropy gate & FRED macro gate

**Key:** `overlays` · **Updated:** 2026-06-04 (split-adjusted) · `scripts/backtests/overlays.js`

A/B of the two live strategies with vs without each overlay, over **2016-2026 (Alpaca,
split+dividend ADJUSTED)** across three stress regimes (2018-Q4, 2020 COVID V-bottom, 2022).
FRED arm still pending `FRED_API_KEY`.

> ⚠️ **Correction history:** the first Alpaca run used RAW (unadjusted) prices — every split
> was a fake −75/−95% crash, corrupting it. Fixed (`adjustment:'all'`). The numbers below are
> the clean re-run. Polygon-based research was always adjusted and unaffected.

## Results (2016-2026, split-adjusted)

**Trend-following** (2017-01 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | 2018Q4 | 2020 | 2022 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 15.5% | **0.93** | −23.1% | 0.67 | 92% | −16.2% | −22.6% | −7.8% |
| +entropy | 12.6% | 0.91 | −19.0% | 0.66 | 65% | −10.9% | −18.5% | −5.2% |

**Cross-sectional momentum** (2016-07 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | TotRet | 2020 | 2022 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base | 35.5% | 1.29 | **−37.1%** | 0.96 | 100% | 1890% | −35.9% | −2.8% |
| +entropy | 25.2% | **1.34** | −24.8% | 1.02 | 57% | 814% | −22.5% | +5.1% |

## Verdict (clean data)

- **TREND + entropy ≈ Sharpe-neutral → leave it OFF.** Sharpe 0.93→0.91, Calmar 0.67→0.66 —
  essentially flat (the corrupted raw run *overstated* this as a clear drag). It cuts every
  bear drawdown but costs ~3%/yr CAGR at the same risk-adjusted return. Since base trend's
  −23.1% MaxDD is already inside the 25% mandate, the gate isn't needed — keep the extra
  return. (Honest: this is close-to-neutral, not a slam-dunk; trend self-de-risks via its
  cash leg, so the gate is largely redundant.)

- **XS-MOM + entropy → keep it ON, as drawdown discipline (confirmed on clean data).** Sharpe
  1.29→1.34 and Calmar 0.96→1.02 are marginally better, but the real reason is risk-limit
  compliance: base draws **−37.1%**, breaching its own 25% doctrine *and* the 30% auto-FIRE
  line; gated holds **−24.8%**, within mandate. The cost is real — it ~halves total return
  (1890%→814%) by sitting in cash ~43% of the time. It's insurance with a steep premium, not
  free alpha. The always-invested strategy has no other downside control.

- **2020 V-bottom:** entropy cut the loss (−22.5% vs −35.9%) but couldn't dodge a crash that
  fast; slow re-entry is why total return halves. The premium is the price of the protection.

## Live config (validated on clean data)
- trend-follower: entropy **OFF** (base within DD mandate; gate ≈ neutral, keep return).
- momentum-rotator: entropy **ON** (only way to keep it inside its 25% drawdown limit).

The direction of last turn's reversal survived the split-fix; only the magnitudes moved.
