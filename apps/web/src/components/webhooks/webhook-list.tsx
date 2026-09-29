/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */
import { Webhook } from "lucide-react";
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
import type { components } from "@/lib/api/v1";
import { type WebhookOwner, webhooksPath } from "@/lib/webhooks";

export function WebhookList({
  owner,
  webhooks,
}: {
  owner: WebhookOwner;
  webhooks: components["schemas"]["WebhookDTO"][];
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">
        Webhooks
        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
          {webhooks.length}
        </span>
      </h2>
      <Card className="py-0">
        {webhooks.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Webhook />
              </EmptyMedia>
              <EmptyTitle>No webhooks yet</EmptyTitle>
              <EmptyDescription>
                Ghost POSTs a signed JSON payload to each URL you add here
                whenever one of its events happens.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-0!">
            {webhooks.map((webhook, index) => (
              <Fragment key={webhook.id}>
                {index > 0 && <ItemSeparator className="my-0!" />}
                <Item className="flex-wrap">
                  <ItemMedia variant="icon">
                    <Webhook />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate font-mono text-xs">
                        {webhook.url}
                      </span>
                      {!webhook.active && (
                        <Badge variant="destructive">Off</Badge>
                      )}
                    </ItemTitle>
                    <ItemDescription className="truncate">
                      {webhook.disabledReason ??
                        `${webhook.events.length} ${webhook.events.length === 1 ? "event" : "events"}`}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`${webhooksPath(owner)}/${webhook.id}`}>
                        Edit
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

export function WebhookListSkeleton() {
  return (
    <section>
      <Skeleton className="mb-3 h-5 w-24" />
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 3 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-8 w-14" />
          </li>
        ))}
      </ul>
    </section>
  );
}
