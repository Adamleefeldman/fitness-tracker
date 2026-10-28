/**
 * Pure analytics over the Garmin rows.
 *
 * No database or Next.js imports, so it runs anywhere (pages, tests). Every
 * function tolerates missing values (the watch drops metrics some days), and
 * results match the pandas originals they were ported from — see
 * analytics.golden.test.ts.
 *
 * Weekly aggregates follow pandas resample("W"): weeks end on Sunday and are
 * labelled with that Sunday's date. They come back columnar ({weeks, ...arrays})
 * because that's the shape charts consume.
 */

import type { Activity, ActivityRow, Daily, DailyRow } from "./types.ts";

type Num = number | null;

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

// --- loading conveniences ---

export function withDailyDerived(rows: DailyRow[]): Daily[] {
  return rows.map((r) => ({
    ...r,
    sleep_hours: isNum(r.sleep_total_seconds) ? r.sleep_total_seconds / 3600 : null,
  }));
}

export function withActivityDerived(rows: ActivityRow[]): Activity[] {
  return rows.map((r) => ({
    ...r,
    distance_km: isNum(r.distance_m) ? r.distance_m / 1000 : null,
    pace_min_per_km: isNum(r.avg_pace_s_per_km) ? r.avg_pace_s_per_km / 60 : null,
  }));
}

/** The last `days` daily rows (all when null) and the activities inside them. */
export function sliceWindow(daily: Daily[], activities: Activity[], days: number | null) {
  const win = days ? daily.slice(-days) : daily;
  if (!win.length) return { daily: win, activities: [] as Activity[] };
  const start = win[0].date;
  const end = win[win.length - 1].date;
  return {
    daily: win,
    activities: activities.filter((a) => a.date != null && a.date >= start && a.date <= end),
  };
}

// --- series helpers ---

/**
 * A day "has data" once any of these is filled (mirrors CORE_COLUMNS in
 * garmin_health/db.py). Days the watch hasn't uploaded yet are stored blank.
 */
export const CORE_COLUMNS = [
  "resting_hr", "steps", "sleep_total_seconds", "hrv_last_night_ms",
  "bb_high", "stress_avg", "training_readiness_score",
] as const satisfies (keyof DailyRow)[];

export function hasData(row: DailyRow): boolean {
  return CORE_COLUMNS.some((c) => row[c] != null);
}

/** Rows up to and including the last one with data (drops a blank tail). */
export function trimBlankTail<R extends DailyRow>(daily: R[]): R[] {
  const i = daily.findLastIndex(hasData);
  return daily.slice(0, i + 1);
}

/** Non-null values of one column, oldest → newest. */
export function values<T>(rows: T[], key: keyof T): number[] {
  return rows.map((r): unknown => r[key]).filter(isNum);
}

/** Most-recent non-null value of a column. */
export function lastValue<T>(rows: T[], key: keyof T): Num {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i][key];
    if (isNum(v)) return v;
  }
  return null;
}

