/**
 * The plan generator's rules, checked across every goal, number of training
 * days and body state, plus the pace model against Daniels' published tables.
 */

import { describe, expect, it } from "vitest";

import { generatePlan, GOAL_SPECS, PlanError } from "./generate";
import { formatDuration, paces, raceTime, vdotFromRace } from "./paces";
import { addDays } from "./profile";
import { GOALS, type BodyState, type Goal, type PlanInput, type Profile, type Session } from "./types";

const TODAY = "2026-10-29"; // a Thursday: plans start mid-week by default

function profile(over: Partial<Profile> = {}, state: Partial<BodyState> = {}): Profile {
  return {
    asOf: TODAY, weeklyMinutes4: 180, weeklyMinutes12: 170, sessionsPerWeek4: 4, runKmPerWeek4: 20,
    runKmPerWeek12: 18, longestRunKm8: 10, mix: { Running: 0.5, HIIT: 0.4, Strength: 0.1, Other: 0 },
    vo2max: 50, vo2maxTrend: 0, restingHr: 50, maxHr: 190, paces: paces(50),
    state: {
      level: "normal", reasons: ["no warning signs"], day: TODAY, readinessScore: 70, readinessLevel: "MODERATE",
      acwr: 1, rhrCreepBpm: 0, hrvBelowBaseline: false, sleepScore7: 80, sleepHours7: 7.5, staleDays: 0, ...state,
    },
    ...over,
  };
}

const plan = (input: Partial<PlanInput> & { goal: Goal }, p = profile()) =>
  generatePlan({ name: "Test event", daysPerWeek: 5, eventDate: "2027-03-14", ...input }, p, TODAY);

/** Sessions grouped by plan week. */
function byWeek(sessions: Session[]) {
  const weeks = new Map<number, Session[]>();
  for (const s of sessions) weeks.set(s.week, [...(weeks.get(s.week) ?? []), s]);
  return [...weeks.values()];
}
const minutes = (ss: Session[]) => ss.filter((s) => s.discipline !== "race").reduce((m, s) => m + s.durationMin, 0);
const runKm = (ss: Session[]) => ss.filter((s) => s.discipline === "run").reduce((k, s) => k + (s.distanceKm ?? 0), 0);

const CASES = GOALS.flatMap((goal) => [3, 4, 5, 6, 7].map((days) => ({ goal, days })));

describe.each(CASES)("$goal, $days days a week", ({ goal, days }) => {
  const p = plan({ goal, daysPerWeek: days });

  it("stays inside the plan's dates and ends on race day", () => {
    expect(p.startDate).toBe("2026-10-30");
    for (const s of p.sessions) expect(s.date >= p.startDate && s.date <= p.endDate).toBe(true);
    const races = p.sessions.filter((s) => s.discipline === "race");
    expect(races.map((s) => s.date)).toEqual(["2027-03-14"]);
    expect(p.sessions.at(-1)!.discipline).toBe("race");
  });

  it("never puts hard days back to back", () => {
    const hard = new Set(p.sessions.filter((s) => s.intensity === "hard").map((s) => s.date));
    for (const d of hard) expect(hard.has(addDays(d, 1)), `${d} and the next day are both hard`).toBe(false);
  });

  it("trains on the chosen number of days in every full week", () => {
    for (const w of byWeek(p.sessions).slice(1, -1)) expect(new Set(w.map((s) => s.date)).size).toBe(days);
  });

  it("keeps weekday sessions within the time limit", () => {
    for (const s of p.sessions) {
      if (s.role === "long" || s.discipline === "race" || s.kind === "simulation") continue;
      expect(s.durationMin, `${s.date} ${s.title}`).toBeLessThanOrEqual(75);
    }
  });

  it("builds gradually, eases every 4th week and tapers", () => {
    const weeks = byWeek(p.sessions).slice(1, -1); // full weeks only
    const volume = (w: Session[]) => (GOAL_SPECS[goal].peakKm ? runKm(w) : minutes(w));
    const rounding = GOAL_SPECS[goal].peakKm ? 3 : 25; // half km / 5 min per session
    for (let i = 2; i < weeks.length; i++) {
      const [before, prev, cur] = [weeks[i - 2], weeks[i - 1], weeks[i]];
      const special = [...before, ...prev, ...cur].some((s) => s.kind === "simulation" || s.discipline === "race");
      if (cur[0].phase === "taper" || prev[0].phase !== cur[0].phase || special) continue;
      // ≤ 10% on the last normal week (the week after a deload returns to where it was)
      const ref = Math.max(volume(prev), volume(before));
      expect(volume(cur), `week ${cur[0].week}`).toBeLessThanOrEqual(ref * 1.1 + rounding);
    }
    const peak = Math.max(...weeks.filter((w) => w[0].phase !== "taper").map(volume));
    for (const w of weeks.filter((w) => w[0].phase === "taper")) expect(volume(w)).toBeLessThan(peak);
  });
});

