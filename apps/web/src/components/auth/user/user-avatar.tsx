"use client";

import type { UsernameAuthClient } from "@better-auth-ui/core/plugins/username";
import { useAuth, useSession } from "@better-auth-ui/react";
import type { User } from "better-auth";
import { User2 } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type UserAvatarProps = {
  className?: string;
  fallback?: ReactNode;
  isPending?: boolean;
  /** @remarks `User` */
  user?: User & { username?: string | null; displayUsername?: string | null };
};

/** Display a user's avatar using session information or an explicit user prop. */
export function UserAvatar({
  className,
  user,
  isPending,
  fallback,
}: UserAvatarProps) {
  const { authClient } = useAuth<UsernameAuthClient>();
  const { data: session, isPending: sessionPending } = useSession(authClient, {
    enabled: !user && !isPending,
  });

  if ((isPending || sessionPending) && !user) {
    return <Skeleton className={cn("size-8 rounded-full", className)} />;
  }

  const resolvedUser = user ?? session?.user;

  const initials = (
    resolvedUser?.username ||
    resolvedUser?.name ||
    resolvedUser?.email
  )
    ?.slice(0, 2)
    .toUpperCase();

  return (
    <Avatar
      className={cn(
        "size-8 bg-muted text-foreground text-sm rounded-full",
        className,
      )}
    >
      <AvatarImage
        src={resolvedUser?.image ?? undefined}
        alt={
          resolvedUser?.displayUsername ||
          resolvedUser?.name ||
          resolvedUser?.email
        }
      />

      <AvatarFallback className="text-muted-foreground!">
        {fallback || initials || <User2 className="size-4" />}
      </AvatarFallback>
    </Avatar>
  );
}
