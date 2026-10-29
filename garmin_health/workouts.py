"""Plan sessions → Garmin Connect workouts.

The Plan page stores each session's workout as blocks of steps written for
people: "2 km", "6 × 60 s", "4:57–5:27/km", "jog back down". This turns a run
into the structured workout Garmin's calendar and watch understand: warm-up,
repeats, recoveries and cool-down, each ending on a distance, a time or the lap
button, with a pace range wherever the plan gives a pace.

Only runs are translated (run sessions, and race days of running goals). Pure
functions, no network: push.py does the uploading.
"""

from __future__ import annotations

import re
from datetime import date

RUNNING_GOALS = {"5k", "10k", "half_marathon", "marathon"}

# A single goal pace ("4:22/km") becomes a range this many seconds either side,
# so the watch doesn't nag at every small wobble.
PACE_BAND_S = 5

_RUNNING = {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1}
_STEP_TYPES = {
    "warmup": {"stepTypeId": 1, "stepTypeKey": "warmup", "displayOrder": 1},
    "cooldown": {"stepTypeId": 2, "stepTypeKey": "cooldown", "displayOrder": 2},
    "interval": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
    "recovery": {"stepTypeId": 4, "stepTypeKey": "recovery", "displayOrder": 4},
    "repeat": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
}
_CONDITIONS = {
    "lap.button": {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True},
    "time": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True},
    "distance": {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True},
    "iterations": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
}
_NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
_PACE = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}

_NUM = r"(\d+(?:\.\d+)?)"
_DASH = r"\s*[–-]\s*"
_PACE_RE = re.compile(rf"^(\d+):(\d\d)(?:{_DASH}(\d+):(\d\d))?/km$")


def supported(discipline: str, goal: str) -> bool:
    """Whether a session can go to the watch: runs, and race days of running goals."""
    return discipline == "run" or (discipline == "race" and goal in RUNNING_GOALS)


def end_condition(amount: str | None) -> tuple[str, float | None]:
    """How a step ends: ("distance", metres), ("time", seconds), or ("lap.button", None).

    A range such as "10–15 min" ends on the lap button: you decide when you're ready.
    """
    text = (amount or "").strip()
    if m := re.fullmatch(rf"{_NUM}\s*km", text):
        return "distance", float(m[1]) * 1000
    if m := re.fullmatch(rf"{_NUM}\s*m", text):
        return "distance", float(m[1])
    if m := re.fullmatch(rf"{_NUM}\s*s", text):
        return "time", float(m[1])
    if m := re.fullmatch(rf"{_NUM}\s*min(?:\s+jog)?", text):
        return "time", float(m[1]) * 60
    return "lap.button", None


def pace_range(target: str | None) -> tuple[float, float] | None:
    """A pace target as Garmin's (slower, faster) speeds in m/s, or None for effort targets."""
    m = _PACE_RE.match((target or "").strip())
    if not m:
        return None
    a = int(m[1]) * 60 + int(m[2])
    b = int(m[3]) * 60 + int(m[4]) if m[3] else None
    slow, fast = (max(a, b), min(a, b)) if b else (a + PACE_BAND_S, a - PACE_BAND_S)
    return round(1000 / slow, 4), round(1000 / fast, 4)


def _step(kind: str, amount: str | None, target: str | None, description: str | None) -> dict:
    condition, value = end_condition(amount)
    pace = pace_range(target)
    step = {
        "type": "ExecutableStepDTO",
        "stepType": _STEP_TYPES[kind],
        "endCondition": _CONDITIONS[condition],
        "targetType": _PACE if pace else _NO_TARGET,
    }
    if value is not None:
        step["endConditionValue"] = value
    if condition == "distance":
        step["preferredEndConditionUnit"] = {"unitKey": "kilometer" if value >= 1000 else "meter"}
    if pace:
        step["targetValueOne"], step["targetValueTwo"] = pace
    if description:
        step["description"] = description[:512]
    return step


def _describe(*parts: str | None) -> str | None:
    text = " · ".join(p for p in parts if p)
    return text or None


