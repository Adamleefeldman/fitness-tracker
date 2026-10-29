"use client";

/** A form's submit button that shows a spinner while its server action runs. */

import { Button, type ButtonProps } from "@mantine/core";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, ...props }: ButtonProps & { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} {...props}>{children}</Button>;
}
