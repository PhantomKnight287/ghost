import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

/** The page every error file renders: the status, what happened, and where to go from here. */
export function ErrorPage({
  status,
  title,
  description,
  digest,
  children,
}: {
  status: number;
  title: string;
  description: string;
  /** A server error's message is withheld in production; its digest matches it to the server's logs. */
  digest?: string;
  /** Links or buttons for the way out. */
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <title>{`${title} · Ghost`}</title>
      <Empty>
        <EmptyHeader>
          <p className="font-mono text-5xl font-semibold tracking-tight text-muted-foreground tabular-nums">
            {status}
          </p>
          <EmptyTitle className="text-lg">{title}</EmptyTitle>
          <EmptyDescription>
            {description}
            {digest && (
              <span className="mt-2 block font-mono text-xs">
                Reference: {digest}
              </span>
            )}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          {children}
        </EmptyContent>
      </Empty>
    </main>
  );
}
