/** The global time-range control (30d / 90d / 1y / All), carried in `?range=`. */

export const RANGES = ["30d", "90d", "1y", "All"] as const;
export type RangeKey = (typeof RANGES)[number];

export const DEFAULT_RANGE: RangeKey = "90d";

/** Days of history per range; null means everything. */
export const RANGE_DAYS: Record<RangeKey, number | null> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
  All: null,
};

export function parseRange(value: string | string[] | null | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as RangeKey) : DEFAULT_RANGE;
}

/** `href` with the range appended, omitting it when it's the default. */
export function withRange(href: string, range: RangeKey): string {
  return range === DEFAULT_RANGE ? href : `${href}?range=${encodeURIComponent(range)}`;
}
