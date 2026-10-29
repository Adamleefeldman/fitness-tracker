/**
 * Running paces from VO₂max, using Jack Daniels' running formula (the VDOT
 * model). Garmin's running VO₂max is a close stand-in for VDOT.
 *
 *   oxygen cost of running at v m/min:  VO2 = -4.60 + 0.182258·v + 0.000104·v²
 *   share of VO₂max sustainable for t minutes:
 *     %max = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
 *
 * Paces are seconds per km.
 */

const A = 0.000104;
const B = 0.182258;
const C = -4.6;

/** Oxygen cost (ml/kg/min) of running at `v` metres per minute. */
const cost = (v: number) => C + B * v + A * v * v;

/** Fraction of VO₂max a runner can hold for `t` minutes. */
const sustainable = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

/** Speed (m/min) whose oxygen cost is `vo2`. */
const speedFor = (vo2: number) => (-B + Math.sqrt(B * B - 4 * A * (C - vo2))) / (2 * A);

const secPerKm = (v: number) => 60_000 / v;

/** Predicted race time in seconds over `meters` for a runner with this VDOT. */
export function raceTime(vdot: number, meters: number): number {
  // bisection on minutes: cost(d/t) falls and vdot·sustainable(t) falls more slowly
  let lo = meters / 600; // 10 m/s
  let hi = meters / 50;
  for (let i = 0; i < 80; i++) {
    const t = (lo + hi) / 2;
    if (cost(meters / t) > vdot * sustainable(t)) lo = t;
    else hi = t;
  }
  return ((lo + hi) / 2) * 60;
}

/** The VDOT a race result implies. */
export function vdotFromRace(meters: number, seconds: number): number {
  const t = seconds / 60;
  return cost(meters / t) / sustainable(t);
}

export interface Paces {
  vdot: number;
  /** Easy/long runs: a range, slow end first. */
  easy: [number, number];
  marathon: number;
  threshold: number;
  interval: number;
  repetition: number;
}

/** Daniels' training paces (sec/km) for a VDOT. */
export function paces(vdot: number): Paces {
  const at = (fraction: number) => secPerKm(speedFor(fraction * vdot));
  return {
    vdot,
    easy: [at(0.62), at(0.7)],
    marathon: raceTime(vdot, 42_195) / 42.195,
    threshold: at(0.88),
    interval: at(0.975),
    repetition: at(1.06),
  };
}

export const RACE_METERS = { "5k": 5_000, "10k": 10_000, half_marathon: 21_097.5, marathon: 42_195 } as const;

/** 'h:mm:ss' or 'mm:ss' → seconds; null when it doesn't parse. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Seconds → 'h:mm:ss' (or 'm:ss' under an hour). */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Seconds per km → 'm:ss/km'. */
export function formatPace(secPerKmValue: number): string {
  return `${formatDuration(secPerKmValue)}/km`;
}
