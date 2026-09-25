import Link from "next/link";
import { FileCode2 } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import type { ThemedToken } from "shiki";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { components } from "@/lib/api/v1";
import { highlightLines } from "@/lib/highlight";

type CodeSearchFile = components["schemas"]["CodeSearchFileDTO"] & {
  repository?: components["schemas"]["SearchCodeRepositoryDTO"];
};

type Range = components["schemas"]["CodeSearchRangeDTO"];

export async function CodeSearchResults({
  files,
  repository,
  error,
}: {
  files: CodeSearchFile[];
  /** Required when the files carry no repository of their own: a search scoped to one repository. */
  repository?: { owner: string; slug: string };
  error?: string;
}) {
  if (error || files.length === 0) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2 />
          </EmptyMedia>
          <EmptyTitle>{error ? "Search failed" : "No code found"}</EmptyTitle>
          <EmptyDescription>
            {error ??
              "Try different words, a /regex/, or a file: or lang: filter."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  // The matches are scattered lines, not a file, so each is highlighted on its own: a grammar state carried across a gap would colour the next line wrongly.
  const tokens = await Promise.all(
    files.map((file) =>
      Promise.all(
        file.lines.map(
          async ({ line }) =>
            (await highlightLines(line, file.path.split("/").pop() ?? ""))[0] ??
            [],
        ),
      ),
    ),
  );

  return (
    <div className="flex flex-col gap-4">
      {files.map((file, f) => {
        const { owner, slug } = file.repository ?? repository!;
        // Line numbers refer to the commit the index was built from, so link to that commit rather than a branch that may have moved.
        const blob = `/${owner}/${slug}/blob/${file.commit}/${file.path.split("/").map(encodeURIComponent).join("/")}`;

        return (
          <article
            key={`${owner}/${slug}/${file.path}`}
            className="overflow-hidden rounded-lg border"
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
                          {previous &&
                            line.lineNumber > previous.lineNumber + 1 && (
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
                              {markMatches(tokens[f][l], line.ranges)}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** Syntax tokens with the matched spans marked. A match can start or end mid-token, so tokens are cut at match boundaries and each piece keeps its colour. */
export function markMatches(tokens: ThemedToken[], ranges: Range[]) {
  const parts: ReactNode[] = [];

  for (const token of tokens) {
    const end = token.offset + token.content.length;
    const piece = (from: number, to: number) => (
      <span key={from} style={token.htmlStyle}>
        {token.content.slice(from - token.offset, to - token.offset)}
      </span>
    );

    let at = token.offset;
    for (const range of ranges) {
      if (range.end <= at || range.start >= end) continue;

      const from = Math.max(range.start, at);
      const to = Math.min(range.end, end);
      if (from > at) parts.push(piece(at, from));
      parts.push(
        <mark key={`m${from}`} className="rounded-sm bg-primary/25">
          {piece(from, to)}
        </mark>,
      );
      at = to;
    }
    if (at < end) parts.push(piece(at, end));
  }

  return parts;
}
