"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { SettingCard } from "@/components/repositories/setting-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type WebhookEvent,
  type WebhookOwner,
  webhookEvents,
} from "@/lib/webhooks";

import { createWebhook } from "./actions";
import { EventPicker } from "./event-picker";

/** The new endpoint's secret shows above the form, the only time anyone sees it. */
export function CreateWebhookCard({
  owner,
  hint,
}: {
  owner: WebhookOwner;
  hint: string;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(webhookEvents);
  const [created, setCreated] = useState<{ url: string; secret: string }>();

  const create = useAction(createWebhook, {
    onSuccess: ({ data }) => {
      if (data) setCreated({ url: data.url, secret: data.secret });
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
    <div className="flex flex-col gap-8">
      {created && <SecretAlert {...created} />}
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
    </div>
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
