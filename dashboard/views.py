"""Page layouts — one page per question:

  /         Today    — train hard today?
  /load     Load     — am I overtraining?
  /fitness  Fitness  — am I getting fitter?
  /sleep    Sleep    — is my sleep/recovery improving?
"""

from __future__ import annotations

import datetime as _dt

import dash_mantine_components as dmc
import pandas as pd
from dash import dcc, html
from dash_iconify import DashIconify

from dashboard import figures as F
from dashboard import theme as T
from dashboard import verdicts as VD
from dashboard.components import card, driver_bars, metric_card, readiness_ring, verdict_banner
from garmin_health import analytics as A


RANGE_DAYS = {"30d": 30, "90d": 90, "1y": 365, "All": None}


def _slice_daily(daily, days):
    """The most recent `days` rows (all rows when days is None)."""
    if daily.empty or not days:
        return daily
    return daily.iloc[-days:]


def _slice_acts(acts, daily_win):
    if acts.empty or daily_win.empty:
        return acts
    ds, de = daily_win["date"].iloc[0], daily_win["date"].iloc[-1]
    return acts[(acts["date"] >= ds) & (acts["date"] <= de)]


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
            eps=0.5, href=None, bad_below=None):
    s = daily[col].dropna()
    raw = s.iloc[-1] if len(s) else None
    disp = value if value is not None else _fmt(raw, spec)
    dv = _delta_vs_mean(daily, col)
    scaled = None if dv is None else dv / delta_div
    if bad_below is not None and raw is not None and raw < bad_below:
        # threshold breach outranks the day-to-day delta (traffic-light red)
        dtext, dcolor, arrow = "below your baseline", T.RED, "tabler:alert-triangle"
    elif scaled is None or abs(scaled) < eps:
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
    base_low = last.get("hrv_baseline_low")
    cards = [
        _metric(daily, "hrv_last_night_ms", "Heart rate variability", "ms", "tabler:heart",
                href="/sleep", line=T.GREEN,
                bad_below=float(base_low) if pd.notna(base_low) else None),
        _metric(daily, "resting_hr", "Resting heart rate", "bpm", "tabler:activity",
                higher_good=False, href="/load", line=T.BLUE),
        _metric(daily, "sleep_total_seconds", "Sleep", "", "tabler:moon",
                value=_hm(last.get("sleep_total_seconds")), line=T.PURPLE,
                delta_div=60, delta_unit="m", eps=2, href="/sleep"),
        _metric(daily, "bb_high", "Body Battery", "", "tabler:battery-2", href="/sleep"),
        _metric(daily, "vo2max_running", "VO₂max", "", "tabler:lungs", spec="{:.1f}",
                delta_spec="{:.1f}", eps=0.05, href="/fitness"),
    ]
    acwr = A.acwr(daily).dropna()
    if len(acwr):
        val = float(acwr.iloc[-1])
        if 0.8 <= val <= 1.3:
            note, color, icon = "in the 0.8–1.3 sweet spot", T.GREEN, "tabler:circle-check"
        elif val > 1.5:
            note, color, icon = "well above sweet spot", T.RED, "tabler:alert-triangle"
        else:
            note, color, icon = "outside sweet spot", T.AMBER, "tabler:alert-triangle"
        cards.append(metric_card(
            "Training load", f"{val:.2f}", "acwr", note, color, icon,
            "tabler:flame", acwr.tail(14).tolist(), color, href="/load",
        ))
    return dmc.SimpleGrid(cards, cols={"base": 1, "sm": 2, "lg": 3}, spacing="md")


# --- shared page helpers -------------------------------------------------

def _page_header(title, question, verdict):
    return dmc.Stack([
        dmc.Group(
            [dmc.Text(title, fz=18, fw=500, c=T.TEXT),
             dmc.Text(question, size="xs", c=T.FAINT)],
            gap=10, align="baseline",
        ),
        verdict_banner(verdict),
    ], gap=8)


def _panel(title, fig, note=None):
    height = getattr(fig.layout, "height", None) or 260
    head = [dmc.Text(title, size="sm", c="#C2C8D2")]
    if note:
        head.append(dmc.Text(note, size="xs", c=T.FAINT))
    return card(dmc.Stack([
        dmc.Group(head, justify="space-between"),
        dcc.Graph(figure=fig, config={"displayModeBar": False}, style={"height": f"{height}px"}),
    ], gap="xs"))


def _two(a, b):
    return dmc.SimpleGrid([a, b], cols={"base": 1, "lg": 2}, spacing="md")


def _empty(title):
    return dmc.Center(
        dmc.Stack([
            DashIconify(icon="tabler:tools", width=28, color=T.FAINT),
            dmc.Text(title, fz=18, fw=500, c=T.TEXT, ta="center"),
            dmc.Text("Run a backfill first: uv run python -m garmin_health.cli backfill --all",
                     size="sm", c=T.MUTED, ta="center", maw=380),
        ], align="center", gap="xs"),
        mih=320,
    )


