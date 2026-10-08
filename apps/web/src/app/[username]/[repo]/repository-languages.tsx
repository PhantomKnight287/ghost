"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { components } from "@/lib/api/v1";
import { languageColor } from "@ghost/languages";

type Languages = components["schemas"]["GetRepositoryLanguagesResponseDTO"];

export function RepositoryLanguages({ languages }: { languages: Languages }) {
  if (languages.languages.length === 0) return null;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Languages</h2>

        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {languages.languages.map(({ language, percent }) => (
            <Tooltip key={language}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${language} ${share(percent)}`}
                  className="h-full transition-opacity hover:opacity-80"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: languageColor(language),
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <span className="font-medium">{language}</span>
                <span>{share(percent)}</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {languages.languages.map(({ language, percent }) => (
            <li key={language} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: languageColor(language) }}
              />
              <span className="font-medium text-foreground">{language}</span>
              <span className="tabular-nums">{share(percent)}</span>
            </li>
          ))}
        </ul>
      </div>
    </TooltipProvider>
  );
}

export function RepositoryLanguagesSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {[64, 48, 56].map((width) => (
          <Skeleton key={width} className="h-3" style={{ width }} />
        ))}
      </div>
    </div>
  );
}

/** Keeps a pooled sliver from reading as "0.0%". */
function share(percent: number) {
  return percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
}
