# Data Sources + Tech-Mogul/News Strategy (ideas #4 + #7)

**Key:** `data-and-news`
**Type:** RESEARCH (no price backtest — this is a data-sourcing + strategy-design assessment)
**Date:** 2026-06-03
**Author:** research subagent

---

## TL;DR

- **Idea #7 "Tech Mogul" (LLM-reads-news → conviction → position) is NOT historically backtestable** and should be classified **forward-only**. The only news-sentiment data we can get historically (Polygon `insights`) **only exists from ~Oct/Nov 2024 onward** — entirely inside the 2024-26 bull regime. Backtesting a news strategy on that window would reproduce *exactly the mirage that killed insider-following and options-flow*: a recent-bull-only fit that lies.
- **The 2-3 highest-value data additions that ARE backtestable and worth building:**
  1. **FRED macro regime gate** (cheap, decades of history, true regime signal) — **best ROI.**
  2. **UW short-interest / borrow-fee (`/api/shorts`)** — squeeze + hard-to-borrow signals, real history.
  3. **Polygon fundamentals / financials** (`vX/reference/financials`) — quality/value tilt with deep point-in-time-ish history.
- Everything LLM/news/sentiment-flavored is **forward-test only**, full stop, because the labeled sentiment data does not exist before the current bull.

---

## Part 1 — Idea #4: Which additional data sources are worth adding?

All availability claims below were probed live against our actual API keys on 2026-06-03. Modules: `server/polygonClient.js`, `server/unusualWhalesClient.js`. Keys present in `.env`: `POLYGON_API_KEY`, `UNUSUAL_WHALES_API_KEY`, `ANTHROPIC_API_KEY`, Alpaca. **No `FRED_API_KEY` is present** (FRED returns `400 Variable api_key is not set` — a free key must be added).

### Probe results (ground truth)

| Source | Endpoint probed | Result | Historical depth |
|---|---|---|---|
| Polygon news | `GET /v2/reference/news?ticker=AAPL` | 200 OK, returns `insights:[{ticker,sentiment,sentiment_reasoning}]` | **Articles back to 2017-04**, but **`insights` (LLM sentiment) only from ~Oct/Nov 2024.** Sampled: 2024-06=0/30 with insights, 2024-12=30/30, 2025+=30/30. |
| Polygon financials | `GET /vX/reference/financials?ticker=AAPL` | 200 OK, full income/balance/cashflow | Multi-year quarterly, usable |
| UW congress | `GET /api/congress/recent-trades?limit=5` | 200 OK (array) | Works at small limits; `limit=500` → **422** (capped). Disclosure-lagged. |
| UW short interest | `GET /api/shorts/AAPL/data` | 200 OK, `array[1000]` of `{short_shares_available, fee_rate, rebate_rate, timestamp}` | Time series, real history |
| UW greek exposure | `GET /api/stock/AAPL/greek-exposure` | 200 OK, `array[250]` daily `{call_gamma,put_gamma,call_delta,...}` | **~250 trading days (~1yr) only** |
| UW skew | `/api/stock/AAPL/historical-risk-reversal-skew` | 200 OK but `array[0]` (empty for AAPL) | thin / unreliable |
| UW earnings | `/api/earnings/afterhours?limit=3` | 200 OK | forward calendar, not a long backtest series |
| FRED macro | `api.stlouisfed.org/fred/...` | **400 — no api_key** | Free key gives **decades** of daily data |

### Ranked assessment

Ranked by **(backtestable edge potential) × (regime-robustness) ÷ (cost/effort)**:

**#1 — FRED macro (regime gate). RANK: BUILD.**
- *Edge:* Not a stock-picker — a **regime filter**. Yield-curve slope (DGS10−DGS2), credit spreads (BAMLH0A0HYM2), unemployment trend, ISM. These flip months *before* equity regimes and are the single most defensible defense against the "fails in 2022" problem that killed the prior signals. A simple "risk-off when HY spreads spike + curve inverts" overlay would have *de-risked into 2022 and 2020*.
- *Backtestable:* **Yes, decades** of clean daily/weekly data. Point-in-time clean (macro series are released with known lags; use the lag).
- *Cost:* Free API key (1 min to obtain). No per-call cost. Trivial integration.
- *Verdict:* **Highest ROI. This is the data add most likely to produce true alpha (or at least true drawdown reduction) across regimes.**

