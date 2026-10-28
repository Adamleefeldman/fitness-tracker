/**
 * Read-only access to garmin.db for the app — the Python sync is the only writer.
 *
 * better-sqlite3 is synchronous, so under Cache Components a query would run at
 * build time and freeze into the static shell. Every loader awaits
 * `connection()` first so reads happen per request and always see the latest sync.
 */

import "server-only";

import path from "node:path";

import type Database from "better-sqlite3";
import { connection } from "next/server";

import { sliceWindow } from "@/lib/analytics";
import * as Q from "@/lib/queries";
import { RANGE_DAYS, type RangeKey } from "@/lib/range";
import type { Activity, Daily } from "@/lib/types";

const DB_PATH = process.env.GARMIN_DB_PATH ?? path.resolve(process.cwd(), "..", "garmin.db");

let db: Database.Database | undefined;

async function getDb(): Promise<Database.Database> {
  await connection();
  db ??= Q.openReadOnly(DB_PATH);
  return db;
}

/** All daily_metrics, oldest → newest. */
export async function loadDaily(): Promise<Daily[]> {
  return Q.dailyRows(await getDb());
}

/** All activities, oldest → newest. */
export async function loadActivities(): Promise<Activity[]> {
  return Q.activityRows(await getDb());
}

/** Most recent sync timestamp, or null if nothing has synced yet. */
export async function lastSynced(): Promise<Date | null> {
  return Q.lastSynced(await getDb());
}

/** Newest 'YYYY-MM-DD' with any data (blank days the watch hasn't uploaded don't count). */
export async function lastDataDate(): Promise<string | null> {
  return Q.lastDataDate(await getDb());
}

/** The daily rows and activities inside the selected range. */
export async function loadWindow(range: RangeKey) {
  const [daily, activities] = await Promise.all([loadDaily(), loadActivities()]);
  return sliceWindow(daily, activities, RANGE_DAYS[range]);
}
