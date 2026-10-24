"use client";

/** Load page charts (port of the Load section of dashboard/figures.py). */

import { EChart } from "./EChart";
import {
  grid,
  legend,
  legendGrid,
  seriesTooltip,
  dateAxis,
  valueAxis,
  zone,
  type ChartOption,
} from "./theme";
import { StackedWeeks } from "./weekly";

import * as T from "@/lib/theme";

type Series = (number | null)[];

/** Acute:chronic workload ratio over its sweet-spot / overreaching zones. */
export function AcwrChart({ dates, ratio }: { dates: string[]; ratio: Series }) {
  const peak = Math.max(...ratio.filter((r): r is number => r != null), -Infinity);
  const top = Math.max(1.8, Number.isFinite(peak) ? peak * 1.1 : 1.8);
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(dates),
    yAxis: {
      ...valueAxis, min: 0, max: top, interval: 0.5, splitLine: { show: false },
      axisLabel: { ...valueAxis.axisLabel, showMaxLabel: false },
    },
    tooltip: seriesTooltip((v) => v.toFixed(2)),
    series: [
      {
        type: "line",
        name: "ACWR",
        data: ratio,
        showSymbol: false,
        lineStyle: { color: T.TEXT, width: 2 },
        itemStyle: { color: T.TEXT },
        markArea: {
          silent: true,
          data: [
            zone(0.8, 1.3, T.GREEN_ZONE, { text: "sweet spot", color: T.GREEN, at: "middle" }),
            zone(1.3, 1.5, T.AMBER_ZONE),
            zone(1.5, top, T.RED_ZONE, { text: "overreaching", color: T.RED, at: "bottom" }),
            zone(0, 0.8, T.AMBER_ZONE),
          ],
        },
      },
    ],
  };
  return <EChart option={option} height={260} />;
}

/** Chronic (fitness) vs acute (fatigue) training load. */
export function LoadChart({ dates, acute, chronic }: { dates: string[]; acute: Series; chronic: Series }) {
  const line = (name: string, data: Series, color: string) => ({
    type: "line" as const,
    name,
    data,
    showSymbol: false,
    lineStyle: { color, width: 2 },
    itemStyle: { color },
  });
  const option: ChartOption = {
    legend,
    grid: legendGrid(),
    xAxis: dateAxis(dates),
    yAxis: { ...valueAxis, scale: true },
    tooltip: seriesTooltip((v) => v.toFixed(0)),
    series: [
      line("chronic (fitness)", chronic, T.GREEN),
      line("acute (fatigue)", acute, T.AMBER),
    ],
  };
  return <EChart option={option} height={260} />;
}

/** Resting HR: faint daily line, dotted 28-day baseline, bold 7-day trend. */
export function RhrChart({ dates, daily, avg28, avg7 }: {
  dates: string[]; daily: Series; avg28: Series; avg7: Series;
}) {
  const option: ChartOption = {
    legend,
    grid: legendGrid(),
    xAxis: dateAxis(dates),
    yAxis: { ...valueAxis, scale: true },
    tooltip: seriesTooltip((v, name) => `${name === "daily" ? v.toFixed(0) : v.toFixed(1)} bpm`),
    series: [
      {
        type: "line", name: "daily", data: daily, showSymbol: false,
        lineStyle: { color: T.NEUTRAL, width: 1, opacity: 0.35 }, itemStyle: { color: T.NEUTRAL },
      },
      {
        type: "line", name: "28-day", data: avg28, showSymbol: false,
        lineStyle: { color: T.FAINT, width: 1.5, type: "dotted" }, itemStyle: { color: T.FAINT },
      },
      {
        type: "line", name: "7-day", data: avg7, showSymbol: false,
        lineStyle: { color: T.BLUE, width: 2.5 }, itemStyle: { color: T.BLUE },
      },
    ],
  };
  return <EChart option={option} height={240} />;
}

const thousands = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Daily steps as faint bars under the 7-day average. */
export function StepsChart({ dates, steps, avg7 }: { dates: string[]; steps: Series; avg7: Series }) {
  const option: ChartOption = {
    legend,
    grid: legendGrid(48),
    xAxis: dateAxis(dates, { bars: true }),
    yAxis: { ...valueAxis, axisLabel: { ...valueAxis.axisLabel, formatter: (v: number) => `${v / 1000}k` } },
    tooltip: seriesTooltip(thousands),
    series: [
      {
        type: "bar", name: "daily", data: steps, barWidth: "60%",
        itemStyle: { color: "rgba(138,151,168,0.30)" },
      },
      {
        type: "line", name: "7-day", data: avg7, showSymbol: false,
        lineStyle: { color: T.BLUE, width: 2 }, itemStyle: { color: T.BLUE },
      },
    ],
  };
  return <EChart option={option} height={220} />;
}

const TYPE_PALETTE = [T.GREEN, T.BLUE, T.PURPLE, T.ORANGE, "#E87BA4", T.FAINT];

/** Weekly training hours stacked by activity type, biggest type at the bottom. */
export function WeeklyHoursChart({ weeks, types, hours }: {
  weeks: string[]; types: string[]; hours: Record<string, number[]>;
}) {
  const parts = types.map((t, i) => ({ name: t, color: TYPE_PALETTE[i % TYPE_PALETTE.length], data: hours[t] }));
  return <StackedWeeks weeks={weeks} parts={parts} format={(v) => `${v.toFixed(1)}h`} />;
}
