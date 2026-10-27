"use client";

import { ZonedScore } from "./ZonedScore";

/** Daily readiness over traffic-light zones (ready ≥ 67, rest < 34). */
export function ReadinessTrend({ dates, scores }: { dates: string[]; scores: (number | null)[] }) {
  return (
    <ZonedScore
      dates={dates}
      scores={scores}
      name="readiness"
      amber={34}
      green={67}
      greenLabel={{ text: "ready", at: "top" }}
      redLabel={{ text: "rest", at: "bottom" }}
      compact
      height={190}
    />
  );
}
