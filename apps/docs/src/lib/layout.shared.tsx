import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { WEB_APP_URL } from "@/lib/env";

/** Shared chrome: the title goes back to the instance these docs describe. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Ghost docs",
      url: WEB_APP_URL,
    },
    githubUrl: "https://github.com/flaxodotdev/ghost",
  };
}
