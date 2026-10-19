import { Group, Text } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

import { lastSynced } from "@/lib/db";
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

/** "Synced 7:05am" (green while fresh, amber once older than 36h). */
export async function SyncPill() {
  const syncedAt = await lastSynced();
  if (!syncedAt) return <SyncPillView label="Not synced" color={T.FAINT} />;

  const now = new Date();
  const sameDay = syncedAt.toDateString() === now.toDateString();
  const weekday = syncedAt.toLocaleDateString("en-GB", { weekday: "short" });
  const label = sameDay ? `Synced ${clock(syncedAt)}` : `Synced ${weekday} ${clock(syncedAt)}`;
  const color = now.getTime() - syncedAt.getTime() < FRESH_MS ? T.GREEN : T.AMBER;
  return <SyncPillView label={label} color={color} />;
}
