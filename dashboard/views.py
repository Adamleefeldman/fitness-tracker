"""Page layouts. Stage 1: a real Overview; the Explore pages are placeholders."""

from __future__ import annotations

import datetime as _dt

import dash_mantine_components as dmc
import pandas as pd
from dash import dcc, html
from dash_iconify import DashIconify

from dashboard import figures as F
from dashboard import theme as T
from dashboard.components import card, driver_bars, metric_card, readiness_ring
from garmin_health import analytics as A


RANGE_DAYS = {"30d": 30, "90d": 90, "1y": 365, "All": None}


def _slice_daily(daily, days, offset):
    """Return the window of `days` ending `offset` days before the latest row."""
    n = len(daily)
    if n == 0:
        return daily
    end = max(0, min(n - 1, n - 1 - (offset or 0)))
    start = 0 if not days else max(0, end - days + 1)
    return daily.iloc[start:end + 1]


def _bounds(daily, days, offset):
    d = _slice_daily(daily, days, offset)
    if d.empty:
        return d, None, None
    return d, d["date"].iloc[0], d["date"].iloc[-1]


def _slice_acts(acts, dstart, dend):
    if acts.empty or dstart is None:
        return acts
    return acts[(acts["date"] >= dstart) & (acts["date"] <= dend)]


def asof_label(daily, offset):
    n = len(daily)
    if n == 0:
        return "—"
    end = max(0, min(n - 1, n - 1 - (offset or 0)))
    d = daily["date"].iloc[end]
    return d.strftime("%a, %d %b %Y") if hasattr(d, "strftime") else str(d)


def _greeting():
    hour = _dt.datetime.now().hour
    g = "Good morning" if hour < 12 else ("Good afternoon" if hour < 18 else "Good evening")
    return dmc.Text(f"{g}, Adam", fz=18, fw=500, c=T.TEXT)


def _fmt(v, spec="{:.0f}"):
    return "—" if v is None or (isinstance(v, float) and pd.isna(v)) else spec.format(v)


def _hm(seconds):
    if not seconds or pd.isna(seconds):
        return "—"
    s = int(seconds)
    return f"{s // 3600}h {s % 3600 // 60:02d}m"


def _delta_vs_mean(daily, col):
    s = daily[col].dropna()
    if len(s) < 2:
        return None
    return float(s.iloc[-1] - s.iloc[:-1].tail(7).mean())


def _metric(daily, col, label, unit, icon, *, higher_good=True, spec="{:.0f}",
            value=None, line=T.GREEN, delta_div=1, delta_unit="", delta_spec="{:.0f}",
            eps=0.5, href=None):
    s = daily[col].dropna()
    raw = s.iloc[-1] if len(s) else None
    disp = value if value is not None else _fmt(raw, spec)
    dv = _delta_vs_mean(daily, col)
    scaled = None if dv is None else dv / delta_div
    if scaled is None or abs(scaled) < eps:
        dtext, dcolor, arrow = "steady", T.FAINT, "tabler:minus"
    else:
        good = (dv >= 0) if higher_good else (dv <= 0)
        dcolor = T.GREEN if good else T.AMBER
        arrow = "tabler:arrow-up-right" if dv >= 0 else "tabler:arrow-down-right"
        dtext = f"{delta_spec.format(abs(scaled))}{delta_unit} vs 7-day"
    return metric_card(label, disp, unit, dtext, dcolor, arrow, icon,
                       s.tail(14).tolist(), line, href=href)


def _snapshot(daily):
    last = daily.iloc[-1]
    cards = [
        _metric(daily, "hrv_last_night_ms", "Heart rate variability", "ms", "tabler:heart",
                href="/recovery"),
        _metric(daily, "resting_hr", "Resting heart rate", "bpm", "tabler:activity",
                higher_good=False, href="/recovery"),
        _metric(daily, "sleep_total_seconds", "Sleep", "", "tabler:moon",
                value=_hm(last.get("sleep_total_seconds")), line=T.BLUE,
                delta_div=60, delta_unit="m", eps=2, href="/sleep"),
        _metric(daily, "bb_high", "Body Battery", "", "tabler:battery-2", href="/recovery"),
        _metric(daily, "vo2max_running", "VO₂max", "", "tabler:lungs", spec="{:.1f}",
                delta_spec="{:.1f}", eps=0.05, href="/training"),
    ]
    acwr = A.acwr(daily).dropna()
    if len(acwr):
        val = float(acwr.iloc[-1])
        ok = 0.8 <= val <= 1.3
        cards.append(metric_card(
            "Training load", f"{val:.2f}", "acwr",
            "in the 0.8–1.3 sweet spot" if ok else "outside sweet spot",
            T.GREEN if ok else T.AMBER,
            "tabler:circle-check" if ok else "tabler:alert-triangle",
            "tabler:flame", acwr.tail(14).tolist(), T.GREEN if ok else T.AMBER,
            href="/training",
        ))
    return dmc.SimpleGrid(cards, cols={"base": 1, "sm": 2, "lg": 3}, spacing="md")


