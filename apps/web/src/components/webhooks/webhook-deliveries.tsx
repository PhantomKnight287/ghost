"use client";
/** biome-ignore-all lint/suspicious/noArrayIndexKey: skeleton rows have no id */

import { ChevronRight, RotateCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { components } from "@/lib/api/v1";
import { cn } from "@/lib/utils";
import type { WebhookOwner } from "@/lib/webhooks";

import { pingWebhook, redeliverWebhook } from "./actions";

type Delivery = components["schemas"]["DeliveryDTO"];

type DeliveriesProps = {
  owner: WebhookOwner;
  webhookId: string;
};

export function WebhookDeliveries({
  owner,
  webhookId,
  deliveries,
}: DeliveriesProps & { deliveries: Delivery[] }) {
  const router = useRouter();
  const ping = useAction(pingWebhook, {
    onSuccess: () => {
      toast.success("Test delivery queued");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not send a test delivery."),
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Recent deliveries</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
            <RotateCw />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={ping.isExecuting}
            onClick={() => ping.execute({ owner, webhookId })}
          >
            {ping.isExecuting ? <Spinner /> : <Send />}
            Send test
          </Button>
        </div>
      </div>
      <Card className="gap-0 py-0">
        {deliveries.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Nothing sent yet.
          </p>
        ) : (
          <ul className="divide-y">
            {deliveries.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                owner={owner}
                webhookId={webhookId}
                delivery={delivery}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export function WebhookDeliveriesSkeleton() {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-8 w-28" />
      </div>
      <ul className="divide-y rounded-lg border">
        {Array.from({ length: 5 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <Skeleton className="h-5 w-16 rounded-4xl" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="ml-auto h-3 w-16" />
          </li>
        ))}
      </ul>
    </section>
  );
}

const statusBadge = {
  succeeded: { label: "Delivered", variant: "secondary" },
  pending: { label: "Retrying", variant: "outline" },
  dead: { label: "Failed", variant: "destructive" },
} as const;

function DeliveryRow({
  owner,
  webhookId,
  delivery,
}: DeliveriesProps & { delivery: Delivery }) {
  const router = useRouter();
  const redeliver = useAction(redeliverWebhook, {
    onSuccess: () => {
      toast.success("Redelivery queued");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not redeliver."),
  });
  const latest = delivery.attempts[0];
  const badge =
    delivery.status === "pending" && !latest
      ? { label: "Queued", variant: "outline" as const }
      : statusBadge[delivery.status];

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {delivery.event}
          </span>
          {latest && (
            <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
              {latest.statusCode ?? "no response"} · {latest.durationMs} ms
            </span>
          )}
          <FromNowHoverCard
            date={delivery.createdAt}
            className="shrink-0 text-xs text-muted-foreground"
          />
        </summary>
        <div className="flex flex-col gap-4 border-t bg-muted/30 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{delivery.id}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={redeliver.isExecuting}
              onClick={() =>
                redeliver.execute({
                  owner,
                  webhookId,
                  deliveryId: delivery.id,
                })
              }
            >
              {redeliver.isExecuting ? <Spinner /> : <RotateCw />}
              Redeliver
            </Button>
          </div>
          {delivery.nextAttemptAt && latest && (
            <p className="text-xs text-muted-foreground">
              Next try <FromNowHoverCard date={delivery.nextAttemptAt} />.
            </p>
          )}
          <CodeBlock title="Payload">{formatJson(delivery.body)}</CodeBlock>
          {delivery.attempts.map((attempt, index) => (
            <div key={attempt.startedAt} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium">
                Attempt {delivery.attempts.length - index}:{" "}
                <span
                  className={cn(
                    "tabular-nums",
                    !isSuccess(attempt.statusCode) && "text-destructive",
                  )}
                >
                  {attempt.statusCode ?? attempt.error ?? "no response"}
                </span>{" "}
                <span className="font-normal text-muted-foreground">
                  in {attempt.durationMs} ms,{" "}
                  <FromNowHoverCard date={attempt.startedAt} />
                </span>
              </h3>
              <CodeBlock title="Request headers">
                {Object.entries(attempt.requestHeaders)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join("\n")}
              </CodeBlock>
              {attempt.responseBody && (
                <CodeBlock title="Response">{attempt.responseBody}</CodeBlock>
              )}
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

function CodeBlock({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{title}</span>
      <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}

function isSuccess(status: number | null) {
  return status !== null && status >= 200 && status < 300;
}

function formatJson(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
