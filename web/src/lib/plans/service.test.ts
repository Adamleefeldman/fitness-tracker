/** Plans stored in plans.db: create, view against the Garmin data, adapt, edit. Synthetic data only. */

import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeFixtureDb } from "../fixture";
import * as Q from "../queries";
import * as Sv from "./service";
import * as St from "./store";

const dir = mkdtempSync(path.join(os.tmpdir(), "plans-"));
const garminFile = path.join(dir, "garmin.db");
writeFixtureDb(garminFile);
const g = Q.openReadOnly(garminFile);
const garmin = { daily: Q.dailyRows(g), activities: Q.activityRows(g) };
// the fixture's data runs to 2026-07-23
const NOW = new Date("2026-07-20T08:00:00");

const fresh = () => St.openPlans(path.join(mkdtempSync(path.join(dir, "p-")), "plans.db"), { create: true })!;

describe("store", () => {
  it("doesn't create plans.db just to read it", () => {
    const file = path.join(dir, "missing.db");
    expect(St.openPlans(file, { create: false })).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(Sv.planView(null, garmin, NOW)).toBeNull();
  });

  it("keeps one active plan, archiving the previous one", () => {
    const db = fresh();
    const a = Sv.createPlan(db, garmin, { goal: "10k", name: "Autumn 10K", eventDate: "2026-10-04", daysPerWeek: 4 }, NOW);
    const b = Sv.createPlan(db, garmin, { goal: "hyrox", name: "Winter HYROX", eventDate: "2026-12-06", daysPerWeek: 5 }, NOW);
    expect(St.activePlan(db)!.id).toBe(b.id);
    expect(St.listPlans(db).map((p) => [p.name, p.status])).toEqual([["Winter HYROX", "active"], ["Autumn 10K", "archived"]]);
    expect(St.planSessions(db, a.id).length).toBe(a.plan.sessions.length);
  });

  it("stores the profile and the reasons with the plan", () => {
    const db = fresh();
    Sv.createPlan(db, garmin, { goal: "half_marathon", name: "Half", eventDate: "2026-11-01", daysPerWeek: 5 }, NOW);
    const p = St.activePlan(db)!;
    expect(p.profile.asOf).toBe("2026-07-23");
    expect(p.notes[0]).toMatch(/^Built from your last 4 weeks/);
    expect(p.phases.at(-1)).toMatchObject({ phase: "taper", end: "2026-11-01" });
  });

  it("stores each session's workout details", () => {
    const db = fresh();
    const { id, plan } = Sv.createPlan(db, garmin, { goal: "hyrox", name: "HYROX", eventDate: "2026-11-01", daysPerWeek: 4 }, NOW);
    expect(St.planSessions(db, id).map((s) => s.blocks)).toEqual(plan.sessions.map((s) => s.blocks));
  });

  it("adds details to plans saved before sessions had them", () => {
    const file = path.join(mkdtempSync(path.join(dir, "old-")), "plans.db");
    const db = St.openPlans(file, { create: true })!;
    const { id } = Sv.createPlan(db, garmin, { goal: "marathon", name: "M", eventDate: "2026-12-06", daysPerWeek: 5 }, NOW);
    const ss = St.planSessions(db, id);
    Sv.editSessions(db, [{ op: "update", id: ss[0].id, title: "Changed by hand", description: "My own run" }], NOW);
    // what a plans.db from before looked like: no column, originals without details
    db.exec("ALTER TABLE plan_sessions DROP COLUMN blocks_json");
    for (const s of ss) {
      db.prepare("UPDATE plan_sessions SET original_json = ? WHERE id = ?").run(JSON.stringify({ ...s.original, blocks: undefined }), s.id);
    }
    db.close();
    const again = St.openPlans(file, { create: false })!;
    const after = St.planSessions(again, id);
    expect(after[0].blocks).toBeUndefined(); // changed by hand
    expect(after[0].original.blocks).toEqual(ss[0].blocks);
    expect(after.slice(1).map((s) => s.blocks)).toEqual(ss.slice(1).map((s) => s.blocks));
  });

  it("refreshes the details of plans saved by an older generator, keeping adapted ones", () => {
    const file = path.join(mkdtempSync(path.join(dir, "v1-")), "plans.db");
    const db = St.openPlans(file, { create: true })!;
    const { id } = Sv.createPlan(db, garmin, { goal: "marathon", name: "M", eventDate: "2026-12-06", daysPerWeek: 5 }, NOW);
    const ss = St.planSessions(db, id);
    const [plain, adapted] = ss.filter((s) => s.discipline === "run");
    // a version-1 plans.db: details without paces, and one session adapted since
    const old = [{ title: "Run", steps: [{ name: "Easy running", reps: "20 min", target: "easy (RPE 3–4)" }] }];
    const set = db.prepare("UPDATE plan_sessions SET original_json = ?, blocks_json = ?, title = ? WHERE id = ?");
    set.run(JSON.stringify({ ...plain.original, blocks: old }), JSON.stringify(old), plain.title, plain.id);
    set.run(JSON.stringify({ ...adapted.original, blocks: old }), JSON.stringify(old), "Easy run (eased)", adapted.id);
    db.pragma("user_version = 1");
    db.close();

    const again = St.openPlans(file, { create: false })!;
    const after = new Map(St.planSessions(again, id).map((s) => [s.id, s]));
    expect(after.get(plain.id)!.blocks).toEqual(plain.blocks);
    expect(after.get(adapted.id)!.blocks).toEqual(old); // adaptation re-derives it from the refreshed original
    expect(after.get(adapted.id)!.original.blocks).toEqual(adapted.blocks);
    expect(again.pragma("user_version", { simple: true })).toBe(St.BLOCKS_VERSION);
  });
});

