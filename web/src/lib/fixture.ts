/**
 * A synthetic garmin.db for tests: about 14 months of made-up but plausible
 * data, so the golden test runs anywhere without anyone's health data.
 *
 * Deterministic: a seeded generator and plain arithmetic only (no Math.log or
 * trig, whose last bits can differ between engines), so every run writes the
 * same values the golden file was frozen from.
 *
 * The history is scripted in phases so every verdict rule fires somewhere:
 * a load ramp with resting-HR creep and suppressed HRV, a detraining spell,
 * a poor-sleep block, a load spike, irregular bedtimes, VO₂max slipping and
 * recovering, a mid-history gap and a blank tail (the watch not uploading).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const SCHEMA = path.resolve(import.meta.dirname, "../../../garmin_health/schema.sql");
const START = Date.UTC(2025, 5, 1); // 2025-06-01
const DAYS = 418;
const BLANK_TAIL = 3;
const DAY_MS = 86_400_000;

/** mulberry32: small, fast, and identical in every JS engine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const hhmm = (h: number) => {
  const m = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Which scripted phases cover day `i`. */
function phase(i: number) {
  return {
    load: i >= 60 && i <= 80 ? 1.7 : i >= 81 && i <= 110 ? 0.3 : i >= 181 && i <= 195 ? 2.6 : 1,
    creep: (i >= 68 && i <= 88) || (i >= 360 && i <= 376),
    hrvLow: i >= 70 && i <= 90,
    poorSleep: i >= 140 && i <= 165,
    shortSleep: i >= 150 && i <= 175,
    irregular: i >= 210 && i <= 240,
    gap: i >= 241 && i <= 245,
    // VO₂max: climbs, slips through the autumn, then recovers
    vo2: i < 240 ? 48 + i * 0.008 : i < 330 ? 49.9 - (i - 240) * 0.02 : 48.1 + (i - 330) * 0.015,
  };
}

const ACTIVITY_TYPES: [string, number][] = [
  ["running", 0.34], ["hiit", 0.34], ["strength_training", 0.1], ["treadmill_running", 0.04],
  ["yoga", 0.04], ["walking", 0.04], ["tennis_v2", 0.03], ["indoor_rowing", 0.03],
  ["lap_swimming", 0.02], ["indoor_cycling", 0.02],
];

