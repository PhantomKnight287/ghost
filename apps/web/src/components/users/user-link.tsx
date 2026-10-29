import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { cn } from "@/lib/utils";

/** A username linking to its profile, with the avatar in front when `avatar` sets its size. A bot links to its app's page and wears a badge. A deleted account has no username and no profile to link to. */
export function UserLink({
  username,
  image,
  avatar,
  className,
}: {
  username: string;
  image?: string | null;
  avatar?: "sm" | "xs";
  className?: string;
}) {
  if (!username) {
    return <span className={cn("font-medium", className)}>Someone</span>;
  }

  const bot = /^(.+)\[bot\]$/.exec(username)?.[1];

  return (
    <Link
      href={bot ? `/apps/${bot}` : `/${username}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-foreground hover:underline",
        className,
      )}
    >
      {avatar && (
        <ProfileAvatar
          name={username}
          image={image}
          className={avatar === "xs" ? "size-4" : "size-6"}
          fallbackClassName="text-[10px]"
        />
      )}
      {username}
      {bot && (
        <Badge variant="outline" className="px-1 py-0 text-[10px]">
          bot
        </Badge>
      )}
    </Link>
  );
}
