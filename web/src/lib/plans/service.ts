/**
 * What the app and the MCP server do with plans: create one from a goal and
 * the Garmin data, look at it against what was actually done, adapt it to the
 * body's state, and edit sessions. Both callers go through here, so they agree.
 */

import type Database from "better-sqlite3";

import type { Activity, Daily } from "../types.ts";
import type { Status } from "../levels.ts";
import { adaptations, compliance, track, type Change, type Tracked } from "./adapt.ts";
import { generatePlan, PlanError } from "./generate.ts";
import { addDays, buildProfile, daysBetween, localToday } from "./profile.ts";
import * as S from "./store.ts";
import { GOAL_LABELS, type BodyState, type Discipline, type Intensity, type Phase, type PlanInput, type Session } from "./types.ts";

export { PlanError };

export interface Garmin {
  daily: Daily[];
  activities: Activity[];
}

export function createPlan(db: Database.Database, garmin: Garmin, input: PlanInput, now: Date) {
  const today = localToday(now);
  const profile = buildProfile(garmin.daily, garmin.activities, today);
  const plan = generatePlan(input, profile, today);
  const id = S.savePlan(db, plan, profile, now);
  return { id, plan, profile };
}

export interface WeekSummary {
  week: number;
  start: string;
  phase: Phase;
  plannedMin: number;
  plannedKm: number;
  doneMin: number;
  doneKm: number;
}

export interface PlanView {
  plan: S.StoredPlan;
  today: string;
  state: BodyState;
  sessions: Tracked[];
  /** Today's sessions, and the next one after today. */
  todays: Tracked[];
  next: Tracked | null;
  /** Monday–Sunday of the current week. */
  thisWeek: Tracked[];
  weeks: WeekSummary[];
  compliance14: { done: number; due: number };
  daysToEvent: number | null;
  phaseNow: Phase | null;
  verdict: { status: Status; word: string; sentence: string };
  /** What adaptation would change in the next 7 days right now. */
  proposed: Change[];
  changes: { at: string; source: string; summary: string }[];
}

const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

function weekSummaries(plan: S.StoredPlan, sessions: Tracked[], activities: Activity[]): WeekSummary[] {
  const monday0 = mondayOf(plan.startDate);
  const n = Math.ceil((daysBetween(monday0, plan.endDate) + 1) / 7);
  return Array.from({ length: n }, (_, i) => {
    const start = addDays(monday0, i * 7);
    const end = addDays(start, 6);
    const planned = sessions.filter((s) => s.date >= start && s.date <= end && s.discipline !== "race");
    const done = activities.filter((a) => a.date != null && a.date >= start && a.date <= end);
    const phase = plan.phases.find((p) => p.end >= start && p.start <= end)?.phase ?? "base";
    return {
      week: i + 1, start, phase,
      plannedMin: planned.reduce((m, s) => m + s.durationMin, 0),
      plannedKm: Math.round(planned.reduce((k, s) => k + (s.discipline === "run" ? s.distanceKm ?? 0 : 0), 0) * 10) / 10,
      doneMin: Math.round(done.reduce((m, a) => m + (a.duration_s ?? 0) / 60, 0)),
      doneKm: Math.round(done.filter((a) => a.distance_km != null && /run/.test(a.activity_type ?? ""))
        .reduce((k, a) => k + a.distance_km!, 0) * 10) / 10,
    };
  });
}

function verdict(v: Omit<PlanView, "verdict">): PlanView["verdict"] {
  const { plan, today, state, compliance14: c, daysToEvent, phaseNow, proposed } = v;
  const toGo = daysToEvent != null
    ? `${daysToEvent === 0 ? "Race day" : `${daysToEvent} day${daysToEvent === 1 ? "" : "s"} to ${plan.name}`}`
    : `${GOAL_LABELS[plan.goal]} plan`;
  const doneText = c.due ? `${c.done} of ${c.due} sessions done in the last two weeks` : "nothing due yet";
  if (today > plan.endDate) return { status: "neutral", word: "Complete", sentence: `${plan.name} is behind you. Create a new plan for what's next.` };
  if (today < plan.startDate) return { status: "neutral", word: "Starts soon", sentence: `${toGo}; the plan starts on ${plan.startDate}.` };
  if (proposed.some((p) => p.source === "adapt")) {
    return { status: "caution", word: "Adjust", sentence: `${toGo}. Your body says ease off (${state.reasons[0]}): the next days can be adapted.` };
  }
  if (c.due >= 3 && c.done / c.due < 0.6) {
    return { status: "caution", word: "Behind", sentence: `${toGo}; ${doneText}. Don't cram the missed ones: pick up from today.` };
  }
  if (phaseNow === "taper") return { status: "good", word: "Taper", sentence: `${toGo}. Lighter weeks now: stay sharp and rested.` };
  return { status: "good", word: "On track", sentence: `${toGo}, ${phaseNow ?? "base"} phase; ${doneText}.` };
}

