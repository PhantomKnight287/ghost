"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

/** Signature status of one commit or annotated tag. Renders nothing when it carries no signature, which is the ordinary case and should not read as a warning. */
export function CommitVerificationBadge({
  verification,
  className,
}: {
  verification?: CommitVerification | null;
  className?: string;
}) {
  if (!verification) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={verification.verified ? "default" : "outline"}
            className={cn(
              verification.verified
                ? "shrink-0 border-emerald-600/40 bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                : "shrink-0 text-muted-foreground",
              className,
            )}
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
