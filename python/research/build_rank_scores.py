#!/usr/bin/env python3
"""Phase 1 — GBDT cross-sectional ranker (offline score producer).

Reads the SAME Alpaca split+dividend-adjusted daily bars the Node backtest uses
(exported to data/rank-cache/_bars.json by scripts/backtests/export-bars-for-rank.js)
and writes out-of-sample cross-sectional scores to data/rank-cache/scores.json.

The model is a LightGBM regressor over an Alpha158-style factor set, predicting the
cross-sectionally z-scored forward return. Scores are genuinely out-of-sample by
construction:

  * EXPANDING-WINDOW RETRAIN. For a prediction as-of month-start R, the model is
    trained only on rows whose forward-label window has fully closed at least
    EMBARGO trading days before R. A row at trading-day index p carries a label
    spanning (p, p+H]; it is usable to predict at index r only if p + H <= r - EMBARGO.
    Nothing the model trains on can peek past R.
  * The Node validator then runs the usual five gates ON TOP of these OOS scores
    (walk-forward selects top-N / holding params; 2x-cost stress; deflated Sharpe).
    So there are two independent OOS layers: the model (here) and the portfolio
    params (validateStrategy).

Determinism (required for the faithfulness contract — same inputs must yield a
byte-identical scores.json): fixed seed, single-threaded, deterministic LightGBM.

Usage:
    python3 python/research/build_rank_scores.py
"""

import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
except ImportError:  # pragma: no cover - guidance path
    sys.stderr.write(
        "lightgbm not installed. Run:\n"
        "  python3 -m venv python/research/.venv && "
        "python/research/.venv/bin/pip install -r python/research/requirements.txt\n"
    )
    raise

# ---------------------------------------------------------------- config
HERE = os.path.dirname(os.path.abspath(__file__))
UNIV = os.environ.get("RANK_UNIVERSE", "mega45")
RANK_DIR = os.path.normpath(
    os.path.join(HERE, "..", "..", "data", "rank-cache", UNIV)
)
BARS_PATH = os.path.join(RANK_DIR, "_bars.json")
META_PATH = os.path.join(RANK_DIR, "_meta.json")
SCORES_PATH = os.path.join(RANK_DIR, "scores.json")
MODEL_META_PATH = os.path.join(RANK_DIR, "model-meta.json")

LABEL_HORIZON = 21     # forward trading days (~1 month rebalance)
EMBARGO = 5            # trading days between train-label close and prediction
RETRAIN_EVERY_MONTHS = 3
MIN_TRAIN_ROWS = 500
MIN_HISTORY = 260      # bars needed before the long (252d) factors are valid
SEED = 42

# Native lgb.train API (no scikit-learn dependency; explicit determinism).
NUM_BOOST_ROUND = 300
LGB_PARAMS = dict(
    objective="regression",
    learning_rate=0.03,
    num_leaves=31,
    max_depth=-1,
    min_data_in_leaf=50,
    bagging_fraction=0.8,
    bagging_freq=1,
    feature_fraction=0.8,
    lambda_l2=1.0,
    seed=SEED,
    bagging_seed=SEED,
    feature_fraction_seed=SEED,
    num_threads=1,
    deterministic=True,
    force_row_wise=True,
    verbose=-1,
)


# ---------------------------------------------------------------- features
def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0.0)
    down = (-delta).clip(lower=0.0)
    roll_up = up.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    roll_down = down.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    rs = roll_up / roll_down.replace(0.0, np.nan)
    return 100.0 - 100.0 / (1.0 + rs)


def build_features(df: pd.DataFrame, bench_ret21: pd.Series) -> pd.DataFrame:
    """Alpha158-style factor subset for one symbol. All columns at row d use only
    bars with date <= d (no lookahead); the forward label is added separately."""
    c = df["close"]
    v = df["volume"].astype(float)
    ret1 = c.pct_change()

    feat = pd.DataFrame(index=df.index)
    # rate-of-change over multiple windows
    for k in (1, 5, 10, 21, 63, 126, 252):
        feat[f"roc{k}"] = c.pct_change(k)
    # 12-1 momentum (skip the most recent month)
    feat["mom12_1"] = c.shift(21) / c.shift(252) - 1.0
    # moving-average ratios
    for k in (5, 10, 20, 50, 200):
        feat[f"ma{k}"] = c / c.rolling(k).mean() - 1.0
    # realized volatility
    for k in (21, 63, 126):
        feat[f"vol{k}"] = ret1.rolling(k).std()
    # volume factors
    vol_ma20 = v.rolling(20).mean()
    feat["vlog"] = np.log((v + 1.0) / (vol_ma20 + 1.0))
    feat["vstd"] = v.rolling(20).std() / (vol_ma20 + 1.0)
    # intraday range
    feat["range10"] = ((df["high"] - df["low"]) / c).rolling(10).mean()
    # distance from trailing 252d extremes
    feat["dist_hi"] = c / c.rolling(252).max() - 1.0
    feat["dist_lo"] = c / c.rolling(252).min() - 1.0
    # momentum + RSI
    feat["rsi14"] = rsi(c, 14) / 100.0
    # market-relative 21d return (excess over SPY)
    feat["exc21"] = c.pct_change(21) - bench_ret21
    return feat


FEATURE_COLS = None  # set after first build


def month_starts(dates: list) -> list:
    """First trading day of each month — matches Node rebalanceIndices()."""
    out = []
    for i in range(1, len(dates)):
        if dates[i][:7] != dates[i - 1][:7]:
            out.append(dates[i])
    return out


