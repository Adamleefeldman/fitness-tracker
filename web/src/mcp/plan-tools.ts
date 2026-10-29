/**
 * The training-plan tools: the athlete profile, and creating, reading,
 * adapting and editing plans in plans.db. Like tools.ts, plain functions
 * returning JSON-ready objects; server.ts registers them.
 */

import { z } from "zod";

import * as Q from "../lib/queries.ts";
import type { Tracked } from "../lib/plans/adapt.ts";
import { formatDuration, formatPace } from "../lib/plans/paces.ts";
import { buildProfile, localToday } from "../lib/plans/profile.ts";
import * as Sv from "../lib/plans/service.ts";
import * as St from "../lib/plans/store.ts";
import { GOAL_LABELS, GOALS, WEEKDAYS, type Weekday } from "../lib/plans/types.ts";
import { addDays } from "../lib/plans/profile.ts";
import type { Ctx } from "./tools.ts";

export interface PlanCtx extends Ctx {
  /** plans.db; created on the first write. */
  plansFile: string;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const DISCIPLINES = ["run", "hyrox", "crossfit", "strength", "conditioning", "mobility", "race"] as const;
const INTENSITIES = ["easy", "moderate", "hard"] as const;

const garmin = (ctx: PlanCtx): Sv.Garmin => ({ daily: Q.dailyRows(ctx.db), activities: Q.activityRows(ctx.db) });
const readPlans = (ctx: PlanCtx) => St.openPlans(ctx.plansFile, { create: false });
const writePlans = (ctx: PlanCtx) => St.openPlans(ctx.plansFile, { create: true })!;

/** Run `fn` with plans.db open, closing it after. */
function withPlans<T>(db: ReturnType<typeof readPlans>, fn: (db: ReturnType<typeof readPlans>) => T): T {
  try {
    return fn(db);
  } finally {
    db?.close();
  }
}

/** PlanError → a plain Error the SDK reports as the tool's error text. */
function friendly<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Sv.PlanError) throw new Error(e.message);
    throw e;
  }
}

// --- get_training_profile ---

export function getTrainingProfile(ctx: PlanCtx) {
  const g = garmin(ctx);
  const p = buildProfile(g.daily, g.activities, localToday(ctx.now()));
  return {
    as_of: p.asOf,
    last_4_weeks: {
      training_minutes_per_week: p.weeklyMinutes4, sessions_per_week: p.sessionsPerWeek4,
      running_km_per_week: p.runKmPerWeek4, longest_run_km_last_8_weeks: p.longestRunKm8,
    },
    last_12_weeks: {
      training_minutes_per_week: p.weeklyMinutes12, running_km_per_week: p.runKmPerWeek12,
      share_of_hours: Object.fromEntries(Object.entries(p.mix).map(([g, v]) => [g, `${Math.round(v * 100)}%`])),
    },
    vo2max_running: p.vo2max,
    vo2max_change_90d: p.vo2maxTrend,
    resting_hr_bpm: p.restingHr,
    max_hr_bpm: p.maxHr,
    paces_per_km: p.paces && {
      easy: `${formatDuration(p.paces.easy[1])}–${formatPace(p.paces.easy[0])}`,
      marathon: formatPace(p.paces.marathon), threshold: formatPace(p.paces.threshold),
      interval: formatPace(p.paces.interval), repetition: formatPace(p.paces.repetition),
    },
    body_state: p.state,
    goals_supported: Object.fromEntries(GOALS.map((g) => [g, GOAL_LABELS[g]])),
  };
}

// --- create_training_plan ---

