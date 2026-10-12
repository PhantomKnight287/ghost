import { Callout } from "fumadocs-ui/components/callout";
import type { ReactNode } from "react";

/** A hands-on exercise: something to run, read or change in the real repository. */
export function TryIt({
  title = "Try it",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Callout type="info" title={title}>
      {children}
    </Callout>
  );
}
