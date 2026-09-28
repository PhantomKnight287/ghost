"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { apiClient, apiErrorMessage } from "@/lib/api/client";

import { UNREAD_COUNT_KEY } from "./common";

export function NotificationBell() {
  const { data: count = 0 } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await apiClient.GET(
        "/api/notifications/unread-count",
      );
      if (error) throw new Error(apiErrorMessage(error));
      return data.count;
    },
  });
  const label = count
    ? `Notifications, ${count} unread`
    : "Notifications, none unread";

  return (
    <Button variant="ghost" size="icon" className="relative" asChild>
      <Link href="/notifications" aria-label={label} title={label}>
        <Bell />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
