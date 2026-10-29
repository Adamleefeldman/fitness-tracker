"use server";

/**
 * The Plan page's writes: create a plan, adapt it, mark a session, archive it.
 * All go to plans.db; garmin.db stays read-only. The app runs locally with no
 * login (see web/README.md), so these trust whoever can reach it.
 */

import { refresh } from "next/cache";
import { z } from "zod";

import { loadGarmin, withPlans } from "@/lib/plans-db";
import { adaptPlan, createPlan, editSessions, PlanError } from "@/lib/plans/service";
import { activePlan, archivePlan } from "@/lib/plans/store";
import { GOALS, WEEKDAYS, type PlanInput, type Weekday } from "@/lib/plans/types";

export interface FormState {
  error?: string;
  /** What was submitted, so the form can show it again after an error. */
  values?: Record<string, string>;
}

/** "75 min" → 75: Mantine's NumberInput submits its suffix too. */
const int = z.preprocess((v) => (typeof v === "string" ? Number.parseInt(v, 10) : v), z.number().int());

const optional = z.string().trim().transform((v) => v || undefined).optional();
const date = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Dates must be YYYY-MM-DD").transform((v) => v || undefined).optional();

const schema = z.object({
  goal: z.enum(GOALS, { message: "Pick a goal" }),
  name: z.string().trim().min(1, "Give the plan a name").max(80),
  eventDate: date,
  weeks: int.pipe(z.number().min(1, "Plans run 1 to 40 weeks").max(40, "Plans run 1 to 40 weeks")).optional(),
  targetTime: optional,
  days: int.pipe(z.number().min(3, "Pick 3 to 7 days").max(7, "Pick 3 to 7 days")),
  longDay: z.enum(WEEKDAYS),
  maxSessionMin: int.pipe(z.number().min(30, "Weekday sessions need at least 30 minutes").max(240, "Weekday sessions top out at 240 minutes")),
  tuneUpName: optional,
  tuneUpDate: date,
  notes: z.string().trim().max(500).optional(),
});

export async function createPlanAction(_: FormState, form: FormData): Promise<FormState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const raw = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const f = parsed.data;
  if (f.tuneUpDate && !f.tuneUpName) return { error: "Give the tune-up event a name", values };
  const input: PlanInput = {
    goal: f.goal, name: f.name, eventDate: f.eventDate, weeks: f.eventDate ? undefined : f.weeks ?? 12,
    targetTime: f.targetTime, daysPerWeek: f.days, longDay: WEEKDAYS.indexOf(f.longDay) as Weekday,
    maxSessionMin: f.maxSessionMin, notes: f.notes,
    otherEvents: f.tuneUpDate && f.tuneUpName ? [{ name: f.tuneUpName, date: f.tuneUpDate }] : undefined,
  };
  const garmin = await loadGarmin();
  try {
    withPlans((db) => createPlan(db, garmin, input, new Date()));
  } catch (e) {
    if (e instanceof PlanError) return { error: e.message, values };
    throw e;
  }
  refresh();
  return {};
}

export async function adaptPlanAction() {
  const garmin = await loadGarmin();
  withPlans((db) => adaptPlan(db, garmin, new Date(), true));
  refresh();
}

export async function markSessionAction(form: FormData) {
  const id = Number(form.get("id"));
  const status = z.enum(["planned", "done", "skipped"]).parse(form.get("status"));
  withPlans((db) => editSessions(db, [{ op: "status", id, status }], new Date()));
  refresh();
}

export async function archivePlanAction() {
  withPlans((db) => {
    const plan = activePlan(db);
    if (plan) archivePlan(db, plan.id);
  });
  refresh();
}
