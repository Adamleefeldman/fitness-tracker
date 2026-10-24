/**
 * Shared chart styling — the single figure-styling system (port of figures._base).
 *
 * Conventions (see lib/theme.ts for the colour language):
 *   - context zones say what good looks like wherever a metric has an accepted
 *     healthy range; the line itself stays neutral so the zones carry the judgement.
 *   - white/TEXT lines = "the metric being judged"; coloured lines are only used
 *     where colour itself encodes meaning (traffic light or category).
 */

import type { LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  MarkAreaComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import { graphic, type ComposeOption } from "echarts/core";

import * as T from "@/lib/theme";

export type ChartOption = ComposeOption<
  | LineSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | MarkAreaComponentOption
>;

/** One [from, to] pair in a series' markArea.data. */
type MarkAreaPair = NonNullable<NonNullable<LineSeriesOption["markArea"]>["data"]>[number];

export const GRID = "rgba(255,255,255,0.04)";

/** Vertical gradient fill fading a colour down to transparent. */
export function fade(color: string, topAlpha = 0.18) {
  return new graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: T.rgba(color, topAlpha) },
    { offset: 1, color: "rgba(0,0,0,0)" },
  ]);
}

export function grid(left = 42, right = 12, top = 10, bottom = 28): GridComponentOption {
  return { left, right, top, bottom, containLabel: false };
}

const TICK_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Dates along x, spanning exactly the data with a few "Oct 18" ticks. */
export const timeAxis = {
  type: "time" as const,
  min: "dataMin",
  max: "dataMax",
  splitNumber: 5,
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { show: false },
  axisLabel: {
    color: T.FAINT,
    fontSize: 10,
    hideOverlap: true,
    formatter: (v: number) => TICK_FMT.format(new Date(v)),
  },
};

export const valueAxis = {
  type: "value" as const,
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: GRID } },
  axisLabel: { color: T.FAINT, fontSize: 10 },
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });

/** "Sat, Oct 18" for a 'YYYY-MM-DD' or epoch-ms axis value. */
export function fmtDate(v: string | number) {
  return DATE_FMT.format(typeof v === "number" ? new Date(v) : new Date(`${v}T00:00:00`));
}

/** Crosshair + one tooltip for every series at the hovered date ("x unified"). */
export function axisTooltip(
  formatter: TooltipComponentOption["formatter"],
): TooltipComponentOption {
  return {
    trigger: "axis",
    backgroundColor: T.CARD,
    borderColor: T.BORDER,
    padding: [6, 10],
    textStyle: { color: T.TEXT, fontSize: 11 },
    axisPointer: { type: "line", lineStyle: { color: "rgba(255,255,255,0.18)" } },
    formatter,
  };
}

/** A horizontal context band from y0 to y1, optionally captioned at its right edge. */
export function zone(
  y0: number,
  y1: number,
  fill: string,
  label?: { text: string; color: string; at: "top" | "bottom" },
): MarkAreaPair {
  return [
    {
      yAxis: y0,
      itemStyle: { color: fill },
      label: label
        ? {
            show: true,
            formatter: label.text,
            position: label.at === "top" ? "insideTopRight" : "insideBottomRight",
            color: T.rgba(label.color, 0.55),
            fontSize: 10,
          }
        : { show: false },
    },
    { yAxis: y1 },
  ];
}
