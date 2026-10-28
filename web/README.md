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
src/lib/db.ts       SQLite loaders (server-only; awaits connection() so reads are per-request)
src/lib/analytics.ts  pure analytics (rolling, ACWR, weekly aggregates…)
src/lib/verdicts.ts   the rule-based verdict for each page
src/lib/fixture.ts    a synthetic garmin.db for tests
src/lib/__fixtures__/analytics-golden.json  frozen output of the original pandas analytics
src/lib/format.ts     Python-compatible number formatting for verdict sentences
src/lib/range.ts    the 30d/90d/1y/All range, carried in ?range=
src/lib/theme.ts    palette, Mantine theme, status colours
scripts/smoke.mjs   the render check behind `npm run smoke`
```

`analytics.golden.test.ts` pins the analytics and verdicts to what the original
pandas/Dash version produced on the synthetic fixture. The Python side is gone,
so the golden file is frozen: when a change breaks it, fix the TypeScript, or
edit the expected values by hand if the rule change is deliberate.
