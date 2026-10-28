/**
 * Golden test: the TypeScript analytics + verdicts must reproduce the output
 * of the pandas originals they were ported from, frozen in
 * __fixtures__/analytics-golden.json, on the synthetic database from
 * fixture.ts. The windows slide across the whole history, so every verdict
 * rule is exercised, including a mid-history gap and a blank tail.
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import * as A from "./analytics";
import * as V from "./verdicts";
import { writeFixtureDb } from "./fixture";
import golden from "./__fixtures__/analytics-golden.json";
import type { ActivityRow, DailyRow } from "./types";

/** Deep-equal with a relative float tolerance; returns the first mismatch path, or null. */
function diff(want: unknown, got: unknown, at = "$"): string | null {
  if (typeof want === "number" && typeof got === "number") {
    return Math.abs(want - got) <= 1e-9 * Math.max(1, Math.abs(want), Math.abs(got))
      ? null
      : `${at}: want=${want} got=${got}`;
  }
  if (Array.isArray(want) && Array.isArray(got)) {
    if (want.length !== got.length) return `${at}: length want=${want.length} got=${got.length}`;
    for (let i = 0; i < want.length; i++) {
      const d = diff(want[i], got[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (want && got && typeof want === "object" && typeof got === "object") {
    const wk = Object.keys(want);
    const gk = Object.keys(got);
    if (wk.join() !== gk.join()) return `${at}: keys want=[${wk}] got=[${gk}]`;
    for (const k of wk) {
      const d = diff((want as Record<string, unknown>)[k], (got as Record<string, unknown>)[k], `${at}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return want === got ? null : `${at}: want=${JSON.stringify(want)} got=${JSON.stringify(got)}`;
}

interface Case {
  start: number;
  end: number;
  days: number | null;
  [key: string]: unknown;
}

describe("analytics match the frozen pandas output", () => {
  const cases = golden.cases as Case[];
  const dbPath = path.join(mkdtempSync(path.join(os.tmpdir(), "golden-")), "garmin.db");
  writeFixtureDb(dbPath);

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
    const out: Record<string, unknown> = {
      start: c.start,
      end: c.end,
      days: c.days,
      verdicts: { today: V.today(d), load: V.load(d), fitness: V.fitness(d, a), sleep: V.sleep(d) },
      drivers: A.readinessDrivers(d),
      latest: A.latest(d, ["resting_hr", "hrv_last_night_ms", "sleep_score", "vo2max_running",
        "training_readiness_score", "training_readiness_level", "steps"]),
      weekly_distance: A.weeklyDistance(a),
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
