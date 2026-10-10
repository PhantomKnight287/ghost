"use client";

import { KeyRound } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { CopyField } from "@/components/copy-field";
import { rotateOauthAppSecret } from "@/components/oauth-apps/actions";
import { SecretAlert } from "@/components/secret-alert";
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
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

/** The client ID to copy, and a new client secret when the old one is lost or leaked. */
export function OauthAppCredentials({
  app,
}: {
  app: { clientId: string; name: string };
}) {
  const rotate = useAction(rotateOauthAppSecret, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not generate a new secret."),
  });
  const secret = rotate.result.data?.clientSecret;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Credentials</h2>
      {secret && (
        <SecretAlert
          title="Copy the new client secret now"
          description="Ghost will not show it again. The previous secret has already stopped working, so update your app's configuration."
          secret={secret}
        />
      )}
      <Card>
        <CardContent className="flex flex-col gap-6">
          <CopyField
            id="client-id"
            label="Client ID"
            value={app.clientId}
            description="Public. Your app sends it when it asks people for access."
          />
          <Field>
            <FieldLabel>Client secret</FieldLabel>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <FieldDescription>
                Ghost keeps only a hash, so it cannot show the secret again.
                Generate a new one if you lost it or it leaked.
              </FieldDescription>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="shrink-0">
                    <KeyRound />
                    Generate a new secret
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Generate a new secret?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The current secret stops working at once. {app.name}{" "}
                      cannot sign anyone in until it has the new one.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={rotate.isExecuting}
                      onClick={() => rotate.execute({ clientId: app.clientId })}
                    >
                      {rotate.isExecuting && <Spinner />}
                      Generate new secret
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Field>
        </CardContent>
      </Card>
    </section>
  );
}