export function mean(xs: number[]): Num {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Sample standard deviation (ddof=1, like pandas). */
export function std(xs: number[]): Num {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Rolling mean that still produces values near the start of the series. */
export function rolling(series: Num[], window = 7): Num[] {
  const minPeriods = Math.max(1, Math.floor(window / 2));
  return series.map((_, i) => {
    const win = series.slice(Math.max(0, i - window + 1), i + 1).filter(isNum);
    return win.length >= minPeriods ? mean(win) : null;
  });
}

/** Acute:chronic workload ratio (the 'sweet spot' is roughly 0.8–1.3). */
export function acwr(daily: Daily[]): Num[] {
  return daily.map(({ acute_load: a, chronic_load: c }) => {
    if (!isNum(a) || !isNum(c)) return null;
    const r = a / c;
    return Number.isFinite(r) ? r : null;
  });
}

// --- weekly aggregates ---

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' → the Sunday that ends its pandas "W" week. */
export function weekEnding(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const toSunday = (7 - d.getUTCDay()) % 7;
  return new Date(d.getTime() + toSunday * DAY_MS).toISOString().slice(0, 10);
}

/** Every week-ending Sunday from `first` to `last` inclusive. */
function weekRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 7 * DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Sum `value` per (group, week). Like pandas groupby(group).resample("W"),
 * each group spans only its own first..last week; the union of those spans
 * becomes the week axis and missing cells are 0.
 */
function weeklyByGroup<T>(
  rows: T[],
  week: (r: T) => string,
  group: (r: T) => string,
  value: (r: T) => number,
) {
  const sums = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const g = group(r);
    const w = week(r);
    const byWeek = sums.get(g) ?? new Map<string, number>();
    byWeek.set(w, (byWeek.get(w) ?? 0) + value(r));
    sums.set(g, byWeek);
  }
  const groups = [...sums.keys()].sort();
  const weekSet = new Set<string>();
  for (const byWeek of sums.values()) {
    const ws = [...byWeek.keys()].sort();
    for (const w of weekRange(ws[0], ws[ws.length - 1])) weekSet.add(w);
  }
  const weeks = [...weekSet].sort();
  const series: Record<string, number[]> = {};
  for (const g of groups) series[g] = weeks.map((w) => sums.get(g)!.get(w) ?? 0);
  return { groups, weeks, series };
}

/** Total activity distance per week. */
export function weeklyDistance(activities: Activity[]): { weeks: string[]; distance_km: number[] } {
  const acts = activities.filter((a) => a.date != null);
  if (!acts.length) return { weeks: [], distance_km: [] };
  const { weeks, series } = weeklyByGroup(
    acts,
    (a) => weekEnding(a.date!),
    () => "all",
    (a) => (isNum(a.distance_km) ? a.distance_km : 0),
  );
  return { weeks, distance_km: series.all };
}

export type Intensity = "easy" | "moderate" | "hard";

/**
 * Activity groups for the weekly-hours chart. A fixed list (not "top N by
 * count") so each group keeps its colour and stack position whatever the range.
 */
export const ACTIVITY_GROUPS = ["Running", "HIIT", "Strength", "Other"] as const;
export type ActivityGroup = (typeof ACTIVITY_GROUPS)[number];

const GROUP_OF: Record<string, ActivityGroup> = {
  running: "Running", treadmill_running: "Running", trail_running: "Running", track_running: "Running",
  hiit: "HIIT",
  strength_training: "Strength",
};

export function activityGroup(type: string | null): ActivityGroup {
  return GROUP_OF[type ?? ""] ?? "Other";
}

/** Weekly training hours per activity group; `groups` lists those present, in ACTIVITY_GROUPS order. */
export function weeklyHoursByGroup(
  activities: Activity[],
): { groups: ActivityGroup[]; weeks: string[]; hours: Partial<Record<ActivityGroup, number[]>> } {
  const acts = activities.filter((a) => a.date != null && isNum(a.duration_s));
  if (!acts.length) return { groups: [], weeks: [], hours: {} };
  const { weeks, series } = weeklyByGroup(
    acts,
    (a) => weekEnding(a.date!),
    (a) => activityGroup(a.activity_type),
    (a) => a.duration_s! / 3600,
  );
  return { groups: ACTIVITY_GROUPS.filter((g) => g in series), weeks, hours: series };
}

/**
 * Sessions per week binned by intensity from Garmin training effect.
 *
 * hard: aerobic TE >= 3.5 or anaerobic TE >= 2.5 (improving / highly improving)
 * moderate: aerobic TE >= 2.5 (maintaining)
 * easy: everything below (recovery / minor benefit)
 */
export function intensityOf(a: Pick<ActivityRow, "aerobic_te" | "anaerobic_te">): Intensity {
  const ate = a.aerobic_te ?? 0;
  const ane = a.anaerobic_te ?? 0;
  if (ate >= 3.5 || ane >= 2.5) return "hard";
  if (ate >= 2.5) return "moderate";
  return "easy";
}

export function weeklyIntensity(activities: Activity[]): { weeks: string[] } & Record<Intensity, number[]> {
  const acts = activities.filter((a) => a.date != null);
  const { weeks, series } = weeklyByGroup(acts, (a) => weekEnding(a.date!), intensityOf, () => 1);
  const col = (k: Intensity) => series[k] ?? weeks.map(() => 0);
  return { weeks, easy: col("easy"), moderate: col("moderate"), hard: col("hard") };
}

// --- per-day derivations ---

export type DriverName = "HRV" | "Sleep" | "Recovery" | "Load";

/**
 * The factor percentages behind the latest readiness score (from raw_json),
 * e.g. {HRV: 96, Sleep: 67, Recovery: 51, Load: 81} — the numbers that explain
 * *why* readiness is what it is. Empty if unavailable.
 */
export function readinessDrivers(daily: Daily[]): Partial<Record<DriverName, number>> {
  const raw = daily.at(-1)?.raw_json;
  try {
    let r = JSON.parse(raw ?? "null")?.readiness;
    r = Array.isArray(r) ? (r[0] ?? {}) : (r ?? {});
    const fields: [DriverName, string][] = [
      ["HRV", "hrvFactorPercent"],
      ["Sleep", "sleepScoreFactorPercent"],
      ["Recovery", "recoveryTimeFactorPercent"],
      ["Load", "acwrFactorPercent"],
    ];
    const out: Partial<Record<DriverName, number>> = {};
    for (const [name, key] of fields) if (r[key] != null) out[name] = r[key];
    return out;
  } catch {
    return {};
  }
}

/** Hours from midnight of `date` to a 'YYYY-MM-DD HH:MM[:SS]' local timestamp. */
function hoursFrom(date: string, ts: string): number {
  const [d, t = "00:00"] = ts.trim().split(/[ T]/);
  const [h, m = 0, s = 0] = t.split(":").map(Number);
  const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
  return days * 24 + h + m / 60 + s / 3600;
}

/**
 * Bed/wake times as hours relative to midnight of each row's date.
 *
 * bed_h is negative when bedtime falls before midnight (previous evening),
 * so 23:30 -> -0.5 and 00:45 -> 0.75; wake_h is e.g. 7.25 for 07:15.
 */
export function sleepTimes(daily: Daily[]): { date: string; bed_h: number; wake_h: number }[] {
  return daily
    .filter((r) => r.sleep_start != null && r.sleep_end != null)
    .map((r) => ({
      date: r.date,
      bed_h: hoursFrom(r.date, r.sleep_start!),
      wake_h: hoursFrom(r.date, r.sleep_end!),
    }));
}

/** Most-recent non-null value for each requested column. */
export function latest<K extends keyof Daily>(daily: Daily[], columns: K[]): Record<K, Daily[K] | null> {
  const out = {} as Record<K, Daily[K] | null>;
  for (const col of columns) {
    const hit = daily.findLast((r) => r[col] != null && !Number.isNaN(r[col]));
    out[col] = hit ? hit[col] : null;
  }
  return out;
}
