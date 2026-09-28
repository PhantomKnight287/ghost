import { Skeleton } from "@/components/ui/skeleton";
import { createServerClient } from "@/lib/api/server";

import { SubscribeButton } from "./subscribe-button";

/** Renders nothing for a signed-out visitor, who has no subscription to change. */
export async function ThreadSubscription({
  username,
  repo,
  number,
}: {
  username: string;
  repo: string;
  number: number;
}) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/issues/{number}/subscription",
    { params: { path: { username, repo, number } } },
  );
  if (!data) return null;

  return (
    <SubscribeButton
      username={username}
      repo={repo}
      number={number}
      subscribed={data.subscribed}
    />
  );
}

export function ThreadSubscriptionSkeleton() {
  return <Skeleton className="h-8 w-28" />;
}
