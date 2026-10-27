"""Orchestration: backfill history and the gap-aware daily sync.

Both are idempotent and resumable. A backfill skips dates already stored and
checkpoints to the database every few days, so an interrupted run (Ctrl-C, a
rate-limit, the laptop sleeping) just picks up where it left off next time.
"""

from __future__ import annotations

import time
from datetime import date, timedelta

from garminconnect import GarminConnectTooManyRequestsError

from garmin_health import db
from garmin_health.client import fetch_daily, map_activity
from garmin_health.util import daterange

_ACTIVITY_FLOOR = "2008-01-01"  # Garmin Connect predates any consumer watch
_MAX_RATELIMIT_RETRIES = 3
_RATELIMIT_BACKOFF_S = 60
_REFILL_DAYS = 14  # how far back the daily sync re-fetches days stored blank


def _safe_call(fn, *args):
    try:
        return fn(*args)
    except Exception:
        return None


def _earliest_activity_date(client):
    acts = _safe_call(client.get_activities_by_date, _ACTIVITY_FLOOR, date.today().isoformat())
    days = [(a.get("startTimeLocal") or "")[:10] for a in (acts or []) if a.get("startTimeLocal")]
    days = [d for d in days if d]
    return date.fromisoformat(min(days)) if days else None


def _resolve_range(client, all_history, since, days, end):
    end_d = date.fromisoformat(end) if end else date.today() - timedelta(days=1)
    if since:
        start_d = date.fromisoformat(since)
    elif all_history:
        start_d = _earliest_activity_date(client) or (end_d - timedelta(days=365))
    elif days:
        start_d = end_d - timedelta(days=days - 1)
    else:
        start_d = end_d - timedelta(days=29)  # sensible default: ~last 30 days
    return start_d, end_d


def _sync_activities(conn, client, start_d, end_d, log):
    acts = _safe_call(client.get_activities_by_date, start_d.isoformat(), end_d.isoformat())
    count = 0
    for a in acts or []:
        row = map_activity(a)
        if row["activity_id"] is not None:
            db.upsert_activity(conn, row)
            count += 1
    conn.commit()
    log(f"  activities: stored {count}")
    return count


def backfill(conn, client, *, all_history=False, since=None, days=None, end=None,
             force=False, pause=1.0, kind="backfill", log=print):
    """Pull daily metrics + activities for a date range into the database."""
    start_d, end_d = _resolve_range(client, all_history, since, days, end)
    if start_d > end_d:
        log(f"Nothing to do: start {start_d} is after end {end_d}.")
        return

    log(f"{kind}: {start_d} → {end_d}")
    sync_id = db.start_sync(conn, kind, start_d.isoformat(), end_d.isoformat())

    activities = _sync_activities(conn, client, start_d, end_d, log)

    already = set() if force else db.existing_metric_dates(conn)
    todo = [d for d in daterange(start_d, end_d) if d.isoformat() not in already]
    log(f"  days to sync: {len(todo)} (skipping { (end_d - start_d).days + 1 - len(todo)} already stored)")

    synced = 0
    try:
        for d in todo:
            cdate = d.isoformat()
            row = _fetch_with_backoff(client, cdate, log)
            db.upsert_daily(conn, row)
            synced += 1
            if synced % 10 == 0:
                conn.commit()
                log(f"  …{synced}/{len(todo)} days ({cdate})")
            time.sleep(pause)
        conn.commit()
        db.finish_sync(conn, sync_id, "ok", synced, activities)
        log(f"{kind} complete: {synced} days, {activities} activities.")
    except GarminConnectTooManyRequestsError as e:
        conn.commit()
        db.finish_sync(conn, sync_id, "partial", synced, activities, str(e))
        log(f"Rate-limited after {synced} days. Saved progress — re-run to resume. ({e})")
    except KeyboardInterrupt:
        conn.commit()
        db.finish_sync(conn, sync_id, "partial", synced, activities, "interrupted")
        log(f"Interrupted after {synced} days. Progress saved — re-run to resume.")
        raise


def _fetch_with_backoff(client, cdate, log):
    """fetch_daily with a few backoff retries on rate-limit errors."""
    for attempt in range(_MAX_RATELIMIT_RETRIES):
        try:
            return fetch_daily(client, cdate)
        except GarminConnectTooManyRequestsError:
            if attempt == _MAX_RATELIMIT_RETRIES - 1:
                raise
            wait = _RATELIMIT_BACKOFF_S * (attempt + 1)
            log(f"  rate-limited on {cdate}; backing off {wait}s…")
            time.sleep(wait)


def daily_sync(conn, client, *, pause=1.0, log=print):
    """Fetch yesterday plus any days missing since the last successful sync.

    Also re-fetches trailing days stored blank (the watch hadn't uploaded yet),
    back to the last day with data but no more than _REFILL_DAYS.
    """
    last = db.last_metric_date(conn)
    yesterday = date.today() - timedelta(days=1)
    if last:
        start = date.fromisoformat(last)  # re-do last stored day in case it was partial
        last_data = db.last_metric_date(conn, with_data=True)
        if last_data:
            refill = max(date.fromisoformat(last_data), yesterday - timedelta(days=_REFILL_DAYS))
            start = min(start, refill)
    else:
        log("No data yet — run a backfill first (e.g. `backfill --all`).")
        start = yesterday
    backfill(conn, client, since=start.isoformat(), end=yesterday.isoformat(),
             force=True, pause=pause, kind="daily", log=log)