# ---------------------------------------------------------------- main
def main() -> None:
    if not os.path.exists(BARS_PATH):
        sys.stderr.write(
            f"missing {BARS_PATH}\nRun: node scripts/backtests/export-bars-for-rank.js\n"
        )
        sys.exit(1)

    with open(BARS_PATH) as fh:
        raw = json.load(fh)
    meta_in = json.load(open(META_PATH)) if os.path.exists(META_PATH) else {}
    BENCH = meta_in.get("bench", "SPY")

    if BENCH not in raw:
        sys.stderr.write(f"exported bars missing benchmark {BENCH}\n")
        sys.exit(1)

    # Master trading calendar from the benchmark; integer index per date.
    cal = [b["date"] for b in raw[BENCH]]
    pos = {d: i for i, d in enumerate(cal)}

    bench_df = pd.DataFrame(raw[BENCH]).set_index("date").sort_index()
    bench_ret21 = bench_df["close"].pct_change(21)
    bench_ret21.index = bench_df.index

    # Tradables come from the exporter's _meta.json (the bench may or may not be
    # rankable depending on the universe); fall back to "all but bench".
    tradables = sorted(
        meta_in.get("tradables") or [s for s in raw.keys() if s != BENCH]
    )

    global FEATURE_COLS
    frames = []
    for sym in tradables:
        df = pd.DataFrame(raw[sym]).set_index("date").sort_index()
        if len(df) < MIN_HISTORY:
            continue
        bench_aligned = bench_ret21.reindex(df.index)
        feat = build_features(df, bench_aligned)
        if FEATURE_COLS is None:
            FEATURE_COLS = list(feat.columns)
        # forward label: return over the next LABEL_HORIZON trading days
        fwd = df["close"].shift(-LABEL_HORIZON) / df["close"] - 1.0
        feat["label_raw"] = fwd
        feat["sym"] = sym
        feat["date"] = df.index
        feat["cpos"] = [pos.get(d, -1) for d in df.index]
        frames.append(feat)

    panel = pd.concat(frames, ignore_index=True)
    panel = panel[panel["cpos"] >= 0].copy()

    # Cross-sectional z-score of the forward label within each date: the model
    # learns to rank names against the same-day cross-section, not to predict the
    # market's absolute drift.
    grp = panel.groupby("date")["label_raw"]
    panel["label"] = (panel["label_raw"] - grp.transform("mean")) / grp.transform(
        "std"
    ).replace(0.0, np.nan)

    feature_ok = panel[FEATURE_COLS].notna().all(axis=1)

    reb_dates = [d for d in month_starts(cal)]
    reb_positions = {d: pos[d] for d in reb_dates}

    scores: dict = {}
    model = None
    trained_at = None
    n_retrains = 0
    reb_used = []

    # order rebalances chronologically
    reb_sorted = sorted(reb_dates, key=lambda d: pos[d])
    months_since_train = RETRAIN_EVERY_MONTHS  # force a train attempt on first eligible

    for R in reb_sorted:
        r = reb_positions[R]

        # training mask: label window closed with embargo before R
        train_mask = (
            (panel["cpos"] + LABEL_HORIZON) <= (r - EMBARGO)
        ) & feature_ok & panel["label"].notna()
        n_train = int(train_mask.sum())

        need_retrain = (
            model is None or months_since_train >= RETRAIN_EVERY_MONTHS
        )
        if need_retrain and n_train >= MIN_TRAIN_ROWS:
            tr = panel[train_mask]
            dset = lgb.Dataset(
                tr[FEATURE_COLS].values,
                label=tr["label"].values,
                free_raw_data=False,
            )
            model = lgb.train(
                LGB_PARAMS, dset, num_boost_round=NUM_BOOST_ROUND
            )
            trained_at = R
            months_since_train = 0
            n_retrains += 1

        months_since_train += 1
        if model is None:
            continue  # still in warmup

        # predict the cross-section as-of R (features known at R)
        pred_mask = (panel["cpos"] == r) & feature_ok
        rows = panel[pred_mask]
        if rows.empty:
            continue
        preds = model.predict(rows[FEATURE_COLS].values)
        day_scores = {
            sym: float(p) for sym, p in zip(rows["sym"].values, preds)
        }
        scores[R] = day_scores
        reb_used.append(R)

    # ------------------------------------------------------------ write
    os.makedirs(RANK_DIR, exist_ok=True)
    with open(SCORES_PATH, "w") as fh:
        json.dump(scores, fh, separators=(",", ":"), sort_keys=True)

    meta = {
        "generatedAt": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "universe": UNIV,
        "model": "lightgbm-regressor",
        "labelHorizon": LABEL_HORIZON,
        "embargo": EMBARGO,
        "retrainEveryMonths": RETRAIN_EVERY_MONTHS,
        "minTrainRows": MIN_TRAIN_ROWS,
        "seed": SEED,
        "features": FEATURE_COLS,
        "lgbParams": {k: v for k, v in LGB_PARAMS.items()},
        "universeSize": len(tradables),
        "benchmark": BENCH,
        "nRetrains": n_retrains,
        "nScoredDates": len(reb_used),
        "firstScoredDate": reb_used[0] if reb_used else None,
        "lastScoredDate": reb_used[-1] if reb_used else None,
        "noLookahead": "row usable for R iff cpos + labelHorizon <= r - embargo",
    }
    with open(MODEL_META_PATH, "w") as fh:
        json.dump(meta, fh, indent=2, sort_keys=True)

    print(
        f"[rank] {n_retrains} retrains, scored {len(reb_used)} rebalance dates "
        f"{meta['firstScoredDate']}..{meta['lastScoredDate']} "
        f"({len(tradables)} tradables, {len(FEATURE_COLS)} features)"
    )
    print(f"[rank] wrote {os.path.relpath(SCORES_PATH)}")


if __name__ == "__main__":
    main()