/** The active plan against the Garmin data, as of `now`; null when there's no plan. */
export function planView(db: Database.Database | null, garmin: Garmin, now: Date): PlanView | null {
  const plan = db && S.activePlan(db);
  if (!db || !plan) return null;
  const today = localToday(now);
  const state = buildProfile(garmin.daily, garmin.activities, today).state;
  const sessions = track(S.planSessions(db, plan.id), garmin.activities, today);
  const monday = mondayOf(today);
  const base = {
    plan, today, state, sessions,
    todays: sessions.filter((s) => s.date === today),
    next: sessions.find((s) => s.date > today) ?? null,
    thisWeek: sessions.filter((s) => s.date >= monday && s.date <= addDays(monday, 6)),
    weeks: weekSummaries(plan, sessions, garmin.activities),
    compliance14: compliance(sessions, today, 14),
    daysToEvent: plan.eventDate && plan.eventDate >= today ? daysBetween(today, plan.eventDate) : null,
    phaseNow: plan.phases.find((p) => p.start <= today && p.end >= today)?.phase ?? null,
    proposed: adaptations(sessions, state, today),
    changes: S.recentChanges(db, plan.id),
  };
  return { ...base, verdict: verdict(base) };
}

/** Adapt the next 7 days to the body's state (`apply: false` previews). */
export function adaptPlan(db: Database.Database, garmin: Garmin, now: Date, apply: boolean) {
  const plan = S.activePlan(db);
  if (!plan) throw new PlanError("There's no active plan.");
  const today = localToday(now);
  const state = buildProfile(garmin.daily, garmin.activities, today).state;
  const changes = adaptations(S.planSessions(db, plan.id), state, today);
  if (apply) S.applyChanges(db, plan.id, changes, now);
  return { state, changes, applied: apply };
}

// --- edits ---

export type Edit =
  | { op: "update"; id: number; date?: string; title?: string; description?: string; durationMin?: number;
      distanceKm?: number | null; intensity?: Intensity; discipline?: Discipline; note?: string }
  | { op: "add"; date: string; title: string; description: string; discipline: Discipline; intensity: Intensity;
      durationMin: number; distanceKm?: number | null; note?: string }
  | { op: "remove"; id: number }
  | { op: "status"; id: number; status: "planned" | "done" | "skipped" };

/** Apply edits to the active plan's sessions in one transaction; returns what changed. */
export function editSessions(db: Database.Database, edits: Edit[], now: Date): string[] {
  const plan = S.activePlan(db);
  if (!plan) throw new PlanError("There's no active plan.");
  const monday0 = mondayOf(plan.startDate);
  const place = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < plan.startDate || date > plan.endDate) {
      throw new PlanError(`${date} is outside the plan (${plan.startDate} to ${plan.endDate}).`);
    }
    return {
      week: Math.floor(daysBetween(monday0, date) / 7) + 1,
      phase: plan.phases.find((p) => p.start <= date && p.end >= date)?.phase ?? "base",
    };
  };
  const own = (id: number) => {
    const s = S.getSession(db, id);
    if (!s || s.planId !== plan.id) throw new PlanError(`Session ${id} isn't in the active plan.`);
    return s;
  };
  const done: string[] = [];
  db.transaction(() => {
    for (const e of edits) {
      if (e.op === "add") {
        const s: Session = {
          date: e.date, ...place(e.date), role: "extra", discipline: e.discipline, kind: "custom", intensity: e.intensity,
          title: e.title, description: e.description, durationMin: Math.round(e.durationMin), distanceKm: e.distanceKm ?? null,
        };
        const id = S.addSession(db, plan.id, s, e.note ?? null);
        done.push(`added ${e.date} ${e.title} (session ${id})`);
      } else if (e.op === "remove") {
        const s = own(e.id);
        S.setSessionStatus(db, e.id, "removed");
        done.push(`removed ${s.date} ${s.title}`);
      } else if (e.op === "status") {
        const s = own(e.id);
        S.setSessionStatus(db, e.id, e.status);
        done.push(`marked ${s.date} ${s.title} ${e.status}`);
      } else {
        const s = own(e.id);
        const date = e.date ?? s.date;
        const next: Session = {
          ...s, ...place(date), date,
          title: e.title ?? s.title, description: e.description ?? s.description,
          durationMin: e.durationMin != null ? Math.round(e.durationMin) : s.durationMin,
          distanceKm: e.distanceKm !== undefined ? e.distanceKm : s.distanceKm,
          intensity: e.intensity ?? s.intensity, discipline: e.discipline ?? s.discipline,
          // rewritten by hand: the generated details no longer describe it
          blocks: e.description != null || e.discipline != null ? undefined : s.blocks,
        };
        S.updateSession(db, e.id, next, "edit", e.note ?? s.note);
        done.push(`updated ${s.date} ${s.title}${date !== s.date ? ` → ${date}` : ""}${next.title !== s.title ? ` as ${next.title}` : ""}`);
      }
    }
    S.logChange(db, plan.id, "edit", done.join("; "), now);
  })();
  return done;
}
