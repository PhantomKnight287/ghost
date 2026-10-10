"use client";

import { KeyRound } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
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
import { Spinner } from "@/components/ui/spinner";
import type { WebhookOwner } from "@/lib/webhooks";

import { rollWebhookSecret } from "./actions";
import { SecretAlert } from "@/components/secret-alert";

export function RollSecretCard({
  owner,
  webhook,
}: {
  owner: WebhookOwner;
  webhook: { id: string; url: string };
}) {
  const roll = useAction(rollWebhookSecret, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not replace the secret."),
  });
  const secret = roll.result.data?.secret;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Signing secret</h2>
      {secret && (
        <SecretAlert
          title={`Copy the signing secret for ${webhook.url} now`}
          description={
            <>
              Ghost will not show it again. Use it to check the{" "}
              <code className="font-mono text-xs">X-Ghost-Signature-256</code>{" "}
              header on each delivery.
            </>
          }
          secret={secret}
        />
      )}
      <Card className="flex-row items-center justify-between gap-4 px-6">
        <p className="text-sm text-muted-foreground">
          Replace the secret if it leaked. The old one stops working at once.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline">
              <KeyRound />
              Replace secret
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace the signing secret?</AlertDialogTitle>
              <AlertDialogDescription>
                Every delivery from now on, retries included, is signed with the
                new secret. {webhook.url} rejects them until it has the new one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={roll.isExecuting}
                onClick={() => roll.execute({ owner, webhookId: webhook.id })}
              >
                {roll.isExecuting && <Spinner />}
                Replace secret
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </section>
  );
}
