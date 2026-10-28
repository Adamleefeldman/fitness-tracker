/**
 * Palette, Mantine theme and status-colour helpers.
 *
 * Colour language (full traffic light):
 *   GREEN = good   AMBER = caution   RED = genuinely bad
 * Neutral metrics (RHR, steps, pace, ...) use NEUTRAL/BLUE so alarm colours
 * keep their meaning. Zone fills use the *_ZONE rgba variants.
 */

import { createTheme } from "@mantine/core";

// --- palette (dark + vital-green) ---
export const BG = "#0E1217";
export const SIDEBAR = "#0A0D11";
export const CARD = "#181D25";
export const BORDER = "rgba(255,255,255,0.06)";
export const TEXT = "#EAEDF3";
export const MUTED = "#9AA3B2";
export const FAINT = "#66707F";
export const GREEN = "#1FD082";
export const AMBER = "#F4B740";
export const RED = "#F2685C";
export const BLUE = "#5B9BD5";
export const PURPLE = "#AB8FE0";
export const ORANGE = "#FFA15A";
export const NEUTRAL = "#8A97A8"; // lines for metrics with no good/bad direction
export const TRACK = "#232A33";

// translucent zone fills for "what good looks like" bands on charts
export const GREEN_ZONE = "rgba(31,208,130,0.08)";
export const AMBER_ZONE = "rgba(244,183,64,0.07)";
export const RED_ZONE = "rgba(242,104,92,0.07)";

export type Status = "good" | "caution" | "bad" | "neutral";

export const STATUS: Record<Status, string> = {
  good: GREEN,
  caution: AMBER,
  bad: RED,
  neutral: MUTED,
};

/** '#1FD082', 0.2 -> 'rgba(31,208,130,0.2)' (for glows, washes, fills). */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

export const mantineTheme = createTheme({
  primaryColor: "vital",
  primaryShade: 6,
  colors: {
    vital: ["#E6FBF1", "#C2F4DE", "#97ECC8", "#67E3AF", "#3FDD9B",
            "#28D98E", "#1FD082", "#17B975", "#0E9D62", "#00854F"],
  },
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  defaultRadius: "md",
});

// Garmin's training-readiness levels are PRIME · HIGH · MODERATE · LOW · POOR
// (older firmware used VERY_HIGH / VERY_LOW — kept here as aliases so both map).
const LEVELS: Record<string, [string, string]> = {
  PRIME: ["Prime", "You're primed — go for it"],
  HIGH: ["High", "Ready to train hard"],
  MODERATE: ["Moderate", "Listen to your body"],
  LOW: ["Low", "Keep it easy today"],
  POOR: ["Poor", "Prioritise recovery"],
  VERY_HIGH: ["Prime", "You're primed — go for it"],
  VERY_LOW: ["Poor", "Prioritise recovery"],
};

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, c) => p + c.toUpperCase());

export function friendlyLevel(level: string | null | undefined): [string, string] {
  return LEVELS[(level ?? "").toUpperCase()] ?? [level ? titleCase(level) : "—", ""];
}

export function colorForLevel(level: string | null | undefined): string {
  const lvl = (level ?? "").toUpperCase();
  if (["PRIME", "HIGH", "VERY_HIGH"].includes(lvl)) return GREEN;
  if (["MODERATE", "MAINTAINING"].includes(lvl)) return AMBER;
  if (["LOW", "POOR", "VERY_LOW"].includes(lvl)) return RED;
  return MUTED;
}

export function colorForPct(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return MUTED;
  return p >= 75 ? GREEN : p >= 50 ? AMBER : RED;
}
