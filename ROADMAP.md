# Garmin → Claude Health Platform — Build Roadmap

A phased plan to pull your Forerunner 970 data out of Garmin Connect, store it,
visualize it in a dashboard, expose it to Claude over a live connection, and use
Claude to generate and adapt training programs.

Built so each phase teaches one layer of the stack: **Python/APIs → databases →
automation → dashboards → backend/MCP**. You can stop at any phase and still have
a useful tool.

---

## The big picture

```
 Garmin Connect (cloud)
        │   python-garminconnect  (logs in like the phone app)
        ▼
 [ sync.py ]  ── pulls metrics & activities
        │
        ▼
 SQLite database  (your local "source of truth")
        │
        ├──────────────► Next.js dashboard     (charts, trends, recovery)
        │
        └──────────────► MCP server  ───────────► Claude  (chat analysis +
                                                            training programs)
```

Everything starts on your laptop. We graduate to an always-on cloud host only
once it's worth it (see Phase 6).

---

## Tech stack & why

| Layer | Choice | Why this one |
|---|---|---|
| Language | **Python 3.11+** | You already know some; best ecosystem for this. |
| Package/env manager | **`uv`** | Fast, modern Rust-based tool that replaces `pip` + `venv` + `pip-tools`. Manages the virtualenv, a locked dependency file, and even the Python version for you. A good modern skill to build. |
| Get data | **`python-garminconnect`** | Unofficial but the de-facto standard. Free, pulls everything the Connect app sees. No business approval needed. |
| Storage | **SQLite** (then DuckDB for analytics) | Zero setup, one file, real SQL to learn. DuckDB later for fast analytical queries. Migrate to Postgres only when going cloud. |
| Automation | **macOS `launchd`** (you're on a Mac) | Native daily scheduler, no extra software. |
| Dashboard | **Next.js** (React, Mantine, ECharts) | Started in Streamlit, then Dash; moved to Next.js for a phone-friendly app with full control over layout. It reads SQLite directly. |
| Claude link | **MCP server** (Python, `mcp` / FastMCP) | The "live connection" — Claude queries your data directly. |
| Hosting (later) | **Fly.io or Railway + Postgres** | Cheap, beginner-friendly always-on hosting when you want 24/7 freshness. |

### A note on the data source
There is **no official self-serve Garmin API** for individuals — the Health/Connect
Developer Program is a business partnership (OAuth 1.0a, webhooks, approval).
`python-garminconnect` logs in the same way the Connect phone app does and is the
right engine for a personal project. Because it's unofficial, Garmin occasionally
changes login internals and the library gets patched — expect a rare `pip upgrade`.
Use an app-specific approach and never hard-code your password in shared files.

---

## Phase 0 — First contact (½ day) · *Skill: APIs & auth*

**Goal:** authenticate once and print yesterday's sleep + a recent run to your terminal.

1. Install `uv` (one time), then create the project — `uv` makes and manages the
   virtualenv and lockfile for you:
   ```bash
   # install uv (macOS): https://docs.astral.sh/uv/
   curl -LsSf https://astral.sh/uv/install.sh | sh

   uv init garmin-health && cd garmin-health
   uv add garminconnect        # adds the dep, creates .venv + uv.lock automatically
   ```
2. Store credentials safely (a `.env` file you never commit, or macOS Keychain).
3. Write a throwaway `hello.py` that logs in (handles MFA the first time, then
   caches a token) and fetches: yesterday's sleep, steps, HRV, Body Battery, and
   your last activity. Run it with `uv run hello.py` (no manual `activate` needed).

**You'll learn:** modern dependency management with `uv` (lockfiles, reproducible
envs), REST-style API calls, auth/token caching, reading JSON responses.

**Done when:** you see real numbers from your watch in the terminal.

---

## Phase 1 — Store it (1 day) · *Skill: databases*

**Goal:** a local SQLite database that holds your history, updated incrementally.

- Design tables: `daily_metrics` (date, resting_hr, hrv, sleep_score, body_battery,
  stress, vo2max…), `activities` (id, type, start, distance, duration, avg_hr,
  training_load…), and `sync_log`.
- Write `sync.py`: pull a date range, **upsert** (insert-or-update so re-runs are safe),
  record what you synced.
