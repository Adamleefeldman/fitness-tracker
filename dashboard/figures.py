"""Themed Plotly figure builders — the single figure-styling system.

Conventions (see theme.py for the colour language):
  - context zones (hrect fills) say what good looks like wherever a metric
    has an accepted healthy range; the line itself stays neutral so the
    zones carry the judgement.
  - white/TEXT lines = "the metric being judged"; coloured lines are only
    used where colour itself encodes meaning (traffic light or category).
"""

from __future__ import annotations

import plotly.graph_objects as go

from dashboard import theme as T
from garmin_health import analytics as A

GRID = "rgba(255,255,255,0.04)"


def _fade(color, top_alpha=0.18):
    """Vertical gradient fill fading a colour down to transparent."""
    return dict(type="vertical",
                colorscale=[[0, "rgba(0,0,0,0)"], [1, T.rgba(color, top_alpha)]])


def _zone_label(fig, text, y, color, x=1.0):
    fig.add_annotation(
        xref="x domain", yref="y", x=x, y=y, text=text, showarrow=False,
        font=dict(color=T.rgba(color, 0.55), size=10), xanchor="right",
    )


def _base(fig, height, legend=False):
    fig.update_layout(
        height=height, margin=dict(l=42, r=12, t=10, b=28),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=T.MUTED, size=11), hovermode="x unified",
        hoverlabel=dict(bgcolor=T.CARD, bordercolor=T.BORDER,
                        font=dict(color=T.TEXT, size=11)),
        legend=(dict(orientation="h", yanchor="bottom", y=1.0, x=0,
                     font=dict(color=T.MUTED, size=11), bgcolor="rgba(0,0,0,0)")
                if legend else dict()),
        showlegend=legend,
    )
    fig.update_xaxes(showgrid=False, color=T.FAINT, tickfont=dict(size=10))
    fig.update_yaxes(showgrid=True, gridcolor=GRID, zeroline=False,
                     color=T.FAINT, tickfont=dict(size=10))
    return fig


# --- small figures used on the Today page ---------------------------------

def sparkline(values, color):
    n = len(values)
    fig = go.Figure()
    if n:  # invisible floor at the series minimum so the fill hugs the line
        lo = min(values)
        fig.add_trace(go.Scatter(x=[0, n - 1], y=[lo, lo], mode="lines",
                                 line=dict(width=0), hoverinfo="skip"))
    fig.add_trace(go.Scatter(
        x=list(range(n)), y=values, mode="lines",
        line=dict(color=color, width=2), hoverinfo="skip",
        fill="tonexty" if n else None, fillgradient=_fade(color, 0.22) if n else None,
    ))
    if n:  # glowing dot on the latest value so "now" is anchored
        fig.add_trace(go.Scatter(x=[n - 1], y=[values[-1]], mode="markers",
                                 marker=dict(color=T.rgba(color, 0.25), size=11),
                                 hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=[n - 1], y=[values[-1]], mode="markers",
                                 marker=dict(color=color, size=5), hoverinfo="skip"))
    fig.update_xaxes(visible=False)
    fig.update_yaxes(visible=False)
    fig.update_layout(height=34, margin=dict(l=0, r=2, t=4, b=0),
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      showlegend=False, hovermode=False)
    return fig


def readiness_trend(daily):
    fig = go.Figure()
    fig.add_hrect(y0=67, y1=100, fillcolor=T.GREEN_ZONE, line_width=0)
    fig.add_hrect(y0=34, y1=67, fillcolor=T.AMBER_ZONE, line_width=0)
    fig.add_hrect(y0=0, y1=34, fillcolor=T.RED_ZONE, line_width=0)
    fig.add_trace(go.Scatter(
        x=daily["date"], y=daily["training_readiness_score"], mode="lines",
        line=dict(color=T.TEXT, width=2), name="readiness",
        hovertemplate="%{y:.0f}<extra></extra>",
    ))
    _zone_label(fig, "ready", 92, T.GREEN)
    _zone_label(fig, "rest", 10, T.RED)
    fig = _base(fig, 190)
    fig.update_yaxes(range=[0, 100], showgrid=False)
    fig.update_layout(margin=dict(l=30, r=8, t=6, b=22))
    return fig


