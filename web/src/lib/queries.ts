/**
 * Read-only queries over garmin.db, shared by the Next.js app (via db.ts) and
 * the MCP server. Each takes an open connection; the Python sync is the only
 * writer.
 */

import Database from "better-sqlite3";

import { CORE_COLUMNS, withActivityDerived, withDailyDerived } from "./analytics.ts";
import type { Activity, ActivityRow, Daily, DailyRow } from "./types.ts";

export function openReadOnly(file: string): Database.Database {
  return new Database(file, { readonly: true, fileMustExist: true });
}

/**
 * Every daily_metrics column, except that raw_json (~16 KB a day of Garmin
 * payloads) is cut down to the `readiness` part readinessDrivers reads.
 */
function dailyColumns(db: Database.Database): string {
  const cols = (db.pragma("table_info(daily_metrics)") as { name: string }[]).map((c) => c.name);
  return cols
    .map((c) =>
      c === "raw_json"
        ? "CASE WHEN json_valid(raw_json) THEN json_object('readiness', raw_json -> '$.readiness') END AS raw_json"
        : c,
    )
    .join(", ");
}

/** All daily_metrics, oldest → newest. */
export function dailyRows(db: Database.Database): Daily[] {
  const rows = db.prepare(`SELECT ${dailyColumns(db)} FROM daily_metrics ORDER BY date`).all() as DailyRow[];
  return withDailyDerived(rows);
}

/** All activities, oldest → newest. */
export function activityRows(db: Database.Database): Activity[] {
  const rows = db.prepare("SELECT * FROM activities ORDER BY start_time_local").all() as ActivityRow[];
  return withActivityDerived(rows);
}

/** Most recent sync timestamp, or null if nothing has synced yet. */
export function lastSynced(db: Database.Database): Date | null {
  const row = db.prepare("SELECT MAX(synced_at) AS ts FROM daily_metrics").get() as
    | { ts: string | null }
    | undefined;
  return row?.ts ? new Date(row.ts) : null;
}

/** Newest 'YYYY-MM-DD' with any data (blank days the watch hasn't uploaded don't count). */
export function lastDataDate(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT MAX(date) AS d FROM daily_metrics WHERE COALESCE(${CORE_COLUMNS.join(", ")}) IS NOT NULL`)
    .get() as { d: string | null } | undefined;
  return row?.d ?? null;
}
