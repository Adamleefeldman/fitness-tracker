/**
 * Placeholder page body for the scaffold: proves the range → SQLite plumbing
 * end to end. Each page swaps this for its real view (verdict + charts) as it's
 * ported from dashboard/views.py.
 */

import { Loader, Stack, Text, Title } from "@mantine/core";

import { Card } from "@/components/Card";
import { navItem, type NavItem } from "@/components/nav";
import { loadWindow } from "@/lib/db";
import { parseRange } from "@/lib/range";
import * as T from "@/lib/theme";

export async function PageStub({
  href,
  searchParams,
}: {
  href: NavItem["href"];
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { label, question } = navItem(href);
  const range = parseRange((await searchParams).range);
  const { daily, activities } = await loadWindow(range);
  const first = daily[0]?.date ?? "—";
  const last = daily.at(-1)?.date ?? "—";

  return (
    <Stack gap="md" maw={1200}>
      <div>
        <Title order={2} fz={22} fw={500} c={T.TEXT}>{label}</Title>
        <Text size="sm" c={T.MUTED}>{question}</Text>
      </div>
      <Card>
        <Text size="sm" c={T.TEXT}>
          <span className="num">{daily.length}</span> days ({first} → {last}) ·{" "}
          <span className="num">{activities.length}</span> activities in the {range} window
        </Text>
        <Text size="xs" c={T.FAINT} mt={4}>Verdict and charts not yet ported.</Text>
      </Card>
    </Stack>
  );
}

export function PageLoading() {
  return (
    <Stack align="center" py="xl">
      <Loader color="vital" size="sm" />
    </Stack>
  );
}
