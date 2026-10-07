import { RepositoryLanguages } from "./repository-languages";
import { createServerClient } from "@/lib/api/server";

export async function Languages({
  username,
  repo,
}: {
  username: string;
  repo: string;
}) {
  const client = await createServerClient();
  const { data } = await client.GET(
    "/api/repositories/{username}/{slug}/languages",
    { params: { path: { username, slug: repo } } },
  );

  return data ? <RepositoryLanguages languages={data} /> : null;
}
