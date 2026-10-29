# Garmin Health — web dashboard (Next.js)

The dashboard over `../garmin.db`. It reads the database read-only; the Python
sync (`garmin_health/`) is the only writer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests + the golden test (synthetic data, no garmin.db needed)
npm run smoke      # builds, then requests every page × range and fails on any render error
```

Run `npm run smoke` before committing UI changes: type checks and the build
don't catch render-time errors such as passing a function to a client chart.

Set `GARMIN_DB_PATH` to point at a different database file.

## Layout

```
src/app/            routes: / (Today), /load, /fitness, /sleep, /plan (+ its server actions), manifest, icons
src/components/     AppFrame (shell, nav, range control), SyncPill, Card
src/lib/queries.ts  read-only SQL, shared with the MCP server
src/lib/freshness.ts  is the data current? (the sync pill's rule, shared with the MCP server)
src/lib/db.ts       the app's loaders over queries.ts (awaits connection() so reads are per-request)
src/lib/analytics.ts  pure analytics (rolling, ACWR, weekly aggregates…)
src/lib/verdicts.ts   the rule-based verdict for each page
src/lib/levels.ts     status words and Garmin readiness levels (no UI imports)
src/lib/plans/        the training-plan engine (see Training plans below)
src/lib/plans-db.ts   plans.db for the app (opened per request; reading never creates it)
src/lib/fixture.ts    a synthetic garmin.db for tests
src/lib/__fixtures__/analytics-golden.json  frozen output of the original pandas analytics
src/lib/format.ts     Python-compatible number formatting for verdict sentences
src/lib/range.ts    the 30d/90d/1y/All range, carried in ?range=
src/lib/theme.ts    palette, Mantine theme, status colours
scripts/smoke.mjs   the render check behind `npm run smoke`
src/mcp/server.ts   the MCP server: registers the tools (stdio)
src/mcp/tools.ts    the tools' logic
src/mcp/sql-runner.ts  runs one run_sql query in its own process, so it can be stopped
src/mcp/plan-tools.ts the training-plan tools
src/mcp/chat.ts     the Plan page's chat: Claude with the read-only tools (route: src/app/api/plan-chat)
```

`analytics.golden.test.ts` pins the analytics and verdicts to what the original
pandas/Dash version produced on the synthetic fixture. The Python side is gone,
so the golden file is frozen: when a change breaks it, fix the TypeScript, or
edit the expected values by hand if the rule change is deliberate.

Files in `src/lib/` that the MCP server shares import each other with explicit
`.ts` extensions and no `@/` alias, so plain `node` can run them without a build.

## MCP server

`src/mcp/server.ts` lets Claude query your data with the dashboard's own
analytics and verdicts, and build and manage training plans. It opens
`garmin.db` read-only, writes only to `plans.db`, talks over stdio and needs no
build step:

```bash
node src/mcp/server.ts     # what Claude starts; you don't normally run it yourself
```

| Tool | Answers |
|---|---|
| `get_overview` | the four verdicts, today's readiness, latest readings, and whether the data is current |
| `get_daily_metrics` | one row per day for a date range, chosen metrics in readable units |
| `get_activities` | workouts, newest first, filtered by date, group or type |
| `get_weekly_summary` | per week: training hours, intensity, running km and load ratio next to average readiness, RHR, HRV, sleep |
| `explain_verdict` | why a verdict says what it does: the numbers, the rules (`RULES` in `verdicts.ts`) and which were met |
| `run_sql` | anything else: one read-only `SELECT`, at most 500 rows, stopped after 5 s |
| `get_training_profile` | what the data says you can do now: volume, mix, VO₂max, paces, body state |
| `create_training_plan` | builds and saves a plan (the previous one is archived) |
| `get_training_plan` | the plan against what you did: verdict, sessions with ids, weekly volume, suggestions |
| `edit_training_sessions` | move, rewrite, add, remove or mark sessions, all in one go |
| `adapt_training_plan` | ease the next 7 days to the body's state, or put them back |
| `archive_training_plan` | stop following the active plan (it's kept) |

It's registered for Claude Code in the repo's `.mcp.json` (approve it the first
time `claude` starts here) and for Claude Desktop in
`~/Library/Application Support/Claude/claude_desktop_config.json` under
`mcpServers`, using absolute paths to `node` and the script (restart Claude
Desktop after changing it).

`run_sql` can't write: the connection is read-only with `query_only` on, the
query is wrapped as a subquery so only `SELECT`/`WITH` parses, and the statement
must return rows. Each query runs in a child process that is killed after 5 s,
because a running SQLite query can't be interrupted from JavaScript.

`src/mcp/server.test.ts` drives the tools through a real MCP client over the
synthetic fixture; `src/mcp/tools.test.ts` checks that every explanation agrees
with its verdict across the fixture's whole history.

## Training plans

`src/lib/plans/` builds and keeps training plans. It's shared by the Plan page
(`src/views/Plan.tsx`, actions in `src/app/plan/actions.ts`) and the MCP tools.

```
types.ts     goals, sessions, profile and body-state shapes
profile.ts   the athlete from the data: last 4/12 weeks, activity mix, VO₂max, and
             the body state (ready / normal / caution / recover, from the verdicts' RULES)
paces.ts     training and race paces from VO₂max (Daniels' VDOT model)
generate.ts  the plan: phases, weekly volume, each week's sessions (with the workout in
             detail: warm-up, main set, rounds, cool-down; sets, reps, targets, rest), events, notes
adapt.ts     matching Garmin activities to sessions; easing the next days (and undoing it)
store.ts     plans.db: plans, sessions (each keeps its generated original), change log
service.ts   create / view / adapt / edit, as the app and MCP server call them
```

Plans live in `plans.db`, next to `garmin.db` unless `PLANS_DB_PATH` says
otherwise. The Plan page's forms are server actions with no login, like the
rest of the app: keep it on your Mac or home network. Plans saved before
sessions had workout details get them the first time `plans.db` is opened
(the plan is regenerated from what was asked for and the profile it was built
from; sessions edited by hand keep just their description).

### The Plan page's chat

"Ask about your plan" answers questions about sessions and the plan with
Claude (`claude-sonnet-5-5`, medium effort), using the MCP server's read-only tools
(`src/mcp/chat.ts`): it can't change the plan. It needs an API key:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-…' > web/.env.local   # gitignored; restart the app
```

Each question costs a little, and plan summaries and Garmin readings go to the
Claude API to answer it. Like the rest of the app there's no login, so anyone
who can reach the app can use the chat on your key: keep it on your Mac or
home network. The conversation is kept in the browser tab only.
`src/mcp/chat.test.ts` runs it against a fake API (no key, no network).

`generate.test.ts` checks the rules for every goal with 3 to 7 training days
(dates, hard days never back to back, days per week, time limits, ≤ 10% growth,
deloads, taper) plus personalisation, events and the pace model against
Daniels' tables. `npm run smoke` renders the Plan page with and without a plan,
using a throwaway `plans.db`.
