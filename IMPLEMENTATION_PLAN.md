# Implementation Plan — Garmin → Claude Health Partner

Companion to [ROADMAP.md](ROADMAP.md). The roadmap is the *what & why*; this is the
*how* — concrete files, schema, and build order, with the decisions we made locked in.

---

## Decisions locked

| Decision | Choice | Consequence |
|---|---|---|
| Working style | **Build + explain** | Claude writes the code and narrates key decisions |
| First milestone | **Phase 0–2** | Auth → backfill → daily auto-sync now; phases 3–6 planned |
| Optimize for | **All four goals** (race training, recovery/readiness, health trends, Claude/MCP) | Schema + MCP tools designed *broad* from day one |
| Skill level | **Beginner→intermediate** | Clear structure, no unexplained magic |
| Secrets | **`.env`** (gitignored) | `python-dotenv` + committed `.env.example` |
| Garmin 2FA | **Unknown** | Login handles MFA *and* plain, then caches a token |
| Backfill depth | **Everything available** | Chunked, resumable, gentle on Garmin's servers |
| Claude target | **Decide at Phase 4** | MCP server built first; Desktop/Code registration deferred |
| Live login | **User runs it** | Claude writes all code; user puts creds in `.env` and runs commands |

---

## Architecture & project structure

```
garmin-health/
├── .env                     # gitignored — GARMIN_EMAIL, GARMIN_PASSWORD
├── .env.example             # committed template
├── garmin.db                # SQLite source of truth (gitignored)
├── garmin_health/           # the package (importable from repo root)
│   ├── config.py            # loads .env, defines DB_PATH / TOKEN_DIR
│   ├── auth.py              # login + token cache + MFA handling  ← isolated on purpose
│   ├── schema.sql           # all table definitions in one readable place
│   ├── db.py                # connect, init schema, upsert helpers, sync_log
│   ├── client.py            # thin wrappers that flatten Garmin's JSON → clean dicts
│   ├── sync.py              # backfill + daily orchestration (idempotent, resumable)
│   └── cli.py               # `init-db`, `backfill`, `sync` subcommands
├── hello.py                 # Phase 0 throwaway: print yesterday's numbers
├── automation/              # Phase 2 launchd plist (template + install notes)
├── app.py                   # Phase 3 Streamlit (later)
└── mcp_server.py            # Phase 4 MCP (later)
```

**Why a package + thin entry scripts:** running `uv run python hello.py` from the repo
root makes `garmin_health` importable with zero packaging config. Keeping **`auth.py`
isolated** is deliberate — it's the piece most likely to break when Garmin changes login
internals, so every fix lands in one file.

---

## Data model

Nullable everywhere (the watch drops metrics some days), with a `raw_json` column on the
data tables so we can add columns later **without re-hitting Garmin**. Upserts use SQLite
`INSERT … ON CONFLICT DO UPDATE` so re-runs never duplicate.

### `daily_metrics` (one row per date)
- **Heart:** `resting_hr`, `max_hr`, `min_hr`
- **HRV:** `hrv_last_night_ms`, `hrv_status`, `hrv_baseline_low/high`
- **Sleep:** `sleep_score`, `total/deep/light/rem/awake_seconds`, `sleep_start/end`
- **Body Battery:** `bb_high`, `bb_low`, `bb_charged`, `bb_drained`
- **Stress:** `stress_avg/max`, `rest/low/medium/high_stress_seconds`
- **Fitness:** `vo2max_running`, `vo2max_cycling`, `training_readiness_score/level/feedback`,
  `training_status`, `acute_load`, `chronic_load`
- **Activity volume:** `steps`, `floors`, `distance_m`, `calories`, `active_calories`
- **Misc:** `spo2_avg/low`, `respiration_avg`, `weight_g`, `body_fat_pct`
- `raw_json`, `synced_at`

### `activities` (one row per workout)
`activity_id` (PK), `date`, `start_time_local`, `activity_type`, `name`, `distance_m`,
`duration_s`, `avg_pace_s_per_km`, `avg_hr`, `max_hr`, `elevation_gain_m`, `calories`,
`training_load`, `aerobic_te`, `anaerobic_te`, `avg_cadence`, `avg_power`, `vo2max`, `raw_json`

