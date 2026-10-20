import { afterEach, describe, expect, it, mock } from "bun:test";

import { fakeApi } from "@/lib/api/fake-api";

mock.module("next/headers", () => ({ headers: async () => new Headers() }));

const { GET } = await import("./route");

let restore = () => {};
afterEach(() => restore());

async function embed(path: string, routes: Record<string, unknown>) {
  restore = fakeApi(routes);
  const response = await GET(new Request("http://web.test"), {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });
  return { status: response.status, body: await response.json() };
}

const repository = {
  owner: "ghost",
  slug: "ghost",
  description: "Source code",
  starCount: 1,
  forkCount: 2,
  lastPushedAt: "2026-10-20T00:00:00Z",
};
const user = {
  username: "alice",
  name: "Alice",
  image: "https://cdn.test/alice.png",
  joinedAt: "2026-01-01T00:00:00Z",
  repositoryCount: 3,
  starCount: 1,
};
const organization = {
  slug: "ghost",
  name: "Ghost",
  logo: null,
  description: "Building Ghost",
  location: "Earth",
  website: "https://ghost.test",
  repositoryCount: 2,
  members: [],
};
const release = {
  tagName: "v1/beta",
  name: "",
  body: "Notes",
  authorUsername: "alice",
  publishedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
};
const thread = {
  number: 7,
  title: "Fix it",
  body: "**Broken** since [yesterday](https://x.test)",
  state: "open",
  authorUsername: "alice",
  createdAt: "2026-10-01T00:00:00Z",
};

const contents = (body: { component: { components: unknown[] } }) =>
  JSON.stringify(body.component.components);

