import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { components } from "@/lib/api/v1";
import type { WebhookOwner } from "@/lib/webhooks";

import { DeleteWebhookCard } from "./delete-webhook-card";
import {
  WebhookDeliveries,
  WebhookDeliveriesSkeleton,
} from "./webhook-deliveries";
import {
  WebhookSettingsCard,
  WebhookSettingsCardSkeleton,
} from "./webhook-settings-card";

export function WebhookDetail({
  owner,
  webhook,
  deliveries,
}: {
  owner: WebhookOwner;
  webhook: components["schemas"]["WebhookDTO"];
  deliveries: components["schemas"]["DeliveryDTO"][];
}) {
  return (
    <div className="flex flex-col gap-8">
      {!webhook.active && webhook.disabledReason && (
        <Alert variant="destructive">
          <AlertTitle>Ghost turned this webhook off</AlertTitle>
          <AlertDescription>
            {webhook.disabledReason} Turn it back on below once the receiver is
            fixed.
          </AlertDescription>
        </Alert>
      )}
      <WebhookSettingsCard owner={owner} webhook={webhook} />
      <WebhookDeliveries
        owner={owner}
        webhookId={webhook.id}
        deliveries={deliveries}
      />
      <DeleteWebhookCard owner={owner} webhook={webhook} />
    </div>
  );
}

export function WebhookDetailSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <WebhookSettingsCardSkeleton />
      <WebhookDeliveriesSkeleton />
    </div>
  );
}
