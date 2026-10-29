/**
 * Builds a periodised training plan from a goal and the athlete's profile.
 *
 * Deterministic and rule-based, like the verdicts: the same input and data
 * always give the same plan, and every choice is explained in `notes`.
 *
 *   phases     base → build → peak → taper into the event (base → build without one)
 *   volume     starts from the last 4–12 weeks of Garmin training (or the least the
 *              chosen days need), lighter when the body state says so; grows ≤ 8% a
 *              week (running km ≤ 10%); every 4th week is a lighter deload; the taper
 *              cuts volume but keeps some intensity
 *   sessions   sized from the week's volume, so deloads and tapers shrink every session;
 *              about two hard sessions a week, never on consecutive days
 *   paces      from Garmin's running VO₂max (Daniels' VDOT model)
 */

import {
  formatDuration, formatPace, paces as pacesFor, parseDuration, RACE_METERS, raceTime, vdotFromRace, type Paces,
} from "./paces.ts";
import { addDays, daysBetween } from "./profile.ts";
import {
  GOAL_LABELS, WEEKDAYS,
  type Discipline, type GeneratedPlan, type Goal, type Intensity, type Phase, type PhaseSpan, type PlanInput,
  type Profile, type Session, type Weekday,
} from "./types.ts";

export class PlanError extends Error {}

interface GoalSpec {
  /** Fewest weeks for a sensible plan; shorter plans are compressed (and say so). */
  minWeeks: number;
  taperWeeks: number;
  /** Weekly minutes a full plan aims to peak at. */
  peakMinutes: number;
  /** Running goals: weekly km a full plan peaks near, and the longest long run. */
  peakKm?: number;
  longRunCapKm?: number;
  /** Minute-based goals: the longest the long session gets. */
  longCapMin?: number;
}

export const GOAL_SPECS: Record<Goal, GoalSpec> = {
  "5k": { minWeeks: 4, taperWeeks: 1, peakMinutes: 240, peakKm: 35, longRunCapKm: 12 },
  "10k": { minWeeks: 6, taperWeeks: 1, peakMinutes: 280, peakKm: 45, longRunCapKm: 16 },
  half_marathon: { minWeeks: 8, taperWeeks: 2, peakMinutes: 330, peakKm: 50, longRunCapKm: 20 },
  marathon: { minWeeks: 12, taperWeeks: 3, peakMinutes: 420, peakKm: 70, longRunCapKm: 32 },
  hyrox: { minWeeks: 8, taperWeeks: 1, peakMinutes: 360, longCapMin: 75 },
  crossfit: { minWeeks: 6, taperWeeks: 1, peakMinutes: 360, longCapMin: 75 },
  general_fitness: { minWeeks: 4, taperWeeks: 1, peakMinutes: 240, longCapMin: 90 },
};

const isRunGoal = (g: Goal): g is keyof typeof RACE_METERS => g in RACE_METERS;

const MINUTES_GROWTH = 1.08;
const KM_GROWTH = 1.1;
const LONG_RUN_STEP_KM = 1.5;
const DELOAD = 0.75;
const TAPER: Record<number, number[]> = { 1: [0.55], 2: [0.75, 0.5], 3: [0.85, 0.7, 0.5] };
const STATE_START: Record<Profile["state"]["level"], number> = { recover: 0.75, caution: 0.9, normal: 1, ready: 1 };
const MAX_WEEKS = 40;

type Role = "long" | "q1" | "q2" | "strength" | "easy1" | "easy2" | "recovery";

/**
 * A week's slots for each number of training days, as offsets from the long
 * day. The hard slots (q1, q2) sit two days apart, never next to each other or
 * to the long day.
 */
const LAYOUT: Record<number, [Role, number][]> = {
  3: [["long", 0], ["q1", -4], ["easy1", -2]],
  4: [["long", 0], ["q1", -4], ["easy1", -2], ["strength", -5]],
  5: [["long", 0], ["q1", -4], ["q2", -2], ["strength", -5], ["easy1", -3]],
  6: [["long", 0], ["q1", -4], ["q2", -2], ["strength", -5], ["easy1", -3], ["easy2", 1]],
  7: [["long", 0], ["q1", -4], ["q2", -2], ["strength", -5], ["easy1", -3], ["easy2", 1], ["recovery", -1]],
};

/** Running goals: each run's share of the week's km, and its smallest and largest size. */
const RUN_SHARE: Partial<Record<Role, number>> = { q1: 0.22, q2: 0.2, easy1: 0.15, easy2: 0.13 };
const RUN_MIN_KM: Partial<Record<Role, number>> = { long: 6, q1: 6, q2: 5, easy1: 4, easy2: 4 };
const RUN_MAX_KM: Partial<Record<Role, number>> = { q1: 18, q2: 20, easy1: 14, easy2: 14 };
const WARM_COOL_KM = 3.5;

/** Other goals: each slot's share of the week's minutes. */
const MINUTE_SHARE: Record<Role, number> = { long: 0.22, q1: 0.2, q2: 0.18, strength: 0.16, easy1: 0.12, easy2: 0.12, recovery: 0.05 };
const MIN_SESSION = 25;

interface WeekPlan {
  index: number; // from 0
  monday: string;
  phase: Phase;
  phaseWeek: number; // from 1
  deload: boolean;
  /** Volume relative to the starting week. */
  level: number;
  kmLevel: number;
  longKm: number;
}

interface PaceCtx {
  paces: Paces;
  /** False when there's no VO₂max: descriptions use effort instead of pace. */
  hasPaces: boolean;
}