describe("Discord embed", () => {
  it("wraps a page in one accented container", async () => {
    const { status, body } = await embed("/ghost/ghost", {
      "/api/repositories/ghost/ghost": repository,
    });
    expect(status).toBe(200);
    expect(body.component.type).toBe(17);
    expect(contents(body)).toContain(
      "## [ghost/ghost](http://localhost:3000/ghost/ghost)",
    );
    expect(contents(body)).toContain(
      "1 star · 2 forks · pushed <t:1792454400:R>",
    );
    expect(body.component.components[1]).toEqual({
      type: 12,
      items: [
        { media: { url: "http://localhost:3000/ghost/ghost/opengraph-image" } },
      ],
    });
    expect(contents(body)).toContain(
      '"label":"Pull requests","url":"http://localhost:3000/ghost/ghost/pulls"',
    );
  });

  it("previews the issue and pull request lists as their repository", async () => {
    for (const list of ["issues", "pulls"]) {
      const { body } = await embed(`/ghost/ghost/${list}`, {
        "/api/repositories/ghost/ghost": repository,
      });
      expect(contents(body)).toContain("## [ghost/ghost]");
    }
  });

  it("shows an organization with its logo missing and its website as a button", async () => {
    const { body } = await embed("/ghost", {
      "/api/organizations/ghost": organization,
    });
    const [text, row] = body.component.components;
    expect(text.type).toBe(10);
    expect(text.content).toContain("-# @ghost · Earth · 2 public repositories");
    expect(
      row.components.map((button: { label: string }) => button.label),
    ).toEqual(["View organization", "Website"]);
  });

  it("shows a user with their avatar as a thumbnail", async () => {
    const { body } = await embed("/alice", { "/api/users/alice": user });
    const [section] = body.component.components;
    expect(section.type).toBe(9);
    expect(section.accessory).toEqual({ type: 11, media: { url: user.image } });
    expect(contents(body)).toContain("3 public repositories · 1 star");
  });

  it("shows the latest release with its author, linked by its tag", async () => {
    const { body } = await embed("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": { releases: [release] },
    });
    expect(body.component.accent_color).toBe(0xc2b1f8);
    expect(body.component.components[0].content).toBe(
      [
        "-# [@alice](http://localhost:3000/alice) published <t:1790812800:R>",
        "## [v1/beta](http://localhost:3000/ghost/ghost/releases/tag/v1/beta)",
        "Notes",
        "-# ghost/ghost · `v1/beta`",
      ].join("\n"),
    );
  });

  it("shows a release by its tag, and one whose author is gone", async () => {
    const { body } = await embed("/ghost/ghost/releases/tag/v1/beta", {
      "/api/repositories/ghost/ghost/releases/tags/v1%2Fbeta": {
        ...release,
        name: "Beta",
        authorUsername: null,
      },
    });
    expect(contents(body)).toContain("-# Published <t:1790812800:R>");
    expect(contents(body)).toContain(
      "## [Beta](http://localhost:3000/ghost/ghost/releases/tag/v1/beta)",
    );
    expect(contents(body)).toContain(
      '"label":"All releases","url":"http://localhost:3000/ghost/ghost/releases"',
    );
  });

  it("says when a repository has no releases", async () => {
    const { body } = await embed("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": { releases: [] },
    });
    expect(contents(body)).toContain("No releases yet.");
  });

  it("shows an issue under its author, coloured by its state", async () => {
    const issue = {
      ...thread,
      commentCount: 1,
      labels: [{ name: "bug" }, { name: "ui" }],
    };
    const { body } = await embed("/ghost/ghost/issues/7", {
      "/api/repositories/ghost/ghost/issues/7": issue,
    });
    expect(body.component.accent_color).toBe(0x059669);
    expect(body.component.components[0].content).toBe(
      [
        "-# [@alice](http://localhost:3000/alice) opened <t:1790812800:R>",
        "## [Fix it #7](http://localhost:3000/ghost/ghost/issues/7)",
        "Broken since yesterday",
        "-# ghost/ghost · 1 comment · `bug` · `ui`",
      ].join("\n"),
    );

    const closed = await embed("/ghost/ghost/issues/7", {
      "/api/repositories/ghost/ghost/issues/7": {
        ...issue,
        state: "closed",
        labels: [],
      },
    });
    expect(closed.body.component.accent_color).toBe(0xdc2626);
    expect(contents(closed.body)).toContain("-# ghost/ghost · 1 comment");
  });

  it("shows a pull request under its author, coloured by its state", async () => {
    const pull = {
      ...thread,
      draft: false,
      state: "merged",
      head: { ref: "feat" },
      base: { ref: "main" },
      commitCount: 1,
      changedFiles: 2,
      additions: 3,
      deletions: 4,
    };
    const { body } = await embed("/ghost/ghost/pull/7", {
      "/api/repositories/ghost/ghost/pulls/7": pull,
    });
    expect(body.component.accent_color).toBe(0x7c3aed);
    expect(body.component.components[0].content).toBe(
      [
        "-# [@alice](http://localhost:3000/alice) opened <t:1790812800:R>",
        "## [Fix it #7](http://localhost:3000/ghost/ghost/pull/7)",
        "Broken since yesterday",
        "-# ghost/ghost · `feat` into `main`",
        "-# 1 commit · 2 files · +3 −4",
      ].join("\n"),
    );

    for (const [state, draft, accent] of [
      ["open", false, 0x059669],
      ["closed", false, 0xdc2626],
      ["open", true, 0x71717a],
    ] as const) {
      const other = await embed("/ghost/ghost/pull/7", {
        "/api/repositories/ghost/ghost/pulls/7": { ...pull, state, draft },
      });
      expect(other.body.component.accent_color).toBe(accent);
    }
  });

  it("answers 404 for pages without an embed, hidden resources and payloads over 3000 bytes", async () => {
    expect((await embed("/changelog", {})).status).toBe(404);
    expect((await embed("/ghost/ghost/tree/main", {})).status).toBe(404);
    expect((await embed("/nobody", {})).status).toBe(404);
    for (const path of [
      "/ghost/ghost",
      "/ghost/ghost/releases",
      "/ghost/ghost/releases/tag/v1",
      "/ghost/ghost/issues/7",
      "/ghost/ghost/pull/7",
    ]) {
      expect((await embed(path, {})).status).toBe(404);
    }
    const huge = await embed("/ghost/ghost/issues/7", {
      "/api/repositories/ghost/ghost/issues/7": {
        ...thread,
        title: "x".repeat(3000),
        commentCount: 0,
        labels: [],
      },
    });
    expect(huge.status).toBe(404);
  });
});
