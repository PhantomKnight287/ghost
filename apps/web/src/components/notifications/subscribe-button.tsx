"use client";

import { Bell, BellOff } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { setThreadSubscription } from "./actions";

export function SubscribeButton({
  username,
  repo,
  number,
  subscribed,
}: {
  username: string;
  repo: string;
  number: number;
  subscribed: boolean;
}) {
  const { execute, isExecuting } = useAction(setThreadSubscription, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change your subscription."),
  });
  const Icon = subscribed ? BellOff : Bell;

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isExecuting}
      title={
        subscribed
          ? "You are notified about activity here."
          : "You are notified here only when mentioned or assigned."
      }
      onClick={() =>
        execute({ username, repo, number, subscribed: !subscribed })
      }
    >
      {isExecuting ? <Spinner /> : <Icon data-icon="inline-start" />}
      {subscribed ? "Unsubscribe" : "Subscribe"}
    </Button>
  );
}
