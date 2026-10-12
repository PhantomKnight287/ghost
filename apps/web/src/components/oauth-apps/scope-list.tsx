import {
  BookLock,
  Building2,
  Globe,
  KeyRound,
  Trash2,
  UserRound,
} from "lucide-react";

import { describeScope, type ScopeGroup } from "@/lib/oauth-scopes";
import { cn } from "@/lib/utils";

const GROUP_ICONS: Record<ScopeGroup, typeof BookLock> = {
  repo: BookLock,
  org: Building2,
  user: UserRound,
  key: KeyRound,
  delete: Trash2,
  other: Globe,
};

/** What OAuth scopes let an app do, in words, each with the scope's name beneath. No scope reads as public access only. */
export function ScopeList({
  scopes,
  className,
}: {
  scopes: string[];
  className?: string;
}) {
  if (scopes.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        It can only see information that is already public.
      </p>
    );

  return (
    <ul className={cn("flex flex-col gap-4", className)}>
      {scopes.map((scope) => {
        const { title, detail, group } = describeScope(scope);
        const Icon = GROUP_ICONS[group];
        return (
          <li key={scope} className="flex gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{detail}</span>
              <code className="mt-0.5 font-mono text-xs text-muted-foreground/80">
                {scope}
              </code>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
