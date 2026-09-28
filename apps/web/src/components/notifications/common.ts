import type { components } from "@/lib/api/v1";

export type Notification = components["schemas"]["NotificationDTO"];
export type WatchLevel = components["schemas"]["RepositoryWatchDTO"]["level"];

export const watchLevels = [
  "participating",
  "all",
  "ignore",
] as const satisfies readonly WatchLevel[];

export const UNREAD_COUNT_KEY = ["notifications", "unread-count"];