/** Write the fixture to `file` (which must not exist yet). */
export function writeFixtureDb(file: string) {
  const r = rng(20250601);
  /** Roughly normal noise from four uniforms (Irwin–Hall), mean 0, sd ~1. */
  const noise = () => (r() + r() + r() + r() - 2) * 1.732;
  /** Null roughly `p` of the time. */
  const gappy = <T>(v: T, p = 0.03): T | null => (r() < p ? null : v);
  const pick = () => {
    let x = r();
    for (const [t, w] of ACTIVITY_TYPES) if ((x -= w) < 0) return t;
    return "mobility";
  };

  const db = new Database(file);
  db.exec(readFileSync(SCHEMA, "utf8"));
  const cols = (db.prepare("PRAGMA table_info(daily_metrics)").all() as { name: string }[]).map((c) => c.name);
  const insertDay = db.prepare(
    `INSERT INTO daily_metrics (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`,
  );
  const actCols = (db.prepare("PRAGMA table_info(activities)").all() as { name: string }[]).map((c) => c.name);
  const insertAct = db.prepare(
    `INSERT INTO activities (${actCols.join(", ")}) VALUES (${actCols.map((c) => `@${c}`).join(", ")})`,
  );
  const blankDay = Object.fromEntries(cols.map((c) => [c, null]));
  const blankAct = Object.fromEntries(actCols.map((c) => [c, null]));
  const synced = "2026-10-01T06:00:00";

  let acute = 300;
  let chronic = 300;
  let actId = 1;

  db.transaction(() => {
    for (let i = 0; i < DAYS + BLANK_TAIL; i++) {
      const date = iso(START + i * DAY_MS);
      const p = phase(i);
      if (i >= DAYS || p.gap) {
        insertDay.run({ ...blankDay, date, raw_json: '{"readiness": []}', synced_at: synced });
        continue;
      }

      // activities, and the day's training load from them
      let load = 0;
      const sessions = r() < 0.15 * p.load ? 0 : r() < 0.62 * Math.min(p.load, 1.4) ? 1 : 0;
      for (let s = 0; s < sessions + (p.load > 2 && r() < 0.5 ? 1 : 0); s++) {
        const type = pick();
        const run = type.includes("running");
        const km = run ? 5 + r() * 7 : type === "walking" ? 3 + r() * 3 : null;
        const pace = run ? 300 + r() * 90 - i * 0.04 : null;
        const duration = km && pace ? km * pace : 1800 + r() * 2700;
        const aerobic = 1.5 + r() * 3.2;
        const anaerobic = type === "hiit" ? 1 + r() * 2.5 : r() * 1.5;
        const tl = (duration / 60) * (0.8 + aerobic / 3) * p.load;
        load += tl;
        insertAct.run({
          ...blankAct,
          activity_id: actId++,
          date,
          start_time_local: `${date} ${hhmm(6.5 + r() * 12)}:00`,
          activity_type: r() < 0.005 ? null : type,
          name: type,
          distance_m: km != null ? Math.round(km * 1000) : null,
          duration_s: r() < 0.01 ? null : Math.round(duration),
          avg_pace_s_per_km: pace != null ? Math.round(pace * 10) / 10 : null,
          avg_hr: Math.round(130 + r() * 35),
          training_load: Math.round(tl * 10) / 10,
          aerobic_te: gappy(Math.round(aerobic * 10) / 10),
          anaerobic_te: gappy(Math.round(anaerobic * 10) / 10),
          synced_at: synced,
        });
      }
      acute += (load * 7 - acute) * (2 / 8);
      chronic += (load * 7 - chronic) * (2 / 29);

      const rhr = Math.round(52 + noise() * 1.5 + (p.creep ? 5 : 0) + (p.load > 2 ? 2 : 0));
      const hrv = Math.round(62 + noise() * 6 - (p.hrvLow ? 16 : 0));
      const score = Math.round(
        Math.min(100, Math.max(5, (p.poorSleep ? 55 : 80) + noise() * 6)),
      );
      const sleepH = (p.shortSleep ? 5.9 : 7.4) + noise() * 0.5;
      const bed = (i % 7 >= 5 ? -0.5 : -1) + noise() * (p.irregular ? 2.2 : 0.3);
      const wake = bed + sleepH + 0.4;
      const bedT = START + i * DAY_MS + bed * 3_600_000;
      const wakeT = START + i * DAY_MS + wake * 3_600_000;
      const readiness = Math.round(
        Math.min(100, Math.max(1, 72 + noise() * 12 - (p.creep ? 15 : 0) - (p.poorSleep ? 18 : 0)
          - (p.load > 1.5 ? 20 : 0))),
      );
      const level = readiness >= 95 ? "PRIME" : readiness >= 75 ? "HIGH" : readiness >= 50
        ? "MODERATE" : readiness >= 25 ? "LOW" : "POOR";
      const factors = {
        hrvFactorPercent: Math.round(Math.min(100, Math.max(5, 85 + noise() * 10 - (p.hrvLow ? 45 : 0)))),
        sleepScoreFactorPercent: Math.round(Math.min(100, Math.max(5, score + noise() * 5 - 5))),
        recoveryTimeFactorPercent: Math.round(Math.min(100, Math.max(5, 75 + noise() * 15 - (p.load > 1.5 ? 40 : 0)))),
        acwrFactorPercent: Math.round(Math.min(100, Math.max(5, 90 - Math.abs(acute / chronic - 1) * 120))),
      };
      // Garmin's payload varies: usually a one-element list, sometimes empty,
      // a bare object, missing a factor, or (rarely) not JSON at all
      const shape = r();
      const payload = { score: readiness, level, ...factors };
      const rawJson = shape < 0.04 ? '{"readiness": []}'
        : shape < 0.07 ? JSON.stringify({ readiness: payload })
        : shape < 0.1 ? JSON.stringify({ readiness: [{ ...payload, hrvFactorPercent: undefined }] })
        : shape < 0.11 ? "not json"
        : shape < 0.12 ? null
        : JSON.stringify({ readiness: [payload] });

      insertDay.run({
        ...blankDay,
        date,
        resting_hr: gappy(rhr),
        max_hr: gappy(Math.round(150 + r() * 35)),
        min_hr: gappy(rhr - 6),
        hrv_last_night_ms: gappy(hrv, 0.05),
        hrv_status: gappy(p.hrvLow ? "UNBALANCED" : "BALANCED"),
        hrv_baseline_low: gappy(52),
        hrv_baseline_high: gappy(74),
        sleep_score: gappy(score),
        sleep_total_seconds: gappy(Math.round(sleepH * 3600)),
        sleep_deep_seconds: Math.round(sleepH * 3600 * 0.18),
        sleep_rem_seconds: Math.round(sleepH * 3600 * 0.22),
        sleep_light_seconds: Math.round(sleepH * 3600 * 0.55),
        sleep_awake_seconds: Math.round(sleepH * 3600 * 0.05),
        sleep_start: gappy(`${iso(bedT)} ${hhmm(bed)}`),
        sleep_end: `${iso(wakeT)} ${hhmm(wake)}`,
        bb_high: gappy(Math.round(Math.min(100, 70 + noise() * 12))),
        bb_low: Math.round(10 + r() * 20),
        stress_avg: gappy(Math.round(28 + noise() * 6)),
        stress_max: Math.round(85 + r() * 14),
        vo2max_running: gappy(Math.round(p.vo2 * 10) / 10, 0.05),
        training_readiness_score: shape < 0.04 ? null : readiness,
        training_readiness_level: shape < 0.04 ? (r() < 0.5 ? null : "NONE") : level,
        training_status: "MAINTAINING_4",
        acute_load: gappy(Math.round(acute)),
        chronic_load: gappy(Math.round(chronic)),
        steps: gappy(Math.round(8000 + noise() * 2500)),
        floors: Math.round(r() * 15),
        distance_m: Math.round(6000 + r() * 4000),
        calories: Math.round(2300 + r() * 600),
        active_calories: Math.round(400 + r() * 600),
        raw_json: rawJson,
        synced_at: synced,
      });
    }
  })();
  db.close();
}
