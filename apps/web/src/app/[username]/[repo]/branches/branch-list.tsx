"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { GitBranch, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

import { DeleteBranchButton } from "./delete-branch-button";

const ROW_HEIGHT = 48;

export function BranchList({
  username,
  repo,
  branches,
  defaultBranch,
  canWrite,
}: {
  username: string;
  repo: string;
  branches: string[];
  defaultBranch: string | null;
  canWrite: boolean;
}) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? branches.filter((branch) => branch.toLowerCase().includes(needle))
      : branches;
  }, [branches, query]);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  return (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Find a branch"
          aria-label="Find a branch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </InputGroup>

      {matches.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          No branch matches {query.trim()}
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="max-h-[70vh] overflow-y-auto rounded-lg border"
        >
          <ul
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const branch = matches[row.index];
              return (
                <li
                  key={row.key}
                  className="absolute top-0 left-0 flex w-full items-center gap-3 border-b px-4 text-sm"
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                  <Link
                    href={`/${username}/${repo}/tree/${encodeURIComponent(branch)}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {branch}
                  </Link>
                  {branch === defaultBranch && (
                    <Badge variant="outline">Default</Badge>
                  )}
                  {canWrite && branch !== defaultBranch && (
                    <div className="ml-auto">
                      <DeleteBranchButton
                        username={username}
                        repo={repo}
                        branch={branch}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
