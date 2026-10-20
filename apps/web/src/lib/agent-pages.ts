import type { Metadata } from "next";

import { SITE_URL } from "@/lib/env";

type InRepository = { username: string; repo: string };

/** A public page that has a Markdown rendering for agents and a Discord component embed. One member per kind, so a check on `kind` narrows. */
export type AgentPage =
  | { kind: "home" }
  | { kind: "changelog" }
  | { kind: "profile"; username: string }
  | ({ kind: "repository" } & InRepository)
  | ({ kind: "issues" } & InRepository)
  | ({ kind: "pulls" } & InRepository)
  | ({ kind: "releases" } & InRepository)
  | ({ kind: "release"; tag: string } & InRepository)
  | ({ kind: "issue"; number: number } & InRepository)
  | ({ kind: "pull"; number: number } & InRepository);

/** Top-level routes of this app that are not profiles. RESERVED_NAMES in apps/api/src/lib/auth.ts keeps accounts off them. */
const APP_ROUTES = new Set([
  "_next",
  "api",
  "auth",
  "dashboard",
  "device",
  "login",
  "notifications",
  "search",
  "settings",
]);

const LISTS = new Set(["issues", "pulls", "releases"]);

/** The page a path's segments name, or null for every other path: those keep their HTML. */
export function matchPage(segments: string[]): AgentPage | null {
  const [username, repo, section, number, ...rest] = segments;
  if (!username) return { kind: "home" };
  if (username === "changelog" && !repo) return { kind: "changelog" };
  // a file at the root, such as robots.txt or the opengraph image
  if (APP_ROUTES.has(username) || username.includes(".")) return null;
  if (!repo) return { kind: "profile", username };
  if (!section) return { kind: "repository", username, repo };
  // a tag can hold slashes, so it takes every segment after `tag`
  if (section === "releases" && number === "tag" && rest.length) {
    return {
      kind: "release",
      username,
      repo,
      tag: rest.map(decodeURIComponent).join("/"),
    };
  }
  if (rest.length) return null;
  if (!number) {
    if (!LISTS.has(section)) return null;
    return { kind: section as "issues", username, repo };
  }
  if ((section === "issues" || section === "pull") && /^\d+$/.test(number)) {
    return {
      kind: section === "issues" ? "issue" : "pull",
      username,
      repo,
      number: Number(number),
    };
  }
  return null;
}

/** A page's canonical URL and the `<link>` Discord reads its component embed from. `path` starts with a slash. */
export function pageLinks(path: string): Metadata {
  return {
    alternates: { canonical: path },
    // Metadata has no field for an arbitrary <link>, so the embed rides on `icons`. Setting `icons` drops the file-based app/icon.svg and app/apple-icon.png, so they are listed again.
    icons: {
      icon: { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      apple: { url: "/apple-icon.png", type: "image/png", sizes: "180x180" },
      other: {
        rel: "discord:component-embed",
        type: "application/json",
        // Discord wants an absolute URL.
        url: `${SITE_URL}/api/embed${path}`,
      },
    },
  };
}
