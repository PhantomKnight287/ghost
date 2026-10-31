import { Bot } from "lucide-react";
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
import { ProfileAvatar } from "@/components/users/profile-avatar";
import type { components } from "@/lib/api/v1";

import { installationsPath } from "./paths";

/** The Ghost Apps installed on this account or `organization`, each a link to configure it. */
export function InstallationList({
  installations,
  organization,
}: {
  installations: components["schemas"]["InstallationDTO"][];
  organization?: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">
          Installed apps
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            {installations.length}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Ghost Apps that act on {organization ?? "your"} repositories with the
          permissions they were installed with.
        </p>
      </div>
      <Card className="py-0">
        {installations.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bot />
              </EmptyMedia>
              <EmptyTitle>No apps installed</EmptyTitle>
              <EmptyDescription>
                Install an app from its page; its owner shares the link.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {installations.map((installation, index) => (
              <Fragment key={installation.id}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item className="flex-wrap">
                  <ItemMedia>
                    <ProfileAvatar
                      name={installation.app.name}
                      image={installation.app.logoUrl}
                      className="size-10 rounded-lg"
                    />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      {installation.app.name}
                      {installation.suspendedAt && (
                        <Badge variant="secondary">Suspended</Badge>
                      )}
                      {installation.pending && (
                        <Badge variant="outline">Review permissions</Badge>
                      )}
                    </ItemTitle>
                    <ItemDescription>
                      {installation.repositorySelection === "all"
                        ? "All repositories"
                        : `${installation.repositories.length} selected ${installation.repositories.length === 1 ? "repository" : "repositories"}`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        href={`${installationsPath(organization)}/${installation.id}`}
                      >
                        Configure
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

export function InstallationListSkeleton() {
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
