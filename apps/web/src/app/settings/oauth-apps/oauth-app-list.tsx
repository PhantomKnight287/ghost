import { AppWindow, Plus } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { Badge } from "@/components/ui/badge";
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

function NewAppButton() {
  return (
    <Button size="sm" asChild>
      <Link href="/settings/oauth-apps/new">
        <Plus />
        New OAuth app
      </Link>
    </Button>
  );
}

/** The OAuth apps this account registered, each a link to its own settings. */
export function OauthAppList({
  apps,
}: {
  apps: components["schemas"]["OauthAppDTO"][];
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">
            OAuth apps
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {apps.length}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Let your own tools sign people in with their Ghost account, the way
            they sign in with GitHub. People choose what each app may do, and
            can revoke it at any time.{" "}
            <a
              className="underline underline-offset-2"
              href={`${DOCS_URL}/github-compatibility#oauth-apps`}
              target="_blank"
              rel="noreferrer"
            >
              How it works
            </a>
          </p>
        </div>
        {apps.length > 0 && <NewAppButton />}
      </div>

      <Card className="py-0">
        {apps.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AppWindow />
              </EmptyMedia>
              <EmptyTitle>No OAuth apps yet</EmptyTitle>
              <EmptyDescription>
                Register an app to get a client ID and secret it can use to ask
                people for access.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <NewAppButton />
            </EmptyContent>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {apps.map((app, index) => (
              <Fragment key={app.clientId}>
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
                    <ItemTitle>
                      {app.name}
                      {app.deviceFlowEnabled && (
                        <Badge variant="secondary">Device flow</Badge>
                      )}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {app.description || app.homepageUrl}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/settings/oauth-apps/${app.clientId}`}>
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

export function OauthAppListSkeleton() {
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
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-8 w-20" />
          </li>
        ))}
      </ul>
    </section>
  );
}