# --- Sleep & Recovery ------------------------------------------------------

def hrv(daily):
    fig = go.Figure()
    if daily["hrv_baseline_high"].notna().any():
        b = daily.dropna(subset=["hrv_baseline_low", "hrv_baseline_high"])
        fig.add_trace(go.Scatter(x=b["date"], y=b["hrv_baseline_high"],
                                 line=dict(width=1, color="rgba(31,208,130,0.35)"),
                                 showlegend=False, hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=b["date"], y=b["hrv_baseline_low"], fill="tonexty",
                                 fillcolor=T.GREEN_ZONE,
                                 line=dict(width=1, color="rgba(31,208,130,0.35)"),
                                 name="your baseline", hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["hrv_last_night_ms"],
                             line=dict(color=T.TEXT, width=2), name="HRV",
                             hovertemplate="%{y:.0f} ms<extra>HRV</extra>"))
    return _base(fig, 260, legend=True)


def body_battery(daily):
    d = daily.dropna(subset=["bb_low", "bb_high"])
    fig = go.Figure(go.Bar(
        x=d["date"], y=d["bb_high"] - d["bb_low"], base=d["bb_low"],
        marker=dict(color="rgba(31,208,130,0.45)", line_width=0),
        customdata=d[["bb_low", "bb_high"]],
        hovertemplate="%{customdata[1]:.0f} high · %{customdata[0]:.0f} low"
                      "<extra>Body Battery</extra>",
        name="daily range",
    ))
    fig = _base(fig, 240)
    fig.update_yaxes(range=[0, 100])
    fig.update_layout(bargap=0.35, hovermode="x")
    return fig


def stress(daily):
    fig = go.Figure(go.Scatter(x=daily["date"], y=daily["stress_avg"],
                               line=dict(color=T.AMBER, width=2), name="avg stress",
                               hovertemplate="%{y:.0f}<extra>avg stress</extra>",
                               fill="tozeroy", fillgradient=_fade(T.AMBER, 0.14)))
    return _base(fig, 220)


def sleep_stages(daily):
    d = daily.tail(45)
    fig = go.Figure()
    for col, name, color in [("sleep_deep_seconds", "deep", "#2C5F9E"),
                             ("sleep_rem_seconds", "rem", "#7C8EE8"),
                             ("sleep_light_seconds", "light", "#B7C4F0"),
                             ("sleep_awake_seconds", "awake", "#66707F")]:
        fig.add_trace(go.Bar(x=d["date"], y=d[col] / 3600, name=name, marker_color=color,
                             hovertemplate="%{y:.1f}h<extra>" + name + "</extra>"))
    fig = _base(fig, 280, legend=True)
    fig.update_layout(barmode="stack", hovermode="x")
    return fig


def sleep_score(daily):
    fig = go.Figure()
    fig.add_hrect(y0=80, y1=100, fillcolor=T.GREEN_ZONE, line_width=0)
    fig.add_hrect(y0=60, y1=80, fillcolor=T.AMBER_ZONE, line_width=0)
    fig.add_hrect(y0=0, y1=60, fillcolor=T.RED_ZONE, line_width=0)
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["sleep_score"],
                             line=dict(color=T.TEXT, width=2), name="sleep score",
                             hovertemplate="%{y:.0f}<extra>sleep score</extra>"))
    _zone_label(fig, "good", 93, T.GREEN)
    fig = _base(fig, 240)
    fig.update_yaxes(range=[0, 100], showgrid=False)
    return fig


_CLOCK_TICKS = list(range(-4, 15, 2))


def _clock_label(h):
    h = (h % 24 + 24) % 24
    suffix = "am" if h < 12 else "pm"
    h12 = int(h % 12) or 12
    return f"{h12}{suffix}"


