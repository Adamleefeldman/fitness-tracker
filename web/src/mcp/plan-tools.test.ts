/**
 * The training-plan tools end to end, through a real MCP client, over the
 * synthetic fixture and a throwaway plans.db.
 */

import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { writeFixtureDb } from "../lib/fixture";
import * as Q from "../lib/queries";
import { buildServer } from "./server";

const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-plans-"));
const file = path.join(dir, "garmin.db");
writeFixtureDb(file);
const db = Q.openReadOnly(file);
const plansFile = path.join(dir, "plans.db");
// the fixture's data runs to 2026-07-23
const NOW = new Date("2026-07-20T08:00:00");

const client = new Client({ name: "test", version: "0" });

beforeAll(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(db, plansFile, () => NOW).connect(a);
  await client.connect(b);
});

afterAll(async () => {
  await client.close();
  db.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  return r.isError ? { error: text } : JSON.parse(text);
}

describe("training plan tools", () => {
  it("say there's no plan without creating plans.db", async () => {
    expect(await call("get_training_plan")).toMatchObject({ plan: null });
    expect(existsSync(plansFile)).toBe(false);
  });

  it("profile the athlete from the Garmin data", async () => {
    const p = await call("get_training_profile");
    expect(p.as_of).toBe("2026-07-23");
    expect(p.body_state.level).toMatch(/ready|normal|caution|recover/);
    expect(p.paces_per_km.threshold).toMatch(/^\d:\d\d\/km$/);
    expect(p.goals_supported.hyrox).toBe("HYROX");
  });

  it("create, read, edit, adapt and archive a plan", async () => {
    const created = await call("create_training_plan", {
      goal: "hyrox", name: "Autumn HYROX", event_date: "2026-11-15", days_per_week: 4, long_day: "Sun",
      target_time: "1:20:00", other_events: [{ name: "Club 10K", date: "2026-10-04", goal: "10k" }],
    });
    expect(created.plan_id).toBeGreaterThan(0);
    expect(created.end).toBe("2026-11-15");
    expect(created.why[0]).toMatch(/^Built from your last 4 weeks/);
    expect(created.first_two_weeks.length).toBeGreaterThan(3);
    expect(created.weekly_volume.at(-1).phase).toBe("taper");

    const plan = await call("get_training_plan", { from: "2026-07-21", to: "2026-08-02" });
    expect(plan.plan.name).toBe("Autumn HYROX");
    expect(plan.sessions.every((s: { outcome: string }) => s.outcome === "upcoming")).toBe(true);
    const [first, second] = plan.sessions;

    const edited = await call("edit_training_sessions", {
      edits: [
        { op: "update", id: first.id, title: "Sled technique", duration_min: 40, note: "gym has sleds on Tuesdays" },
        { op: "add", date: "2026-07-25", title: "Yoga", description: "45 min flow", discipline: "mobility", intensity: "easy", duration_min: 45 },
        { op: "status", id: second.id, status: "skipped" },
      ],
    });
    expect(edited.done).toHaveLength(3);
    const after = await call("get_training_plan", { from: "2026-07-21", to: "2026-08-02" });
    expect(after.sessions.find((s: { id: number }) => s.id === first.id)).toMatchObject({ title: "Sled technique", changed_by: "edit" });
    expect(after.sessions.find((s: { id: number }) => s.id === second.id).outcome).toBe("skipped");
    expect(after.sessions.some((s: { title: string }) => s.title === "Yoga")).toBe(true);

    const preview = await call("adapt_training_plan", { apply: false });
    expect(preview.applied).toBe(false);
    expect(preview.body_state.reasons.length).toBeGreaterThan(0);

    expect(await call("archive_training_plan")).toMatchObject({ archived: { name: "Autumn HYROX" } });
    expect(await call("get_training_plan")).toMatchObject({ plan: null });
  });

  it("explain what's wrong with a request", async () => {
    expect((await call("create_training_plan", { goal: "10k", name: "x", days_per_week: 2 })).error).toBeDefined();
    expect((await call("create_training_plan", { goal: "10k", name: "x", days_per_week: 4, event_date: "2026-07-01" })).error)
      .toMatch(/after the plan starts/);
    expect((await call("edit_training_sessions", { edits: [{ op: "remove", id: 1 }] })).error).toMatch(/no active plan|isn't in/);
  });
});
