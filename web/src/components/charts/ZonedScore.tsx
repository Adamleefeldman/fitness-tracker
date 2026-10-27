"use client";

/**
 * A 0–100 score drawn as the white "judged" line over traffic-light zones —
 * shared by readiness (Today) and sleep score (Sleep).
 */

import { EChart } from "./EChart";
import { dateAxis, grid, seriesTooltip, valueAxis, zone, type ChartOption } from "./theme";

import * as T from "@/lib/theme";

type Caption = { text: string; at: "top" | "bottom" };

export interface ZonedScoreProps {
  dates: string[];
  scores: (number | null)[];
  name: string;
  /** Lower bounds of the amber and green zones; red runs from 0 to `amber`. */
  amber: number;
  green: number;
  greenLabel?: Caption;
  redLabel?: Caption;
  compact?: boolean; // tighter margins and only 0/50/100 ticks
  height: number;
}

export function ZonedScore(p: ZonedScoreProps) {
  const option: ChartOption = {
    grid: p.compact ? grid(30, 8, 6, 22) : grid(),
    xAxis: dateAxis(p.dates),
    yAxis: { ...valueAxis, min: 0, max: 100, ...(p.compact && { interval: 50 }), splitLine: { show: false } },
    tooltip: seriesTooltip((v) => v.toFixed(0)),
    series: [
      {
        type: "line",
        name: p.name,
        data: p.scores,
        showSymbol: false,
        lineStyle: { color: T.TEXT, width: 2 },
        itemStyle: { color: T.TEXT },
        markArea: {
          silent: true,
          data: [
            zone(p.green, 100, T.GREEN_ZONE, p.greenLabel && { ...p.greenLabel, color: T.GREEN }),
            zone(p.amber, p.green, T.AMBER_ZONE),
            zone(0, p.amber, T.RED_ZONE, p.redLabel && { ...p.redLabel, color: T.RED }),
          ],
        },
      },
    ],
  };
  return <EChart option={option} height={p.height} />;
}
