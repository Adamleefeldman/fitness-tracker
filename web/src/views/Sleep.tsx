/** Sleep & Recovery — "Is my sleep and recovery improving?" (port of views.sleep). */

import { Stack } from "@mantine/core";

import {
  BodyBatteryChart,
  HrvChart,
  SleepConsistencyChart,
  SleepScoreChart,
  SleepStagesChart,
  StressChart,
} from "@/components/charts/sleep";
import { EmptyState, PageHeader, Panel, TwoUp } from "@/components/widgets";
import * as A from "@/lib/analytics";
import { loadWindow } from "@/lib/db";
import type { RangeKey } from "@/lib/range";
import type { Daily } from "@/lib/types";
import * as VD from "@/lib/verdicts";

/** Night-by-night charts show the most recent 45 days whatever the range. */
const NIGHTS = 45;

const hours = (rows: Daily[], col: keyof Daily) =>
  rows.map((r) => (r[col] == null ? null : (r[col] as number) / 3600));

export async function SleepView({ range }: { range: RangeKey }) {
  const { daily: d } = await loadWindow(range);
  if (!d.length) return <EmptyState title="No sleep data yet" />;

  const dates = d.map((r) => r.date);
  const recent = d.slice(-NIGHTS);
  const times = A.sleepTimes(recent);

  return (
    <Stack gap="md">
      <PageHeader title="Sleep & Recovery" question="Is my sleep and recovery improving?" verdict={VD.sleep(d)} />
      <Panel title="Sleep score">
        <SleepScoreChart dates={dates} scores={d.map((r) => r.sleep_score)} />
      </Panel>
      <TwoUp>
        <Panel title="Sleep stages (hours)">
          <SleepStagesChart
            dates={recent.map((r) => r.date)}
            deep={hours(recent, "sleep_deep_seconds")}
            rem={hours(recent, "sleep_rem_seconds")}
            light={hours(recent, "sleep_light_seconds")}
            awake={hours(recent, "sleep_awake_seconds")}
          />
        </Panel>
        <Panel title="Sleep consistency" note="bed → wake · dotted = median bedtime">
          <SleepConsistencyChart
            dates={times.map((t) => t.date)}
            bed={times.map((t) => t.bed_h)}
            wake={times.map((t) => t.wake_h)}
          />
        </Panel>
      </TwoUp>
      <TwoUp>
        <Panel title="HRV vs your baseline (ms)">
          <HrvChart
            dates={dates}
            hrv={d.map((r) => r.hrv_last_night_ms)}
            low={d.map((r) => r.hrv_baseline_low)}
            high={d.map((r) => r.hrv_baseline_high)}
          />
        </Panel>
        <Panel title="Body Battery daily range">
          <BodyBatteryChart dates={dates} low={d.map((r) => r.bb_low)} high={d.map((r) => r.bb_high)} />
        </Panel>
      </TwoUp>
      <Panel title="Average daily stress">
        <StressChart dates={dates} stress={d.map((r) => r.stress_avg)} />
      </Panel>
    </Stack>
  );
}
