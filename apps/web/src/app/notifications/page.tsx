import type { Metadata } from "next";

import { CursorPagination } from "@/components/cursor-pagination";
import { TabLink } from "@/components/tab-link";
import { createServerClient } from "@/lib/api/server";

import { MarkAllReadButton } from "./mark-all-read-button";
import { NotificationItem } from "./notification-item";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: PageProps<"/notifications">) {
  const { filter, cursor } = await searchParams;
  const all = filter === "all";
  const pageCursor = typeof cursor === "string" ? cursor : undefined;

  const client = await createServerClient();
  const { data } = await client.GET("/api/notifications", {
    params: { query: { unread: !all, cursor: pageCursor } },
  });
  // signed out: the layout is already on its way to sign-in
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-b">
        <h1 className="mr-4 pb-2 text-xl font-semibold">Notifications</h1>
        <nav className="-mb-px flex gap-1">
          <TabLink href="/notifications" active={!all}>
            Unread
          </TabLink>
          <TabLink href="/notifications?filter=all" active={all}>
            All
          </TabLink>
        </nav>
        {data.notifications.some((notification) => notification.unread) && (
          <MarkAllReadButton />
        )}
      </div>

      {data.notifications.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>
              {all ? "No notifications yet" : "You are all caught up"}
            </EmptyTitle>
            <EmptyDescription>
              Mentions, assignments and activity on threads you follow show up
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg border">
          {data.notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
            />
          ))}
        </ul>
      )}

      <CursorPagination
        pathname="/notifications"
        params={{ filter: all ? "all" : undefined }}
        cursor={pageCursor}
        nextCursor={data.nextCursor}
      />
    </div>
  );
}
