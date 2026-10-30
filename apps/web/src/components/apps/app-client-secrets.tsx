"use client";

import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { CopyField } from "@/components/copy-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type { components } from "@/lib/api/v1";

import { createClientSecret, deleteClientSecret } from "./actions";

/** Secrets the app's website signs users in with. A new one shows once, as on GitHub: Ghost keeps only its hash. */
export function AppClientSecrets({
  app,
}: {
  app: Pick<components["schemas"]["AppDTO"], "slug" | "clientSecrets">;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<string | null>(null);
  const generate = useAction(createClientSecret, {
    onSuccess: ({ data }) => {
      setCreated(data.clientSecret);
      toast.success(
        "Client secret created. Copy it now: Ghost will not show it again.",
      );
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not create a client secret."),
  });
  const remove = useAction(deleteClientSecret, {
    onSuccess: () => {
      toast.success("Client secret deleted");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not delete that secret."),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Client secrets</h2>
          <p className="text-sm text-muted-foreground">
            The app&apos;s website exchanges sign-in codes for user tokens with
            one, and checks or revokes those tokens with it.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={generate.isExecuting}
          onClick={() => generate.execute({ slug: app.slug })}
        >
          {generate.isExecuting ? <Spinner /> : <Plus />}
          Generate a client secret
        </Button>
      </div>
      {created && (
        <CopyField
          id="app-new-client-secret"
          label="New client secret"
          value={created}
          description="Shown once. Store it where the app keeps its configuration."
        />
      )}
      <Card className="py-0">
        {app.clientSecrets.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyTitle>No client secrets</EmptyTitle>
              <EmptyDescription>
                The app cannot sign users in until it has one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {app.clientSecrets.map((secret) => (
              <li key={secret.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <code className="truncate font-mono text-xs">
                    *****{secret.lastEight}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    Added {new Date(secret.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete secret ending ${secret.lastEight}`}
                  disabled={remove.isExecuting}
                  onClick={() =>
                    remove.execute({ slug: app.slug, id: secret.id })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
