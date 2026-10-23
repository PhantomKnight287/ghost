import { TabLink } from "@/components/tab-link";

export function RulesTabs({
  username,
  repo,
  active,
}: {
  username: string;
  repo: string;
  active: "rulesets" | "insights";
}) {
  const base = `/${username}/${repo}/settings/rules`;
  return (
    <nav className="mb-4 flex gap-1 border-b">
      <TabLink href={base} active={active === "rulesets"}>
        Rulesets
      </TabLink>
      <TabLink href={`${base}/insights`} active={active === "insights"}>
        Insights
      </TabLink>
    </nav>
  );
}
