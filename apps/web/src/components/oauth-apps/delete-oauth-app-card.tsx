"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { deleteOauthApp } from "@/components/oauth-apps/actions";
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

import { oauthAppsPath } from "./paths";

export function DeleteOauthAppCard({
  app,
  organization,
}: {
  app: { clientId: string; name: string };
  organization?: string;
}) {
  const router = useRouter();
  const remove = useAction(deleteOauthApp, {
    onSuccess: () => {
      toast.success(`${app.name} deleted`);
      router.push(oauthAppsPath(organization));
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Delete</h2>
      <Card className="flex-row items-center justify-between gap-4 border-destructive/40 px-6">
        <p className="text-sm text-muted-foreground">
          Signs everyone out of {app.name}. Its access to every account ends at
          once.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" className="shrink-0">
              <Trash2 />
              Delete app
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Every token it was given, for every person, stops working. This
                cannot be undone.
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
                onClick={() => remove.execute({ clientId: app.clientId })}
              >
                {remove.isExecuting && <Spinner />}
                Delete app
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </section>
  );
}
