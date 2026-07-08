"""Garmin Connect login — deliberately isolated.

This is the most fragile part of the project. ``garminconnect`` is an unofficial
library, so when Garmin changes its login internals this is the ONE file to patch
(usually just ``uv lock --upgrade-package garminconnect && uv sync``).

How the login works (handled for us by ``Garmin.login(tokenstore)``):
  1. It first tries to reuse a cached token in TOKEN_DIR — no network login.
  2. If there's no valid token, it logs in with your email/password, calling
     ``_prompt_mfa`` only if your account has 2FA, then saves the token so every
     later run is non-interactive.
"""

from __future__ import annotations

from garminconnect import Garmin

from garmin_health.config import TOKEN_DIR, garmin_credentials


def _prompt_mfa() -> str:
    """Called by garminconnect only when your account requires a 2FA code."""
    return input("Enter the MFA / 2FA code Garmin just sent you: ").strip()


def get_client() -> Garmin:
    """Return a logged-in Garmin client, reusing a cached token when possible."""
    email, password = garmin_credentials()
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)

    client = Garmin(email=email, password=password, prompt_mfa=_prompt_mfa)
    # Loads the cached token if present; otherwise logs in (handling MFA) and
    # writes the token into TOKEN_DIR for next time.
    client.login(str(TOKEN_DIR))
    return client
