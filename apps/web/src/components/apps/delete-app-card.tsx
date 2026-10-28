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

import { deleteApp } from "./actions";
import { appsPath } from "./paths";

export function DeleteAppCard({
  app,
  organization,
}: {
  app: { slug: string; name: string; botLogin: string };
  organization?: string;
}) {
  const router = useRouter();
  const remove = useAction(deleteApp, {
    onSuccess: () => {
      toast.success(`${app.name} deleted`);
      router.push(appsPath(organization));
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Delete</h2>
      <Card className="flex-row items-center justify-between gap-4 border-destructive/40 px-6">
        <p className="text-sm text-muted-foreground">
          Its private keys stop working at once. What {app.botLogin} already did
          stays attributed to it.
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
                Its keys stop working and its name, App ID and {app.botLogin}{" "}
                can never be used again, by you or anyone. This cannot be
                undone.
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
                onClick={() => remove.execute({ slug: app.slug })}
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
