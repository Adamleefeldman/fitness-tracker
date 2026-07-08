"""Phase 0 — first contact.

Logs into Garmin (reusing a cached token after the first run) and prints
yesterday's headline numbers plus your most recent activity. A throwaway proof
that the pipe from your watch to your terminal works.

Run it yourself — your password stays in .env and never passes through Claude:

    uv run python hello.py

The first run may prompt once for a 2FA code if your account has it enabled;
after that the cached token makes runs non-interactive.
"""

from __future__ import annotations

from datetime import date, timedelta

from garmin_health.auth import get_client


def dig(obj, *path, default=None):
    """Safely walk nested dict/list structures; return default on any miss."""
    cur = obj
    for key in path:
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return default
    return default if cur is None else cur


def hms(seconds):
    """Format a duration in seconds as e.g. '7h32m', or 'n/a' if missing."""
    if not seconds:
        return "n/a"
    h, rem = divmod(int(seconds), 3600)
    return f"{h}h{rem // 60:02d}m"


def show(label, value):
    print(f"  {label:<16}: {'n/a' if value in (None, '') else value}")


def main():
    client = get_client()

    try:
        who = client.get_full_name()
    except Exception:
        who = None

    yday = (date.today() - timedelta(days=1)).isoformat()
    print(f"\n=== {who + ' — ' if who else ''}Garmin data for {yday} ===")

    print("\nSleep")
    try:
        dto = dig(client.get_sleep_data(yday), "dailySleepDTO", default={})
        show("score", dig(dto, "sleepScores", "overall", "value"))
        show("asleep", hms(dig(dto, "sleepTimeSeconds")))
        show(
            "deep/rem/light",
            f"{hms(dig(dto, 'deepSleepSeconds'))} / "
            f"{hms(dig(dto, 'remSleepSeconds'))} / "
            f"{hms(dig(dto, 'lightSleepSeconds'))}",
        )
    except Exception as e:
        show("error", e)

    print("\nRecovery & body")
    try:
        stats = client.get_stats(yday)
        show("resting HR", dig(stats, "restingHeartRate"))
        lo, hi = dig(stats, "bodyBatteryLowestValue"), dig(stats, "bodyBatteryHighestValue")
        show("body battery", f"{lo}–{hi}" if (lo is not None or hi is not None) else None)
        show("avg stress", dig(stats, "averageStressLevel"))
        show("steps", dig(stats, "totalSteps"))
    except Exception as e:
        show("error", e)

    print("\nHRV & fitness")
    try:
        hrv = client.get_hrv_data(yday)
        show("HRV last night", dig(hrv, "hrvSummary", "lastNightAvg"))
        show("HRV status", dig(hrv, "hrvSummary", "status"))
    except Exception as e:
        show("HRV error", e)
    try:
        mm = client.get_max_metrics(yday)
        vo2 = dig(mm, 0, "generic", "vo2MaxPreciseValue") or dig(mm, 0, "generic", "vo2MaxValue")
        show("VO2max", vo2)
    except Exception as e:
        show("VO2max error", e)
    try:
        tr = client.get_training_readiness(yday)
        show("readiness", f"{dig(tr, 0, 'score')} ({dig(tr, 0, 'level')})")
    except Exception as e:
        show("readiness error", e)

    print("\nMost recent activity")
    try:
        acts = client.get_activities(0, 1)
        a = acts[0] if acts else {}
        show("name", dig(a, "activityName"))
        show("type", dig(a, "activityType", "typeKey"))
        dist_m = dig(a, "distance")
        show("distance", f"{dist_m / 1000:.2f} km" if dist_m else None)
        show("duration", hms(dig(a, "duration")))
        show("avg HR", dig(a, "averageHR"))
        show("when", dig(a, "startTimeLocal"))
    except Exception as e:
        show("error", e)

    print("\n✓ If you can see real numbers above, Phase 0 works.\n")


if __name__ == "__main__":
    main()
