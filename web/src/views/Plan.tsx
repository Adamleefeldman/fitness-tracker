/**
 * Plan — "What's my next session?"
 *
 * Without a plan: the form, next to what the plan will be built from (the
 * Garmin profile and body state). With one: today's session in the light of
 * the body's state (and the adaptation it suggests), this week and next
 * against what was done, the phases to the event, planned vs done volume, and
 * the reasons the plan looks the way it does.
 */

import { Badge, Box, Group, List, ListItem, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconAdjustments, IconCircle, IconCircleCheck, IconCircleDot, IconCircleX, IconFlag, IconPlayerSkipForward,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { adaptPlanAction, archivePlanAction, markSessionAction } from "@/app/plan/actions";
import { Card } from "@/components/Card";
import { PlanVolumeChart } from "@/components/charts/plan";
import { PlanForm } from "@/components/PlanForm";
import { SubmitButton } from "@/components/SubmitButton";
import { PageHeader, Panel, SUBTLE, TwoUp } from "@/components/widgets";
import { loadPlanPage } from "@/lib/plans-db";
import type { Tracked } from "@/lib/plans/adapt";
import { formatDuration, formatPace } from "@/lib/plans/paces";
import { addDays, daysBetween } from "@/lib/plans/profile";
import type { PlanView as View } from "@/lib/plans/service";
import { GOAL_LABELS, type BodyState, type Intensity, type Phase, type Profile } from "@/lib/plans/types";
import * as T from "@/lib/theme";

const QUESTION = "What's my next session?";

// intensity is identity, not status: the same hues as the Fitness page's intensity mix
const INTENSITY: Record<Intensity, string> = { easy: T.BLUE, moderate: T.PURPLE, hard: T.ORANGE };
const STATE: Record<BodyState["level"], { color: string; word: string }> = {
  ready: { color: T.GREEN, word: "Ready" },
  normal: { color: T.MUTED, word: "Normal" },
  caution: { color: T.AMBER, word: "Caution" },
  recover: { color: T.RED, word: "Recover" },
};
const PHASE: Record<Phase, string> = {
  base: T.rgba(T.BLUE, 0.35), build: T.rgba(T.PURPLE, 0.4), peak: T.rgba(T.ORANGE, 0.45), taper: T.rgba("#FFFFFF", 0.22),
};

const DAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (date: string) => DAY_FMT.format(new Date(`${date}T00:00:00Z`));
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`);
const size = (s: { durationMin: number; distanceKm: number | null }) =>
  [hm(s.durationMin), s.distanceKm ? `${s.distanceKm} km` : null].filter(Boolean).join(" · ");

export async function PlanView() {
  const { view, profile } = await loadPlanPage();
  if (!view) {
    return (
      <Stack gap="md">
        <PageHeader
          title="Plan"
          question={QUESTION}
          verdict={{ status: "neutral", word: "No plan", sentence: "Set a goal and it builds a plan from your Garmin data and how your body is doing." }}
        />
        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
          <Box style={{ gridColumn: "span 2" }} className="plan-form-col">
            <Card>
              <Stack gap="sm">
                <Text size="sm" c={SUBTLE}>Build a training plan</Text>
                <PlanForm />
              </Stack>
            </Card>
          </Box>
          <ProfileCard profile={profile} />
        </SimpleGrid>
      </Stack>
    );
  }

  const weekEnds = view.weeks.map((w) => addDays(w.start, 6));
  const nextMonday = addDays(view.today, 7 - ((new Date(`${view.today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const nextWeek = view.sessions.filter((s) => s.date >= nextMonday && s.date <= addDays(nextMonday, 6));

  return (
    <Stack gap="md">
      <PageHeader title="Plan" question={QUESTION} verdict={view.verdict} />
      <TwoUp>
        <TodayCard view={view} />
        <TimelineCard view={view} />
      </TwoUp>
      <TwoUp>
        <WeekCard title="This week" sessions={view.thisWeek} today={view.today} />
        <WeekCard title="Next week" sessions={nextWeek} today={view.today} />
      </TwoUp>
      <Panel title="Weekly training: planned vs done">
        <PlanVolumeChart
          weeks={weekEnds}
          planned={view.weeks.map((w) => w.plannedMin)}
          done={view.weeks.map((w) => (w.start <= view.today ? w.doneMin : null))}
        />
      </Panel>
      <WhyCard view={view} />
    </Stack>
  );
}

function Dot({ color }: { color: string }) {
  return <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />;
}

function StateLine({ state }: { state: BodyState }) {
  const s = STATE[state.level];
  return (
    <Group gap={8} wrap="nowrap" align="flex-start">
      <Box mt={6}><Dot color={s.color} /></Box>
      <Text size="sm" c={T.MUTED}>
        <Text span fw={600} c={s.color}>{s.word}</Text> — {state.reasons.join("; ")}
      </Text>
    </Group>
  );
}

function SessionBlock({ s }: { s: Tracked }) {
  return (
    <Stack gap={4}>
      <Group gap={8} wrap="nowrap">
        <Dot color={INTENSITY[s.intensity]} />
        <Text fz={18} fw={500} c={T.TEXT}>{s.title}</Text>
        <Badge variant="light" color="gray" size="sm">{s.intensity}</Badge>
      </Group>
      <Text size="sm" c={T.MUTED} className="num">{size(s)}</Text>
      <Text size="sm" c={SUBTLE}>{s.description}</Text>
      {/* an adapted session's reason is already in its description */}
      {s.note && s.source === "edit" && <Text size="xs" c={T.FAINT}>Note: {s.note}</Text>}
    </Stack>
  );
}

function TodayCard({ view }: { view: View }) {
  const adapt = view.proposed.filter((c) => c.source === "adapt");
  const restore = view.proposed.filter((c) => c.source === "plan");
  return (
    <Card>
      <Stack gap="sm">
        <Text size="sm" c={SUBTLE}>Today · {dayLabel(view.today)}</Text>
        {view.todays.length ? view.todays.map((s) => (
          <Stack key={s.id} gap="xs">
            <SessionBlock s={s} />
            {s.outcome === "done" ? (
              <Group gap={6} c={T.GREEN}>
                <IconCircleCheck size={16} />
                <Text size="sm" c={T.GREEN}>
                  Done{s.activity ? ` — ${s.activity.type?.replace(/_/g, " ")} ${s.activity.minutes} min` : ""}
                </Text>
              </Group>
            ) : s.outcome !== "skipped" && (
              <Group gap="xs">
                <MarkButton id={s.id} status="done" label="Mark done" />
                <MarkButton id={s.id} status="skipped" label="Skip" />
              </Group>
            )}
          </Stack>
        )) : (
          <Stack gap={4}>
            <Text fz={18} fw={500} c={T.TEXT}>Rest day</Text>
            {view.next && (
              <Text size="sm" c={T.MUTED}>
                Next: {view.next.title} on {dayLabel(view.next.date)} ({size(view.next)})
              </Text>
            )}
          </Stack>
        )}
        <Box pt={4} style={{ borderTop: `1px solid ${T.BORDER}` }}>
          <Text size="xs" c={T.FAINT} mb={4}>Body state</Text>
          <StateLine state={view.state} />
        </Box>
        {(adapt.length > 0 || restore.length > 0) && (
          <Box
            p="sm"
            style={{ borderRadius: 8, background: T.rgba(adapt.length ? T.AMBER : T.GREEN, 0.08), border: `1px solid ${T.rgba(adapt.length ? T.AMBER : T.GREEN, 0.25)}` }}
          >
            <Group gap={6} mb={6} c={adapt.length ? T.AMBER : T.GREEN}>
              <IconAdjustments size={16} />
              <Text size="sm" fw={500}>{adapt.length ? "Suggested for the next days" : "Back to the plan"}</Text>
            </Group>
            <Stack gap={2} mb="xs">
              {view.proposed.map((c) => (
                <Text key={c.id} size="sm" c={T.MUTED}>{dayLabel(c.date)}: {c.before} → {c.after}</Text>
              ))}
            </Stack>
            <form action={adaptPlanAction}>
              <SubmitButton size="xs" color={adapt.length ? "yellow" : "vital"} variant="light">
                {adapt.length ? "Adapt my week" : "Restore the plan"}
              </SubmitButton>
            </form>
          </Box>
        )}
      </Stack>
    </Card>
  );
}

function MarkButton({ id, status, label }: { id: number; status: "done" | "skipped"; label: string }) {
  return (
    <form action={markSessionAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton size="xs" variant="light" color={status === "done" ? "vital" : "gray"}>{label}</SubmitButton>
    </form>
  );
}

function TimelineCard({ view }: { view: View }) {
  const { plan, today } = view;
  const total = daysBetween(plan.startDate, plan.endDate) + 1;
  const at = Math.min(1, Math.max(0, (daysBetween(plan.startDate, today) + 0.5) / total));
  const events = view.sessions.filter((s) => s.discipline === "race");
  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" align="baseline">
          <Text size="sm" c={SUBTLE}>{plan.name}</Text>
          <Text size="xs" c={T.FAINT}>{GOAL_LABELS[plan.goal]} · {plan.input.daysPerWeek} days a week</Text>
        </Group>
        <Group gap={6} align="baseline">
          <Text className="num" fz={30} fw={500} c={T.TEXT}>
            {view.daysToEvent ?? Math.max(0, daysBetween(today, plan.endDate))}
          </Text>
          <Text size="sm" c={T.MUTED}>{plan.eventDate ? "days to go" : "days left in the block"}</Text>
        </Group>
        <Box pos="relative" mt={4}>
          <Group gap={2} wrap="nowrap" h={14}>
            {plan.phases.map((p) => (
              <Box
                key={p.phase + p.start}
                h="100%"
                style={{ flex: daysBetween(p.start, p.end) + 1, background: PHASE[p.phase], borderRadius: 3 }}
              />
            ))}
          </Group>
          {today >= plan.startDate && today <= plan.endDate && (
            <Box pos="absolute" top={-4} h={22} w={2} style={{ left: `${at * 100}%`, background: T.TEXT, borderRadius: 1 }} />
          )}
          <Group gap={2} wrap="nowrap" mt={4}>
            {plan.phases.map((p) => (
              <Text key={p.phase + p.start} size="10px" c={p.phase === view.phaseNow ? T.TEXT : T.FAINT}
                style={{ flex: daysBetween(p.start, p.end) + 1, overflow: "hidden", whiteSpace: "nowrap" }}>
                {p.phase}
              </Text>
            ))}
          </Group>
        </Box>
        <Stack gap={4} mt={4}>
          {events.map((e) => (
            <Group key={e.id} gap={6} wrap="nowrap">
              <IconFlag size={14} color={e.role === "race" ? T.GREEN : T.MUTED} />
              <Text size="sm" c={e.role === "race" ? T.TEXT : T.MUTED}>{e.title}</Text>
              <Text size="xs" c={T.FAINT} ml="auto">{dayLabel(e.date)}</Text>
            </Group>
          ))}
        </Stack>
        {view.compliance14.due > 0 && (
          <Text size="xs" c={T.FAINT}>
            Last 14 days: {view.compliance14.done} of {view.compliance14.due} sessions done
          </Text>
        )}
      </Stack>
    </Card>
  );
}

const OUTCOME: Record<Tracked["outcome"], { icon: ReactNode; color: string }> = {
  done: { icon: <IconCircleCheck size={16} />, color: T.GREEN },
  missed: { icon: <IconCircleX size={16} />, color: T.AMBER },
  skipped: { icon: <IconPlayerSkipForward size={16} />, color: T.FAINT },
  today: { icon: <IconCircleDot size={16} />, color: T.TEXT },
  upcoming: { icon: <IconCircle size={16} />, color: T.FAINT },
};

function WeekCard({ title, sessions, today }: { title: string; sessions: Tracked[]; today: string }) {
  const phase = sessions[0]?.phase;
  return (
    <Card>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" c={SUBTLE}>{title}</Text>
          {phase && <Text size="xs" c={T.FAINT}>{phase} phase · {hm(sessions.reduce((m, s) => m + s.durationMin, 0))}</Text>}
        </Group>
        {sessions.length ? sessions.map((s) => {
          const o = OUTCOME[s.outcome];
          return (
            <Group key={s.id} gap={10} wrap="nowrap" align="flex-start" opacity={s.date < today && s.outcome !== "done" ? 0.75 : 1}>
              <Box c={o.color} mt={2}>{o.icon}</Box>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Dot color={INTENSITY[s.intensity]} />
                  <Text size="sm" c={T.TEXT} truncate>{s.title}</Text>
                </Group>
                <Text size="xs" c={T.FAINT}>{dayLabel(s.date)} · {size(s)}</Text>
              </Box>
            </Group>
          );
        }) : <Text size="sm" c={T.FAINT}>Nothing planned.</Text>}
      </Stack>
    </Card>
  );
}

function WhyCard({ view }: { view: View }) {
  return (
    <Card>
      <Stack gap="xs">
        <Text size="sm" c={SUBTLE}>Why the plan looks like this</Text>
        <List size="sm" c={T.MUTED} spacing={4}>
          {/* ListItem, not List.Item: dot-named parts are undefined from a server component */}
          {view.plan.notes.map((n) => <ListItem key={n}>{n}</ListItem>)}
        </List>
        {view.changes.length > 0 && (
          <>
            <Text size="sm" c={SUBTLE} mt="xs">Recent changes</Text>
            {view.changes.slice(0, 5).map((c) => (
              <Text key={c.at} size="xs" c={T.FAINT}>{c.at.slice(0, 10)} · {c.source}: {c.summary}</Text>
            ))}
          </>
        )}
        <Group justify="space-between" mt="xs">
          <Text size="xs" c={T.FAINT}>
            Ask Claude to swap, move or add sessions; it can edit this plan.
          </Text>
          <form action={archivePlanAction}>
            <SubmitButton size="xs" variant="subtle" color="gray">Archive plan</SubmitButton>
          </form>
        </Group>
      </Stack>
    </Card>
  );
}

function ProfileCard({ profile: p }: { profile: Profile }) {
  const rows: [string, string][] = [
    ["Training", `${hm(p.weeklyMinutes4)} a week, ${p.sessionsPerWeek4} sessions (last 4 weeks)`],
    ["Running", `${p.runKmPerWeek4} km a week, longest run ${p.longestRunKm8} km`],
    ["Mix", Object.entries(p.mix).filter(([, v]) => v > 0).map(([g, v]) => `${g} ${Math.round(v * 100)}%`).join(", ") || "—"],
    ["VO₂max", p.vo2max != null ? `${p.vo2max}${p.vo2maxTrend ? ` (${p.vo2maxTrend > 0 ? "+" : ""}${p.vo2maxTrend} in 90 days)` : ""}` : "—"],
  ];
  if (p.paces) {
    rows.push(["Paces", `easy ${formatDuration(p.paces.easy[1])}–${formatPace(p.paces.easy[0])}, threshold ${formatPace(p.paces.threshold)}`]);
  }
  return (
    <Card>
      <Stack gap="xs">
        <Text size="sm" c={SUBTLE}>What your plan starts from</Text>
        {rows.map(([k, v]) => (
          <Group key={k} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="xs" c={T.FAINT} w={64} style={{ flexShrink: 0 }}>{k}</Text>
            <Text size="sm" c={T.MUTED}>{v}</Text>
          </Group>
        ))}
        <Box pt={6} style={{ borderTop: `1px solid ${T.BORDER}` }}>
          <Text size="xs" c={T.FAINT} mb={4}>Body state</Text>
          <StateLine state={p.state} />
        </Box>
      </Stack>
    </Card>
  );
}
