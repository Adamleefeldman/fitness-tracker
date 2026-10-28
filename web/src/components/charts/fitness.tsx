"use client";

/** Fitness page charts. */

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
import { StackedBars, WeeklyBars } from "./bars";

import { mmss } from "@/lib/format";
import * as T from "@/lib/theme";

/**
 * Running VO₂max as a step line — forward-filled so it stays continuous across
 * rest days (VO₂max only refreshes after qualifying runs) — with a gradient
 * fill that hugs the line rather than dropping to zero.
 */
export function Vo2maxChart({ dates, vo2 }: { dates: string[]; vo2: (number | null)[] }) {
  const filled: (number | null)[] = [];
  for (const v of vo2) filled.push(v ?? filled.at(-1) ?? null);
  const present = filled.filter((v): v is number => v != null);
  const floor = present.length ? Math.min(...present) - 0.2 : 0;
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(dates),
    yAxis: {
      ...valueAxis,
      min: floor,
      scale: true,
      splitNumber: 4,
      // the floor is padding, not a reading — don't label it
      axisLabel: { ...valueAxis.axisLabel, showMinLabel: false, formatter: (v: number) => v.toFixed(1) },
    },
    tooltip: seriesTooltip((v) => v.toFixed(1)),
    series: [
      {
        type: "line",
        name: "VO₂max",
        data: filled,
        step: "end",
        showSymbol: false,
        lineStyle: { color: T.GREEN, width: 2 },
        itemStyle: { color: T.GREEN },
        areaStyle: { color: fade(T.GREEN, 0.14), origin: "start" },
      },
    ],
  };
  return <EChart option={option} height={240} />;
}

/** Quarter-minute pace ticks spanning [lo, hi] in about four steps. */
function paceScale(paces: number[]) {
  const [lo, hi] = paces.length ? [Math.min(...paces), Math.max(...paces)] : [5, 6];
  const step = Math.max(0.25, Math.ceil((hi - lo) / 4 / 0.25) * 0.25);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step || step, interval: step };
}

/** Each run's pace as a dot, plus the 5-run rolling average; faster is up. */
export function PaceChart({ dates, runs, avg }: {
  dates: string[];
  runs: { date: string; pace: number }[];
  avg: (number | null)[];
}) {
  const option: ChartOption = {
    legend,
    grid: legendGrid(),
    xAxis: dateAxis(dates),
    yAxis: {
      ...valueAxis,
      ...paceScale(runs.map((r) => r.pace)),
      inverse: true,
      axisLabel: { ...valueAxis.axisLabel, formatter: (v: number) => mmss(v) },
    },
    tooltip: {
      ...axisTooltip((params) => {
        const p = (Array.isArray(params) ? params[0] : params) as {
          marker?: unknown; seriesName?: string; value?: unknown;
        };
        const [date, pace] = p.value as [string, number];
        return `${fmtDate(date)}<br/>${p.marker}${p.seriesName} <b>${mmss(pace)}</b> /km`;
      }),
      trigger: "item",
    },
    series: [
      {
        type: "scatter",
        name: "run",
        data: runs.map((r) => [r.date, r.pace]),
        symbolSize: 6,
        itemStyle: { color: T.NEUTRAL, opacity: 0.6 },
      },
      ...(runs.length >= 3
        ? [{
            type: "line" as const,
            name: "5-run avg",
            data: runs.map((r, i) => [r.date, avg[i]]),
            showSymbol: false,
            lineStyle: { color: T.ORANGE, width: 2.5 },
            itemStyle: { color: T.ORANGE },
          }]
        : []),
    ],
  };
  return <EChart option={option} height={240} />;
}

/** Weekly sessions stacked by intensity (from Garmin training effect). */
export function IntensityMixChart({ weeks, easy, moderate, hard }: {
  weeks: string[]; easy: number[]; moderate: number[]; hard: number[];
}) {
  const parts = [
    { name: "easy", color: T.BLUE, data: easy },
    { name: "moderate", color: T.PURPLE, data: moderate },
    { name: "hard", color: T.ORANGE, data: hard },
  ];
  return <StackedBars x={weeks} parts={parts} format={(v) => `${v.toFixed(0)} sessions`} />;
}

/** Weekly running distance. */
export function WeeklyDistanceChart({ weeks, km }: { weeks: string[]; km: number[] }) {
  return <WeeklyBars weeks={weeks} values={km} name="distance" color={T.GREEN} format={(v) => `${v.toFixed(1)} km`} />;
}
