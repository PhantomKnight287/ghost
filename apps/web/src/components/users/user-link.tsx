import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** A username linking to its profile, with the avatar in front when `avatar` sets its size. A deleted account has no username and no profile to link to. */
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

  return (
    <Link
      href={`/${username}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-foreground hover:underline",
        className,
      )}
    >
      {avatar && (
        <Avatar size="sm" className={cn(avatar === "xs" && "size-4")}>
          <AvatarImage src={image ?? undefined} alt="" />
          <AvatarFallback className="text-[10px]">
            {username.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
      {username}
    </Link>
  );
}
