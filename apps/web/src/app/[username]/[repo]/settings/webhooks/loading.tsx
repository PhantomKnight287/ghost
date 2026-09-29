import { WebhookListSkeleton } from "@/components/webhooks/webhook-list";
import { WebhookSettingsCardSkeleton } from "@/components/webhooks/webhook-settings-card";

export default function RepositoryWebhooksLoading() {
  return (
    <div className="flex flex-col gap-8">
      <WebhookSettingsCardSkeleton />
      <WebhookListSkeleton />
    </div>
  );
}
