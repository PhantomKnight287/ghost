import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { REPOSITORY_URL } from "@/lib/env";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: "Learn Ghost", url: "/" },
    githubUrl: REPOSITORY_URL,
  };
}
