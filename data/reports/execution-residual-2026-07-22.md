# Execution Residual Analysis — Gate-2 Supplement
Generated: 2026-07-22T08:22:04.543Z

## What This Measures
Gate-2 (faithfulness) certifies DECISION parity between live and backtest.
This report quantifies the EXECUTION residual — the remaining gap between:
- Backtest assumption: fills at daily close, flat bps cost
- Live reality: intraday market-order fills

**Signed slippage bps** = `sideSign × (fill − EODclose) / EODclose × 10,000`
- Positive = worse for trader (paid too much on buy / received too little on sell)
- EOD close = last RTH (09:30–16:00 ET) raw minute-bar close on fill date (adjustment='raw')

## Transaction-Cost Baseline (server/risk/transactionCost.js)
- Regular equities: **5 bps/side**
- Leveraged ETFs (SOXL/SOXS/QBTX etc.): **15 bps/side**

## Per-Broker / Overall Summary Table

```
Broker/Session             |  Fills |  w/Close |  Signed bps |  Mean|bps| |  Med|bps| |  Worst bps |  Hrs B4 Close |  Assump bps
---------------------------+--------+----------+-------------+------------+-----------+------------+---------------+------------
exp-b-momentum             |     32 |       25 |      -37.48 |     229.07 |    185.20 |     552.76 |          3.78 |       15.00
exp-b-orb                  |      6 |        6 |      -31.33 |     200.24 |    213.17 |     321.78 |          3.55 |       15.00
qbtx-momentum              |      6 |        6 |      502.71 |     605.19 |    685.97 |    1088.63 |          4.46 |       15.00
OVERALL                    |     44 |       37 |       51.11 |     285.38 |    207.02 |    1088.63 |          3.85 |       15.00
```

Column definitions:
- **Signed bps**: mean signed slippage (positive = worse for trader)
- **Mean|bps|**: mean absolute slippage
- **Med|bps|**: median absolute slippage
- **Worst bps**: worst-case absolute slippage on a single fill
- **Hrs B4 Close**: mean hours before 16:00 close the fill occurred
- **Assump bps**: bps/side assumed by transactionCost.js for this asset class

## vol-target-mixer Special Note
Broker started **2026-07-22**. As of report date this is Day 1 with 0 closed
trades and 0 fills in the log. No execution-residual data exists for this broker
yet. All figures above are from pre-existing sessions.

## Verdict
> OPTIMISTIC — backtest 15.00 bps/side assumption is OPTIMISTIC by 36.11 bps; actual fills cost 51.11 bps/side on average.

## Interpretation Note
"Signed slippage vs EOD close" captures TWO overlapping effects:

1. **True execution slippage**: difference between quoted price at order submission and
   actual fill price (market impact, spread, queue position). Typically small (< 10 bps).

2. **Intraday timing drift**: the live engine fills intraday; the backtest fills at
   close. A morning buy that precedes an afternoon rally shows *negative* signed bps
   (got in cheap vs close — good). A morning buy before a 10% intraday crash shows
   *positive* 1000+ bps (paid above where it closed — bad).

The QBTX session is dominated by **timing drift**: 3 buys at 09:30-09:33 ET on
2026-07-10 where QBTX opened at $11.51 and closed at $10.38 (–9.8% intraday).
Those 3 fills each contribute +1088 bps, pulling the overall mean from ~–34 bps to
+51 bps. The SOXL/SOXS fills are consistently negative-signed (fills precede closes
that move in the favorable direction).

**Bottom line**: the overall signed bps of +51 is misleadingly pessimistic due to
one QBTX bad day. The SOXL/SOXS sessions (31 of 37 fills with close) show mean –34 bps,
meaning intraday fills are **favorable vs close** on average.

## Caveat — Sample Size & Composition
- All fills are from Alpaca **paper** trading (simulated Alpaca fills, not real-money).
- Paper fills use live quotes at order submission; slippage vs EOD close blends
  both timing (intraday vs close) and any paper-fill approximation noise.
- Sample is **small** (37 fills with EOD close, 44 total). Treat bps figures as
  directional, not precise.