describe("planView", () => {
  it("tracks the plan against the Garmin data", () => {
    const db = fresh();
    // started in the past, so some sessions are already due
    Sv.createPlan(db, garmin, { goal: "general_fitness", name: "Summer", startDate: "2026-06-29", weeks: 8, daysPerWeek: 4 }, NOW);
    const v = Sv.planView(db, garmin, NOW)!;
    expect(v.today).toBe("2026-07-20");
    expect(v.compliance14.due).toBeGreaterThan(0);
    expect(v.sessions.filter((s) => s.date < v.today).every((s) => ["done", "missed", "skipped"].includes(s.outcome))).toBe(true);
    expect(v.weeks[0]).toMatchObject({ week: 1, start: "2026-06-29" });
    expect(v.weeks.reduce((m, w) => m + w.doneMin, 0)).toBeGreaterThan(0);
    expect(["On track", "Behind", "Adjust"]).toContain(v.verdict.word);
  });

  it("says when the plan hasn't started or is over", () => {
    const db = fresh();
    Sv.createPlan(db, garmin, { goal: "5k", name: "Fall 5K", eventDate: "2026-09-27", daysPerWeek: 3 }, NOW);
    expect(Sv.planView(db, garmin, new Date("2026-07-20T08:00:00"))!.verdict.word).toBe("Starts soon");
    expect(Sv.planView(db, garmin, new Date("2026-10-01T08:00:00"))!.verdict.word).toBe("Complete");
  });
});

describe("editSessions", () => {
  const setup = () => {
    const db = fresh();
    Sv.createPlan(db, garmin, { goal: "10k", name: "10K", eventDate: "2026-10-04", daysPerWeek: 4 }, NOW);
    const ss = St.planSessions(db, St.activePlan(db)!.id);
    return { db, ss };
  };

  it("updates, moves, adds, removes and marks sessions, and logs it", () => {
    const { db, ss } = setup();
    const [a, b, c] = ss;
    const done = Sv.editSessions(db, [
      { op: "update", id: a.id, title: "Hill sprints", durationMin: 30, note: "asked for hills" },
      { op: "update", id: b.id, date: "2026-08-01" },
      { op: "add", date: "2026-07-26", title: "Yoga", description: "60 min flow", discipline: "mobility", intensity: "easy", durationMin: 60 },
      { op: "remove", id: c.id },
      { op: "status", id: ss[3].id, status: "skipped" },
    ], NOW);
    expect(done).toHaveLength(5);
    const after = St.planSessions(db, St.activePlan(db)!.id);
    expect(after.find((s) => s.id === a.id)).toMatchObject({ title: "Hill sprints", durationMin: 30, source: "edit", note: "asked for hills" });
    expect(after.find((s) => s.id === a.id)!.original.title).toBe(a.title);
    expect(after.find((s) => s.id === b.id)!.date).toBe("2026-08-01");
    expect(after.some((s) => s.title === "Yoga")).toBe(true);
    expect(after.some((s) => s.id === c.id)).toBe(false);
    expect(St.recentChanges(db, St.activePlan(db)!.id)[0].source).toBe("edit");
  });

  it("refuses dates outside the plan and sessions from another plan, changing nothing", () => {
    const { db, ss } = setup();
    expect(() => Sv.editSessions(db, [{ op: "update", id: ss[0].id, date: "2027-01-01" }], NOW)).toThrow(/outside the plan/);
    expect(() => Sv.editSessions(db, [
      { op: "update", id: ss[0].id, title: "Changed" },
      { op: "remove", id: 99_999 },
    ], NOW)).toThrow(/isn't in the active plan/);
    expect(St.planSessions(db, St.activePlan(db)!.id)[0].title).toBe(ss[0].title);
  });

  it("keeps a moved session's details, and drops them when it's rewritten", () => {
    const { db, ss } = setup();
    const [a, b] = ss;
    Sv.editSessions(db, [
      { op: "update", id: a.id, date: "2026-07-25" },
      { op: "update", id: b.id, description: "Whatever feels good" },
    ], NOW);
    const after = St.planSessions(db, St.activePlan(db)!.id);
    expect(after.find((s) => s.id === a.id)!.blocks).toEqual(a.blocks);
    expect(after.find((s) => s.id === b.id)!.blocks).toBeUndefined();
    expect(after.find((s) => s.id === b.id)!.original.blocks).toEqual(b.blocks);
  });
});

describe("adaptPlan", () => {
  it("previews without writing, and applying twice changes nothing more", () => {
    const db = fresh();
    Sv.createPlan(db, garmin, { goal: "10k", name: "10K", eventDate: "2026-10-04", startDate: "2026-07-20", daysPerWeek: 5 }, NOW);
    const preview = Sv.adaptPlan(db, garmin, NOW, false);
    expect(preview.applied).toBe(false);
    const applied = Sv.adaptPlan(db, garmin, NOW, true);
    expect(applied.changes).toEqual(preview.changes);
    expect(Sv.adaptPlan(db, garmin, NOW, true).changes).toEqual([]);
  });
});
