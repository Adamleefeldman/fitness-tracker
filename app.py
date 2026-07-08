"""Phase 3 — Streamlit dashboard over garmin.db.

Run it:
    uv run streamlit run app.py

The heavy lifting (loading, rolling averages, ACWR) lives in
garmin_health/analytics.py so it can be tested without a browser; this file is
layout + charts only.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from garmin_health import analytics as A

st.set_page_config(page_title="Garmin Health", page_icon="🏃", layout="wide")

PLOT = dict(template="plotly_white", height=320, margin=dict(l=10, r=10, t=40, b=10))


@st.cache_data(ttl=300)
def get_daily():
    return A.load_daily()


@st.cache_data(ttl=300)
def get_activities():
    return A.load_activities()


STRETCH = "stretch"  # st width arg (replaces deprecated width=STRETCH)


def fmt(value, spec="{:.0f}", dash="—"):
    return dash if value is None or (isinstance(value, float) and value != value) else spec.format(value)


daily = get_daily()
acts = get_activities()

if daily.empty:
    st.warning("No data yet. Run:  `uv run python -m garmin_health.cli backfill --all`")
    st.stop()

# ---- Sidebar: date range ----
st.sidebar.title("🏃 Garmin Health")
min_d = daily["date"].min().date()
max_d = daily["date"].max().date()
default_start = max(min_d, (pd.Timestamp(max_d) - pd.Timedelta(days=90)).date())
start, end = st.sidebar.slider(
    "Date range", min_value=min_d, max_value=max_d, value=(default_start, max_d)
)
d = daily[daily["date"].dt.date.between(start, end)].copy()
a = acts[acts["date"].dt.date.between(start, end)].copy() if not acts.empty else acts
st.sidebar.caption(f"{len(d)} days · {len(a)} activities in range")
st.sidebar.caption(f"Data: {min_d} → {max_d}")

# ---- Header: current status cards (from the latest known values) ----
st.title("Health & Training Dashboard")
snap = A.latest(
    daily,
    ["training_readiness_score", "training_readiness_level", "hrv_last_night_ms", "hrv_status",
     "resting_hr", "sleep_score", "vo2max_running", "training_status"],
)
rhr_7d = A.rolling(daily["resting_hr"], 7).iloc[-1] if "resting_hr" in daily else None
rhr_delta = (snap["resting_hr"] - rhr_7d) if (snap["resting_hr"] is not None and rhr_7d == rhr_7d) else None
acwr_now = A.acwr(daily).dropna()
acwr_now = acwr_now.iloc[-1] if not acwr_now.empty else None

c = st.columns(6)
c[0].metric("Readiness", fmt(snap["training_readiness_score"]), snap["training_readiness_level"], delta_color="off")
c[1].metric("HRV (ms)", fmt(snap["hrv_last_night_ms"]), snap["hrv_status"], delta_color="off")
c[2].metric("Resting HR", fmt(snap["resting_hr"]), fmt(rhr_delta, "{:+.0f} vs 7d"), delta_color="inverse")
c[3].metric("Sleep score", fmt(snap["sleep_score"]))
c[4].metric("VO₂max", fmt(snap["vo2max_running"], "{:.1f}"))
c[5].metric("Acute:Chronic", fmt(acwr_now, "{:.2f}"), "load ratio", delta_color="off")
if snap["training_status"]:
    st.caption(f"Garmin training status: **{snap['training_status']}**")

tab_recovery, tab_load, tab_activities = st.tabs(["💤 Recovery", "📈 Training load", "🏃 Activities"])

# ---- Recovery ----
with tab_recovery:
    # HRV with personal baseline band
    if d["hrv_last_night_ms"].notna().any():
        fig = go.Figure()
        if d["hrv_baseline_low"].notna().any():
            fig.add_trace(go.Scatter(x=d["date"], y=d["hrv_baseline_high"], line=dict(width=0),
                                     showlegend=False, hoverinfo="skip"))
            fig.add_trace(go.Scatter(x=d["date"], y=d["hrv_baseline_low"], fill="tonexty",
                                     fillcolor="rgba(99,110,250,0.15)", line=dict(width=0),
                                     name="baseline", hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=d["date"], y=d["hrv_last_night_ms"], name="HRV",
                                 line=dict(color="#636EFA")))
        fig.update_layout(title="HRV vs your baseline (ms)", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

    col1, col2 = st.columns(2)
    with col1:
        if d["resting_hr"].notna().any():
            fig = go.Figure()
            fig.add_trace(go.Scatter(x=d["date"], y=d["resting_hr"], name="RHR",
                                     line=dict(color="#EF553B", width=1), opacity=0.5))
            fig.add_trace(go.Scatter(x=d["date"], y=A.rolling(d["resting_hr"], 7), name="7-day avg",
                                     line=dict(color="#EF553B", width=3)))
            fig.update_layout(title="Resting heart rate (bpm)", **PLOT)
            st.plotly_chart(fig, width=STRETCH)
    with col2:
        if d["bb_high"].notna().any():
            fig = go.Figure()
            fig.add_trace(go.Scatter(x=d["date"], y=d["bb_high"], name="BB high",
                                     line=dict(color="#00CC96")))
            fig.add_trace(go.Scatter(x=d["date"], y=d["bb_low"], name="BB low", fill="tonexty",
                                     fillcolor="rgba(0,204,150,0.15)", line=dict(color="#00CC96", width=1)))
            fig.update_layout(title="Body Battery range", **PLOT)
            st.plotly_chart(fig, width=STRETCH)

    # Sleep: stages stacked + score line
    if d["sleep_hours"].notna().any():
        fig = go.Figure()
        for stage, color in [("sleep_deep_seconds", "#19376D"), ("sleep_rem_seconds", "#576CBC"),
                             ("sleep_light_seconds", "#A5D7E8"), ("sleep_awake_seconds", "#F1C0B9")]:
            if stage in d:
                fig.add_trace(go.Bar(x=d["date"], y=d[stage] / 3600,
                                     name=stage.replace("sleep_", "").replace("_seconds", "")))
        fig.update_layout(title="Sleep stages (hours)", barmode="stack", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

    # Calendar heatmap for any chosen metric
    metric = st.selectbox("Calendar heatmap metric",
                          ["sleep_score", "hrv_last_night_ms", "resting_hr", "stress_avg",
                           "training_readiness_score", "steps"], index=0)
    t = d.dropna(subset=[metric]).copy()
    if not t.empty:
        iso = t["date"].dt.isocalendar()
        t["yw"] = iso["year"].astype(str) + "-W" + iso["week"].astype(int).map("{:02d}".format)
        t["wd"] = t["date"].dt.weekday
        pivot = t.pivot_table(index="wd", columns="yw", values=metric, aggfunc="mean").reindex(range(7))
        fig = go.Figure(go.Heatmap(z=pivot.values, x=list(pivot.columns),
                                   y=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                                   colorscale="Viridis", colorbar=dict(title=metric)))
        fig.update_layout(title=f"{metric} by week", **{**PLOT, "height": 260})
        st.plotly_chart(fig, width=STRETCH)

# ---- Training load ----
with tab_load:
    if d["acute_load"].notna().any():
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=d["date"], y=d["chronic_load"], name="chronic (fitness)",
                                 line=dict(color="#636EFA")))
        fig.add_trace(go.Scatter(x=d["date"], y=d["acute_load"], name="acute (fatigue)",
                                 line=dict(color="#EF553B")))
        fig.update_layout(title="Training load — acute vs chronic", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

        ac = A.acwr(d)
        fig = go.Figure()
        fig.add_hrect(y0=0.8, y1=1.3, fillcolor="rgba(0,204,150,0.12)", line_width=0,
                      annotation_text="sweet spot", annotation_position="top left")
        fig.add_trace(go.Scatter(x=d["date"], y=ac, name="ACWR", line=dict(color="#AB63FA")))
        fig.update_layout(title="Acute:Chronic Workload Ratio", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

    wk = A.weekly_distance(a)
    if not wk.empty:
        fig = go.Figure(go.Bar(x=wk["week"], y=wk["distance_km"], marker_color="#00CC96"))
        fig.update_layout(title="Weekly distance (km)", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

# ---- Activities ----
with tab_activities:
    if a.empty:
        st.info("No activities in this date range.")
    else:
        types = sorted(a["activity_type"].dropna().unique())
        chosen = st.multiselect("Activity types", types, default=types)
        af = a[a["activity_type"].isin(chosen)]

        fig = go.Figure()
        for typ in chosen:
            sub = af[af["activity_type"] == typ]
            fig.add_trace(go.Scatter(
                x=sub["date"], y=sub["distance_km"], mode="markers", name=typ,
                marker=dict(size=(sub["training_load"].fillna(20) / 8).clip(5, 30)),
                customdata=sub[["name", "avg_hr", "training_load"]],
                hovertemplate="%{customdata[0]}<br>%{x|%Y-%m-%d}<br>%{y:.1f} km · HR %{customdata[1]:.0f} · load %{customdata[2]:.0f}<extra></extra>",
            ))
        fig.update_layout(title="Activities — distance over time (bubble = training load)", **PLOT)
        st.plotly_chart(fig, width=STRETCH)

        runs = af[(af["activity_type"] == "running") & af["pace_min_per_km"].notna()]
        if not runs.empty:
            fig = go.Figure(go.Scatter(x=runs["date"], y=runs["pace_min_per_km"], mode="markers+lines",
                                       line=dict(color="#FFA15A")))
            fig.update_layout(title="Running pace (min/km, lower is faster)",
                              yaxis=dict(autorange="reversed"), **PLOT)
            st.plotly_chart(fig, width=STRETCH)

        st.dataframe(
            af[["date", "activity_type", "name", "distance_km", "pace_min_per_km", "avg_hr",
                "training_load", "aerobic_te"]].sort_values("date", ascending=False),
            width=STRETCH, hide_index=True,
        )
