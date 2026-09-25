import Link from "next/link";
import type { ReactNode } from "react";

export function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className="flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-active:border-foreground data-active:font-medium data-active:text-foreground"
    >
      {children}
    </Link>
  );
}
