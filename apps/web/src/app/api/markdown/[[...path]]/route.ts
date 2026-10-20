import { CHANGELOG } from "@/app/changelog/entries";
import { matchPage } from "@/lib/agent-pages";
import { createServerClient } from "@/lib/api/server";
import { API_URL, SITE_URL } from "@/lib/env";
import { LLMS_TXT } from "@/lib/llms";
import { plural } from "@/lib/og";
import type { Release } from "@/types/release";

/** The Markdown proxy.ts rewrites a page to when the request asks for `Accept: text/markdown`. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await params;
  const page = matchPage(path);
  const body = page && (await render(page));
  if (body === undefined)
    throw new Error(`Failed to render /${path.join("/")}`);

  return new Response(body ?? NOT_FOUND, {
    status: body ? 200 : 404,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept",
    },
  });
}

// a private repository answers 404 too, so the wording cannot say the page does not exist
const NOT_FOUND = `# Not found

There is nothing at this address, or it is not public. [${SITE_URL}/llms.txt](${SITE_URL}/llms.txt) describes the pages Ghost serves as Markdown, and [${SITE_URL}/sitemap.xml](${SITE_URL}/sitemap.xml) lists every public profile and repository.
`;

type Page = NonNullable<ReturnType<typeof matchPage>>;

/** The page's Markdown; null when the API says it is absent or hidden, undefined when the API failed. */
async function render(page: Page): Promise<string | null | undefined> {
  if (page.kind === "home") return LLMS_TXT;
  if (page.kind === "changelog") {
    return [
      "# Changelog",
      ...CHANGELOG.map(
        ({ date, title, body }) => `## ${title}\n\n${date}\n\n${body}`,
      ),
    ].join("\n\n");
  }

  const client = await createServerClient();
  const { username } = page;

  if (page.kind === "profile") {
    const [user, organization, repositories] = await Promise.all([
      client.GET("/api/users/{username}", { params: { path: { username } } }),
      client.GET("/api/organizations/{slug}", {
        params: { path: { slug: username } },
      }),
      client.GET("/api/repositories/{username}", {
        params: { path: { username }, query: { limit: 100 } },
      }),
    ]);
    const list = (repositories.data?.repositories ?? []).map(
      (repository) =>
        // the list leaves out `owner`, which is the name asked for anyway
        `- [${username}/${repository.slug}](${SITE_URL}/${username}/${repository.slug})${repository.description ? `: ${repository.description.trim()}` : ""}`,
    );
    const repos = `## Repositories\n\n${list.join("\n") || "None yet."}`;

    if (organization.data) {
      const { name, description, website, location, members } =
        organization.data;
      return [
        `# ${name}`,
        description,
        [
          `- Organization: @${username}`,
          website && `- Website: ${website}`,
          location && `- Location: ${location}`,
          members.length &&
            `- Members: ${members.map((member) => `[@${member.username}](${SITE_URL}/${member.username})`).join(", ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
        repos,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    if (!user.data) return hidden(user.response);
    const { name, joinedAt, repositoryCount, starCount } = user.data;
    return [
      `# ${name} (@${user.data.username})`,
      `- Joined: ${joinedAt.slice(0, 10)}\n- Public repositories: ${repositoryCount}\n- Stars: ${starCount}`,
      repos,
    ].join("\n\n");
  }

  const { repo } = page;
  const base = `${SITE_URL}/${username}/${repo}`;

  if (page.kind === "repository") {
    const [repository, readme] = await Promise.all([
      client.GET("/api/repositories/{username}/{slug}", {
        params: { path: { username, slug: repo } },
      }),
      client.GET("/api/repositories/{username}/{slug}/readme", {
        params: { path: { username, slug: repo } },
      }),
    ]);
    if (!repository.data) return hidden(repository.response);
    const { owner, slug, description, starCount, forkCount, parent } =
      repository.data;
    return [
      `# ${owner}/${slug}`,
      description?.trim(),
      [
        `- Stars: ${starCount}`,
        `- Forks: ${forkCount}`,
        parent &&
          `- Forked from: [${parent.username}/${parent.slug}](${SITE_URL}/${parent.username}/${parent.slug})`,
        `- Clone: \`git clone ${API_URL}/${owner}/${slug}.git\``,
        `- [Issues](${base}/issues) · [Pull requests](${base}/pulls) · [Releases](${base}/releases)`,
      ]
        .filter(Boolean)
        .join("\n"),
      readme.data?.content && `---\n\n${readme.data.content}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (page.kind === "issues") {
    const { data, response } = await client.GET(
      "/api/repositories/{username}/{repo}/issues",
      { params: { path: { username, repo }, query: { limit: 100 } } },
    );
    if (!data) return hidden(response);
    return [
      `# Issues · ${username}/${repo}`,
      `${data.openCount} open, ${data.closedCount} closed. The newest open issues:`,
      data.issues
        .map(
          (issue) =>
            `- [#${issue.number} ${issue.title}](${base}/issues/${issue.number}) by @${issue.authorUsername}`,
        )
        .join("\n") || "None.",
    ].join("\n\n");
  }

  if (page.kind === "pulls") {
    const { data, response } = await client.GET(
      "/api/repositories/{username}/{repo}/pulls",
      { params: { path: { username, repo }, query: { limit: 100 } } },
    );
    if (!data) return hidden(response);
    return [
      `# Pull requests · ${username}/${repo}`,
      `${data.total} open. The newest:`,
      data.pullRequests
        .map(
          (pull) =>
            `- [#${pull.number} ${pull.title}](${base}/pull/${pull.number}) by @${pull.authorUsername}, ${pull.head.ref} into ${pull.base.ref}${pull.draft ? " (draft)" : ""}`,
        )
        .join("\n") || "None.",
    ].join("\n\n");
  }

  if (page.kind === "releases") {
    const { data, response } = await client.GET(
      "/api/repositories/{username}/{repo}/releases",
      { params: { path: { username, repo } } },
    );
    if (!data) return hidden(response);
    return [
      `# Releases · ${username}/${repo}`,
      ...data.releases.map((release) =>
        releaseMarkdown(release, `## ${release.name || release.tagName}`),
      ),
      data.releases.length ? "" : "None yet.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (page.kind === "release") {
    const { data, response } = await client.GET(
      "/api/repositories/{username}/{repo}/releases/tags/{tag}",
      { params: { path: { username, repo, tag: page.tag } } },
    );
    if (!data) return hidden(response);
    return releaseMarkdown(
      data,
      `# ${data.name || data.tagName} · ${username}/${repo}`,
    );
  }

  const path = { username, repo, number: page.number };
  const [thread, comments] = await Promise.all([
    page.kind === "issue"
      ? client.GET("/api/repositories/{username}/{repo}/issues/{number}", {
          params: { path },
        })
      : client.GET("/api/repositories/{username}/{repo}/pulls/{number}", {
          params: { path },
        }),
    client.GET("/api/repositories/{username}/{repo}/issues/{number}/comments", {
      params: { path },
    }),
  ]);
  if (!thread.data) return hidden(thread.response);

  const { title, number, state, authorUsername, createdAt, body } = thread.data;
  const details = [
    `- State: ${state}`,
    `- Opened by @${authorUsername} on ${createdAt.slice(0, 10)}`,
  ];
  if ("labels" in thread.data && thread.data.labels.length) {
    details.push(
      `- Labels: ${thread.data.labels.map((label) => label.name).join(", ")}`,
    );
  }
  if ("base" in thread.data) {
    const pull = thread.data;
    details.push(
      `- Merges ${pull.head.username}:${pull.head.ref} into ${pull.base.ref}${pull.draft ? " (draft)" : ""}`,
      `- ${plural(pull.commitCount, "commit")}, ${plural(pull.changedFiles, "file")} changed, +${pull.additions} −${pull.deletions}`,
    );
  }

  return [
    `# ${title} · ${page.kind === "issue" ? "Issue" : "Pull request"} #${number} · ${username}/${repo}`,
    details.join("\n"),
    body || "_No description._",
    ...(comments.data?.comments ?? []).map(
      (comment) =>
        `---\n\n**@${comment.authorUsername}** on ${comment.createdAt.slice(0, 10)}:\n\n${comment.body}`,
    ),
  ].join("\n\n");
}

/** A release's heading, tag line and notes, under the heading the caller gives it. */
function releaseMarkdown(release: Release, heading: string) {
  return [
    `${heading}${release.isLatest ? " (latest)" : ""}${release.isPrerelease ? " (pre-release)" : ""}`,
    `Tag \`${release.tagName}\`, published ${(release.publishedAt ?? release.createdAt).slice(0, 10)}${release.authorUsername ? ` by @${release.authorUsername}` : ""}.`,
    release.body,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** null for a resource the viewer may not see, which reads as a 404 like the HTML page; undefined for any other failure. */
function hidden(response: Response) {
  return response.status === 404 || response.status === 401 ? null : undefined;
}
