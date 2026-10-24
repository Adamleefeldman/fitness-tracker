/**
 * Today — "Train hard today?" (port of views.today).
 *
 * Readiness hero (ring + verdict + drivers), the readiness trend, then a grid
 * of metric cards each judged against its own 7-day average.
 */

import { Box, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBattery2,
  IconCircleCheck,
  IconFlame,
  IconHeart,
  IconLungs,
  IconMinus,
  IconMoon,
} from "@tabler/icons-react";

import { Card } from "@/components/Card";
import { ReadinessTrend } from "@/components/charts/ReadinessTrend";
import {
  DriverBars,
  EmptyState,
  Greeting,
  MetricCard,
  Panel,
  ReadinessRing,
  SUBTLE,
  type MetricCardProps,
} from "@/components/widgets";
import * as A from "@/lib/analytics";
import { loadWindow } from "@/lib/db";
import { pyFixed } from "@/lib/format";
import { withRange, type RangeKey } from "@/lib/range";
import * as T from "@/lib/theme";
import type { Daily } from "@/lib/types";
import * as VD from "@/lib/verdicts";

const ICON = 15;
const DELTA_ICON = 13;

/** "7h 32m" from seconds. */
function hm(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const s = Math.trunc(seconds);
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

interface MetricSpec {
  col: keyof Daily;
  label: string;
  unit: string;
  icon: React.ReactNode;
  higherGood?: boolean;
  digits?: number; // value precision
  value?: string; // overrides the formatted latest value
  line?: string;
  deltaDiv?: number;
  deltaUnit?: string;
  deltaDigits?: number;
  eps?: number; // |delta| below this reads as "steady"
  href?: string;
  badBelow?: number | null; // traffic-light red when the latest value is under this
}

/** A metric card judged on its latest value vs the mean of the 7 readings before it. */
function metric(daily: Daily[], range: RangeKey, m: MetricSpec): MetricCardProps {
  const { higherGood = true, digits = 0, line = T.GREEN, deltaDiv = 1, deltaUnit = "",
          deltaDigits = 0, eps = 0.5 } = m;
  const s = A.values(daily, m.col);
  const raw = s.length ? s[s.length - 1] : null;
  const dv = s.length >= 2 ? raw! - A.mean(s.slice(0, -1).slice(-7))! : null;
  const scaled = dv == null ? null : dv / deltaDiv;

  let deltaText: string, deltaColor: string, deltaIcon: React.ReactNode;
  if (m.badBelow != null && raw != null && raw < m.badBelow) {
    // threshold breach outranks the day-to-day delta (traffic-light red)
    [deltaText, deltaColor] = ["below your baseline", T.RED];
    deltaIcon = <IconAlertTriangle size={DELTA_ICON} />;
  } else if (scaled == null || Math.abs(scaled) < eps) {
    [deltaText, deltaColor] = ["steady", T.FAINT];
    deltaIcon = <IconMinus size={DELTA_ICON} />;
  } else {
    const good = higherGood ? dv! >= 0 : dv! <= 0;
    deltaColor = good ? T.GREEN : T.AMBER;
    deltaIcon = dv! >= 0 ? <IconArrowUpRight size={DELTA_ICON} /> : <IconArrowDownRight size={DELTA_ICON} />;
    deltaText = `${pyFixed(Math.abs(scaled), deltaDigits)}${deltaUnit} vs 7-day`;
  }
  return {
    label: m.label,
    value: m.value ?? (raw == null ? "—" : pyFixed(raw, digits)),
    unit: m.unit,
    deltaText,
    deltaColor,
    deltaIcon,
    icon: m.icon,
    series: s.slice(-14),
    lineColor: line,
    href: m.href && withRange(m.href, range),
  };
}

function snapshot(daily: Daily[], range: RangeKey): MetricCardProps[] {
  const last = daily[daily.length - 1];
  const cards = [
    metric(daily, range, {
      col: "hrv_last_night_ms", label: "Heart rate variability", unit: "ms",
      icon: <IconHeart size={ICON} />, href: "/sleep", line: T.GREEN,
      badBelow: last.hrv_baseline_low,
    }),
    metric(daily, range, {
      col: "resting_hr", label: "Resting heart rate", unit: "bpm",
      icon: <IconActivity size={ICON} />, higherGood: false, href: "/load", line: T.BLUE,
    }),
    metric(daily, range, {
      col: "sleep_total_seconds", label: "Sleep", unit: "", icon: <IconMoon size={ICON} />,
      value: hm(last.sleep_total_seconds), line: T.PURPLE, deltaDiv: 60, deltaUnit: "m",
      eps: 2, href: "/sleep",
    }),
    metric(daily, range, {
      col: "bb_high", label: "Body Battery", unit: "", icon: <IconBattery2 size={ICON} />,
      href: "/sleep",
    }),
    metric(daily, range, {
      col: "vo2max_running", label: "VO₂max", unit: "", icon: <IconLungs size={ICON} />,
      digits: 1, deltaDigits: 1, eps: 0.05, href: "/fitness",
    }),
  ];

  const acwr = A.acwr(daily).filter((v): v is number => v != null);
  if (acwr.length) {
    const val = acwr[acwr.length - 1];
    const [note, color, icon] =
      val >= 0.8 && val <= 1.3
        ? ["in the 0.8–1.3 sweet spot", T.GREEN, <IconCircleCheck key="i" size={DELTA_ICON} />]
        : val > 1.5
          ? ["well above sweet spot", T.RED, <IconAlertTriangle key="i" size={DELTA_ICON} />]
          : ["outside sweet spot", T.AMBER, <IconAlertTriangle key="i" size={DELTA_ICON} />];
    cards.push({
      label: "Training load", value: pyFixed(val, 2), unit: "acwr",
      deltaText: note, deltaColor: color, deltaIcon: icon, icon: <IconFlame size={ICON} />,
      series: acwr.slice(-14), lineColor: color, href: withRange("/load", range),
    });
  }
  return cards;
}

export async function TodayView({ range }: { range: RangeKey }) {
  const { daily: d } = await loadWindow(range);
  if (!d.length) return <EmptyState title="No data yet" />;

  const last = d[d.length - 1];
  const score = last.training_readiness_score;
  const level = last.training_readiness_level;
  const v = VD.today(d);

  const rdy = A.values(d, "training_readiness_score");
  const delta = rdy.length >= 2 ? rdy[rdy.length - 1] - rdy[rdy.length - 2] : null;
  let deltaTxt = "";
  let deltaCol = T.FAINT;
  if (delta != null && Math.round(delta) !== 0) {
    deltaTxt = `${delta > 0 ? "+" : "-"}${pyFixed(Math.abs(delta))} vs prev day`;
    deltaCol = delta > 0 ? T.GREEN : T.AMBER;
  }

  const ringColor = T.colorForLevel(level);
  return (
    <Stack gap="md">
      <Greeting name="Adam" now={new Date()} />
      <Card>
        {/* `miw` on the detail column makes the Group wrap on phones (ring centred
            on top, drivers full-width below) while staying side by side on wider screens. */}
        <Group gap="lg" align="center" wrap="wrap" justify="center">
          <Box style={{ filter: `drop-shadow(0 0 26px ${T.rgba(ringColor, 0.3)})` }}>
            <ReadinessRing score={score} color={ringColor} />
          </Box>
          <Stack gap={8} miw={240} style={{ flex: 1 }}>
            <Group gap={10} align="baseline">
              <Text fz={18} fw={500} c={ringColor}>{v.word}</Text>
              <Text size="xs" c={deltaCol}>{deltaTxt}</Text>
            </Group>
            <Text size="sm" c={SUBTLE}>{v.sentence}</Text>
            <DriverBars drivers={A.readinessDrivers(d)} />
          </Stack>
        </Group>
      </Card>
      <Panel title="Readiness trend">
        <ReadinessTrend dates={d.map((r) => r.date)} scores={d.map((r) => r.training_readiness_score)} />
      </Panel>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
        {snapshot(d, range).map((c) => <MetricCard key={c.label} {...c} />)}
      </SimpleGrid>
    </Stack>
  );
}