interface Ctx extends PaceCtx {
  goal: Goal;
  profile: Profile;
  /** Race pace for the goal distance (s/km): the target if given, else the prediction. */
  racePace: number | null;
  week: WeekPlan;
  /** Through the build, 0 → 1. */
  progress: number;
  /** HYROX or CrossFit race practice this week, if any. */
  special: "full_sim" | "half_sim" | null;
  maxMin: number;
  /** Running goals: km for each run slot. Other goals: minutes for each slot. */
  km: Partial<Record<Role, number>>;
  minutes: Partial<Record<Role, number>>;
  /** Is easy2 cross-training rather than a run (running goals)? */
  crossTraining: boolean;
  /** Training days per week, so short weeks can combine sessions. */
  days: number;
}

interface Spec {
  discipline: Discipline;
  kind: string;
  intensity: Intensity;
  title: string;
  description: string;
  durationMin: number;
  distanceKm: number | null;
}

// --- helpers ---

const r5 = (min: number) => Math.max(10, Math.round(min / 5) * 5);
const halfKm = (km: number) => Math.max(1, Math.round(km * 2) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * clamp(t, 0, 1));

function pace(ctx: Ctx, key: "marathon" | "threshold" | "interval" | "repetition" | "race", effort: string) {
  if (key === "race") return ctx.racePace ? formatPace(ctx.racePace) : effort;
  return ctx.hasPaces ? formatPace(ctx.paces[key]) : effort;
}

function easyPace(p: PaceCtx) {
  if (!p.hasPaces) return "conversational effort (RPE 3–4)";
  const [slow, fast] = p.paces.easy;
  return `${formatDuration(fast)}–${formatPace(slow)}`;
}

const easyMinPerKm = (p: PaceCtx) => (p.paces.easy[0] + p.paces.easy[1]) / 2 / 60;

function easyRun(p: PaceCtx, km: number, title = "Easy run", extra = ""): Spec {
  const d = halfKm(km);
  return {
    discipline: "run", kind: "easy_run", intensity: "easy", title,
    description: `${d} km at ${easyPace(p)}${extra}`,
    durationMin: r5(d * easyMinPerKm(p)), distanceKm: d,
  };
}

/** A quality run: warm-up, the main set (`mainKm` taking `mainMin` minutes), cool-down. */
function workout(ctx: Ctx, kind: string, title: string, main: string, mainKm: number, mainMin: number,
  intensity: Intensity = "hard"): Spec {
  return {
    discipline: "run", kind, intensity, title,
    description: `2 km easy warm-up, then ${main}, then 1.5 km easy cool-down`,
    durationMin: r5(mainMin + WARM_COOL_KM * easyMinPerKm(ctx)), distanceKm: halfKm(mainKm + WARM_COOL_KM),
  };
}

function timed(discipline: Discipline, kind: string, intensity: Intensity, title: string, description: string,
  minutes: number): Spec {
  return { discipline, kind, intensity, title, description, durationMin: r5(minutes), distanceKm: null };
}

const mobility = (minutes = 25): Spec => timed("mobility", "mobility", "easy", "Mobility & recovery",
  "Easy mobility, foam rolling or a relaxed walk. Keep it restful.", minutes);

/** Repeats that add up to about `km`: the largest rep length giving a count in [lo, hi]. */
function reps(km: number, lengths: number[], lo: number, hi: number) {
  for (const len of lengths) {
    const n = Math.round(km / len);
    if (n >= lo && n <= hi) return { n, len };
  }
  const len = lengths.at(-1)!;
  return { n: clamp(Math.round(km / len), lo, hi), len };
}

const km1 = (len: number) => (len >= 1 ? `${len} km` : `${Math.round(len * 1000)} m`);

// --- running goals ---

