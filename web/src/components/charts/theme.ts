/**
 * Shared chart styling — the single figure-styling system (port of figures._base).
 *
 * Conventions (see lib/theme.ts for the colour language):
 *   - context zones say what good looks like wherever a metric has an accepted
 *     healthy range; the line itself stays neutral so the zones carry the judgement.
 *   - white/TEXT lines = "the metric being judged"; coloured lines are only used
 *     where colour itself encodes meaning (traffic light or category).
 */

import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  LegendComponentOption,
  MarkAreaComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import { graphic, type ComposeOption } from "echarts/core";

import * as T from "@/lib/theme";

export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | LegendComponentOption
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

/**
 * Dates along x as categories (one per day or week — the rows are contiguous),
 * labelled "Oct 18" at about six evenly spaced points. Lines run edge to edge;
 * bars sit in their own slot.
 */
export function dateAxis(dates: string[], { bars = false } = {}) {
  return {
    type: "category" as const,
    data: dates,
    boundaryGap: bars,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: {
      color: T.FAINT,
      fontSize: 10,
      interval: Math.max(0, Math.ceil(dates.length / 6) - 1),
      formatter: (v: string) => TICK_FMT.format(toDate(v)),
    },
  };
}

export const valueAxis = {
  type: "value" as const,
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: GRID } },
  axisLabel: { color: T.FAINT, fontSize: 10 },
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" });

/** An axis value ('YYYY-MM-DD', read as local midnight, or epoch ms) as a Date. */
export function toDate(v: string | number) {
  return typeof v === "number" ? new Date(v) : new Date(`${v}T00:00:00`);
}

/** "Sat, Oct 18" for an axis value. */
export function fmtDate(v: string | number) {
  return DATE_FMT.format(toDate(v));
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
  label?: { text: string; color: string; at: "top" | "middle" | "bottom" },
): MarkAreaPair {
  return [
    {
      yAxis: y0,
      itemStyle: { color: fill },
      label: label
        ? {
            show: true,
            formatter: label.text,
            position: ({ top: "insideTopRight", middle: "insideRight", bottom: "insideBottomRight" } as const)[label.at],
            color: T.rgba(label.color, 0.55),
            fontSize: 10,
          }
        : { show: false },
    },
    { yAxis: y1 },
  ];
}

/** Horizontal legend above the plot, top-left (charts with >= 2 series). */
export const legend: LegendComponentOption = {
  top: 0,
  left: 0,
  itemWidth: 14,
  itemHeight: 8,
  itemGap: 14,
  textStyle: { color: T.MUTED, fontSize: 11 },
  inactiveColor: T.FAINT,
};

/** Grid with room for the legend above it. */
export function legendGrid(left = 42, right = 12, bottom = 28): GridComponentOption {
  return grid(left, right, 30, bottom);
}

interface TooltipRow {
  marker?: unknown;
  seriesName?: string;
  axisValue?: string;
  value?: unknown;
}

/**
 * Multi-series axis tooltip: a date header, then one "● name  value" row per
 * series (skipping series with no value that day). Values wear text ink; the
 * marker dot carries the series identity.
 */
export function seriesTooltip(
  format: (value: number, seriesName: string) => string,
  header: (x: string | number) => string = fmtDate,
): TooltipComponentOption {
  return axisTooltip((params) => {
    const rows = (Array.isArray(params) ? params : [params]) as TooltipRow[];
    const lines = rows.flatMap((p) => {
      const v = p.value as number | null | undefined;
      if (v == null || Number.isNaN(v)) return [];
      return [`${p.marker}${p.seriesName} <b style="float:right;margin-left:14px">${format(v, p.seriesName!)}</b>`];
    });
    return [header(rows[0].axisValue!), ...lines].join("<br/>");
  });
}
