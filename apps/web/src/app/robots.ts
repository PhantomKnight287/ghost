import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Discord fetches a page's component embed from here.
      allow: ["/", "/api/embed/"],
      disallow: [
        "/api/",
        "/dashboard",
        "/notifications",
        "/settings",
        "/search",
        // Every ref times every path is an endless URL space; the repository, issue and pull request pages are what is worth indexing.
        "/*/*/blob/",
        "/*/*/tree/",
        "/*/*/raw/",
        "/*/*/commit/",
        "/*/*/commits/",
        "/*/*/pull/*/files",
        "/*/*/pull/*/commits",
        "/*/*/releases/download/",
        "/*/*/archive/",
        "/*/*/search",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
