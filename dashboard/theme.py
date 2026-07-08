"""Palette, Mantine theme, and Plotly figure helpers for the dashboard."""

from __future__ import annotations

import plotly.graph_objects as go

# --- palette (matches the approved dark + vital-green mockup) ---
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
TRACK = "#232A33"

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

_LEVELS = {
    "VERY_HIGH": ("Prime", "You're primed — go for it"),
    "HIGH": ("High", "Ready to train hard"),
    "MODERATE": ("Moderate", "Listen to your body"),
    "LOW": ("Low", "Keep it easy today"),
    "VERY_LOW": ("Very low", "Prioritise recovery"),
}


def friendly_level(level):
    return _LEVELS.get((level or "").upper(), ((level or "—").title(), ""))


def color_for_level(level):
    lvl = (level or "").upper()
    if lvl in ("HIGH", "VERY_HIGH"):
        return GREEN
    if lvl in ("MODERATE", "MAINTAINING"):
        return AMBER
    if lvl in ("LOW", "VERY_LOW"):
        return RED
    return MUTED


def color_for_pct(p):
    try:
        p = float(p)
    except (TypeError, ValueError):
        return MUTED
    return GREEN if p >= 75 else (AMBER if p >= 50 else RED)


def _dark(fig, height):
    fig.update_layout(
        height=height, margin=dict(l=0, r=0, t=4, b=0),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=MUTED, size=11), showlegend=False,
    )
    return fig


def sparkline_fig(values, color):
    fig = go.Figure(go.Scatter(
        x=list(range(len(values))), y=values, mode="lines",
        line=dict(color=color, width=2), hoverinfo="skip",
    ))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    fig = _dark(fig, 34)
    fig.update_layout(hovermode=False)
    return fig


def readiness_trend_fig(daily):
    # `daily` is already windowed by the caller (time-range control).
    fig = go.Figure()
    fig.add_hrect(y0=67, y1=100, fillcolor="rgba(31,208,130,0.07)", line_width=0)
    fig.add_hrect(y0=34, y1=67, fillcolor="rgba(244,183,64,0.07)", line_width=0)
    fig.add_hrect(y0=0, y1=34, fillcolor="rgba(242,104,92,0.07)", line_width=0)
    fig.add_trace(go.Scatter(
        x=daily["date"], y=daily["training_readiness_score"], mode="lines",
        line=dict(color=TEXT, width=2), name="readiness",
    ))
    fig = _dark(fig, 180)
    fig.update_yaxes(range=[0, 100], showgrid=False, tickfont=dict(color=FAINT, size=10))
    fig.update_xaxes(showgrid=False, tickfont=dict(color=FAINT, size=10))
    fig.update_layout(margin=dict(l=26, r=8, t=6, b=22), hovermode="x unified")
    return fig
