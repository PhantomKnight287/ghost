"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient, unwrap } from "@/lib/api/client";
import { OauthAppFields, type OauthAppValues } from "./oauth-app-fields";

export function EditOauthAppDialog({
  app,
  open,
  onOpenChange,
}: {
  app: OauthAppValues & { clientId: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<OauthAppValues>(app);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.PATCH("/api/oauth-apps/{clientId}", {
          params: { path: { clientId: app.clientId } },
          body: values,
        }),
      ),
    onSuccess: async () => {
      toast.success("OAuth app saved");
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["oauth-apps"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setValues(app);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit {app.name}</DialogTitle>
          </DialogHeader>
          <OauthAppFields
            idPrefix={`edit-${app.clientId}`}
            values={values}
            disabled={save.isPending}
            onChange={setValues}
          />
          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              type="button"
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
