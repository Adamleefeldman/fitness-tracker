/**
 * Parity: the TypeScript analytics + verdicts must reproduce the pandas
 * originals on the real garmin.db, across windows sliding over the whole history.
 *
 * Runs on a temporary copy with blank days appended, so the "watch hasn't
 * uploaded yet" case is always covered whatever the last sync stored.
 *
 * Needs ../garmin.db and `uv` (it runs web/scripts/analytics_parity.py).
 * Skipped when the database isn't there.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import * as A from "./analytics";
import * as V from "./verdicts";
import type { ActivityRow, DailyRow } from "./types";

const ROOT = path.resolve(__dirname, "../../..");
const DB_PATH = process.env.GARMIN_DB_PATH ?? path.join(ROOT, "garmin.db");
const BLANK_DAYS = 3;

/** Copy of the live DB with BLANK_DAYS empty rows after its last date. */
function withBlankTail(src: string): string {
  const copy = path.join(mkdtempSync(path.join(os.tmpdir(), "parity-")), "garmin.db");
  const live = new Database(src, { readonly: true });
  live.exec(`VACUUM INTO '${copy}'`);
  live.close();
  const db = new Database(copy);
  const { last } = db.prepare("SELECT MAX(date) AS last FROM daily_metrics").get() as { last: string };
  const insert = db.prepare("INSERT INTO daily_metrics (date, synced_at) VALUES (?, ?)");
  for (let i = 1; i <= BLANK_DAYS; i++) {
    const day = new Date(`${last}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + i);
    insert.run(day.toISOString().slice(0, 10), new Date().toISOString());
  }
  db.close();
  return copy;
}

/** Deep-equal with a relative float tolerance; returns the first mismatch path, or null. */
function diff(py: unknown, ts: unknown, at = "$"): string | null {
  if (typeof py === "number" && typeof ts === "number") {
    return Math.abs(py - ts) <= 1e-9 * Math.max(1, Math.abs(py), Math.abs(ts))
      ? null
      : `${at}: py=${py} ts=${ts}`;
  }
  if (Array.isArray(py) && Array.isArray(ts)) {
    if (py.length !== ts.length) return `${at}: length py=${py.length} ts=${ts.length}`;
    for (let i = 0; i < py.length; i++) {
      const d = diff(py[i], ts[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (py && ts && typeof py === "object" && typeof ts === "object") {
    const pk = Object.keys(py);
    const tk = Object.keys(ts);
    if (pk.join() !== tk.join()) return `${at}: keys py=[${pk}] ts=[${tk}]`;
    for (const k of pk) {
      const d = diff((py as Record<string, unknown>)[k], (ts as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return py === ts ? null : `${at}: py=${JSON.stringify(py)} ts=${JSON.stringify(ts)}`;
}

interface Case {
  start: number;
  end: number;
  days: number | null;
  [key: string]: unknown;
}

describe.skipIf(!existsSync(DB_PATH))("analytics parity with pandas", () => {
  const dbPath = withBlankTail(DB_PATH);
  const { cases } = JSON.parse(
    execFileSync("uv", ["run", "python", "web/scripts/analytics_parity.py"], {
      cwd: ROOT,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GARMIN_DB_PATH: dbPath },
    }).toString(),
  ) as { cases: Case[] };

  const db = new Database(dbPath, { readonly: true });
  const daily = A.withDailyDerived(
    db.prepare("SELECT * FROM daily_metrics ORDER BY date").all() as DailyRow[],
  );
  const acts = A.withActivityDerived(
    db.prepare("SELECT * FROM activities ORDER BY start_time_local").all() as ActivityRow[],
  );
  db.close();

  function compute(c: Case) {
    const d = daily.slice(c.start, c.end + 1);
    const a = acts.filter((x) => x.date != null && x.date >= d[0].date && x.date <= d.at(-1)!.date);
    const hbt = A.weeklyHoursByType(a);
    const out: Record<string, unknown> = {
      start: c.start,
      end: c.end,
      days: c.days,
      verdicts: { today: V.today(d), load: V.load(d), fitness: V.fitness(d, a), sleep: V.sleep(d) },
      drivers: A.readinessDrivers(d),
      latest: A.latest(d, ["resting_hr", "hrv_last_night_ms", "sleep_score", "vo2max_running",
        "training_readiness_score", "training_readiness_level", "steps"]),
      weekly_distance: A.weeklyDistance(a),
      weekly_hours_by_type: { types: hbt.types, weeks: hbt.weeks, ...hbt.hours },
      weekly_intensity: A.weeklyIntensity(a),
    };
    if ("series" in c) {
      const runs = a.filter((x) => x.activity_type === "running");
      out.series = {
        acwr: A.acwr(d),
        rolling_rhr_7: A.rolling(d.map((r) => r.resting_hr), 7),
        rolling_rhr_28: A.rolling(d.map((r) => r.resting_hr), 28),
        rolling_steps_7: A.rolling(d.map((r) => r.steps), 7),
        rolling_pace_5: A.rolling(runs.map((r) => r.pace_min_per_km), 5),
        sleep_hours: d.map((r) => r.sleep_hours),
        sleep_times: A.sleepTimes(d),
      };
    }
    return out;
  }

  it(`matches across ${cases.length} windows`, () => {
    const failures = cases
      .map((c) => {
        const d = diff(c, compute(c));
        return d && `window ${c.days ?? "all"}d ending row ${c.end}: ${d}`;
      })
      .filter(Boolean);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it("covers every verdict outcome the data produces", () => {
    // not an assertion of parity — a guard that the sweep isn't trivially narrow
    const words = new Set(cases.flatMap((c) =>
      Object.values(c.verdicts as Record<string, V.Verdict>).map((v) => v.word)));
    expect(words.size).toBeGreaterThan(6);
  });
});
