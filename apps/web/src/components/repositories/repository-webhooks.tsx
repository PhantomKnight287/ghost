"use client";

import { Check, Copy, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import type { components } from "@/lib/api/v1";
import {
  type WebhookEvent,
  webhookEventLabels,
  webhookEvents,
} from "@/lib/webhook-events";

import { SettingCard } from "./setting-card";
import { createWebhook } from "./webhook-actions";

type Webhook = components["schemas"]["WebhookDTO"];

type RepositoryProps = {
  username: string;
  slug: string;
};

export function RepositoryWebhooks({
  username,
  slug,
  webhooks,
}: RepositoryProps & { webhooks: Webhook[] }) {
  const [created, setCreated] = useState<{ url: string; secret: string }>();

  return (
    <div className="flex flex-col gap-8">
      {created && <SecretAlert {...created} />}
      <CreateWebhookCard
        username={username}
        slug={slug}
        onCreated={setCreated}
      />

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
                        <Link
                          href={`/${username}/${slug}/settings/webhooks/${webhook.id}`}
                        >
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
    </div>
  );
}

function CreateWebhookCard({
  username,
  slug,
  onCreated,
}: RepositoryProps & {
  onCreated: (created: { url: string; secret: string }) => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(webhookEvents);

  const create = useAction(createWebhook, {
    onSuccess: ({ data }) => {
      if (data) onCreated({ url: data.url, secret: data.secret });
      setUrl("");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(
        error.serverError ??
          error.validationErrors?.url?._errors?.[0] ??
          "Could not add this webhook.",
      ),
  });

  return (
    <SettingCard
      title="Add a webhook"
      hint="Ghost sends a ping right away, so you can check the URL works."
      onSubmit={() =>
        create.execute({ username, slug, url: url.trim(), events })
      }
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

export function EventPicker({
  value,
  onChange,
}: {
  value: WebhookEvent[];
  onChange: (events: WebhookEvent[]) => void;
}) {
  const toggle = (event: WebhookEvent, checked: boolean) =>
    onChange(
      checked
        ? webhookEvents.filter((e) => e === event || value.includes(e))
        : value.filter((e) => e !== event),
    );

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium">Events</legend>
      {webhookEvents.map((event) => (
        <label
          key={event}
          htmlFor={`event-${event}`}
          className="flex items-start gap-3 text-sm"
        >
          <Checkbox
            id={`event-${event}`}
            className="mt-0.5"
            checked={value.includes(event)}
            onCheckedChange={(checked) => toggle(event, checked === true)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs">{event}</span>
            <span className="text-muted-foreground">
              {webhookEventLabels[event]}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function SecretAlert({ url, secret }: { url: string; secret: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the secret.");
    }
  }

  return (
    <Alert>
      <AlertTitle>Copy the signing secret for {url} now</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Ghost will not show it again. Use it to check the{" "}
          <code className="font-mono text-xs">X-Ghost-Signature-256</code>{" "}
          header on each delivery.
        </p>
        <div className="flex w-full items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
            {secret}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copy}
            aria-label="Copy signing secret"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
