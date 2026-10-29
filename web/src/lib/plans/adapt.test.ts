/** Matching activities to planned sessions, and adapting the coming days to the body's state. */

import { describe, expect, it } from "vitest";

import type { Activity } from "../types";
import { adaptations, compliance, track, type PlannedSession } from "./adapt";
import type { BodyState, Session } from "./types";

const TODAY = "2026-11-04";

let nextId = 1;
function session(date: string, over: Partial<Session> = {}, stored: Partial<PlannedSession> = {}): PlannedSession {
  const s: Session = {
    date, week: 1, phase: "build", role: "q1", discipline: "run", kind: "intervals", intensity: "hard",
    title: "VO₂max intervals", description: "5× 1 km hard", durationMin: 60, distanceKm: 10, ...over,
  };
  return { ...s, id: nextId++, status: "planned", source: "plan", note: null, original: s, ...stored };
}

function activity(date: string, type: string, minutes = 45, km: number | null = null): Activity {
  return {
    activity_id: nextId++, date, activity_type: type, duration_s: minutes * 60, distance_m: km && km * 1000,
    distance_km: km, pace_min_per_km: null,
  } as unknown as Activity;
}

const state = (level: BodyState["level"], over: Partial<BodyState> = {}): BodyState => ({
  level, reasons: level === "recover" ? ["load ratio 1.62 is well above the sweet spot"] : ["no warning signs"],
  day: TODAY, readinessScore: 40, readinessLevel: "LOW", acwr: 1.62, rhrCreepBpm: 0, hrvBelowBaseline: false,
  sleepScore7: 75, sleepHours7: 7, staleDays: 0, ...over,
});

describe("track", () => {
  it("matches by discipline, same day first, then a day either side", () => {
    const run = session("2026-11-02");
    const lift = session("2026-11-03", { discipline: "strength", kind: "strength", intensity: "moderate", title: "Strength" });
    const missed = session("2026-11-01", { role: "long", kind: "long_run", intensity: "easy", title: "Long run" });
    const t = track([missed, run, lift], [
      activity("2026-11-02", "running", 50, 9),
      activity("2026-11-02", "strength_training", 40), // a day early for Strength
      activity("2026-10-30", "running", 30, 5), // too far from the long run
    ], TODAY);
    expect(t.map((s) => [s.title, s.outcome, s.activity?.date])).toEqual([
      ["Long run", "missed", undefined],
      ["VO₂max intervals", "done", "2026-11-02"],
      ["Strength", "done", "2026-11-02"],
    ]);
  });

  it("doesn't let a run count as HYROX station work", () => {
    const stations = session("2026-11-02", { discipline: "hyrox", kind: "stations", title: "Station endurance" });
    const compromised = session("2026-11-03", { discipline: "hyrox", kind: "compromised_run", title: "Compromised running" });
    const t = track([stations, compromised], [activity("2026-11-02", "running", 40, 7)], TODAY);
    expect(t.map((s) => s.outcome)).toEqual(["missed", "done"]);
  });

  it("respects what was marked by hand, and leaves today and later open", () => {
    const t = track([
      session("2026-11-01", {}, { status: "skipped" }),
      session("2026-11-02", {}, { status: "done" }),
      session(TODAY),
      session("2026-11-06"),
    ], [], TODAY);
    expect(t.map((s) => s.outcome)).toEqual(["skipped", "done", "today", "upcoming"]);
  });

  it("doesn't count mobility as missed", () => {
    const t = track([
      session("2026-11-01", { discipline: "mobility", kind: "mobility", intensity: "easy", title: "Mobility" }),
      session("2026-11-02"),
    ], [activity("2026-11-02", "running", 50, 9)], TODAY);
    expect(compliance(t, TODAY, 14)).toEqual({ done: 1, due: 1 });
  });
});

describe("adaptations", () => {
  const week = () => [
    session(TODAY), // hard, day 0
    session("2026-11-05", { role: "easy1", kind: "easy_run", intensity: "easy", title: "Easy run", durationMin: 40 }),
    session("2026-11-06", { role: "q2", kind: "tempo", intensity: "hard", title: "Tempo run" }), // day 2
    session("2026-11-08", { role: "long", kind: "long_run", intensity: "moderate", title: "Long run", durationMin: 100 }), // day 4
    session("2026-11-09", { role: "q1" }), // day 5, hard
    session("2026-11-10", { role: "q2", kind: "tempo", title: "Tempo run" }), // day 6, hard
  ];

  /** Apply changes the way the store does. */
  const apply = (ss: PlannedSession[], changes: ReturnType<typeof adaptations>) =>
    ss.map((s) => {
      const c = changes.find((x) => x.id === s.id);
      return c ? { ...s, ...c.session, source: c.source } : s;
    });

  it("eases the next three days and allows one hard session after that when recovering", () => {
    const ss = week();
    const changes = adaptations(ss, state("recover"), TODAY);
    const after = apply(ss, changes);
    expect(after.map((s) => s.intensity)).toEqual(["easy", "easy", "easy", "moderate", "hard", "moderate"]);
    expect(after[0].description).toMatch(/^Eased because load ratio 1.62/);
    expect(after[0].durationMin).toBe(35);
  });

  it("swaps today for rest when readiness is Poor", () => {
    const changes = adaptations(week(), state("recover", { readinessLevel: "POOR" }), TODAY);
    expect(changes[0]).toMatchObject({ date: TODAY, after: "Rest" });
  });

  it("lightens only the next hard session on caution", () => {
    const changes = adaptations(week(), state("caution", { reasons: ["HRV is running below baseline"] }), TODAY);
    expect(changes.map((c) => [c.date, c.after])).toEqual([[TODAY, "VO₂max intervals (lighter)"]]);
  });

  it("is idempotent, and undoes itself when the body recovers", () => {
    const ss = week();
    const adapted = apply(ss, adaptations(ss, state("recover"), TODAY));
    expect(adaptations(adapted, state("recover"), TODAY)).toEqual([]);
    const restored = adaptations(adapted, state("ready"), TODAY);
    expect(restored.length).toBeGreaterThan(0);
    expect(restored.every((c) => c.source === "plan")).toBe(true);
    expect(apply(adapted, restored).map((s) => s.intensity)).toEqual(ss.map((s) => s.intensity));
  });

  it("leaves hand-edited sessions, race week and stale data alone", () => {
    const ss = week();
    ss[0] = { ...ss[0], source: "edit" };
    ss.push(session("2026-11-07", { discipline: "race", kind: "race", title: "Park 10K" }));
    const dates = adaptations(ss, state("recover"), TODAY).map((c) => c.date);
    expect(dates).not.toContain(TODAY); // edited
    expect(dates).not.toContain("2026-11-05"); // within 2 days of the race
    expect(dates).not.toContain("2026-11-06");
    expect(adaptations(week(), state("recover", { staleDays: 4 }), TODAY)).toEqual([]);
  });
});