**#2 — UW short interest / borrow fee (`/api/shorts/:sym/data`). RANK: BUILD/TEST.**
- *Edge:* `fee_rate` (cost-to-borrow) and `short_shares_available` are a real, economically-grounded signal: hard-to-borrow + rising fee = squeeze fuel; collapsing fee = short capitulation. This is distinct from the options-flow signal we killed (different mechanism).
- *Backtestable:* **Yes** — returns a 1000-point time series per symbol. Need to verify lookback spans ≥2018; even 2-3 yrs covers part of 2022.
- *Cost:* Already paid (UW key). ~1 call/symbol/day.
- *Verdict:* Worth a dedicated backtest. Squeeze signals notoriously crowded/regime-sensitive, so test 2022 specifically.

**#3 — Polygon fundamentals (`vX/reference/financials`). RANK: BUILD.**
- *Edge:* Classic quality/value factors (gross profitability, FCF yield, accruals) are the most *academically durable* cross-sectional edges and the ones that survive bear markets best (quality outperformed in 2022).
- *Backtestable:* **Yes**, multi-year quarterly. Caveat: watch for look-ahead — use `filing_date`, not `period_end`.
- *Cost:* Already paid (Polygon). Cheap.
- *Verdict:* Slow-moving, robust, complements the macro gate. Build a quality screen.

**#4 — Congressional trades (UW `/api/congress`). RANK: SKIP / LOW.**
- *Edge:* Popular narrative, weak mechanism. Disclosure is lagged up to 45 days (we saw txn dates weeks old). By the time it's public the move is gone. `limit` is capped (422 at 500), making a clean historical panel painful to assemble.
- *Backtestable:* Marginally, with heavy plumbing and disclosure-lag modeling.
- *Verdict:* **Low priority.** Same family as the insider-follow signal we just killed. Don't.

**#5 — Options IV / skew / greek-exposure (UW). RANK: SKIP for backtest.**
- *Edge:* Real in principle (skew = crash hedging demand), but **greek-exposure only has ~250 days** and skew came back **empty for AAPL**. Insufficient/unreliable history → cannot multi-regime test. This is the same class as the options-flow signal we killed.
- *Verdict:* Forward-only at best. Skip.

**#6 — Polygon news sentiment `insights`. RANK: FORWARD-ONLY (see Part 2).**
- *Edge:* Plausible, but **the labeled data starts ~Oct 2024.** Not backtestable across regimes — *by construction it can only be fit to the current bull.*
- *Cost:* Already paid.
- *Verdict:* The trap. Useful only as a live/forward signal.

**#7 — Social / alt-data (Reddit, X/Twitter, Google Trends). RANK: SKIP.**
- No key, no historical panel, expensive/ToS-fraught to acquire, notoriously regime-fragile. Not worth it for an automated broker.

**#8 — Earnings / estimate revisions. RANK: RESEARCH.**
- *Edge:* Post-earnings-announcement drift + upward estimate revisions (PEAD) is one of the **most durable documented anomalies.** But UW gives a forward *calendar*, not a clean historical *estimate-revision* series, and Polygon financials give actuals not consensus estimates. We lack a good historical **consensus-estimate** source. Would need a new vendor (Benzinga/Zacks/FMP).
- *Verdict:* High edge, but **data gap.** Flag for a future vendor add; not buildable today.

---

## Part 2 — Idea #7: "Tech Mogul" news/trends/LLM thematic strategy

### What it is (the pitch)
An LLM reads news + trend data about tech megacaps / thematic leaders ("what would a tech mogul buy?"), forms a conviction score, and sizes long positions in the named tickers — a discretionary-feeling, narrative-driven thematic long book, systematized via Claude.

### Can it be systematized? Yes. Can it be *historically* backtested? **No.**

**The disqualifying fact (grounded):** The only historical, machine-labeled news sentiment we can obtain is Polygon's `insights` field, and it **does not exist before ~Oct/Nov 2024** (probed: 0/30 articles with insights in 2024-06; 30/30 from 2024-12 on). Everything before that has raw text but no labels.

Two ways to fake a backtest, both rejected:
1. **Use raw 2017+ news text + run today's Claude over it.** This is **look-ahead / hindsight contamination**: the 2026 model "knows" how NVDA/COVID/2022 played out. Any backtest is meaningless.
2. **Backtest only on the 2024-26 labeled window.** That window is **a single bull regime** — *precisely the failure mode (recent-bull-only) that killed insider-following and options-flow.* A "great" result here would be the same mirage.

There is also an irreducible **discretion problem**: "tech mogul conviction" has no mechanical ground truth. Even systematized via an LLM prompt, the output is non-stationary (prompt changes, model upgrades) and unfalsifiable historically. It is closer to discretionary than to a rule.

**Verdict on #7: forward-only.** Honest classification — it is testable *going forward* but not *backward*, and must never be promoted on backtest evidence.

### Concrete FORWARD-test design (the right way to evaluate #7)

Make it a mechanical, logged, paper-only experiment so it earns promotion the same way every other broker does:

