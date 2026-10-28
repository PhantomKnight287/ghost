"use client";

import { Download, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

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

import { createPrivateKey, deletePrivateKey } from "./actions";

/** Keys the app signs its JWTs with. A new key downloads as a `.pem` at once, as on GitHub: Ghost keeps only its public half. */
export function AppPrivateKeys({
  app,
}: {
  app: Pick<components["schemas"]["AppDTO"], "slug" | "privateKeys">;
}) {
  const router = useRouter();
  const generate = useAction(createPrivateKey, {
    onSuccess: ({ data }) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([data.privateKey], { type: "application/x-pem-file" }),
      );
      link.download = `${app.slug}.${data.createdAt.slice(0, 10)}.private-key.pem`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success("Private key downloaded. Ghost will not show it again.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not generate a private key."),
  });
  const remove = useAction(deletePrivateKey, {
    onSuccess: () => {
      toast.success("Private key deleted");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not delete that key."),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Private keys</h2>
          <p className="text-sm text-muted-foreground">
            The app signs a JWT with one to prove it is the app. Keep keys
            secret; generate a new one and delete the old to rotate.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={generate.isExecuting}
          onClick={() => generate.execute({ slug: app.slug })}
        >
          {generate.isExecuting ? <Spinner /> : <Download />}
          Generate a private key
        </Button>
      </div>
      <Card className="py-0">
        {app.privateKeys.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyTitle>No private keys</EmptyTitle>
              <EmptyDescription>
                The app cannot authenticate until it has one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {app.privateKeys.map((key) => (
              <li key={key.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <code className="truncate font-mono text-xs">
                    {key.fingerprint}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    Added {new Date(key.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete key ${key.fingerprint}`}
                  disabled={remove.isExecuting}
                  onClick={() => remove.execute({ slug: app.slug, id: key.id })}
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
