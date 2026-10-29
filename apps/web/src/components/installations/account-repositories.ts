import { createServerClient } from "@/lib/api/server";

// ponytail: the first 100 repositories an account has; page through them if accounts outgrow that.
/** The repositories of a user or organization an installation can be pointed at, as `owner/name`. */
export async function accountRepositories(login: string) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/repositories/{username}", {
    params: { path: { username: login }, query: { limit: 100 } },
  });
  return (data?.repositories ?? []).map(({ id, slug }) => ({
    id,
    fullName: `${login}/${slug}`,
  }));
}
