import type { MetadataRoute } from "next";

import { createServerClient } from "@/lib/api/server";
import { SITE_URL } from "@/lib/env";

import { CHANGELOG } from "./changelog/entries";

// Public repositories change on every push, and the API is not reachable while the image builds.
export const dynamic = "force-dynamic";

// ponytail: one sitemap capped at 5000 repositories, most recently pushed first; split with generateSitemaps once an instance outgrows it.
const MAX_PAGES = 50;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const client = await createServerClient();
  const repositories: MetadataRoute.Sitemap = [];
  const owners = new Map<string, Date>();

  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await client.GET("/api/search/repositories", {
      params: { query: { limit: 100, cursor } },
    });
    // A sitemap without repositories still lists the static pages; a failed one would list nothing.
    if (!data) break;

    for (const { owner, slug, lastPushedAt } of data.repositories) {
      const lastModified = new Date(lastPushedAt);
      repositories.push({ url: `${SITE_URL}/${owner}/${slug}`, lastModified });
      if (!owners.has(owner)) owners.set(owner, lastModified);
    }
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return [
    { url: SITE_URL },
    { url: `${SITE_URL}/changelog`, lastModified: CHANGELOG[0].date },
    { url: `${SITE_URL}/auth/sign-up` },
    ...[...owners].map(([owner, lastModified]) => ({
      url: `${SITE_URL}/${owner}`,
      lastModified,
    })),
    ...repositories,
  ];
}
