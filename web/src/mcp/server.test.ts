/**
 * The MCP server end to end: a real MCP client talks to it in memory, over the
 * synthetic fixture database (no real health data).
 */

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as A from "../lib/analytics";
import { writeFixtureDb } from "../lib/fixture";
import * as Q from "../lib/queries";
import { RANGE_DAYS, RANGES } from "../lib/range";
import * as V from "../lib/verdicts";
import { buildServer } from "./server";
import { runSql } from "./tools";

const file = path.join(mkdtempSync(path.join(os.tmpdir(), "mcp-")), "garmin.db");
writeFixtureDb(file);
const db = Q.openReadOnly(file);
// the fixture last synced 2026-10-01 06:00, and has no data after 2026-07-23
const NOW = new Date("2026-10-01T09:00:00");

const client = new Client({ name: "test", version: "0" });

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(db, path.join(path.dirname(file), "plans.db"), () => NOW).connect(a);
  await client.connect(b);
});

afterAll(async () => {
  await client.close();
  db.close();
});

/** Call a tool; returns its parsed JSON, or the error text when it failed. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  return r.isError ? { error: text } : JSON.parse(text);
}

describe("tools", () => {
  it("are read-only, except the plan tools that write to plans.db", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "get_overview", "get_daily_metrics", "get_activities", "get_weekly_summary", "explain_verdict", "run_sql",
      "get_training_profile", "create_training_plan", "get_training_plan", "adapt_training_plan",
      "edit_training_sessions", "archive_training_plan",
    ]);
    const writes = ["create_training_plan", "adapt_training_plan", "edit_training_sessions", "archive_training_plan"];
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: !writes.includes(t.name), openWorldHint: false });
      if (writes.includes(t.name)) expect(t.annotations?.destructiveHint).toBe(false);
    }
  });
});

describe("get_overview", () => {
  it.each(RANGES)("gives the dashboard's verdicts for %s", async (range) => {
    const daily = Q.dailyRows(db);
    const win = A.sliceWindow(daily, Q.activityRows(db), RANGE_DAYS[range]);
    const o = await call("get_overview", { range });
    expect(o.verdicts.today).toMatchObject(V.today(A.trimBlankTail(win.daily)));
    expect(o.verdicts.load).toMatchObject(V.load(win.daily));
    expect(o.verdicts.fitness).toMatchObject(V.fitness(win.daily, win.activities));
    expect(o.verdicts.sleep).toMatchObject(V.sleep(win.daily));
  });

  it("judges today on the newest day with data, and says the watch is behind", async () => {
    const o = await call("get_overview");
    expect(o.range).toBe("90d");
    expect(o.verdicts.today.day).toBe("2026-07-23");
    expect(o.readiness.day).toBe("2026-07-23");
    expect(o.data).toMatchObject({ newest_day_with_data: "2026-07-23", watch_not_uploading: true, sync_overdue: false });
    expect(o.data.notes[0]).toMatch(/since 2026-07-23/);
  });
});

describe("get_daily_metrics", () => {
  it("defaults to the 14 days ending on the newest stored day, flagging blank days", async () => {
    const r = await call("get_daily_metrics");
    expect([r.start, r.end, r.days.length]).toEqual(["2026-07-13", "2026-07-26", 14]);
    expect(r.days.slice(-3)).toEqual([
      { date: "2026-07-24", no_data: true },
      { date: "2026-07-25", no_data: true },
      { date: "2026-07-26", no_data: true },
    ]);
  });

  it("returns the chosen metrics in readable units", async () => {
    const row = Q.dailyRows(db).find((d) =>
      d.date >= "2026-07-01" && d.sleep_total_seconds != null && d.acute_load != null && d.chronic_load != null)!;
    const r = await call("get_daily_metrics", { start: row.date, end: row.date, metrics: ["sleep_hours", "acwr"] });
    expect(r.days[0]).toEqual({
      date: row.date,
      sleep_hours: Math.round((row.sleep_total_seconds! / 3600) * 100) / 100,
      acwr: Math.round((row.acute_load! / row.chronic_load!) * 100) / 100,
    });
  });

  it("refuses bad ranges and unknown metrics", async () => {
    expect(await call("get_daily_metrics", { start: "2026-07-02", end: "2026-07-01" })).toEqual({
      error: "start 2026-07-02 is after end 2026-07-01",
    });
    expect((await call("get_daily_metrics", { start: "2025-01-01", end: "2026-07-01" })).error).toMatch(/400 or fewer/);
    expect((await call("get_daily_metrics", { metrics: ["heart_rate"] })).error).toBeDefined();
    expect((await call("get_daily_metrics", { start: "July 1" })).error).toBeDefined();
  });
});

describe("get_activities", () => {
  it("returns the newest matches first, up to the limit", async () => {
    const r = await call("get_activities", { group: "Running", limit: 3 });
    expect(r.returned).toBe(3);
    expect(r.matched).toBeGreaterThan(3);
    const dates = r.activities.map((a: { date: string }) => a.date);
    expect(dates).toEqual([...dates].sort().reverse());
    for (const a of r.activities) {
      expect(a.group).toBe("Running");
      expect(a.pace_per_km).toMatch(/^\d+:\d\d$/);
    }
  });

  it("filters by date and exact type", async () => {
    const r = await call("get_activities", { start: "2026-01-01", end: "2026-01-31", type: "hiit", limit: 200 });
    for (const a of r.activities) {
      expect(a.type).toBe("hiit");
      expect(a.date >= "2026-01-01" && a.date <= "2026-01-31").toBe(true);
    }
  });

  it("lists the known types when a type matches nothing", async () => {
    const r = await call("get_activities", { type: "runing" });
    expect(r.matched).toBe(0);
    expect(r.known_types).toContain("running");
  });
});

describe("get_weekly_summary", () => {
  it("covers Monday–Sunday weeks up to the newest stored day", async () => {
    const r = await call("get_weekly_summary", { weeks: 5 });
    expect(r.weeks).toHaveLength(5);
    const newest = Q.dailyRows(db).at(-1)!.date;
    expect(r.weeks.at(-1).week).toBe(`2026-07-20 to ${A.weekEnding(newest)}`);
    for (const w of r.weeks) {
      const [start, end] = w.week.split(" to ");
      expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${end}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("totals each week's training from its activities", async () => {
    const r = await call("get_weekly_summary", { weeks: 3 });
    for (const w of r.weeks) {
      const [start, end] = w.week.split(" to ");
      const acts = Q.activityRows(db).filter((a) => a.date! >= start && a.date! <= end);
      const t = w.training;
      expect(t.sessions).toBe(acts.length);
      expect(Object.values(t.sessions_by_intensity).reduce((x: number, y) => x + (y as number), 0)).toBe(acts.length);
      const hours = acts.reduce((h, a) => h + (a.duration_s ?? 0) / 3600, 0);
      expect(t.hours).toBeCloseTo(hours, 1);
    }
  });

  it("shows when a week is incomplete", async () => {
    const r = await call("get_weekly_summary", { weeks: 1 });
    // the fixture's last week ends in three blank days
    expect(r.weeks[0].days_with_data).toBe(4);
  });
});

describe("explain_verdict", () => {
  it.each(RANGES)("explains the same verdict get_overview gives (%s)", async (range) => {
    const o = await call("get_overview", { range });
    for (const q of ["today", "load", "fitness", "sleep"]) {
      const e = await call("explain_verdict", { question: q, range });
      expect(e.verdict).toEqual({ status: o.verdicts[q].status, word: o.verdicts[q].word, sentence: o.verdicts[q].sentence });
    }
  });

  it("refuses an unknown question", async () => {
    expect((await call("explain_verdict", { question: "mood" })).error).toBeDefined();
  });
});

describe("run_sql", () => {
  it("lists the schema in its description", async () => {
    const { tools } = await client.listTools();
    const d = tools.find((t) => t.name === "run_sql")!.description!;
    expect(d).toMatch(/daily_metrics\(date TEXT, resting_hr INTEGER/);
    expect(d).toMatch(/activities\(activity_id INTEGER/);
  });

  it("returns columns and rows, numbering duplicate column names", async () => {
    const r = await call("run_sql", {
      sql: "SELECT a.date, b.date FROM daily_metrics a JOIN daily_metrics b ON b.date = a.date ORDER BY a.date LIMIT 2;",
    });
    expect(r).toEqual({ columns: ["date", "date:1"], rows: [["2025-06-01", "2025-06-01"], ["2025-06-02", "2025-06-02"]], truncated: false });
  });

  it("accepts WITH queries and trailing comments, and flags truncation", async () => {
    const r = await call("run_sql", {
      sql: "WITH runs AS (SELECT * FROM activities WHERE activity_type = 'running') SELECT date FROM runs -- all runs",
      max_rows: 3,
    });
    expect(r.rows).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("cuts long strings", async () => {
    const r = await call("run_sql", { sql: "SELECT printf('%.2000c', 'x') AS long" });
    expect(r.rows[0][0]).toMatch(/^x{500}… \(2000 chars\)$/);
  });

  it.each([
    "DELETE FROM activities",
    "UPDATE daily_metrics SET steps = 0",
    "INSERT INTO sync_log (kind) VALUES ('x')",
    "DROP TABLE activities",
    "SELECT 1; DELETE FROM activities",
    "ATTACH DATABASE 'other.db' AS other",
    "PRAGMA query_only = OFF",
    "CREATE TEMP TABLE t (x)",
  ])("refuses to write: %s", async (sql) => {
    const before = db.prepare("SELECT (SELECT count(*) FROM activities) + (SELECT count(*) FROM sync_log)").pluck().get();
    const r = await call("run_sql", { sql });
    expect(r.error).toMatch(/run_sql accepts one SELECT|statement|not allowed|readonly/i);
    expect(db.prepare("SELECT (SELECT count(*) FROM activities) + (SELECT count(*) FROM sync_log)").pluck().get()).toBe(before);
  });

  it("stops a runaway query", async () => {
    const started = Date.now();
    await expect(runSql({ db, now: () => NOW, sqlTimeoutMs: 1000 }, {
      sql: "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c",
      max_rows: 1,
    })).rejects.toThrow(/longer than 1s/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
