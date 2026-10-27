import { Group, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

import { lastDataDate, lastSynced } from "@/lib/db";
import * as T from "@/lib/theme";

const FRESH_MS = 36 * 60 * 60 * 1000;

function clock(d: Date) {
  // "7:05am"
  return d
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, "")
    .toLowerCase();
}

export function SyncPillView({ label, color }: { label: string; color: string }) {
  return (
    <Group
      gap={6}
      px={11}
      py={5}
      wrap="nowrap"
      style={{ background: T.CARD, border: `1px solid ${T.BORDER}`, borderRadius: 20 }}
    >
      <IconRefresh size={14} color={color} />
      <Text size="xs" c={T.MUTED}>{label}</Text>
    </Group>
  );
}

/** 'YYYY-MM-DD' of the day before `at`, local time — the newest day a sync at `at` fetches. */
function dayBefore(at: Date) {
  const d = new Date(at);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

/**
 * "Synced 7:05am" (green while fresh, amber once older than 36h), or
 * "No data since Oct 24" (amber) when the sync ran but the watch hasn't uploaded.
 */
export async function SyncPill() {
  const [syncedAt, dataDate] = await Promise.all([lastSynced(), lastDataDate()]);
  if (!syncedAt) return <SyncPillView label="Not synced" color={T.FAINT} />;

  if (dataDate && dataDate < dayBefore(syncedAt)) {
    const day = new Date(`${dataDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return <SyncPillView label={`No data since ${day}`} color={T.AMBER} />;
  }
  const now = new Date();
  const sameDay = syncedAt.toDateString() === now.toDateString();
  const weekday = syncedAt.toLocaleDateString("en-GB", { weekday: "short" });
  const label = sameDay ? `Synced ${clock(syncedAt)}` : `Synced ${weekday} ${clock(syncedAt)}`;
  const color = now.getTime() - syncedAt.getTime() < FRESH_MS ? T.GREEN : T.AMBER;
  return <SyncPillView label={label} color={color} />;
}
