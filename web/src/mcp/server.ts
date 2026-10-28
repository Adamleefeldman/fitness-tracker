/**
 * MCP server over garmin.db, so Claude can answer questions from your data
 * with the same numbers and verdicts as the dashboard.
 *
 *   node src/mcp/server.ts        (stdio; Claude Code and Claude Desktop start it)
 *
 * Read-only, local only: it opens garmin.db read-only and talks over stdio,
 * with no network port. Tool results become part of your Claude conversation.
 * Set GARMIN_DB_PATH to use a different database file.
 */

import path from "node:path";

import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openReadOnly } from "../lib/queries.ts";
import * as T from "./tools.ts";

const INSTRUCTIONS = `Garmin health data from the user's Forerunner, synced daily into a local database.
Start with get_overview: it gives the dashboard's four verdicts, the latest readings, and whether the
data is current. If data.watch_not_uploading is true, say so before drawing conclusions about recent days.
The verdicts are simple published rules (acute:chronic load sweet spot 0.8–1.3; resting HR 7-day average
3+ bpm above its 28-day average; HRV 7-day average below Garmin's baseline), not medical advice.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Tool results as JSON text. */
const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result) }] });

export function buildServer(db: Database.Database, now = () => new Date()): McpServer {
  const ctx: T.Ctx = { db, now };
  const server = new McpServer({ name: "garmin-health", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool("get_overview", {
    title: "Health overview",
    description:
      "The dashboard at a glance: a verdict for each of its four questions (train hard today? overtraining? " +
      "getting fitter? sleep improving?), today's readiness and its factors, the latest resting HR, HRV, sleep, " +
      "VO₂max, Body Battery and steps with their dates, and whether the data is up to date.",
    inputSchema: T.overviewInput,
    annotations: READ_ONLY,
  }, (args) => json(T.getOverview(ctx, args)));

  server.registerTool("get_daily_metrics", {
    title: "Daily metrics",
    description:
      "One row per day for a date range (default: the 14 days ending on the newest stored day; at most 400 days). " +
      "Days the watch hasn't uploaded come back as {date, no_data: true}; days with no row at all are left out. " +
      "acwr is the acute:chronic load ratio. bedtime and wake_time are local 'YYYY-MM-DD HH:MM'.",
    inputSchema: T.dailyMetricsInput,
    annotations: READ_ONLY,
  }, (args) => json(T.getDailyMetrics(ctx, args)));

  server.registerTool("get_activities", {
    title: "Activities",
    description:
      "Workouts, newest first: type, duration, distance, pace, heart rate, training load, training effect and " +
      "intensity (hard: aerobic TE ≥ 3.5 or anaerobic ≥ 2.5; moderate: aerobic ≥ 2.5; easy: below). " +
      "Filter by date range, group or exact type. `matched` counts every match before the limit.",
    inputSchema: T.activitiesInput,
    annotations: READ_ONLY,
  }, (args) => json(T.getActivities(ctx, args)));

  return server;
}

if (import.meta.main) {
  const file = process.env.GARMIN_DB_PATH ?? path.resolve(import.meta.dirname, "../../../garmin.db");
  const server = buildServer(openReadOnly(file));
  await server.connect(new StdioServerTransport());
}
