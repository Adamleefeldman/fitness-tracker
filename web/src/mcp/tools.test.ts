/**
 * explain_verdict's checks must agree with the verdict they explain, in every
 * situation the synthetic history produces (windows sliding across all of it,
 * as in the golden test), not just at its end.
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeFixtureDb } from "../lib/fixture";
import * as Q from "../lib/queries";
import { explainWindow, judge, type Question } from "./tools";

const file = path.join(mkdtempSync(path.join(os.tmpdir(), "explain-")), "garmin.db");
writeFixtureDb(file);
const db = Q.openReadOnly(file);
const daily = Q.dailyRows(db);
const acts = Q.activityRows(db);
db.close();

const windows = daily.flatMap((_, end) => (end < 6 || end % 3 ? [] : [30, 90, 365, null].map((days) => {
  const d = daily.slice(days == null ? 0 : Math.max(0, end + 1 - days), end + 1);
  return judge({ daily: d, activities: acts.filter((a) => a.date! >= d[0].date && a.date! <= d.at(-1)!.date) });
})));

type Explained = ReturnType<typeof explainWindow>;
const met = (e: Explained, prefix: string) => e.checks.find((c) => c.check.startsWith(prefix))!.met;
const explainAll = (q: Question) => windows.map((w) => explainWindow(q, w));

/** The verdict words seen, so a test can't pass by only ever meeting one case. */
const words = (es: Explained[]) => new Set(es.map((e) => e.verdict.word));

describe("explain_verdict agrees with the verdict", () => {
  it("load", () => {
    const es = explainAll("load");
    for (const e of es) {
      if (e.verdict.word === "No data") continue;
      // the met flags use the exact ratio; the rounded value only says which side of the sweet spot
      const high = !met(e, "Load ratio in") && (e.inputs as { acwr: number }).acwr > 1;
      const low = !met(e, "Load ratio in") && !high;
      const flag = met(e, "Red flag: resting") || met(e, "Red flag: HRV");
      const expected = {
        Overreaching: met(e, "Load ratio above 1.5") || (high && flag),
        "Ramping fast": high && !met(e, "Load ratio above 1.5") && !flag,
        Detraining: low,
        "Watch recovery": met(e, "Load ratio in") && flag,
        Balanced: met(e, "Load ratio in") && !flag,
      }[e.verdict.word];
      expect(expected, `${e.verdict.word}: ${JSON.stringify(e.checks)}`).toBe(true);
    }
    expect(words(es).size).toBeGreaterThanOrEqual(5);
  });

  it("fitness", () => {
    const es = explainAll("fitness").filter((e) => e.verdict.word !== "No data");
    for (const e of es) {
      expect(e.verdict.word === "Improving").toBe(met(e, "VO₂max up"));
      expect(e.verdict.word === "Slipping").toBe(met(e, "VO₂max down"));
      expect(e.verdict.sentence.includes("running volume")).toBe(met(e, "Weekly running km"));
    }
    expect(words(es)).toEqual(new Set(["Improving", "Holding", "Slipping"]));
  });

  it("sleep", () => {
    const es = explainAll("sleep").filter((e) => e.verdict.word !== "No data");
    for (const e of es) {
      const issue = met(e, "Issue: averaging") || met(e, "Issue: bedtime");
      expect(e.verdict.word).toBe(
        met(e, "7-day sleep score below 60") ? "Poor"
          : met(e, "7-day sleep score below 75") || issue ? "Mixed" : "Solid",
      );
    }
    expect(words(es)).toEqual(new Set(["Poor", "Mixed", "Solid"]));
  });

  it("today", () => {
    const es = explainAll("today");
    for (const e of es) expect(e.verdict.sentence.includes("main limiter")).toBe(met(e, "Weakest factor"));
    expect(es.some((e) => met(e, "Weakest factor"))).toBe(true);
    expect(es.some((e) => !met(e, "Weakest factor"))).toBe(true);
  });
});
