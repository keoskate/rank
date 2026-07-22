#!/usr/bin/env python3
"""Which RAW factor, if any, has cross-sectional edge on this universe?

The GBDT found no signal. Before blaming the model or the portfolio, ask the
prior question: does ANY single well-documented factor predict the cross-section
here? This trains nothing — it computes, for each month-start, the RankIC and
top-minus-bottom quintile forward return (to the next month-start) of a handful
of OHLCV-computable factors, averaged over the full sample.

No-lookahead: a factor at date d uses only bars <= d; the forward return is
d → next month-start (realized after d).

Factors (score orientation noted; higher score = expected higher forward return):
  mom_12_1   classic 12-1 momentum
  mom_1m     last-month return (momentum, short)
  rev_1m     short-term REVERSAL = -(last-month return)
  lowvol_63  low-volatility = -(trailing 63d vol)
  lowvol_126 low-volatility = -(trailing 126d vol)
  trend_ma   close/MA200 - 1 (trend)
  dist_hi    close/252d-high - 1 (proximity to highs)
  accel      1m return minus 3m avg monthly (acceleration)

Usage: python3 python/research/diagnose_factors.py
"""

import json
import math
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
UNIV = os.environ.get("RANK_UNIVERSE", "mega45")
RANK_DIR = os.path.normpath(
    os.path.join(HERE, "..", "..", "data", "rank-cache", UNIV)
)
BARS = os.path.join(RANK_DIR, "_bars.json")
META = os.path.join(RANK_DIR, "_meta.json")
ANNUALIZE = 12


def month_starts(dates):
    return [dates[i] for i in range(1, len(dates)) if dates[i][:7] != dates[i - 1][:7]]


def build_factor_panel(bars, bench, tradables):
    """Return dict: sym -> DataFrame(<factors>, close) for each rankable symbol,
    plus the master calendar (from the bench). Factors computed per symbol."""
    cal = [b["date"] for b in bars[bench]]
    pos = {d: i for i, d in enumerate(cal)}
    per_sym = {}
    for sym in tradables:
        rows = bars.get(sym)
        if not rows:
            continue
        df = pd.DataFrame(rows).set_index("date").sort_index()
        if len(df) < 260:
            continue
        c = df["close"]
        ret1 = c.pct_change()
        f = pd.DataFrame(index=df.index)
        f["mom_12_1"] = c.shift(21) / c.shift(252) - 1.0
        f["mom_1m"] = c.pct_change(21)
        f["rev_1m"] = -c.pct_change(21)
        f["lowvol_63"] = -ret1.rolling(63).std()
        f["lowvol_126"] = -ret1.rolling(126).std()
        f["trend_ma"] = c / c.rolling(200).mean() - 1.0
        f["dist_hi"] = c / c.rolling(252).max() - 1.0
        f["accel"] = c.pct_change(21) - (c.pct_change(63) / 3.0)
        f["close"] = c
        per_sym[sym] = f
    return per_sym, cal


FACTORS = [
    "mom_12_1",
    "mom_1m",
    "rev_1m",
    "lowvol_63",
    "lowvol_126",
    "trend_ma",
    "dist_hi",
    "accel",
]


def main():
    bars = json.load(open(BARS))
    meta = json.load(open(META)) if os.path.exists(META) else {}
    bench = meta.get("bench", "SPY")
    tradables = meta.get("tradables") or [s for s in bars if s != bench]
    per_sym, cal = build_factor_panel(bars, bench, tradables)
    reb = month_starts(cal)
    reb = [d for d in reb if d >= "2017-01-01"]  # warmup for 252d factors

    # close lookup per symbol
    close = {s: per_sym[s]["close"].to_dict() for s in per_sym}

    results = {f: {"ic": [], "spread": []} for f in FACTORS}

    for k in range(len(reb) - 1):
        d, nd = reb[k], reb[k + 1]
        # assemble cross-section at d with forward return to nd
        recs = []
        for s in per_sym:
            fdf = per_sym[s]
            if d not in fdf.index:
                continue
            row = fdf.loc[d]
            c0 = close[s].get(d)
            c1 = close[s].get(nd)
            if not c0 or not c1:
                continue
            rec = {"sym": s, "fwd": c1 / c0 - 1.0}
            for f in FACTORS:
                rec[f] = row[f]
            recs.append(rec)
        if len(recs) < 15:
            continue
        cs = pd.DataFrame(recs)
        rf = cs["fwd"].rank()
        n = len(cs)
        q = max(1, n // 5)
        for f in FACTORS:
            col = cs[f]
            if col.notna().sum() < 15:
                continue
            ic = col.rank().corr(rf)
            results[f]["ic"].append(ic)
            ds = cs.sort_values(f, ascending=False)
            results[f]["spread"].append(ds.head(q)["fwd"].mean() - ds.tail(q)["fwd"].mean())

    print(f"universe {len(per_sym)} names, {len(reb)-1} monthly periods {reb[0]}..{reb[-1]}\n")
    print(f"{'factor':<12}{'meanIC':>9}{'IC t':>8}{'IC>0%':>8}{'spread/mo':>11}{'ann':>8}{'LS Sharpe':>11}")
    print("-" * 67)
    rows = []
    for f in FACTORS:
        ic = np.array(results[f]["ic"])
        sp = np.array(results[f]["spread"])
        if len(ic) < 10:
            continue
        ic_t = ic.mean() / ic.std(ddof=1) * math.sqrt(len(ic)) if ic.std(ddof=1) else float("nan")
        ls_sharpe = sp.mean() / sp.std(ddof=1) * math.sqrt(ANNUALIZE) if sp.std(ddof=1) else float("nan")
        rows.append((f, ic.mean(), ic_t, (ic > 0).mean(), sp.mean(), ls_sharpe))
    # sort by |IC t|
    for f, icm, ict, icpos, spm, lss in sorted(rows, key=lambda r: -abs(r[2])):
        print(f"{f:<12}{icm:>+9.4f}{ict:>+8.2f}{icpos*100:>7.0f}%{spm*100:>+10.3f}%{spm*12*100:>+7.1f}%{lss:>+11.2f}")

    print("\nRead: |IC t| > ~2 and a same-signed L/S Sharpe > ~0.5 = a factor worth building on.")


if __name__ == "__main__":
    main()
