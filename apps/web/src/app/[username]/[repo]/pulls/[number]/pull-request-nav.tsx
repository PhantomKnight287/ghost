"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function PullRequestNav({
  base,
  commitCount,
  changedFiles,
  additions,
  deletions,
}: {
  base: string;
  commitCount: number;
  changedFiles: number;
  additions: number;
  deletions: number;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: base, label: "Overview", count: null },
    { href: `${base}/commits`, label: "Commits", count: commitCount },
    { href: `${base}/files`, label: "Files changed", count: changedFiles },
  ];

  return (
    // the tab labels carry counts, so on a phone the row wraps instead of pushing the whole page sideways
    <nav className="flex flex-wrap items-center gap-1 border-b">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            pathname === tab.href
              ? "border-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== null && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
      <div className="ml-auto flex flex-row items-center justify-center gap-1 text-xs">
        <span className="text-green-400">+{additions}</span>
        <span className="text-red-400">-{deletions}</span>
      </div>
    </nav>
  );
}
