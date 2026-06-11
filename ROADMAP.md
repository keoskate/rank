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
| avwap overlays on trend volrank-23 (AV1-3, 2026-06-10) | **WORSE THAN BASE** | — | Pre-registered LOW prior confirmed (manifest avwap-vp-events): entry filters @high252/@yearStart drag OOS Sharpe 0.87 → 0.77 on identical dates (they only remove good entries — the SMA trend filter subsumes AVWAP information); the entry-anchored exit overlay is ruinous (OOS 0.51, 4,169 trades vs 355, 0.26 at 2x costs). VWAP's value here is EXECUTION measurement (A2 monitor), not signal. Engine param byte-identity proven before trials. |
| insider-following (event-study v1, 2026-06-10) | **FAILED:dataIntegrity** | 0/5 | First B6 harness run (94 events, 6-policy exit grid, ledger +6 on budget): gate 1 caught real faults (HAO −94% contamination jump; QNT/LFTO late listings). Structural finding: the UW feed is so recent-only that the pre-registered 21-day embargo leaves ZERO test events — events must accrue forward (archive them from run.json extra.eventStudy.events). In-sample, audit-consistent: pure 10d time exit +6.40%/trade vs the broker's tight-stop +0.23% on identical entries — NOT edge (gate 5 not run), a hypothesis to retest as events accrue. |
| options-flow / dark-pool | NO EVIDENCE | 0/5 | Event-study harness (B6) now EXISTS (lib/eventStudy.js, gate mapping pre-registered). Dark-pool waits on the point-in-time archive (data/darkpool-archive/, started 2026-06-10, needs ≥60 days); options-flow needs an event-sourcing adapter over data/flow-history/. Promotion for all three is hard-gated on data/backtests/validated-sources.json (tierPromotion validation gate). |
| volume-profile events (VP1 value-area / VP2 naked-POC, 2026-06-10) | **FAILED:multipleTesting** | 3/5 | Pre-registered LOW prior confirmed on minute-bar profiles 2018+ (manifest avwap-vp-events, 4 trials, ledger closed at exactly 101). VP1 value-area acceptance (2,281 events): test mean +0.50%/trade, survives 2x costs (+0.40%) — but bootstrap p=0.21 vs the same exit policy at random same-symbol entries: indistinguishable from the symbols' own drift. VP2 naked-POC revisit (1,047 events): test +0.17%, +0.07% at 2x costs, p=0.57 — the "naked POC magnet" lore is entirely drift. Faithfulness not_run (no live VP core) — by design. Volume profile stays a VISUALIZATION (live chart overlay + /api/volume-profile), not a signal. |
| MF wrapper sleeve: trend + DBMF/KMLM combo (slate #1, 2026-06-10) | **FAILED:outOfSample** | 2/5 | The external ~0-correlation claim did NOT transfer: corr(our trend book, DBMF) = 0.349 — our book already IS the trend factor, so wrapped trend is duplication, not diversification. Combo loses to both controls on identical OOS dates (vs sleeve A alone ΔSharpe −0.08/ΔCalmar −0.10; vs passive EW-25 −0.41/−0.54). Honest nuances: the OOS window missed the Jan–Sep 2022 MF bonanza (train consumed it), and the frozen inverse-vol allocator overweighted the lower-Sharpe sleeve at 54% — the add-a-sleeve condition (SR_B 0.65 > ρ·SR_A 0.31) IS met, so a small CAPPED allocation remains a legitimate future hypothesis via a pre-registered Sharpe-aware C8 allocator. 2 trials, ledger N=103. |
| MF sleeve, capped retest via C8 allocatorCore (2026-06-10) | **FAILED:outOfSample** | 2/5 | Pre-registered retest (c8-allocator-design-2026-06.md): cap 0.20 from institutional convention, monthly cadence. Allocator behaved as designed (mean satellite weight 19.7% vs the rejected run·s 54%) and the result matched the ex-ante expectation: vs trend book alone on identical OOS dates ΔSharpe −0.01 / ΔCalmar +0.02 — a Sharpe-neutral risk swap (maxDD −18.7% vs −22.8% for −2.1%/yr CAGR), and still loses to the passive EW-25 control (window-flattered at Sharpe 1.10). Per pre-registration this SETTLES the MF-wrapper question until the live C8 job exists and 2020-class regimes enter the data. allocatorCore is now built, tested, and certifiable — the C8 infrastructure survives the strategy rejection. |
| **VRP sleeve: trend + XYLD via C8 (slate #2, FREE test, 2026-06-11)** | **FAILED:multipleTesting** | **4/5** | First combo to PASS the D16 passive control (ΔSharpe +0.07, ΔCalmar +0.32) and improve on the trend book alone on identical full-window OOS dates (+0.02 Sharpe, +0.06 Calmar, maxDD −19.0% vs −22.8%). corr(trend, XYLD)=0.414; survives 2x costs; one pre-registered trial; ex-ante expectation was rejection. PUTW delisting (2025-04) noted. Options-chains purchase now justified for standalone PUT-style strategy work; live path = XYLD is engine-holdable today. |

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
16. ~~PRE-REGISTERED: benchmark reform of the OOS gate.~~ **EXECUTED
    2026-06-10** (data/reports/gate3-benchmark-reform-2026-06.md): gate 3 now
    judges every strategy against its passive same-universe EW control on
    incremental Sharpe OR Calmar, on identical stitched OOS dates. All active
    verdicts re-run: 3 stricter (diversifier sleeve, combo, overnight-SOXX
    now FAILED:outOfSample), 0 more lenient; deployed trend's real edge is
    now gate-visible (ΔCalmar +0.23 vs control).
17. **NEW (secondary-channel finding): third-vendor integrity leg.** Alpaca
    daily closes deviate 269-321bps from official prints on COVID
    circuit-breaker days (SPY 2020-03-13, GLD 2020-03-17), invisible to the
    Polygon cross-check (blind pre-2021-07). Add a Yahoo-based cross-source
    leg covering 2016-2021 and record affected dates in known-data-issues.
## Operating rules (unchanged, non-negotiable)

- One data path (`lib/marketData`), one artifact (`run.json`), one stats
  definition (`quant-core/equityStats`).
- Live decision logic lives in `@keo/quant-core` cores; plugins are thin
  fetch+translate wrappers; a `certify-*.js` script proves parity.
- Every parameter probe goes in the trials ledger. Never deleted.
- A pretty curve without a verdict is a hypothesis. Never promote on it.
