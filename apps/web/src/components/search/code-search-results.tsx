import Link from "next/link";
import { FileCode2 } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { components } from "@/lib/api/v1";

type CodeSearchFile = components["schemas"]["CodeSearchFileDTO"] & {
  repository?: components["schemas"]["SearchCodeRepositoryDTO"];
};

type Range = components["schemas"]["CodeSearchRangeDTO"];

export function CodeSearchResults({
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

  return (
    <div className="flex flex-col gap-4">
      {files.map((file) => {
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
              {file.language && (
                <Badge variant="outline" className="ml-auto">
                  {file.language}
                </Badge>
              )}
            </header>

            {file.lines.length > 0 && (
              <table className="w-full font-mono text-xs">
                <tbody>
                  {file.lines.map((line) => (
                    <tr key={line.lineNumber} className="hover:bg-muted/40">
                      <td className="w-12 select-none border-r py-0.5 pr-3 text-right align-top text-muted-foreground">
                        <Link
                          href={`${blob}#L${line.lineNumber}`}
                          className="hover:text-foreground"
                        >
                          {line.lineNumber}
                        </Link>
                      </td>
                      <td className="py-0.5 pl-4 whitespace-pre-wrap break-all">
                        {highlight(line.line, line.ranges)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        );
      })}
    </div>
  );
}

function highlight(line: string, ranges: Range[]) {
  const parts: ReactNode[] = [];
  let at = 0;

  for (const { start, end } of ranges) {
    if (start > at) parts.push(line.slice(at, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-primary/20 text-foreground">
        {line.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(line.slice(at));

  return parts;
}
