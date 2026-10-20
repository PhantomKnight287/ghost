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

  it("shows the latest release, linked by its tag", async () => {
    const { body } = await embed("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": {
        releases: [
          {
            tagName: "v1/beta",
            name: "",
            body: "Notes",
            authorUsername: "alice",
            publishedAt: null,
            createdAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    });
    expect(contents(body)).toContain(
      "## [v1/beta](http://localhost:3000/ghost/ghost/releases/tag/v1/beta)",
    );
    expect(contents(body)).toContain("<t:1790812800:R>");
  });

  it("says when a repository has no releases", async () => {
    const { body } = await embed("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": { releases: [] },
    });
    expect(contents(body)).toContain("No releases yet.");
  });

  it("shows an issue's state, comments, labels and the plain text of its body", async () => {
    const { body } = await embed("/ghost/ghost/issues/7", {
      "/api/repositories/ghost/ghost/issues/7": {
        ...thread,
        state: "closed",
        commentCount: 1,
        labels: [{ name: "bug" }],
      },
    });
    expect(contents(body)).toContain("Broken since yesterday");
    expect(contents(body)).toContain(
      "🟣 Closed · @alice opened <t:1790812800:R> · 1 comment",
    );
    expect(contents(body)).toContain("`bug`");
  });

  it("shows a pull request's state, branches and size", async () => {
    const pull = {
      ...thread,
      draft: false,
      state: "merged",
      authorImage: null,
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
    expect(contents(body)).toContain("🟣 Merged · @alice · `feat` into `main`");
    expect(contents(body)).toContain("1 commit · 2 files · +3 −4");

    const draft = await embed("/ghost/ghost/pull/7", {
      "/api/repositories/ghost/ghost/pulls/7": { ...pull, draft: true },
    });
    expect(contents(draft.body)).toContain("⚪ Draft");
  });

  it("answers 404 for pages without an embed, hidden resources and payloads over 3000 bytes", async () => {
    expect((await embed("/changelog", {})).status).toBe(404);
    expect((await embed("/ghost/ghost/tree/main", {})).status).toBe(404);
    expect((await embed("/nobody", {})).status).toBe(404);
    for (const path of [
      "/ghost/ghost",
      "/ghost/ghost/releases",
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