### `sync_log` (makes backfill resumable + syncs auditable)
`id`, `kind` (backfill/daily), `date_from`, `date_to`, `days_synced`, `activities_synced`,
`status` (ok/partial/error), `error_message`, `run_started_at`, `run_finished_at`

### Phase 5 adds
`training_plan` and `planned_workout` tables (defined when we reach Phase 5).

---

## Phase-by-phase

### Phase 0 — First contact (½ day) — *building now*
1. `uv add python-dotenv`; create `.env` + `.env.example`; harden `.gitignore`.
2. `config.py` (paths/env) → `auth.py`: `get_client()` resumes from a cached token if
   present; else logs in; if Garmin demands MFA, prompts once for the code, then **caches
   the session** so every later run is non-interactive.
3. `hello.py` pulls yesterday's sleep, stats, HRV, VO2max, training readiness, resting HR,
   and your last activity, then pretty-prints.
- **Done when:** real numbers from your watch print in the terminal.

### Phase 1 — Store it (1 day) — *building now*
1. `schema.sql` + `db.py` (`init_db`, `upsert_daily`, `upsert_activity`, `log_sync`).
2. `client.py` flattens Garmin's nested JSON into clean, None-safe row dicts.
3. `sync.py` `backfill()`: find earliest activity (page `get_activities` backward), walk
   forward day-by-day with a short pause, checkpoint each day to `sync_log`, skip dates
   already stored so an interrupted backfill resumes. `cli.py` wires the subcommands.
- **Done when:** run twice → zero duplicates; full history loaded.

### Phase 2 — Keep it fresh (½ day) — *building now*
1. `sync` becomes "gap-aware": fetches yesterday + any missing days since the last `ok`.
2. `automation/…plist` runs `uv run python -m garmin_health.cli sync` daily at 7am,
   logging to `logs/sync.log`; install via `launchctl load`.
- **Done when:** you wake up and yesterday's data is already there.

### Phase 3 — Dashboard (later)
`uv add streamlit pandas plotly`. Overview (load, HRV/Body Battery, sleep, RHR with rolling
averages + calendar heatmap), Activity explorer, Readiness panel (sleep + HRV + load +
Garmin training readiness).

### Phase 4 — MCP (later)
Read-only `mcp_server.py` exposing `get_daily_metrics`, `get_activities`,
`weekly_training_summary`, `recovery_status`, `trend(metric, window)`. Register with Claude
Desktop and/or Claude Code — decided at this phase.

### Phase 5 — Training programs (ongoing)
`training_plan` + `planned_workout` tables; Claude builds a plan from goal race/date +
availability + VO2max + load + recovery, re-checks weekly (deload if HRV/sleep dip).

### Phase 6 — Always-on (optional)
SQLite→Postgres, deploy sync + dashboard to Fly/Railway, secrets in the host store.

---

## Risks & mitigations

- **Login breakage** (unofficial lib): all auth isolated in `auth.py`; fix with
  `uv lock --upgrade-package garminconnect && uv sync`.
- **Full backfill / rate limits:** chunked, paced, resumable via `sync_log`, backoff on errors.
- **MFA uncertainty:** interactive first run, then token cache; non-interactive thereafter.
- **Data gaps:** nullable columns + None-safe flattening everywhere.

---

## How credentials & running work

Claude writes every file. **You** create `.env` from `.env.example`, paste your Garmin
email/password, and run the commands (e.g. `uv run python hello.py`) — your password never
passes through Claude. The first run may prompt for a one-time MFA code; after that a cached
token makes runs non-interactive.

---

## Build order (Phase 0–2)

1. `.gitignore` patch + `.env` scaffold → 2. `config.py` → 3. `auth.py` → 4. `hello.py`
→ *(you run it; confirm real numbers)* → 5. `schema.sql` + `db.py` → 6. `client.py` +
`sync.py` + `cli.py` → *(backfill)* → 7. gap-aware `sync` → 8. `launchd` automation.
