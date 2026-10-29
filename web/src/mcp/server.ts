/**
 * MCP server over garmin.db, so Claude can answer questions from your data
 * with the same numbers and verdicts as the dashboard.
 *
 *   node src/mcp/server.ts        (stdio; Claude Code and Claude Desktop start it)
 *
 * Local only: it talks over stdio with no network port, and opens garmin.db
 * read-only. The training-plan tools write to plans.db, next to it. Tool
 * results become part of your Claude conversation. GARMIN_DB_PATH and
 * PLANS_DB_PATH point at other database files.
 */

import path from "node:path";

import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openReadOnly } from "../lib/queries.ts";
import * as PT from "./plan-tools.ts";
import * as T from "./tools.ts";

const INSTRUCTIONS = `Garmin health data from the user's Forerunner, synced daily into a local database.
Start with get_overview: it gives the dashboard's four verdicts, the latest readings, and whether the
data is current. If data.watch_not_uploading is true, say so before drawing conclusions about recent days.
Use explain_verdict when the user asks why a verdict says what it does, and get_weekly_summary for trends
across weeks (e.g. how sleep tracked with training load). run_sql answers anything else.
The verdicts are simple published rules (acute:chronic load sweet spot 0.8–1.3; resting HR 7-day
average 3+ bpm above its 28-day average; HRV 7-day average below Garmin's baseline), not medical advice.

Training plans: to build one, call get_training_profile first, then ask for anything you don't know —
the goal (5K, 10K, half, marathon, HYROX, CrossFit, general fitness), the event date and any tune-up
events, target time, training days per week and which day suits the long session. create_training_plan
builds a periodised plan from their data and body state; share its "why" notes. Tailor it with
edit_training_sessions (moves, swaps, extra sessions) and keep it current with adapt_training_plan when
readiness, load or sleep slip. get_training_plan shows what's next and what was done.`;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
/** Writes only to plans.db, and nothing it does can't be redone. */
const WRITES_PLANS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** Tool results as JSON text. */
const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result) }] });

