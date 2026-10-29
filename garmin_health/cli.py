"""Command-line entry point.

    uv run python -m garmin_health.cli init-db
    uv run python -m garmin_health.cli backfill --all      # full history (resumable)
    uv run python -m garmin_health.cli backfill --days 30  # recent window
    uv run python -m garmin_health.cli sync                # yesterday + any gaps
    uv run python -m garmin_health.cli inspect 2026-06-26  # show payload shapes
    uv run python -m garmin_health.cli push-workouts --dry-run   # plan runs → watch (preview)
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date

from garmin_health import db, push, sync
from garmin_health.auth import get_client
from garmin_health.client import describe_payloads
from garmin_health.config import PLANS_PATH
from garmin_health.workouts import outline


def cmd_init_db(args):
    conn = db.connect()
    db.init_db(conn)
    print(f"Initialized database at {db.DB_PATH}")


def cmd_backfill(args):
    conn = db.connect()
    db.init_db(conn)
    client = get_client()
    sync.backfill(
        conn, client,
        all_history=args.all, since=args.since, days=args.days, end=args.end,
        force=args.force, pause=args.pause,
    )


def cmd_sync(args):
    conn = db.connect()
    db.init_db(conn)
    client = get_client()
    sync.daily_sync(conn, client, pause=args.pause)


def cmd_inspect(args):
    client = get_client()
    describe_payloads(client, args.date)


def cmd_push_workouts(args):
    if not PLANS_PATH.exists():
        print(f"No plans.db at {PLANS_PATH}: create a plan on the dashboard first.")
        return
    today = date.today().isoformat()
    # a dry run opens plans.db read-only, so it can't change anything
    uri = f"file:{PLANS_PATH}?mode=ro" if args.dry_run else f"file:{PLANS_PATH}"
    conn = sqlite3.connect(uri, uri=True)
    actions = push.plan_actions(conn, today, args.days, only=args.date)
    if not actions:
        print("Garmin Connect already has these runs: nothing to push.")
        return
    for a in actions:
        print(a)
        if args.dry_run and a.workout:
            print("\n".join(f"    {line}" for line in outline(a.workout)))
    if args.dry_run:
        print("Dry run: nothing was sent to Garmin.")
        return
    push.apply(conn, get_client(), actions, pause=args.pause)
    print(f"Done: {len(actions)} change(s) on your Garmin Connect calendar; they reach the watch on its next sync.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="garmin_health", description="Garmin → SQLite sync")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Create the database tables").set_defaults(func=cmd_init_db)

    b = sub.add_parser("backfill", help="Pull a date range of history")
    g = b.add_mutually_exclusive_group()
    g.add_argument("--all", action="store_true", help="Everything available (from earliest activity)")
    g.add_argument("--since", metavar="YYYY-MM-DD", help="Start date")
    g.add_argument("--days", type=int, metavar="N", help="Last N days")
    b.add_argument("--end", metavar="YYYY-MM-DD", help="End date (default: yesterday)")
    b.add_argument("--force", action="store_true", help="Re-fetch dates already stored")
    b.add_argument("--pause", type=float, default=1.0, help="Seconds between days (default 1.0)")
    b.set_defaults(func=cmd_backfill)

    s = sub.add_parser("sync", help="Fetch yesterday + any missing days")
    s.add_argument("--pause", type=float, default=1.0, help="Seconds between days (default 1.0)")
    s.set_defaults(func=cmd_sync)

    i = sub.add_parser("inspect", help="Print raw payload shapes for a date")
    i.add_argument("date", metavar="YYYY-MM-DD", help="Date to inspect")
    i.set_defaults(func=cmd_inspect)

    w = sub.add_parser("push-workouts", help="Put the plan's coming runs on the Garmin calendar and watch")
    w.add_argument("--days", type=int, default=14, help="How many days ahead, from today (default 14)")
    w.add_argument("--date", metavar="YYYY-MM-DD", help="Only this day (to try a single session)")
    w.add_argument("--dry-run", action="store_true", help="Show what would change, step by step, and send nothing")
    w.add_argument("--pause", type=float, default=0.5, help="Seconds between Garmin calls (default 0.5)")
    w.set_defaults(func=cmd_push_workouts)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