- Backfill your history (Garmin keeps years of data).

**You'll learn:** schema design for time-series data, SQL `INSERT/UPSERT`, idempotent
syncs, primary keys.

**Done when:** `sync.py` can be run twice with no duplicates and your full history is loaded.

---

## Phase 2 — Keep it fresh (½ day) · *Skill: automation*

**Goal:** the database updates itself every morning without you.

- Make `sync.py` "yesterday-aware" (only fetch new days).
- Schedule it with a macOS `launchd` job (a small plist that runs daily, e.g. 7am).
- Log output to a file so you can confirm it ran.

**You'll learn:** schedulers, logging, designing a job that's safe to run unattended.

**Done when:** you wake up and yesterday's data is already there.

---

## Phase 3 — See it (2–3 days) · *Skill: dashboards/frontend*

**Goal:** a visually pleasing local dashboard.

**Done:** built first in Streamlit, then Dash, and now a **Next.js** app in
[`web/`](web/README.md) reading straight from SQLite. Four pages, each answering
one question with a rule-based verdict:
  - **Today** — train hard today? (Garmin readiness and its weakest factor)
  - **Load** — am I overtraining? (acute:chronic load, resting-HR creep, HRV)
  - **Fitness** — am I getting fitter? (VO₂max, running volume, pace)
  - **Sleep** — is my recovery improving? (score, duration, bedtime regularity)
- Run it with `cd web && npm run dev` → http://localhost:3000.

**You'll learn:** turning data into interactive visuals, layout/UX, rolling-window stats.

**Done when:** you'd actually rather check this than open the Connect app.

---

## Phase 4 — Connect Claude (1–2 days) · *Skill: backend / MCP*

**Goal:** the "live MCP connection" — Claude can query your data directly in chat.

- Build a small **MCP server** in Python that exposes tools over your database, e.g.
  `get_daily_metrics(start, end)`, `get_activities(type, n)`,
  `weekly_training_summary()`, `recovery_status()`.
- Register it with the Claude desktop app.
- Now you can ask: *"How did my sleep track with training load over the last 6 weeks?"*
  and Claude answers from your real numbers.

**You'll learn:** what an MCP server is, designing tool interfaces, exposing a backend safely.

**Done when:** Claude answers questions using live data with no copy-paste.

---

## Phase 5 — Training programs (ongoing) · *Skill: applied analysis*

**Goal:** Claude generates and adapts plans from your data.

- Define your inputs: goal race/distance, weekly availability, current VO2max,
  recent volume, recovery trends.
- Use the MCP tools so Claude builds a plan grounded in *your* load and recovery,
  then re-checks weekly and adjusts (deload if HRV/sleep dip, progress if you're fresh).
- Optionally write plans back into a `training_plan` table the dashboard displays.

**You'll learn:** translating metrics into decisions, closing the loop between data and action.

---

## Phase 6 — Go always-on (optional) · *Skill: deployment*

Only worth it once you want 24/7 freshness or access away from your laptop.

- Migrate SQLite → **Postgres**.
- Deploy `sync.py` (scheduled) + dashboard to **Fly.io** or **Railway**.
- Put auth/secrets in the host's secret store.

**You'll learn:** cloud deployment, managed databases, secret management, environment parity.

---

## Suggested order & pace

Local first, all the way through Phase 5 — that gives you the full tool (dashboard +
Claude + training plans) with nothing to pay for or maintain in the cloud. Treat
Phase 6 as a "graduation" project once everything works locally and you want it to
follow you around.

A comfortable pace: Phases 0–2 in a weekend (you'll have a self-updating database),
Phase 3 the following week (the dashboard), Phases 4–5 after that (Claude integration).

---

## Risks & gotchas

- **Login changes:** unofficial library; if a sync suddenly fails, upgrade it first
  with `uv lock --upgrade-package garminconnect && uv sync`. Keep auth in one place
  so fixes are easy.
- **Rate limiting:** don't hammer Garmin — backfill in chunks, then only sync new days.
- **Credentials:** never commit your password/token. Use `.env` + `.gitignore` or Keychain.
- **Data gaps:** the watch occasionally misses a metric; design the dashboard to
  tolerate missing values.

---

*Next step: Phase 0. I can set up the project and write the first working script
that prints your real Garmin data — just say go.*