"""Put the plan's coming runs on the Garmin Connect calendar, so the watch has them.

Each run in the window (today plus the next few days) is uploaded as a
structured workout (see workouts.py) and scheduled on its day; the phone app
syncs it to the watch. plans.db remembers what went up, in garmin_workouts:

  - an unchanged session is left alone, so pushing twice changes nothing
  - an edited, adapted or moved session has its old workout deleted and the
    new one pushed
  - a skipped or removed session, or one from a plan that's no longer active,
    has its workout deleted
  - past days and sessions marked done are left as they are

Only workouts this command created are ever touched; anything you made in
Garmin Connect yourself is not.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from garmin_health.workouts import to_workout

SCHEMA = """
CREATE TABLE IF NOT EXISTS garmin_workouts (
  session_id INTEGER PRIMARY KEY,   -- plan_sessions.id
  date TEXT NOT NULL,               -- the day it's scheduled on
  workout_id INTEGER NOT NULL,      -- Garmin's workout
  schedule_id INTEGER,              -- its calendar entry
  digest TEXT NOT NULL,             -- what was sent, to spot changes
  pushed_at TEXT NOT NULL
);
"""


@dataclass
class Action:
    op: str  # add | replace | remove
    date: str
    title: str
    session_id: int
    workout: dict | None = None
    reason: str = ""

    def __str__(self) -> str:
        d = date.fromisoformat(self.date)
        sign = {"add": "+", "replace": "~", "remove": "-"}[self.op]
        why = f"  ({self.reason})" if self.reason else ""
        return f"{sign} {d:%a} {d.day} {d:%b}  {self.title}{why}"


def digest(workout: dict, day: str) -> str:
    return hashlib.sha256(json.dumps([day, workout], sort_keys=True).encode()).hexdigest()[:16]


def _pushed(conn: sqlite3.Connection) -> dict[int, sqlite3.Row]:
    try:
        return {r["session_id"]: r for r in conn.execute("SELECT * FROM garmin_workouts")}
    except sqlite3.OperationalError:  # never pushed: no table yet
        return {}


def plan_actions(conn: sqlite3.Connection, today: str, days: int, only: str | None = None) -> list[Action]:
    """What a push would do, without touching Garmin or plans.db.

    `only` limits it to one day (to try a single session); otherwise the window
    is `days` days from `today`.
    """
    conn.row_factory = sqlite3.Row
    plan = conn.execute("SELECT id, goal FROM plans WHERE status = 'active' ORDER BY id DESC LIMIT 1").fetchone()
    start = only or today
    end = only or (date.fromisoformat(today) + timedelta(days=days - 1)).isoformat()
    pushed = _pushed(conn)
    actions: list[Action] = []

    # what's on Garmin from before: keep, replace or remove
    replaced: set[int] = set()
    for sid, row in pushed.items():
        if row["date"] < today or (only and row["date"] != only):
            continue
        s = conn.execute("SELECT * FROM plan_sessions WHERE id = ?", (sid,)).fetchone()
        title = s["title"] if s else "removed session"
        if s is None or plan is None or s["plan_id"] != plan["id"]:
            actions.append(Action("remove", row["date"], title, sid, reason="no longer in your plan"))
        elif s["status"] in ("skipped", "removed"):
            actions.append(Action("remove", row["date"], title, sid, reason=s["status"]))
        elif s["status"] == "planned":
            w = to_workout({**dict(s), "blocks": json.loads(s["blocks_json"] or "null")}, plan["goal"])
            if w is None:
                actions.append(Action("remove", row["date"], title, sid, reason="no longer a run"))
            elif digest(w, s["date"]) != row["digest"]:
                moved = s["date"] != row["date"]
                if moved and not start <= s["date"] <= end:
                    actions.append(Action("remove", row["date"], title, sid, reason=f"moved to {s['date']}"))
                else:
                    actions.append(Action("replace", s["date"], title, sid, w, "moved" if moved else "changed"))
                    replaced.add(sid)

    # runs in the window that aren't on Garmin yet
    if plan is not None:
        rows = conn.execute(
            "SELECT * FROM plan_sessions WHERE plan_id = ? AND status = 'planned' AND date BETWEEN ? AND ? ORDER BY date, id",
            (plan["id"], start, end),
        )
        for s in rows:
            if s["id"] in pushed or s["id"] in replaced:
                continue
            w = to_workout({**dict(s), "blocks": json.loads(s["blocks_json"] or "null")}, plan["goal"])
            if w is not None:
                actions.append(Action("add", s["date"], s["title"], s["id"], w))
    return sorted(actions, key=lambda a: (a.date, a.op != "remove"))


def _remove(client, row: sqlite3.Row) -> None:
    """Take a workout off the calendar and out of the workout list; gone already is fine."""
    if row["schedule_id"]:
        try:
            client.unschedule_workout(row["schedule_id"])
        except Exception:
            pass  # deleting the workout below clears the calendar too
    try:
        client.delete_workout(row["workout_id"])
    except Exception as e:
        if "404" not in str(e):
            raise


def apply(conn: sqlite3.Connection, client, actions: list[Action], pause: float = 0.5, now: str | None = None) -> None:
    """Carry out `actions` on Garmin, recording each one in plans.db as it lands."""
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for a in actions:
        old = conn.execute("SELECT * FROM garmin_workouts WHERE session_id = ?", (a.session_id,)).fetchone()
        if old is not None:
            _remove(client, old)
            conn.execute("DELETE FROM garmin_workouts WHERE session_id = ?", (a.session_id,))
            conn.commit()
        if a.op in ("add", "replace"):
            created = client.upload_workout(a.workout)
            workout_id = created["workoutId"]
            scheduled = client.schedule_workout(workout_id, a.date) or {}
            conn.execute(
                "INSERT INTO garmin_workouts (session_id, date, workout_id, schedule_id, digest, pushed_at) VALUES (?, ?, ?, ?, ?, ?)",
                (a.session_id, a.date, workout_id, scheduled.get("workoutScheduleId"), digest(a.workout, a.date),
                 now or datetime.now().isoformat(timespec="seconds")),
            )
            conn.commit()
        if pause:
            time.sleep(pause)
