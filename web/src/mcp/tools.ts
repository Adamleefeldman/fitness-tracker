/**
 * The MCP tools' logic: plain functions over a read-only connection, returning
 * JSON-ready objects. server.ts registers them; tests call them through a client.
 *
 * Results use the dashboard's own analytics and verdicts, so Claude and the
 * dashboard always agree. Units are in the field names, and null means the
 * watch didn't record that value.
 */

import type Database from "better-sqlite3";
import { z } from "zod";

import * as A from "../lib/analytics.ts";
import { mmss } from "../lib/format.ts";
import { freshness } from "../lib/freshness.ts";
import * as Q from "../lib/queries.ts";
import { RANGE_DAYS, RANGES, type RangeKey } from "../lib/range.ts";
import type { Activity, Daily } from "../lib/types.ts";
import * as V from "../lib/verdicts.ts";

export interface Ctx {
  db: Database.Database;
  now: () => Date;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;

const round = (v: number | null | undefined, dp: number) =>
  v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Local 'YYYY-MM-DD HH:MM'. */
const localTime = (d: Date) => d.toLocaleString("sv-SE").slice(0, 16);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

// --- get_overview ---

export const overviewInput = {
  range: z.enum(RANGES).default("90d")
    .describe("Window the verdicts judge, as on the dashboard: last 30 days, 90 days, 1 year, or all history"),
};

/** Newest non-null value of a column, with its date. */
function latestWithDate(daily: Daily[], col: keyof Daily, dp: number) {
  const row = daily.findLast((r) => r[col] != null);
  return row ? { value: round(row[col] as number, dp), date: row.date } : null;
}

export function getOverview(ctx: Ctx, { range }: { range: RangeKey }) {
  const daily = Q.dailyRows(ctx.db);
  const win = A.sliceWindow(daily, Q.activityRows(ctx.db), RANGE_DAYS[range]);
  // like the dashboard's Today page: judge readiness on the newest day with data
  const d = A.trimBlankTail(win.daily);
  const withData = A.trimBlankTail(daily);
  const syncedAt = Q.lastSynced(ctx.db);
  const dataDate = Q.lastDataDate(ctx.db);
  const { watchBehind, syncOverdue } = freshness(syncedAt, dataDate, ctx.now());
  const ready = V.todayInputs(d);

  const notes: string[] = [];
  if (watchBehind) {
    notes.push(`No data from the watch since ${dataDate}: the sync ran but Garmin had nothing newer. ` +
      "Opening Garmin Connect on the phone uploads it, and the next sync fills the gap.");
  }
  if (syncOverdue) {
    notes.push(syncedAt ? `The daily sync hasn't run since ${localTime(syncedAt)}.` : "Nothing has synced yet.");
  }

  return {
    range,
    window: win.daily.length ? { first_day: win.daily[0].date, last_day: win.daily.at(-1)!.date } : null,
    data: {
      newest_day_with_data: dataDate,
      last_sync: syncedAt && localTime(syncedAt),
      watch_not_uploading: watchBehind,
      sync_overdue: syncOverdue,
      notes,
    },
    verdicts: {
      today: { question: "Train hard today?", day: d.at(-1)?.date ?? null, ...V.today(d) },
      load: { question: "Am I overtraining?", ...V.load(win.daily) },
      fitness: { question: "Am I getting fitter?", ...V.fitness(win.daily, win.activities) },
      sleep: { question: "Is my sleep and recovery improving?", ...V.sleep(win.daily) },
    },
    readiness: {
      day: d.at(-1)?.date ?? null,
      score: ready.score,
      level: ready.level,
      factors_pct: ready.drivers,
    },
    latest: {
      resting_hr_bpm: latestWithDate(withData, "resting_hr", 0),
      hrv_ms: latestWithDate(withData, "hrv_last_night_ms", 0),
      sleep_score: latestWithDate(withData, "sleep_score", 0),
      sleep_hours: latestWithDate(withData, "sleep_hours", 2),
      vo2max_running: latestWithDate(withData, "vo2max_running", 1),
      body_battery_high: latestWithDate(withData, "bb_high", 0),
      steps: latestWithDate(withData, "steps", 0),
    },
  };
}

// --- get_daily_metrics ---

const hours = (s: number | null) => round(s == null ? null : s / 3600, 2);

/** Each metric Claude can ask for, in readable units. */
const METRICS = {
  readiness_score: (r: Daily) => r.training_readiness_score,
  readiness_level: (r: Daily) => r.training_readiness_level,
  resting_hr_bpm: (r: Daily) => r.resting_hr,
  min_hr_bpm: (r: Daily) => r.min_hr,
  max_hr_bpm: (r: Daily) => r.max_hr,
  hrv_ms: (r: Daily) => r.hrv_last_night_ms,
  hrv_status: (r: Daily) => r.hrv_status,
  hrv_baseline_low_ms: (r: Daily) => r.hrv_baseline_low,
  hrv_baseline_high_ms: (r: Daily) => r.hrv_baseline_high,
  sleep_score: (r: Daily) => r.sleep_score,
  sleep_hours: (r: Daily) => hours(r.sleep_total_seconds),
  deep_sleep_hours: (r: Daily) => hours(r.sleep_deep_seconds),
  rem_sleep_hours: (r: Daily) => hours(r.sleep_rem_seconds),
  light_sleep_hours: (r: Daily) => hours(r.sleep_light_seconds),
  awake_hours: (r: Daily) => hours(r.sleep_awake_seconds),
  bedtime: (r: Daily) => r.sleep_start,
  wake_time: (r: Daily) => r.sleep_end,
  body_battery_high: (r: Daily) => r.bb_high,
  body_battery_low: (r: Daily) => r.bb_low,
  stress_avg: (r: Daily) => r.stress_avg,
  stress_max: (r: Daily) => r.stress_max,
  vo2max_running: (r: Daily) => r.vo2max_running,
  training_status: (r: Daily) => r.training_status,
  acute_load: (r: Daily) => round(r.acute_load, 0),
  chronic_load: (r: Daily) => round(r.chronic_load, 0),
  acwr: (r: Daily) => round(A.acwr([r])[0], 2),
  steps: (r: Daily) => r.steps,
  floors: (r: Daily) => r.floors,
  distance_km: (r: Daily) => round(r.distance_m == null ? null : r.distance_m / 1000, 2),
  calories: (r: Daily) => r.calories,
  active_calories: (r: Daily) => r.active_calories,
  spo2_avg_pct: (r: Daily) => r.spo2_avg,
  respiration_avg_brpm: (r: Daily) => r.respiration_avg,
  weight_kg: (r: Daily) => round(r.weight_g == null ? null : r.weight_g / 1000, 1),
  body_fat_pct: (r: Daily) => r.body_fat_pct,
} satisfies Record<string, (r: Daily) => unknown>;

type Metric = keyof typeof METRICS;
const METRIC_NAMES = Object.keys(METRICS) as [Metric, ...Metric[]];

export const DEFAULT_METRICS: Metric[] = [
  "readiness_score", "resting_hr_bpm", "hrv_ms", "sleep_score", "sleep_hours",
  "body_battery_high", "stress_avg", "steps", "acwr",
];

export const dailyMetricsInput = {
  start: isoDate.optional().describe("First day, YYYY-MM-DD"),
  end: isoDate.optional().describe("Last day, YYYY-MM-DD (default: the newest stored day)"),
  metrics: z.array(z.enum(METRIC_NAMES)).min(1).optional()
    .describe(`Which metrics to return (default: ${DEFAULT_METRICS.join(", ")})`),
};

export function getDailyMetrics(
  ctx: Ctx,
  { start, end, metrics }: { start?: string; end?: string; metrics?: Metric[] },
) {
  const daily = Q.dailyRows(ctx.db);
  const cols = metrics ?? DEFAULT_METRICS;
  const newest = daily.at(-1)?.date;
  if (!newest) return { start: null, end: null, metrics: cols, days: [] };

  const last = end ?? (start && addDays(start, 13) < newest ? addDays(start, 13) : newest);
  const first = start ?? addDays(last, -13);
  if (first > last) throw new Error(`start ${first} is after end ${last}`);
  const span = daysBetween(first, last) + 1;
  if (span > MAX_DAYS) throw new Error(`That's ${span} days; ask for ${MAX_DAYS} or fewer at a time.`);

  return {
    start: first,
    end: last,
    metrics: cols,
    newest_day_with_data: Q.lastDataDate(ctx.db),
    days: daily
      .filter((r) => r.date >= first && r.date <= last)
      .map((r) => (A.hasData(r)
        ? { date: r.date, ...Object.fromEntries(cols.map((c) => [c, METRICS[c](r)])) }
        : { date: r.date, no_data: true })),
  };
}

// --- get_activities ---

export const activitiesInput = {
  start: isoDate.optional().describe("Earliest day, YYYY-MM-DD"),
  end: isoDate.optional().describe("Latest day, YYYY-MM-DD"),
  group: z.enum(A.ACTIVITY_GROUPS).optional()
    .describe("Running (outdoor, treadmill, trail, track), HIIT, Strength, or Other (everything else)"),
  type: z.string().optional().describe("An exact Garmin activity type, e.g. running, hiit, yoga, tennis_v2"),
  limit: z.number().int().min(1).max(200).default(20).describe("Most recent N matches to return"),
};

function activitySummary(a: Activity) {
  return {
    date: a.date,
    start_time: a.start_time_local?.slice(11, 16) ?? null,
    type: a.activity_type,
    group: A.activityGroup(a.activity_type),
    name: a.name,
    duration_min: round(a.duration_s == null ? null : a.duration_s / 60, 1),
    distance_km: round(a.distance_km, 2),
    pace_per_km: a.pace_min_per_km != null && a.distance_km ? mmss(a.pace_min_per_km) : null,
    avg_hr_bpm: round(a.avg_hr, 0),
    max_hr_bpm: round(a.max_hr, 0),
    training_load: round(a.training_load, 1),
    aerobic_te: a.aerobic_te,
    anaerobic_te: a.anaerobic_te,
    intensity: A.intensityOf(a),
    elevation_gain_m: round(a.elevation_gain_m, 0),
    calories: round(a.calories, 0),
  };
}

export function getActivities(
  ctx: Ctx,
  { start, end, group, type, limit }:
    { start?: string; end?: string; group?: A.ActivityGroup; type?: string; limit: number },
) {
  const all = Q.activityRows(ctx.db).filter((a) => a.date != null);
  const matched = all.filter((a) =>
    (!start || a.date! >= start) &&
    (!end || a.date! <= end) &&
    (!group || A.activityGroup(a.activity_type) === group) &&
    (!type || a.activity_type === type));
  const newestFirst = matched.slice(-limit).reverse();
  return {
    matched: matched.length,
    returned: newestFirst.length,
    activities: newestFirst.map(activitySummary),
    // help Claude correct a misspelt type
    ...(matched.length === 0 && type
      ? { known_types: [...new Set(all.map((a) => a.activity_type).filter(Boolean))].sort() }
      : {}),
  };
}
