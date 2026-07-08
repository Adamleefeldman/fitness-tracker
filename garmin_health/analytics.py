"""Pure-pandas analytics over the Garmin database — no Streamlit here.

Kept separate from app.py so the data logic is testable without launching a UI.
Every function tolerates missing values (the watch drops metrics some days).
"""

from __future__ import annotations

import pandas as pd

from garmin_health import db


def load_daily(conn=None) -> pd.DataFrame:
    """All daily_metrics as a DataFrame, oldest→newest, with a few conveniences."""
    own = conn is None
    conn = conn or db.connect()
    try:
        df = pd.read_sql("SELECT * FROM daily_metrics ORDER BY date", conn, parse_dates=["date"])
    finally:
        if own:
            conn.close()
    if "sleep_total_seconds" in df:
        df["sleep_hours"] = df["sleep_total_seconds"] / 3600
    return df


def load_activities(conn=None) -> pd.DataFrame:
    """All activities as a DataFrame with km and min/km convenience columns."""
    own = conn is None
    conn = conn or db.connect()
    try:
        df = pd.read_sql(
            "SELECT * FROM activities ORDER BY start_time_local", conn, parse_dates=["date"]
        )
    finally:
        if own:
            conn.close()
    if "distance_m" in df:
        df["distance_km"] = df["distance_m"] / 1000
    if "avg_pace_s_per_km" in df:
        df["pace_min_per_km"] = df["avg_pace_s_per_km"] / 60
    return df


def rolling(series: pd.Series, window: int = 7) -> pd.Series:
    """Rolling mean that still produces values near the start of the series."""
    return series.rolling(window, min_periods=max(1, window // 2)).mean()


def acwr(daily: pd.DataFrame) -> pd.Series:
    """Acute:chronic workload ratio (the 'sweet spot' is roughly 0.8–1.3)."""
    if not {"acute_load", "chronic_load"}.issubset(daily.columns):
        return pd.Series(dtype="float64")
    ratio = daily["acute_load"] / daily["chronic_load"]
    return ratio.replace([float("inf"), float("-inf")], pd.NA)


def weekly_distance(activities: pd.DataFrame) -> pd.DataFrame:
    """Total running/activity distance per ISO week."""
    if activities.empty or "date" not in activities:
        return pd.DataFrame(columns=["week", "distance_km"])
    a = activities.dropna(subset=["date"]).set_index("date")
    wk = a["distance_km"].resample("W").sum().reset_index()
    wk.columns = ["week", "distance_km"]
    return wk


def readiness_drivers(daily: pd.DataFrame) -> dict:
    """The factor percentages behind the latest readiness score (from raw_json).

    Returns e.g. {'HRV': 96, 'Sleep': 67, 'Recovery': 51, 'Load': 81} — the
    numbers that explain *why* readiness is what it is. Empty if unavailable.
    """
    import json

    if daily is None or daily.empty:
        return {}
    raw = daily.iloc[-1].get("raw_json")
    try:
        r = json.loads(raw).get("readiness")
        r = r[0] if isinstance(r, list) and r else (r or {})
        out = {
            "HRV": r.get("hrvFactorPercent"),
            "Sleep": r.get("sleepScoreFactorPercent"),
            "Recovery": r.get("recoveryTimeFactorPercent"),
            "Load": r.get("acwrFactorPercent"),
        }
        return {k: v for k, v in out.items() if v is not None}
    except Exception:
        return {}


def latest(daily: pd.DataFrame, columns) -> dict:
    """Most-recent non-null value for each requested column."""
    out = {}
    for col in columns:
        if col in daily:
            s = daily[col].dropna()
            out[col] = (s.iloc[-1] if not s.empty else None)
        else:
            out[col] = None
    return out
