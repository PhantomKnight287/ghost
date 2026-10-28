import { Bot, Plus } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
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
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";
import { DOCS_URL } from "@/lib/env";

import { appsPath } from "./paths";

function NewAppButton({ organization }: { organization?: string }) {
  return (
    <Button size="sm" asChild>
      <Link href={`${appsPath(organization)}/new`}>
        <Plus />
        New Ghost App
      </Link>
    </Button>
  );
}

/** The Ghost Apps this account or `organization` registered, each a link to its own settings. */
export function AppList({
  apps,
  organization,
}: {
  apps: components["schemas"]["AppDTO"][];
  organization?: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">
            Ghost Apps
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {apps.length}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Bots such as CI, reviewers and scanners that act as themselves, with
            only the permissions you give them, on only the repositories they
            are installed on. Apps built for GitHub with Octokit or Probot
            mostly work unchanged.{" "}
            <a
              className="underline underline-offset-2"
              href={`${DOCS_URL}/apps`}
              target="_blank"
              rel="noreferrer"
            >
              How it works
            </a>
          </p>
        </div>
        {apps.length > 0 && <NewAppButton organization={organization} />}
      </div>

      <Card className="py-0">
        {apps.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot />
              </EmptyMedia>
              <EmptyTitle>No Ghost Apps yet</EmptyTitle>
              <EmptyDescription>
                Register an app to get an App ID and a private key it can
                authenticate with.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewAppButton organization={organization} />
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {apps.map((app, index) => (
              <Fragment key={app.id}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item className="flex-wrap">
                  <ItemMedia>
                    <ProfileAvatar
                      name={app.name}
                      image={app.logoUrl}
                      className="size-10 rounded-lg"
                    />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{app.name}</ItemTitle>
                    <ItemDescription className="truncate font-mono text-xs">
                      {app.botLogin}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${appsPath(organization)}/${app.slug}`}>
                        Manage
                      </Link>
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

export function AppListSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 2 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-20" />
          </li>
        ))}
      </ul>
    </section>
  );
}
