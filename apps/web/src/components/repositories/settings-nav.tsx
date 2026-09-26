"use client";

import { Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function SettingsNav({
  base,
  isAdmin,
}: {
  /** `/<owner>/<repo>/settings` */
  base: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const links = [
    { href: base, label: "General", icon: Settings },
    ...(isAdmin
      ? [{ href: `${base}/collaborators`, label: "Collaborators", icon: Users }]
      : []),
  ];

  return (
    <nav
      aria-label="Repository settings"
      className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col"
    >
      {links.map(({ href, label, icon: Icon }) => {
        const active = decodeURIComponent(pathname) === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
