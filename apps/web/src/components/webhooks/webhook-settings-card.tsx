"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { components } from "@/lib/api/v1";
import type { WebhookEvent, WebhookOwner } from "@/lib/webhooks";

import { updateWebhook } from "./actions";
import { EventPicker } from "./event-picker";

export function WebhookSettingsCard({
  owner,
  webhook,
}: {
  owner: WebhookOwner;
  webhook: components["schemas"]["WebhookDTO"];
}) {
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
          owner,
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

const skeletonRows = ["40%", "55%", "35%", "50%", "45%"];

/** Also stands in for the create card, which has the same shape. */
export function WebhookSettingsCardSkeleton() {
  return (
    <section>
      <Skeleton className="mb-3 h-5 w-28" />
      <div className="flex flex-col gap-5 rounded-lg border p-6">
        <Skeleton className="h-9 w-full" />
        {skeletonRows.map((width) => (
          <Skeleton key={width} className="h-4" style={{ width }} />
        ))}
      </div>
    </section>
  );
}
