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

import { sliceWindow, withActivityDerived, withDailyDerived } from "@/lib/analytics";
import { RANGE_DAYS, type RangeKey } from "@/lib/range";
import type { Activity, ActivityRow, Daily, DailyRow } from "@/lib/types";

const DB_PATH = process.env.GARMIN_DB_PATH ?? path.resolve(process.cwd(), "..", "garmin.db");

let db: Database.Database | undefined;

function getDb(): Database.Database {
  db ??= new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

/** All daily_metrics, oldest → newest. */
export async function loadDaily(): Promise<Daily[]> {
  await connection();
  const rows = getDb().prepare("SELECT * FROM daily_metrics ORDER BY date").all() as DailyRow[];
  return withDailyDerived(rows);
}

/** All activities, oldest → newest. */
export async function loadActivities(): Promise<Activity[]> {
  await connection();
  const rows = getDb()
    .prepare("SELECT * FROM activities ORDER BY start_time_local")
    .all() as ActivityRow[];
  return withActivityDerived(rows);
}

/** Most recent sync timestamp, or null if nothing has synced yet. */
export async function lastSynced(): Promise<Date | null> {
  await connection();
  const row = getDb().prepare("SELECT MAX(synced_at) AS ts FROM daily_metrics").get() as
    | { ts: string | null }
    | undefined;
  return row?.ts ? new Date(row.ts) : null;
}

/** The daily rows and activities inside the selected range. */
export async function loadWindow(range: RangeKey) {
  const [daily, activities] = await Promise.all([loadDaily(), loadActivities()]);
  return sliceWindow(daily, activities, RANGE_DAYS[range]);
}
