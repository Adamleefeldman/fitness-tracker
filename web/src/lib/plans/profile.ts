/**
 * The athlete as the Garmin data sees them: what training they've been doing
 * (the capacity a plan builds on) and the state their body is in now (which
 * sets how hard the plan may start and how it adapts).
 */

import * as A from "../analytics.ts";
import { friendlyLevel } from "../levels.ts";
import { pyFixed } from "../format.ts";
import type { Activity, Daily } from "../types.ts";
import * as V from "../verdicts.ts";
import { paces } from "./paces.ts";
import type { BodyState, Profile } from "./types.ts";

const DAY_MS = 86_400_000;

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Today's local date, 'YYYY-MM-DD'. */
export const localToday = (now = new Date()) => now.toLocaleDateString("en-CA");

const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Activities on days first..last inclusive. */
const between = (acts: Activity[], first: string, last: string) =>
  acts.filter((a) => a.date != null && a.date >= first && a.date <= last);

const minutes = (acts: Activity[]) => acts.reduce((m, a) => m + (a.duration_s ?? 0) / 60, 0);
const runKm = (acts: Activity[]) =>
  acts.filter((a) => A.activityGroup(a.activity_type) === "Running").reduce((km, a) => km + (a.distance_km ?? 0), 0);

/**
 * Body state from the last six weeks of daily rows, using the verdicts'
 * thresholds: `recover` when a red line is crossed, `caution` on a single
 * warning sign, `ready` when Garmin says ready and nothing argues against it.
 */
export function bodyState(daily: Daily[], today: string): BodyState {
  const d = A.trimBlankTail(daily).slice(-42);
  const day = d.at(-1)?.date ?? null;
  const ready = V.todayInputs(d);
  const load = V.loadInputs(d);
  const sleep = V.sleepInputs(d);
  const { sweetSpot: [, hi], overreaching, rhrCreepBpm } = V.RULES.load;
  const S = V.RULES.sleep;
  const level = (ready.level ?? "").toUpperCase();
  const word = friendlyLevel(ready.level)[0];
  const creep = load.rhrCreep != null && load.rhrCreep >= rhrCreepBpm;

  const recover: string[] = [];
  const caution: string[] = [];
  if (["LOW", "POOR", "VERY_LOW"].includes(level)) recover.push(`Garmin readiness is ${word}`);
  if (load.acwr != null && load.acwr > overreaching) {
    recover.push(`load ratio ${pyFixed(load.acwr, 2)} is well above the sweet spot`);
  } else if (load.acwr != null && load.acwr > hi) {
    caution.push(`load ratio ${pyFixed(load.acwr, 2)} is above the sweet spot`);
  }
  if (creep && load.hrvSuppressed) {
    recover.push("resting HR is up and HRV is below baseline together");
  } else if (creep) {
    caution.push(`resting HR is ${pyFixed(load.rhrCreep!)} bpm above its monthly norm`);
  } else if (load.hrvSuppressed) {
    caution.push("HRV is running below baseline");
  }
  if (sleep.score7 != null && sleep.score7 < S.poor) recover.push(`sleep score is averaging ${pyFixed(sleep.score7)}`);
  if (sleep.hours7 != null && sleep.hours7 < S.shortHours) caution.push(`sleep is averaging only ${pyFixed(sleep.hours7, 1)}h`);
  if (["MODERATE", "MAINTAINING"].includes(level) && ready.weakest && ready.weakest.pct < V.RULES.today.limiterPct) {
    caution.push(`readiness is ${word}, held back by ${ready.weakest.name.toLowerCase()}`);
  }

  const reasons = [...recover, ...caution];
  const lvl: BodyState["level"] = recover.length ? "recover"
    : caution.length ? "caution"
    : ["PRIME", "HIGH", "VERY_HIGH"].includes(level) ? "ready"
    : "normal";
  if (!reasons.length) {
    reasons.push(lvl === "ready" ? `Garmin readiness is ${word} with no warning signs` : "no warning signs");
  }
  if (load.acwr != null && load.acwr < V.RULES.load.sweetSpot[0]) {
    reasons.push("training less than your body is used to, so there's room to build");
  }
  const staleDays = day ? daysBetween(day, today) : null;
  if (staleDays != null && staleDays > 2) reasons.push(`no watch data for ${staleDays} days, so this is how you were on ${day}`);

  return {
    level: lvl,
    reasons,
    day,
    readinessScore: ready.score,
    readinessLevel: ready.level,
    acwr: load.acwr == null ? null : round(load.acwr, 2),
    rhrCreepBpm: load.rhrCreep == null ? null : round(load.rhrCreep, 1),
    hrvBelowBaseline: load.hrvSuppressed,
    sleepScore7: sleep.score7 == null ? null : round(sleep.score7),
    sleepHours7: sleep.hours7 == null ? null : round(sleep.hours7, 2),
    staleDays,
  };
}

export function buildProfile(daily: Daily[], activities: Activity[], today: string): Profile {
  const withData = A.trimBlankTail(daily);
  const asOf = withData.at(-1)?.date ?? null;
  // measure back from the newest day with data, so a watch that hasn't
  // uploaded for a few days doesn't make recent training look lighter
  const ref = asOf && asOf < today ? asOf : today;
  const last4 = between(activities, addDays(ref, -27), ref);
  const last12 = between(activities, addDays(ref, -83), ref);
  const last8 = between(activities, addDays(ref, -55), ref);

  const hours = Object.fromEntries(A.ACTIVITY_GROUPS.map((g) => [g, 0])) as Record<A.ActivityGroup, number>;
  for (const a of last12) hours[A.activityGroup(a.activity_type)] += (a.duration_s ?? 0) / 3600;
  const total = Object.values(hours).reduce((x, y) => x + y, 0);
  const mix = Object.fromEntries(
    A.ACTIVITY_GROUPS.map((g) => [g, total ? round(hours[g] / total, 2) : 0]),
  ) as Record<A.ActivityGroup, number>;

  const vo2 = A.lastValue(withData, "vo2max_running");
  const vo2Then = withData.find((r) => r.date >= addDays(ref, -90) && r.vo2max_running != null)?.vo2max_running ?? null;
  const longest = Math.max(0, ...last8
    .filter((a) => A.activityGroup(a.activity_type) === "Running")
    .map((a) => a.distance_km ?? 0));
  // the median of the five highest readings, so one sensor spike doesn't count
  const topHr = between(activities, addDays(ref, -364), ref)
    .map((a) => a.max_hr ?? 0).filter((h) => h > 0).sort((x, y) => y - x).slice(0, 5);
  const maxHr = topHr.length ? topHr[Math.floor(topHr.length / 2)] : 0;

  return {
    asOf,
    weeklyMinutes4: round(minutes(last4) / 4),
    weeklyMinutes12: round(minutes(last12) / 12),
    sessionsPerWeek4: round(last4.length / 4, 1),
    runKmPerWeek4: round(runKm(last4) / 4, 1),
    runKmPerWeek12: round(runKm(last12) / 12, 1),
    longestRunKm8: round(longest, 1),
    mix,
    vo2max: vo2,
    vo2maxTrend: vo2 != null && vo2Then != null ? round(vo2 - vo2Then, 1) : null,
    restingHr: A.lastValue(withData, "resting_hr"),
    maxHr: maxHr || null,
    paces: vo2 != null && vo2 >= 25 && vo2 <= 85 ? paces(vo2) : null,
    state: bodyState(daily, today),
  };
}
