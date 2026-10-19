"""Dump pandas analytics + verdicts as JSON for the TypeScript parity test.

Run from the repo root:
    uv run python web/scripts/analytics_parity.py [--every N]

Slides windows of 30/90/365/all days across the whole history (ending every
N-th day plus the latest) so the verdict rules get exercised against many
real situations, not just today's.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from dashboard import verdicts as VD  # noqa: E402
from garmin_health import analytics as A  # noqa: E402

RANGES = [30, 90, 365, None]
LATEST_COLS = ["resting_hr", "hrv_last_night_ms", "sleep_score", "vo2max_running",
               "training_readiness_score", "training_readiness_level", "steps"]


def clean(v):
    """JSON-safe scalar: NaN/NA → None, numpy → python, timestamps → 'YYYY-MM-DD'."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def series(s):
    return [clean(v) for v in s]


def weekly(df, cols):
    if df.empty:
        return {"weeks": [], **{c: [] for c in cols}}
    return {"weeks": series(df["week"]), **{c: series(df[c]) for c in cols}}


def window_case(daily, acts, end, days, with_series):
    start = 0 if days is None else max(0, end + 1 - days)
    d = daily.iloc[start:end + 1]
    ds, de = d["date"].iloc[0], d["date"].iloc[-1]
    a = acts[(acts["date"] >= ds) & (acts["date"] <= de)]

    hbt = A.weekly_hours_by_type(a)
    types = [c for c in hbt.columns if c != "week"]
    case = {
        "start": start, "end": end, "days": days,
        "verdicts": {
            "today": VD.today(d), "load": VD.load(d),
            "fitness": VD.fitness(d, a), "sleep": VD.sleep(d),
        },
        "drivers": {k: clean(v) for k, v in A.readiness_drivers(d).items()},
        "latest": {k: clean(v) for k, v in A.latest(d, LATEST_COLS).items()},
        "weekly_distance": weekly(A.weekly_distance(a), ["distance_km"]),
        "weekly_hours_by_type": {"types": types, **weekly(hbt, types)},
        "weekly_intensity": weekly(A.weekly_intensity(a), ["easy", "moderate", "hard"]),
    }
    if with_series:
        runs = a[a["activity_type"] == "running"]
        st = A.sleep_times(d)
        case["series"] = {
            "acwr": series(A.acwr(d)),
            "rolling_rhr_7": series(A.rolling(d["resting_hr"], 7)),
            "rolling_rhr_28": series(A.rolling(d["resting_hr"], 28)),
            "rolling_steps_7": series(A.rolling(d["steps"], 7)),
            "rolling_pace_5": series(A.rolling(runs["pace_min_per_km"], 5)),
            "sleep_hours": series(d["sleep_hours"]),
            "sleep_times": [{"date": clean(r.date), "bed_h": clean(r.bed_h), "wake_h": clean(r.wake_h)}
                            for r in st.itertuples()],
        }
    return case


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--every", type=int, default=3)
    args = ap.parse_args()

    daily, acts = A.load_daily(), A.load_activities()
    last = len(daily) - 1
    ends = sorted(set(range(6, last + 1, args.every)) | {last})
    cases = [
        window_case(daily, acts, end, days, with_series=(end == last or end % 30 == 0))
        for end in ends for days in RANGES
    ]
    json.dump({"cases": cases}, sys.stdout)


if __name__ == "__main__":
    main()
