/** Load — "Am I overtraining?" (port of views.load). */

import { Stack, Text } from "@mantine/core";

import { ActivitiesTable } from "@/components/ActivitiesTable";
import { Card } from "@/components/Card";
import { AcwrChart, LoadChart, RhrChart, StepsChart, WeeklyHoursChart } from "@/components/charts/load";
import { EmptyState, PageHeader, Panel, SUBTLE, TwoUp } from "@/components/widgets";
import * as A from "@/lib/analytics";
import { loadWindow } from "@/lib/db";
import type { RangeKey } from "@/lib/range";
import * as VD from "@/lib/verdicts";

export async function LoadView({ range }: { range: RangeKey }) {
  const { daily: d, activities: acts } = await loadWindow(range);
  if (!d.length) return <EmptyState title="No training data yet" />;

  const dates = d.map((r) => r.date);
  const rhr = d.map((r) => r.resting_hr);
  const steps = d.map((r) => r.steps);

  const wk = A.weeklyHoursByGroup(acts);

  return (
    <Stack gap="md">
      <PageHeader title="Load" question="Am I overtraining?" verdict={VD.load(d)} />
      <Panel title="Acute:chronic workload ratio">
        <AcwrChart dates={dates} ratio={A.acwr(d)} />
      </Panel>
      <TwoUp>
        <Panel title="Training load — acute vs chronic">
          <LoadChart dates={dates} acute={d.map((r) => r.acute_load)} chronic={d.map((r) => r.chronic_load)} />
        </Panel>
        <Panel title="Resting heart rate (bpm)" note="a rising 7-day line = fatigue">
          <RhrChart dates={dates} daily={rhr} avg28={A.rolling(rhr, 28)} avg7={A.rolling(rhr, 7)} />
        </Panel>
      </TwoUp>
      <TwoUp>
        <Panel title="Weekly training hours by type">
          <WeeklyHoursChart weeks={wk.weeks} groups={wk.groups} hours={wk.hours} />
        </Panel>
        <Panel title="Daily movement (steps)">
          <StepsChart dates={dates} steps={steps} avg7={A.rolling(steps, 7)} />
        </Panel>
      </TwoUp>
      <Card>
        <Stack gap="xs">
          <Text size="sm" c={SUBTLE}>Recent activities</Text>
          <ActivitiesTable activities={acts} />
        </Stack>
      </Card>
    </Stack>
  );
}
