"use client";

/** Sleep & Recovery page charts. */

import type { BarSeriesOption } from "echarts/charts";

import { EChart } from "./EChart";
import {
  axisTooltip,
  dateAxis,
  fade,
  fmtDate,
  grid,
  legend,
  legendGrid,
  seriesTooltip,
  valueAxis,
  type ChartOption,
} from "./theme";
import { StackedBars } from "./bars";
import { ZonedScore } from "./ZonedScore";

import * as T from "@/lib/theme";

type Series = (number | null)[];

export function SleepScoreChart({ dates, scores }: { dates: string[]; scores: Series }) {
  return (
    <ZonedScore
      dates={dates}
      scores={scores}
      name="sleep score"
      amber={60}
      green={80}
      greenLabel={{ text: "good", at: "top" }}
      height={240}
    />
  );
}

/** Hours per sleep stage, stacked deepest first. */
export function SleepStagesChart({ dates, deep, rem, light, awake }: {
  dates: string[]; deep: Series; rem: Series; light: Series; awake: Series;
}) {
  const parts = [
    { name: "deep", color: "#2C5F9E", data: deep },
    { name: "rem", color: "#7C8EE8", data: rem },
    { name: "light", color: "#B7C4F0", data: light },
    { name: "awake", color: "#66707F", data: awake },
  ];
  return <StackedBars x={dates} parts={parts} daily format={(v) => `${v.toFixed(1)}h`} height={280} />;
}

// --- floating bars: ECharts has no "base" for bars, so each bar sits on an
// invisible segment from 0 to its start. stackStrategy "all" lets that work
// when the start is negative (bedtime before midnight).

const BASE = "__base";

function floatingBars(from: Series, to: Series, name: string, color: string): BarSeriesOption[] {
  const common = { type: "bar" as const, stack: "float", stackStrategy: "all" as const, barWidth: "65%" };
  return [
    { ...common, name: BASE, data: from, silent: true, itemStyle: { color: "transparent" } },
    {
      ...common,
      name,
      data: from.map((f, i) => (f == null || to[i] == null ? null : to[i]! - f)),
      itemStyle: { color },
    },
  ];
}

/** Axis tooltip for floating bars: hands the formatter each bar's start and end. */
function floatingTooltip(line: (from: number, to: number) => string) {
  return {
    ...axisTooltip((params) => {
      const rows = (Array.isArray(params) ? params : [params]) as {
        seriesName?: string; value?: unknown; axisValue?: string; marker?: unknown;
      }[];
      const base = rows.find((r) => r.seriesName === BASE);
      const bar = rows.find((r) => r.seriesName !== BASE);
      const from = base?.value as number | null;
      const len = bar?.value as number | null;
      if (from == null || len == null) return fmtDate(rows[0].axisValue!);
      return `${fmtDate(rows[0].axisValue!)}<br/>${bar!.marker}${line(from, from + len)}`;
    }),
    axisPointer: { type: "shadow" as const },
  };
}

/** Hours from midnight → "11pm" (axis ticks). */
function clockLabel(h: number) {
  const hh = ((h % 24) + 24) % 24;
  return `${Math.trunc(hh % 12) || 12}${hh < 12 ? "am" : "pm"}`;
}

/** Hours from midnight → "11:45pm" (tooltips). */
function clockTime(h: number) {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(m / 60) % 24;
  return `${hh % 12 || 12}:${String(m % 60).padStart(2, "0")}${hh < 12 ? "am" : "pm"}`;
}

function median(xs: number[]) {
  const s = xs.toSorted((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Bed → wake bars on a clock axis (night at the top), dotted line at the median bedtime. */
export function SleepConsistencyChart({ dates, bed, wake }: { dates: string[]; bed: number[]; wake: number[] }) {
  // fit the data to the nearest hour (2-hour steps would leave dead space)
  const lo = bed.length ? Math.floor(Math.min(...bed)) : -2;
  const hi = wake.length ? Math.ceil(Math.max(...wake)) : 8;
  const [base, bar] = floatingBars(bed, wake, "in bed", "rgba(124,142,232,0.55)");
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(dates, { bars: true }),
    yAxis: {
      ...valueAxis,
      min: lo,
      max: hi,
      interval: 2,
      inverse: true,
      // label the 2-hour grid only (the hour-snapped ends may be odd)
      axisLabel: { ...valueAxis.axisLabel, formatter: (h: number) => (h % 2 ? "" : clockLabel(h)) },
    },
    tooltip: floatingTooltip((b, w) => `bed ${clockTime(b)} · wake ${clockTime(w)}`),
    series: [
      base,
      {
        ...bar,
        markLine: bed.length
          ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: T.FAINT, width: 1, type: "dotted" },
              data: [{ yAxis: median(bed) }],
            }
          : undefined,
      },
    ],
  };
  return <EChart option={option} height={260} />;
}

/** Last-night HRV (white) against Garmin's baseline band (green). */
export function HrvChart({ dates, hrv, low, high }: { dates: string[]; hrv: Series; low: Series; high: Series }) {
  const edge = { width: 1, color: "rgba(31,208,130,0.35)" };
  const hasBand = high.some((v) => v != null);
  const option: ChartOption = {
    legend: { ...legend, data: [...(hasBand ? ["your baseline"] : []), "HRV"] },
    grid: legendGrid(),
    xAxis: dateAxis(dates),
    yAxis: { ...valueAxis, scale: true },
    tooltip: seriesTooltip((v) => `${v.toFixed(0)} ms`, undefined, [BASE, "your baseline"]),
    series: [
      ...(hasBand
        ? [
            // band = invisible floor at the baseline low + stacked (high − low) filled area
            {
              type: "line" as const, name: BASE, stack: "band", data: low,
              showSymbol: false, silent: true, lineStyle: edge,
            },
            {
              type: "line" as const, name: "your baseline", stack: "band",
              data: low.map((l, i) => (l == null || high[i] == null ? null : high[i]! - l)),
              showSymbol: false, silent: true, lineStyle: edge,
              itemStyle: { color: edge.color }, areaStyle: { color: T.GREEN_ZONE },
            },
          ]
        : []),
      {
        type: "line", name: "HRV", data: hrv, showSymbol: false,
        lineStyle: { color: T.TEXT, width: 2 }, itemStyle: { color: T.TEXT },
      },
    ],
  };
  return <EChart option={option} height={260} />;
}

/** Each day's Body Battery from low to high. */
export function BodyBatteryChart({ dates, low, high }: { dates: string[]; low: Series; high: Series }) {
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(dates, { bars: true }),
    yAxis: { ...valueAxis, min: 0, max: 100 },
    tooltip: floatingTooltip((lo, hi) => `Body Battery <b>${hi.toFixed(0)}</b> high · <b>${lo.toFixed(0)}</b> low`),
    series: floatingBars(low, high, "daily range", "rgba(31,208,130,0.45)"),
  };
  return <EChart option={option} height={240} />;
}

export function StressChart({ dates, stress }: { dates: string[]; stress: Series }) {
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(dates),
    yAxis: valueAxis,
    tooltip: seriesTooltip((v) => v.toFixed(0)),
    series: [
      {
        type: "line", name: "avg stress", data: stress, showSymbol: false,
        lineStyle: { color: T.AMBER, width: 2 }, itemStyle: { color: T.AMBER },
        areaStyle: { color: fade(T.AMBER, 0.14) },
      },
    ],
  };
  return <EChart option={option} height={220} />;
}
