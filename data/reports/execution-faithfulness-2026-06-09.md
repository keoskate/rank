# Execution faithfulness — trend-follower (volrank-23 deployed spec)

- Generated from bars through **2026-06-09** (lib/marketData clamps to T-3d; the monitor lags live by ~3 days by design).
- Live window: 2026-06-10 -> 2026-06-09 (0 trading days with final bars).
- Expected side: simulateDeployed (validate-trend, certified core) with rankBy=volAdjusted on the 23-ETF universe, replayed from 2016-01-04.
- Actual side: session 05dc9675-6739-43d6-b12d-4aeccfbfaacf tradingLog (engine sim fills; broker-ledger.json is the tier-change log and is not used).

**The live window has no executed trades yet (spec deployed 2026-06-10).**

The harness is in place; the first real diff accrues with the forward test.

---
PRE-REGISTERED tolerance (manifest 2026-06-10-night D5 / ROADMAP A2-A3): promotion discussion requires decision-match >= 95% and median |residual| <= 25bps/trade over >= 4 consecutive weeks.

