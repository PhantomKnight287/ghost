"use client";

import { ShieldCheck } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

/** A file's code owners, named on hover; nothing for an ownerless file. `mine` marks a file the viewer owns, directly or through a team. */
export function OwnersBadge({
  logins,
  mine = false,
}: {
  logins: string[];
  mine?: boolean;
}) {
  if (logins.length === 0) return null;
  const label = `Owned by ${listFormat.format(logins)}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <ShieldCheck
            aria-label={mine ? `${label}, including you` : label}
            className={cn(
              "size-4 shrink-0",
              mine ? "text-primary" : "text-muted-foreground",
            )}
          />
        </TooltipTrigger>
        <TooltipContent>
          {mine ? `You own this file. ${label}` : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
