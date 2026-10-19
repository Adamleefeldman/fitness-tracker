"use client";

/**
 * The responsive shell: header (brand, range control, sync pill), desktop
 * sidebar, and the mobile bottom tab bar used by the installed PWA.
 *
 * The range lives in `?range=`, so anything that reads it sits under a
 * <Suspense> whose fallback renders the same UI for the default range — the
 * shell still prerenders, and nav links carry the range between pages.
 */

import { AppShell, Box, Group, NavLink, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconActivity } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { NAV } from "@/components/nav";
import { DEFAULT_RANGE, parseRange, RANGES, withRange, type RangeKey } from "@/lib/range";
import * as T from "@/lib/theme";

function WithRange({ children }: { children: (range: RangeKey) => ReactNode }) {
  return (
    <Suspense fallback={children(DEFAULT_RANGE)}>
      <RangeReader>{children}</RangeReader>
    </Suspense>
  );
}

function RangeReader({ children }: { children: (range: RangeKey) => ReactNode }) {
  return children(parseRange(useSearchParams().get("range")));
}

function Brand() {
  // On phones the wordmark hides so the header has room for the range control;
  // the green pulse icon alone carries the brand.
  return (
    <Group gap={8}>
      <IconActivity size={20} color={T.GREEN} />
      <Text fw={500} c={T.TEXT} visibleFrom="sm">Garmin health</Text>
    </Group>
  );
}

function RangeControl({ range }: { range: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <SegmentedControl
      value={range}
      onChange={(v) => router.replace(withRange(pathname, v as RangeKey), { scroll: false })}
      size="xs"
      color="vital"
      radius="md"
      data={[...RANGES]}
    />
  );
}

function NavLinks({ active, range }: { active: string; range: RangeKey }) {
  return NAV.map(({ href, label, icon: Icon, question }) => (
    <NavLink
      key={href}
      component={Link}
      href={withRange(href, range)}
      label={label}
      description={question}
      active={href === active}
      leftSection={<Icon size={18} />}
      color="vital"
      variant={href === active ? "filled" : "subtle"}
      styles={{ root: { borderRadius: 9 }, description: { fontSize: 11 } }}
    />
  ));
}

function BottomTabs({ active, range }: { active: string; range: RangeKey }) {
  return (
    <div className="bottom-tabs">
      {NAV.map(({ href, label, icon: Icon }) => {
        const isActive = href === active;
        const color = isActive ? T.GREEN : T.FAINT;
        return (
          <Link
            key={href}
            href={withRange(href, range)}
            style={{ textDecoration: "none", flex: 1, display: "flex", justifyContent: "center" }}
          >
            <Stack gap={2} align="center">
              <Icon size={22} color={color} />
              <Text size="10px" c={color} fw={isActive ? 600 : 400}>{label}</Text>
            </Stack>
          </Link>
        );
      })}
    </div>
  );
}

export function AppFrame({ syncPill, children }: { syncPill: ReactNode; children: ReactNode }) {
  const active = usePathname();
  return (
    <AppShell
      id="appshell"
      header={{ height: 56 }}
      // The navbar is desktop-only; phones navigate with the bottom tab bar.
      navbar={{ width: 230, breakpoint: "sm", collapsed: { mobile: true, desktop: false } }}
      footer={{ height: 58 }}
      padding="md"
    >
      <AppShell.Header style={{ background: T.BG, borderBottom: `1px solid ${T.BORDER}` }}>
        <Group h="100%" px="md" gap="sm">
          <Brand />
          <Box style={{ flex: 1 }} />
          <WithRange>{(range) => <RangeControl range={range} />}</WithRange>
          <Box visibleFrom="sm">{syncPill}</Box>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar style={{ background: T.SIDEBAR, borderRight: `1px solid ${T.BORDER}` }}>
        <Stack gap="xs" h="100%" p="sm">
          <WithRange>{(range) => <NavLinks active={active} range={range} />}</WithRange>
        </Stack>
      </AppShell.Navbar>

      {/* background comes from globals.css (layered ambient gradients) */}
      <AppShell.Main className="app-main">{children}</AppShell.Main>

      <AppShell.Footer
        withBorder
        className="tabbar"
        style={{ background: T.SIDEBAR, borderTop: `1px solid ${T.BORDER}` }}
      >
        <WithRange>{(range) => <BottomTabs active={active} range={range} />}</WithRange>
      </AppShell.Footer>
    </AppShell>
  );
}
