import { matchPage } from "@/lib/agent-pages";
import { createServerClient } from "@/lib/api/server";
import { SITE_URL } from "@/lib/env";
import { plain, plural, truncate } from "@/lib/og";

// The --primary lavender of the dark theme in globals.css.
const ACCENT = 0xc2b1f8;

type Component = Record<string, unknown>;

/** A Discord component embed (https://docs.discord.com/developers/link-previews/component-embeds), linked from each page's `discord:component-embed` link. Discord renders it in place of the Open Graph card, and falls back to that card on a 404. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const page = matchPage(path);
  const components = page && (await render(page));
  const payload = JSON.stringify({
    component: { type: 17, accent_color: ACCENT, components },
  });
  // Discord drops an embed over 3000 bytes; a 404 leaves the Open Graph card.
  if (!components || Buffer.byteLength(payload) > 3000) {
    return Response.json({}, { status: 404 });
  }

  return new Response(payload, {
    headers: { "content-type": "application/json" },
  });
}

async function render(
  page: NonNullable<ReturnType<typeof matchPage>>,
): Promise<Component[] | null> {
  if (page.kind === "home" || page.kind === "changelog") return null;

  const client = await createServerClient();
  const { username } = page;

  if (page.kind === "profile") {
    const url = `${SITE_URL}/${username}`;
    const [user, organization] = await Promise.all([
      client.GET("/api/users/{username}", { params: { path: { username } } }),
      client.GET("/api/organizations/{slug}", {
        params: { path: { slug: username } },
      }),
    ]);
    if (organization.data) {
      const { name, logo, description, location, website, repositoryCount } =
        organization.data;
      return [
        section(
          [
            `## [${name}](${url})`,
            description,
            `-# ${[`@${username}`, location, plural(repositoryCount, "public repository", "public repositories")].filter(Boolean).join(" · ")}`,
          ],
          logo,
        ),
        buttons([
          ["View organization", url],
          website ? ["Website", website] : null,
        ]),
      ];
    }
    if (!user.data) return null;
    const { name, image, joinedAt, repositoryCount, starCount } = user.data;
    return [
      section(
        [
          `## [${name}](${url})`,
          `@${user.data.username} · joined ${timestamp(joinedAt, "D")}`,
          `-# ${plural(repositoryCount, "public repository", "public repositories")} · ${plural(starCount, "star")}`,
        ],
        image,
      ),
      buttons([["View profile", url]]),
    ];
  }

  const { repo } = page;
  const base = `${SITE_URL}/${username}/${repo}`;

  if (
    page.kind === "repository" ||
    page.kind === "issues" ||
    page.kind === "pulls"
  ) {
    const { data } = await client.GET("/api/repositories/{username}/{slug}", {
      params: { path: { username, slug: repo } },
    });
    if (!data) return null;
    return [
      text([
        `## [${data.owner}/${data.slug}](${base})`,
        data.description && truncate(plain(data.description), 280),
        `-# ⭐ ${plural(data.starCount, "star")} · ${plural(data.forkCount, "fork")}${data.lastPushedAt ? ` · pushed ${timestamp(data.lastPushedAt, "R")}` : ""}`,
      ]),
      buttons([
        ["Code", base],
        ["Issues", `${base}/issues`],
        ["Pull requests", `${base}/pulls`],
        ["Releases", `${base}/releases`],
      ]),
    ];
  }

  if (page.kind === "releases") {
    const { data } = await client.GET(
      "/api/repositories/{username}/{repo}/releases",
      { params: { path: { username, repo }, query: { limit: 1 } } },
    );
    if (!data) return null;
    const [latest] = data.releases;
    const url = `${base}/releases`;
    if (!latest) {
      return [
        text([
          `## [Releases · ${username}/${repo}](${url})`,
          "No releases yet.",
        ]),
      ];
    }
    const tag = `${url}/tag/${latest.tagName.split("/").map(encodeURIComponent).join("/")}`;
    return [
      text([
        `-# Releases · ${username}/${repo}`,
        `## [${latest.name || latest.tagName}](${tag})`,
        latest.body && truncate(plain(latest.body), 280),
        `-# \`${latest.tagName}\` · @${latest.authorUsername} · ${timestamp(latest.publishedAt ?? latest.createdAt, "R")}`,
      ]),
      buttons([
        ["View release", tag],
        ["All releases", url],
      ]),
    ];
  }

  const path = { username, repo, number: page.number };
  if (page.kind === "issue") {
    const { data } = await client.GET(
      "/api/repositories/{username}/{repo}/issues/{number}",
      { params: { path } },
    );
    if (!data) return null;
    const url = `${base}/issues/${data.number}`;
    return [
      text([
        `-# ${username}/${repo}`,
        `## [${data.title} #${data.number}](${url})`,
        data.body && truncate(plain(data.body), 280),
        `-# ${data.state === "open" ? "🟢 Open" : "🟣 Closed"} · @${data.authorUsername} opened ${timestamp(data.createdAt, "R")} · ${plural(data.commentCount, "comment")}`,
        data.labels.length
          ? data.labels
              .slice(0, 10)
              .map((label) => `\`${label.name}\``)
              .join(" ")
          : null,
      ]),
      buttons([["View issue", url]]),
    ];
  }

  const { data } = await client.GET(
    "/api/repositories/{username}/{repo}/pulls/{number}",
    { params: { path } },
  );
  if (!data) return null;
  const url = `${base}/pull/${data.number}`;
  const state = data.draft
    ? "⚪ Draft"
    : { open: "🟢 Open", closed: "🔴 Closed", merged: "🟣 Merged" }[data.state];
  return [
    section(
      [
        `-# ${username}/${repo}`,
        `## [${data.title} #${data.number}](${url})`,
        data.body && truncate(plain(data.body), 280),
        `-# ${state} · @${data.authorUsername} · \`${data.head.ref}\` into \`${data.base.ref}\``,
        `-# ${plural(data.commitCount, "commit")} · ${plural(data.changedFiles, "file")} · +${data.additions} −${data.deletions}`,
      ],
      data.authorImage,
    ),
    buttons([
      ["View pull request", url],
      ["Files changed", `${url}/files`],
    ]),
  ];
}

function text(lines: (string | null | undefined)[]): Component {
  return { type: 10, content: lines.filter(Boolean).join("\n") };
}

/** Text with the image as a thumbnail beside it, or the text alone when there is no image. */
function section(lines: (string | null | undefined)[], image?: string | null) {
  if (!image) return text(lines);
  return {
    type: 9,
    components: [text(lines)],
    accessory: { type: 11, media: { url: image } },
  };
}

/** Link buttons; the only style an embed allows. */
function buttons(links: ([label: string, url: string] | null)[]): Component {
  return {
    type: 1,
    components: links
      .filter((link) => link !== null)
      .map(([label, url]) => ({ type: 2, style: 5, label, url })),
  };
}

/** Discord's timestamp markdown, shown in the reader's timezone. */
function timestamp(iso: string, style: "D" | "R") {
  return `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
}