def _clock_time(h):
    m = int(round(((h % 24) + 24) % 24 * 60))
    hh, mm = (m // 60) % 24, m % 60
    suffix = "am" if hh < 12 else "pm"
    return f"{(hh % 12) or 12}:{mm:02d}{suffix}"


def sleep_consistency(daily):
    st = A.sleep_times(daily)
    fig = go.Figure()
    if not st.empty:
        labels = [[_clock_time(b), _clock_time(w)]
                  for b, w in zip(st["bed_h"], st["wake_h"])]
        fig.add_trace(go.Bar(
            x=st["date"], y=st["wake_h"] - st["bed_h"], base=st["bed_h"],
            marker=dict(color="rgba(124,142,232,0.55)", line_width=0),
            customdata=labels,
            hovertemplate="bed %{customdata[0]} · wake %{customdata[1]}"
                          "<extra></extra>", name="in bed",
        ))
        median_bed = float(st["bed_h"].median())
        fig.add_hline(y=median_bed, line=dict(color=T.FAINT, width=1, dash="dot"))
    fig = _base(fig, 260)
    fig.update_yaxes(tickvals=_CLOCK_TICKS,
                     ticktext=[_clock_label(h) for h in _CLOCK_TICKS],
                     autorange="reversed", showgrid=True)
    fig.update_layout(bargap=0.35, hovermode="x")
    return fig


# --- Load -------------------------------------------------------------------

def load(daily):
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["chronic_load"], name="chronic (fitness)",
                             line=dict(color=T.GREEN, width=2),
                             hovertemplate="%{y:.0f}<extra>chronic</extra>"))
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["acute_load"], name="acute (fatigue)",
                             line=dict(color=T.AMBER, width=2),
                             hovertemplate="%{y:.0f}<extra>acute</extra>"))
    return _base(fig, 260, legend=True)


def acwr(daily):
    ratio = A.acwr(daily)
    top = max(1.8, float(ratio.max()) * 1.1 if ratio.notna().any() else 1.8)
    fig = go.Figure()
    fig.add_hrect(y0=0.8, y1=1.3, fillcolor=T.GREEN_ZONE, line_width=0)
    fig.add_hrect(y0=1.3, y1=1.5, fillcolor=T.AMBER_ZONE, line_width=0)
    fig.add_hrect(y0=1.5, y1=top, fillcolor=T.RED_ZONE, line_width=0)
    fig.add_hrect(y0=0, y1=0.8, fillcolor=T.AMBER_ZONE, line_width=0)
    fig.add_trace(go.Scatter(x=daily["date"], y=ratio,
                             line=dict(color=T.TEXT, width=2), name="ACWR",
                             hovertemplate="%{y:.2f}<extra>ACWR</extra>"))
    _zone_label(fig, "sweet spot", 1.05, T.GREEN)
    _zone_label(fig, "overreaching", min(top - 0.08, 1.62), T.RED)
    fig = _base(fig, 260)
    fig.update_yaxes(range=[0, top], showgrid=False)
    return fig


def rhr(daily):
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=daily["date"], y=daily["resting_hr"], name="daily",
                             line=dict(color=T.NEUTRAL, width=1), opacity=0.35,
                             hovertemplate="%{y:.0f} bpm<extra>daily</extra>"))
    fig.add_trace(go.Scatter(x=daily["date"], y=A.rolling(daily["resting_hr"], 28),
                             name="28-day", line=dict(color=T.FAINT, width=1.5, dash="dot"),
                             hovertemplate="%{y:.1f} bpm<extra>28-day</extra>"))
    fig.add_trace(go.Scatter(x=daily["date"], y=A.rolling(daily["resting_hr"], 7),
                             name="7-day", line=dict(color=T.BLUE, width=2.5),
                             hovertemplate="%{y:.1f} bpm<extra>7-day</extra>"))
    return _base(fig, 240, legend=True)


def steps(daily):
    fig = go.Figure()
    fig.add_trace(go.Bar(x=daily["date"], y=daily["steps"], name="daily",
                         marker=dict(color="rgba(138,151,168,0.30)", line_width=0),
                         hovertemplate="%{y:,.0f}<extra>steps</extra>"))
    fig.add_trace(go.Scatter(x=daily["date"], y=A.rolling(daily["steps"], 7),
                             name="7-day", line=dict(color=T.BLUE, width=2),
                             hovertemplate="%{y:,.0f}<extra>7-day</extra>"))
    fig = _base(fig, 220, legend=True)
    fig.update_layout(bargap=0.4)
    return fig


