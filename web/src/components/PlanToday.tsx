/** Today's planned session on the Today page, next to "train hard today?". Links to the Plan page. */

import { Group, Stack, Text } from "@mantine/core";
import { IconAdjustments, IconCalendarEvent, IconCircleCheck } from "@tabler/icons-react";
import Link from "next/link";

import { Card } from "@/components/Card";
import { SUBTLE } from "@/components/widgets";
import type { PlanView } from "@/lib/plans/service";
import * as T from "@/lib/theme";

const INTENSITY = { easy: T.BLUE, moderate: T.PURPLE, hard: T.ORANGE } as const;
const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function PlanToday({ view }: { view: PlanView }) {
  const easeToday = view.proposed.find((c) => c.date === view.today && c.source === "adapt");
  const label = (s: { durationMin: number; distanceKm: number | null }) =>
    [`${s.durationMin} min`, s.distanceKm ? `${s.distanceKm} km` : null].filter(Boolean).join(" · ");
  return (
    <Link href="/plan" style={{ textDecoration: "none", color: "inherit" }}>
      <Card className="metric-card">
        <Stack gap={6}>
          <Group gap={6} c={T.FAINT}>
            <IconCalendarEvent size={14} />
            <Text size="xs" c={T.FAINT}>On your plan today · {view.plan.name}</Text>
          </Group>
          {view.todays.length ? view.todays.map((s) => (
            <Group key={s.id} gap={8} wrap="nowrap">
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: INTENSITY[s.intensity], flexShrink: 0 }} />
              <Text fw={500} c={T.TEXT}>{s.title}</Text>
              <Text size="sm" c={T.MUTED}>{label(s)}</Text>
              {s.outcome === "done" && <IconCircleCheck size={16} color={T.GREEN} />}
            </Group>
          )) : (
            <Text size="sm" c={SUBTLE}>
              Rest day{view.next ? `. Next: ${view.next.title} on ${DAY_FMT.format(new Date(`${view.next.date}T00:00:00Z`))}` : ""}
            </Text>
          )}
          {easeToday && (
            <Group gap={6} c={T.AMBER} wrap="nowrap">
              <IconAdjustments size={14} style={{ flex: "none" }} />
              <Text size="xs" c={T.AMBER}>Your body says ease off: {easeToday.after} instead. Adapt it on the Plan page.</Text>
            </Group>
          )}
        </Stack>
      </Card>
    </Link>
  );
}
