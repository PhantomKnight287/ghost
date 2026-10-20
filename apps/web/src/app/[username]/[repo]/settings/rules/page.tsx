import { notFound } from "next/navigation";

import { createServerClient } from "@/lib/api/server";

import { RulesetList } from "./ruleset-list";

export default async function RepositoryRulesPage({
  params,
}: PageProps<"/[username]/[repo]/settings/rules">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  const path = { username, repo };
  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/rulesets",
    { params: { path } },
  );
  if (!data) notFound();
  // One preview per ruleset: a repository has a handful of rulesets, and the API's matcher is the one enforcement uses.
  const matching = await Promise.all(
    data.rulesets.map(async ({ target, include, exclude }) => {
      const preview = await client.POST(
        "/api/repositories/{username}/{repo}/rulesets/preview",
        {
          params: { path },
          body: { target, include, exclude },
        },
      );
      return preview.data?.refs.length ?? 0;
    }),
  );

  return (
    <RulesetList
      username={username}
      repo={repo}
      rulesets={data.rulesets.map((ruleset, index) => ({
        ...ruleset,
        matching: matching[index],
      }))}
    />
  );
}
