# How to create, backtest, visualize, and judge a new strategy

The pipeline in one sentence: you write a function that turns historical
bars into **daily returns**, the foundation runs it through five honesty
gates, emits a `run.json` artifact, and the viewers render exactly what the
sim computed. You never fetch data, compute Sharpe, or judge significance
yourself — that's the part people fool themselves with, so it's centralized.

## 0. The mental model

```
lib/marketData  ──►  your candidates  ──►  validateStrategy()  ──►  run.json  ──►  viewers
(real Alpaca     ({params, returns[]}    (5 gates, walk-forward,   (the source   (terminal + web,
 adjusted bars,   one per config)         trials ledger)            of truth)     no recomputation)
 sanity-checked)
```

## 1. Create the strategy (copy a template)

Copy the closest validator and edit:
- `validate-trend.js` — portfolio with positions/slots and an exact dollar ledger
- `validate-xs-momentum.js` — monthly-rebalanced weight portfolio (simpler)

Your job is one function: `buildCandidates({dates, series, bars, costMultiplier})`
returning `[{ params, returns }]` where `returns[i]` is the strategy's simple
return on calendar day `i` (null before warmup). Iron rules:

1. **No look-ahead:** the position held into day `i` may only use data
   through day `i-1`. Trades execute at day `i`'s close.
2. **Charge costs** on every position change: `bpsPerSide(symbol)/10000 *
   costMultiplier` per side (the 2x-cost gate passes `costMultiplier: 2`).
3. **The whole config grid goes in `candidates`** — every parameter combo you
   try is a lottery ticket and gets recorded in the trials ledger. Don't
   pre-screen by eyeballing results; that's the bias the ledger exists to count.
4. Decision logic you might someday run live belongs in a pure function in
   `packages/quant-core/` from day one (see `trendCore.js`).

## 2. Tune configs — walk-forward does it, not you

Don't pick parameters from the full-period table. `validateStrategy()` picks
per fold on TRAIN data only (3y train, 21-day embargo, 6-month test) and the
headline equity is the stitched TEST segments. Two modes:

- **Tunable strategy:** pass the grid as candidates; walk-forward selects.
- **Fixed spec** (e.g. a deployed broker rule): pass ONE candidate and record
  a neighbor-parameter sensitivity table separately (see validate-trend.js) —
  it shows whether the result is a parameter island (bad) or a plateau (good).

## 3. Run it

```bash
node scripts/backtests/validate-<your-strategy>.js
```

It prints the five gate results and writes artifacts to
`data/backtests/runs/<runId>/run.json`.

## 4. Look at it

```bash
npm run backtest:view                      # list runs
npm run backtest:view <runId>              # verdict, equity vs benchmark, drawdown,
                                           #   candles with ▲buy/▼sell, trade log
npm run backtest:view <runId> -- --replay  # animate day by day
```

Web: open `/backtest` (server must be running). Same artifact, richer charts.

## 5. Judge it — read the gates, not the curve

The verdict is the assessment. In order:

| Gate | Question it answers | Failure smells like |
|---|---|---|
| dataIntegrity | Is the data real and correctly adjusted? | contaminated ticker, fake split, silent history floor |
| faithfulness | Is the tested logic the deployed logic? | backtest reimplements the plugin "approximately" |
| outOfSample | Does it make money on data it never tuned on? | great in-sample table, OOS Sharpe ≤ 0 |
| realisticCosts | Does the edge survive 2x trading costs? | edge thinner than the spread |
| multipleTesting | Is it better than the luckiest of N tries? | deflated-Sharpe < 95% given the ledger N |

Also check, inside the artifact / viewer footer:
- **Reconciliation:** trade ledger must tie to the equity curve (gap ≈ $0 for
  exact-ledger sims; weight-based sims report their approximation honestly).
- **Benchmark on identical dates** — beat the right control (for selection
  strategies, a survivorship-matched EW-all, not just SPY).
- **notes[]** — every known caveat is listed there on purpose.

`UNVALIDATED` = some gate lacks evidence (often faithfulness: nothing
deployable shares the core yet). `FAILED:<gate>` = tested and didn't survive.
Both are fine outcomes — the only bad outcome is believing a curve that never
faced the gates.

## 6. If it survives: make it live + certified

1. Extract the decision into `packages/quant-core/src/<x>Core.js` (pure).
2. Write a thin plugin in `server/strategies/` (fetch + config translation
   only) and register it in `server/strategies/index.js`.
3. Write `scripts/backtests/certify-<x>-core.js` proving plugin ≡ core on
   historical closes; wire `faithfulness: { certification: '<x>-core' }`.
4. Hire a sim-tier broker (`/hire-broker`) running the plugin. Sim P&L is the
   forward out-of-sample test. Promotion rules live in ROADMAP.md.

## FAQ

**Is this real market data?** Yes — Alpaca daily OHLCV, split+dividend
adjusted, 2016→T-3d, real NYSE calendar (holidays absent, COVID crash days
present). Cross-checked against Polygon by the integrity gate; vendor faults
get caught (it found Polygon's contaminated META). Cached in
`data/backtests/bars-cache/`.

**Why so few trades?** Daily-resolution position strategies trade rarely by
design: the deployed trend spec does ~42 trades/year across 18 symbols
(holds last months); a 50/200 cross on one symbol does ~1/year. Statistical
power comes from ~2,400 daily return observations, not the trade count. An
intraday strategy would trade far more — but every round trip pays ~10bps,
and the audit showed most intraday "edges" here lived inside that cost band.

**How do I verify a backtest isn't lying?** Open the artifact and recompute:
pick any trade, take `bars` up to the day BEFORE the trade date, recompute
the signal (e.g. SMA200), confirm the reason and that the fill equals that
day's close. Everything needed is inside the one JSON file by design.
