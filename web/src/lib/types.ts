/** Row shapes for garmin.db (see garmin_health/schema.sql), plus derived fields. */

/** One row of daily_metrics (see garmin_health/schema.sql). Every metric is nullable. */
export interface DailyRow {
  date: string; // 'YYYY-MM-DD'
  resting_hr: number | null;
  max_hr: number | null;
  min_hr: number | null;
  hrv_last_night_ms: number | null;
  hrv_status: string | null;
  hrv_baseline_low: number | null;
  hrv_baseline_high: number | null;
  sleep_score: number | null;
  sleep_total_seconds: number | null;
  sleep_deep_seconds: number | null;
  sleep_rem_seconds: number | null;
  sleep_light_seconds: number | null;
  sleep_awake_seconds: number | null;
  sleep_start: string | null;
  sleep_end: string | null;
  bb_high: number | null;
  bb_low: number | null;
  bb_charged: number | null;
  bb_drained: number | null;
  stress_avg: number | null;
  stress_max: number | null;
  vo2max_running: number | null;
  vo2max_cycling: number | null;
  training_readiness_score: number | null;
  training_readiness_level: string | null;
  training_status: string | null;
  acute_load: number | null;
  chronic_load: number | null;
  steps: number | null;
  floors: number | null;
  distance_m: number | null;
  calories: number | null;
  active_calories: number | null;
  spo2_avg: number | null;
  respiration_avg: number | null;
  weight_g: number | null;
  body_fat_pct: number | null;
  raw_json: string | null;
  synced_at: string;
}

/** One row of activities. */
export interface ActivityRow {
  activity_id: number;
  date: string | null;
  start_time_local: string | null;
  start_time_gmt: string | null;
  activity_type: string | null;
  name: string | null;
  distance_m: number | null;
  duration_s: number | null;
  moving_duration_s: number | null;
  avg_pace_s_per_km: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  calories: number | null;
  training_load: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
  avg_cadence: number | null;
  avg_power: number | null;
  vo2max: number | null;
  raw_json: string | null;
  synced_at: string;
}

/** A daily row with derived conveniences (see analytics.withDailyDerived). */
export type Daily = DailyRow & { sleep_hours: number | null };

/** An activity row with derived conveniences (see analytics.withActivityDerived). */
export type Activity = ActivityRow & { distance_km: number | null; pace_min_per_km: number | null };
