import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";

/** The course is the whole site, so the sidebar layout sits on the catch-all route rather than under a `/docs` prefix. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()} tabMode="navbar">
      {children}
    </DocsLayout>
  );
}
