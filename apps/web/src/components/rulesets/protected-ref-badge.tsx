"use client";

import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { components } from "@/lib/api/v1";
import { ruleTitles } from "@/lib/rulesets";

export type ProtectedRef = components["schemas"]["ProtectedRefDTO"];

const bypassNotes = {
  always: "You can bypass these rules.",
  pull_requests_only: "You can bypass these rules by merging a pull request.",
  never: null,
};

/** Marks a ref an active ruleset targets, naming its rules on hover. */
export function ProtectedRefBadge({
  protection,
  className,
}: {
  protection: ProtectedRef;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={className}>
            <ShieldCheck />
            Protected
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <ul>
            {protection.rules.map((rule) => (
              <li key={rule}>{ruleTitles[rule]}</li>
            ))}
          </ul>
          {bypassNotes[protection.bypass] && (
            <p className="mt-1">{bypassNotes[protection.bypass]}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
