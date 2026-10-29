"""Plan sessions → Garmin workouts, on the shapes the plan generator writes.

    uv run python -m unittest
"""

import unittest

from garmin_health.workouts import end_condition, outline, pace_range, to_workout

EASY = "4:57–5:27/km"


def session(blocks, discipline="run", title="Hill repeats", day="2026-11-03"):
    return {"date": day, "discipline": discipline, "title": title, "description": "Hills.",
            "duration_min": 45, "blocks": blocks}


HILLS = session([
    {"title": "Warm-up", "steps": [{"name": "Easy running", "reps": "2 km", "target": EASY}]},
    {"title": "Main set", "steps": [{"name": "Uphill", "sets": 6, "reps": "60 s", "target": "hard (RPE 8)", "rest": "jog back down"}]},
    {"title": "Cool-down", "steps": [{"name": "Easy running", "reps": "1.5 km", "target": EASY}]},
])


def steps(workout):
    return workout["workoutSegments"][0]["workoutSteps"]


class EndConditions(unittest.TestCase):
    def test_distances_times_and_the_lap_button(self):
        self.assertEqual(end_condition("2 km"), ("distance", 2000))
        self.assertEqual(end_condition("1.5 km"), ("distance", 1500))
        self.assertEqual(end_condition("400 m"), ("distance", 400))
        self.assertEqual(end_condition("60 s"), ("time", 60))
        self.assertEqual(end_condition("20 min"), ("time", 1200))
        self.assertEqual(end_condition("2 min jog"), ("time", 120))
        # a range, or words, end when you press Lap
        for text in ("10–15 min", "2–3 min jog", "jog back down", "full recovery", None):
            self.assertEqual(end_condition(text), ("lap.button", None))


class Paces(unittest.TestCase):
    def test_a_range_becomes_slower_then_faster_speed(self):
        slow, fast = pace_range(EASY)
        self.assertAlmostEqual(slow, 1000 / 327, places=3)
        self.assertAlmostEqual(fast, 1000 / 297, places=3)

    def test_a_single_pace_gets_a_small_band(self):
        slow, fast = pace_range("4:22/km")
        self.assertAlmostEqual(slow, 1000 / 267, places=3)
        self.assertAlmostEqual(fast, 1000 / 257, places=3)

    def test_effort_targets_have_no_pace(self):
        for text in ("hard (RPE 8)", "easy (RPE 3–4)", "conversational", "fast and relaxed", None):
            self.assertIsNone(pace_range(text))