function runSession(role: Role, ctx: Ctx): Spec {
  const { phase } = ctx.week;
  const g = ctx.goal as keyof typeof RACE_METERS;
  const t = ctx.progress;
  const short = g === "5k" || g === "10k";
  const T = pace(ctx, "threshold", "comfortably hard (RPE 7)");
  const I = pace(ctx, "interval", "hard (RPE 8–9)");
  const R = pace(ctx, "repetition", "fast and relaxed");
  // steady running sits between threshold and race pace, never slower than a conservative target
  const steady = ctx.racePace && g === "half_marathon" ? Math.max(ctx.paces.marathon, ctx.racePace + 10) : ctx.paces.marathon;
  const M = ctx.hasPaces ? formatPace(steady) : "steady (RPE 6)";
  const RP = pace(ctx, "race", "goal race effort");
  const minPer = (key: "threshold" | "interval" | "marathon") => (key === "marathon" ? steady : ctx.paces[key]) / 60;
  const rpMin = (ctx.racePace ?? ctx.paces.threshold) / 60;
  const total = ctx.km[role] ?? 0;
  // the main set gets whatever the weekday limit leaves after warm-up and cool-down
  const budget = ctx.maxMin - WARM_COOL_KM * easyMinPerKm(ctx) - 5;
  const main = Math.max(2.5, Math.min(total - WARM_COOL_KM, budget / (ctx.paces.threshold / 60) * 0.85));
  const fit = (n: number, perRep: number, lo: number) => Math.max(lo, Math.min(n, Math.floor(budget / perRep)));

  switch (role) {
    case "long": {
      if (phase === "peak" && !short) {
        const fast = Math.min(g === "marathon" ? lerp(6, 12, t) : lerp(3, 6, t), Math.floor(total * 0.4));
        return { ...easyRun(ctx, total, "Long run", `, with the last ${fast} km at ${g === "marathon" ? M : RP}`),
          kind: "long_run", intensity: "moderate" };
      }
      if (phase === "build" && g === "marathon") {
        const fast = Math.min(lerp(3, 6, t), Math.floor(total * 0.3));
        return { ...easyRun(ctx, total, "Long run", `, finishing the last ${fast} km at ${M}`),
          kind: "long_run", intensity: "moderate" };
      }
      return { ...easyRun(ctx, total, "Long run"), kind: "long_run" };
    }
    case "q1": {
      if (phase === "base") {
        const n = fit(clamp(Math.round(main / 0.4), 6, 12), 3, 6);
        return workout(ctx, "hills", "Hill repeats", `${n}× 60 s uphill hard, jogging back down`, main, n * 3);
      }
      if (phase === "taper") return workout(ctx, "sharpener", "Sharpener", `4× 400 m at ${R}, full recovery`, 1.6, 10);
      if (phase === "build") {
        if (short) {
          const r = g === "5k" ? reps(main, [0.8], 4, 8) : reps(main, [1, 0.8], 3, 6);
          const { len } = r;
          const n = fit(r.n, len * minPer("interval") + 2.5, 3);
          return workout(ctx, "intervals", "VO₂max intervals", `${n}× ${km1(len)} at ${I}, 2–3 min jog between`,
            n * len, n * (len * minPer("interval") + 2.5));
        }
        const each = clamp(Math.round((main * minPer("threshold")) / 3), 5, 15);
        return workout(ctx, "threshold", "Threshold intervals", `3× ${each} min at ${T}, 2 min jog between`,
          (3 * each) / minPer("threshold"), 3 * each + 4);
      }
      // peak: race-specific
      if (g === "marathon") {
        const each = clamp(Math.round((main * minPer("threshold")) / 2), 10, 20);
        return workout(ctx, "threshold", "Threshold", `2× ${each} min at ${T}, 3 min jog between`,
          (2 * each) / minPer("threshold"), 2 * each + 3);
      }
      const r = g === "5k" ? reps(main, [1, 0.8], 3, 6)
        : g === "10k" ? reps(main, [2, 1.5, 1], 3, 5)
        : reps(main, [3, 2, 1.5], 2, 4);
      const { len } = r;
      const n = fit(r.n, len * rpMin + 2.5, 2);
      return workout(ctx, "race_pace", `${GOAL_LABELS[g]} pace reps`, `${n}× ${km1(len)} at ${RP}, 2–3 min jog between`,
        n * len, n * (len * rpMin + 2.5));
    }
    case "q2": {
      if (phase === "base") return easyRun(ctx, total, "Easy run + strides", ", then 6× 20 s strides on flat ground");
      if (phase === "taper") return easyRun(ctx, Math.min(total, 6), "Easy run + strides", ", then 4× 20 s strides");
      if (g === "marathon") {
        const k = clamp(Math.round(main), 4, 16);
        return workout(ctx, "marathon_pace", "Marathon-pace run", `${k} km at ${RP}`, k, k * rpMin);
      }
      if (g === "half_marathon" && phase === "build") {
        const k = clamp(Math.round(main), 3, 12);
        return workout(ctx, "steady", "Steady run", `${k} km at ${M}`, k, k * minPer("marathon"), "moderate");
      }
      if (phase === "peak") {
        const each = clamp(Math.round((main * minPer("threshold")) / 2), 6, 15);
        return workout(ctx, "threshold", "Threshold", `2× ${each} min at ${T}, 2 min jog between`,
          (2 * each) / minPer("threshold"), 2 * each + 2);
      }
      const mins = clamp(Math.round(main * minPer("threshold")), 12, 30);
      return workout(ctx, "tempo", "Tempo run", `${mins} min at ${T}`, mins / minPer("threshold"), mins);
    }
    case "strength":
      if (phase === "taper") return mobility(20);
      return phase === "peak" || ctx.week.deload
        ? timed("strength", "strength", "moderate", "Strength (maintenance)",
          "2 sets each: squats ×8, Romanian deadlifts ×8, split squats ×8/leg, calf raises ×15, plank 40 s.", 30)
        : timed("strength", "strength", "moderate", "Strength for runners",
          "3 sets each: squats ×8, Romanian deadlifts ×8, split squats ×8/leg, calf raises ×15, plank & side plank 40 s.", 40);
    case "easy1":
      return easyRun(ctx, total);
    case "easy2":
      // keep a HIIT habit the data shows, as controlled cross-training
      return ctx.crossTraining
        ? timed("conditioning", "cross_training", "moderate", "Cross-training (your HIIT, kept controlled)",
          "A HIIT class or circuit at RPE ≤ 7: skip the all-out finishers so the next run stays good. An easy run works too.",
          Math.min(45, ctx.maxMin))
        : easyRun(ctx, total);
    case "recovery":
      return mobility();
  }
}

// --- HYROX ---

const STATIONS = [
  "1 km SkiErg", "50 m sled push", "50 m sled pull", "80 m burpee broad jumps",
  "1 km row", "200 m farmers carry", "100 m sandbag lunges", "100 wall balls",
];

/** One station, scaled down for training rounds. */
const STATION_ROUNDS = [
  "250 m SkiErg", "25 m sled push", "25 m sled pull", "20 m burpee broad jumps",
  "250 m row", "50 m farmers carry", "25 m sandbag lunges", "25 wall balls",
];