def overview(days=90, offset=0):
    daily_all = A.load_daily()
    if daily_all.empty:
        return _empty("No data yet")
    d = _slice_daily(daily_all, days, offset)
    last = d.iloc[-1]
    score = last.get("training_readiness_score")
    level = last.get("training_readiness_level")
    word, phrase = T.friendly_level(level)

    rdy = d["training_readiness_score"].dropna()
    delta = (rdy.iloc[-1] - rdy.iloc[-2]) if len(rdy) >= 2 else None
    delta_txt, delta_col = "", T.FAINT
    if delta is not None and round(delta) != 0:
        delta_txt = f"{delta:+.0f} vs prev day"
        delta_col = T.GREEN if delta > 0 else T.AMBER

    hero = card(dmc.Group([
        readiness_ring(score, T.color_for_level(level)),
        dmc.Stack([
            dmc.Group(
                [dmc.Text(word, fz=18, fw=500, c=T.color_for_level(level)),
                 dmc.Text(delta_txt, size="xs", c=delta_col)],
                gap=10, align="baseline",
            ),
            dmc.Text(phrase, size="sm", c="#C2C8D2"),
            driver_bars(A.readiness_drivers(d)),
        ], gap=8, style={"flex": 1, "minWidth": 0}),
    ], gap="xl", align="center", wrap="nowrap"))

    trend = card(dmc.Stack([
        dmc.Group(
            [dmc.Text("Readiness trend", size="sm", c="#C2C8D2"),
             dmc.Text("low · moderate · high zones", size="xs", c=T.FAINT)],
            justify="space-between",
        ),
        dcc.Graph(figure=T.readiness_trend_fig(d),
                  config={"displayModeBar": False}, style={"height": "180px"}),
    ], gap="xs"))

    return dmc.Stack([_greeting(), hero, _snapshot(d), trend], gap="md")


def placeholder(title, subtitle):
    return dmc.Center(
        dmc.Stack([
            DashIconify(icon="tabler:tools", width=28, color=T.FAINT),
            dmc.Text(title, fz=18, fw=500, c=T.TEXT, ta="center"),
            dmc.Text(subtitle, size="sm", c=T.MUTED, ta="center", maw=380),
        ], align="center", gap="xs"),
        mih=320,
    )


# --- shared page helpers -------------------------------------------------

def _header(title, subtitle):
    return dmc.Stack(
        [dmc.Text(title, fz=18, fw=500, c=T.TEXT),
         dmc.Text(subtitle, size="xs", c=T.FAINT)],
        gap=2,
    )


def _panel(title, fig):
    height = getattr(fig.layout, "height", None) or 260
    return card(dmc.Stack([
        dmc.Text(title, size="sm", c="#C2C8D2"),
        dcc.Graph(figure=fig, config={"displayModeBar": False}, style={"height": f"{height}px"}),
    ], gap="xs"))


def _two(a, b):
    return dmc.SimpleGrid([a, b], cols={"base": 1, "lg": 2}, spacing="md")


def _empty(title):
    return placeholder(title, "Run a backfill first: uv run python -m garmin_health.cli backfill --all")


# --- Explore pages -------------------------------------------------------

def recovery(days=90, offset=0):
    d = _slice_daily(A.load_daily(), days, offset)
    if d.empty:
        return _empty("No recovery data yet")
    return dmc.Stack([
        _header("Recovery", "HRV against baseline, resting heart rate, Body Battery and stress"),
        _panel("HRV vs your baseline (ms)", F.hrv(d)),
        _two(_panel("Resting heart rate (bpm)", F.rhr(d)),
             _panel("Body Battery range", F.body_battery(d))),
        _panel("Average daily stress", F.stress(d)),
    ], gap="md")


