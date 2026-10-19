import "@mantine/core/styles.css";
import "./globals.css";

import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from "@mantine/core";
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { AppFrame } from "@/components/AppFrame";
import { SyncPill, SyncPillView } from "@/components/SyncPill";
import * as T from "@/lib/theme";

// PWA / mobile head: installable to the phone home screen, rendered
// edge-to-edge under the notch (viewport-fit=cover).
export const metadata: Metadata = {
  title: "Garmin Health",
  description: "Your Garmin readiness, recovery, training and sleep at a glance.",
  applicationName: "Garmin Health",
  appleWebApp: { capable: true, title: "Garmin", statusBarStyle: "black" },
  formatDetection: { telephone: false }, // don't turn "47 bpm" into a phone link
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: T.BG,
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" {...mantineHtmlProps} data-mantine-color-scheme="dark">
      <head>
        <ColorSchemeScript forceColorScheme="dark" />
      </head>
      <body>
        <MantineProvider theme={T.mantineTheme} forceColorScheme="dark">
          <AppFrame
            syncPill={
              <Suspense fallback={<SyncPillView label="Syncing…" color={T.FAINT} />}>
                <SyncPill />
              </Suspense>
            }
          >
            {children}
          </AppFrame>
        </MantineProvider>
      </body>
    </html>
  );
}
