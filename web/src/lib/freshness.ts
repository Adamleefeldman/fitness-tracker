/** How fresh the stored data is (the sync pill's rule, shared with the MCP server). */

/** A sync older than this is overdue (the launchd job runs daily). */
export const FRESH_MS = 36 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' of the day before `at`, local time — the newest day a sync at `at` fetches. */
export function dayBefore(at: Date): string {
  const d = new Date(at);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

export interface Freshness {
  /** The sync ran, but the newest day with data is older than that sync fetched: the watch hasn't uploaded. */
  watchBehind: boolean;
  /** The last sync is more than FRESH_MS old. */
  syncOverdue: boolean;
}

export function freshness(syncedAt: Date | null, dataDate: string | null, now = new Date()): Freshness {
  return {
    watchBehind: syncedAt != null && dataDate != null && dataDate < dayBefore(syncedAt),
    syncOverdue: syncedAt == null || now.getTime() - syncedAt.getTime() >= FRESH_MS,
  };
}
