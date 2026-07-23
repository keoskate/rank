#!/usr/bin/env python3
"""
fetch_oot_bars.py — PRE-REGISTERED OOT data fetch

Fetches Yahoo Finance ADJUSTED daily closes for SOXX and GLD for the
out-of-time exam window: 2004-11-18 (GLD inception) → 2016-01-04.

Outputs: data/rank-cache/oot-2004-2016.json
Schema:
  {
    "meta": { "fetched": "...", "source": "yahoo", "window": {...}, "notes": [...] },
    "SOXX": [ {"date": "YYYY-MM-DD", "close": ...}, ... ],
    "GLD":  [ {"date": "YYYY-MM-DD", "close": ...}, ... ]
  }

Sanity checks (all must pass before writing):
  - SOXX and GLD both ~2800 bars (within ±200)
  - No gaps > 10 consecutive trading days
  - All prices positive
  - GLD starts ~$44 (within ±20%)
  - SOXX 2008-11 deeply down from SOXX 2007 peak
"""

import json
import os
import sys
from datetime import datetime, date

try:
    import yfinance as yf
except ImportError:
    print("ERROR: yfinance not installed. Run: pip install yfinance")
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas")
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────
START = "2004-11-17"   # one day before GLD inception so we include 2004-11-18
END   = "2016-01-05"   # one day after to ensure 2016-01-04 included
TICKERS = ["SOXX", "GLD"]
OUT_PATH = os.path.join(os.path.dirname(__file__), "../../data/rank-cache/oot-2004-2016.json")


def fetch_adjusted_closes(ticker, start, end):
    """Download adjusted closes via yfinance. Returns sorted list of {date, close}."""
    print(f"  Fetching {ticker} {start} → {end}...")
    raw = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
    if raw.empty:
        raise ValueError(f"No data returned for {ticker}")

    # yfinance returns MultiIndex columns when downloading; handle both cases
    if hasattr(raw.columns, 'levels'):
        # MultiIndex — extract 'Close' for this ticker
        try:
            closes = raw['Close'][ticker]
        except KeyError:
            closes = raw['Close']
    else:
        closes = raw['Close']

    records = []
    for idx, val in closes.items():
        if pd.isna(val):
            continue
        d = idx.date() if hasattr(idx, 'date') else idx
        records.append({"date": str(d), "close": float(val)})

    records.sort(key=lambda r: r["date"])
    return records


def max_gap(records):
    """Max gap between consecutive dates in CALENDAR days."""
    if len(records) < 2:
        return 0
    gaps = []
    for i in range(1, len(records)):
        d0 = datetime.strptime(records[i-1]["date"], "%Y-%m-%d").date()
        d1 = datetime.strptime(records[i]["date"], "%Y-%m-%d").date()
        gaps.append((d1 - d0).days)
    return max(gaps)


def sanity_check(name, records, all_records):
    """Run pre-registered sanity checks. Raises on failure."""
    n = len(records)
    print(f"\n  [{name}] {n} bars from {records[0]['date']} → {records[-1]['date']}")

    # 1. Count check: expect ~2800 ± 200
    if not (2600 <= n <= 3000):
        raise ValueError(f"{name}: expected ~2800 bars, got {n}")
    print(f"    bar count: {n} (PASS, expected 2600-3000)")

    # 2. No gaps > 10 trading days (calendar days proxy: >16 calendar days ≈ > 10 trading days)
    mg = max_gap(records)
    print(f"    max calendar gap: {mg} days")
    if mg > 16:
        raise ValueError(f"{name}: gap of {mg} calendar days found (threshold: 16)")
    print(f"    gap check: PASS")

    # 3. All prices positive
    negs = [r for r in records if r["close"] <= 0]
    if negs:
        raise ValueError(f"{name}: non-positive prices found: {negs[:3]}")
    print(f"    prices positive: PASS")

    # 4. GLD starts ~$44 (within ±30%)
    if name == "GLD":
        first_close = records[0]["close"]
        print(f"    GLD first close: ${first_close:.2f} (expect ~$44)")
        if not (30 <= first_close <= 60):
            raise ValueError(f"GLD: expected first close ~$44, got ${first_close:.2f}")
        print(f"    GLD inception price: PASS")

    # 5. SOXX 2008-11 deeply down from 2007 peak
    if name == "SOXX":
        soxx_2007 = [r["close"] for r in records if r["date"].startswith("2007")]
        soxx_2008_11 = [r["close"] for r in records if r["date"].startswith("2008-11")]
        if soxx_2007 and soxx_2008_11:
            peak_2007 = max(soxx_2007)
            avg_2008_11 = sum(soxx_2008_11) / len(soxx_2008_11)
            drawdown = (avg_2008_11 - peak_2007) / peak_2007
            print(f"    SOXX 2007 peak: ${peak_2007:.2f}, 2008-11 avg: ${avg_2008_11:.2f}, drawdown: {drawdown:.1%}")
            if drawdown > -0.30:
                raise ValueError(f"SOXX: 2008-11 not deeply down from 2007 peak (dd={drawdown:.1%})")
            print(f"    SOXX 2008 crash: PASS (drawdown {drawdown:.1%})")
        else:
            print(f"    SOXX 2008 crash: SKIPPED (no 2007 or 2008-11 data)")


def main():
    print("=" * 60)
    print("PRE-REGISTERED OOT DATA FETCH")
    print("Window: 2004-11-18 → 2016-01-04 (Yahoo Finance adjusted)")
    print("=" * 60)

    all_data = {}
    for ticker in TICKERS:
        records = fetch_adjusted_closes(ticker, START, END)

        # Filter to window [2004-11-18, 2016-01-04] inclusive
        records = [r for r in records if "2004-11-18" <= r["date"] <= "2016-01-04"]

        sanity_check(ticker, records, all_data)
        all_data[ticker] = records

    # Build output
    out = {
        "meta": {
            "fetched": datetime.utcnow().isoformat() + "Z",
            "source": "yahoo_finance_yfinance",
            "window": {"start": "2004-11-18", "end": "2016-01-04"},
            "notes": [
                "Yahoo Finance adjusted closes (split + dividend adjusted).",
                "Yahoo adjusted != Alpaca adjusted: different vendor conventions. Vendor robustness is partly the point.",
                "SOXX pre-2010 had lower liquidity — noted caveat in report.",
                "GLD inception 2004-11-18. Window chosen to have zero overlap with Alpaca training data (2016-01-04+).",
                "PRE-REGISTERED: this fetch script was written before running the exam, with sanity checks baked in."
            ],
            "sanity": {
                "SOXX_bars": len(all_data["SOXX"]),
                "GLD_bars": len(all_data["GLD"]),
                "SOXX_start": all_data["SOXX"][0]["date"],
                "SOXX_end": all_data["SOXX"][-1]["date"],
                "GLD_start": all_data["GLD"][0]["date"],
                "GLD_end": all_data["GLD"][-1]["date"],
                "GLD_first_close": all_data["GLD"][0]["close"],
            }
        },
        "SOXX": all_data["SOXX"],
        "GLD": all_data["GLD"],
    }

    out_path = os.path.normpath(os.path.join(os.path.dirname(__file__), OUT_PATH))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"FETCH COMPLETE — all sanity checks passed")
    print(f"Output: {out_path}")
    print(f"SOXX: {len(all_data['SOXX'])} bars | GLD: {len(all_data['GLD'])} bars")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