function hyroxSession(role: Role, ctx: Ctx): Spec {
  const { phase, index } = ctx.week;
  const m = ctx.minutes[role] ?? MIN_SESSION;
  const runPace = ctx.hasPaces ? formatPace(ctx.paces.threshold + 15) : "a strong, sustainable effort (RPE 7)";
  switch (role) {
    case "long":
      return { ...easyRun(ctx, m / easyMinPerKm(ctx), "Long aerobic run"), kind: "long_run" };
    case "q1": {
      if (ctx.special === "full_sim") {
        return timed("hyrox", "simulation", "hard", "Full HYROX simulation",
          `8 rounds: 1 km run at ${runPace} + one station, in race order (${STATIONS.join(", ")}). Race weights; practise transitions.`, 90);
      }
      if (ctx.special === "half_sim") {
        return timed("hyrox", "simulation", "hard", "Half HYROX simulation",
          `4 rounds: 1 km run at ${runPace} + ${STATIONS.slice(0, 4).join(", ")}. Race weights, race transitions.`, 50);
      }
      if (phase === "taper") {
        return timed("hyrox", "compromised_run", "moderate", "Race-pace primer",
          `4 rounds: 500 m run at ${runPace} + 15 wall balls, easy rest between. Stay sharp, not tired.`, Math.min(m, 35));
      }
      if (phase === "base") {
        const n = clamp(Math.floor((m - 20) / 6.5), 3, 8);
        return timed("run", "intervals", "hard", "Run intervals",
          `Warm up 10 min, then ${n}× 1 km at ${runPace} with 90 s rest. Cool down 10 min.`, 20 + n * 6.5);
      }
      const rounds = clamp(Math.floor((m - 15) / 10), 2, 6);
      const stations = [0, 1, 2, 3].map((k) => STATION_ROUNDS[(index * 2 + k) % 8]);
      return timed("hyrox", "compromised_run", "hard", "Compromised running",
        `Warm up 10 min, then ${rounds} rounds: 1 km at ${runPace}, straight into one station (rotate ${stations.join(" / ")}). ` +
        "Run off the station without slowing down.", 15 + rounds * 10);
    }
    case "q2": {
      if (phase === "taper") return mobility(25);
      const rounds = clamp(Math.floor((m - 10) / 9), 2, 6);
      const set = STATION_ROUNDS.slice(index % 2 ? 4 : 0, index % 2 ? 8 : 4).join(", ");
      return timed("hyrox", "stations", phase === "base" ? "moderate" : "hard", "Station endurance",
        `Warm up 10 min, then ${rounds} rounds: ${set}. ${phase === "base" ? "Smooth technique, steady pace." : "Race weights, minimal rest."}`,
        10 + rounds * 9);
    }
    case "strength":
      if (phase === "taper") return mobility(20);
      if (ctx.days <= 4) {
        return timed("hyrox", "strength_stations", "moderate", "Strength & stations",
          `Back squat 4×5 and deadlift 3×5, then ${phase === "base" ? 2 : 3} rounds: 25 m sled push, 25 m sled pull, ` +
          "50 m farmers carry, 20 wall balls. Smooth and controlled.", clamp(m, 45, 60));
      }
      return timed("strength", "strength", "moderate", "Strength",
        phase === "peak" || ctx.week.deload
          ? "Back squat 3×5, deadlift 3×3, push press 3×5, pull-ups 3×6, core. Heavy but crisp."
          : "Back squat 4×6, deadlift 3×5, walking lunges 3×20 m, push press 3×8, pull-ups 3×8, core.", clamp(m, 35, 50));
    case "easy1":
      if (ctx.days === 3) return hyroxSession("strength", ctx);
      return timed("conditioning", "engine", "easy", "Engine",
        `${r5(m)} min steady on the rower, SkiErg or bike (RPE 5), in 3–4 blocks.`, m);
    case "easy2":
      return easyRun(ctx, Math.max(4, m / easyMinPerKm(ctx)));
    case "recovery":
      return mobility();
  }
}

// --- CrossFit ---

const METCONS = [
  "AMRAP 15: 10 wall balls, 10 box jumps, 10 kettlebell swings",
  "For time: 21-15-9 thrusters and pull-ups",
  "EMOM 20: 12 cal row / 10 burpees / 8 power cleans / rest",
  "AMRAP 12: 5 pull-ups, 10 push-ups, 15 air squats",
  "5 rounds for time: 400 m run, 15 overhead squats",
  "For time: 50 double-unders, 40 kettlebell swings, 30 box jumps, 20 toes-to-bar, 10 cleans",
  "AMRAP 18: 6 deadlifts, 9 hang power cleans, 12 push jerks",
  "3 rounds: 1 min each of row, burpees, wall balls, toes-to-bar, then rest 1 min",
];

const LIFTS = ["Back squat", "Deadlift", "Strict press + weighted pull-ups", "Front squat + push jerk technique"];

function crossfitSession(role: Role, ctx: Ctx): Spec {
  const { phase, index } = ctx.week;
  const m = ctx.minutes[role] ?? MIN_SESSION;
  switch (role) {
    case "long":
      return timed("conditioning", "engine", "moderate", "Engine",
        `${r5(m)} min mixed aerobic work (row, run, bike) at RPE 6. Keep it steady.`, m);
    case "q1": {
      if (ctx.special) {
        return timed("crossfit", "simulation", "hard", "Competition simulation",
          "Two benchmark workouts 90 minutes apart, scored. Warm up as you would on the day.", 75);
      }
      const wod = METCONS[index % METCONS.length];
      return phase === "taper"
        ? timed("crossfit", "metcon", "moderate", "Short metcon", `${wod}, capped at 8 minutes and done at 80% effort.`, Math.min(m, 35))
        : timed("crossfit", "metcon", "hard", "Metcon", `Warm up 15 min, then ${wod}. Cool down and stretch.`, m);
    }
    case "q2": {
      if (phase === "taper") return mobility(25);
      const n = clamp(Math.floor((m - 15) / 3), 4, 10);
      return timed("crossfit", "intervals", "hard", "Intervals",
        `Warm up 10 min, then ${n}× (2 min work / 1 min rest) mixed modal: row, burpees, dumbbell snatches. Hold the pace every round.`,
        15 + n * 3);
    }
    case "strength": {
      const lift = LIFTS[index % LIFTS.length];
      const scheme = ctx.week.deload ? "3×5 at about 65%, crisp and fast"
        : phase === "base" ? "5×5 at about 70–75%"
        : phase === "build" ? "5-3-1 building to a heavy single"
        : phase === "peak" ? "heavy doubles and singles"
        : "light technique sets";
      return timed("strength", "strength", phase === "taper" ? "easy" : "moderate", `Strength: ${lift}`,
        `${lift}: ${scheme}, then accessories (single-leg work, core).`, clamp(m, 30, 60));
    }
    case "easy1":
      if (ctx.days === 3) return crossfitSession("strength", ctx);
      return timed("crossfit", "skill", "easy", "Gymnastics skill",
        "Practice handstands, toes-to-bar or muscle-up drills, then light accessories. Quality over fatigue.", clamp(m, 25, 45));
    case "easy2":
      return timed("conditioning", "engine", "easy", "Easy aerobic", `${r5(m)} min easy bike, row or run (RPE 4).`, m);
    case "recovery":
      return mobility();
  }
}

