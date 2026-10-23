import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { operations } from "@/lib/api/v1";
import type { Ruleset } from "@/lib/rulesets";

export type RuleSuiteQuery = NonNullable<
  operations["RuleSuitesController_list"]["parameters"]["query"]
>;

const ALL = "all";
const results = { pass: "Passed", fail: "Failed", bypass: "Bypassed" };
const enforcements = {
  active: "Active rulesets",
  evaluate: "Evaluate rulesets",
};
const periods = {
  hour: "Last hour",
  day: "Last 24 hours",
  week: "Last week",
  month: "Last month",
  all: "All time",
};

/** A GET form: the filters live in the URL, so a filtered view can be shared and reloaded. */
export function RuleSuiteFilters({
  action,
  query,
  rulesets,
}: {
  action: string;
  query: RuleSuiteQuery;
  rulesets: Ruleset[];
}) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Select name="ruleset" defaultValue={query.rulesetId ?? ALL}>
        <SelectTrigger className="w-[180px]" aria-label="Ruleset">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All rulesets</SelectItem>
          {rulesets.map((ruleset) => (
            <SelectItem key={ruleset.id} value={ruleset.id}>
              {ruleset.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        name="ref"
        defaultValue={query.ref}
        placeholder="Branch or tag"
        aria-label="Branch or tag"
        className="w-[160px]"
      />
      <Input
        name="actor"
        defaultValue={query.actor}
        placeholder="Actor"
        aria-label="Actor"
        className="w-[140px]"
      />
      <Select name="result" defaultValue={query.result ?? ALL}>
        <SelectTrigger className="w-[140px]" aria-label="Result">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All results</SelectItem>
          {Object.entries(results).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select name="enforcement" defaultValue={query.enforcement ?? ALL}>
        <SelectTrigger className="w-[170px]" aria-label="Enforcement">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All enforcement</SelectItem>
          {Object.entries(enforcements).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select name="period" defaultValue={query.period ?? "day"}>
        <SelectTrigger className="w-[150px]" aria-label="Time period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(periods).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="secondary">
        Filter
      </Button>
    </form>
  );
}
