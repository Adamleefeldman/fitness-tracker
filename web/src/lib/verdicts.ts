/**
 * Rule-based verdicts: each page's plain-English answer to its question.
 *
 * Every function takes the *windowed* daily rows (and activities where
 * relevant). Each verdict has an *Inputs function returning the numbers it
 * judges, so they can be shown on their own (the MCP server's
 * explain_verdict). The rules are deliberately simple and transparent —
 * sports-science defaults, no ML:
 *
 *   ACWR sweet spot 0.8–1.3 (caution to 1.5, bad above)   [training load]
 *   RHR creep: 7-day avg >= 3 bpm above 28-day avg        [overreaching]
 *   HRV suppression: 7-day avg below Garmin baseline low  [overreaching]
 */

import * as A from "./analytics.ts";
import { pyFixed } from "./format.ts";
import { friendlyLevel, levelStatus, type Status } from "./levels.ts";
import type { Activity, Daily } from "./types.ts";

export interface Verdict {
  status: Status;
  word: string;
  sentence: string;
}

const NO_DATA = (sentence: string): Verdict => ({ status: "neutral", word: "No data", sentence });

/** Mean of the last `n` non-null values. */
function meanTail(xs: number[], n: number) {
  return A.mean(xs.slice(-n));
}

/** Upper-case the first letter only. */
const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

const last = <T>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null);

export interface TodayInputs {
  level: string | null;
  score: number | null;
  drivers: Partial<Record<A.DriverName, number>>;
  /** The lowest driver (first in HRV, Sleep, Recovery, Load order on a tie). */
  weakest: { name: A.DriverName; pct: number } | null;
}

/** The newest row's readiness level and score, and the factors behind them. */
export function todayInputs(d: Daily[]): TodayInputs {
  const row = d.at(-1);
  const drivers = A.readinessDrivers(d);
  const entries = Object.entries(drivers) as [A.DriverName, number][];
  // first minimum, like Python's min()
  const lo = entries.length ? entries.reduce((lo, cur) => (cur[1] < lo[1] ? cur : lo)) : null;
  return {
    level: row?.training_readiness_level ?? null,
    score: row?.training_readiness_score ?? null,
    drivers,
    weakest: lo && { name: lo[0], pct: lo[1] },
  };
}

/** Train hard today? Driven by Garmin readiness + its weakest factor. */
export function today(d: Daily[]): Verdict {
  if (!d.length) return NO_DATA("No readiness data yet.");
  const { level, weakest } = todayInputs(d);
  const [word, phrase] = friendlyLevel(level);
  let sentence = phrase;
  if (weakest && weakest.pct < 60) {
    sentence = `${phrase} — ${weakest.name.toLowerCase()} is the main limiter (${Math.trunc(weakest.pct)}%)`;
  }
  return { status: levelStatus(level), word, sentence };
}

export interface LoadInputs {
  /** Latest acute:chronic workload ratio. */
  acwr: number | null;
  acuteLoad: number | null;
  chronicLoad: number | null;
  /** Mean of the last 7 and 28 resting-HR readings, and the gap between them. */
  rhr7: number | null;
  rhr28: number | null;
  rhrCreep: number | null;
  /** Mean of the last 7 HRV readings, against the low end of Garmin's baseline. */
  hrv7: number | null;
  hrvBaselineLow: number | null;
  hrvSuppressed: boolean;
}

export function loadInputs(d: Daily[]): LoadInputs {
  const rhr = A.values(d, "resting_hr");
  const rhr7 = meanTail(rhr, 7);
  const rhr28 = meanTail(rhr, 28);
  const hrv7 = meanTail(A.values(d, "hrv_last_night_ms"), 7);
  const baseLow = A.lastValue(d, "hrv_baseline_low");
  return {
    acwr: last(A.acwr(d).filter((r): r is number => r != null)),
    acuteLoad: A.lastValue(d, "acute_load"),
    chronicLoad: A.lastValue(d, "chronic_load"),
    rhr7,
    rhr28,
    rhrCreep: rhr7 != null && rhr28 != null ? rhr7 - rhr28 : null,
    hrv7,
    hrvBaselineLow: baseLow,
    hrvSuppressed: hrv7 != null && baseLow != null && hrv7 < baseLow,
  };
}

/** Am I overtraining? ACWR plus the two recovery red flags. */
export function load(d: Daily[]): Verdict {
  const { acwr: ratio, rhrCreep: creep, hrvSuppressed: suppressed } = loadInputs(d);

  const flags: string[] = [];
  if (creep != null && creep >= 3) flags.push(`resting HR is ${pyFixed(creep)} bpm above your monthly norm`);
  if (suppressed) flags.push("HRV is running below baseline");

  if (ratio == null) return NO_DATA("Not enough load data in this range.");
  const r = pyFixed(ratio, 2);
  let word: string, status: Status, why: string;
  if (ratio > 1.5 || (ratio > 1.3 && flags.length)) {
    [word, status, why] = ["Overreaching", "bad", `load ratio ${r} is well above the sweet spot`];
  } else if (ratio > 1.3) {
    [word, status, why] = ["Ramping fast", "caution", `load ratio ${r} is above the 0.8–1.3 sweet spot`];
  } else if (ratio < 0.8) {
    [word, status, why] = ["Detraining", "caution", `load ratio ${r} — training less than your body is used to`];
  } else if (flags.length) {
    why = `load ratio ${r} is balanced, but ${flags.join(" and ")}`;
    return { status: "caution", word: "Watch recovery", sentence: cap(why) };
  } else {
    [word, status, why] = ["Balanced", "good", `load ratio ${r} is in the sweet spot`];
  }
  if (flags.length) why += `, and ${flags.join(" and ")}`;
  return { status, word, sentence: cap(why) };
}

