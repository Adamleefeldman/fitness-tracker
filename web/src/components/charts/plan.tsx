"use client";

/** Plan page charts. */

import { EChart } from "./EChart";
import { dateAxis, legend, legendGrid, seriesTooltip, toDate, valueAxis, type ChartOption } from "./theme";

import * as T from "@/lib/theme";

const WEEK_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** 200 → "3h20". */
const hm = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`;

/**
 * Planned training per week as a faint bar, with what was actually done drawn
 * inside it, so a shortfall reads as the empty part of the bar.
 */
export function PlanVolumeChart({ weeks, planned, done }: {
  /** Week-ending Sundays. */
  weeks: string[];
  planned: number[];
  /** Null for weeks still to come. */
  done: (number | null)[];
}) {
  const top = Math.max(60, ...planned, ...done.map((d) => d ?? 0));
  const step = top > 8 * 60 ? 120 : 60;
  const option: ChartOption = {
    legend: { ...legend, data: ["planned", "done"] },
    grid: legendGrid(),
    xAxis: dateAxis(weeks, { bars: true }),
    // whole hours on the axis: every hour, or every 2 for big weeks
    yAxis: {
      ...valueAxis,
      interval: step,
      max: Math.ceil(top / step) * step,
      axisLabel: { ...valueAxis.axisLabel, formatter: (v: number) => `${v / 60}h` },
    },
    tooltip: {
      ...seriesTooltip(hm, (x) => `Week ending ${WEEK_FMT.format(toDate(x))}`),
      axisPointer: { type: "shadow" },
    },
    series: [
      {
        type: "bar", name: "planned", data: planned, barWidth: "62%",
        itemStyle: { color: T.rgba("#FFFFFF", 0.08), borderColor: T.rgba("#FFFFFF", 0.18), borderWidth: 1 },
      },
      {
        type: "bar", name: "done", data: done, barWidth: "40%", barGap: "-81%",
        itemStyle: { color: T.BLUE },
      },
    ],
  };
  return <EChart option={option} height={240} />;
}