export const createPlanInput = {
  goal: z.enum(GOALS).describe("What the plan is for: a race distance, HYROX, CrossFit, or general fitness"),
  name: z.string().min(1).max(80).describe('The event or plan name, e.g. "Berlin Half" or "Spring HYROX"'),
  event_date: isoDate.optional().describe("Main event date, YYYY-MM-DD; the plan peaks and tapers into it"),
  weeks: z.number().int().min(1).max(40).optional().describe("Plan length when there's no event (default 12)"),
  start_date: isoDate.optional().describe("First day (default: tomorrow)"),
  days_per_week: z.number().int().min(3).max(7).describe("Training days per week the athlete can commit to"),
  long_day: z.enum(WEEKDAYS).default("Sat").describe("Day for the long session"),
  max_session_min: z.number().int().min(30).max(240).optional().describe("Longest session on other days (default 75)"),
  target_time: z.string().optional().describe("Goal finish time, h:mm:ss or mm:ss (races and HYROX)"),
  other_events: z.array(z.object({
    name: z.string().min(1), date: isoDate, goal: z.enum(GOALS).optional(),
  })).max(10).optional().describe("Tune-up events inside the plan; each gets a mini-taper"),
  notes: z.string().max(500).optional().describe("Anything else the athlete said (kept with the plan)"),
};

type CreateArgs = { [K in keyof typeof createPlanInput]: z.infer<(typeof createPlanInput)[K]> };

export function createTrainingPlan(ctx: PlanCtx, a: CreateArgs) {
  return friendly(() => withPlans(writePlans(ctx), (db) => {
    const { id, plan } = Sv.createPlan(db!, garmin(ctx), {
      goal: a.goal, name: a.name, eventDate: a.event_date, weeks: a.weeks, startDate: a.start_date,
      daysPerWeek: a.days_per_week, longDay: WEEKDAYS.indexOf(a.long_day) as Weekday, maxSessionMin: a.max_session_min,
      targetTime: a.target_time, otherEvents: a.other_events, notes: a.notes,
    }, ctx.now());
    const weeks = new Map<number, { minutes: number; run_km: number; phase: string }>();
    for (const s of plan.sessions) {
      const w = weeks.get(s.week) ?? { minutes: 0, run_km: 0, phase: s.phase };
      if (s.discipline !== "race") w.minutes += s.durationMin;
      if (s.discipline === "run") w.run_km = Math.round((w.run_km + (s.distanceKm ?? 0)) * 10) / 10;
      weeks.set(s.week, w);
    }
    return {
      plan_id: id,
      start: plan.startDate, end: plan.endDate,
      phases: plan.phases,
      why: plan.notes,
      weekly_volume: [...weeks].map(([week, w]) => ({ week, ...w })),
      first_two_weeks: plan.sessions.filter((s) => s.date <= addDays(plan.startDate, 13)).map((s) => ({
        date: s.date, weekday: WEEKDAYS[(new Date(`${s.date}T00:00:00Z`).getUTCDay() + 6) % 7], title: s.title,
        intensity: s.intensity, duration_min: s.durationMin, distance_km: s.distanceKm, description: s.description,
      })),
      sessions_total: plan.sessions.length,
    };
  }));
}

// --- get_training_plan ---

export const getPlanInput = {
  from: isoDate.optional().describe("First day of sessions to list (default: 7 days ago)"),
  to: isoDate.optional().describe("Last day of sessions to list (default: 14 days ahead)"),
};

const sessionOut = (s: Tracked) => ({
  id: s.id, date: s.date, weekday: WEEKDAYS[(new Date(`${s.date}T00:00:00Z`).getUTCDay() + 6) % 7],
  week: s.week, phase: s.phase, discipline: s.discipline, intensity: s.intensity, title: s.title,
  description: s.description, duration_min: s.durationMin, distance_km: s.distanceKm, outcome: s.outcome,
  done_with: s.activity, changed_by: s.source === "plan" ? null : s.source, note: s.note,
});

export function getTrainingPlan(ctx: PlanCtx, { from, to }: { from?: string; to?: string }) {
  return withPlans(readPlans(ctx), (db) => {
    const v = Sv.planView(db, garmin(ctx), ctx.now());
    if (!v) return { plan: null, hint: "No active plan. Use get_training_profile, then create_training_plan." };
    const first = from ?? addDays(v.today, -7);
    const last = to ?? addDays(v.today, 14);
    return {
      plan: {
        id: v.plan.id, name: v.plan.name, goal: GOAL_LABELS[v.plan.goal], event_date: v.plan.eventDate,
        start: v.plan.startDate, end: v.plan.endDate, phases: v.plan.phases, why: v.plan.notes,
        asked_for: v.plan.input,
      },
      today: v.today,
      verdict: v.verdict,
      phase_now: v.phaseNow,
      days_to_event: v.daysToEvent,
      body_state: { level: v.state.level, reasons: v.state.reasons },
      last_14_days: v.compliance14,
      suggested_adaptations: v.proposed.map((c) => ({ date: c.date, from: c.before, to: c.after, why: c.reason })),
      sessions: v.sessions.filter((s) => s.date >= first && s.date <= last).map(sessionOut),
      weeks: v.weeks.map((w) => ({
        week: w.week, starts: w.start, phase: w.phase, planned_min: w.plannedMin, done_min: w.doneMin,
        planned_run_km: w.plannedKm, done_run_km: w.doneKm,
      })),
      recent_changes: v.changes,
    };
  });
}

