import { Code2 } from "lucide-react";

import {
  CloneSection,
  CommandsField,
} from "@/components/repositories/clone-popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { API_URL, DOCS_URL, sshCloneUrlFor } from "@/lib/env";

/** The pull request's `refs/pull/<number>/head` lives in the base repository whichever repository the branch came from, so one pair of commands checks out a fork's pull request too. */
export function CheckoutPopover({
  username,
  repo,
  number,
}: {
  username: string;
  repo: string;
  number: number;
}) {
  const branch = `pr-${number}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Code2 data-icon="inline-start" />
          Code
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Check out locally</p>
            <CommandsField
              commands={[
                `git fetch origin pull/${number}/head:${branch}`,
                `git switch ${branch}`,
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Run from a clone of {username}/{repo}, with <code>origin</code>{" "}
              pointing at it. After new pushes, switch away and fetch again with{" "}
              <code>
                +pull/{number}/head:{branch}
              </code>
              .{" "}
              <a
                href={`${DOCS_URL}/checking-out-pull-requests-locally`}
                className="text-primary hover:underline"
              >
                More options
              </a>
            </p>
          </div>

          <Separator />

          <CloneSection
            cloneUrl={`${API_URL}/${username}/${repo}.git`}
            sshCloneUrl={sshCloneUrlFor(username, repo)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
