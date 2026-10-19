# Garmin Health — web dashboard (Next.js)

The React/Next.js port of the Dash dashboard in `../dashboard/`. It reads
`../garmin.db` read-only; the Python sync (`garmin_health/`) remains the only writer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # includes a parity check against the pandas analytics (needs uv + garmin.db)
```

Set `GARMIN_DB_PATH` to point at a different database file.

## Layout

```
src/app/            routes: / (Today), /load, /fitness, /sleep, manifest, icons
src/components/     AppFrame (shell, nav, range control), SyncPill, Card
src/lib/db.ts       SQLite loaders (server-only; awaits connection() so reads are per-request)
src/lib/analytics.ts  pure port of garmin_health/analytics.py (rolling, ACWR, weekly aggregates…)
src/lib/verdicts.ts   pure port of dashboard/verdicts.py
src/lib/format.ts     Python-compatible number formatting for verdict sentences
src/lib/range.ts    the 30d/90d/1y/All range, carried in ?range=
src/lib/theme.ts    palette, Mantine theme, status colours (port of dashboard/theme.py)
scripts/analytics_parity.py  dumps the pandas results the parity test compares against
```
