import { createServerClient } from "@/lib/api/server";

import { ContributionGraph } from "./contribution-graph";

export async function ProfileContributions({ username }: { username: string }) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}/contributions", {
    params: { path: { username } },
  });

  if (!data) return null;

  return <ContributionGraph data={data} />;
}