export function buildServer(db: Database.Database, plansFile: string, now = () => new Date()): McpServer {
  const ctx: PT.PlanCtx = { db, now, plansFile };
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

  server.registerTool("get_weekly_summary", {
    title: "Weekly summary",
    description:
      "One entry per Monday–Sunday week (default 8, at most 104), ending with the week of the newest stored day: " +
      "training hours by group, sessions by intensity, running km and the load ratio at week end, next to that " +
      "week's average readiness, resting HR, HRV, sleep, stress, Body Battery and steps. Use it to compare " +
      "training with recovery over time. days_with_data shows when a week is incomplete.",
    inputSchema: T.weeklySummaryInput,
    annotations: READ_ONLY,
  }, (args) => json(T.getWeeklySummary(ctx, args)));

  server.registerTool("explain_verdict", {
    title: "Explain a verdict",
    description:
      "Why one of the dashboard's verdicts says what it does: the numbers it judged, how its rules combine, and " +
      "each rule's threshold with the current value and whether it was met.",
    inputSchema: T.explainInput,
    annotations: READ_ONLY,
  }, (args) => json(T.explainVerdict(ctx, args)));

  server.registerTool("run_sql", {
    title: "Run a read-only SQL query",
    description:
      "For questions the other tools don't cover (e.g. longest run, best month). One SQLite SELECT or " +
      "WITH … SELECT; anything that writes is rejected, queries stop after 5 s, and strings are cut to 500 " +
      "characters. Returns {columns, rows (arrays), truncated}.\n\n" +
      "Units as stored: dates 'YYYY-MM-DD'; times local 'YYYY-MM-DD HH:MM[:SS]'; sleep_*_seconds and " +
      "duration_s in seconds; distance_m in metres; avg_pace_s_per_km in seconds per km; weight_g in grams. " +
      "Blank daily_metrics rows (watch not uploaded) have only date, raw_json and synced_at. raw_json holds " +
      "Garmin's original payloads; prefer the columns. activities.date is the local day.\n\nTables:\n" +
      T.schemaSummary(db),
    inputSchema: T.runSqlInput,
    annotations: READ_ONLY,
  }, async (args) => json(await T.runSql(ctx, args)));

  // --- training plans ---

  server.registerTool("get_training_profile", {
    title: "Training profile",
    description:
      "What the Garmin data says the athlete can do now, for planning: weekly training minutes, sessions and running " +
      "km (last 4 and 12 weeks), longest recent run, activity mix, VO₂max and its trend, training paces, and the " +
      "body's state (ready / normal / caution / recover, with reasons).",
    annotations: READ_ONLY,
  }, () => json(PT.getTrainingProfile(ctx)));

  server.registerTool("create_training_plan", {
    title: "Create a training plan",
    description:
      "Build and save a periodised plan (base → build → peak → taper into the event) personalised from the Garmin " +
      "data: starting volume from recent training, lighter if the body needs it, paces from VO₂max, ≤ 10% weekly " +
      "growth, a deload every 4th week, hard days never back to back. Replaces the active plan (the old one is " +
      "archived, not deleted). Returns the reasons behind the plan, weekly volume and the first two weeks.",
    inputSchema: PT.createPlanInput,
    annotations: WRITES_PLANS,
  }, (args) => json(PT.createTrainingPlan(ctx, args)));

  server.registerTool("get_training_plan", {
    title: "Training plan",
    description:
      "The active plan against what was actually done: its verdict (on track / behind / adjust / taper), body state, " +
      "sessions in a date range (default: last 7 to next 14 days) with ids and each workout in detail (blocks of " +
      "steps with sets, reps, target pace/effort/load and rest), each marked done (with the matching " +
      "Garmin activity), missed, skipped, today or upcoming, planned vs done volume per week, suggested " +
      "adaptations, and recent changes.",
    inputSchema: PT.getPlanInput,
    annotations: READ_ONLY,
  }, (args) => json(PT.getTrainingPlan(ctx, args)));

  server.registerTool("adapt_training_plan", {
    title: "Adapt the plan to the body's state",
    description:
      "Rules-based adjustment of the next 7 days: on recover, the next three days go easy (rest if readiness is Poor) " +
      "and only one hard session stays after that; on caution, the next hard session is trimmed; once the warning " +
      "signs clear, adapted sessions go back to the plan. Leaves race days and hand-edited sessions alone. " +
      "apply: false previews.",
    inputSchema: PT.adaptInput,
    annotations: { ...WRITES_PLANS, idempotentHint: true },
  }, (args) => json(PT.adaptTrainingPlan(ctx, args)));

  server.registerTool("edit_training_sessions", {
    title: "Edit plan sessions",
    description:
      "Change the active plan's sessions, all in one go: update (move, retitle, rewrite, resize, change intensity), " +
      "add a session, remove one, or mark one done / skipped / planned. Use the ids from get_training_plan. " +
      "Edited sessions keep their original and aren't touched by adaptation.",
    inputSchema: PT.editInput,
    annotations: WRITES_PLANS,
  }, (args) => json(PT.editTrainingSessions(ctx, args)));

  server.registerTool("archive_training_plan", {
    title: "Archive the active plan",
    description: "Stop following the active plan. It stays in plans.db, just no longer active.",
    annotations: WRITES_PLANS,
  }, () => json(PT.archiveTrainingPlan(ctx)));

  return server;
}

if (import.meta.main) {
  const file = process.env.GARMIN_DB_PATH ?? path.resolve(import.meta.dirname, "../../../garmin.db");
  const plans = process.env.PLANS_DB_PATH ?? path.join(path.dirname(file), "plans.db");
  const server = buildServer(openReadOnly(file), plans);
  await server.connect(new StdioServerTransport());
}