// --- general fitness ---

function generalSession(role: Role, ctx: Ctx): Spec {
  const { phase } = ctx.week;
  const m = ctx.minutes[role] ?? MIN_SESSION;
  switch (role) {
    case "long":
      return timed("conditioning", "long_cardio", "easy", "Long easy cardio",
        `${r5(m)} min easy: run at ${easyPace(ctx)}, ride or hike.`, m);
    case "q1": {
      const n = clamp(Math.floor((m - 15) / 3), 4, 10);
      return timed("conditioning", "hiit", phase === "taper" ? "moderate" : "hard", "HIIT",
        `Warm up 10 min, then ${n} rounds of 40 s hard / 20 s easy, three times through with 2 min between. Cool down 5 min.`, m);
    }
    case "q2": {
      if (phase === "base" || phase === "taper") {
        return easyRun(ctx, m / easyMinPerKm(ctx), "Easy run + strides", ", then 6× 20 s strides");
      }
      const mins = clamp(Math.round(m - 20), 10, 30);
      const T = pace(ctx, "threshold", "comfortably hard (RPE 7)");
      return timed("run", "tempo", "hard", "Tempo run", `Warm up 10 min, then ${mins} min at ${T}, cool down 10 min.`, mins + 20);
    }
    case "strength":
      return timed("strength", "strength", "moderate", "Full-body strength",
        "3 sets each: goblet squats ×10, Romanian deadlifts ×10, push-ups ×10–15, rows ×10, split squats ×8/leg, plank 45 s.",
        clamp(m, 30, 50));
    case "easy1":
      if (ctx.days === 3) return generalSession("strength", ctx);
      return easyRun(ctx, m / easyMinPerKm(ctx));
    case "easy2":
      return timed("conditioning", "easy_cardio", "easy", "Easy cardio", `${r5(m)} min easy bike, swim or walk.`, m);
    case "recovery":
      return mobility();
  }
}

const BUILDERS: Record<Goal, (role: Role, ctx: Ctx) => Spec> = {
  "5k": runSession, "10k": runSession, half_marathon: runSession, marathon: runSession,
  hyrox: hyroxSession, crossfit: crossfitSession, general_fitness: generalSession,
};

// --- the plan ---

const weekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) as Weekday;
const mondayOf = (date: string) => addDays(date, -weekday(date));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function validate(input: PlanInput, today: string) {
  const fail = (msg: string) => { throw new PlanError(msg); };
  if (!Number.isInteger(input.daysPerWeek) || input.daysPerWeek < 3 || input.daysPerWeek > 7) {
    fail("Choose 3 to 7 training days a week.");
  }
  for (const [label, d] of [["eventDate", input.eventDate], ["startDate", input.startDate]] as const) {
    if (d != null && !isoDate.test(d)) fail(`${label} must be YYYY-MM-DD.`);
  }
  for (const e of input.otherEvents ?? []) if (!isoDate.test(e.date)) fail(`Event "${e.name}" needs a YYYY-MM-DD date.`);
  if (input.eventDate && input.eventDate <= (input.startDate ?? today)) fail("The event date must be after the plan starts.");
  if (!input.eventDate && input.weeks != null && (input.weeks < 1 || input.weeks > MAX_WEEKS)) {
    fail(`A plan without an event runs 1 to ${MAX_WEEKS} weeks.`);
  }
  if (input.targetTime && parseDuration(input.targetTime) == null) fail("Target time must look like 1:45:00 or 24:30.");
  if (input.maxSessionMin != null && (input.maxSessionMin < 30 || input.maxSessionMin > 240)) {
    fail("Longest weekday session should be 30 to 240 minutes.");
  }
}

/** Phase per week: taper into the event, then peak ≈ 25%, build ≈ 35%, base the rest. */
function phasesFor(weeks: number, taper: number, hasEvent: boolean): Phase[] {
  const rest = weeks - taper;
  let peak = 0;
  let build: number;
  if (!hasEvent) build = Math.round(rest * 0.6);
  else if (rest <= 2) build = rest;
  else {
    peak = Math.max(1, Math.round(rest * 0.25));
    build = Math.max(1, Math.round(rest * 0.35));
  }
  const base = rest - peak - build;
  return [
    ...Array<Phase>(base).fill("base"), ...Array<Phase>(build).fill("build"),
    ...Array<Phase>(peak).fill("peak"), ...Array<Phase>(taper).fill("taper"),
  ];
}

/** Running goals: whether the sixth day keeps the athlete's HIIT habit as cross-training. */
const keepsHiit = (goal: Goal, profile: Profile, days: number) => isRunGoal(goal) && days >= 6 && profile.mix.HIIT >= 0.3;

/** The least running a week can hold with every run slot at its smallest size. */
function floorKm(goal: Goal, days: number, cross: boolean) {
  return LAYOUT[days]
    .filter(([r]) => r in RUN_MIN_KM && !(r === "easy2" && cross))
    .reduce((km, [r]) => km + RUN_MIN_KM[r]!, 0);
}

