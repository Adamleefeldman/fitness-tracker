# Garmin Health

Pull your Garmin Connect data (Forerunner 970) into a local database, keep it
fresh automatically, explore it in a dashboard, and query it with Claude. Everything runs locally on your Mac; the only data that leaves it is
what Claude's MCP tools return when you ask Claude about your data.

**Status:** Phases 0–4 complete — a self-updating local database, a dashboard, and
Claude connected to your data over MCP. See
[ROADMAP.md](ROADMAP.md) for the vision and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
for the detailed build.

```
 Garmin Connect ──python-garminconnect──> sync ──> SQLite (garmin.db)
                                                      │
                                       ┌──────────────┼──────────────┐
                                  Next.js           MCP server      (your queries)
                                  dashboard         → Claude
                                  (web/)            (web/src/mcp/)
```

## What's built today

- **`garmin.db`** — a SQLite database with one row per day of metrics
  (sleep, HRV, resting HR, Body Battery, stress, VO2max, training readiness,
  training load, steps, SpO2…) plus a row per activity (runs, HIIT, etc.).
- **Idempotent, resumable sync** — re-running never duplicates, an interrupted
  backfill resumes, and a missing metric never erases a previously-good value.
- **Dashboard** — a Next.js app in [`web/`](web/README.md) with four pages
  (Today, Load, Fitness, Sleep), each answering one question with a verdict.
- **Claude connection** — an MCP server with six read-only tools, so Claude Code
  and Claude Desktop can answer questions from your data with the dashboard's
  own verdicts. See [Ask Claude](#ask-claude).
- **Daily auto-sync** (optional) — a `launchd` job refreshes yesterday's data
  every morning. See [automation/README.md](automation/README.md).

## Setup

Prereqs: macOS, [`uv`](https://docs.astral.sh/uv/), Python 3.12 (uv manages it).

```bash
# 1. Install dependencies into a managed virtualenv
uv sync

# 2. Add your Garmin login (this file is gitignored)
cp .env.example .env
#   then edit .env and set GARMIN_EMAIL / GARMIN_PASSWORD

# 3. First contact — prints yesterday's numbers from your watch.
#    The first run may prompt once for a 2FA code, then caches a token.
uv run python hello.py
```

## Usage

```bash
# Create the database tables
uv run python -m garmin_health.cli init-db

# Backfill history (resumable; safe to re-run)
uv run python -m garmin_health.cli backfill --all        # everything available
uv run python -m garmin_health.cli backfill --days 30    # last 30 days
uv run python -m garmin_health.cli backfill --since 2026-01-01

# Daily update — fetches yesterday + any days missed since the last sync
uv run python -m garmin_health.cli sync

# Diagnose: print the raw shape of each Garmin endpoint for a date
uv run python -m garmin_health.cli inspect 2026-06-27

# Dashboard (needs Node.js) → http://localhost:3000
cd web && npm install && npm run dev
```

## Ask Claude

The MCP server in `web/src/mcp/` gives Claude six read-only tools: an overview
with the dashboard's verdicts, daily metrics, activities, a weekly summary, an
explanation of any verdict, and read-only SQL for everything else.

- **Claude Code:** registered in `.mcp.json`. Start `claude` from the repo root
  and approve `garmin-health` the first time.
- **Claude Desktop:** add it under `mcpServers` in
  `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart
  the app:

  ```json
  "garmin-health": {
    "command": "/opt/homebrew/bin/node",
    "args": ["/Users/adamfeldman/garmin-health/web/src/mcp/server.ts"]
  }
  ```

Then ask things like *"How's my recovery looking?"* or *"How did my sleep track
with training load over the last 6 weeks?"* Details are in
[web/README.md](web/README.md#mcp-server).

## Data model

| Table | Grain | Holds |
|---|---|---|
| `daily_metrics` | one row per date | sleep, HRV, RHR, Body Battery, stress, VO2max, readiness, training status & load, steps, SpO2, respiration, `raw_json` |
| `activities` | one row per workout | type, distance, duration, pace, HR, elevation, training load, training effect, `raw_json` |
| `sync_log` | one row per sync run | range, counts, status — makes backfills resumable & auditable |

Every metric column is nullable (the watch misses metrics on some days), and the
trimmed `raw_json` lets columns be re-derived later without re-fetching from Garmin.

## Project layout

```
garmin_health/        package
  config.py           paths + credential loading (.env)
  auth.py             Garmin login: token cache + MFA (the one fragile file)
  schema.sql          table definitions
  db.py               connection + idempotent upserts
  client.py           flattens Garmin JSON → clean rows
  sync.py             backfill + gap-aware daily sync
  cli.py              command-line entry point
hello.py              Phase 0 first contact (first login + 2FA)
automation/           Phase 2 launchd scheduler + install guide
web/                  Phase 3 dashboard (Next.js) and Phase 4 MCP server, read garmin.db
.mcp.json             registers the MCP server with Claude Code
```

## Troubleshooting

- **Login suddenly fails** — `python-garminconnect` is unofficial; Garmin changed
  something. Fix: `uv lock --upgrade-package garminconnect && uv sync`, then re-run.
- **`Too many requests`** — you've been rate-limited. Wait a few minutes; the
  backfill is resumable, so just re-run it.
- **A metric shows blank for a day** — usually legitimate (watch not worn, or the
  metric wasn't computed that day). The schema tolerates it.
- **Missing credentials error** — fill in `GARMIN_EMAIL` / `GARMIN_PASSWORD` in `.env`.

## Security

`.env` (your password), `garmin.db` (your data), and `.garminconnect/` (your
session token) are all gitignored and never leave your machine. The MCP server
(`web/src/mcp/`) opens `garmin.db` read-only and has no network port; what its
tools return becomes part of your Claude conversation.