class Workouts(unittest.TestCase):
    def test_hill_repeats(self):
        w = to_workout(HILLS, "marathon")
        self.assertEqual(w["workoutName"], "Hill repeats · Tue 3 Nov")
        self.assertEqual(w["sportType"]["sportTypeKey"], "running")
        self.assertEqual(w["estimatedDurationInSecs"], 45 * 60)
        warm, repeat, cool = steps(w)

        self.assertEqual(warm["stepType"]["stepTypeKey"], "warmup")
        self.assertEqual((warm["endCondition"]["conditionTypeKey"], warm["endConditionValue"]), ("distance", 2000))
        self.assertEqual(warm["targetType"]["workoutTargetTypeKey"], "pace.zone")

        self.assertEqual(repeat["type"], "RepeatGroupDTO")
        self.assertEqual(repeat["numberOfIterations"], 6)
        hill, back = repeat["workoutSteps"]
        self.assertEqual((hill["endCondition"]["conditionTypeKey"], hill["endConditionValue"]), ("time", 60))
        self.assertEqual(hill["targetType"]["workoutTargetTypeKey"], "no.target")
        self.assertEqual(hill["description"], "Uphill · hard (RPE 8)")
        self.assertEqual(back["stepType"]["stepTypeKey"], "recovery")
        self.assertEqual(back["endCondition"]["conditionTypeKey"], "lap.button")
        self.assertEqual(back["description"], "jog back down")

        self.assertEqual(cool["stepType"]["stepTypeKey"], "cooldown")
        # every step, nested ones too, numbered in order
        self.assertEqual([warm["stepOrder"], repeat["stepOrder"], hill["stepOrder"], back["stepOrder"], cool["stepOrder"]],
                         [1, 2, 3, 4, 5])

    def test_the_outline_reads_like_the_plan(self):
        self.assertEqual(outline(to_workout(HILLS, "marathon")), [
            "warmup    2 km @ 4:57–5:27/km  (Easy running)",
            "Repeat 6×",
            "  interval  1 min  (Uphill · hard (RPE 8))",
            "  recovery  until Lap  (jog back down)",
            "cooldown  1.5 km @ 4:57–5:27/km  (Easy running)",
        ])

    def test_intervals_with_timed_and_ranged_recoveries(self):
        w = to_workout(session([
            {"title": "Main set", "steps": [{"name": "Threshold", "sets": 3, "reps": "6 min", "target": "4:07/km", "rest": "2 min jog at 5:27–6:27/km"}]},
            {"title": "Main set", "steps": [{"name": "Intervals", "sets": 5, "reps": "800 m", "target": "3:50/km", "rest": "2–3 min jog at 5:27–6:27/km"}]},
            {"title": "Main set", "steps": [{"name": "Intervals", "sets": 4, "reps": "1 km", "target": "4:10/km", "rest": "90 s"}]},
        ]), "marathon")
        threshold, intervals, standing = steps(w)
        jog = threshold["workoutSteps"][1]
        self.assertEqual((jog["endConditionValue"], jog["description"]), (120, "2 min jog"))
        # recovery jogs carry their pace
        self.assertEqual(jog["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertAlmostEqual(jog["targetValueOne"], 1000 / 387, places=3)
        self.assertAlmostEqual(jog["targetValueTwo"], 1000 / 327, places=3)
        self.assertEqual(intervals["workoutSteps"][0]["preferredEndConditionUnit"], {"unitKey": "meter"})
        ranged = intervals["workoutSteps"][1]
        self.assertEqual((ranged["endCondition"]["conditionTypeKey"], ranged["description"]), ("lap.button", "2–3 min jog"))
        self.assertEqual(ranged["targetType"]["workoutTargetTypeKey"], "pace.zone")
        rest = standing["workoutSteps"][1]
        self.assertEqual((rest["endConditionValue"], rest["description"], rest["targetType"]["workoutTargetTypeKey"]),
                         (90, "Rest", "no.target"))

    def test_strides_at_pace_with_a_walk_back(self):
        w = to_workout(session([{"title": "Strides", "steps": [
            {"name": "Strides on flat ground", "sets": 6, "reps": "20 s", "target": "3:32/km", "rest": "walk back"}]}]), "marathon")
        stride, walk = steps(w)[0]["workoutSteps"]
        self.assertEqual(stride["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertEqual((walk["endCondition"]["conditionTypeKey"], walk["description"]), ("lap.button", "walk back"))
        self.assertEqual(walk["targetType"]["workoutTargetTypeKey"], "no.target")

    def test_race_day(self):
        w = to_workout(session([{"title": "Warm-up", "steps": [
            {"name": "Easy jog", "reps": "10–15 min", "target": EASY},
            {"name": "Strides", "sets": 4, "reps": "20 s", "target": "3:32/km", "rest": "walk back"},
        ]}, {"title": "Race", "steps": [{"name": "Marathon", "reps": "42.2 km", "target": "4:22/km"}]}],
            discipline="race", title="Dead Sea Marathon", day="2027-02-04"), "marathon")
        jog, strides, race = steps(w)
        self.assertEqual((jog["endCondition"]["conditionTypeKey"], jog["targetType"]["workoutTargetTypeKey"]), ("lap.button", "pace.zone"))
        self.assertEqual(jog["description"], "Easy jog · 10–15 min")
        self.assertEqual([s["stepType"]["stepTypeKey"] for s in strides["workoutSteps"]], ["warmup", "recovery"])
        self.assertEqual(race["endConditionValue"], 42200)

    def test_reps_without_a_rest_still_get_a_recovery(self):
        w = to_workout(session([{"title": "Main set", "steps": [{"name": "Strides", "sets": 4, "reps": "20 s"}]}]), "marathon")
        (repeat,) = steps(w)
        self.assertEqual(repeat["workoutSteps"][1]["description"], "recover")

    def test_an_eased_run(self):
        w = to_workout(session([{"title": "Run", "steps": [{"name": "Easy running", "reps": "30 min", "target": "conversational"}]}]), "10k")
        (run,) = steps(w)
        self.assertEqual((run["endConditionValue"], run["description"]), (1800, "Easy running · conversational"))

    def test_only_runs_go_to_the_watch(self):
        strength = session([{"title": "Strength", "steps": [{"name": "Back squats", "sets": 3, "reps": "8"}]}], discipline="strength")
        self.assertIsNone(to_workout(strength, "marathon"))
        # a HYROX race isn't a run, a marathon is
        race = session([{"title": "Race", "steps": [{"name": "Marathon", "reps": "42.2 km"}]}], discipline="race")
        self.assertIsNone(to_workout(race, "hyrox"))
        self.assertIsNotNone(to_workout(race, "marathon"))
        self.assertIsNone(to_workout(session(None), "marathon"))


if __name__ == "__main__":
    unittest.main()
