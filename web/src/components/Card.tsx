import { Paper, type PaperProps } from "@mantine/core";
import type { ReactNode } from "react";

import * as T from "@/lib/theme";

/** The standard dashboard panel: dark card, hairline border, faint top sheen. */
export function Card({
  children,
  className,
  style,
  ...props
}: PaperProps & { children: ReactNode; className?: string }) {
  return (
    <Paper
      bg={T.CARD}
      radius="md"
      p="md"
      {...props}
      className={["panel-card", className].filter(Boolean).join(" ")}
      style={{ border: `1px solid ${T.BORDER}`, ...(style as object) }}
    >
      {children}
    </Paper>
  );
}
