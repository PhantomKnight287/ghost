"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { type WebhookOwner, webhooksPath } from "@/lib/webhooks";

import { deleteWebhook } from "./actions";

export function DeleteWebhookCard({
  owner,
  webhook,
}: {
  owner: WebhookOwner;
  webhook: { id: string; url: string };
}) {
  const router = useRouter();
  const remove = useAction(deleteWebhook, {
    onSuccess: () => {
      toast.success("Webhook deleted");
      router.push(webhooksPath(owner));
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
              <FieldError>{remove.result.serverError}</FieldError>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={remove.isExecuting}
                onClick={() => remove.execute({ owner, webhookId: webhook.id })}
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
