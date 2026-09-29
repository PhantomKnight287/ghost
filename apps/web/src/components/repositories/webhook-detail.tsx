"use client";

import { ChevronRight, RotateCw, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { FromNowHoverCard } from "@/components/from-now-card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { components } from "@/lib/api/v1";
import type { WebhookEvent } from "@/lib/webhook-events";
import { cn } from "@/lib/utils";

import { EventPicker } from "./repository-webhooks";
import { SettingCard } from "./setting-card";
import {
  deleteWebhook,
  pingWebhook,
  redeliverWebhook,
  updateWebhook,
} from "./webhook-actions";

type Webhook = components["schemas"]["WebhookDTO"];
type Delivery = components["schemas"]["DeliveryDTO"];

type WebhookProps = {
  username: string;
  slug: string;
  webhook: Webhook;
};

export function WebhookDetail({
  username,
  slug,
  webhook,
  deliveries,
}: WebhookProps & { deliveries: Delivery[] }) {
  return (
    <div className="flex flex-col gap-8">
      {!webhook.active && webhook.disabledReason && (
        <Alert variant="destructive">
          <AlertTitle>This webhook is off</AlertTitle>
          <AlertDescription>
            {webhook.disabledReason} Turn it back on below once the receiver is
            fixed.
          </AlertDescription>
        </Alert>
      )}
      <EditWebhookCard username={username} slug={slug} webhook={webhook} />
      <Deliveries
        username={username}
        slug={slug}
        webhook={webhook}
        deliveries={deliveries}
      />
      <DangerZone username={username} slug={slug} webhook={webhook} />
    </div>
  );
}

function EditWebhookCard({ username, slug, webhook }: WebhookProps) {
  const router = useRouter();
  const [url, setUrl] = useState(webhook.url);
  const [events, setEvents] = useState<WebhookEvent[]>(webhook.events);
  const [active, setActive] = useState(webhook.active);

  const update = useAction(updateWebhook, {
    onSuccess: () => {
      toast.success("Webhook saved");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not save this webhook."),
  });
  const changed =
    url.trim() !== webhook.url ||
    active !== webhook.active ||
    events.length !== webhook.events.length ||
    events.some((event) => !webhook.events.includes(event));

  return (
    <SettingCard
      title="Webhook"
      hint="Changes apply to the next delivery, retries included."
      onSubmit={() =>
        update.execute({
          username,
          slug,
          webhookId: webhook.id,
          url: url.trim(),
          events,
          active,
        })
      }
      pending={update.isExecuting}
      canSave={changed && Boolean(url.trim()) && events.length > 0}
    >
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="webhook-url">Payload URL</FieldLabel>
          <Input
            id="webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="webhook-active"
            checked={active}
            onCheckedChange={setActive}
          />
          <FieldLabel htmlFor="webhook-active">Active</FieldLabel>
        </Field>
        <EventPicker value={events} onChange={setEvents} />
      </div>
    </SettingCard>
  );
}

function Deliveries({
  username,
  slug,
  webhook,
  deliveries,
}: WebhookProps & { deliveries: Delivery[] }) {
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
            onClick={() =>
              ping.execute({ username, slug, webhookId: webhook.id })
            }
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
                username={username}
                slug={slug}
                webhook={webhook}
                delivery={delivery}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

const statusBadge = {
  succeeded: { label: "Delivered", variant: "secondary" },
  pending: { label: "Retrying", variant: "outline" },
  dead: { label: "Failed", variant: "destructive" },
} as const;

function DeliveryRow({
  username,
  slug,
  webhook,
  delivery,
}: WebhookProps & { delivery: Delivery }) {
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
  const pending = delivery.status === "pending" && !latest;
  const badge = pending
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
                  username,
                  slug,
                  webhookId: webhook.id,
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
          <Block title="Payload">{formatJson(delivery.body)}</Block>
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
              <Block title="Request headers">
                {Object.entries(attempt.requestHeaders)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join("\n")}
              </Block>
              {attempt.responseBody && (
                <Block title="Response">{attempt.responseBody}</Block>
              )}
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}

function Block({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{title}</span>
      <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">
        {children}
      </pre>
    </div>
  );
}

function DangerZone({ username, slug, webhook }: WebhookProps) {
  const router = useRouter();
  const remove = useAction(deleteWebhook, {
    onSuccess: () => {
      toast.success("Webhook deleted");
      router.push(`/${username}/${slug}/settings/webhooks`);
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Delete</h2>
      <Card className="flex-row items-center justify-between gap-4 px-6">
        <p className="text-sm text-muted-foreground">
          Stops all deliveries, including retries still waiting.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <Trash2 />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
              <AlertDialogDescription>
                {webhook.url} stops receiving deliveries, and its delivery log
                is deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {remove.result.serverError && (
              <p className="text-sm text-destructive">
                {remove.result.serverError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={remove.isExecuting}
                onClick={() =>
                  remove.execute({ username, slug, webhookId: webhook.id })
                }
              >
                {remove.isExecuting && <Spinner />}
                Delete webhook
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </section>
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
