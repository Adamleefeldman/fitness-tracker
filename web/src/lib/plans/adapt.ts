/**
 * Keeping a plan honest against the Garmin data:
 *
 *   adherence  which planned sessions a recorded activity covers (same day, or a
 *              day either side), and which were missed
 *   adaptation easier versions of the coming days when the body state says
 *              recover or caution, and the original sessions back once it doesn't
 *
 * Adaptation is idempotent: it always starts from each session as generated,
 * so running it twice changes nothing, and a better state undoes it. Sessions
 * the athlete (or Claude) edited by hand are left alone.
 */

import * as A from "../analytics.ts";
import type { Activity } from "../types.ts";
import { addDays, daysBetween } from "./profile.ts";
import type { Block, BodyState, Discipline, Intensity, Session } from "./types.ts";

/** A session as stored: an id, how it's going, and the generated original. */
export interface PlannedSession extends Session {
  id: number;
  /** planned, or set by hand: done | skipped. */
  status: "planned" | "done" | "skipped";
  /** Who last changed it: the generator, adaptation, or a manual edit. */
  source: "plan" | "adapt" | "edit";
  note: string | null;
  original: Session;
}

export type Outcome = "done" | "missed" | "skipped" | "today" | "upcoming";

export interface Tracked extends PlannedSession {
  outcome: Outcome;
  /** The Garmin activity that covered it. */
  activity: { id: number; date: string; type: string | null; minutes: number; km: number | null } | null;
}

/** Which activity groups count as doing a session of each discipline. */
const MATCHES: Record<Discipline, A.ActivityGroup[]> = {
  run: ["Running"],
  race: ["Running", "HIIT", "Strength", "Other"],
  hyrox: ["HIIT", "Other", "Strength"],
  crossfit: ["HIIT", "Strength", "Other"],
  strength: ["Strength", "HIIT"],
  conditioning: ["HIIT", "Other", "Running"],
  mobility: ["Other"],
};

/** Groups that count for a session; a run counts for HYROX's running sessions too. */
const groupsFor = (s: Session): A.ActivityGroup[] =>
  s.discipline === "hyrox" && /run|simulation/.test(s.kind) ? [...MATCHES.hyrox, "Running"] : MATCHES[s.discipline];

/** Mobility is optional: it never counts as missed. */
const optional = (s: Session) => s.discipline === "mobility";

export function track(sessions: PlannedSession[], activities: Activity[], today: string): Tracked[] {
  const used = new Set<number>();
  const acts = activities.filter((a) => a.date != null);
  const find = (s: PlannedSession, offsets: number[]) => {
    for (const off of offsets) {
      const day = addDays(s.date, off);
      const hit = acts.find((a) => a.date === day && !used.has(a.activity_id) &&
        groupsFor(s).includes(A.activityGroup(a.activity_type)));
      if (hit) return hit;
    }
    return undefined;
  };
  // same-day matches first, so a neighbour's activity can't steal one
  const matched = new Map<number, Activity>();
  for (const pass of [[0], [-1, 1]]) {
    for (const s of sessions) {
      if (matched.has(s.id) || s.date > today || s.status === "skipped") continue;
      const hit = find(s, pass);
      if (hit) { matched.set(s.id, hit); used.add(hit.activity_id); }
    }
  }
  return sessions.map((s) => {
    const a = matched.get(s.id);
    const outcome: Outcome = s.status === "skipped" ? "skipped"
      : a || s.status === "done" ? "done"
      : s.date === today ? "today"
      : s.date > today ? "upcoming"
      : "missed";
    return {
      ...s, outcome,
      activity: a ? {
        id: a.activity_id, date: a.date!, type: a.activity_type,
        minutes: Math.round((a.duration_s ?? 0) / 60), km: a.distance_km == null ? null : Math.round(a.distance_km * 10) / 10,
      } : null,
    };
  });
}

/** Done and due sessions over the days before `today` (mobility doesn't count). */
export function compliance(tracked: Tracked[], today: string, days: number) {
  const from = addDays(today, -days);
  const due = tracked.filter((s) => s.date >= from && s.date < today && !optional(s));
  return { done: due.filter((s) => s.outcome === "done").length, due: due.length };
}

// --- adaptation ---

export interface Change {
  id: number;
  date: string;
  before: string;
  after: string;
  reason: string;
  /** The session to store; for a restore, the original. */
  session: Session;
  source: "plan" | "adapt";
}

const r5 = (m: number) => Math.max(15, Math.round(m / 5) * 5);

/** The easy pace range a run's workout already uses ("4:57–5:27/km"), if any. */
const easyPaceOf = (s: Session) =>
  s.blocks?.flatMap((b) => b.steps).find((st) => /^Easy (running|jog)/.test(st.name) && /^\d+:\d\d–\d+:\d\d\/km$/.test(st.target ?? ""))?.target;

