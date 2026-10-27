"use client";

/**
 * The one ECharts mount point. Registers only the pieces the dashboard uses
 * (tree-shaken core) and renders as SVG so lines stay crisp on retina phones.
 * Height is fixed by the caller so nothing shifts when the chart mounts.
 */

import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";

import type { ChartOption } from "./theme";

echarts.use([
  LineChart, BarChart, ScatterChart,
  GridComponent, LegendComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent,
  SVGRenderer,
]);

export function EChart({ option, height }: { option: ChartOption; height: number }) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge
      opts={{ renderer: "svg" }}
      style={{ height, width: "100%" }}
    />
  );
}