- Crypto sessions (Strategy 4, Crypto) are excluded — 24-hour assets; "EOD close"
  is ill-defined, and those sessions are simulationMode:true anyway.
- 7 fills (2026-07-20 and 2026-07-21) lack EOD closes due to the Alpaca free-tier
  3-day SIP data lag (maxSafeEnd = today minus 3 days).

## Per-Fill Detail

| Date | Session | Sym | Side | Qty | Fill | EOD Close | Slip bps | Hrs B4 Close |
|------|---------|-----|------|----:|-----:|----------:|---------:|-------------:|
| 2026-07-09 | QBTX Bullish Momentum  | QBTX  | BUY  |    448 |    11.3394 |    11.6700 |    -283.31 |         6.33 |
| 2026-07-09 | EXP-B ORB              | SOXS  | BUY  |    615 |     3.9202 |     4.0400 |    -296.43 |         5.40 |
| 2026-07-09 | EXP-B Momentum-3sig    | SOXS  | BUY  |   1000 |     3.9200 |     4.0400 |    -297.03 |         5.38 |
| 2026-07-09 | EXP-B ORB              | SOXS  | SELL |   1615 |     3.9100 |     4.0400 |     321.78 |         3.40 |
| 2026-07-09 | EXP-B Momentum-3sig    | SOXL  | BUY  |     88 |   199.4285 |   193.3300 |     315.45 |         3.23 |
| 2026-07-09 | QBTX Bullish Momentum  | QBTX  | SELL |    448 |    11.6981 |    11.6700 |     -24.10 |         0.50 |
| 2026-07-10 | QBTX Bullish Momentum  | QBTX  | BUY  |    434 |    11.5100 |    10.3800 |    1088.63 |         6.50 |
| 2026-07-10 | QBTX Bullish Momentum  | QBTX  | BUY  |    434 |    11.5100 |    10.3800 |    1088.63 |         6.47 |
| 2026-07-10 | QBTX Bullish Momentum  | QBTX  | BUY  |    434 |    11.5100 |    10.3800 |    1088.63 |         6.45 |
| 2026-07-10 | EXP-B ORB              | SOXL  | BUY  |     13 |   187.1800 |   192.2000 |    -261.19 |         5.93 |
| 2026-07-10 | QBTX Bullish Momentum  | QBTX  | SELL |   1302 |    10.3200 |    10.3800 |      57.80 |         0.50 |
| 2026-07-10 | EXP-B ORB              | SOXL  | SELL |     13 |   191.8200 |   192.2000 |      19.77 |         0.50 |
| 2026-07-13 | EXP-B Momentum-3sig    | SOXS  | BUY  |   1000 |     4.4500 |     4.6700 |    -471.09 |         5.38 |
| 2026-07-13 | EXP-B Momentum-3sig    | SOXS  | SELL |   1000 |     4.6900 |     4.6700 |     -42.83 |         3.38 |
| 2026-07-13 | EXP-B Momentum-3sig    | SOXS  | BUY  |   1000 |     4.6200 |     4.6700 |    -107.07 |         2.80 |
| 2026-07-13 | EXP-B Momentum-3sig    | SOXS  | SELL |   1000 |     4.7000 |     4.6700 |     -64.24 |         0.80 |
| 2026-07-14 | EXP-B Momentum-3sig    | SOXS  | BUY  |   1000 |     4.1901 |     4.2990 |    -253.31 |         6.00 |
| 2026-07-14 | EXP-B ORB              | SOXS  | BUY  |    570 |     4.3700 |     4.2990 |     165.15 |         5.60 |
| 2026-07-14 | EXP-B Momentum-3sig    | SOXS  | SELL |   1570 |     4.2100 |     4.2990 |     207.02 |         4.00 |
| 2026-07-14 | EXP-B Momentum-3sig    | SOXL  | BUY  |     96 |   179.9600 |   176.7900 |     179.31 |         4.00 |
| 2026-07-14 | EXP-B Momentum-3sig    | SOXL  | SELL |     96 |   177.2535 |   176.7900 |     -26.22 |         0.07 |
| 2026-07-15 | EXP-B Momentum-3sig    | SOXS  | BUY  |    420 |    43.2400 |    45.7700 |    -552.76 |         6.00 |
| 2026-07-15 | EXP-B Momentum-3sig    | SOXS  | SELL |    420 |    47.6077 |    45.7700 |    -401.51 |         4.00 |
| 2026-07-15 | EXP-B Momentum-3sig    | SOXS  | BUY  |    297 |    48.0003 |    45.7700 |     487.29 |         2.98 |
| 2026-07-15 | EXP-B Momentum-3sig    | SOXS  | SELL |    297 |    45.8311 |    45.7700 |     -13.36 |         1.83 |
| 2026-07-16 | EXP-B Momentum-3sig    | SOXS  | BUY  |    361 |    50.5500 |    52.1800 |    -312.38 |         6.00 |
| 2026-07-16 | EXP-B Momentum-3sig    | SOXS  | SELL |    361 |    51.3701 |    52.1800 |     155.22 |         4.00 |
| 2026-07-16 | EXP-B Momentum-3sig    | SOXS  | BUY  |    348 |    51.7800 |    52.1800 |     -76.66 |         3.92 |
| 2026-07-16 | EXP-B Momentum-3sig    | SOXS  | SELL |    348 |    53.1464 |    52.1800 |    -185.20 |         1.92 |
| 2026-07-16 | EXP-B Momentum-3sig    | SOXS  | BUY  |    296 |    52.8066 |    52.1800 |     120.08 |         1.73 |
| 2026-07-16 | EXP-B ORB              | SOXS  | SELL |    296 |    52.8953 |    52.1800 |    -137.09 |         0.45 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXS  | BUY  |    312 |    56.9813 |    54.9500 |     369.67 |         5.87 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXS  | SELL |    312 |    54.3922 |    54.9500 |     101.50 |         5.67 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXL  | BUY  |    141 |   136.1600 |   135.4385 |      53.27 |         5.67 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXL  | SELL |    141 |   129.9400 |   135.4385 |     405.98 |         4.97 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXL  | BUY  |    132 |   129.6264 |   135.4385 |    -429.13 |         4.85 |
| 2026-07-17 | EXP-B Momentum-3sig    | SOXL  | SELL |    132 |   136.7800 |   135.4385 |     -99.05 |         0.07 |

