/** Shapes shared by the training-plan engine, its store, the app and the MCP server. */

import type { ActivityGroup } from "../analytics.ts";
import type { Paces } from "./paces.ts";

export const GOALS = ["5k", "10k", "half_marathon", "marathon", "hyrox", "crossfit", "general_fitness"] as const;
export type Goal = (typeof GOALS)[number];

export const GOAL_LABELS: Record<Goal, string> = {
  "5k": "5K",
  "10k": "10K",
  half_marathon: "Half marathon",
  marathon: "Marathon",
  hyrox: "HYROX",
  crossfit: "CrossFit",
  general_fitness: "General fitness",
};

export type Discipline = "run" | "hyrox" | "crossfit" | "strength" | "conditioning" | "mobility" | "race";
export type Intensity = "easy" | "moderate" | "hard";
export type Phase = "base" | "build" | "peak" | "taper";

/** Mon=0 … Sun=6. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Another event inside the plan, e.g. a tune-up race. */
export interface PlanEvent {
  name: string;
  date: string;
  goal?: Goal;
}

/** What the athlete asks for. */
export interface PlanInput {
  goal: Goal;
  /** e.g. "Berlin Half" or "Spring HYROX". */
  name: string;
  /** The main event; the plan peaks and tapers into it. Without one the plan runs `weeks` weeks. */
  eventDate?: string;
  weeks?: number;
  /** First day of the plan (default: tomorrow). */
  startDate?: string;
  /** Training days per week, 3–7. */
  daysPerWeek: number;
  /** Day for the long session (default Saturday). */
  longDay?: Weekday;
  /** Longest session on other days, in minutes (default 75). */
  maxSessionMin?: number;
  /** Goal finish time, 'h:mm:ss' (races and HYROX). */
  targetTime?: string;
  otherEvents?: PlanEvent[];
  notes?: string;
}

/** How the body is doing right now, from the same rules as the dashboard's verdicts. */
export interface BodyState {
  level: "ready" | "normal" | "caution" | "recover";
  /** Why, in plain words. */
  reasons: string[];
  day: string | null;
  readinessScore: number | null;
  readinessLevel: string | null;
  acwr: number | null;
  rhrCreepBpm: number | null;
  hrvBelowBaseline: boolean;
  sleepScore7: number | null;
  sleepHours7: number | null;
  /** Days since the newest day with data (the watch may not have uploaded). */
  staleDays: number | null;
}

/** What the athlete's Garmin history says they can do now. */
export interface Profile {
  asOf: string | null;
  /** Average weekly training over the last 4 and 12 weeks. */
  weeklyMinutes4: number;
  weeklyMinutes12: number;
  sessionsPerWeek4: number;
  runKmPerWeek4: number;
  runKmPerWeek12: number;
  longestRunKm8: number;
  /** Share of training hours by activity group over the last 12 weeks. */
  mix: Record<ActivityGroup, number>;
  vo2max: number | null;
  /** VO₂max change over the last 90 days. */
  vo2maxTrend: number | null;
  restingHr: number | null;
  maxHr: number | null;
  paces: Paces | null;
  state: BodyState;
}

/** One line of a workout: an exercise, a run segment or a station. */
export interface Step {
  name: string;
  /** Sets or repeats, e.g. 3 (sets of squats) or 6 (× 800 m). */
  sets?: number;
  /** Each set: reps ("8", "8/leg") or a size ("60 s", "800 m", "20 min"). */
  reps?: string;
  /** How hard: a pace, RPE or load. */
  target?: string;
  /** Between sets or repeats. */
  rest?: string;
  note?: string;
}

/** A part of a workout: warm-up, main set, rounds, cool-down. */
export interface Block {
  title: string;
  /** Go through the steps this many times. */
  rounds?: number;
  steps: Step[];
  note?: string;
}

export interface Session {
  date: string;
  /** Week of the plan, from 1. */
  week: number;
  phase: Phase;
  /** Slot in the week: long, quality, strength, easy… */
  role: string;
  discipline: Discipline;
  kind: string;
  intensity: Intensity;
  title: string;
  description: string;
  durationMin: number;
  distanceKm: number | null;
  /** The workout in detail. Missing on hand-written sessions and plans from before it existed. */
  blocks?: Block[];
}

export interface PhaseSpan {
  phase: Phase;
  start: string;
  end: string;
}

export interface GeneratedPlan {
  input: PlanInput;
  startDate: string;
  endDate: string;
  phases: PhaseSpan[];
  /** Why the plan looks the way it does, in plain words. */
  notes: string[];
  sessions: Session[];
}
