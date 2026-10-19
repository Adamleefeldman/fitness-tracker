"""The Dash app: a responsive Mantine AppShell with sidebar nav and routed pages.

Run:
    uv run python -m dashboard.app
then open http://localhost:8050
"""

from __future__ import annotations

import mimetypes

import dash_mantine_components as dmc
from dash import Dash, Input, Output, dcc, html

from dashboard import theme as T
from dashboard import views as V
from dashboard.components import bottom_tabs, brand, nav_links, sync_pill
from garmin_health import analytics as A

# Flask doesn't know the .webmanifest extension → it would serve it as
# octet-stream. Register the correct type so the manifest is served properly.
mimetypes.add_type("application/manifest+json", ".webmanifest")

# PWA / mobile head. Makes the dashboard installable to the phone home screen and
# lets it render edge-to-edge under the notch. Dash only injects its own default
# viewport when we don't supply one, so ours (with viewport-fit=cover) wins.
META_TAGS = [
    {"name": "viewport",
     "content": "width=device-width, initial-scale=1, viewport-fit=cover"},
    {"name": "description",
     "content": "Your Garmin readiness, recovery, training and sleep at a glance."},
    {"name": "theme-color", "content": T.BG},
    {"name": "color-scheme", "content": "dark"},
    {"name": "format-detection", "content": "telephone=no"},  # don't turn "47 bpm" into a phone link
    {"name": "mobile-web-app-capable", "content": "yes"},
    {"name": "apple-mobile-web-app-capable", "content": "yes"},
    {"name": "apple-mobile-web-app-status-bar-style", "content": "black"},
    {"name": "apple-mobile-web-app-title", "content": "Garmin"},
    {"name": "application-name", "content": "Garmin Health"},
]

app = Dash(__name__, assets_folder="assets", title="Garmin Health",
           update_title=None, suppress_callback_exceptions=True, meta_tags=META_TAGS)
server = app.server  # for future cloud deploy (Phase 6)

# Inject the manifest + touch-icon links Dash's default template omits. Everything
# else (metas, favicon.ico, styles.css) still comes from the standard placeholders.
app.index_string = """<!DOCTYPE html>
<html>
    <head>
        {%metas%}
        <title>{%title%}</title>
        {%favicon%}
        <link rel="manifest" href="/assets/manifest.webmanifest">
        <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
        <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
        <link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
        {%css%}
    </head>
    <body>
        {%app_entry%}
        <footer>
            {%config%}
            {%scripts%}
            {%renderer%}
        </footer>
    </body>
</html>"""

PAGES = {
    "/": V.today,
    "/load": V.load,
    "/fitness": V.fitness,
    "/sleep": V.sleep,
}
# old bookmarks / installed PWAs keep working after the restructure
LEGACY = {"/recovery": "/sleep", "/training": "/load", "/activities": "/load"}

# The navbar is desktop-only; phones navigate with the bottom tab bar.
_NAVBAR = {"width": 230, "breakpoint": "sm", "collapsed": {"mobile": True, "desktop": False}}


def _header():
    rng = dmc.SegmentedControl(
        id="range", value="90d", size="xs", color="vital", radius="md",
        data=[{"value": k, "label": k} for k in ("30d", "90d", "1y", "All")],
    )
    return dmc.AppShellHeader(
        dmc.Group([
            brand(),
            dmc.Box(style={"flex": 1}),
            rng, sync_pill(A.last_synced(), visibleFrom="sm"),
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


def _footer():
    return dmc.AppShellFooter(
        html.Div(bottom_tabs("/"), id="footer-tabs"),
        withBorder=True, className="tabbar",
        style={"background": T.SIDEBAR, "borderTop": f"1px solid {T.BORDER}"},
    )


app.layout = dmc.MantineProvider(
    forceColorScheme="dark",
    theme=T.MANTINE_THEME,
    children=dmc.AppShell(
        [
            dcc.Location(id="url"),
            _header(),
            _navbar(),
            dmc.AppShellMain(
                # background comes from styles.css (layered ambient gradients)
                html.Div(V.today(), id="page-content"),
                style={"minHeight": "100vh"},
            ),
            _footer(),
        ],
        id="appshell", header={"height": 56}, navbar=_NAVBAR,
        footer={"height": 58}, padding="md",
    ),
)


@app.callback(
    Output("page-content", "children"),
    Output("navbar-links", "children"),
    Output("footer-tabs", "children"),
    Input("url", "pathname"),
    Input("range", "value"),
)
def _route(pathname, range_val):
    path = LEGACY.get(pathname, pathname)
    if path not in PAGES:
        path = "/"
    days = V.RANGE_DAYS.get(range_val, 90)
    return PAGES[path](days), nav_links(path), bottom_tabs(path)


if __name__ == "__main__":
    import os

    # host=0.0.0.0 lets you reach it from your phone on the same WiFi (Phase 5 of
    # the redesign). use_reloader off so a single stable process serves it.
    # PORT is honoured as a fallback so cloud hosts (Railway/Fly/Render, Phase 6)
    # and the local preview harness can assign the port themselves.
    port = int(os.getenv("DASH_PORT") or os.getenv("PORT") or "8050")
    app.run(debug=os.getenv("DASH_DEBUG", "0") == "1", use_reloader=False,
            host=os.getenv("DASH_HOST", "127.0.0.1"), port=port)