export interface FitnessInputs {
  /** First and latest running VO₂max in the range, and the change between them. */
  vo2First: number | null;
  vo2Last: number | null;
  vo2Delta: number | null;
  /** Weekly running km, recent half of the range vs the earlier half (%). */
  runVolumeChangePct: number | null;
}

export function fitnessInputs(d: Daily[], acts: Activity[]): FitnessInputs {
  // ffill().dropna(): rows from the first reading on, carrying the last value forward
  const firstIdx = d.findIndex((r) => r.vo2max_running != null);
  const vo2Len = firstIdx < 0 ? 0 : d.length - firstIdx;
  const vo2First = firstIdx < 0 ? null : d[firstIdx].vo2max_running!;
  const vo2Last = A.lastValue(d, "vo2max_running");

  let runVolumeChangePct: number | null = null;
  const runs = acts.filter((a) => a.activity_type === "running");
  if (runs.length >= 4) {
    const wk = A.weeklyDistance(runs).distance_km;
    if (wk.length >= 4) {
      const half = Math.floor(wk.length / 2);
      const recent = A.mean(wk.slice(half))!;
      const earlier = A.mean(wk.slice(0, half))!;
      if (earlier > 0) runVolumeChangePct = ((recent - earlier) / earlier) * 100;
    }
  }
  return {
    vo2First,
    vo2Last,
    vo2Delta: vo2Len >= 2 ? vo2Last! - vo2First! : null,
    runVolumeChangePct,
  };
}

/** Am I getting fitter? VO2max direction + running volume + pace. */
export function fitness(d: Daily[], acts: Activity[]): Verdict {
  const { vo2Last, vo2Delta, runVolumeChangePct: pct } = fitnessInputs(d, acts);
  const volNote = pct != null && Math.abs(pct) >= 15
    ? `; running volume ${pct > 0 ? "up" : "down"} ${pyFixed(Math.abs(pct))}%`
    : "";

  if (vo2Delta == null) return NO_DATA("No VO₂max readings in this range.");
  if (vo2Delta >= 0.3) {
    return { status: "good", word: "Improving", sentence: `VO₂max up ${pyFixed(vo2Delta, 1)} over this range${volNote}` };
  }
  if (vo2Delta <= -0.3) {
    return { status: "caution", word: "Slipping", sentence: `VO₂max down ${pyFixed(Math.abs(vo2Delta), 1)} over this range${volNote}` };
  }
  return { status: "good", word: "Holding", sentence: `VO₂max steady at ${pyFixed(vo2Last!, 1)}${volNote}` };
}

export interface SleepInputs {
  /** Mean of the last 7 sleep scores, and of the 21 before them. */
  score7: number | null;
  scorePrior: number | null;
  /** Mean of the last 7 nights' sleep, in hours. */
  hours7: number | null;
  /** Standard deviation of the last 14 bedtimes, in minutes. */
  bedtimeSdMin: number | null;
}

export function sleepInputs(d: Daily[]): SleepInputs {
  const scores = A.values(d, "sleep_score");
  const prior = scores.slice(0, Math.max(0, scores.length - 7));
  const dur7 = meanTail(A.values(d, "sleep_total_seconds"), 7);
  const st = A.sleepTimes(d);
  const bedSd = st.length >= 5 ? A.std(st.slice(-14).map((s) => s.bed_h)) : null;
  return {
    score7: meanTail(scores, 7),
    scorePrior: prior.length ? A.mean(prior.slice(-21)) : null,
    hours7: dur7 ? dur7 / 3600 : null,
    bedtimeSdMin: bedSd != null ? bedSd * 60 : null,
  };
}

/** Is my sleep/recovery improving? Score level+trend, duration, regularity. */
export function sleep(d: Daily[]): Verdict {
  const { score7, scorePrior, hours7: durH, bedtimeSdMin: bedSdMin } = sleepInputs(d);

  if (score7 == null) return NO_DATA("No sleep scores in this range.");

  let trend = "";
  if (scorePrior != null && Math.abs(score7 - scorePrior) >= 2) {
    trend = `, ${score7 > scorePrior ? "up" : "down"} ${pyFixed(Math.abs(score7 - scorePrior))} on the previous weeks`;
  }

  const issues: string[] = [];
  if (durH != null && durH < 6.5) issues.push(`averaging only ${pyFixed(durH, 1)}h in bed`);
  if (bedSdMin != null && bedSdMin > 75) issues.push(`bedtime varies by ±${pyFixed(bedSdMin)} min`);

  let status: Status, word: string;
  if (score7 < 60) [status, word] = ["bad", "Poor"];
  else if (score7 < 75 || issues.length) [status, word] = ["caution", "Mixed"];
  else [status, word] = ["good", "Solid"];

  let sentence = `Sleep score averaging ${pyFixed(score7)} this week${trend}`;
  if (issues.length) sentence += ` — ${issues.join(" and ")}`;
  return { status, word, sentence };
}
