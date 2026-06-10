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
| trend-following (deployed top-5 spec) | **FAILED:multipleTesting** | 4/5 | OOS Sharpe 0.82 (SPY 0.82 same window, but maxDD −18% vs −34%), survives 2x costs, faithfulness CERTIFIED, flat parameter neighborhood (Sharpe 0.79–0.89 across 11 neighbors). DSR 92.3% vs 95% bar — not yet distinguishable from best-of-28-trials luck. |
| xs-momentum (momentum-rotator) | UNVALIDATED | 4/5* | *No risk-adjusted selection edge: OOS Sharpe 0.86 vs survivorship-matched EW-all 0.93. The extra CAGR is just extra risk. |
| entropy gate | NO EDGE | — | Faithful now (certified), but zero significant expectancy improvement net of costs (p ≥ 0.6, n up to 5,881). Keep OFF. |
| options-flow / insider / dark-pool | NO EVIDENCE | 0/5 | Never run through the pipeline. Event-based — needs the event-study harness (B3). |

## Phase A — Convert the near-miss (highest value per effort)

1. **Let the forward test run.** The sim-tier trend-follower now runs the
   certified core on the certified data path — every sim day is genuine
   out-of-sample evidence. DSR rises with T if the edge is real. Re-run
   `node scripts/backtests/validate-trend.js` monthly; the verdict updates
   itself. No new trials = the bar stops rising.
2. **Execution-faithfulness monitor.** Decision faithfulness is certified;
   execution is emulated. Monthly: diff the broker's sim ledger against the
   backtest's expected trades over the same window; quantify the
   intraday-vs-close residual in bps. This number is the promotion gate.
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
13. Pre-existing `reference.test.js` VWAP failure (upstream float drift).

## Operating rules (unchanged, non-negotiable)

- One data path (`lib/marketData`), one artifact (`run.json`), one stats
  definition (`quant-core/equityStats`).
- Live decision logic lives in `@keo/quant-core` cores; plugins are thin
  fetch+translate wrappers; a `certify-*.js` script proves parity.
- Every parameter probe goes in the trials ledger. Never deleted.
- A pretty curve without a verdict is a hypothesis. Never promote on it.
