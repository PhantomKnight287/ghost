"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, unwrap } from "@/lib/api/client";

export function DeleteOauthAppDialog({
  app,
  open,
  onOpenChange,
}: {
  app: { clientId: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.DELETE("/api/oauth-apps/{clientId}", {
          params: { path: { clientId: app.clientId } },
        }),
      ),
    onSuccess: async () => {
      toast.success("OAuth app deleted");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["oauth-apps"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {app.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Every token it was issued, for every user, stops working at once.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending && <Spinner data-icon="inline-start" />}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
