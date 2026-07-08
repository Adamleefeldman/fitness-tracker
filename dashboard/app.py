"""The Dash app: a responsive Mantine AppShell with sidebar nav and routed pages.

Run:
    uv run python -m dashboard.app
then open http://localhost:8050
"""

from __future__ import annotations

import dash_mantine_components as dmc
from dash import Dash, Input, Output, State, ctx, dcc, html
from dash_iconify import DashIconify

from dashboard import figures as F
from dashboard import theme as T
from dashboard import views as V
from dashboard.components import brand, nav_links, sync_pill
from garmin_health import analytics as A

app = Dash(__name__, assets_folder="assets", title="Garmin Health",
           update_title=None, suppress_callback_exceptions=True)
server = app.server  # for future cloud deploy (Phase 6)

PAGES = {
    "/": V.overview,
    "/recovery": V.recovery,
    "/training": V.training,
    "/activities": V.activities,
    "/sleep": V.sleep,
}

_NAVBAR = {"width": 230, "breakpoint": "sm", "collapsed": {"mobile": True, "desktop": False}}


def _header():
    rng = dmc.SegmentedControl(
        id="range", value="90d", size="xs", color="vital", radius="md",
        data=[{"value": k, "label": k} for k in ("30d", "90d", "1y", "All")],
        visibleFrom="xs",
    )
    scrubber = dmc.Group([
        dmc.ActionIcon(DashIconify(icon="tabler:chevron-left", width=16), id="day-prev",
                       variant="subtle", color="gray", size="md"),
        dmc.Text("—", id="day-label", size="xs", c=T.MUTED, w=124, ta="center"),
        dmc.ActionIcon(DashIconify(icon="tabler:chevron-right", width=16), id="day-next",
                       variant="subtle", color="gray", size="md"),
    ], gap=2, visibleFrom="sm")
    return dmc.AppShellHeader(
        dmc.Group([
            dmc.Burger(id="burger", opened=False, hiddenFrom="sm", size="sm", color=T.MUTED),
            brand(),
            dmc.Box(style={"flex": 1}),
            rng, scrubber, sync_pill(),
        ], h="100%", px="md", gap="sm"),
        style={"background": T.BG, "borderBottom": f"1px solid {T.BORDER}"},
    )


def _navbar():
    return dmc.AppShellNavbar(
        dmc.Stack([
            html.Div(nav_links("/"), id="navbar-links"),
        ], gap="xs", h="100%", p="sm"),
        style={"background": T.SIDEBAR, "borderRight": f"1px solid {T.BORDER}"},
    )


app.layout = dmc.MantineProvider(
    forceColorScheme="dark",
    theme=T.MANTINE_THEME,
    children=dmc.AppShell(
        [
            dcc.Location(id="url"),
            dcc.Store(id="day-offset", data=0),
            _header(),
            _navbar(),
            dmc.AppShellMain(
                html.Div(V.overview(), id="page-content"),
                style={"background": T.BG, "minHeight": "100vh"},
            ),
        ],
        id="appshell", header={"height": 56}, navbar=_NAVBAR, padding="md",
    ),
)


@app.callback(Output("appshell", "navbar"), Input("burger", "opened"))
def _toggle_navbar(opened):
    return {**_NAVBAR, "collapsed": {"mobile": not opened, "desktop": False}}


@app.callback(
    Output("page-content", "children"),
    Output("navbar-links", "children"),
    Output("day-label", "children"),
    Input("url", "pathname"),
    Input("range", "value"),
    Input("day-offset", "data"),
)
def _route(pathname, range_val, offset):
    path = pathname if pathname in PAGES else "/"
    days = V.RANGE_DAYS.get(range_val, 90)
    label = V.asof_label(A.load_daily(), offset or 0)
    return PAGES[path](days, offset or 0), nav_links(path), label


@app.callback(
    Output("day-offset", "data"),
    Input("day-prev", "n_clicks"),
    Input("day-next", "n_clicks"),
    State("day-offset", "data"),
    prevent_initial_call=True,
)
def _scrub(prev, nxt, offset):
    offset = offset or 0
    max_off = max(0, len(A.load_daily()) - 1)
    if ctx.triggered_id == "day-prev":
        return min(max_off, offset + 1)
    if ctx.triggered_id == "day-next":
        return max(0, offset - 1)
    return offset


@app.callback(
    Output("act-scatter", "figure"),
    Output("act-table", "children"),
    Input("act-types", "value"),
    State("range", "value"),
    State("day-offset", "data"),
)
def _activities_filter(types, range_val, offset):
    days = V.RANGE_DAYS.get(range_val, 90)
    _, ds, de = V._bounds(A.load_daily(), days, offset or 0)
    win = V._slice_acts(A.load_activities(), ds, de)
    types = types or []
    table_src = win[win["activity_type"].isin(types)] if types else win.iloc[0:0]
    return F.activities_scatter(win, types), V.activities_table(table_src)


if __name__ == "__main__":
    import os

    # host=0.0.0.0 lets you reach it from your phone on the same WiFi (Phase 5 of
    # the redesign). use_reloader off so a single stable process serves it.
    app.run(debug=os.getenv("DASH_DEBUG", "0") == "1", use_reloader=False,
            host=os.getenv("DASH_HOST", "127.0.0.1"), port=int(os.getenv("DASH_PORT", "8050")))
