"use client";

import { EChart } from "./EChart";
import { axisTooltip, fmtDate, grid, timeAxis, valueAxis, zone, type ChartOption } from "./theme";

import * as T from "@/lib/theme";

/** Daily readiness over traffic-light zones (ready ≥ 67, rest < 34). */
export function ReadinessTrend({ dates, scores }: { dates: string[]; scores: (number | null)[] }) {
  const option: ChartOption = {
    grid: grid(30, 8, 6, 22),
    xAxis: timeAxis,
    yAxis: { ...valueAxis, min: 0, max: 100, interval: 50, splitLine: { show: false } },
    tooltip: axisTooltip((params) => {
      const [p] = Array.isArray(params) ? params : [params];
      const [date, v] = p.value as [string, number | null];
      return `${fmtDate(date)}<br/><b>${v == null ? "—" : Math.round(v)}</b> readiness`;
    }),
    series: [
      {
        type: "line",
        name: "readiness",
        data: dates.map((d, i) => [d, scores[i]]),
        showSymbol: false,
        lineStyle: { color: T.TEXT, width: 2 },
        itemStyle: { color: T.TEXT },
        markArea: {
          silent: true,
          data: [
            zone(67, 100, T.GREEN_ZONE, { text: "ready", color: T.GREEN, at: "top" }),
            zone(34, 67, T.AMBER_ZONE),
            zone(0, 34, T.RED_ZONE, { text: "rest", color: T.RED, at: "bottom" }),
          ],
        },
      },
    ],
  };
  return <EChart option={option} height={190} />;
}
