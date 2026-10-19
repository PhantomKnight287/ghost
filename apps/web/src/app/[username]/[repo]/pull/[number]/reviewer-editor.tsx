"use client";

import { cn } from "cn";
import {
  Check,
  Dot,
  FileDiff,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { PeoplePicker } from "@/components/issues/people-picker";
import { SidebarSectionHeader } from "@/components/issues/sidebar-section-header";
import {
  removeReviewers,
  requestReviewers,
} from "@/components/pull-requests/actions";
import type { ReviewerRow } from "@/components/pull-requests/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UserLink } from "@/components/users/user-link";
import type { components } from "@/lib/api/v1";

const states = {
  pending: {
    Icon: Dot,
    label: "Awaiting requested review",
    className: "text-amber-500",
  },
  approved: {
    Icon: Check,
    label: "Approved these changes",
    className: "text-emerald-500",
  },
  changes_requested: {
    Icon: FileDiff,
    label: "Requested changes",
    className: "text-red-500",
  },
  commented: {
    Icon: MessageSquare,
    label: "Left review comments",
    className: "text-muted-foreground",
  },
};

/** Teams are picked as `org/team`; everything else is a username. */
const split = (names: string[]) => ({
  users: names.filter((name) => !name.includes("/")),
  teams: names
    .filter((name) => name.includes("/"))
    .map((name) => name.split("/")[1]),
});

export function ReviewerEditor({
  username,
  repo,
  number,
  rows,
  teams,
  canEdit,
}: {
  username: string;
  repo: string;
  number: number;
  rows: ReviewerRow[];
  /** Teams with a pending request. */
  teams: components["schemas"]["RequestedTeamDTO"][];
  canEdit: boolean;
}) {
  const router = useRouter();
  const pending = [
    ...rows.filter((row) => row.state === "pending").map((row) => row.username),
    ...teams.map((team) => `${username}/${team.slug}`),
  ];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pending);

  const callbacks = {
    onSuccess: () => router.refresh(),
    onError: ({ error }: { error: { serverError?: string } }) =>
      toast.error(error.serverError ?? "Could not save reviewers."),
  };
  const request = useAction(requestReviewers, callbacks);
  const remove = useAction(removeReviewers, callbacks);
  const busy = request.isExecuting || remove.isExecuting;

  const save = async () => {
    const removed = pending.filter((name) => !draft.includes(name));
    const added = draft.filter((name) => !pending.includes(name));
    if (
      removed.length &&
      !(
        await remove.executeAsync({ username, repo, number, ...split(removed) })
      )?.data
    )
      return;
    if (
      added.length &&
      !(await request.executeAsync({ username, repo, number, ...split(added) }))
        ?.data
    )
      return;
    setEditing(false);
  };

  if (editing) {
    return (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <SidebarSectionHeader title="Reviewers" />
        <PeoplePicker
          username={username}
          repo={repo}
          pullRequest={number}
          value={draft}
          onChange={setDraft}
          disabled={busy}
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Spinner />}
            Save
          </Button>
        </div>
      </form>
    );
  }

  const codeOwner = (
    <Tooltip>
      <TooltipTrigger asChild>
        <ShieldCheck
          aria-label="Code owner"
          className="size-3.5 text-muted-foreground"
        />
      </TooltipTrigger>
      <TooltipContent>Code owner</TooltipContent>
    </Tooltip>
  );
  const state = (key: ReviewerRow["state"]) => {
    const { Icon, label, className } = states[key];
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Icon aria-label={label} className={cn("size-4", className)} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <SidebarSectionHeader
          title="Reviewers"
          onEdit={
            canEdit
              ? () => {
                  setDraft(pending);
                  setEditing(true);
                }
              : undefined
          }
        />
        {rows.length === 0 && teams.length === 0 ? (
          <p className="text-xs text-muted-foreground">No reviews</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {teams.map((team) => (
              <li key={team.id} className="flex items-center gap-1.5 text-xs">
                <Users className="size-4 text-muted-foreground" />
                <Link
                  href={`/${username}/teams/${team.slug}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {username}/{team.slug}
                </Link>
                {team.asCodeOwner && codeOwner}
                <span className="ml-auto">{state("pending")}</span>
              </li>
            ))}
            {rows.map((row) => (
              <li
                key={row.username}
                className="flex items-center gap-1.5 text-xs"
              >
                <UserLink
                  username={row.username}
                  image={row.image}
                  avatar="xs"
                />
                {row.asCodeOwner && codeOwner}
                <span className="ml-auto flex items-center gap-1">
                  {canEdit && row.state !== "pending" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Re-request review from ${row.username}`}
                          className="text-muted-foreground hover:text-primary disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            request.execute({
                              username,
                              repo,
                              number,
                              users: [row.username],
                            })
                          }
                        >
                          <RefreshCw className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Re-request review</TooltipContent>
                    </Tooltip>
                  )}
                  {state(row.state)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TooltipProvider>
  );
}
