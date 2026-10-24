"use client";

import { EChart } from "./EChart";
import { fade, type ChartOption } from "./theme";

import * as T from "@/lib/theme";

/**
 * Two-week sparkline for a metric card: gradient fill hugging the line (the
 * y-axis floor sits at the series minimum) and a glowing dot anchoring "now".
 */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const n = values.length;
  const lastPoint = n ? [[n - 1, values[n - 1]]] : [];
  const option: ChartOption = {
    animation: false,
    grid: { left: 0, right: 6, top: 6, bottom: 2 },
    xAxis: { type: "value", show: false, min: 0, max: Math.max(1, n - 1) },
    yAxis: { type: "value", show: false, min: "dataMin", max: "dataMax" },
    series: [
      {
        type: "line",
        data: values.map((v, i) => [i, v]),
        showSymbol: false,
        silent: true,
        lineStyle: { color, width: 2 },
        areaStyle: { color: fade(color, 0.22), origin: "start" },
      },
      // glow + core dot on the latest value
      { type: "scatter", data: lastPoint, symbolSize: 11, silent: true, itemStyle: { color: T.rgba(color, 0.25) } },
      { type: "scatter", data: lastPoint, symbolSize: 5, silent: true, itemStyle: { color } },
    ],
  };
  return <EChart option={option} height={34} />;
}
