/** Fitness — "Am I getting fitter?" (port of views.fitness). */

import { Stack } from "@mantine/core";

import { IntensityMixChart, PaceChart, Vo2maxChart, WeeklyDistanceChart } from "@/components/charts/fitness";
import { EmptyState, PageHeader, Panel, TwoUp } from "@/components/widgets";
import * as A from "@/lib/analytics";
import { loadWindow } from "@/lib/db";
import type { RangeKey } from "@/lib/range";
import * as VD from "@/lib/verdicts";

export async function FitnessView({ range }: { range: RangeKey }) {
  const { daily: d, activities: acts } = await loadWindow(range);
  if (!d.length) return <EmptyState title="No fitness data yet" />;

  const dates = d.map((r) => r.date);
  const runs = acts.filter((a) => a.activity_type === "running");
  const paced = runs
    .filter((a) => a.date != null && a.pace_min_per_km != null)
    .map((a) => ({ date: a.date!, pace: a.pace_min_per_km! }));
  const intensity = A.weeklyIntensity(acts);
  const distance = A.weeklyDistance(runs);

  return (
    <Stack gap="md">
      <PageHeader title="Fitness" question="Am I getting fitter?" verdict={VD.fitness(d, acts)} />
      <TwoUp>
        <Panel title="VO₂max (running)">
          <Vo2maxChart dates={dates} vo2={d.map((r) => r.vo2max_running)} />
        </Panel>
        <Panel title="Running pace (min/km, lower is faster)">
          <PaceChart dates={dates} runs={paced} avg={A.rolling(paced.map((r) => r.pace), 5)} />
        </Panel>
      </TwoUp>
      <TwoUp>
        <Panel title="Session intensity mix" note="from Garmin training effect">
          <IntensityMixChart weeks={intensity.weeks} easy={intensity.easy} moderate={intensity.moderate} hard={intensity.hard} />
        </Panel>
        <Panel title="Weekly running distance (km)">
          <WeeklyDistanceChart weeks={distance.weeks} km={distance.distance_km} />
        </Panel>
      </TwoUp>
    </Stack>
  );
}
