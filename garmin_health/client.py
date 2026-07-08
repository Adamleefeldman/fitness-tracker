"""Fetch Garmin payloads and flatten them into clean row dicts.

Field mappings are pinned to real Forerunner 970 payloads (verified via the
`inspect` command). Every field still uses ``dig`` (returns None on any miss),
and the raw payloads are stashed in ``raw_json`` so columns can be re-derived
later WITHOUT re-hitting Garmin.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from garminconnect import GarminConnectTooManyRequestsError

from garmin_health.util import dig, first_present


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _epoch_ms_to_iso(ms):
    """Convert a Garmin local-epoch-millis timestamp to 'YYYY-MM-DD HH:MM'."""
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
    except (ValueError, OSError, TypeError):
        return None


def _compact(obj, max_list: int = 30):
    """Drop long minute-level arrays so raw_json stays small.

    Summary dicts and short lists are kept; any list longer than `max_list`
    (sleep movement, HRV readings, SpO2 epochs…) becomes a count marker. We never
    re-derive columns from those, so this trims ~190 KB/day down to a few KB.
    """
    if isinstance(obj, dict):
        return {k: _compact(v, max_list) for k, v in obj.items()}
    if isinstance(obj, list):
        if len(obj) > max_list:
            return f"<{len(obj)} items omitted>"
        return [_compact(v, max_list) for v in obj]
    return obj


def _safe(fn, *args):
    """Call a Garmin getter, returning None on missing data.

    Rate-limit errors are re-raised so the caller can back off rather than
    silently storing an empty day.
    """
    try:
        return fn(*args)
    except GarminConnectTooManyRequestsError:
        raise
    except Exception:
        return None


def _first_device_status(status):
    """Training status is keyed by device id; return the first device's dict."""
    latest = dig(status, "mostRecentTrainingStatus", "latestTrainingStatusData", default={})
    if isinstance(latest, dict) and latest:
        return next(iter(latest.values()), {}) or {}
    return {}


def fetch_daily(client, cdate: str) -> dict:
    """Build one `daily_metrics` row for the given 'YYYY-MM-DD' date."""
    sleep = _safe(client.get_sleep_data, cdate)
    stats = _safe(client.get_stats, cdate)
    hrv = _safe(client.get_hrv_data, cdate)
    readiness = _safe(client.get_training_readiness, cdate)
    maxmet = _safe(client.get_max_metrics, cdate)
    status = _safe(client.get_training_status, cdate)

    dto = dig(sleep, "dailySleepDTO", default={})
    hrv_sum = dig(hrv, "hrvSummary", default={})
    tr = readiness[0] if isinstance(readiness, list) and readiness else (readiness or {})
    st = _first_device_status(status)
    atl = dig(st, "acuteTrainingLoadDTO", default={})

    # VO2max: prefer today's max-metrics; fall back to training status' "most
    # recent" so rest days still carry the latest known value.
    vo2_run = first_present(
        maxmet, [(0, "generic", "vo2MaxPreciseValue"), (0, "generic", "vo2MaxValue")]
    )
    if vo2_run is None:
        vo2_run = first_present(
            status,
            [("mostRecentVO2Max", "generic", "vo2MaxPreciseValue"),
             ("mostRecentVO2Max", "generic", "vo2MaxValue")],
        )

    return {
        "date": cdate,
        # heart
        "resting_hr": dig(stats, "restingHeartRate"),
        "max_hr": dig(stats, "maxHeartRate"),
        "min_hr": dig(stats, "minHeartRate"),
        # hrv
        "hrv_last_night_ms": dig(hrv_sum, "lastNightAvg"),
        "hrv_status": dig(hrv_sum, "status"),
        "hrv_baseline_low": dig(hrv_sum, "baseline", "balancedLow"),
        "hrv_baseline_high": dig(hrv_sum, "baseline", "balancedUpper"),
        # sleep
        "sleep_score": dig(dto, "sleepScores", "overall", "value"),
        "sleep_total_seconds": dig(dto, "sleepTimeSeconds"),
        "sleep_deep_seconds": dig(dto, "deepSleepSeconds"),
        "sleep_rem_seconds": dig(dto, "remSleepSeconds"),
        "sleep_light_seconds": dig(dto, "lightSleepSeconds"),
        "sleep_awake_seconds": dig(dto, "awakeSleepSeconds"),
        "sleep_start": _epoch_ms_to_iso(dig(dto, "sleepStartTimestampLocal")),
        "sleep_end": _epoch_ms_to_iso(dig(dto, "sleepEndTimestampLocal")),
        # body battery
        "bb_high": dig(stats, "bodyBatteryHighestValue"),
        "bb_low": dig(stats, "bodyBatteryLowestValue"),
        "bb_charged": dig(stats, "bodyBatteryChargedValue"),
        "bb_drained": dig(stats, "bodyBatteryDrainedValue"),
        # stress
        "stress_avg": dig(stats, "averageStressLevel"),
        "stress_max": dig(stats, "maxStressLevel"),
        # fitness / training load
        "vo2max_running": vo2_run,
        "vo2max_cycling": first_present(
            maxmet, [(0, "cycling", "vo2MaxPreciseValue"), (0, "cycling", "vo2MaxValue")]
        ),
        "training_readiness_score": dig(tr, "score"),
        "training_readiness_level": dig(tr, "level"),
        "training_status": dig(st, "trainingStatusFeedbackPhrase"),
        "acute_load": dig(atl, "dailyTrainingLoadAcute") if dig(atl, "dailyTrainingLoadAcute") is not None else dig(tr, "acuteLoad"),
        "chronic_load": dig(atl, "dailyTrainingLoadChronic"),
        # activity volume
        "steps": dig(stats, "totalSteps"),
        "floors": dig(stats, "floorsAscended"),
        "distance_m": dig(stats, "totalDistanceMeters"),
        "calories": dig(stats, "totalKilocalories"),
        "active_calories": dig(stats, "activeKilocalories"),
        # misc wellness (SpO2 & respiration come from the sleep payload)
        "spo2_avg": dig(dto, "averageSpO2Value"),
        "respiration_avg": dig(dto, "averageRespirationValue"),
        "weight_g": None,
        "body_fat_pct": None,
        # bookkeeping
        "raw_json": json.dumps(
            _compact({
                "sleep": sleep,
                "stats": stats,
                "hrv": hrv,
                "readiness": readiness,
                "max_metrics": maxmet,
                "training_status": status,
            }),
            default=str,
        ),
        "synced_at": _now_iso(),
    }


