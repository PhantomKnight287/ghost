import { notFound } from "next/navigation";

import { RulesTabs } from "@/components/rulesets/rules-tabs";
import { createServerClient } from "@/lib/api/server";

import { RuleSuiteFilters, type RuleSuiteQuery } from "./rule-suite-filters";
import { RuleSuiteTimeline } from "./rule-suite-timeline";

const PAGE_SIZE = 30;

export default async function RuleInsightsPage({
  params,
  searchParams,
}: PageProps<"/[username]/[repo]/settings/rules/insights">) {
  const { username, repo } = await params;
  const raw = await searchParams;
  const text = (key: string) => {
    const value = raw[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  // The filter form sends "all" for a select left on everything; only the period has an "all" of its own.
  const chosen = (key: string) => (text(key) === "all" ? undefined : text(key));
  const query: RuleSuiteQuery = {
    rulesetId: chosen("ruleset"),
    ref: text("ref"),
    actor: text("actor"),
    result: chosen("result") as RuleSuiteQuery["result"],
    enforcement: chosen("enforcement") as RuleSuiteQuery["enforcement"],
    period: text("period") as RuleSuiteQuery["period"],
  };

  const client = await createServerClient();
  const path = { username, repo };
  const [suites, rulesets] = await Promise.all([
    client.GET("/api/repositories/{username}/{repo}/rule-suites", {
      params: { path, query: { ...query, limit: PAGE_SIZE } },
    }),
    client.GET("/api/repositories/{username}/{repo}/rulesets", {
      params: { path },
    }),
  ]);
  if (!suites.data || !rulesets.data) notFound();

  return (
    <section className="flex flex-col gap-4">
      <RulesTabs username={username} repo={repo} active="insights" />
      <RuleSuiteFilters
        action={`/${username}/${repo}/settings/rules/insights`}
        query={query}
        rulesets={rulesets.data.rulesets}
      />
      {/* Keyed by the filters, so a new filter starts over instead of appending to the old list. */}
      <RuleSuiteTimeline
        key={JSON.stringify(query)}
        username={username}
        repo={repo}
        query={query}
        limit={PAGE_SIZE}
        first={suites.data}
      />
    </section>
  );
}
