"""Palette, Mantine theme and status-colour helpers for the dashboard.

Colour language (full traffic light):
  GREEN  = good           AMBER = caution        RED = genuinely bad
  Neutral metrics (RHR, steps, pace, ...) use NEUTRAL/BLUE so alarm colours
  keep their meaning. Zone fills use the *_ZONE rgba variants.
"""

from __future__ import annotations

# --- palette (dark + vital-green) ---
BG = "#0E1217"
SIDEBAR = "#0A0D11"
CARD = "#181D25"
BORDER = "rgba(255,255,255,0.06)"
TEXT = "#EAEDF3"
MUTED = "#9AA3B2"
FAINT = "#66707F"
GREEN = "#1FD082"
AMBER = "#F4B740"
RED = "#F2685C"
BLUE = "#5B9BD5"
PURPLE = "#AB8FE0"
ORANGE = "#FFA15A"
NEUTRAL = "#8A97A8"  # lines for metrics with no good/bad direction
TRACK = "#232A33"

# translucent zone fills for "what good looks like" bands on charts
GREEN_ZONE = "rgba(31,208,130,0.08)"
AMBER_ZONE = "rgba(244,183,64,0.07)"
RED_ZONE = "rgba(242,104,92,0.07)"

STATUS = {"good": GREEN, "caution": AMBER, "bad": RED, "neutral": MUTED}


def rgba(hex_color, alpha):
    """'#1FD082', 0.2 -> 'rgba(31,208,130,0.2)' (for glows, washes, fills)."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"

MANTINE_THEME = {
    "primaryColor": "vital",
    "primaryShade": 6,
    "colors": {
        "vital": ["#E6FBF1", "#C2F4DE", "#97ECC8", "#67E3AF", "#3FDD9B",
                  "#28D98E", "#1FD082", "#17B975", "#0E9D62", "#00854F"],
    },
    "fontFamily": "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    "defaultRadius": "md",
}

# Garmin's training-readiness levels are PRIME · HIGH · MODERATE · LOW · POOR
# (older firmware used VERY_HIGH / VERY_LOW — kept here as aliases so both map).
_LEVELS = {
    "PRIME": ("Prime", "You're primed — go for it"),
    "HIGH": ("High", "Ready to train hard"),
    "MODERATE": ("Moderate", "Listen to your body"),
    "LOW": ("Low", "Keep it easy today"),
    "POOR": ("Poor", "Prioritise recovery"),
    "VERY_HIGH": ("Prime", "You're primed — go for it"),
    "VERY_LOW": ("Poor", "Prioritise recovery"),
}


def level_key(level):
    """Upper-cased readiness level, or "" when missing (None or a pandas NaN)."""
    return level.upper() if isinstance(level, str) else ""


def friendly_level(level):
    return _LEVELS.get(level_key(level), (level.title() if level_key(level) else "—", ""))


def color_for_level(level):
    lvl = level_key(level)
    if lvl in ("PRIME", "HIGH", "VERY_HIGH"):
        return GREEN
    if lvl in ("MODERATE", "MAINTAINING"):
        return AMBER
    if lvl in ("LOW", "POOR", "VERY_LOW"):
        return RED
    return MUTED


def color_for_pct(p):
    try:
        p = float(p)
    except (TypeError, ValueError):
        return MUTED
    return GREEN if p >= 75 else (AMBER if p >= 50 else RED)