// --- adapt_training_plan ---

export const adaptInput = {
  apply: z.boolean().default(true).describe("false previews the changes without saving them"),
};

export function adaptTrainingPlan(ctx: PlanCtx, { apply }: { apply: boolean }) {
  return friendly(() => withPlans(apply ? writePlans(ctx) : readPlans(ctx), (db) => {
    if (!db) throw new Sv.PlanError("There's no active plan.");
    const r = Sv.adaptPlan(db, garmin(ctx), ctx.now(), apply);
    return {
      applied: r.applied,
      body_state: { level: r.state.level, reasons: r.state.reasons },
      changes: r.changes.map((c) => ({ id: c.id, date: c.date, from: c.before, to: c.after, why: c.reason, now: c.session.description })),
      summary: r.changes.length ? undefined : "Nothing to change: the next 7 days already fit how the body is doing.",
    };
  }));
}

// --- edit_training_sessions ---

const fields = {
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(600).optional(),
  duration_min: z.number().int().min(5).max(300).optional(),
  distance_km: z.number().min(0).max(100).nullable().optional(),
  intensity: z.enum(INTENSITIES).optional(),
  discipline: z.enum(DISCIPLINES).optional(),
  note: z.string().max(200).optional().describe("Why it changed"),
};

export const editInput = {
  edits: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("update"), id: z.number().int(), date: isoDate.optional(), ...fields }),
    z.object({
      op: z.literal("add"), date: isoDate, title: z.string().min(1).max(80), description: z.string().max(600),
      discipline: z.enum(DISCIPLINES), intensity: z.enum(INTENSITIES), duration_min: z.number().int().min(5).max(300),
      distance_km: z.number().min(0).max(100).nullable().optional(), note: z.string().max(200).optional(),
    }),
    z.object({ op: z.literal("remove"), id: z.number().int() }),
    z.object({ op: z.literal("status"), id: z.number().int(), status: z.enum(["planned", "done", "skipped"]) }),
  ])).min(1).max(50).describe("Changes, applied together: all or nothing"),
};

type EditArgs = z.infer<z.ZodArray<(typeof editInput.edits)["element"]>>;

export function editTrainingSessions(ctx: PlanCtx, { edits }: { edits: EditArgs }) {
  return friendly(() => withPlans(readPlans(ctx), (db) => {
    if (!db) throw new Sv.PlanError("There's no active plan.");
    const done = Sv.editSessions(db, edits.map((e): Sv.Edit => {
      if (e.op === "update") {
        return {
          op: "update", id: e.id, date: e.date, title: e.title, description: e.description, durationMin: e.duration_min,
          distanceKm: e.distance_km, intensity: e.intensity, discipline: e.discipline, note: e.note,
        };
      }
      if (e.op === "add") {
        return {
          op: "add", date: e.date, title: e.title, description: e.description, discipline: e.discipline,
          intensity: e.intensity, durationMin: e.duration_min, distanceKm: e.distance_km, note: e.note,
        };
      }
      return e;
    }), ctx.now());
    return { done };
  }));
}

// --- archive_training_plan ---

export function archiveTrainingPlan(ctx: PlanCtx) {
  return friendly(() => withPlans(readPlans(ctx), (db) => {
    const plan = db && St.activePlan(db);
    if (!plan) throw new Sv.PlanError("There's no active plan.");
    St.archivePlan(db!, plan.id);
    return { archived: { id: plan.id, name: plan.name }, note: "Kept in plans.db; it just isn't active any more." };
  }));
}
