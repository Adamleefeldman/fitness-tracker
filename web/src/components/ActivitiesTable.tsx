/** The 20 most recent activities in the window (Load page). */

import type { CSSProperties } from "react";

import { mmss, pyFixed } from "@/lib/format";
import * as T from "@/lib/theme";
import type { Activity } from "@/lib/types";

const TH: CSSProperties = {
  textAlign: "left", padding: "6px 10px", color: T.FAINT, fontWeight: 400,
  borderBottom: `1px solid ${T.BORDER}`, fontSize: 11,
};
const TD: CSSProperties = {
  padding: "6px 10px", color: T.TEXT, borderBottom: `1px solid ${T.BORDER}`, fontSize: 12,
};

const num = (v: number | null, digits: number) => (v == null ? "—" : pyFixed(v, digits));

const COLUMNS: [string, (a: Activity) => string][] = [
  ["Date", (a) => a.date ?? "—"],
  ["Type", (a) => a.activity_type ?? "—"],
  ["Name", (a) => a.name ?? "—"],
  ["km", (a) => num(a.distance_km, 1)],
  ["min/km", (a) => mmss(a.pace_min_per_km)],
  ["HR", (a) => num(a.avg_hr, 0)],
  ["Load", (a) => num(a.training_load, 0)],
];

export function ActivitiesTable({ activities }: { activities: Activity[] }) {
  const recent = activities
    .toSorted((a, b) => (b.start_time_local ?? "").localeCompare(a.start_time_local ?? ""))
    .slice(0, 20);
  return (
    // Scroll the 7-column table horizontally on phones instead of letting it
    // squash or push the page wider than the viewport.
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
        <thead>
          <tr>{COLUMNS.map(([h]) => <th key={h} style={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {recent.map((a) => (
            <tr key={a.activity_id}>
              {COLUMNS.map(([h, cell]) => (
                // keep the date on one line
                <td key={h} style={h === "Date" ? { ...TD, whiteSpace: "nowrap" } : TD}>{cell(a)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
