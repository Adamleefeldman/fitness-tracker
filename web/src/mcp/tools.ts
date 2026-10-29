/**
 * The MCP tools' logic: plain functions over a read-only connection, returning
 * JSON-ready objects. server.ts registers them; tests call them through a client.
 *
 * Results use the dashboard's own analytics and verdicts, so Claude and the
 * dashboard always agree. Units are in the field names, and null means the
 * watch didn't record that value.
 */

import { spawn } from "node:child_process";
import path from "node:path";

import type Database from "better-sqlite3";
import { z } from "zod";

import * as A from "../lib/analytics.ts";
import { mmss } from "../lib/format.ts";
import { freshness } from "../lib/freshness.ts";
import * as Q from "../lib/queries.ts";
import { RANGE_DAYS, RANGES, type RangeKey } from "../lib/range.ts";
import type { Activity, Daily } from "../lib/types.ts";
import * as V from "../lib/verdicts.ts";

export interface Ctx {
  db: Database.Database;
  now: () => Date;
  /** run_sql stops a query after this long. */
  sqlTimeoutMs?: number;
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;

const round = (v: number | null | undefined, dp: number) =>
  v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** Local 'YYYY-MM-DD HH:MM'. */
const localTime = (d: Date) => d.toLocaleString("sv-SE").slice(0, 16);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

const QUESTIONS = {
  today: "Train hard today?",
  load: "Am I overtraining?",
  fitness: "Am I getting fitter?",
  sleep: "Is my sleep and recovery improving?",
} as const;
export type Question = keyof typeof QUESTIONS;

// --- get_overview ---

export const overviewInput = {
  range: z.enum(RANGES).default("90d")
    .describe("Window the verdicts judge, as on the dashboard: last 30 days, 90 days, 1 year, or all history"),
};

/** Newest non-null value of a column, with its date. */
function latestWithDate(daily: Daily[], col: keyof Daily, dp: number) {
  const row = daily.findLast((r) => r[col] != null);
  return row ? { value: round(row[col] as number, dp), date: row.date } : null;
}

/**
 * A window's rows as the dashboard judges them: `today` stops at the newest day
 * with data (like the Today page); the other verdicts take the whole window.
 */
export interface Judged {
  win: { daily: Daily[]; activities: Activity[] };
  today: Daily[];
}

export const judge = (win: Judged["win"]): Judged => ({ win, today: A.trimBlankTail(win.daily) });

function judged(ctx: Ctx, range: RangeKey) {
  const daily = Q.dailyRows(ctx.db);
  return { daily, ...judge(A.sliceWindow(daily, Q.activityRows(ctx.db), RANGE_DAYS[range])) };
}

export function getOverview(ctx: Ctx, { range }: { range: RangeKey }) {
  const { daily, win, today: d } = judged(ctx, range);
  const withData = A.trimBlankTail(daily);
  const syncedAt = Q.lastSynced(ctx.db);
  const dataDate = Q.lastDataDate(ctx.db);
  const { watchBehind, syncOverdue } = freshness(syncedAt, dataDate, ctx.now());
  const ready = V.todayInputs(d);

  const notes: string[] = [];
  if (watchBehind) {
    notes.push(`No data from the watch since ${dataDate}: the sync ran but Garmin had nothing newer. ` +
      "Opening Garmin Connect on the phone uploads it, and the next sync fills the gap.");
  }
  if (syncOverdue) {
    notes.push(syncedAt ? `The daily sync hasn't run since ${localTime(syncedAt)}.` : "Nothing has synced yet.");
  }

  return {
    range,
    window: win.daily.length ? { first_day: win.daily[0].date, last_day: win.daily.at(-1)!.date } : null,
    data: {
      newest_day_with_data: dataDate,
      last_sync: syncedAt && localTime(syncedAt),
      watch_not_uploading: watchBehind,
      sync_overdue: syncOverdue,
      notes,
    },
    verdicts: {
      today: { question: QUESTIONS.today, day: d.at(-1)?.date ?? null, ...V.today(d) },
      load: { question: QUESTIONS.load, ...V.load(win.daily) },
      fitness: { question: QUESTIONS.fitness, ...V.fitness(win.daily, win.activities) },
      sleep: { question: QUESTIONS.sleep, ...V.sleep(win.daily) },
    },
    readiness: {
      day: d.at(-1)?.date ?? null,
      score: ready.score,
      level: ready.level,
      factors_pct: ready.drivers,
    },
    latest: {
      resting_hr_bpm: latestWithDate(withData, "resting_hr", 0),
      hrv_ms: latestWithDate(withData, "hrv_last_night_ms", 0),
      sleep_score: latestWithDate(withData, "sleep_score", 0),
      sleep_hours: latestWithDate(withData, "sleep_hours", 2),
      vo2max_running: latestWithDate(withData, "vo2max_running", 1),
      body_battery_high: latestWithDate(withData, "bb_high", 0),
      steps: latestWithDate(withData, "steps", 0),
    },
  };
}

// --- get_daily_metrics ---

const hours = (s: number | null) => round(s == null ? null : s / 3600, 2);

/** Each metric Claude can ask for, in readable units. */
const METRICS = {
  readiness_score: (r: Daily) => r.training_readiness_score,
  readiness_level: (r: Daily) => r.training_readiness_level,
  resting_hr_bpm: (r: Daily) => r.resting_hr,
  min_hr_bpm: (r: Daily) => r.min_hr,
  max_hr_bpm: (r: Daily) => r.max_hr,
  hrv_ms: (r: Daily) => r.hrv_last_night_ms,
  hrv_status: (r: Daily) => r.hrv_status,
  hrv_baseline_low_ms: (r: Daily) => r.hrv_baseline_low,
  hrv_baseline_high_ms: (r: Daily) => r.hrv_baseline_high,
  sleep_score: (r: Daily) => r.sleep_score,
  sleep_hours: (r: Daily) => hours(r.sleep_total_seconds),
  deep_sleep_hours: (r: Daily) => hours(r.sleep_deep_seconds),
  rem_sleep_hours: (r: Daily) => hours(r.sleep_rem_seconds),
  light_sleep_hours: (r: Daily) => hours(r.sleep_light_seconds),
  awake_hours: (r: Daily) => hours(r.sleep_awake_seconds),
  bedtime: (r: Daily) => r.sleep_start,
  wake_time: (r: Daily) => r.sleep_end,
  body_battery_high: (r: Daily) => r.bb_high,
  body_battery_low: (r: Daily) => r.bb_low,
  stress_avg: (r: Daily) => r.stress_avg,
  stress_max: (r: Daily) => r.stress_max,
  vo2max_running: (r: Daily) => r.vo2max_running,
  training_status: (r: Daily) => r.training_status,
  acute_load: (r: Daily) => round(r.acute_load, 0),
  chronic_load: (r: Daily) => round(r.chronic_load, 0),
  acwr: (r: Daily) => round(A.acwr([r])[0], 2),
  steps: (r: Daily) => r.steps,
  floors: (r: Daily) => r.floors,
  distance_km: (r: Daily) => round(r.distance_m == null ? null : r.distance_m / 1000, 2),
  calories: (r: Daily) => r.calories,
  active_calories: (r: Daily) => r.active_calories,
  spo2_avg_pct: (r: Daily) => r.spo2_avg,
  respiration_avg_brpm: (r: Daily) => r.respiration_avg,
  weight_kg: (r: Daily) => round(r.weight_g == null ? null : r.weight_g / 1000, 1),
  body_fat_pct: (r: Daily) => r.body_fat_pct,
} satisfies Record<string, (r: Daily) => unknown>;

type Metric = keyof typeof METRICS;
const METRIC_NAMES = Object.keys(METRICS) as [Metric, ...Metric[]];

export const DEFAULT_METRICS: Metric[] = [
  "readiness_score", "resting_hr_bpm", "hrv_ms", "sleep_score", "sleep_hours",
  "body_battery_high", "stress_avg", "steps", "acwr",
];

export const dailyMetricsInput = {
  start: isoDate.optional().describe("First day, YYYY-MM-DD"),
  end: isoDate.optional().describe("Last day, YYYY-MM-DD (default: the newest stored day)"),
  metrics: z.array(z.enum(METRIC_NAMES)).min(1).optional()
    .describe(`Which metrics to return (default: ${DEFAULT_METRICS.join(", ")})`),
};

export function getDailyMetrics(
  ctx: Ctx,
  { start, end, metrics }: { start?: string; end?: string; metrics?: Metric[] },
) {
  const daily = Q.dailyRows(ctx.db);
  const cols = metrics ?? DEFAULT_METRICS;
  const newest = daily.at(-1)?.date;
  if (!newest) return { start: null, end: null, metrics: cols, days: [] };

  const last = end ?? (start && addDays(start, 13) < newest ? addDays(start, 13) : newest);
  const first = start ?? addDays(last, -13);
  if (first > last) throw new Error(`start ${first} is after end ${last}`);
  const span = daysBetween(first, last) + 1;
  if (span > MAX_DAYS) throw new Error(`That's ${span} days; ask for ${MAX_DAYS} or fewer at a time.`);

  return {
    start: first,
    end: last,
    metrics: cols,
    newest_day_with_data: Q.lastDataDate(ctx.db),
    days: daily
      .filter((r) => r.date >= first && r.date <= last)
      .map((r) => (A.hasData(r)
        ? { date: r.date, ...Object.fromEntries(cols.map((c) => [c, METRICS[c](r)])) }
        : { date: r.date, no_data: true })),
  };
}

// --- get_activities ---

export const activitiesInput = {
  start: isoDate.optional().describe("Earliest day, YYYY-MM-DD"),
  end: isoDate.optional().describe("Latest day, YYYY-MM-DD"),
  group: z.enum(A.ACTIVITY_GROUPS).optional()
    .describe("Running (outdoor, treadmill, trail, track), HIIT, Strength, or Other (everything else)"),
  type: z.string().optional().describe("An exact Garmin activity type, e.g. running, hiit, yoga, tennis_v2"),
  limit: z.number().int().min(1).max(200).default(20).describe("Most recent N matches to return"),
};

function activitySummary(a: Activity) {
  return {
    date: a.date,
    start_time: a.start_time_local?.slice(11, 16) ?? null,
    type: a.activity_type,
    group: A.activityGroup(a.activity_type),
    name: a.name,
    duration_min: round(a.duration_s == null ? null : a.duration_s / 60, 1),
    distance_km: round(a.distance_km, 2),
    pace_per_km: a.pace_min_per_km != null && a.distance_km ? mmss(a.pace_min_per_km) : null,
    avg_hr_bpm: round(a.avg_hr, 0),
    max_hr_bpm: round(a.max_hr, 0),
    training_load: round(a.training_load, 1),
    aerobic_te: a.aerobic_te,
    anaerobic_te: a.anaerobic_te,
    intensity: A.intensityOf(a),
    elevation_gain_m: round(a.elevation_gain_m, 0),
    calories: round(a.calories, 0),
  };
}

export function getActivities(
  ctx: Ctx,
  { start, end, group, type, limit }:
    { start?: string; end?: string; group?: A.ActivityGroup; type?: string; limit: number },
) {
  const all = Q.activityRows(ctx.db).filter((a) => a.date != null);
  const matched = all.filter((a) =>
    (!start || a.date! >= start) &&
    (!end || a.date! <= end) &&
    (!group || A.activityGroup(a.activity_type) === group) &&
    (!type || a.activity_type === type));
  const newestFirst = matched.slice(-limit).reverse();
  return {
    matched: matched.length,
    returned: newestFirst.length,
    activities: newestFirst.map(activitySummary),
    // help Claude correct a misspelt type
    ...(matched.length === 0 && type
      ? { known_types: [...new Set(all.map((a) => a.activity_type).filter(Boolean))].sort() }
      : {}),
  };
}

// --- get_weekly_summary ---

export const weeklySummaryInput = {
  weeks: z.number().int().min(1).max(104).default(8)
    .describe("How many weeks, ending with the week of the newest stored day"),
};

/** Mean of a column's non-null values, rounded. */
const avg = (rows: Daily[], col: keyof Daily, dp: number) => round(A.mean(A.values(rows, col)), dp);

export function getWeeklySummary(ctx: Ctx, { weeks }: { weeks: number }) {
  const daily = Q.dailyRows(ctx.db);
  const newest = daily.at(-1)?.date;
  if (!newest) return { weeks: [] };
  const acts = Q.activityRows(ctx.db).filter((a) => a.date != null);
  const ratios = A.acwr(daily);

  const lastWeek = A.weekEnding(newest);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDays(lastWeek, -7 * i);
    const start = addDays(end, -6);
    const idx = daily.flatMap((r, j) => (r.date >= start && r.date <= end ? [j] : []));
    if (!idx.length) continue; // before the history starts
    const days = idx.map((j) => daily[j]);
    const wa = acts.filter((a) => a.date! >= start && a.date! <= end);

    const hoursByGroup = Object.fromEntries(A.ACTIVITY_GROUPS.map((g) => [g, 0])) as Record<A.ActivityGroup, number>;
    const sessions = { easy: 0, moderate: 0, hard: 0 };
    let runKm = 0;
    for (const a of wa) {
      const g = A.activityGroup(a.activity_type);
      hoursByGroup[g] += (a.duration_s ?? 0) / 3600;
      sessions[A.intensityOf(a)]++;
      if (g === "Running") runKm += a.distance_km ?? 0;
    }
    const lastRatio = idx.map((j) => ratios[j]).findLast((r) => r != null) ?? null;

    out.push({
      week: `${start} to ${end}`,
      days_with_data: days.filter(A.hasData).length,
      training: {
        sessions: wa.length,
        hours: round(Object.values(hoursByGroup).reduce((x, y) => x + y, 0), 1),
        hours_by_group: Object.fromEntries(Object.entries(hoursByGroup).map(([g, h]) => [g, round(h, 1)])),
        sessions_by_intensity: sessions,
        running_km: round(runKm, 1),
        acwr_at_week_end: round(lastRatio, 2),
      },
      averages: {
        readiness_score: avg(days, "training_readiness_score", 0),
        resting_hr_bpm: avg(days, "resting_hr", 1),
        hrv_ms: avg(days, "hrv_last_night_ms", 0),
        sleep_score: avg(days, "sleep_score", 0),
        sleep_hours: avg(days, "sleep_hours", 2),
        stress_avg: avg(days, "stress_avg", 0),
        body_battery_high: avg(days, "bb_high", 0),
        steps: avg(days, "steps", 0),
      },
    });
  }
  return { newest_day_with_data: Q.lastDataDate(ctx.db), weeks: out };
}

