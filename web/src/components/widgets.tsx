/** Reusable dashboard building blocks. */

import {
  Box,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconTools } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/Card";
import { Sparkline } from "@/components/charts/Sparkline";
import * as T from "@/lib/theme";
import type { Verdict } from "@/lib/verdicts";

export const SUBTLE = "#C2C8D2"; // panel titles and secondary sentences

export function Greeting({ name, now }: { name: string; now: Date }) {
  const hour = now.getHours();
  const g = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return <Text fz={18} fw={500} c={T.TEXT}>{g}, {name}</Text>;
}

export function ReadinessRing({ score, color }: { score: number | null; color: string }) {
  return (
    <RingProgress
      size={132}
      thickness={11}
      roundCaps
      rootColor={T.TRACK}
      sections={[{ value: Math.max(0, Math.min(100, score ?? 0)), color }]}
      label={
        <Stack gap={0} align="center">
          <Text className="num" fz={30} fw={500} ta="center" c={T.TEXT}>
            {score != null ? Math.trunc(score) : "—"}
          </Text>
          <Text size="xs" c={T.FAINT} ta="center">Readiness</Text>
        </Stack>
      }
    />
  );
}

export function DriverBars({ drivers }: { drivers: Partial<Record<string, number>> }) {
  const entries = Object.entries(drivers) as [string, number][];
  if (!entries.length) {
    return <Text size="xs" c={T.FAINT}>Driver detail unavailable for this day.</Text>;
  }
  return (
    <SimpleGrid cols={2} spacing="md" verticalSpacing="xs">
      {entries.map(([name, val]) => (
        <Box key={name}>
          <Group justify="space-between" mb={3}>
            <Text size="xs" c={T.MUTED}>{name}</Text>
            <Text size="xs" c={T.TEXT} className="num">{Math.trunc(val)}</Text>
          </Group>
          <Progress value={val} color={T.colorForPct(val)} size="sm" radius="xl" bg={T.TRACK} />
        </Box>
      ))}
    </SimpleGrid>
  );
}

export interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
  deltaText: string;
  deltaColor: string;
  deltaIcon: ReactNode;
  icon: ReactNode;
  series: number[];
  lineColor: string;
  href?: string;
}

export function MetricCard(p: MetricCardProps) {
  const inner = (
    <Card className="metric-card">
      <Group gap={6} c={T.FAINT}>
        {p.icon}
        <Text size="xs" c={T.FAINT}>{p.label}</Text>
      </Group>
      <Group gap={4} align="baseline" mt={4}>
        <Text className="num" fz={24} fw={500} c={T.TEXT}>{p.value}</Text>
        <Text size="xs" c={T.FAINT}>{p.unit}</Text>
      </Group>
      <Group gap={4} mt={2} c={p.deltaColor}>
        {p.deltaIcon}
        <Text size="xs" c={p.deltaColor}>{p.deltaText}</Text>
      </Group>
      <Box mt={6}>
        <Sparkline values={p.series} color={p.lineColor} />
      </Box>
    </Card>
  );
  if (!p.href) return inner;
  return (
    <Link href={p.href} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  );
}

/** A titled card around one chart. */
export function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c={SUBTLE}>{title}</Text>
          {note && <Text size="xs" c={T.FAINT}>{note}</Text>}
        </Group>
        {children}
      </Stack>
    </Card>
  );
}

export function EmptyState({ title }: { title: string }) {
  return (
    <Center mih={320}>
      <Stack align="center" gap="xs">
        <IconTools size={28} color={T.FAINT} />
        <Text fz={18} fw={500} c={T.TEXT} ta="center">{title}</Text>
        <Text size="sm" c={T.MUTED} ta="center" maw={380}>
          Run a backfill first: uv run python -m garmin_health.cli backfill --all
        </Text>
      </Stack>
    </Center>
  );
}

/**
 * Status dot + verdict word + one-line reasoning, washed in the status colour
 * so the page's answer reads before any chart does.
 */
export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const color = T.STATUS[verdict.status] ?? T.MUTED;
  return (
    <Paper
      radius="md"
      p="sm"
      px="md"
      style={{
        background: `linear-gradient(90deg, ${T.rgba(color, 0.1)}, ${T.rgba(color, 0.03)} 55%, transparent)`,
        border: `1px solid ${T.rgba(color, 0.22)}`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <Group gap={10} wrap="wrap">
        <div
          style={{
            width: 9, height: 9, borderRadius: "50%", background: color,
            flexShrink: 0, boxShadow: `0 0 10px ${color}`,
          }}
        />
        <Text fw={600} fz={15} c={color}>{verdict.word}</Text>
        <Text size="sm" c={T.MUTED} style={{ flex: 1 }}>{verdict.sentence}</Text>
      </Group>
    </Paper>
  );
}

/** Page title + its question, then the verdict that answers it. */
export function PageHeader({ title, question, verdict }: { title: string; question: string; verdict: Verdict }) {
  return (
    <Stack gap={8}>
      <Group gap={10} align="baseline">
        <Text fz={18} fw={500} c={T.TEXT}>{title}</Text>
        <Text size="xs" c={T.FAINT}>{question}</Text>
      </Group>
      <VerdictBanner verdict={verdict} />
    </Stack>
  );
}

/** Two panels side by side on desktop, stacked on phones. */
export function TwoUp({ children }: { children: ReactNode }) {
  return <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">{children}</SimpleGrid>;
}

/** Spinner shown while a page's data streams in. */
export function PageLoading() {
  return (
    <Stack align="center" py="xl">
      <Loader color="vital" size="sm" />
    </Stack>
  );
}
