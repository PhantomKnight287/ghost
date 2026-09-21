"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type CommitVerification = {
  verified: boolean;
  reason: string;
  keyId: string;
};

/**
 * Signature status of one commit. Renders nothing when the commit carries no
 * signature, which is the ordinary case and should not read as a warning.
 */
export function CommitVerificationBadge({
  verification,
}: {
  verification?: CommitVerification | null;
}) {
  if (!verification) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={verification.verified ? "default" : "outline"}
            className={
              verification.verified
                ? "shrink-0 border-emerald-600/40 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                : "shrink-0 text-muted-foreground"
            }
          >
            {verification.verified ? "Verified" : "Unverified"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {verification.reason}
          <span className="block font-mono text-[10px] opacity-70">
            {verification.keyId}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
