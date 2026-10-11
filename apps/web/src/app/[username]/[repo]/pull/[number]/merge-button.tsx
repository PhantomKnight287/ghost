"use client";

import {
  ChevronDown,
  GitCommitHorizontal,
  GitMerge,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";
import { mergePullRequest } from "@/components/pull-requests/actions";
import {
  type MergeMethod,
  mergeMethods,
} from "@/components/pull-requests/common";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const methods = {
  merge: {
    icon: GitMerge,
    label: "Merge pull request",
    option: "Create a merge commit",
    description:
      "Every commit lands on the base branch through a merge commit.",
  },
  squash: {
    icon: GitCommitHorizontal,
    label: "Squash and merge",
    option: "Squash and merge",
    description: "Every commit is combined into one on the base branch.",
  },
  rebase: {
    icon: ListOrdered,
    label: "Rebase and merge",
    option: "Rebase and merge",
    description: "Every commit is replayed onto the base branch, one by one.",
  },
} satisfies Record<
  MergeMethod,
  { icon: LucideIcon; label: string; option: string; description: string }
>;

/** The merge button with its method picked from the attached menu. A squash asks for its commit message before it merges. */
export function MergeButton({
  username,
  repo,
  number,
  disabled,
  squash,
}: {
  username: string;
  repo: string;
  number: number;
  disabled: boolean;
  /** The message a squash commits unless it is rewritten. */
  squash: { title: string; message: string } | null;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<MergeMethod>("merge");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  // Starts from the message as it stands now: the head may have moved since the page loaded.
  const startSquash = () => {
    setTitle(squash?.title ?? "");
    setMessage(squash?.message ?? "");
    setEditing(true);
  };

  const merge = useAction(mergePullRequest, {
    onSuccess: () => {
      toast.success("Pull request merged.");
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not merge this pull request."),
  });

  if (editing) {
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          merge.execute({
            username,
            repo,
            number,
            method: "squash",
            title: title.trim(),
            message,
          });
        }}
      >
        <Input
          aria-label="Commit title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Textarea
          aria-label="Commit message"
          value={message}
          rows={6}
          className="font-mono text-xs"
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={disabled || !title.trim() || merge.isExecuting}
          >
            {merge.isExecuting && <Spinner />}
            Confirm squash and merge
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={merge.isExecuting}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  const Icon = methods[method].icon;
  return (
    <div className="flex">
      <Button
        size="sm"
        className="rounded-r-none"
        disabled={disabled || merge.isExecuting}
        onClick={() =>
          method === "squash"
            ? startSquash()
            : merge.execute({ username, repo, number, method })
        }
      >
        {merge.isExecuting ? <Spinner /> : <Icon data-icon="inline-start" />}
        {methods[method].label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            className="rounded-l-none border-l-primary-foreground/20"
            disabled={merge.isExecuting}
            aria-label="Choose a merge method"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={method}
            onValueChange={(next) => setMethod(next as MergeMethod)}
          >
            {mergeMethods.map((option) => {
              const {
                icon: OptionIcon,
                option: label,
                description,
              } = methods[option];
              return (
                <DropdownMenuRadioItem
                  key={option}
                  value={option}
                  className="items-start py-1.5"
                >
                  <OptionIcon className="mt-0.5 text-muted-foreground" />
                  <span className="flex flex-col gap-0.5">
                    <span>{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
