import { RulesetForm } from "@/components/rulesets/ruleset-form";
import { createServerClient } from "@/lib/api/server";

export default async function NewRulesetPage({
  params,
}: PageProps<"/[username]/[repo]/settings/rules/new">) {
  const { username, repo } = await params;
  const client = await createServerClient();
  // Answers 400 for a user's own repository, which has no teams.
  const teams = await client.GET("/api/repositories/{username}/{repo}/teams", {
    params: { path: { username, repo } },
  });

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">New ruleset</h2>
      <RulesetForm
        username={username}
        repo={repo}
        teams={teams.data?.teams ?? null}
      />
    </section>
  );
}
