"use client";

/** Weekly bar charts shared by the Load and Fitness pages. */

import { EChart } from "./EChart";
import { dateAxis, legend, legendGrid, grid, seriesTooltip, toDate, valueAxis, type ChartOption } from "./theme";

import * as T from "@/lib/theme";

const WEEK_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const weekHeader = (x: string | number) => `Week ending ${WEEK_FMT.format(toDate(x))}`;

export interface StackPart {
  name: string;
  color: string;
  data: number[];
}

/**
 * Weekly stacked bars; `parts` are stacked bottom-up and the legend reads in
 * stack order, top segment first.
 */
export function StackedWeeks({ weeks, parts, format, height = 260 }: {
  weeks: string[];
  parts: StackPart[];
  format: (v: number) => string;
  height?: number;
}) {
  const option: ChartOption = {
    legend: { ...legend, data: parts.map((p) => p.name).toReversed() },
    grid: legendGrid(),
    xAxis: dateAxis(weeks, { bars: true }),
    yAxis: valueAxis,
    tooltip: { ...seriesTooltip(format, weekHeader), axisPointer: { type: "shadow" } },
    series: parts.map((p) => ({
      type: "bar" as const,
      name: p.name,
      stack: "total",
      data: p.data,
      barWidth: "80%",
      // a hairline of card colour separates stacked segments
      itemStyle: { color: p.color, borderColor: T.CARD, borderWidth: 1 },
    })),
  };
  return <EChart option={option} height={height} />;
}

/** One series of weekly bars. */
export function WeeklyBars({ weeks, values, name, color, format, height = 240 }: {
  weeks: string[];
  values: number[];
  name: string;
  color: string;
  format: (v: number) => string;
  height?: number;
}) {
  const option: ChartOption = {
    grid: grid(),
    xAxis: dateAxis(weeks, { bars: true }),
    yAxis: valueAxis,
    tooltip: { ...seriesTooltip(format, weekHeader), axisPointer: { type: "shadow" } },
    series: [{ type: "bar", name, data: values, barWidth: "60%", itemStyle: { color } }],
  };
  return <EChart option={option} height={height} />;
}
