import { notFound } from "next/navigation";

import { RulesetForm } from "@/components/rulesets/ruleset-form";
import { createServerClient } from "@/lib/api/server";

import { DeleteRulesetCard } from "./delete-ruleset-card";

export default async function RulesetPage({
  params,
}: PageProps<"/[username]/[repo]/settings/rules/[rulesetId]">) {
  const { username, repo, rulesetId } = await params;
  const client = await createServerClient();
  const path = { username, repo };
  const [ruleset, teams, statusContexts, apps] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/rulesets/{id}", {
      params: { path: { ...path, id: rulesetId } },
    }),
    // Answers 400 for a user's own repository, which has no teams.
    client.GET("/api/repositories/{username}/{repo}/teams", {
      params: { path },
    }),
    client.GET("/api/repositories/{username}/{slug}/status-contexts", {
      params: { path: { username, slug: repo } },
    }),
    client.GET("/api/repositories/{username}/{repo}/apps", {
      params: { path },
    }),
  ]);
  if (!ruleset.data) notFound();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold">{ruleset.data.name}</h2>
        <RulesetForm
          username={username}
          repo={repo}
          teams={teams.data?.teams ?? null}
          statusContexts={statusContexts.data?.contexts ?? []}
          apps={apps.data?.apps ?? []}
          ruleset={ruleset.data}
        />
      </section>
      <DeleteRulesetCard
        username={username}
        repo={repo}
        ruleset={ruleset.data}
      />
    </div>
  );
}
