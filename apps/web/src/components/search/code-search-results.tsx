import { FileCode2 } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import {
  CodeSearchFile,
  type CodeSearchMatch,
  type CodeSearchRepository,
} from "./code-search-file";
import { CodeSearchMore } from "./code-search-more";

export function CodeSearchResults({
  query,
  files,
  nextOffset,
  repository,
  error,
}: {
  query: string;
  files: CodeSearchMatch[];
  nextOffset: number | null;
  /** Required when the files carry no repository of their own: a search scoped to one repository. */
  repository?: CodeSearchRepository;
  error?: string;
}) {
  // A first page can come back empty with more to follow: public search drops files the database no longer calls public.
  if (error || (files.length === 0 && nextOffset === null)) {
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
      {files.map((file) => (
        <CodeSearchFile
          key={`${file.repository ? `${file.repository.owner}/${file.repository.slug}/` : ""}${file.path}`}
          file={file}
          repository={repository}
        />
      ))}
      {nextOffset !== null && (
        <CodeSearchMore
          key={query}
          query={query}
          repository={repository}
          offset={nextOffset}
        />
      )}
    </div>
  );
}