describe("personalisation", () => {
  it("starts lighter when the body needs to recover", () => {
    const normal = plan({ goal: "10k" });
    const tired = plan({ goal: "10k" }, profile({}, { level: "recover", reasons: ["Garmin readiness is Low"] }));
    const firstWeek = (ss: Session[]) => runKm(ss.filter((s) => s.date < "2026-11-09"));
    expect(firstWeek(tired.sessions)).toBeLessThan(firstWeek(normal.sessions));
    expect(tired.notes.join(" ")).toMatch(/recover.*Garmin readiness is Low.*25% lighter/);
  });

  it("starts from the athlete's own volume", () => {
    const light = plan({ goal: "half_marathon" }, profile({ runKmPerWeek4: 12, runKmPerWeek12: 12 }));
    const heavy = plan({ goal: "half_marathon" }, profile({ runKmPerWeek4: 45, runKmPerWeek12: 42, longestRunKm8: 18 }));
    const week2 = (ss: Session[]) => runKm(ss.filter((s) => s.week === 2));
    expect(week2(heavy.sessions)).toBeGreaterThan(week2(light.sessions) * 1.5);
    expect(light.notes.join(" ")).toMatch(/need about \d+ km to start, more than the 12 km/);
  });

  it("uses VO₂max paces, or effort when there's none", () => {
    const withPaces = plan({ goal: "10k" });
    // hills and shakeouts go by effort
    const runs = withPaces.sessions.filter((s) => s.discipline === "run" && !["shakeout", "hills"].includes(s.kind));
    for (const s of runs) expect(s.description, s.title).toMatch(/\/km/);
    const noVo2 = plan({ goal: "10k" }, profile({ vo2max: null, paces: null }));
    expect(noVo2.sessions.some((s) => /RPE/.test(s.description))).toBe(true);
    expect(noVo2.notes.join(" ")).toMatch(/no running VO₂max/);
  });

  it("judges a target time against the VO₂max prediction", () => {
    expect(plan({ goal: "10k", targetTime: "50:00" }).notes.join(" ")).toMatch(/well within reach/);
    expect(plan({ goal: "10k", targetTime: "36:00" }).notes.join(" ")).toMatch(/very ambitious/);
  });

  it("keeps a HIIT habit as cross-training on a 6-day running plan", () => {
    const p = plan({ goal: "half_marathon", daysPerWeek: 6 }, profile({ mix: { Running: 0.4, HIIT: 0.55, Strength: 0.05, Other: 0 } }));
    expect(p.sessions.some((s) => s.kind === "cross_training")).toBe(true);
  });
});

describe("events", () => {
  it("adds a tune-up with a shakeout before and an easy day after", () => {
    const p = plan({ goal: "half_marathon", otherEvents: [{ name: "Park 10K", date: "2027-02-14", goal: "10k" }] });
    const at = (d: string) => p.sessions.filter((s) => s.date === d);
    expect(at("2027-02-14")).toMatchObject([{ discipline: "race", title: "Park 10K (tune-up)", distanceKm: 10 }]);
    expect(at("2027-02-13").every((s) => s.kind === "shakeout")).toBe(true);
    expect(at("2027-02-15").every((s) => s.intensity === "easy")).toBe(true);
  });

  it("notes an event outside the plan instead of adding it", () => {
    const p = plan({ goal: "10k", otherEvents: [{ name: "Summer 5K", date: "2027-06-01" }] });
    expect(p.sessions.some((s) => s.title.includes("Summer 5K"))).toBe(false);
    expect(p.notes.join(" ")).toMatch(/Summer 5K .* outside the plan/);
  });

  it("puts the HYROX full simulation 2–3 weeks out", () => {
    const p = plan({ goal: "hyrox", daysPerWeek: 4 });
    const sim = p.sessions.find((s) => s.title === "Full HYROX simulation")!;
    const daysOut = (Date.parse("2027-03-14") - Date.parse(sim.date)) / 86_400_000;
    expect(daysOut).toBeGreaterThanOrEqual(12);
    expect(daysOut).toBeLessThanOrEqual(24);
    // short weeks still get station work
    expect(p.sessions.filter((s) => s.kind === "strength_stations").length).toBeGreaterThan(5);
  });

  it("runs a fixed number of weeks without an event", () => {
    const p = generatePlan({ goal: "general_fitness", name: "Base", daysPerWeek: 4, weeks: 8 }, profile(), TODAY);
    expect(p.endDate).toBe(addDays("2026-10-30", 55));
    expect(p.sessions.some((s) => s.discipline === "race")).toBe(false);
    expect(p.phases.map((ph) => ph.phase)).toEqual(["base", "build"]);
  });
});

describe("validation", () => {
  it.each([
    [{ daysPerWeek: 2 }, /3 to 7/],
    [{ eventDate: "2026-10-01" }, /after the plan starts/],
    [{ eventDate: "14/03/2027" }, /YYYY-MM-DD/],
    [{ targetTime: "fast" }, /1:45:00/],
    [{ eventDate: "2028-03-01" }, /at most 40/],
  ])("refuses %j", (bad, msg) => {
    expect(() => plan({ goal: "10k", ...bad })).toThrow(PlanError);
    expect(() => plan({ goal: "10k", ...bad })).toThrow(msg);
  });
});

describe("paces", () => {
  // Daniels' Running Formula, VDOT 50: 5K 19:57, 10K 41:21, half 1:31:35, marathon 3:10:49;
  // threshold 4:15/km, interval 3:55/km
  it("matches Daniels' tables to within a few seconds", () => {
    const close = (secs: number, table: string) => {
      const [h, m, s] = table.split(":").map(Number);
      const want = s == null ? h * 60 + m : h * 3600 + m * 60 + s;
      expect(Math.abs(secs - want), `${formatDuration(secs)} vs ${table}`).toBeLessThanOrEqual(15);
    };
    close(raceTime(50, 5000), "19:57");
    close(raceTime(50, 10000), "41:21");
    close(raceTime(50, 21097.5), "1:31:35");
    close(raceTime(50, 42195), "3:10:49");
    close(paces(50).threshold, "4:15");
    close(paces(50).interval, "3:55");
    expect(vdotFromRace(5000, 19 * 60 + 57)).toBeCloseTo(50, 0);
  });
});
