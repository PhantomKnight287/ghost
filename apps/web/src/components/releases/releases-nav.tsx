"use client";

import { Plus, Tag } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { TabLink } from "@/components/tab-link";
import { Button } from "@/components/ui/button";

export function ReleasesNav({
  username,
  repo,
  canWrite,
}: {
  username: string;
  repo: string;
  canWrite: boolean;
}) {
  const pathname = usePathname();
  const base = `/${username}/${repo}`;
  // a single release and the release forms have headers of their own
  const active = [`${base}/releases`, `${base}/tags`].includes(pathname)
    ? pathname.slice(base.length + 1)
    : null;
  if (!active) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b">
      <nav className="-mb-px flex gap-1">
        <TabLink href={`${base}/releases`} active={active === "releases"}>
          Releases
        </TabLink>
        <TabLink href={`${base}/tags`} active={active === "tags"}>
          <Tag className="size-4" />
          Tags
        </TabLink>
      </nav>
      {canWrite && (
        <Button size="sm" className="mb-2 ml-auto" asChild>
          <Link href={`${base}/releases/new`}>
            <Plus data-icon="inline-start" />
            Draft a new release
          </Link>
        </Button>
      )}
    </div>
  );
}
