# Roadmap — from honest tooling to validated profits

Updated 2026-06-10. The foundation (run artifacts, viewers, five-gate
`validateStrategy()`, certified shared cores) is built. This file is the
prioritized path from here to "consistently profitable, and we can prove it."

**North star:** paper-tier P&L produced only by strategies carrying a
VALIDATED label — and the label means all five gates: data-integrity,
backtest==live faithfulness, walk-forward OOS, 2x-cost survival,
multiple-testing significance.

## Scoreboard (as of 2026-06-10)

| Strategy | Verdict | Gates | The honest read |
|---|---|---|---|
| trend-following (deployed top-5 spec) | **FAILED:multipleTesting** | 4/5 | OOS Sharpe 0.82 (SPY 0.82 same window, but maxDD −18% vs −34%), survives 2x costs, faithfulness CERTIFIED, flat parameter neighborhood. DSR 57.9% vs 95% bar under the revised (D14) null-noise deflation at N=65 trials — good evidence, but not distinguishable from best-of-65 luck; see data/reports/gate5-revision-2026-06.md for what passing now requires. |
| xs-momentum (momentum-rotator) | **FAILED:multipleTesting** | 3/5 | No risk-adjusted selection edge: OOS Sharpe 0.86 vs survivorship-matched EW-all 0.93 (extra CAGR is just extra risk). Its old gate-5 pass (95.0%) was a young-ledger artifact; DSR 62.3% under the revised bar. |
| entropy gate | NO EDGE | — | Faithful now (certified), but zero significant expectancy improvement net of costs (p ≥ 0.6, n up to 5,881). Keep OFF. |
| overnight drift (incl. weekday/trend variants, SOXX/SOXL) | FAILED | — | The anomaly is real in gross prices (SOXX overnight 26.5%/yr Sharpe 1.26; Tue/Wed nights carry it; SOXL intraday is negative) but untradeable: dead at standard costs, and even at best-case 1bp auction execution the fixed SOXX spec loses to simply holding SOXX on identical OOS dates (18.9%/yr Sharpe 0.88 vs 34.7%/yr Sharpe 0.97). Weekday selection didn't persist OOS. |
| short-vol-spike (Listman/uvxy.pro: short UVXY 30%+ spikes) | **FAILED:multipleTesting** | 3/5 | Spike cadence claim verified (5.3/yr vs claimed 4-6); OOS Sharpe 0.63 with negative haircut (not overfit) and survives 2x costs — but naive static share-shorts hit −100% RUIN at both tested sizes (COVID continuation), the survivable daily-rebal variant rode a −93% drawdown, and SPY B&H beats it risk-adjusted on identical dates (0.83 vs 0.63, −24.5% vs −53% maxDD). Options implementation untestable (no historical options data) and cannot create edge, only reshape the tail at premium cost. |
| trend breadth-23 (C7 first pass: +GLD/SLV/TLT/IEF/DBC) | FAILED:multipleTesting | 4/5 | Marginal: OOS 0.85 vs base 0.82, in-sample slightly worse. Naive breadth fails because raw 12-1 momentum ranking is vol-biased — low-vol diversifiers never crack the top-5. |
| **trend volrank-23 (C7 second pass — DEPLOYED 2026-06-10)** | **FAILED:multipleTesting** | 4/5 | Best spec to date: rankScore = momentum/vol63 (in the certified core, live parity certified incl. rankScore). OOS Sharpe progression 0.82 → 0.85 → **0.89**, survives 2x costs (0.86), volWindow plateau 63/126. DSR 62.4% vs 95% at N=77. Deployed to the sim trend-follower broker (watchlist 23 + trend.rankBy: volAdjusted) — the forward test now runs the best evidence. |
| options-flow / insider / dark-pool | NO EVIDENCE | 0/5 | Never run through the pipeline. Event-based — needs the event-study harness (B3). |

## Phase A — Convert the near-miss (highest value per effort)

1. **Let the forward test run.** The sim-tier trend-follower now runs the
   certified core on the certified data path — every sim day is genuine
   out-of-sample evidence. DSR rises with T if the edge is real. Re-run
   `node scripts/backtests/validate-trend.js` monthly; the verdict updates
   itself. No new trials = the bar stops rising.
2. **Execution-faithfulness monitor.** Decision faithfulness is certified;
   execution is emulated. Monthly: run
   `node scripts/monitorExecutionFaithfulness.js` (built 2026-06-10, manifest
   D5) to diff the broker's sim ledger against the backtest's expected trades
   over the live window; it quantifies per-fill residuals in bps against the
   backtest close AND (raw minute bars, lib/executionBenchmark) the actual
   16:00 close and VWAP(fill→close). Machine-readable output:
   `data/reports/execution-faithfulness/latest.json` (+ dated history) with
   `consecutiveWeeksInTolerance` — this file IS the promotion-gate input.
   PRE-REGISTERED tolerance: promotion discussion requires decision-match >=
   95% and median |residual| <= 25bps/trade over >= 4 consecutive weeks.