/** An easy version of a session, keeping its discipline. */
function eased(s: Session, factor: number, why: string): Session {
  const minutes = r5(s.durationMin * factor);
  const easy: Record<Discipline, [string, string]> = {
    run: ["Easy run", `${minutes} min easy at conversational pace.`],
    race: [s.title, s.description],
    hyrox: ["Easy engine", `${minutes} min steady on the rower or bike (RPE 4), then mobility.`],
    crossfit: ["Easy engine", `${minutes} min steady on the rower or bike (RPE 4), then mobility.`],
    conditioning: ["Easy cardio", `${minutes} min easy (RPE 4).`],
    strength: ["Light strength", "Technique sets at about 60%, nothing to failure, then mobility."],
    mobility: [s.title, s.description],
  };
  const [title, description] = easy[s.discipline];
  const steps: Record<Discipline, Block[] | undefined> = {
    run: [{ title: "Run", steps: [{ name: "Easy running", reps: `${minutes} min`, target: easyPaceOf(s) ?? "conversational" }] }],
    race: s.blocks,
    hyrox: [{ title: "Engine", steps: [{ name: "Rower or bike", reps: `${minutes} min`, target: "steady (RPE 4)" }, { name: "Mobility", reps: "10 min" }] }],
    crossfit: [{ title: "Engine", steps: [{ name: "Rower or bike", reps: `${minutes} min`, target: "steady (RPE 4)" }, { name: "Mobility", reps: "10 min" }] }],
    conditioning: [{ title: "Session", steps: [{ name: "Easy cardio", reps: `${minutes} min`, target: "easy (RPE 4)" }] }],
    // the same exercises, light
    strength: s.blocks?.map((b) => ({
      ...b, note: "Technique sets at about 60%, nothing to failure, then mobility.",
      steps: b.steps.map((st) => (st.sets ? { ...st, sets: Math.min(st.sets, 2), target: "light (about 60%)" } : st)),
    })),
    mobility: s.blocks,
  };
  return {
    ...s, title, intensity: "easy", durationMin: minutes,
    distanceKm: s.distanceKm == null ? null : Math.round(s.distanceKm * factor * 2) / 2,
    kind: s.kind.endsWith("_eased") ? s.kind : `${s.kind}_eased`,
    description: `Eased because ${why}. ${description}`,
    blocks: steps[s.discipline],
  };
}

/** A gentler version of a hard session: same session, trimmed. */
function softened(s: Session, why: string): Session {
  return {
    ...s, intensity: "moderate" as Intensity, durationMin: r5(s.durationMin * 0.8),
    distanceKm: s.distanceKm == null ? null : Math.round(s.distanceKm * 0.8 * 2) / 2,
    title: `${s.title} (lighter)`,
    description: `Lighter because ${why}: drop the last quarter of the main set and stay at the easy end of the paces. ${s.description}`,
    // a quarter fewer repeats, and a reminder on the parts that are just a size
    blocks: s.blocks?.map((b) => ({
      ...b,
      rounds: b.rounds && b.rounds > 1 ? Math.max(1, Math.round(b.rounds * 0.75)) : b.rounds,
      steps: b.steps.map((st) => (st.sets && st.sets > 1 ? { ...st, sets: Math.max(1, Math.round(st.sets * 0.75)) } : st)),
      note: /warm-up|cool-down/i.test(b.title) ? b.note : "Lighter today: stay at the easy end of the paces.",
    })),
  };
}

const restDay = (s: Session, why: string): Session => ({
  ...s, discipline: "mobility", kind: "rest", intensity: "easy", title: "Rest",
  description: `Rest today because ${why}. A walk or 15 min of mobility at most.`, durationMin: 15, distanceKm: null,
  blocks: [{ title: "Rest", steps: [{ name: "A walk or easy mobility", reps: "15 min at most" }] }],
});

const same = (a: Session, b: Session) =>
  a.title === b.title && a.intensity === b.intensity && a.durationMin === b.durationMin && a.description === b.description;

/**
 * The changes adaptation would make to the next 7 days for this body state.
 * Race days, the days just before a race, and hand-edited sessions are left alone.
 */
export function adaptations(sessions: PlannedSession[], state: BodyState, today: string): Change[] {
  const end = addDays(today, 6);
  const raceDays = sessions.filter((s) => s.discipline === "race").map((s) => s.date);
  const nearRace = (d: string) => raceDays.some((r) => daysBetween(d, r) >= 0 && daysBetween(d, r) <= 2);
  const upcoming = sessions
    .filter((s) => s.date >= today && s.date <= end && s.status === "planned" && s.source !== "edit"
      && s.discipline !== "race" && !nearRace(s.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const why = state.reasons[0] ?? "of how you're recovering";
  // stale data says nothing about today: only undo earlier adaptations
  const level = state.staleDays != null && state.staleDays > 2 ? "normal" : state.level;
  const poor = ["POOR", "VERY_LOW"].includes((state.readinessLevel ?? "").toUpperCase());

  const target = new Map<number, Session>();
  let hardLeft = 1;
  let softenedOne = false;
  for (const s of upcoming) {
    const o = s.original;
    const day = daysBetween(today, s.date);
    let t: Session = o;
    if (level === "recover") {
      if (day === 0 && poor) t = restDay(o, why);
      else if (day <= 2 && o.intensity !== "easy") t = eased(o, 0.6, why);
      else if (o.intensity === "hard") t = hardLeft-- > 0 ? o : softened(o, why);
    } else if (level === "caution" && !softenedOne && day <= 1 && o.intensity === "hard") {
      t = softened(o, why);
      softenedOne = true;
    }
    target.set(s.id, t);
  }

  const changes: Change[] = [];
  for (const s of upcoming) {
    const t = target.get(s.id)!;
    if (same(s, t)) continue;
    const restoring = same(t, s.original);
    changes.push({
      id: s.id, date: s.date, before: s.title, after: t.title,
      reason: restoring ? "back to the plan: no warning signs now" : why,
      session: t, source: restoring ? "plan" : "adapt",
    });
  }
  return changes;
}
