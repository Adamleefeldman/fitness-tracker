"""SQLite access: connection, schema init, and idempotent upserts.

The upsert uses ``INSERT … ON CONFLICT DO UPDATE`` so re-running a sync never
creates duplicates. For metric columns it keeps an existing non-null value when a
re-fetch returns null (``COALESCE``), so a flaky day never erases good data;
``raw_json`` and ``synced_at`` always take the latest value.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from garmin_health.config import DB_PATH

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# Columns that should always take the freshest value rather than COALESCE.
_ALWAYS_OVERWRITE = {"raw_json", "synced_at"}


def connect(db_path=None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path) if db_path is not None else DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")  # lets the dashboard read while we write
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text())
    conn.commit()


def _upsert(conn, table, key, row: dict) -> None:
    cols = list(row.keys())
    collist = ", ".join(cols)
    placeholders = ", ".join("?" for _ in cols)
    updates = []
    for c in cols:
        if c == key:
            continue
        if c in _ALWAYS_OVERWRITE:
            updates.append(f"{c}=excluded.{c}")
        else:
            updates.append(f"{c}=COALESCE(excluded.{c}, {table}.{c})")
    sql = (
        f"INSERT INTO {table} ({collist}) VALUES ({placeholders}) "
        f"ON CONFLICT({key}) DO UPDATE SET {', '.join(updates)}"
    )
    conn.execute(sql, [row[c] for c in cols])


def upsert_daily(conn, row: dict) -> None:
    _upsert(conn, "daily_metrics", "date", row)


def upsert_activity(conn, row: dict) -> None:
    _upsert(conn, "activities", "activity_id", row)


def existing_metric_dates(conn) -> set[str]:
    return {r[0] for r in conn.execute("SELECT date FROM daily_metrics")}


def last_metric_date(conn):
    row = conn.execute("SELECT MAX(date) FROM daily_metrics").fetchone()
    return row[0] if row and row[0] else None


def start_sync(conn, kind, date_from, date_to) -> int:
    cur = conn.execute(
        "INSERT INTO sync_log (kind, date_from, date_to, status, run_started_at) "
        "VALUES (?, ?, ?, 'running', datetime('now'))",
        (kind, date_from, date_to),
    )
    conn.commit()
    return cur.lastrowid


def finish_sync(conn, sync_id, status, days, activities, error=None) -> None:
    conn.execute(
        "UPDATE sync_log SET status=?, days_synced=?, activities_synced=?, "
        "error_message=?, run_finished_at=datetime('now') WHERE id=?",
        (status, days, activities, error, sync_id),
    )
    conn.commit()
