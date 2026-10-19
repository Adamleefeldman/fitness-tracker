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


def last_synced(conn=None):
    """Most recent sync timestamp as a local-tz datetime, or None."""
    own = conn is None
    conn = conn or db.connect()
    try:
        row = conn.execute("SELECT MAX(synced_at) FROM daily_metrics").fetchone()
    finally:
        if own:
            conn.close()
    if not row or not row[0]:
        return None
    import datetime as _dt

    ts = pd.Timestamp(row[0])
    local_tz = _dt.datetime.now().astimezone().tzinfo
    ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts
    return ts.tz_convert(local_tz).to_pydatetime()


def weekly_hours_by_type(activities: pd.DataFrame, top: int = 5) -> pd.DataFrame:
    """Weekly training hours pivoted by activity type (top N types + 'other')."""
    if activities.empty or "date" not in activities:
        return pd.DataFrame()
    a = activities.dropna(subset=["date", "duration_s"]).copy()
    keep = a["activity_type"].value_counts().head(top).index
    a["type"] = a["activity_type"].where(a["activity_type"].isin(keep), "other")
    a["hours"] = a["duration_s"] / 3600
    wk = (a.set_index("date").groupby("type").resample("W")["hours"].sum()
            .unstack(0).fillna(0))
    return wk.reset_index().rename(columns={"date": "week"})


def weekly_intensity(activities: pd.DataFrame) -> pd.DataFrame:
    """Sessions per week binned by intensity from Garmin training effect.

    hard: aerobic TE >= 3.5 or anaerobic TE >= 2.5 (improving / highly improving)
    moderate: aerobic TE >= 2.5 (maintaining)
    easy: everything below (recovery / minor benefit)
    """
    if activities.empty or "aerobic_te" not in activities:
        return pd.DataFrame()
    a = activities.dropna(subset=["date"]).copy()
    ate = a["aerobic_te"].fillna(0)
    ane = a["anaerobic_te"].fillna(0)
    a["intensity"] = "easy"
    a.loc[ate >= 2.5, "intensity"] = "moderate"
    a.loc[(ate >= 3.5) | (ane >= 2.5), "intensity"] = "hard"
    wk = (a.set_index("date").groupby("intensity").resample("W")["activity_id"].count()
            .unstack(0).fillna(0))
    for col in ("easy", "moderate", "hard"):
        if col not in wk:
            wk[col] = 0
    return wk.reset_index().rename(columns={"date": "week"})


def sleep_times(daily: pd.DataFrame) -> pd.DataFrame:
    """Bed/wake times as hours relative to midnight of each row's date.

    bed_h is negative when bedtime falls before midnight (previous evening),
    so 23:30 -> -0.5 and 00:45 -> 0.75; wake_h is e.g. 7.25 for 07:15.
    """
    need = {"sleep_start", "sleep_end"}
    if daily.empty or not need.issubset(daily.columns):
        return pd.DataFrame(columns=["date", "bed_h", "wake_h"])
    d = daily.dropna(subset=["sleep_start", "sleep_end"]).copy()
    if d.empty:
        return pd.DataFrame(columns=["date", "bed_h", "wake_h"])
    midnight = pd.to_datetime(d["date"])
    d["bed_h"] = (pd.to_datetime(d["sleep_start"]) - midnight).dt.total_seconds() / 3600
    d["wake_h"] = (pd.to_datetime(d["sleep_end"]) - midnight).dt.total_seconds() / 3600
    return d[["date", "bed_h", "wake_h"]]


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
