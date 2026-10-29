/**
 * Training plans for the app: plans.db next to garmin.db (or PLANS_DB_PATH),
 * opened per request. Reading never creates the file; the Plan page's
 * actions create it on the first plan.
 */

import "server-only";

import path from "node:path";

import type Database from "better-sqlite3";

import { DB_PATH, loadActivities, loadDaily } from "@/lib/db";
import { buildProfile, localToday } from "@/lib/plans/profile";
import { planView } from "@/lib/plans/service";
import { openPlans } from "@/lib/plans/store";

export const PLANS_PATH = process.env.PLANS_DB_PATH ?? path.join(path.dirname(DB_PATH), "plans.db");

/** The Garmin rows a plan is built and judged from. */
export async function loadGarmin() {
  const [daily, activities] = await Promise.all([loadDaily(), loadActivities()]);
  return { daily, activities };
}

/** The active plan against the data (null when there's none), and the athlete's profile now. */
export async function loadPlanPage() {
  const garmin = await loadGarmin();
  const now = new Date();
  const db = openPlans(PLANS_PATH, { create: false });
  try {
    return { view: planView(db, garmin, now), profile: buildProfile(garmin.daily, garmin.activities, localToday(now)) };
  } finally {
    db?.close();
  }
}

/** Run `fn` with plans.db open for writing (created if needed). */
export function withPlans<T>(fn: (db: Database.Database) => T): T {
  const db = openPlans(PLANS_PATH, { create: true })!;
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