def training(days=90, offset=0):
    daily = A.load_daily()
    d, ds, de = _bounds(daily, days, offset)
    if d.empty:
        return _empty("No training data yet")
    acts = _slice_acts(A.load_activities(), ds, de)
    return dmc.Stack([
        _header("Training", "Load balance, workload ratio, fitness and weekly volume"),
        _panel("Training load — acute vs chronic", F.load(d)),
        _two(_panel("Acute:chronic workload ratio (0.8–1.3 = sweet spot)", F.acwr(d)),
             _panel("VO₂max", F.vo2max(d))),
        _panel("Weekly distance (km)", F.weekly_distance(acts)),
    ], gap="md")


def activities(days=90, offset=0):
    acts_all = A.load_activities()
    if acts_all.empty:
        return _empty("No activities yet")
    _, ds, de = _bounds(A.load_daily(), days, offset)
    win = _slice_acts(acts_all, ds, de)
    all_types = sorted(acts_all["activity_type"].dropna().unique())
    top = acts_all["activity_type"].value_counts().head(6).index.tolist()
    return dmc.Stack([
        _header("Activities", f"{len(win)} activities in range · {len(all_types)} types total"),
        card(dmc.Stack([
            dmc.MultiSelect(
                id="act-types", label="Activity types", w=360, clearable=True, searchable=True,
                data=[{"value": t, "label": t} for t in all_types], value=top,
            ),
            dcc.Graph(id="act-scatter", config={"displayModeBar": False}, style={"height": "300px"}),
        ], gap="sm")),
        _panel("Running pace (min/km, lower is faster)", F.pace(win)),
        card(dmc.Stack([dmc.Text("Recent activities", size="sm", c="#C2C8D2"),
                        html.Div(id="act-table")], gap="xs")),
    ], gap="md")


def sleep(days=90, offset=0):
    d = _slice_daily(A.load_daily(), days, offset)
    if d.empty:
        return _empty("No sleep data yet")
    return dmc.Stack([
        _header("Sleep", "Stage composition and sleep-score trend"),
        _panel("Sleep stages (hours)", F.sleep_stages(d)),
        _panel("Sleep score", F.sleep_score(d)),
    ], gap="md")


# --- Activities table (used by the filter callback in app.py) ------------

_TH = {"textAlign": "left", "padding": "6px 10px", "color": T.FAINT,
       "fontWeight": 400, "borderBottom": f"1px solid {T.BORDER}", "fontSize": "11px"}
_TD = {"padding": "6px 10px", "color": T.TEXT, "borderBottom": f"1px solid {T.BORDER}",
       "fontSize": "12px"}


def _mmss(min_per_km):
    if min_per_km is None or pd.isna(min_per_km):
        return "—"
    m = int(min_per_km)
    s = int(round((min_per_km - m) * 60))
    return f"{m}:{s:02d}"


def activities_table(af):
    cols = [("date", "Date"), ("activity_type", "Type"), ("name", "Name"),
            ("distance_km", "km"), ("pace_min_per_km", "min/km"),
            ("avg_hr", "HR"), ("training_load", "Load")]
    head = html.Tr([html.Th(h, style=_TH) for _, h in cols])
    rows = []
    for _, r in af.sort_values("date", ascending=False).head(40).iterrows():
        cells = []
        for key, _label in cols:
            v = r.get(key)
            if key == "date":
                v = r["date"].strftime("%Y-%m-%d") if hasattr(r["date"], "strftime") else str(v)
            elif key == "distance_km":
                v = f"{v:.1f}" if pd.notna(v) else "—"
            elif key == "pace_min_per_km":
                v = _mmss(v)
            elif key in ("avg_hr", "training_load"):
                v = f"{v:.0f}" if pd.notna(v) else "—"
            else:
                v = v if (v is not None and pd.notna(v)) else "—"
            cells.append(html.Td(v, style=_TD))
        rows.append(html.Tr(cells))
    return html.Table([html.Thead(head), html.Tbody(rows)],
                      style={"width": "100%", "borderCollapse": "collapse"})
