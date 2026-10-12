import type { ReactNode } from "react";

import { REPOSITORY_URL } from "@/lib/env";

/** A link to a file in the repository, named by its path and, optionally, the symbol to look for in it. Symbols rather than line numbers, so a link survives edits. */
export function Source({
  path,
  symbol,
  children,
}: {
  path: string;
  symbol?: string;
  children?: ReactNode;
}) {
  const kind = path.endsWith("/") ? "tree" : "blob";
  return (
    <a
      href={`${REPOSITORY_URL}/${kind}/main/${path}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[0.85em]"
    >
      {children ?? (symbol ? `${path} › ${symbol}` : path)}
    </a>
  );
}

/** A design decision in `docs/`, by its number and file name. */
export function Adr({
  file,
  children,
}: {
  file: string;
  children?: ReactNode;
}) {
  return (
    <Source path={`docs/${file}.md`}>
      {children ?? `ADR ${file.slice(0, 4)}`}
    </Source>
  );
}