- **Universe:** fixed list of ~15 liquid tech leaders (AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, AVGO, AMD, etc.) — frozen up front so there's no universe-fishing.
- **Daily signal (mechanical):** for each ticker, pull Polygon news for the last 24h with `insights`. Conviction = signed average of `insights.sentiment` (positive=+1/neutral=0/negative=−1) weighted by publisher count, clipped to [−1, +1]. Optionally pass the headlines to Claude (structured output: `{conviction: -1..1, rationale}`) and **log both the raw-insight score and the LLM score** so we can later see if the LLM adds anything over the free aggregate.
- **Entry:** long when conviction ≥ +0.4; **exit/flat** when conviction < +0.1 or after N=5 trading days, whichever first.
- **Sizing:** conviction-proportional, fractional-Kelly-capped via `server/risk/kellySizing.js`; per-name cap 10%, gross cap 100%, long-only (no shorting on a sentiment signal — that's how you blow up).
- **Cadence:** evaluate at the open daily; trade once.
- **Cost:** net every trade through `require('server/risk/transactionCost.js').bpsPerSide(sym)` (5 bps/side for these large caps).
- **Benchmark, live:** track the book vs **buy-and-hold QQQ AND SPY** in real time (since the universe IS tech megacaps, QQQ is the honest beta benchmark — beating QQQ on raw return is *not* edge).
- **Promotion gate:** ≥6 months of paper trading, and it must beat **QQQ on risk-adjusted (Sharpe / return-per-maxDD)**, not just on return. Until it spans at least one risk-off episode, treat any outperformance as unproven beta.
- **Pre-commit the kill criteria:** if 6-mo Sharpe < QQQ Sharpe, or maxDD > QQQ maxDD, it's killed — written down now so we can't rationalize later.

This converts #7 from "vibes" into a falsifiable forward experiment without ever pretending we backtested it.

---

## Recommended 2-3 highest-value data additions (the deliverable)

1. **FRED macro regime gate** *(free key, decades of history, true cross-regime signal)* — **build first.** Highest probability of producing real, drawdown-reducing edge and directly attacks the "fails in 2022" weakness. Add `FRED_API_KEY` to `.env`; wire DGS10−DGS2 + HY spread (BAMLH0A0HYM2) into a `server/strategies/macroRegimeGate.js`-style overlay (read-only proposal — not implemented here).
2. **UW short-interest / borrow-fee** (`/api/shorts/:sym/data`) — already paid for, real time series, distinct mechanism from the killed signals. Worth a dedicated multi-regime backtest before trusting.
3. **Polygon fundamentals** (`vX/reference/financials`) — already paid for, deep history, quality/value factors are the most bear-market-durable known edges. Build a quality screen using `filing_date` to avoid look-ahead.

**Explicitly do NOT add (or only forward-test):** Polygon news sentiment, options IV/skew/greeks, congressional trades, social/alt-data — all are either recent-bull-only, too shallow, lagged, or in the same fragile family as the two signals we just killed.

---

## How to build it as a broker plugin

Two separate deliverables:

**A) Backtestable: FRED macro gate (broker overlay, not a standalone strategy)**
- *Universe:* applies to any existing broker's universe (it's a gate, not a picker).
- *Entry/Hold:* risk-on (allow normal entries) when curve slope > threshold AND HY spread below its 6-mo MA. *Risk-off:* force flat / cut gross to 25% when HY spread spikes >X bps over its MA or curve deeply inverts.
- *Sizing:* multiply existing position sizes by a regime scalar ∈ {1.0 risk-on, 0.25 risk-off}.
- *Cadence:* re-evaluate daily on macro release (respect publication lag).

**B) Forward-only: "Tech Mogul" sentiment broker (paper-tier, promotion-gated)**
- *Universe:* frozen ~15 tech leaders.
- *Entry:* conviction ≥ +0.4 from Polygon `insights` (+ optional Claude score), long-only.
- *Exit:* conviction < +0.1 or 5-day timeout.
- *Sizing:* conviction-weighted, fractional-Kelly capped, 10%/name, 100% gross.
- *Cadence:* daily at open. Logged vs QQQ+SPY. **Never promoted on backtest — only on ≥6-mo live risk-adjusted outperformance of QQQ.**

---

## Honest verdict

- **Idea #4 (new data):** real edge candidates exist — **FRED macro (build), short interest (test), fundamentals (build)**. The flashy ones (news sentiment, options flow, congress) are mirages or unbacktestable.
- **Idea #7 (Tech Mogul):** **forward-only.** Systematizable, but not historically backtestable — the labeled sentiment data starts inside the current bull, so any backtest is the same recent-bull lie we're trying to avoid. Build it as a logged, QQQ-benchmarked, promotion-gated paper experiment, never trust a backtest of it.