/** Split the week's km across its run slots: the long run first, the rest by share. */
function allocateKm(roles: Role[], weekKm: number, longKm: number): Partial<Record<Role, number>> {
  const out: Partial<Record<Role, number>> = {};
  const others = roles.filter((r) => r !== "long" && r in RUN_SHARE);
  if (roles.includes("long")) out.long = Math.max(RUN_MIN_KM.long!, longKm);
  const rest = Math.max(0, weekKm - (out.long ?? 0));
  const shares = others.reduce((s, r) => s + RUN_SHARE[r]!, 0);
  for (const r of others) out[r] = clamp((rest * RUN_SHARE[r]!) / shares, RUN_MIN_KM[r]!, RUN_MAX_KM[r]!);
  return out;
}

/** Split the week's minutes across its slots by share. */
function allocateMinutes(roles: Role[], weekMinutes: number, maxMin: number, longCap: number): Partial<Record<Role, number>> {
  const shares = roles.reduce((s, r) => s + MINUTE_SHARE[r], 0);
  return Object.fromEntries(roles.map((r) => [r,
    clamp((weekMinutes * MINUTE_SHARE[r]) / shares, MIN_SESSION, r === "long" ? longCap : maxMin)]));
}

export function generatePlan(input: PlanInput, profile: Profile, today: string): GeneratedPlan {
  validate(input, today);
  const goal = input.goal;
  const spec = GOAL_SPECS[goal];
  const start = input.startDate ?? addDays(today, 1);
  const hasEvent = input.eventDate != null;
  const end = input.eventDate ?? addDays(start, (input.weeks ?? 12) * 7 - 1);
  const monday0 = mondayOf(start);
  const nWeeks = Math.ceil((daysBetween(monday0, end) + 1) / 7);
  if (nWeeks > MAX_WEEKS) throw new PlanError(`That's ${nWeeks} weeks; plans run at most ${MAX_WEEKS}. Start closer to the event.`);
  const taper = hasEvent ? Math.min(spec.taperWeeks, Math.floor(nWeeks / 3)) : 0;
  const phaseOfWeek = phasesFor(nWeeks, taper, hasEvent);
  const maxMin = input.maxSessionMin ?? 75;
  const longDay = input.longDay ?? 5;
  const layout = LAYOUT[input.daysPerWeek];
  const roles = layout.map(([r]) => r);
  const cross = keepsHiit(goal, profile, input.daysPerWeek);

  // paces, and the race pace the goal-specific work uses
  const vo2 = profile.paces?.vdot ?? null;
  const pc = profile.paces ?? pacesFor(38); // durations only, when there's no VO₂max
  const paceCtx: PaceCtx = { paces: pc, hasPaces: profile.paces != null };
  const meters = isRunGoal(goal) ? RACE_METERS[goal] : null;
  const target = input.targetTime ? parseDuration(input.targetTime) : null;
  const racePace = meters
    ? target ? target / (meters / 1000) : vo2 ? raceTime(vo2, meters) / (meters / 1000) : null
    : null;

  // starting volume: what the data shows, but at least what the chosen days need
  const stateFactor = STATE_START[profile.state.level];
  const recentMinutes = Math.max(profile.weeklyMinutes4, profile.weeklyMinutes12 * 0.9);
  const recentKm = Math.max(profile.runKmPerWeek4, profile.runKmPerWeek12 * 0.9);
  const startMinutes = Math.max(recentMinutes, roles.length * 35);
  const startKm = Math.max(recentKm, floorKm(goal, input.daysPerWeek, cross));
  const peakLevel = Math.max(spec.peakMinutes, startMinutes * 1.15) / startMinutes;
  const peakKmLevel = Math.max(spec.peakKm ?? 0, startKm * 1.15) / startKm;

  // volume per week
  const weeks: WeekPlan[] = [];
  let level = 1;
  let kmLevel = 1;
  let longKm = clamp(profile.longestRunKm8, RUN_MIN_KM.long!, spec.longRunCapKm ?? 99);
  const taperFactors = TAPER[taper] ?? [];
  const nonTaper = nWeeks - taper;
  for (let i = 0; i < nWeeks; i++) {
    const phase = phaseOfWeek[i];
    let deload = false;
    let [lv, kl, lk] = [level, kmLevel, longKm];
    if (phase === "taper") {
      const f = taperFactors[i - nonTaper];
      [lv, kl, lk] = [level * f, kmLevel * f, longKm * (f + 0.15)];
    } else {
      deload = (i + 1) % 4 === 0 && i < nonTaper - 1;
      if (deload) {
        [lv, kl, lk] = [level * DELOAD, kmLevel * DELOAD, longKm * 0.8];
      } else if (i > 0) {
        level = Math.min(level * MINUTES_GROWTH, Math.max(level, peakLevel));
        kmLevel = Math.min(kmLevel * KM_GROWTH, Math.max(kmLevel, peakKmLevel));
        longKm = Math.min(longKm + LONG_RUN_STEP_KM, spec.longRunCapKm ?? 99);
        [lv, kl, lk] = [level, kmLevel, longKm];
      }
    }
    // the state eases the first 7 days, which a mid-week start spreads over two weeks
    if (i === 0 || (i === 1 && weekday(start) !== 0)) [lv, kl, lk] = [lv * stateFactor, kl * stateFactor, lk * stateFactor];
    weeks.push({
      index: i, monday: addDays(monday0, i * 7), phase, phaseWeek: i - phaseOfWeek.indexOf(phase) + 1,
      deload, level: lv, kmLevel: kl, longKm: lk,
    });
  }

  // HYROX/CrossFit race practice in the peak weeks
  const peakIdx = weeks.filter((w) => w.phase === "peak").map((w) => w.index);
  const special = new Map<number, Ctx["special"]>();
  if (goal === "hyrox" && peakIdx.length) {
    // the full simulation 2–3 weeks out, a half one at the start of a longer peak
    special.set(peakIdx.at(peakIdx.length >= 2 ? -2 : -1)!, "full_sim");
    if (peakIdx.length >= 3) special.set(peakIdx[0], "half_sim");
  }
  if (goal === "crossfit" && hasEvent && peakIdx.length) special.set(peakIdx.at(-1)!, "full_sim");

  // the sessions
  const build = BUILDERS[goal];
  const sessions: Session[] = [];
  const progressWeeks = weeks.filter((w) => w.phase !== "taper").length;
  for (const w of weeks) {
    const weekKm = startKm * w.kmLevel;
    const longShare = weekKm < 30 ? 0.4 : 0.35;
    const runKm = isRunGoal(goal)
      ? allocateKm(roles.filter((r) => !(r === "easy2" && cross)), weekKm, Math.min(w.longKm, weekKm * longShare))
      : {};
    const ctx: Ctx = {
      ...paceCtx, goal, profile, racePace, week: w, maxMin,
      progress: progressWeeks > 1 ? Math.min(1, w.index / (progressWeeks - 1)) : 1,
      special: special.get(w.index) ?? null,
      km: runKm,
      minutes: allocateMinutes(roles, startMinutes * w.level, maxMin, spec.longCapMin ?? 120),
      crossTraining: cross,
      days: input.daysPerWeek,
    };
    for (const [role, offset] of layout) {
      const date = addDays(w.monday, (((longDay + offset) % 7) + 7) % 7);
      if (date < start || date > end) continue;
      const s = build(role, ctx);
      sessions.push({ date, week: w.index + 1, phase: w.phase, role, ...s });
    }
  }

  // events: tune-ups with a mini-taper around them, then the main one
  const weekOf = (date: string) => weeks[Math.floor(daysBetween(monday0, date) / 7)];
  const notes: string[] = [];
  const placeEvent = (name: string, date: string, g: Goal, main: boolean) => {
    for (let k = sessions.length - 1; k >= 0; k--) if (sessions[k].date === date) sessions.splice(k, 1);
    const [before1, before2, after1] = [addDays(date, -1), addDays(date, -2), addDays(date, 1)];
    const shakeout = {
      role: "shakeout", discipline: "run" as const, kind: "shakeout", intensity: "easy" as const, title: "Shakeout",
      description: g === "hyrox" ? "15 min easy jog, a few wall balls and mobility. Check your kit." : "20 min easy, then 4× 20 s strides.",
      durationMin: 20, distanceKm: g === "hyrox" ? null : 3,
    };
    for (const s of sessions) {
      if (s.date === before1) Object.assign(s, shakeout);
      else if ((s.date === before2 || s.date === after1) && s.intensity !== "easy") {
        Object.assign(s, s.discipline === "run"
          ? easyRun(paceCtx, 5, s.date === after1 ? "Recovery run" : "Easy run")
          : mobility());
      }
    }
    if (main && before1 >= start && !sessions.some((s) => s.date === before1)) {
      const w = weekOf(before1);
      sessions.push({ date: before1, week: w.index + 1, phase: w.phase, ...shakeout });
    }
    const w = weekOf(date);
    const m = isRunGoal(g) ? RACE_METERS[g] : null;
    const pred = m && vo2 ? raceTime(vo2, m) : null;
    const goalTime = main && target ? target : null;
    const description = m
      ? `${GOAL_LABELS[g]} race. ${goalTime ? `Goal ${formatDuration(goalTime)} (${formatPace(goalTime / (m / 1000))}). ` : ""}${
        pred ? `Your VO₂max predicts about ${formatDuration(pred)}. ` : ""}Start the first km a little slower than goal pace, then settle in.`
      : g === "hyrox"
        ? `HYROX race: 8× (1 km run + station). Run the first km controlled${goalTime ? `; goal ${formatDuration(goalTime)}` : ""}, and pace the sleds and lunges, not just the runs.`
        : `${GOAL_LABELS[g]}: warm up properly, pace the first event, fuel between events.`;
    sessions.push({
      date, week: w.index + 1, phase: w.phase, role: main ? "race" : "tune_up", discipline: "race", kind: "race",
      intensity: "hard", title: main ? name : `${name} (tune-up)`, description,
      durationMin: r5(goalTime ? goalTime / 60 : pred ? pred / 60 : g === "hyrox" ? 90 : 60),
      distanceKm: m ? Math.round(m / 100) / 10 : null,
    });
  };
  for (const e of input.otherEvents ?? []) {
    if (e.date >= start && e.date < end) placeEvent(e.name, e.date, e.goal ?? goal, false);
    else notes.push(`${e.name} (${e.date}) is outside the plan's dates, so it isn't included.`);
  }
  if (hasEvent) placeEvent(input.name, end, goal, true);
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role));

  // phases as date spans
  const phases: PhaseSpan[] = [];
  for (const w of weeks) {
    const s = w.monday < start ? start : w.monday;
    const e = addDays(w.monday, 6) > end ? end : addDays(w.monday, 6);
    const last = phases.at(-1);
    if (last?.phase === w.phase) last.end = e;
    else phases.push({ phase: w.phase, start: s, end: e });
  }

  notes.unshift(...explain(input, profile, {
    nWeeks, phaseOfWeek, startKm, recentKm, startMinutes, recentMinutes, weeks, racePace, meters, target, vo2, spec,
    longDay, start, end, cross,
  }));
  return { input, startDate: start, endDate: end, phases, notes, sessions };
}

