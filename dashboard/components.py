"""Reusable Dash Mantine building blocks for the dashboard."""

from __future__ import annotations

import dash_mantine_components as dmc
from dash import dcc
from dash_iconify import DashIconify

from dashboard import theme as T

# (href, label, icon, section-label-above-or-None)
NAV = [
    ("/", "Overview", "tabler:layout-dashboard", "Today"),
    ("/recovery", "Recovery", "tabler:heart", "Explore"),
    ("/training", "Training", "tabler:trending-up", None),
    ("/activities", "Activities", "tabler:run", None),
    ("/sleep", "Sleep", "tabler:moon", None),
]


def brand():
    return dmc.Group(
        [DashIconify(icon="tabler:activity", width=20, color=T.GREEN),
         dmc.Text("Garmin health", fw=500, c=T.TEXT)],
        gap=8,
    )


def nav_links(active):
    items = []
    for href, label, icon, section in NAV:
        if section:
            items.append(dmc.Text(section, size="xs", c=T.FAINT, mt="sm", mb=4, px="xs"))
        items.append(dmc.NavLink(
            label=label, href=href, active=(href == active),
            leftSection=DashIconify(icon=icon, width=18),
            color="vital", variant="filled" if href == active else "subtle",
            styles={"root": {"borderRadius": 9}},
        ))
    return items


def sync_pill():
    return dmc.Group(
        [DashIconify(icon="tabler:refresh", width=14, color=T.GREEN),
         dmc.Text("Synced 7:00am", size="xs", c=T.MUTED)],
        gap=6, px=11, py=5,
        style={"background": T.CARD, "border": f"1px solid {T.BORDER}", "borderRadius": 20},
    )


def card(children, **kw):
    style = {"border": f"1px solid {T.BORDER}"}
    style.update(kw.pop("style", {}))
    kw.setdefault("bg", T.CARD)
    kw.setdefault("radius", "md")
    kw.setdefault("p", "md")
    return dmc.Paper(children, style=style, **kw)


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
            figure=T.sparkline_fig(series, line_color),
            config={"displayModeBar": False, "staticPlot": True},
            style={"height": "34px", "marginTop": "6px"},
        ),
    ], p="md", className="metric-card")
    if href:
        return dcc.Link(inner, href=href, style={"textDecoration": "none", "color": "inherit"})
    return inner
