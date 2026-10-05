"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import type { ThemedToken } from "shiki";

import type { components } from "@/lib/api/v1";
import { highlightLines } from "@/lib/highlight";

export type CodeSearchMatch = components["schemas"]["CodeSearchFileDTO"] & {
  repository?: components["schemas"]["SearchCodeRepositoryDTO"];
};

export type CodeSearchRepository = { owner: string; slug: string };

type Range = components["schemas"]["CodeSearchRangeDTO"];

/** One file's matching lines. They render as plain text and are highlighted with the active theme alone once the file nears the viewport. */
export function CodeSearchFile({
  file,
  repository,
}: {
  file: CodeSearchMatch;
  /** Required when the file carries no repository of its own: a search scoped to one repository. */
  repository?: CodeSearchRepository;
}) {
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [highlighted, setHighlighted] = useState<{
    theme: string;
    tokens: ThemedToken[][];
  }>();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !resolvedTheme) return;

    let cancelled = false;
    const filename = file.path.split("/").pop() ?? "";
    // The matches are scattered lines, not a file, so each is highlighted on its own: a grammar state carried across a gap would colour the next line wrongly.
    Promise.all(
      file.lines.map(
        async ({ line }) =>
          (await highlightLines(line, filename, [resolvedTheme]))[0] ?? [],
      ),
    ).then((tokens) => {
      if (!cancelled) setHighlighted({ theme: resolvedTheme, tokens });
    });

    return () => {
      cancelled = true;
    };
  }, [visible, resolvedTheme, file]);

  // Tokens coloured for another theme carry none of the active theme's colours, so a theme switch shows plain text until the new ones land.
  const tokens =
    highlighted && highlighted.theme === resolvedTheme
      ? highlighted.tokens
      : undefined;
  const { owner, slug } = file.repository ?? repository!;
  // Line numbers refer to the commit the index was built from, so link to that commit rather than a branch that may have moved.
  const blob = `/${owner}/${slug}/blob/${file.commit}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  // `matchCount` counts matches, and one line can hold several
  const hidden =
    file.matchCount -
    file.lines.reduce((shown, line) => shown + line.ranges.length, 0);

  return (
    // ponytail: off-screen files skip layout and paint but keep their DOM nodes; a windowed list frees those too if thousands of long files ever weigh on memory.
    <article
      ref={container}
      className="overflow-hidden rounded-lg border [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <header className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
        {file.repository && (
          <>
            <Link
              href={`/${owner}/${slug}`}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              {owner}/{file.repository.name}
            </Link>
            <span className="text-muted-foreground/60">·</span>
          </>
        )}
        <Link
          href={blob}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {file.path}
        </Link>
      </header>

      {file.lines.length > 0 && (
        <div className="overflow-x-auto" data-shiki>
          <table className="w-full border-collapse font-mono text-xs">
            <tbody>
              {file.lines.map((line, l) => {
                const previous = file.lines[l - 1];

                return (
                  <Fragment key={line.lineNumber}>
                    {previous && line.lineNumber > previous.lineNumber + 1 && (
                      <tr aria-hidden className="bg-muted/40">
                        <td className="select-none border-y border-r py-0.5 pr-3 text-right text-muted-foreground">
                          ⋯
                        </td>
                        <td className="border-y" />
                      </tr>
                    )}
                    <tr className="hover:bg-muted/40">
                      <td className="w-12 select-none border-r py-0.5 pr-3 text-right align-top text-muted-foreground">
                        <Link
                          href={`${blob}#L${line.lineNumber}`}
                          className="hover:text-foreground"
                        >
                          {line.lineNumber}
                        </Link>
                      </td>
                      <td className="py-0.5 pl-4 whitespace-pre">
                        {markMatches(
                          tokens?.[l] ?? [{ content: line.line, offset: 0 }],
                          line.ranges,
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hidden > 0 && (
        <Link
          href={blob}
          className="block border-t bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {hidden} more {hidden === 1 ? "match" : "matches"} in this file
        </Link>
      )}
    </article>
  );
}

/** Syntax tokens with the matched spans marked. A match can start or end mid-token, so tokens are cut at match boundaries and each piece keeps its colour; the pieces of one match share a single mark. */
export function markMatches(tokens: ThemedToken[], ranges: Range[]) {
  const pieces: { node: ReactNode; range?: Range }[] = [];

  for (const token of tokens) {
    const end = token.offset + token.content.length;
    let at = token.offset;
    while (at < end) {
      const range = ranges.find((r) => r.start <= at && at < r.end);
      const to = range
        ? Math.min(range.end, end)
        : Math.min(end, ...ranges.map((r) => r.start).filter((s) => s > at));
      pieces.push({
        range,
        node: (
          <span key={at} style={token.htmlStyle}>
            {token.content.slice(at - token.offset, to - token.offset)}
          </span>
        ),
      });
      at = to;
    }
  }

  const parts: ReactNode[] = [];
  for (let i = 0; i < pieces.length; ) {
    const { range } = pieces[i];
    if (!range) {
      parts.push(pieces[i++].node);
      continue;
    }
    const nodes: ReactNode[] = [];
    while (pieces[i]?.range === range) nodes.push(pieces[i++].node);
    parts.push(
      <mark key={`m${range.start}`} className="rounded-xs bg-primary/25">
        {nodes}
      </mark>,
    );
  }

  return parts;
}
