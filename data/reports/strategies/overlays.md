# Overlay backtest — entropy gate & FRED macro gate

**Key:** `overlays` · **Date:** 2026-06-04 · `scripts/backtests/overlays.js` (+ `overlays.results.json`)

A/B of the two live strategies with vs without each overlay. **Honest data ceiling:**
Polygon (current tier) floors at **2021-06-07** for every ticker, so only the **2022
bear** is testable — 2020/2008 are not in the data. Trend's 252-day lookback eats its
first year, so its window is 2022-06→2026; xs-momentum's is 2021-12→2026 (full 2022).
FRED arm not run (keyless CSV host unreachable here; the API host IS reachable, so it
runs once `FRED_API_KEY` is set).

## Results

**Trend-following** (2022-06 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | 2022 ret/DD |
|---|---:|---:|---:|---:|---:|---|
| base | 18.4% | 1.13 | −17.0% | 1.08 | 86.5% | −3.2% / −9.8% |
| +entropy | 15.7% | **1.13** | −11.9% | 1.31 | 65.7% | −5.0% / −7.4% |

**Cross-sectional momentum** (2021-12 → 2026-06):

| arm | CAGR | Sharpe | MaxDD | Calmar | Exposure | 2022 ret/DD |
|---|---:|---:|---:|---:|---:|---|
| base | 31.7% | 1.24 | −25.5% | 1.24 | 100% | −9.9% / −21.7% |
| +entropy | 29.3% | **1.61** | −17.9% | 1.64 | 55.8% | **+6.4%** / −8.1% |

## Verdict

- **Entropy on TREND = a risk dial, not alpha.** Sharpe is *identical* (1.13); it just
  trades ~2.7%/yr CAGR for a smaller drawdown (Calmar 1.08→1.31). Defensible for
  smoothness, but it adds no risk-adjusted edge — because trend already self-de-risks
  via its SMA200/momentum cash leg, so the gate is partly redundant. **Keep ON (harmless,
  cuts DD) but don't expect it to add return.**

- **Entropy on XS-MOMENTUM = a clear win in-window, and it contradicts the earlier call
  NOT to gate it.** Sharpe 1.24→**1.61** (+0.37), Calmar 1.24→1.64, and it **turned 2022
  from a −9.9% loss into a +6.4% gain** by going to cash in the chop. The reason is the
  inverse of the prior reasoning: xs-momentum is *always-invested with no downside control*,
  so the entropy cash-leg supplies exactly the protection it structurally lacks. The
  always-invested strategy benefits MOST from a regime gate. **Reconsider enabling it on
  momentum-rotator.**

## Caveats (why this is "promising," not "proven")

- **One bear (2022), ~4yr recent window.** The xs-mom win is concentrated in dodging 2022's
  chop; with n=1 regime it could be 2022-specific.
- The Sharpe gain is partly **exposure-driven** (xs-mom 100%→56% invested) + 2022 timing.
- **Fast V-bottom crashes (2020-style) are where entropy gates HURT** (slow to re-enter) —
  untested here because there's no 2020 data.
- Real rigor needs more history (paid Polygon tier or an alt source) to test 2008/2020.
