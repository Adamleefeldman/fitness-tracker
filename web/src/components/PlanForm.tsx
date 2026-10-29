"use client";

/** "Build my plan": the goal, the event and the week the athlete can commit to. */

import {
  Button, Collapse, Group, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useActionState, useState } from "react";

import { createPlanAction, type FormState } from "@/app/plan/actions";
import { GOAL_LABELS, GOALS, WEEKDAYS, type Goal } from "@/lib/plans/types";
import * as T from "@/lib/theme";

const RACES: Goal[] = ["5k", "10k", "half_marathon", "marathon", "hyrox"];

const TARGET_HINT: Partial<Record<Goal, string>> = {
  "5k": "e.g. 22:30", "10k": "e.g. 48:00", half_marathon: "e.g. 1:45:00", marathon: "e.g. 3:45:00", hyrox: "e.g. 1:20:00",
};

export function PlanForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createPlanAction, {});
  const [goal, setGoal] = useState<Goal>("half_marathon");
  const [tuneUp, setTuneUp] = useState(false);
  // after an error React resets the form to these defaults: keep what was typed
  const v = state.values ?? {};
  // the segmented controls submit through hidden inputs: React's form reset would put
  // their own radio inputs back to the first default while the control still shows the choice
  const [days, setDays] = useState(v.days ?? "4");
  const [longDay, setLongDay] = useState(v.longDay ?? "Sat");

  return (
    <form action={action}>
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            label="Goal"
            name="goal"
            data={GOALS.map((g) => ({ value: g, label: GOAL_LABELS[g] }))}
            value={goal}
            onChange={(v) => v && setGoal(v as Goal)}
            allowDeselect={false}
            required
          />
          <TextInput label="Event or plan name" name="name" placeholder="Berlin Half" defaultValue={v.name} required />
          <TextInput
            label="Event date"
            name="eventDate"
            type="date"
            defaultValue={v.eventDate}
            description="Leave empty for an open-ended block"
          />
          <NumberInput label="Weeks (without an event)" name="weeks" defaultValue={v.weeks ?? 12} min={1} max={40} />
          {RACES.includes(goal) && (
            <TextInput label="Target time (optional)" name="targetTime" placeholder={TARGET_HINT[goal]} defaultValue={v.targetTime} />
          )}
          <NumberInput
            label="Longest weekday session"
            name="maxSessionMin"
            defaultValue={v.maxSessionMin ?? 75}
            min={30}
            max={240}
            suffix=" min"
          />
        </SimpleGrid>

        <Stack gap={4}>
          <Text size="sm" fw={500}>Training days a week</Text>
          <SegmentedControl value={days} onChange={setDays} data={["3", "4", "5", "6", "7"]} color="vital" />
          <input type="hidden" name="days" value={days} />
        </Stack>
        <Stack gap={4}>
          <Text size="sm" fw={500}>Long session on</Text>
          <SegmentedControl value={longDay} onChange={setLongDay} data={[...WEEKDAYS]} color="vital" />
          <input type="hidden" name="longDay" value={longDay} />
        </Stack>

        <Button variant="subtle" color="gray" size="xs" w="fit-content" onClick={() => setTuneUp((v) => !v)}>
          {tuneUp ? "No tune-up event" : "+ Add a tune-up event"}
        </Button>
        <Collapse expanded={tuneUp}>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput label="Tune-up event" name="tuneUpName" placeholder="Parkrun 10K" defaultValue={v.tuneUpName} disabled={!tuneUp} />
            <TextInput label="Tune-up date" name="tuneUpDate" type="date" defaultValue={v.tuneUpDate} disabled={!tuneUp} />
          </SimpleGrid>
        </Collapse>

        <Textarea label="Anything else (optional)" name="notes" placeholder="e.g. no gym on Fridays" defaultValue={v.notes} autosize minRows={2} />

        {state.error && (
          <Group gap={6} c={T.AMBER}>
            <IconAlertTriangle size={16} />
            <Text size="sm" c={T.AMBER}>{state.error}</Text>
          </Group>
        )}
        <Button type="submit" color="vital" loading={pending} w="fit-content">Build my plan</Button>
      </Stack>
    </form>
  );
}