// --- explain_verdict ---

export const explainInput = {
  question: z.enum(Object.keys(QUESTIONS) as [Question, ...Question[]])
    .describe(`Which verdict: ${Object.entries(QUESTIONS).map(([k, q]) => `${k} (${q})`).join(", ")}`),
  range: overviewInput.range,
};

const r1 = (v: number | null) => round(v, 1);

/** Each rule as {check, value, met}, plus how the rules combine. */
function explanation(q: Question, j: Judged) {
  switch (q) {
    case "today": {
      const i = V.todayInputs(j.today);
      const { limiterPct } = V.RULES.today;
      return {
        day: j.today.at(-1)?.date ?? null,
        inputs: { readiness_score: i.score, readiness_level: i.level, factors_pct: i.drivers, weakest_factor: i.weakest },
        how_it_decides: "The word and colour follow Garmin's readiness level: Prime or High is good, Moderate is " +
          `caution, Low or Poor is bad. A factor below ${limiterPct}% is named as the main limiter.`,
        checks: [
          { check: `Weakest factor below ${limiterPct}%`, value: i.weakest?.pct ?? null,
            met: i.weakest != null && i.weakest.pct < limiterPct },
        ],
      };
    }
    case "load": {
      const i = V.loadInputs(j.win.daily);
      const { sweetSpot: [lo, hi], overreaching, rhrCreepBpm } = V.RULES.load;
      return {
        inputs: {
          acwr: round(i.acwr, 2), acute_load: r1(i.acuteLoad), chronic_load: r1(i.chronicLoad),
          resting_hr_7d_avg_bpm: r1(i.rhr7), resting_hr_28d_avg_bpm: r1(i.rhr28), resting_hr_creep_bpm: r1(i.rhrCreep),
          hrv_7d_avg_ms: r1(i.hrv7), hrv_baseline_low_ms: i.hrvBaselineLow,
        },
        how_it_decides: `Above ${overreaching}, or above ${hi} with a red flag: Overreaching. Above ${hi}: Ramping fast. ` +
          `Below ${lo}: Detraining. In the sweet spot with a red flag: Watch recovery. Otherwise: Balanced.`,
        checks: [
          { check: `Load ratio in the ${lo}–${hi} sweet spot`, value: round(i.acwr, 2),
            met: i.acwr != null && i.acwr >= lo && i.acwr <= hi },
          { check: `Load ratio above ${overreaching}`, value: round(i.acwr, 2), met: i.acwr != null && i.acwr > overreaching },
          { check: `Red flag: resting HR 7-day average ${rhrCreepBpm}+ bpm above its 28-day average`,
            value: r1(i.rhrCreep), met: i.rhrCreep != null && i.rhrCreep >= rhrCreepBpm },
          { check: "Red flag: HRV 7-day average below Garmin's baseline low", value: r1(i.hrv7), met: i.hrvSuppressed },
        ],
      };
    }
    case "fitness": {
      const i = V.fitnessInputs(j.win.daily, j.win.activities);
      const { vo2Change, volumeChangePct } = V.RULES.fitness;
      return {
        inputs: {
          vo2max_first: i.vo2First, vo2max_latest: i.vo2Last, vo2max_change: r1(i.vo2Delta),
          running_km_per_week_change_pct: round(i.runVolumeChangePct, 0),
        },
        how_it_decides: `VO₂max up ${vo2Change}+ over the range: Improving. Down ${vo2Change}+: Slipping. ` +
          `Otherwise: Holding. A change of ${volumeChangePct}%+ in weekly running km (recent half of the range ` +
          "against the earlier half) is mentioned.",
        checks: [
          { check: `VO₂max up ${vo2Change} or more`, value: r1(i.vo2Delta), met: i.vo2Delta != null && i.vo2Delta >= vo2Change },
          { check: `VO₂max down ${vo2Change} or more`, value: r1(i.vo2Delta), met: i.vo2Delta != null && i.vo2Delta <= -vo2Change },
          { check: `Weekly running km changed ${volumeChangePct}% or more`, value: round(i.runVolumeChangePct, 0),
            met: i.runVolumeChangePct != null && Math.abs(i.runVolumeChangePct) >= volumeChangePct },
        ],
      };
    }
    case "sleep": {
      const i = V.sleepInputs(j.win.daily);
      const R = V.RULES.sleep;
      return {
        inputs: {
          sleep_score_7d_avg: r1(i.score7), sleep_score_prior_21d_avg: r1(i.scorePrior),
          sleep_hours_7d_avg: round(i.hours7, 2), bedtime_sd_min: round(i.bedtimeSdMin, 0),
        },
        how_it_decides: `7-day sleep score below ${R.poor}: Poor. Below ${R.solid}, or any issue: Mixed. ` +
          "Otherwise: Solid.",
        checks: [
          { check: `7-day sleep score below ${R.poor}`, value: r1(i.score7), met: i.score7 != null && i.score7 < R.poor },
          { check: `7-day sleep score below ${R.solid}`, value: r1(i.score7), met: i.score7 != null && i.score7 < R.solid },
          { check: `Issue: averaging under ${R.shortHours}h of sleep`, value: round(i.hours7, 2),
            met: i.hours7 != null && i.hours7 < R.shortHours },
          { check: `Issue: bedtime varies by more than ±${R.bedtimeSdMin} min (last 14 nights)`,
            value: round(i.bedtimeSdMin, 0), met: i.bedtimeSdMin != null && i.bedtimeSdMin > R.bedtimeSdMin },
        ],
      };
    }
  }
}

