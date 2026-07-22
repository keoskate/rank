#!/usr/bin/env python3
"""Diagnose whether the OOS scores carry any cross-sectional signal.

Reads data/rank-cache/{_bars.json, scores.json} and, for each scored rebalance
date, measures how well the model's ranking predicts the realized forward return
to the NEXT rebalance (the actual holding period):

  * RankIC  — Spearman rank correlation of score vs forward return, per date.
  * Quintile spread — mean forward return of the top-20% by score minus the
    bottom-20%. This is the return of a naive dollar-neutral long/short book.

If mean RankIC and the quintile spread are ~0 (or negative), the model has no
exploitable cross-sectional edge on this universe/label and no portfolio
construction will rescue it — change features/label/universe instead. If they
are meaningfully positive, a long/short book should extract the edge.

Usage: python3 python/research/diagnose_scores.py
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
SCORES = os.path.join(RANK_DIR, "scores.json")

ANNUALIZE = 12  # monthly rebalances → months/yr for Sharpe


def main() -> None:
    bars = json.load(open(BARS))
    scores = json.load(open(SCORES))

    # per-symbol date->close
    close = {
        sym: {b["date"]: b["close"] for b in rows} for sym, rows in bars.items()
    }

    reb = sorted(scores.keys())
    ics, spreads, top_rets, bot_rets = [], [], [], []

    for k in range(len(reb) - 1):
        d, nd = reb[k], reb[k + 1]
        day = scores[d]
        rows = []
        for sym, sc in day.items():
            c0 = close.get(sym, {}).get(d)
            c1 = close.get(sym, {}).get(nd)
            if c0 and c1:
                rows.append((sym, sc, c1 / c0 - 1.0))
        if len(rows) < 10:
            continue
        df = pd.DataFrame(rows, columns=["sym", "score", "fwd"])
        # RankIC = Pearson corr of the ranks (Spearman)
        ic = df["score"].rank().corr(df["fwd"].rank())
        ics.append(ic)
        # quintiles by score
        n = len(df)
        q = max(1, n // 5)
        ds = df.sort_values("score", ascending=False)
        top = ds.head(q)["fwd"].mean()
        bot = ds.tail(q)["fwd"].mean()
        top_rets.append(top)
        bot_rets.append(bot)
        spreads.append(top - bot)

    ics = np.array(ics)
    spreads = np.array(spreads)
    top_rets = np.array(top_rets)
    bot_rets = np.array(bot_rets)

    def sharpe(x):
        return x.mean() / x.std(ddof=1) * math.sqrt(ANNUALIZE) if x.std(ddof=1) else float("nan")

    ic_t = ics.mean() / ics.std(ddof=1) * math.sqrt(len(ics)) if ics.std(ddof=1) else float("nan")

    print(f"periods evaluated        : {len(ics)}  ({reb[0]}..{reb[-1]})")
    print(f"mean RankIC              : {ics.mean():+.4f}   (IC t-stat {ic_t:+.2f}, IC>0 in {(ics>0).mean()*100:.0f}% of months)")
    print(f"top-quintile fwd ret/mo  : {top_rets.mean()*100:+.3f}%")
    print(f"bottom-quintile fwd ret  : {bot_rets.mean()*100:+.3f}%")
    print(f"L/S quintile spread/mo   : {spreads.mean()*100:+.3f}%   (annualized ~{spreads.mean()*12*100:+.1f}%)")
    print(f"L/S spread Sharpe (gross): {sharpe(spreads):+.2f}")
    print()
    if ics.mean() > 0.02 and spreads.mean() > 0:
        print("→ signal present: a long/short book is worth validating.")
    elif ics.mean() > 0:
        print("→ weak/marginal signal: long/short may help but expect thin edge; consider universe/label changes.")
    else:
        print("→ NO cross-sectional signal on this universe/label: change features/label/universe, not portfolio construction.")


if __name__ == "__main__":
    main()
