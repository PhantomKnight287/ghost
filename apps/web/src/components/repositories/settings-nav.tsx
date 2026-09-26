"use client";

import { Settings, UserRound, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Icons are components, which cannot cross from a server layout; the layout names one instead.
const icons = {
  settings: Settings,
  users: Users,
  teams: UsersRound,
  outside: UserRound,
};

export type SettingsLink = {
  href: string;
  label: string;
  icon: keyof typeof icons;
};

export function SettingsNav({
  label,
  links,
}: {
  /** What the settings are for, for screen readers. */
  label: string;
  links: SettingsLink[];
}) {
  const pathname = decodeURIComponent(usePathname());

  return (
    <nav
      aria-label={label}
      className="-mx-1 flex gap-1 overflow-x-auto md:mx-0 md:flex-col"
    >
      {links.map(({ href, label, icon }) => {
        const Icon = icons[icon];
        const active = pathname === href;
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