export function explainVerdict(ctx: Ctx, { question, range }: { question: Question; range: RangeKey }) {
  return { question: QUESTIONS[question], range, ...explainWindow(question, judged(ctx, range)) };
}

/** A verdict and its explanation for one judged window. */
export function explainWindow(question: Question, j: Judged) {
  const verdict = {
    today: () => V.today(j.today),
    load: () => V.load(j.win.daily),
    fitness: () => V.fitness(j.win.daily, j.win.activities),
    sleep: () => V.sleep(j.win.daily),
  }[question]();
  return { verdict, ...explanation(question, j) };
}

// --- run_sql ---

// resolved on use: bundlers (the app imports this module too) leave import.meta.dirname unset
const sqlRunner = () => path.join(import.meta.dirname, "sql-runner.ts");

export const runSqlInput = {
  sql: z.string().min(1).describe("One SELECT (or WITH … SELECT) statement in SQLite syntax"),
  max_rows: z.number().int().min(1).max(500).default(100).describe("Most rows to return"),
};

/** Tables and columns, for run_sql's description, read from the database itself. */
export function schemaSummary(db: Database.Database): string {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .pluck().all() as string[];
  return tables.map((t) => {
    const cols = db.pragma(`table_info(${t})`) as { name: string; type: string }[];
    return `${t}(${cols.map((c) => `${c.name} ${c.type}`.trim()).join(", ")})`;
  }).join("\n");
}

export function runSql(ctx: Ctx, { sql, max_rows }: { sql: string; max_rows: number }) {
  const timeout = ctx.sqlTimeoutMs ?? 5000;
  return new Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean }>((resolve, reject) => {
    const child = spawn(process.execPath, [sqlRunner(), ctx.db.name], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`The query ran longer than ${timeout / 1000}s and was stopped. Narrow it, or add a LIMIT.`));
    }, timeout);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        if (r.error) reject(new Error(r.error));
        else resolve(r);
      } catch {
        reject(new Error(`The query runner failed: ${err.trim() || "no output"}`));
      }
    });
    child.stdin.end(JSON.stringify({ sql, maxRows: max_rows }));
  });
}