# --- pages ----------------------------------------------------------------

def today(days=90):
    d = _slice_daily(A.load_daily(), days)
    if d.empty:
        return _empty("No data yet")
    last = d.iloc[-1]
    score = last.get("training_readiness_score")
    level = last.get("training_readiness_level")
    v = VD.today(d)

    rdy = d["training_readiness_score"].dropna()
    delta = (rdy.iloc[-1] - rdy.iloc[-2]) if len(rdy) >= 2 else None
    delta_txt, delta_col = "", T.FAINT
    if delta is not None and round(delta) != 0:
        delta_txt = f"{delta:+.0f} vs prev day"
        delta_col = T.GREEN if delta > 0 else T.AMBER

    # `miw` on the detail column makes the Group wrap on phones (ring centred on
    # top, drivers full-width below) while staying side-by-side on wider screens.
    ring_color = T.color_for_level(level)
    hero = card(dmc.Group([
        dmc.Box(readiness_ring(score, ring_color),
                style={"filter": f"drop-shadow(0 0 26px {T.rgba(ring_color, 0.30)})"}),
        dmc.Stack([
            dmc.Group(
                [dmc.Text(v["word"], fz=18, fw=500, c=T.color_for_level(level)),
                 dmc.Text(delta_txt, size="xs", c=delta_col)],
                gap=10, align="baseline",
            ),
            dmc.Text(v["sentence"], size="sm", c="#C2C8D2"),
            driver_bars(A.readiness_drivers(d)),
        ], gap=8, miw=240, style={"flex": 1}),
    ], gap="lg", align="center", wrap="wrap", justify="center"))

    trend = _panel("Readiness trend", F.readiness_trend(d))
    return dmc.Stack([_greeting(), hero, trend, _snapshot(d)], gap="md")


def load(days=90):
    d = _slice_daily(A.load_daily(), days)
    if d.empty:
        return _empty("No training data yet")
    acts = _slice_acts(A.load_activities(), d)
    return dmc.Stack([
        _page_header("Load", "Am I overtraining?", VD.load(d)),
        _panel("Acute:chronic workload ratio", F.acwr(d)),
        _two(_panel("Training load — acute vs chronic", F.load(d)),
             _panel("Resting heart rate (bpm)", F.rhr(d), "a rising 7-day line = fatigue")),
        _two(_panel("Weekly training hours by type", F.weekly_hours_by_type(acts)),
             _panel("Daily movement (steps)", F.steps(d))),
        card(dmc.Stack([dmc.Text("Recent activities", size="sm", c="#C2C8D2"),
                        activities_table(acts)], gap="xs")),
    ], gap="md")


def fitness(days=90):
    d = _slice_daily(A.load_daily(), days)
    if d.empty:
        return _empty("No fitness data yet")
    acts = _slice_acts(A.load_activities(), d)
    return dmc.Stack([
        _page_header("Fitness", "Am I getting fitter?", VD.fitness(d, acts)),
        _two(_panel("VO₂max (running)", F.vo2max(d)),
             _panel("Running pace (min/km, lower is faster)", F.pace(acts))),
        _two(_panel("Session intensity mix", F.intensity_mix(acts),
                    "from Garmin training effect"),
             _panel("Weekly running distance (km)", F.weekly_distance(acts))),
    ], gap="md")


def sleep(days=90):
    d = _slice_daily(A.load_daily(), days)
    if d.empty:
        return _empty("No sleep data yet")
    return dmc.Stack([
        _page_header("Sleep & Recovery", "Is my sleep and recovery improving?", VD.sleep(d)),
        _panel("Sleep score", F.sleep_score(d)),
        _two(_panel("Sleep stages (hours)", F.sleep_stages(d)),
             _panel("Sleep consistency", F.sleep_consistency(d.tail(45)),
                    "bed → wake · dotted = median bedtime")),
        _two(_panel("HRV vs your baseline (ms)", F.hrv(d)),
             _panel("Body Battery daily range", F.body_battery(d))),
        _panel("Average daily stress", F.stress(d)),
    ], gap="md")


# --- Activities table (Load page) -----------------------------------------

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
    for _, r in af.sort_values("date", ascending=False).head(20).iterrows():
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
            # keep the date on one line (the table scrolls horizontally on phones)
            style = {**_TD, "whiteSpace": "nowrap"} if key == "date" else _TD
            cells.append(html.Td(v, style=style))
        rows.append(html.Tr(cells))
    table = html.Table([html.Thead(head), html.Tbody(rows)],
                       style={"width": "100%", "minWidth": "520px", "borderCollapse": "collapse"})
    # Scroll the 7-column table horizontally on phones instead of letting it
    # squash or push the page wider than the viewport.
    return html.Div(table, style={"overflowX": "auto"})
