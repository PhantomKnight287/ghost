"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { markAllNotificationsRead } from "@/components/notifications/actions";
import { UNREAD_COUNT_KEY } from "@/components/notifications/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function MarkAllReadButton() {
  const queryClient = useQueryClient();
  const { execute, isExecuting } = useAction(markAllNotificationsRead, {
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY }),
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not mark notifications as read."),
  });

  return (
    <Button
      variant="outline"
      size="sm"
      className="mb-2 ml-auto"
      disabled={isExecuting}
      onClick={() => execute()}
    >
      {isExecuting ? <Spinner /> : <CheckCheck data-icon="inline-start" />}
      Mark all as read
    </Button>
  );
}
