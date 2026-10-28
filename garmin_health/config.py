"""Central configuration: where things live and how to read your credentials.

One place to change a path or a credential rule, so the rest of the code never
hard-codes file locations. Values come from a gitignored ``.env`` at the repo root.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Repo root is the directory that contains this package (…/garmin-health/).
ROOT = Path(__file__).resolve().parent.parent

# Load .env from the repo root. No-op if the file doesn't exist yet.
load_dotenv(ROOT / ".env")

# SQLite database — your local source of truth (Phase 1+). GARMIN_DB_PATH
# overrides it (the web app reads the same variable).
DB_PATH = Path(os.environ.get("GARMIN_DB_PATH") or ROOT / "garmin.db")

# Where garminconnect caches your login token so you don't re-auth every run.
# Gitignored — it holds session tokens, not your password.
TOKEN_DIR = ROOT / ".garminconnect"

# Where unattended sync logs land (Phase 2).
LOG_DIR = ROOT / "logs"


def garmin_credentials() -> tuple[str, str]:
    """Return (email, password) from the environment, or raise a clear error.

    Empty values are treated as missing so a half-filled .env fails loudly with
    a helpful message instead of a confusing Garmin auth error.
    """
    email = os.getenv("GARMIN_EMAIL", "").strip()
    password = os.getenv("GARMIN_PASSWORD", "").strip()
    if not email or not password:
        raise RuntimeError(
            "Missing Garmin credentials. Copy .env.example to .env (or edit the "
            "existing .env) and set GARMIN_EMAIL and GARMIN_PASSWORD."
        )
    return email, password
