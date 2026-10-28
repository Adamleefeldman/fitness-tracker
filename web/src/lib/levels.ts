/**
 * Status words and Garmin readiness levels, without any UI dependency so the
 * verdicts can run outside the app (the MCP server, tests).
 */

export type Status = "good" | "caution" | "bad" | "neutral";

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

/** A readiness level as [word, phrase], e.g. 'HIGH' → ['High', 'Ready to train hard']. */
export function friendlyLevel(level: string | null | undefined): [string, string] {
  return LEVELS[(level ?? "").toUpperCase()] ?? [level ? titleCase(level) : "—", ""];
}

/** Traffic-light status of a readiness level. */
export function levelStatus(level: string | null | undefined): Status {
  const lvl = (level ?? "").toUpperCase();
  if (["PRIME", "HIGH", "VERY_HIGH"].includes(lvl)) return "good";
  if (["MODERATE", "MAINTAINING"].includes(lvl)) return "caution";
  if (["LOW", "POOR", "VERY_LOW"].includes(lvl)) return "bad";
  return "neutral";
}
