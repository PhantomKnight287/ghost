import { GitBranch, Plus, ShieldCheck, Tag } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { Ruleset } from "@/lib/rulesets";

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function RulesetList({
  username,
  repo,
  rulesets,
}: {
  username: string;
  repo: string;
  rulesets: (Ruleset & { matching: number })[];
}) {
  const base = `/${username}/${repo}/settings/rules`;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Rulesets
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            {rulesets.length}
          </span>
        </h2>
        <Button size="sm" asChild>
          <Link href={`${base}/new`}>
            <Plus />
            New ruleset
          </Link>
        </Button>
      </div>
      <Card className="py-0">
        {rulesets.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>No rulesets yet</EmptyTitle>
              <EmptyDescription>
                A ruleset protects the branches or tags it targets: from
                deletion, force pushes, merge commits, or any change at all.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {rulesets.map((ruleset, index) => (
              <Fragment key={ruleset.id}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item className="flex-wrap">
                  <ItemMedia variant="icon">
                    {ruleset.target === "branch" ? <GitBranch /> : <Tag />}
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate">{ruleset.name}</span>
                      {ruleset.enforcement !== "active" && (
                        <Badge variant="outline">
                          {ruleset.enforcement === "evaluate"
                            ? "Evaluate"
                            : "Disabled"}
                        </Badge>
                      )}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {ruleset.target === "branch" ? "Branches" : "Tags"} ·{" "}
                      {plural(ruleset.rules.length, "rule", "rules")} ·{" "}
                      {plural(
                        ruleset.matching,
                        "matching ref",
                        "matching refs",
                      )}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${base}/${ruleset.id}`}>Edit</Link>
                    </Button>
                  </ItemActions>
                </Item>
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </Card>
    </section>
  );
}

export function RulesetListSkeleton() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 3 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-8 w-14" />
          </li>
        ))}
      </ul>
    </section>
  );
}