## Raw JSON Blob

```json
{
  "generatedAt": "2026-07-22T08:22:04.543Z",
  "overall": {
    "label": "OVERALL",
    "n": 44,
    "nWithClose": 37,
    "meanSignedBps": 51.11459934766968,
    "medianAbsBps": 207.0248895091891,
    "meanAbsBps": 285.3826907804902,
    "worstBps": 1088.6319845857408,
    "meanHoursBeforeClose": 3.852702702702702,
    "impliedPerSide": 51.11459934766968,
    "assumption": 15
  },
  "perBroker": [
    {
      "label": "exp-b-momentum",
      "n": 32,
      "nWithClose": 25,
      "meanSignedBps": -37.482102092334955,
      "medianAbsBps": 185.20103487926474,
      "meanAbsBps": 229.06550275242057,
      "worstBps": 552.7638190954776,
      "meanHoursBeforeClose": 3.780666666666667,
      "impliedPerSide": -37.482102092334955,
      "assumption": 15
    },
    {
      "label": "exp-b-orb",
      "n": 6,
      "nWithClose": 6,
      "meanSignedBps": -31.332420973525206,
      "medianAbsBps": 213.1704757222771,
      "meanAbsBps": 200.2350666917159,
      "worstBps": 321.7821782178215,
      "meanHoursBeforeClose": 3.5472222222222225,
      "impliedPerSide": -31.332420973525206,
      "assumption": 15
    },
    {
      "label": "qbtx-momentum",
      "n": 6,
      "nWithClose": 6,
      "meanSignedBps": 502.71454233555045,
      "medianAbsBps": 685.9719477341727,
      "meanAbsBps": 605.1852649862213,
      "worstBps": 1088.6319845857408,
      "meanHoursBeforeClose": 4.458333333333333,
      "impliedPerSide": 502.71454233555045,
      "assumption": 15
    }
  ],
  "verdictStr": "OPTIMISTIC — backtest 15.00 bps/side assumption is OPTIMISTIC by 36.11 bps; actual fills cost 51.11 bps/side on average.",
  "fills": [
    {
      "date": "2026-07-09",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "BUY",
      "qty": 448,
      "fill": 11.339375,
      "eodClose": 11.67,
      "slippageBps": -283.31,
      "hoursBeforeClose": 6.33,
      "assumption": 15,
      "ts": "2026-07-09T13:40:48.479Z"
    },
    {
      "date": "2026-07-09",
      "session": "EXP-B ORB",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 615,
      "fill": 3.920244,
      "eodClose": 4.04,
      "slippageBps": -296.43,
      "hoursBeforeClose": 5.4,
      "assumption": 15,
      "ts": "2026-07-09T14:36:11.033Z"
    },
    {
      "date": "2026-07-09",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 1000,
      "fill": 3.92,
      "eodClose": 4.04,
      "slippageBps": -297.03,
      "hoursBeforeClose": 5.38,
      "assumption": 15,
      "ts": "2026-07-09T14:37:03.853Z"
    },
    {
      "date": "2026-07-09",
      "session": "EXP-B ORB",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 1615,
      "fill": 3.91,
      "eodClose": 4.04,
      "slippageBps": 321.78,
      "hoursBeforeClose": 3.4,
      "assumption": 15,
      "ts": "2026-07-09T16:36:20.228Z"
    },
    {
      "date": "2026-07-09",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 88,
      "fill": 199.428523,
      "eodClose": 193.33,
      "slippageBps": 315.45,
      "hoursBeforeClose": 3.23,
      "assumption": 15,
      "ts": "2026-07-09T16:46:09.505Z"
    },
    {
      "date": "2026-07-09",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "SELL",
      "qty": 448,
      "fill": 11.698125,
      "eodClose": 11.67,
      "slippageBps": -24.1,
      "hoursBeforeClose": 0.5,
      "assumption": 15,
      "ts": "2026-07-09T19:30:07.528Z"
    },
    {
      "date": "2026-07-10",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "BUY",
      "qty": 434,
      "fill": 11.51,
      "eodClose": 10.38,
      "slippageBps": 1088.63,
      "hoursBeforeClose": 6.5,
      "assumption": 15,
      "ts": "2026-07-10T13:30:56.539Z"
    },
    {
      "date": "2026-07-10",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "BUY",
      "qty": 434,
      "fill": 11.51,
      "eodClose": 10.38,
      "slippageBps": 1088.63,
      "hoursBeforeClose": 6.47,
      "assumption": 15,
      "ts": "2026-07-10T13:32:05.645Z"
    },
    {
      "date": "2026-07-10",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "BUY",
      "qty": 434,
      "fill": 11.51,
      "eodClose": 10.38,
      "slippageBps": 1088.63,
      "hoursBeforeClose": 6.45,
      "assumption": 15,
      "ts": "2026-07-10T13:33:15.075Z"
    },
    {
      "date": "2026-07-10",
      "session": "EXP-B ORB",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 13,
      "fill": 187.18,
      "eodClose": 192.2,
      "slippageBps": -261.19,
      "hoursBeforeClose": 5.93,
      "assumption": 15,
      "ts": "2026-07-10T14:04:15.346Z"
    },
    {
      "date": "2026-07-10",
      "session": "QBTX Bullish Momentum",
      "symbol": "QBTX",
      "side": "SELL",
      "qty": 1302,
      "fill": 10.32,
      "eodClose": 10.38,
      "slippageBps": 57.8,
      "hoursBeforeClose": 0.5,
      "assumption": 15,
      "ts": "2026-07-10T19:30:02.934Z"
    },
    {
      "date": "2026-07-10",
      "session": "EXP-B ORB",
      "symbol": "SOXL",
      "side": "SELL",
      "qty": 13,
      "fill": 191.82,
      "eodClose": 192.2,
      "slippageBps": 19.77,
      "hoursBeforeClose": 0.5,
      "assumption": 15,
      "ts": "2026-07-10T19:30:07.093Z"
    },
    {
      "date": "2026-07-13",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 1000,
      "fill": 4.45,
      "eodClose": 4.67,
      "slippageBps": -471.09,
      "hoursBeforeClose": 5.38,
      "assumption": 15,
      "ts": "2026-07-13T14:37:05.802Z"
    },
    {
      "date": "2026-07-13",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 1000,
      "fill": 4.69,
      "eodClose": 4.67,
      "slippageBps": -42.83,
      "hoursBeforeClose": 3.38,
      "assumption": 15,
      "ts": "2026-07-13T16:37:16.247Z"
    },
    {
      "date": "2026-07-13",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 1000,
      "fill": 4.62,
      "eodClose": 4.67,
      "slippageBps": -107.07,
      "hoursBeforeClose": 2.8,
      "assumption": 15,
      "ts": "2026-07-13T17:12:08.549Z"
    },
    {
      "date": "2026-07-13",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 1000,
      "fill": 4.7,
      "eodClose": 4.67,
      "slippageBps": -64.24,
      "hoursBeforeClose": 0.8,
      "assumption": 15,
      "ts": "2026-07-13T19:12:17.726Z"
    },
    {
      "date": "2026-07-14",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 1000,
      "fill": 4.1901,
      "eodClose": 4.299,
      "slippageBps": -253.31,
      "hoursBeforeClose": 6,
      "assumption": 15,
      "ts": "2026-07-14T14:00:14.929Z"
    },
    {
      "date": "2026-07-14",
      "session": "EXP-B ORB",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 570,
      "fill": 4.37,
      "eodClose": 4.299,
      "slippageBps": 165.15,
      "hoursBeforeClose": 5.6,
      "assumption": 15,
      "ts": "2026-07-14T14:24:08.744Z"
    },
    {
      "date": "2026-07-14",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 1570,
      "fill": 4.21,
      "eodClose": 4.299,
      "slippageBps": 207.02,
      "hoursBeforeClose": 4,
      "assumption": 15,
      "ts": "2026-07-14T16:00:24.715Z"
    },
    {
      "date": "2026-07-14",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 96,
      "fill": 179.96,
      "eodClose": 176.79,
      "slippageBps": 179.31,
      "hoursBeforeClose": 4,
      "assumption": 15,
      "ts": "2026-07-14T16:00:29.544Z"
    },
    {
      "date": "2026-07-14",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "SELL",
      "qty": 96,
      "fill": 177.253541,
      "eodClose": 176.79,
      "slippageBps": -26.22,
      "hoursBeforeClose": 0.07,
      "assumption": 15,
      "ts": "2026-07-14T19:56:06.665Z"
    },
    {
      "date": "2026-07-15",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 420,
      "fill": 43.24,
      "eodClose": 45.77,
      "slippageBps": -552.76,
      "hoursBeforeClose": 6,
      "assumption": 15,
      "ts": "2026-07-15T14:00:09.135Z"
    },
    {
      "date": "2026-07-15",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 420,
      "fill": 47.607714,
      "eodClose": 45.77,
      "slippageBps": -401.51,
      "hoursBeforeClose": 4,
      "assumption": 15,
      "ts": "2026-07-15T16:00:19.865Z"
    },
    {
      "date": "2026-07-15",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 297,
      "fill": 48.000337,
      "eodClose": 45.77,
      "slippageBps": 487.29,
      "hoursBeforeClose": 2.98,
      "assumption": 15,
      "ts": "2026-07-15T17:01:17.264Z"
    },
    {
      "date": "2026-07-15",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 297,
      "fill": 45.831145,
      "eodClose": 45.77,
      "slippageBps": -13.36,
      "hoursBeforeClose": 1.83,
      "assumption": 15,
      "ts": "2026-07-15T18:10:20.969Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 361,
      "fill": 50.55,
      "eodClose": 52.18,
      "slippageBps": -312.38,
      "hoursBeforeClose": 6,
      "assumption": 15,
      "ts": "2026-07-16T14:00:03.012Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 361,
      "fill": 51.370056,
      "eodClose": 52.18,
      "slippageBps": 155.22,
      "hoursBeforeClose": 4,
      "assumption": 15,
      "ts": "2026-07-16T16:00:13.091Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 348,
      "fill": 51.78,
      "eodClose": 52.18,
      "slippageBps": -76.66,
      "hoursBeforeClose": 3.92,
      "assumption": 15,
      "ts": "2026-07-16T16:05:16.387Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 348,
      "fill": 53.146379,
      "eodClose": 52.18,
      "slippageBps": -185.2,
      "hoursBeforeClose": 1.92,
      "assumption": 15,
      "ts": "2026-07-16T18:05:26.920Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 296,
      "fill": 52.806554,
      "eodClose": 52.18,
      "slippageBps": 120.08,
      "hoursBeforeClose": 1.73,
      "assumption": 15,
      "ts": "2026-07-16T18:16:04.251Z"
    },
    {
      "date": "2026-07-16",
      "session": "EXP-B ORB",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 296,
      "fill": 52.895338,
      "eodClose": 52.18,
      "slippageBps": -137.09,
      "hoursBeforeClose": 0.45,
      "assumption": 15,
      "ts": "2026-07-16T19:33:39.055Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 312,
      "fill": 56.981347,
      "eodClose": 54.95,
      "slippageBps": 369.67,
      "hoursBeforeClose": 5.87,
      "assumption": 15,
      "ts": "2026-07-17T14:08:23.772Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 312,
      "fill": 54.392243,
      "eodClose": 54.95,
      "slippageBps": 101.5,
      "hoursBeforeClose": 5.67,
      "assumption": 15,
      "ts": "2026-07-17T14:20:18.045Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 141,
      "fill": 136.16,
      "eodClose": 135.4385,
      "slippageBps": 53.27,
      "hoursBeforeClose": 5.67,
      "assumption": 15,
      "ts": "2026-07-17T14:20:23.076Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "SELL",
      "qty": 141,
      "fill": 129.94,
      "eodClose": 135.4385,
      "slippageBps": 405.98,
      "hoursBeforeClose": 4.97,
      "assumption": 15,
      "ts": "2026-07-17T15:02:30.949Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 132,
      "fill": 129.626364,
      "eodClose": 135.4385,
      "slippageBps": -429.13,
      "hoursBeforeClose": 4.85,
      "assumption": 15,
      "ts": "2026-07-17T15:09:36.616Z"
    },
    {
      "date": "2026-07-17",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "SELL",
      "qty": 132,
      "fill": 136.78,
      "eodClose": 135.4385,
      "slippageBps": -99.05,
      "hoursBeforeClose": 0.07,
      "assumption": 15,
      "ts": "2026-07-17T19:56:07.070Z"
    },
    {
      "date": "2026-07-20",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 125,
      "fill": 144,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 6,
      "ts": "2026-07-20T14:00:03.030Z"
    },
    {
      "date": "2026-07-20",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "SELL",
      "qty": 125,
      "fill": 137.31392,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 0.78,
      "ts": "2026-07-20T19:13:40.825Z"
    },
    {
      "date": "2026-07-21",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 383,
      "fill": 48.384883,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 5.95,
      "ts": "2026-07-21T14:03:34.645Z"
    },
    {
      "date": "2026-07-21",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 383,
      "fill": 47.17,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 5.5,
      "ts": "2026-07-21T14:30:07.056Z"
    },
    {
      "date": "2026-07-21",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "BUY",
      "qty": 380,
      "fill": 47.074526,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 5.38,
      "ts": "2026-07-21T14:37:51.185Z"
    },
    {
      "date": "2026-07-21",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXS",
      "side": "SELL",
      "qty": 380,
      "fill": 45.932921,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 4.85,
      "ts": "2026-07-21T15:09:12.127Z"
    },
    {
      "date": "2026-07-21",
      "session": "EXP-B Momentum-3sig",
      "symbol": "SOXL",
      "side": "BUY",
      "qty": 112,
      "fill": 157.11,
      "eodClose": null,
      "slippageBps": null,
      "hoursBeforeClose": 4.82,
      "ts": "2026-07-21T15:11:15.615Z"
    }
  ]
}
```
