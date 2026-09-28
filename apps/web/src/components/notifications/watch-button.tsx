"use client";

import { Eye, EyeOff } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

import { setRepositoryWatch } from "./actions";
import { type WatchLevel, watchLevels } from "./common";

const LEVELS: Record<WatchLevel, { label: string; description: string }> = {
  participating: {
    label: "Participating and @mentions",
    description: "Only threads you take part in or are mentioned in.",
  },
  all: {
    label: "All activity",
    description: "Every issue and pull request.",
  },
  ignore: {
    label: "Ignore",
    description: "Nothing, not even mentions.",
  },
};

export function WatchButton({
  username,
  repo,
  level,
}: {
  username: string;
  repo: string;
  level: WatchLevel;
}) {
  const { execute, isExecuting } = useAction(setRepositoryWatch, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not change how you watch this."),
  });
  const Icon = level === "ignore" ? EyeOff : Eye;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={isExecuting}>
          {isExecuting ? <Spinner /> : <Icon data-icon="inline-start" />}
          {level === "all" ? "Unwatch" : "Watch"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuRadioGroup
          value={level}
          onValueChange={(next) =>
            execute({ username, repo, level: next as WatchLevel })
          }
        >
          {watchLevels.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <div className="flex flex-col">
                <span className="font-medium">{LEVELS[value].label}</span>
                <span className="text-xs text-muted-foreground">
                  {LEVELS[value].description}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
