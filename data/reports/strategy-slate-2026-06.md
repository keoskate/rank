# Strategy slate — five highest-conviction strategies, externally evidenced
# (and the instrumentation gaps they expose)

2026-06-10. Framing: what a competent fund would actually run to beat the
S&P risk-adjusted, constrained by honesty — every claim below cites external
performance data, and each strategy is scored against what OUR validated
infrastructure can and cannot yet do. This doubles as the secondary-channel
gap analysis: where the external record says an edge exists and our stack
cannot express it, that is an instrumentation gap, not a research gap.

Hard context from our own gates: passive same-universe EW earns ~0.85 Sharpe
on liquid long universes (D16); any "strategy" must beat that or improve
drawdown. Sharpe ≈1.0+ at the PORTFOLIO level is realistic only via genuinely
uncorrelated sleeves — our long-only diversifier sleeve failed at corr 0.637,
which is exactly why the external sleeves below matter: they achieve low
correlation through SHORTS and FUTURES we cannot yet hold.

## 1. Multi-asset long/short trend (managed futures) — the crisis-alpha sleeve

External record: the [SG Trend Index](https://portal.barclayhedge.com/cgi-bin/indices/displayHfIndex.cgi?indexCat=SG-Prime-Services-Indices&indexName=SG-Trend-Index)
returned **+27.3% in 2022** with Sharpe > 1 that year
([2022 CTA review](https://www.alpha-week.com/2022-cta-index-performance-review));
long-run trend Sharpe ~0.5–0.6 standalone but near-ZERO equity correlation.
Live ETF wrappers: [DBMF](https://www.etftrends.com/managed-futures-content-hub/its-the-managed-futures-showdown-of-the-year-dbmf-v-kmlm/)
(+18.7% 2022, −8.9% 2023, +7.2% 2024), KMLM (+30.4% 2022, −5.7% 2023).
OUR comparison: the long-only trend book was roughly flat-to-down in 2022 —
the ENTIRE +27% gap is the short side we cannot hold.
**Gap exposed: no short support (engine or backtest); no futures.**
Pragmatic implementation TODAY: hold DBMF/KMLM as a sleeve (they are
longable ETFs!) — validate the *allocation* through our five gates with the
sleeve's own B&H as control. Highest-conviction addition on the board:
externally proven ~0 equity correlation is what our combo experiment proved
we cannot manufacture long-only.

## 2. Volatility risk premium (index put-writing)

External record: the CBOE [PUT index](https://en.wikipedia.org/wiki/CBOE_S&P_500_PutWrite_Index)
since 1986: **9.54%/yr at 9.95% vol, Sharpe 0.65**, materially shallower
drawdowns than the S&P ([Bondarenko/CBOE study](https://cdn.cboe.com/resources/education/research_publications/PutWriteCBOE19_v14_by_Prof_Oleg_Bondarenko_as_of_June_14.pdf)) —
a persistent premium from index options trading rich.
**Gap exposed: no options data (cannot backtest through our gates) and no
options execution.** Wrapper route exists (PUTW ETF) but its live history is
the only validatable record. Disposition: the strongest single argument for
eventually buying historical options data; until then, wrapper-sleeve
validation only.

## 3. Cross-sectional momentum long/short — externally CONFIRMED DEAD for us

External record: published UMD premia decayed ~50%+ after publication
(McLean–Pontiff replication literature), and the surviving premium lives in
the SHORT leg + microcaps (uninvestable at our cost model). OUR result:
zero selection alpha long-only vs EW-45 (ΔSharpe −0.06) — **the rare case
where our instrumentation and the external literature agree exactly. This
agreement IS secondary-channel validation of our pipeline.** Disposition:
no standalone allocation; momentum stays as a ranking input only.

## 4. Auction-structure effects (overnight drift family)

External record: the Elm Wealth overnight-drift result replicated in OUR
gross data almost exactly (semis overnight Sharpe 1.26 gross — measured by
us, consistent with the paper's claims), but every net implementation we
tested loses to B&H, and D16 now formalizes that verdict. Institutional
capture requires auction-grade execution (~1bp).
**Gap exposed (small): Alpaca supports MOO/MOC order types (`opg`/`cls`)
that our engine never uses; an execution-quality study on our own fills is
the only honest path back into this family.**

## 5. Institutional flow events (dark-pool prints) — our only proprietary-data shot

External record: order-flow alpha decays in days and is fought over; nothing
publishable survives at retail latency EXCEPT longer-horizon accumulation
signatures — which is precisely what the rebuilt darkPoolCore classifier
targets (at-mid drops, mega-print caps, RTH-only). OUR prior audit measured
−0.038% with the BIASED classifier. The PIT archiver (Phase 0) is accruing
the only dataset on which this can ever be honestly tested; the B6
event-study program is pre-registered with no trials run. Disposition: wait
for ~60–90 archive days; this is the one strategy where we could own an
edge rather than rent a published one — and the only one on this list whose
data no vendor sells.

## The portfolio (what "beating the S&P" actually looks like here)

S&P 2016–2026: Sharpe ~0.89, maxDD −33.8% (our artifacts). The honest path
to beating it risk-adjusted is NOT a hero strategy — it is:
trend-volrank-23 (Calmar engine, ΔCalmar +0.23 vs passive) + a managed-
futures sleeve (external corr ≈ 0, crisis-convex) + optionally a VRP wrapper
sleeve, risk-weighted by the C8 allocator once it exists. Two-sleeve math at
corr ~0.0–0.2 puts portfolio Sharpe ≈ 1.0–1.1 with maxDD well under the
index — *every component externally evidenced and gate-validatable today
with zero new execution infrastructure* (all wrappers are longable ETFs).

## Instrumentation gaps (secondary-channel summary, ranked)

1. **No shorts** — quantified externally: the 2022 trend gap (+27.3% SG
   Trend vs ~flat for us) is the cost of long-only. Biggest capability gap.
2. **Alpaca circuit-breaker closes** deviate 269–321bps from official prints
   on 2–3 COVID days; Polygon cross-check blind pre-2021-07 → add Yahoo
   third-vendor leg to the integrity gate (D17).
3. **No options data/execution** — locks out the documented VRP (PUT 0.65
   Sharpe, 38 years of evidence).
4. **No futures** — caps trend breadth at ~23 ETFs vs the 50–60 markets the
   external trend record is built on.
5. **Auction order types unused** — `opg`/`cls` exist on Alpaca; our cost
   model has no auction tier and our engine never places them.
