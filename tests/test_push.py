"""Pushing plan runs to Garmin Connect, against a fake Garmin client and a throwaway plans.db.

    uv run python -m unittest
"""

import json
import sqlite3
import unittest

from garmin_health import push

TODAY = "2026-11-02"
EASY = [{"title": "Run", "steps": [{"name": "Easy running", "reps": "5 km", "target": "4:57–5:27/km"}]}]


class FakeGarmin:
    """Records calls; workout and schedule ids count up from 100 and 500."""

    def __init__(self):
        self.calls = []
        self.workouts = {}
        self.next_id = 100

    def upload_workout(self, workout):
        wid, self.next_id = self.next_id, self.next_id + 1
        self.workouts[wid] = workout
        self.calls.append(("upload", workout["workoutName"]))
        return {"workoutId": wid}

    def schedule_workout(self, workout_id, day):
        self.calls.append(("schedule", workout_id, day))
        return {"workoutScheduleId": 500 + workout_id}

    def unschedule_workout(self, schedule_id):
        self.calls.append(("unschedule", schedule_id))

    def delete_workout(self, workout_id):
        self.calls.append(("delete", workout_id))
        if self.workouts.pop(workout_id, None) is None:
            raise RuntimeError("404 Not Found")


class Push(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("""
            CREATE TABLE plans (id INTEGER PRIMARY KEY, goal TEXT, status TEXT);
            CREATE TABLE plan_sessions (id INTEGER PRIMARY KEY, plan_id INTEGER, date TEXT, discipline TEXT, title TEXT,
              description TEXT, duration_min INTEGER, status TEXT, blocks_json TEXT);
            INSERT INTO plans VALUES (1, 'marathon', 'active');
        """)
        self.garmin = FakeGarmin()

    def add(self, sid, day, title="Easy run", discipline="run", blocks=EASY, status="planned", plan=1):
        self.db.execute("INSERT INTO plan_sessions VALUES (?, ?, ?, ?, ?, 'Easy.', 30, ?, ?)",
                        (sid, plan, day, discipline, title, status, json.dumps(blocks)))

    def run_push(self, days=7, only=None):
        actions = push.plan_actions(self.db, TODAY, days, only)
        push.apply(self.db, self.garmin, actions, pause=0, now="2026-11-02T07:00:00")
        return [str(a) for a in actions]

    def pushed(self):
        return {r[0]: (r[1], r[2], r[3]) for r in self.db.execute("SELECT session_id, date, workout_id, schedule_id FROM garmin_workouts")}

    def test_pushes_the_runs_in_the_window_and_nothing_else(self):
        self.add(1, "2026-11-01")                          # yesterday
        self.add(2, "2026-11-03")
        self.add(3, "2026-11-04", "Strength", "strength", [{"title": "Strength", "steps": [{"name": "Squats", "sets": 3, "reps": "8"}]}])
        self.add(4, "2026-11-05", status="skipped")
        self.add(5, "2026-11-08")
        self.add(6, "2026-11-09")                          # past the 7-day window
        self.assertEqual(self.run_push(), ["+ Tue 3 Nov  Easy run", "+ Sun 8 Nov  Easy run"])
        self.assertEqual(self.garmin.calls, [
            ("upload", "Easy run · Tue 3 Nov"), ("schedule", 100, "2026-11-03"),
            ("upload", "Easy run · Sun 8 Nov"), ("schedule", 101, "2026-11-08"),
        ])
        self.assertEqual(self.pushed(), {2: ("2026-11-03", 100, 600), 5: ("2026-11-08", 101, 601)})

    def test_pushing_again_changes_nothing(self):
        self.add(2, "2026-11-03")
        self.run_push()
        self.garmin.calls.clear()
        self.assertEqual(self.run_push(), [])
        self.assertEqual(self.garmin.calls, [])

    def test_an_edited_session_replaces_its_workout(self):
        self.add(2, "2026-11-03")
        self.run_push()
        self.db.execute("UPDATE plan_sessions SET blocks_json = ? WHERE id = 2",
                        (json.dumps([{"title": "Run", "steps": [{"name": "Easy running", "reps": "30 min", "target": "conversational"}]}]),))
        self.assertEqual(self.run_push(), ["~ Tue 3 Nov  Easy run  (changed)"])
        self.assertEqual(self.garmin.calls[-4:], [("unschedule", 600), ("delete", 100), ("upload", "Easy run · Tue 3 Nov"), ("schedule", 101, "2026-11-03")])
        self.assertEqual(self.pushed(), {2: ("2026-11-03", 101, 601)})

    def test_a_moved_session_follows_its_day(self):
        self.add(2, "2026-11-03")
        self.run_push()
        self.db.execute("UPDATE plan_sessions SET date = '2026-11-04' WHERE id = 2")
        self.assertEqual(self.run_push(), ["~ Wed 4 Nov  Easy run  (moved)"])
        self.assertEqual(self.pushed(), {2: ("2026-11-04", 101, 601)})
        # moved beyond the window: taken off now, pushed again once the window reaches it
        self.db.execute("UPDATE plan_sessions SET date = '2026-11-20' WHERE id = 2")
        self.assertEqual(self.run_push(), ["- Wed 4 Nov  Easy run  (moved to 2026-11-20)"])
        self.assertEqual(self.pushed(), {})

    def test_skipped_removed_and_archived_sessions_come_off(self):
        self.add(2, "2026-11-03")
        self.add(3, "2026-11-04")
        self.add(4, "2026-11-05")
        self.run_push()
        self.db.execute("UPDATE plan_sessions SET status = 'skipped' WHERE id = 2")
        self.db.execute("UPDATE plan_sessions SET status = 'removed' WHERE id = 3")
        self.assertEqual(self.run_push(), ["- Tue 3 Nov  Easy run  (skipped)", "- Wed 4 Nov  Easy run  (removed)"])
        # a new plan: the old one's workouts come off, the new one's go up
        self.db.execute("UPDATE plans SET status = 'archived'")
        self.db.execute("INSERT INTO plans VALUES (2, 'marathon', 'active')")
        self.add(9, "2026-11-05", "Long run", plan=2)
        self.assertEqual(self.run_push(), ["- Thu 5 Nov  Easy run  (no longer in your plan)", "+ Thu 5 Nov  Long run"])
        self.assertEqual(self.pushed(), {9: ("2026-11-05", 103, 603)})

    def test_past_and_done_sessions_are_left_alone(self):
        self.add(2, "2026-11-03")
        self.run_push()
        self.db.execute("UPDATE plan_sessions SET status = 'done' WHERE id = 2")
        self.assertEqual(self.run_push(), [])
        self.db.execute("UPDATE plan_sessions SET status = 'skipped' WHERE id = 2")
        self.assertEqual(push.plan_actions(self.db, "2026-11-04", 7), [])

    def test_a_workout_deleted_in_garmin_connect_is_fine(self):
        self.add(2, "2026-11-03")
        self.run_push()
        del self.garmin.workouts[100]
        self.db.execute("UPDATE plan_sessions SET status = 'skipped' WHERE id = 2")
        self.assertEqual(self.run_push(), ["- Tue 3 Nov  Easy run  (skipped)"])
        self.assertEqual(self.pushed(), {})

    def test_one_day_only(self):
        self.add(2, "2026-11-03")
        self.add(3, "2026-11-04")
        self.assertEqual(self.run_push(only="2026-11-03"), ["+ Tue 3 Nov  Easy run"])
        self.assertEqual(self.pushed(), {2: ("2026-11-03", 100, 600)})

    def test_nothing_pushed_yet_and_no_plan(self):
        self.db.execute("UPDATE plans SET status = 'archived'")
        self.assertEqual(push.plan_actions(self.db, TODAY, 7), [])


if __name__ == "__main__":
    unittest.main()
