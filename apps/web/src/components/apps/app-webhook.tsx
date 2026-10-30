"use client";

import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { WebhookDeliveries } from "@/components/webhooks/webhook-deliveries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { components } from "@/lib/api/v1";

import { setAppWebhookActive } from "./actions";

/** The app's one webhook: whether it is on, and what Ghost sent it. Its URL and secret are edited with the app's other settings. */
export function AppWebhook({
  app,
  deliveries,
}: {
  app: components["schemas"]["AppDTO"];
  deliveries: components["schemas"]["DeliveryDTO"][];
}) {
  const router = useRouter();
  const toggle = useAction(setAppWebhookActive, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change the webhook."),
  });
  if (!app.webhookId) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Webhook</h2>
      {!app.webhookActive && app.webhookDisabledReason && (
        <Alert variant="destructive">
          <AlertTitle>Ghost turned this webhook off</AlertTitle>
          <AlertDescription>
            {app.webhookDisabledReason} Turn it back on below once the receiver
            is fixed.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent>
          <Field orientation="horizontal">
            <Switch
              id="app-webhook-active"
              checked={app.webhookActive}
              disabled={toggle.isExecuting}
              onCheckedChange={(active) =>
                toggle.execute({ slug: app.slug, active })
              }
            />
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="app-webhook-active">Active</FieldLabel>
              <FieldDescription>
                Deliveries of the events this app&apos;s installations accepted,
                each with <code>installation.id</code>. A test ping has none.
              </FieldDescription>
            </div>
          </Field>
        </CardContent>
      </Card>
      <WebhookDeliveries
        owner={{ kind: "app", slug: app.slug }}
        webhookId={app.webhookId}
        deliveries={deliveries}
      />
    </section>
  );
}