_TYPE_PALETTE = [T.GREEN, T.BLUE, T.PURPLE, T.ORANGE, "#E87BA4", T.FAINT]


def weekly_hours_by_type(acts):
    wk = A.weekly_hours_by_type(acts)
    fig = go.Figure()
    if not wk.empty:
        types = [c for c in wk.columns if c != "week"]
        types.sort(key=lambda t: -wk[t].sum())
        for i, t in enumerate(types):
            fig.add_trace(go.Bar(x=wk["week"], y=wk[t], name=t,
                                 marker_color=_TYPE_PALETTE[i % len(_TYPE_PALETTE)],
                                 hovertemplate="%{y:.1f}h<extra>" + t + "</extra>"))
    fig = _base(fig, 260, legend=True)
    fig.update_layout(barmode="stack", hovermode="x")
    return fig


# --- Fitness ------------------------------------------------------------------

def vo2max(daily):
    # forward-fill so the line is continuous across rest-day gaps (VO2max only
    # refreshes after qualifying runs).
    s = daily["vo2max_running"].ffill()
    fig = go.Figure()
    if s.notna().any():  # invisible floor so the fill hugs the line, not zero
        lo = float(s.min()) - 0.2
        fig.add_trace(go.Scatter(x=daily["date"], y=[lo] * len(daily),
                                 line=dict(width=0), hoverinfo="skip", showlegend=False))
    fig.add_trace(go.Scatter(x=daily["date"], y=s,
                             line=dict(color=T.GREEN, width=2, shape="hv"),
                             name="VO2max", fill="tonexty",
                             fillgradient=_fade(T.GREEN, 0.14),
                             hovertemplate="%{y:.1f}<extra>VO₂max</extra>"))
    fig = _base(fig, 240)
    fig.update_yaxes(nticks=5, tickformat=".1f")
    return fig


def pace(acts):
    runs = acts[(acts["activity_type"] == "running") & acts["pace_min_per_km"].notna()]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=runs["date"], y=runs["pace_min_per_km"], mode="markers",
                             marker=dict(color=T.NEUTRAL, size=5, opacity=0.6),
                             name="run", hovertemplate="%{y:.2f} min/km<extra>run</extra>"))
    if len(runs) >= 3:
        fig.add_trace(go.Scatter(x=runs["date"], y=A.rolling(runs["pace_min_per_km"], 5),
                                 mode="lines", line=dict(color=T.ORANGE, width=2.5),
                                 name="5-run avg",
                                 hovertemplate="%{y:.2f} min/km<extra>5-run avg</extra>"))
    fig = _base(fig, 240, legend=True)
    lo, hi = (runs["pace_min_per_km"].min(), runs["pace_min_per_km"].max()) if len(runs) else (5, 6)
    ticks = [round(x * 4) / 4 for x in
             [lo + i * (hi - lo) / 4 for i in range(5)]] if hi > lo else [lo]
    fig.update_yaxes(autorange="reversed", tickvals=ticks,
                     ticktext=[f"{int(t)}:{int(round((t - int(t)) * 60)):02d}" for t in ticks])
    fig.update_layout(hovermode="closest")
    return fig


_INTENSITY = [("easy", T.BLUE), ("moderate", T.PURPLE), ("hard", T.ORANGE)]


def intensity_mix(acts):
    wk = A.weekly_intensity(acts)
    fig = go.Figure()
    if not wk.empty:
        for name, color in _INTENSITY:
            fig.add_trace(go.Bar(x=wk["week"], y=wk[name], name=name, marker_color=color,
                                 hovertemplate="%{y:.0f} sessions<extra>" + name + "</extra>"))
    fig = _base(fig, 260, legend=True)
    fig.update_layout(barmode="stack", hovermode="x")
    return fig


def weekly_distance(acts):
    runs = acts[acts["activity_type"] == "running"]
    wk = A.weekly_distance(runs)
    fig = go.Figure(go.Bar(x=wk["week"], y=wk["distance_km"], marker_color=T.GREEN,
                           hovertemplate="%{y:.1f} km<extra></extra>"))
    fig = _base(fig, 240)
    fig.update_layout(bargap=0.4, hovermode="x")
    return fig
