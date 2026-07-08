"""Themed Plotly figure builders for the Explore pages (dark + vital-green)."""

from __future__ import annotations

import plotly.graph_objects as go

from dashboard import theme as T
from garmin_health import analytics as A

GRID = "rgba(255,255,255,0.05)"


def _base(fig, height, legend=False):
    fig.update_layout(
        height=height, margin=dict(l=42, r=12, t=10, b=28),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=T.MUTED, size=11), hovermode="x unified",
        legend=(dict(orientation="h", yanchor="bottom", y=1.0, x=0,
                     font=dict(color=T.MUTED, size=11), bgcolor="rgba(0,0,0,0)")
                if legend else dict()),
        showlegend=legend,
    )
    fig.update_xaxes(showgrid=False, color=T.FAINT, tickfont=dict(size=10))
    fig.update_yaxes(showgrid=True, gridcolor=GRID, zeroline=False,
                     color=T.FAINT, tickfont=dict(size=10))
    return fig


# --- Recovery ---
def hrv(daily):
    fig = go.Figure()
    if daily["hrv_baseline_high"].notna().any():
        fig.add_trace(go.Scatter(x=daily["date"], y=daily["hrv_baseline_high"],
                                 line=dict(width=0), showlegend=False, hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=daily["date"], y=daily["hrv_baseline_low"], fill="tonexty",
                                 fillcolor="rgba(31,208,130,0.12)", line=dict(width=0),
                                 name="baseline", hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["hrv_last_night_ms"],
                             line=dict(color=T.GREEN, width=2), name="HRV"))
    return _base(fig, 260)


def rhr(daily):
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["resting_hr"], name="daily",
                             line=dict(color=T.RED, width=1), opacity=0.45))
    fig.add_trace(go.Scatter(x=daily["date"], y=A.rolling(daily["resting_hr"], 7),
                             name="7-day", line=dict(color=T.RED, width=3)))
    return _base(fig, 240, legend=True)


def body_battery(daily):
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["bb_high"], name="high",
                             line=dict(color=T.GREEN, width=1.5)))
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["bb_low"], name="low", fill="tonexty",
                             fillcolor="rgba(31,208,130,0.10)", line=dict(color=T.GREEN, width=1)))
    return _base(fig, 240, legend=True)


def stress(daily):
    fig = go.Figure(go.Scatter(x=daily["date"], y=daily["stress_avg"],
                               line=dict(color=T.AMBER, width=2), name="avg stress"))
    return _base(fig, 240)


# --- Training ---
def load(daily):
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["chronic_load"], name="chronic (fitness)",
                             line=dict(color=T.GREEN, width=2)))
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["acute_load"], name="acute (fatigue)",
                             line=dict(color=T.AMBER, width=2)))
    return _base(fig, 260, legend=True)


def acwr(daily):
    fig = go.Figure()
    fig.add_hrect(y0=0.8, y1=1.3, fillcolor="rgba(31,208,130,0.10)", line_width=0)
    fig.add_trace(go.Scatter(x=daily["date"], y=A.acwr(daily),
                             line=dict(color="#AB8FE0", width=2), name="ACWR"))
    fig = _base(fig, 240)
    fig.update_yaxes(rangemode="tozero")
    return fig


def vo2max(daily):
    # forward-fill so the line is continuous across rest-day gaps (VO2max only
    # refreshes after qualifying runs).
    fig = go.Figure(go.Scatter(x=daily["date"], y=daily["vo2max_running"].ffill(),
                               line=dict(color=T.GREEN, width=2), name="VO2max"))
    return _base(fig, 240)


def weekly_distance(acts):
    wk = A.weekly_distance(acts)
    fig = go.Figure(go.Bar(x=wk["week"], y=wk["distance_km"], marker_color=T.GREEN))
    return _base(fig, 240)


# --- Activities ---
_PALETTE = [T.GREEN, T.AMBER, T.BLUE, "#AB8FE0", T.RED, "#E87BA4", "#FFA15A"]


def activities_scatter(acts, types):
    af = acts[acts["activity_type"].isin(types or [])]
    fig = go.Figure()
    for i, typ in enumerate(sorted(af["activity_type"].dropna().unique())):
        sub = af[af["activity_type"] == typ]
        fig.add_trace(go.Scatter(
            x=sub["date"], y=sub["distance_km"], mode="markers", name=typ,
            marker=dict(size=(sub["training_load"].fillna(20) / 8).clip(5, 26),
                        color=_PALETTE[i % len(_PALETTE)]),
            hovertemplate="%{x|%Y-%m-%d}<br>%{y:.1f} km<extra>" + typ + "</extra>",
        ))
    fig = _base(fig, 300, legend=True)
    fig.update_layout(
        hovermode="closest",
        legend=dict(orientation="h", y=1.0, x=0, font=dict(color=T.MUTED, size=10),
                    itemsizing="constant", itemwidth=30),
    )
    return fig


def pace(acts):
    runs = acts[(acts["activity_type"] == "running") & acts["pace_min_per_km"].notna()]
    fig = go.Figure(go.Scatter(x=runs["date"], y=runs["pace_min_per_km"],
                               mode="markers+lines", line=dict(color="#FFA15A")))
    fig = _base(fig, 240)
    fig.update_yaxes(autorange="reversed")
    return fig


# --- Sleep ---
def sleep_stages(daily):
    d = daily.tail(45)
    fig = go.Figure()
    for col, name, color in [("sleep_deep_seconds", "deep", "#1B3A6B"),
                             ("sleep_rem_seconds", "rem", "#576CBC"),
                             ("sleep_light_seconds", "light", "#5B9BD5"),
                             ("sleep_awake_seconds", "awake", "#7A8699")]:
        fig.add_trace(go.Bar(x=d["date"], y=d[col] / 3600, name=name, marker_color=color))
    fig = _base(fig, 280, legend=True)
    fig.update_layout(barmode="stack", hovermode="x")
    return fig


def sleep_score(daily):
    fig = go.Figure(go.Scatter(x=daily["date"], y=daily["sleep_score"],
                               line=dict(color=T.GREEN, width=2), name="sleep score"))
    return _base(fig, 240)
