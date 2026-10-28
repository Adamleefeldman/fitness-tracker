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
src/app/            routes: / (Today), /load, /fitness, /sleep, manifest, icons
src/components/     AppFrame (shell, nav, range control), SyncPill, Card
src/lib/queries.ts  read-only SQL, shared with the MCP server
src/lib/freshness.ts  is the data current? (the sync pill's rule, shared with the MCP server)
src/lib/db.ts       the app's loaders over queries.ts (awaits connection() so reads are per-request)
src/lib/analytics.ts  pure analytics (rolling, ACWR, weekly aggregates…)
src/lib/verdicts.ts   the rule-based verdict for each page
src/lib/levels.ts     status words and Garmin readiness levels (no UI imports)
src/lib/fixture.ts    a synthetic garmin.db for tests
src/lib/__fixtures__/analytics-golden.json  frozen output of the original pandas analytics
src/lib/format.ts     Python-compatible number formatting for verdict sentences
src/lib/range.ts    the 30d/90d/1y/All range, carried in ?range=
src/lib/theme.ts    palette, Mantine theme, status colours
scripts/smoke.mjs   the render check behind `npm run smoke`
src/mcp/server.ts   the MCP server: registers the tools (stdio)
src/mcp/tools.ts    the tools' logic
```

`analytics.golden.test.ts` pins the analytics and verdicts to what the original
pandas/Dash version produced on the synthetic fixture. The Python side is gone,
so the golden file is frozen: when a change breaks it, fix the TypeScript, or
edit the expected values by hand if the rule change is deliberate.

Files in `src/lib/` that the MCP server shares import each other with explicit
`.ts` extensions and no `@/` alias, so plain `node` can run them without a build.

## MCP server

`src/mcp/server.ts` lets Claude query your data with the dashboard's own
analytics and verdicts. It opens `garmin.db` read-only, talks over stdio and
needs no build step:

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

It's registered for Claude Code in the repo's `.mcp.json` (approve it the first
time `claude` starts here) and for Claude Desktop in
`~/Library/Application Support/Claude/claude_desktop_config.json` under
`mcpServers`, using absolute paths to `node` and the script (restart Claude
Desktop after changing it). `src/mcp/server.test.ts` drives the tools through a
real MCP client over the synthetic fixture; `src/mcp/tools.test.ts` checks that
every explanation agrees with its verdict across the fixture's whole history.