def map_activity(a: dict) -> dict:
    """Flatten one Garmin activity into an `activities` row."""
    dist, dur = dig(a, "distance"), dig(a, "duration")
    pace = (dur / (dist / 1000)) if (dist and dur) else None  # seconds per km
    local = dig(a, "startTimeLocal") or ""
    return {
        "activity_id": dig(a, "activityId"),
        "date": local[:10] or None,
        "start_time_local": dig(a, "startTimeLocal"),
        "start_time_gmt": dig(a, "startTimeGMT"),
        "activity_type": dig(a, "activityType", "typeKey"),
        "name": dig(a, "activityName"),
        "distance_m": dist,
        "duration_s": dur,
        "moving_duration_s": dig(a, "movingDuration"),
        "avg_pace_s_per_km": pace,
        "avg_hr": dig(a, "averageHR"),
        "max_hr": dig(a, "maxHR"),
        "elevation_gain_m": dig(a, "elevationGain"),
        "elevation_loss_m": dig(a, "elevationLoss"),
        "calories": dig(a, "calories"),
        "training_load": dig(a, "activityTrainingLoad"),
        "aerobic_te": dig(a, "aerobicTrainingEffect"),
        "anaerobic_te": dig(a, "anaerobicTrainingEffect"),
        "avg_cadence": first_present(
            a,
            [
                ("averageRunningCadenceInStepsPerMinute",),
                ("averageBikingCadenceInRevPerMinute",),
                ("averageCadence",),
            ],
        ),
        "avg_power": dig(a, "avgPower"),
        "vo2max": dig(a, "vO2MaxValue"),
        "raw_json": json.dumps(a, default=str),
        "synced_at": _now_iso(),
    }


# --- diagnostics -----------------------------------------------------------

def _short(value) -> str:
    s = str(value)
    return s if len(s) <= 70 else s[:67] + "..."


def _describe(obj, indent: int = 2, depth: int = 0, maxdepth: int = 2) -> None:
    pad = " " * indent
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, (dict, list)) and depth < maxdepth:
                print(f"{pad}{k}: {type(v).__name__}")
                _describe(v, indent + 2, depth + 1, maxdepth)
            else:
                print(f"{pad}{k}: {_short(v)}")
    elif isinstance(obj, list):
        print(f"{pad}[list len={len(obj)}]")
        if obj and depth < maxdepth:
            _describe(obj[0], indent + 2, depth + 1, maxdepth)
    else:
        print(f"{pad}{_short(obj)}")


def describe_payloads(client, cdate: str) -> None:
    """Print the shape (keys + small values) of each endpoint for one date."""
    endpoints = [
        ("get_sleep_data", client.get_sleep_data),
        ("get_stats", client.get_stats),
        ("get_hrv_data", client.get_hrv_data),
        ("get_training_readiness", client.get_training_readiness),
        ("get_max_metrics", client.get_max_metrics),
        ("get_training_status", client.get_training_status),
    ]
    for name, fn in endpoints:
        print(f"\n===== {name}({cdate!r}) =====")
        try:
            _describe(fn(cdate))
        except Exception as e:  # noqa: BLE001 - diagnostics should never crash
            print(f"  ERROR: {e}")