3. **Promotion rule (write it down before it's needed):** trend-follower goes
   sim → paper only when (a) DSR ≥ 95% on updated OOS, and (b) sim-vs-backtest
   execution drift < agreed bps for 4+ consecutive weeks. No discretionary
   early promotion — that's the old disease.

## Phase B — Stop paying for things that don't work

4. **Entropy gate stays off everywhere.** It's certified and cheap, but adds
   nothing. If momentum-rotator (or any broker) has `regime.enabled: true`,
   turn it off and note the verdict in the persona file.
5. **momentum-rotator:** no selection edge over EW-all. Either (a) bench it,
   or (b) re-spec it as EW-all + trend overlay (the trend filter is where the
   risk-adjusted value actually was). Block paper promotion regardless.
6. **Event-study harness** for options-flow / insider-following / dark-pool:
   extend validateStrategy with an event-trade candidate type (entry events +
   exit policy → trade list → bootstrap significance). These three brokers
   currently trade on zero honest evidence; until validated they are
   sim-tier hypotheses, not strategies.

## Phase C — Compound the thing that works

7. **Breadth before leverage.** Trend-following's Sharpe scales with the
   number of independent trends, not with parameter tuning. Validate widened
   universes through the same pipeline: GLD/TLT/IEF (already in data),
   commodities, intl bonds. Each universe variant is a ledger trial — let
   DSR arbitrate.
8. **Meta-allocator.** Brokers are siloed $100k pools. Once ≥2 strategies are
   validated, allocate across them (risk-parity first; fractional Kelly via
   server/risk/kellySizing.js once forward stats exist). Diversification is
   the only free lunch the gates will ever approve.
9. **Calibrate the cost model** against actual Alpaca paper fills (gate 4
   currently uses static bps). Feeds both the backtests and the promotion
   rule.

## Phase D — Tooling debt (do opportunistically)

10. Repoint the remaining `scripts/backtests/*.js` research scripts to
    `lib/marketData` (several still call Polygon directly and silently start
    at 2021-06).
11. `server/strategies/xsMomentum.js` is uncertified — refactor onto a shared
    core or retire it with the broker decision in B5.
12. Surface verdicts everywhere decisions are made: broker:status, the
    Exchange Floor TUI, and the morning brief should show each broker's
    validation verdict next to its P&L.
13. ~~Pre-existing `reference.test.js` VWAP failure (upstream float drift).~~
    **RESOLVED 2026-06-10**: root cause was a wrong test contract, not float
    drift — the fixture spans ET midnight while `calculateVWAP` intentionally
    resets per ET session (that reset guards the live `belowVwap` gate). The
    test now asserts bit-exact parity within a single session and the
    session-reset contract across sessions. `calculateVWAP` unchanged.
14. ~~Gate-5 variance estimator needs a principled revision.~~ **RESOLVED
    2026-06-10** (see data/reports/gate5-revision-2026-06.md): the bar now
    uses null-noise dispersion (sd of a skill-less Sharpe at the ledger's
    median trial length, ≈0.31 ann.) instead of the empirical trial spread
    that anti-edge controls had inflated to 0.81. SR\* dropped 1.93 → 0.74
    ann.; all verdicts re-run; nothing flipped to pass (xs-momentum got
    STRICTER: its young-ledger 95% pass became 62.3% fail). Follow-on (own
    merits, not done): effective-N from trial correlation.
15. **OPEN DECISION on the promotion rule (A3):** under the revised bar,
    DSR ≥ 95% requires OOS Sharpe ≈1.3–1.4 — trend-following at 0.82 cannot
    reach it with more time alone. Either improve the strategy (C7 breadth)
    or deliberately re-set the promotion criterion (e.g. 4/5 gates + K months
    of in-tolerance forward sim). Owner's call; must not be changed silently.
    UPDATE 2026-06-10 night: the attribution finding (D16) reframes this —
    a beta-dominated long book can never clear raw DSR; the criterion should
    weigh Calmar/drawdown delta vs the passive control + forward-sim
    tracking. Still the owner's call.
16. **PRE-REGISTERED (2026-06-10 night, placebo-alarm finding): benchmark
    reform of the OOS gate.** Passive same-universe EW scores OOS Sharpe
    0.85 on the trend universe — ~95% of the flagship's Sharpe is
    diversified drift; SPY benchmarking flattered every spec. Amendment (own
    session, discipline rule, all verdicts re-run, before/after published):
    the OOS gate judges against the declared passive same-universe control,
    on incremental Sharpe AND Calmar (trend's real edge: maxDD −22.8% vs
    −29.8%, Calmar 0.69 vs 0.45). See data/reports/overnight-2026-06-10.md.

## Operating rules (unchanged, non-negotiable)

- One data path (`lib/marketData`), one artifact (`run.json`), one stats
  definition (`quant-core/equityStats`).
- Live decision logic lives in `@keo/quant-core` cores; plugins are thin
  fetch+translate wrappers; a `certify-*.js` script proves parity.
- Every parameter probe goes in the trials ledger. Never deleted.
- A pretty curve without a verdict is a hypothesis. Never promote on it.