def _repeat(times: int, steps: list[dict]) -> dict:
    return {
        "type": "RepeatGroupDTO",
        "stepType": _STEP_TYPES["repeat"],
        "numberOfIterations": times,
        "endCondition": _CONDITIONS["iterations"],
        "endConditionValue": float(times),
        "smartRepeat": False,
        "workoutSteps": steps,
    }


def _block_steps(block: dict) -> list[dict]:
    title = block.get("title", "")
    kind = "warmup" if title.lower().startswith("warm") else "cooldown" if title.lower().startswith("cool") else "interval"
    out = []
    for s in block.get("steps", []):
        effort = None if pace_range(s.get("target")) else s.get("target")
        amount = s.get("reps")
        # a range ("10–15 min") ends on the lap button, so say how long in the note
        shown = amount if end_condition(amount)[0] == "lap.button" and amount else None
        work = _step(kind, amount, s.get("target"), _describe(s.get("name"), shown, effort, s.get("note")))
        sets = s.get("sets") or 1
        if sets <= 1 and not s.get("rest"):
            out.append(work)
            continue
        # reps with no rest given (strides) still need a breather between them
        rest = s.get("rest") or "recover"
        recovery = _step("recovery", rest, None, rest if end_condition(rest)[0] == "lap.button" else None)
        out.extend([_repeat(sets, [work, recovery])] if sets > 1 else [work, recovery])
    rounds = block.get("rounds") or 1
    return [_repeat(rounds, out)] if rounds > 1 and out else out


def _number(steps: list[dict], start: int = 1) -> int:
    """Garmin wants every step, nested ones included, numbered in order."""
    n = start
    for s in steps:
        s["stepOrder"] = n
        n += 1
        if s["type"] == "RepeatGroupDTO":
            n = _number(s["workoutSteps"], n)
    return n


def workout_name(title: str, day: str) -> str:
    """The name on the calendar and watch, dated so a list of easy runs stays readable."""
    d = date.fromisoformat(day)
    return f"{title} · {d:%a} {d.day} {d:%b}"


def to_workout(session: dict, goal: str) -> dict | None:
    """The Garmin workout for a stored plan session, or None when it doesn't translate.

    `session` needs date, discipline, title, description, duration_min and
    blocks (the parsed blocks_json).
    """
    if not supported(session["discipline"], goal) or not session.get("blocks"):
        return None
    steps = [step for block in session["blocks"] for step in _block_steps(block)]
    if not steps:
        return None
    _number(steps)
    notes = [b["note"] for b in session["blocks"] if b.get("note")]
    return {
        "workoutName": workout_name(session["title"], session["date"]),
        "description": "\n".join([session["description"], *notes, "From your training plan (garmin-health)."])[:1024],
        "sportType": _RUNNING,
        "estimatedDurationInSecs": int(session["duration_min"]) * 60,
        "workoutSegments": [{"segmentOrder": 1, "sportType": _RUNNING, "workoutSteps": steps}],
    }


def _pace_text(speed: float) -> str:
    secs = round(1000 / speed)
    return f"{secs // 60}:{secs % 60:02d}"


def outline(workout: dict) -> list[str]:
    """The workout as the watch will run it, one line per step, for checking by eye."""
    lines: list[str] = []

    def walk(steps: list[dict], indent: str) -> None:
        for s in steps:
            if s["type"] == "RepeatGroupDTO":
                lines.append(f"{indent}Repeat {s['numberOfIterations']}×")
                walk(s["workoutSteps"], indent + "  ")
                continue
            cond, value = s["endCondition"]["conditionTypeKey"], s.get("endConditionValue")
            until = (f"{value / 1000:g} km" if value >= 1000 else f"{value:g} m") if cond == "distance" \
                else (f"{value / 60:g} min" if value >= 60 else f"{value:g} s") if cond == "time" else "until Lap"
            pace = f" @ {_pace_text(s['targetValueTwo'])}–{_pace_text(s['targetValueOne'])}/km" if s.get("targetValueOne") else ""
            note = f"  ({s['description']})" if s.get("description") else ""
            lines.append(f"{indent}{s['stepType']['stepTypeKey']:<9} {until}{pace}{note}")

    walk(workout["workoutSegments"][0]["workoutSteps"], "")
    return lines
