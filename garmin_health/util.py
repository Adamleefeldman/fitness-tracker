"""Small shared helpers used across modules."""

from __future__ import annotations

from datetime import date, timedelta


def dig(obj, *path, default=None):
    """Safely walk nested dict/list structures; return default on any miss."""
    cur = obj
    for key in path:
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return default
    return default if cur is None else cur


def first_present(obj, paths, default=None):
    """Return the first non-None value among several dig-paths.

    `paths` is a list of tuples, each a path passed to `dig`. Useful for fields
    whose exact location varies by firmware (e.g. VO2max).
    """
    for p in paths:
        value = dig(obj, *p)
        if value is not None:
            return value
    return default


def daterange(start: date, end: date):
    """Yield each date from `start` to `end` inclusive."""
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)
