"use client";

import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { components } from "@/lib/api/v1";
import {
  type WebhookEvent,
  type WebhookOwner,
  webhookEvents,
  webhooksPath,
} from "@/lib/webhooks";

import { createWebhook } from "./actions";
import { EventPicker } from "./event-picker";
import { SecretAlert } from "./secret-alert";

/** Once the endpoint exists, its secret replaces the form: the only time anyone sees it. */
export function CreateWebhookCard({
  owner,
  hint,
}: {
  owner: WebhookOwner;
  hint: string;
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(webhookEvents);
  const [created, setCreated] =
    useState<components["schemas"]["CreatedWebhookDTO"]>();

  const create = useAction(createWebhook, {
    onSuccess: ({ data }) => setCreated(data),
    onError: ({ error }) =>
      toast.error(
        error.serverError ??
          error.validationErrors?.url?._errors?.[0] ??
          "Could not add this webhook.",
      ),
  });

  if (created) {
    return (
      <div className="flex flex-col items-start gap-4">
        <SecretAlert url={created.url} secret={created.secret} />
        <Button asChild>
          <Link href={`${webhooksPath(owner)}/${created.id}`}>
            I have copied it
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <SettingCard
      title="Add a webhook"
      hint={hint}
      onSubmit={() => create.execute({ owner, url: url.trim(), events })}
      pending={create.isExecuting}
      canSave={Boolean(url.trim()) && events.length > 0}
      submitText="Add webhook"
    >
      <div className="flex flex-col gap-5">
        <Field>
          <FieldLabel htmlFor="webhook-url">Payload URL</FieldLabel>
          <Input
            id="webhook-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://example.com/webhook"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <EventPicker value={events} onChange={setEvents} />
      </div>
    </SettingCard>
  );
}
