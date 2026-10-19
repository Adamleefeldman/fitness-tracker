"""Reusable Dash Mantine building blocks for the dashboard."""

from __future__ import annotations

import datetime as _dt

import dash_mantine_components as dmc
from dash import dcc, html
from dash_iconify import DashIconify

from dashboard import figures as F
from dashboard import theme as T

# Question-led navigation: each page answers one question.
# (href, label, icon, question)
NAV = [
    ("/", "Today", "tabler:sun-high", "Train hard today?"),
    ("/load", "Load", "tabler:barbell", "Am I overtraining?"),
    ("/fitness", "Fitness", "tabler:trending-up", "Am I getting fitter?"),
    ("/sleep", "Sleep", "tabler:moon", "Recovering well?"),
]


def brand():
    # On phones the wordmark hides so the header has room for the range control;
    # the green pulse icon alone carries the brand.
    return dmc.Group(
        [DashIconify(icon="tabler:activity", width=20, color=T.GREEN),
         dmc.Text("Garmin health", fw=500, c=T.TEXT, visibleFrom="sm")],
        gap=8,
    )


def nav_links(active):
    items = []
    for href, label, icon, question in NAV:
        items.append(dmc.NavLink(
            label=label, description=question, href=href, active=(href == active),
            leftSection=DashIconify(icon=icon, width=18),
            color="vital", variant="filled" if href == active else "subtle",
            styles={"root": {"borderRadius": 9},
                    "description": {"fontSize": 11}},
        ))
    return items


def bottom_tabs(active):
    """Mobile bottom tab bar (the installed-PWA navigation)."""
    tabs = []
    for href, label, icon, _q in NAV:
        is_active = href == active
        color = T.GREEN if is_active else T.FAINT
        tabs.append(dcc.Link(
            dmc.Stack([
                DashIconify(icon=icon, width=22, color=color),
                dmc.Text(label, size="10px", c=color, fw=600 if is_active else 400),
            ], gap=2, align="center"),
            href=href, style={"textDecoration": "none", "flex": 1,
                              "display": "flex", "justifyContent": "center"},
        ))
    return html.Div(tabs, className="bottom-tabs")


def sync_pill(synced_at, **kw):
    if synced_at is None:
        label, color = "Not synced", T.FAINT
    else:
        now = _dt.datetime.now(synced_at.tzinfo)
        fresh = (now - synced_at) < _dt.timedelta(hours=36)
        t = synced_at.strftime("%-I:%M%p").lower()
        label = (f"Synced {t}" if synced_at.date() == now.date()
                 else f"Synced {synced_at.strftime('%a')} {t}")
        color = T.GREEN if fresh else T.AMBER
    return dmc.Group(
        [DashIconify(icon="tabler:refresh", width=14, color=color),
         dmc.Text(label, size="xs", c=T.MUTED)],
        gap=6, px=11, py=5,
        style={"background": T.CARD, "border": f"1px solid {T.BORDER}", "borderRadius": 20},
        **kw,
    )


def card(children, **kw):
    style = {"border": f"1px solid {T.BORDER}"}
    style.update(kw.pop("style", {}))
    kw.setdefault("bg", T.CARD)
    kw.setdefault("radius", "md")
    kw.setdefault("p", "md")
    kw["className"] = ("panel-card " + kw.get("className", "")).strip()
    return dmc.Paper(children, style=style, **kw)


def verdict_banner(v):
    """Status dot + verdict word + one-line reasoning, washed in the status
    colour so the page's answer reads before any chart does."""
    color = T.STATUS.get(v["status"], T.MUTED)
    return dmc.Paper(
        dmc.Group([
            html.Div(style={"width": 9, "height": 9, "borderRadius": "50%",
                            "background": color, "flexShrink": 0,
                            "boxShadow": f"0 0 10px {color}"}),
            dmc.Text(v["word"], fw=600, fz=15, c=color),
            dmc.Text(v["sentence"], size="sm", c=T.MUTED, style={"flex": 1}),
        ], gap=10, wrap="wrap"),
        radius="md", p="sm", px="md",
        style={
            "background": f"linear-gradient(90deg, {T.rgba(color, 0.10)}, "
                          f"{T.rgba(color, 0.03)} 55%, transparent)",
            "border": f"1px solid {T.rgba(color, 0.22)}",
            "borderLeft": f"3px solid {color}",
        },
    )


def readiness_ring(score, color):
    return dmc.RingProgress(
        size=132, thickness=11, roundCaps=True, rootColor=T.TRACK,
        sections=[{"value": max(0, min(100, score or 0)), "color": color}],
        label=dmc.Stack(
            [dmc.Text(str(int(score)) if score is not None else "—",
                      className="num", fz=30, fw=500, ta="center", c=T.TEXT),
             dmc.Text("Readiness", size="xs", c=T.FAINT, ta="center")],
            gap=0, align="center",
        ),
    )


def driver_bars(drivers):
    rows = []
    for name, val in drivers.items():
        rows.append(dmc.Box([
            dmc.Group(
                [dmc.Text(name, size="xs", c=T.MUTED),
                 dmc.Text(f"{int(val)}", size="xs", c=T.TEXT, className="num")],
                justify="space-between", mb=3,
            ),
            dmc.Progress(value=val, color=T.color_for_pct(val), size="sm", radius="xl", bg=T.TRACK),
        ]))
    if not rows:
        return dmc.Text("Driver detail unavailable for this day.", size="xs", c=T.FAINT)
    return dmc.SimpleGrid(rows, cols=2, spacing="md", verticalSpacing="xs")


def metric_card(label, value, unit, delta_text, delta_color, arrow_icon, icon, series,
                line_color, href=None):
    inner = card([
        dmc.Group(
            [DashIconify(icon=icon, width=15, color=T.FAINT),
             dmc.Text(label, size="xs", c=T.FAINT)],
            gap=6,
        ),
        dmc.Group(
            [dmc.Text(value, className="num", fz=24, fw=500, c=T.TEXT),
             dmc.Text(unit, size="xs", c=T.FAINT)],
            gap=4, align="baseline", mt=4,
        ),
        dmc.Group(
            [DashIconify(icon=arrow_icon, width=13, color=delta_color),
             dmc.Text(delta_text, size="xs", c=delta_color)],
            gap=4, mt=2,
        ),
        dcc.Graph(
            figure=F.sparkline(series, line_color),
            config={"displayModeBar": False, "staticPlot": True},
            style={"height": "34px", "marginTop": "6px"},
        ),
    ], p="md", className="metric-card")
    if href:
        return dcc.Link(inner, href=href, style={"textDecoration": "none", "color": "inherit"})
    return inner
