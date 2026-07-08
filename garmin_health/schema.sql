-- Garmin health data — SQLite schema.
-- Every metric column is nullable: the watch drops metrics on some days, and we
-- never want a missing value to break a sync. `raw_json` stores the original
-- Garmin payloads so columns can be re-derived later without re-fetching.

CREATE TABLE IF NOT EXISTS daily_metrics (
    date TEXT PRIMARY KEY,            -- 'YYYY-MM-DD' (one row per day)

    -- heart
    resting_hr INTEGER,
    max_hr INTEGER,
    min_hr INTEGER,

    -- heart-rate variability (recovery)
    hrv_last_night_ms INTEGER,
    hrv_status TEXT,
    hrv_baseline_low INTEGER,
    hrv_baseline_high INTEGER,

    -- sleep
    sleep_score INTEGER,
    sleep_total_seconds INTEGER,
    sleep_deep_seconds INTEGER,
    sleep_rem_seconds INTEGER,
    sleep_light_seconds INTEGER,
    sleep_awake_seconds INTEGER,
    sleep_start TEXT,
    sleep_end TEXT,

    -- body battery
    bb_high INTEGER,
    bb_low INTEGER,
    bb_charged INTEGER,
    bb_drained INTEGER,

    -- stress
    stress_avg INTEGER,
    stress_max INTEGER,

    -- fitness / training load
    vo2max_running REAL,
    vo2max_cycling REAL,
    training_readiness_score INTEGER,
    training_readiness_level TEXT,
    training_status TEXT,
    acute_load REAL,
    chronic_load REAL,

    -- activity volume
    steps INTEGER,
    floors INTEGER,
    distance_m REAL,
    calories INTEGER,
    active_calories INTEGER,

    -- misc wellness
    spo2_avg INTEGER,
    respiration_avg REAL,
    weight_g REAL,
    body_fat_pct REAL,

    -- bookkeeping
    raw_json TEXT,
    synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    activity_id INTEGER PRIMARY KEY,
    date TEXT,
    start_time_local TEXT,
    start_time_gmt TEXT,
    activity_type TEXT,
    name TEXT,
    distance_m REAL,
    duration_s REAL,
    moving_duration_s REAL,
    avg_pace_s_per_km REAL,
    avg_hr REAL,
    max_hr REAL,
    elevation_gain_m REAL,
    elevation_loss_m REAL,
    calories REAL,
    training_load REAL,
    aerobic_te REAL,
    anaerobic_te REAL,
    avg_cadence REAL,
    avg_power REAL,
    vo2max REAL,
    raw_json TEXT,
    synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);

-- One row per sync run. Lets a backfill resume after an interruption and makes
-- unattended runs auditable.
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,              -- 'backfill' | 'daily'
    date_from TEXT,
    date_to TEXT,
    days_synced INTEGER DEFAULT 0,
    activities_synced INTEGER DEFAULT 0,
    status TEXT,                     -- 'running' | 'ok' | 'partial' | 'error'
    error_message TEXT,
    run_started_at TEXT,
    run_finished_at TEXT
);
