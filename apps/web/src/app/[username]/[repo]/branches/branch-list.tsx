"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { GitBranch, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import {
  type ProtectedRef,
  ProtectedRefBadge,
} from "@/components/rulesets/protected-ref-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  protectedRefs,
}: {
  username: string;
  repo: string;
  branches: string[];
  defaultBranch: string | null;
  canWrite: boolean;
  /** Keyed by full ref; see ProtectedRefBadge. */
  protectedRefs: Record<string, ProtectedRef>;
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
    <TooltipProvider>
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
                const protection = protectedRefs[`refs/heads/${branch}`];
                // An API delete is a push, so only bypassing always lets it through.
                const deletionBlocked =
                  protection?.rules.includes("deletion") &&
                  protection.bypass !== "always";
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
                    {protection && (
                      <ProtectedRefBadge protection={protection} />
                    )}
                    {canWrite && branch !== defaultBranch && (
                      <div className="ml-auto">
                        {deletionBlocked ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* A disabled button fires no pointer events, so the tooltip hangs on a wrapper. */}
                              <span tabIndex={0}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled
                                  aria-label={`Delete ${branch}`}
                                >
                                  <Trash2 />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              A ruleset restricts deleting this branch.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <DeleteBranchButton
                            username={username}
                            repo={repo}
                            branch={branch}
                          />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
