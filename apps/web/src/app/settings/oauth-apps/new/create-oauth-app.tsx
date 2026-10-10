"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { CopyField } from "@/components/copy-field";
import { createOauthApp } from "@/components/oauth-apps/actions";
import {
  EMPTY_OAUTH_APP,
  OauthAppFields,
  oauthAppReady,
} from "@/components/oauth-apps/oauth-app-fields";
import { SecretAlert } from "@/components/secret-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/** Register an app, then show its credentials once: the secret is never shown again. */
export function CreateOauthApp() {
  const [values, setValues] = useState(EMPTY_OAUTH_APP);
  const create = useAction(createOauthApp, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not register this app."),
  });
  const created = create.result.data;

  if (created) {
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {created.name} is registered
          </h2>
          <p className="text-sm text-muted-foreground">
            Put these two values in your app&apos;s configuration. It sends
            people to Ghost with the client ID, and proves who it is with the
            secret.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-6">
            <CopyField
              id="client-id"
              label="Client ID"
              value={created.clientId}
              description="Public. Safe to ship in your app's code."
            />
            <SecretAlert
              title="Copy the client secret now"
              description="Ghost keeps only a hash of it, so this is the only time you will see it. Keep it on your server, never in a browser or a public repository. You can generate a new one later."
              secret={created.clientSecret}
            />
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button asChild>
              <Link href={`/settings/oauth-apps/${created.clientId}`}>
                I have saved the secret
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </section>
    );
  }

  const ready = oauthAppReady(values);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/settings/oauth-apps"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          OAuth apps
        </Link>
        <h2 className="text-lg font-semibold">Register a new OAuth app</h2>
        <p className="text-sm text-muted-foreground">
          You can change all of this later, and add a logo once the app exists.
        </p>
      </div>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.execute({
            ...values,
            callbackUrls: values.callbackUrls.filter((url) => url.trim()),
          });
        }}
      >
        <Card className="gap-0 py-0">
          <CardContent className="py-6">
            <OauthAppFields
              values={values}
              disabled={create.isExecuting}
              onChange={setValues}
            />
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t py-4">
            <Button variant="ghost" asChild>
              <Link href="/settings/oauth-apps">Cancel</Link>
            </Button>
            <Button type="submit" disabled={!ready || create.isExecuting}>
              {create.isExecuting && <Spinner />}
              Register application
            </Button>
          </CardFooter>
        </Card>
      </form>
    </section>
  );
}
