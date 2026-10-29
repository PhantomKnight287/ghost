"use client";

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
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

import { setSuspended, uninstallApp } from "./actions";
import { installationsPath } from "./paths";

/** Suspend or unsuspend, and uninstall behind a confirmation. Either stops the app's tokens at once. */
export function InstallationActions({
  installation,
  organization,
}: {
  installation: {
    id: string;
    app: { name: string };
    suspendedAt: string | null;
  };
  organization?: string;
}) {
  const router = useRouter();
  const suspend = useAction(setSuspended, {
    onSuccess: () => router.refresh(),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change it"),
  });
  const uninstall = useAction(uninstallApp, {
    onSuccess: () => {
      toast.success(`${installation.app.name} uninstalled`);
      router.push(installationsPath(organization));
      router.refresh();
    },
  });
  const suspended = installation.suspendedAt !== null;

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={suspend.isExecuting}
        onClick={() =>
          suspend.execute({ id: installation.id, suspended: !suspended })
        }
      >
        {suspend.isExecuting && <Spinner />}
        {suspended ? "Unsuspend" : "Suspend"}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive">
            Uninstall
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Uninstall {installation.app.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its tokens stop working at once. What it already did stays
              attributed to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {uninstall.result.serverError && (
            <FieldError>{uninstall.result.serverError}</FieldError>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={uninstall.isExecuting}
              onClick={() => uninstall.execute({ id: installation.id })}
            >
              {uninstall.isExecuting && <Spinner />}
              Uninstall
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
