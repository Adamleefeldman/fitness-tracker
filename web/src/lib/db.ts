/**
 * Read-only access to garmin.db — the Python sync is the only writer.
 *
 * better-sqlite3 is synchronous, so under Cache Components a query would run at
 * build time and freeze into the static shell. Every loader awaits
 * `connection()` first so reads happen per request and always see the latest sync.
 */

import "server-only";

import path from "node:path";

import Database from "better-sqlite3";
import { connection } from "next/server";

import { RANGE_DAYS, type RangeKey } from "@/lib/range";

const DB_PATH = process.env.GARMIN_DB_PATH ?? path.resolve(process.cwd(), "..", "garmin.db");

let db: Database.Database | undefined;

function getDb(): Database.Database {
  db ??= new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

/** One row of daily_metrics (see garmin_health/schema.sql). Every metric is nullable. */
export interface DailyRow {
  date: string; // 'YYYY-MM-DD'
  resting_hr: number | null;
  max_hr: number | null;
  min_hr: number | null;
  hrv_last_night_ms: number | null;
  hrv_status: string | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  sleep_score: number | null;
  sleep_total_seconds: number | null;
  sleep_deep_seconds: number | null;
  sleep_rem_seconds: number | null;
  sleep_light_seconds: number | null;
  sleep_awake_seconds: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
  bb_high: number | null;
  bb_low: number | null;
  bb_charged: number | null;
  bb_drained: number | null;
  stress_avg: number | null;
  stress_max: number | null;
  vo2max_running: number | null;
  vo2max_cycling: number | null;
  training_readiness_score: number | null;
  training_readiness_level: string | null;
  training_status: string | null;
  acute_load: number | null;
  chronic_load: number | null;
  steps: number | null;
  floors: number | null;
  distance_m: number | null;
  calories: number | null;
  active_calories: number | null;
  spo2_avg: number | null;
  respiration_avg: number | null;
  weight_g: number | null;
  body_fat_pct: number | null;
  raw_json: string | null;
  synced_at: string;
}

/** One row of activities. */
export interface ActivityRow {
  activity_id: number;
  date: string | null;
  start_time_local: string | null;
  start_time_gmt: string | null;
  activity_type: string | null;
  name: string | null;
  distance_m: number | null;
  duration_s: number | null;
  moving_duration_s: number | null;
  avg_pace_s_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  calories: number | null;
  training_load: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
  vo2max: number | null;
  raw_json: string | null;
  synced_at: string;
}

/** All daily_metrics, oldest → newest. */
export async function loadDaily(): Promise<DailyRow[]> {
  await connection();
  return getDb().prepare("SELECT * FROM daily_metrics ORDER BY date").all() as DailyRow[];
}

/** All activities, oldest → newest. */
export async function loadActivities(): Promise<ActivityRow[]> {
  await connection();
  return getDb()
    .prepare("SELECT * FROM activities ORDER BY start_time_local")
    .all() as ActivityRow[];
}

/** Most recent sync timestamp, or null if nothing has synced yet. */
export async function lastSynced(): Promise<Date | null> {
  await connection();
  const row = getDb().prepare("SELECT MAX(synced_at) AS ts FROM daily_metrics").get() as
    | { ts: string | null }
    | undefined;
  return row?.ts ? new Date(row.ts) : null;
}

/** The daily rows and activities inside the selected range (mirrors views._slice_*). */
export async function loadWindow(range: RangeKey) {
  const [daily, activities] = await Promise.all([loadDaily(), loadActivities()]);
  const days = RANGE_DAYS[range];
  const dailyWin = days ? daily.slice(-days) : daily;
  if (!dailyWin.length) return { daily: dailyWin, activities: [] as ActivityRow[] };
  const start = dailyWin[0].date;
  const end = dailyWin[dailyWin.length - 1].date;
  return {
    daily: dailyWin,
    activities: activities.filter((a) => a.date != null && a.date >= start && a.date <= end),
  };
}
