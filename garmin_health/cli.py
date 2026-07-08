"""Command-line entry point.

    uv run python -m garmin_health.cli init-db
    uv run python -m garmin_health.cli backfill --all      # full history (resumable)
    uv run python -m garmin_health.cli backfill --days 30  # recent window
    uv run python -m garmin_health.cli sync                # yesterday + any gaps
    uv run python -m garmin_health.cli inspect 2026-06-26  # show payload shapes
"""

from __future__ import annotations

import argparse

from garmin_health import db, sync
from garmin_health.auth import get_client
from garmin_health.client import describe_payloads


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

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
