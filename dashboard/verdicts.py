"""Rule-based verdicts: each page's plain-English answer to its question.

Every function takes the *windowed* daily DataFrame (and activities where
relevant) and returns {"status": good|caution|bad|neutral, "word": short
label, "sentence": one line of reasoning}. The rules are deliberately
simple and transparent — sports-science defaults, no ML:

  ACWR sweet spot 0.8–1.3 (caution to 1.5, bad above)   [training load]
  RHR creep: 7-day avg >= 3 bpm above 28-day avg        [overreaching]
  HRV suppression: 7-day avg below Garmin baseline low  [overreaching]
"""

from __future__ import annotations

import pandas as pd

from garmin_health import analytics as A


def _last(series):
    s = series.dropna()
    return float(s.iloc[-1]) if len(s) else None


def _mean_tail(series, n):
    s = series.dropna().tail(n)
    return float(s.mean()) if len(s) else None


def _cap(s):
    """Upper-case the first letter only (str.capitalize would lower-case 'HRV')."""
    return s[:1].upper() + s[1:]


def today(d):
    """Train hard today? Driven by Garmin readiness + its weakest factor."""
    from dashboard import theme as T

    level = d.iloc[-1].get("training_readiness_level")
    word, phrase = T.friendly_level(level)
    lvl = T.level_key(level)
    status = ("good" if lvl in ("PRIME", "HIGH", "VERY_HIGH")
              else "caution" if lvl in ("MODERATE", "MAINTAINING")
              else "bad" if lvl in ("LOW", "POOR", "VERY_LOW") else "neutral")
    drivers = A.readiness_drivers(d)
    sentence = phrase
    if drivers:
        weakest = min(drivers, key=drivers.get)
        if drivers[weakest] < 60:
            sentence = f"{phrase} — {weakest.lower()} is the main limiter ({int(drivers[weakest])}%)"
    return {"status": status, "word": word, "sentence": sentence}


def load(d):
    """Am I overtraining? ACWR plus the two recovery red flags."""
    ratio = _last(A.acwr(d))
    creep = None
    rhr7, rhr28 = _mean_tail(d["resting_hr"], 7), _mean_tail(d["resting_hr"], 28)
    if rhr7 is not None and rhr28 is not None:
        creep = rhr7 - rhr28
    hrv7 = _mean_tail(d["hrv_last_night_ms"], 7)
    base_low = _last(d["hrv_baseline_low"])
    suppressed = hrv7 is not None and base_low is not None and hrv7 < base_low

    flags = []
    if creep is not None and creep >= 3:
        flags.append(f"resting HR is {creep:.0f} bpm above your monthly norm")
    if suppressed:
        flags.append("HRV is running below baseline")

    if ratio is None:
        return {"status": "neutral", "word": "No data",
                "sentence": "Not enough load data in this range."}
    if ratio > 1.5 or (ratio > 1.3 and flags):
        word, status = "Overreaching", "bad"
        why = f"load ratio {ratio:.2f} is well above the sweet spot"
    elif ratio > 1.3:
        word, status = "Ramping fast", "caution"
        why = f"load ratio {ratio:.2f} is above the 0.8–1.3 sweet spot"
    elif ratio < 0.8:
        word, status = "Detraining", "caution"
        why = f"load ratio {ratio:.2f} — training less than your body is used to"
    elif flags:
        word, status = "Watch recovery", "caution"
        why = f"load ratio {ratio:.2f} is balanced, but " + " and ".join(flags)
        return {"status": status, "word": word, "sentence": _cap(why)}
    else:
        word, status = "Balanced", "good"
        why = f"load ratio {ratio:.2f} is in the sweet spot"
    if flags:
        why += ", and " + " and ".join(flags)
    return {"status": status, "word": word, "sentence": _cap(why)}


def fitness(d, acts):
    """Am I getting fitter? VO2max direction + running volume + pace."""
    vo2 = d["vo2max_running"].ffill().dropna()
    vo2_delta = float(vo2.iloc[-1] - vo2.iloc[0]) if len(vo2) >= 2 else None

    runs = acts[(acts["activity_type"] == "running")] if not acts.empty else acts
    vol_note = ""
    if not runs.empty and len(runs) >= 4:
        wk = A.weekly_distance(runs)
        if len(wk) >= 4:
            half = len(wk) // 2
            recent, earlier = wk["distance_km"].iloc[half:].mean(), wk["distance_km"].iloc[:half].mean()
            if earlier > 0:
                pct = (recent - earlier) / earlier * 100
                if abs(pct) >= 15:
                    vol_note = f"; running volume {'up' if pct > 0 else 'down'} {abs(pct):.0f}%"

    if vo2_delta is None:
        return {"status": "neutral", "word": "No data",
                "sentence": "No VO₂max readings in this range."}
    if vo2_delta >= 0.3:
        return {"status": "good", "word": "Improving",
                "sentence": f"VO₂max up {vo2_delta:.1f} over this range{vol_note}"}
    if vo2_delta <= -0.3:
        return {"status": "caution", "word": "Slipping",
                "sentence": f"VO₂max down {abs(vo2_delta):.1f} over this range{vol_note}"}
    return {"status": "good", "word": "Holding",
            "sentence": f"VO₂max steady at {vo2.iloc[-1]:.1f}{vol_note}"}


def sleep(d):
    """Is my sleep/recovery improving? Score level+trend, duration, regularity."""
    score7 = _mean_tail(d["sleep_score"], 7)
    prior = d["sleep_score"].dropna().iloc[:-7]
    score_prior = float(prior.tail(21).mean()) if len(prior) else None
    dur7 = _mean_tail(d["sleep_total_seconds"], 7)
    dur_h = dur7 / 3600 if dur7 else None
    st = A.sleep_times(d)
    bed_sd_min = float(st["bed_h"].tail(14).std() * 60) if len(st) >= 5 else None

    if score7 is None:
        return {"status": "neutral", "word": "No data",
                "sentence": "No sleep scores in this range."}

    trend = ""
    if score_prior is not None and abs(score7 - score_prior) >= 2:
        trend = f", {'up' if score7 > score_prior else 'down'} {abs(score7 - score_prior):.0f} on the previous weeks"

    issues = []
    if dur_h is not None and dur_h < 6.5:
        issues.append(f"averaging only {dur_h:.1f}h in bed")
    if bed_sd_min is not None and bed_sd_min > 75:
        issues.append(f"bedtime varies by ±{bed_sd_min:.0f} min")

    if score7 < 60:
        status, word = "bad", "Poor"
    elif score7 < 75 or issues:
        status, word = "caution", "Mixed"
    else:
        status, word = "good", "Solid"
    sentence = f"Sleep score averaging {score7:.0f} this week{trend}"
    if issues:
        sentence += " — " + " and ".join(issues)
    return {"status": status, "word": word, "sentence": sentence}
