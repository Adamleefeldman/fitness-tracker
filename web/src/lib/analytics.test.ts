import { describe, expect, it } from "vitest";

import { hasData, trimBlankTail, weeklyHoursByGroup } from "./analytics";
import type { Activity, DailyRow } from "./types";

const act = (date: string, type: string, hours: number) =>
  ({ date, activity_type: type, duration_s: hours * 3600 }) as Activity;

describe("weeklyHoursByGroup", () => {
  it("folds types into fixed groups, in a fixed order", () => {
    const wk = weeklyHoursByGroup([
      act("2026-10-05", "yoga", 1), // a Monday: week ending Sun 2026-10-11
      act("2026-10-06", "hiit", 1),
      act("2026-10-07", "treadmill_running", 0.5),
      act("2026-10-08", "running", 1),
      act("2026-10-13", "tennis_v2", 2), // next week
    ]);
    expect(wk.groups).toEqual(["Running", "HIIT", "Other"]);
    expect(wk.weeks).toEqual(["2026-10-11", "2026-10-18"]);
    expect(wk.hours).toEqual({ Running: [1.5, 0], HIIT: [1, 0], Other: [1, 2] });
  });

  it("keeps a group's position when the ranking changes", () => {
    const a = weeklyHoursByGroup([act("2026-10-05", "running", 5), act("2026-10-06", "strength_training", 1)]);
    const b = weeklyHoursByGroup([act("2026-10-05", "running", 1), act("2026-10-06", "strength_training", 5)]);
    expect(a.groups).toEqual(["Running", "Strength"]);
    expect(b.groups).toEqual(a.groups);
  });
});

describe("blank days", () => {
  const day = (date: string, steps: number | null) => ({ date, steps }) as DailyRow;

  it("a day with only a date and sync time has no data", () => {
    expect(hasData(day("2026-10-25", null))).toBe(false);
    expect(hasData(day("2026-10-24", 7831))).toBe(true);
  });

  it("trims only the blank tail", () => {
    const rows = [day("2026-10-22", 1), day("2026-10-23", null), day("2026-10-24", 2), day("2026-10-25", null)];
    expect(trimBlankTail(rows).map((r) => r.date)).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(trimBlankTail([day("2026-10-25", null)])).toEqual([]);
  });
});
