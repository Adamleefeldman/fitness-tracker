/** The athlete profile and body state, on the synthetic fixture's scripted phases. */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as A from "../analytics";
import { writeFixtureDb } from "../fixture";
import * as Q from "../queries";
import { addDays, bodyState, buildProfile } from "./profile";

const file = path.join(mkdtempSync(path.join(os.tmpdir(), "profile-")), "garmin.db");
writeFixtureDb(file);
const db = Q.openReadOnly(file);
const daily = Q.dailyRows(db);
const acts = Q.activityRows(db);

/** Body state as of fixture day `i`. */
const stateAt = (i: number) => {
  const d = daily.slice(0, i + 1);
  return bodyState(d, d.at(-1)!.date);
};

describe("bodyState", () => {
  it("says recover in the overreaching block (resting HR up and HRV down together)", () => {
    const s = stateAt(75);
    expect(s.level).toBe("recover");
    expect(s.reasons).toContain("resting HR is up and HRV is below baseline together");
  });

  it("says recover in the poor-sleep block", () => {
    const s = stateAt(155);
    expect(s.level).toBe("recover");
    expect(s.reasons.join(" ")).toMatch(/sleep score is averaging 5\d/);
  });

  it("says ready when readiness is high and nothing argues against it", () => {
    expect(stateAt(50)).toMatchObject({ level: "ready", reasons: ["Garmin readiness is High with no warning signs"] });
  });

  it("flags data the watch hasn't uploaded yet", () => {
    const d = daily.slice(0, 51);
    const s = bodyState(d, addDays(d.at(-1)!.date, 5));
    expect(s.staleDays).toBe(5);
    expect(s.reasons.at(-1)).toMatch(/no watch data for 5 days/);
  });
});

describe("buildProfile", () => {
  it("measures the last 4 weeks from the newest day with data", () => {
    // the fixture ends in three blank days, and today is a week later still
    const p = buildProfile(daily, acts, "2026-08-02");
    expect(p.asOf).toBe("2026-07-23");
    const last4 = acts.filter((a) => a.date! >= addDays("2026-07-23", -27) && a.date! <= "2026-07-23");
    expect(p.weeklyMinutes4).toBe(Math.round(last4.reduce((m, a) => m + (a.duration_s ?? 0) / 60, 0) / 4));
    expect(p.sessionsPerWeek4).toBe(Math.round((last4.length / 4) * 10) / 10);
    expect(Object.values(p.mix).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 1);
    expect(p.vo2max).toBe(A.lastValue(A.trimBlankTail(daily), "vo2max_running"));
    expect(p.paces?.threshold).toBeGreaterThan(p.paces!.interval);
  });
});