/** The plain-English reasons behind the plan. */
function explain(input: PlanInput, p: Profile, x: {
  nWeeks: number; phaseOfWeek: Phase[]; startKm: number; recentKm: number; startMinutes: number; recentMinutes: number;
  weeks: WeekPlan[]; racePace: number | null; meters: number | null; target: number | null; vo2: number | null;
  spec: GoalSpec; longDay: Weekday; start: string; end: string; cross: boolean;
}): string[] {
  const out: string[] = [];
  const hm = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;
  const mix = Object.entries(p.mix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([g, v]) => `${g} ${Math.round(v * 100)}%`).join(", ");
  out.push(`Built from your last 4 weeks: about ${hm(p.weeklyMinutes4)} of training a week over ${p.sessionsPerWeek4} sessions, ` +
    `${p.runKmPerWeek4} km of running, longest run ${p.longestRunKm8} km${mix ? ` (last 12 weeks: ${mix})` : ""}.`);

  const s = p.state;
  const startNote = s.level === "recover" ? " Week 1 is 25% lighter so you can recover first."
    : s.level === "caution" ? " Week 1 is 10% lighter." : "";
  out.push(`Body state now: ${s.level} (${s.reasons.join("; ")}).${startNote}`);

  const isRun = x.spec.peakKm != null;
  if (isRun && x.startKm > x.recentKm * 1.2) {
    out.push(`${input.daysPerWeek} runs a week need about ${Math.round(x.startKm)} km to start, more than the ` +
      `${Math.round(x.recentKm)} km you've been running, so the first weeks keep almost everything easy. ` +
      "Choose fewer days if that's too big a step.");
  } else if (!isRun && x.startMinutes > x.recentMinutes * 1.2) {
    out.push(`${input.daysPerWeek} sessions a week start at about ${hm(x.startMinutes)}, more than your recent ` +
      `${hm(x.recentMinutes)}, so the base weeks keep the intensity down.`);
  }

  const count = (ph: Phase) => x.phaseOfWeek.filter((q) => q === ph).length;
  const parts = (["base", "build", "peak", "taper"] as Phase[]).filter((ph) => count(ph)).map((ph) => `${count(ph)} ${ph}`);
  out.push(`${x.nWeeks} weeks: ${parts.join(", ")}. Every 4th week is lighter; ${input.daysPerWeek} training days a week with ` +
    `the long session on ${WEEKDAYS[x.longDay]}, and hard days never back to back.`);
  if (input.eventDate && x.nWeeks < x.spec.minWeeks) {
    out.push(`That's shorter than the ${x.spec.minWeeks} weeks a ${GOAL_LABELS[input.goal]} plan usually takes, so the build is compressed.`);
  }

  if (p.paces) {
    out.push(`Paces come from your VO₂max of ${p.vo2max}: easy ${formatDuration(p.paces.easy[1])}–${formatPace(p.paces.easy[0])}, ` +
      `threshold ${formatPace(p.paces.threshold)}, intervals ${formatPace(p.paces.interval)}.`);
  } else {
    out.push("There's no running VO₂max yet, so sessions use effort (RPE) instead of paces.");
  }
  if (p.vo2maxTrend != null && p.vo2maxTrend <= -1) {
    out.push(`VO₂max has dropped ${Math.abs(p.vo2maxTrend)} over 90 days, so the base weeks rebuild aerobic volume before the hard work.`);
  }

  if (x.meters && x.vo2) {
    const pred = raceTime(x.vo2, x.meters);
    const lowVolume = p.runKmPerWeek4 < 25 ? ` Predictions assume run-specific endurance; on about ${Math.round(p.runKmPerWeek4)} km a ` +
      "week of running, expect to be slower than predicted until the volume builds." : "";
    if (x.target) {
      const gain = vdotFromRace(x.meters, x.target) - x.vo2;
      const verdict = gain <= -2 ? "well within reach, so you could aim faster" : gain <= 0 ? "within reach now"
        : gain <= x.nWeeks * 0.1 ? "realistic"
        : gain <= x.nWeeks * 0.2 ? "ambitious" : "very ambitious for this timeline";
      out.push(`Your VO₂max predicts ${formatDuration(pred)} today; ${input.targetTime} is ${verdict}. ` +
        `Race-pace work uses ${formatPace(x.racePace!)}.${lowVolume}`);
    } else {
      out.push(`Your VO₂max predicts about ${formatDuration(pred)}; race-pace work uses ${formatPace(x.racePace!)}.${lowVolume}`);
    }
  }

  if (isRun) {
    const peak = Math.max(...x.weeks.map((w) => w.kmLevel)) * x.startKm;
    out.push(`Running builds from about ${Math.round(x.weeks[0].kmLevel * x.startKm)} to ${Math.round(peak)} km a week, ` +
      "never more than 10% at a time." +
      (peak < x.spec.peakKm! * 0.8
        ? ` ${GOAL_LABELS[input.goal]} plans usually peak near ${x.spec.peakKm} km, so at this volume it's a plan to finish strong rather than race fast.`
        : ""));
  }
  if (x.cross) out.push("Your HIIT habit stays in as one controlled cross-training session a week.");
  if (input.goal === "hyrox") {
    out.push("HYROX runs use threshold pace + 15 s/km; a full race simulation comes 2–3 weeks before the race." +
      (input.daysPerWeek <= 4 ? " With 4 or fewer days, station work rides along with strength." : ""));
    if (x.target && p.paces) {
      // the 8 km of running is typically a bit under half of a HYROX finish time
      const needed = (x.target * 0.45) / 8;
      const current = p.paces.threshold + 15;
      out.push(current <= needed
        ? `${input.targetTime} needs runs around ${formatPace(needed)}; your HYROX run pace (${formatPace(current)}) already ` +
          "supports that, so the stations are where the time is won."
        : `${input.targetTime} needs runs around ${formatPace(needed)}, faster than your HYROX run pace today ` +
          `(${formatPace(current)}), so the run intervals and compromised running carry that gap.`);
    }
  }
  for (const e of input.otherEvents ?? []) {
    if (e.date >= x.start && e.date < x.end) {
      out.push(`${e.name} on ${e.date} is a tune-up: easier days around it and a shakeout the day before.`);
    }
  }
  return out;
}
