import { afterEach, describe, expect, it, mock } from "bun:test";

import { CHANGELOG } from "@/app/changelog/entries";
import { fakeApi } from "@/lib/api/fake-api";
import { LLMS_TXT } from "@/lib/llms";

mock.module("next/headers", () => ({ headers: async () => new Headers() }));

const { GET } = await import("./route");

let restore = () => {};
afterEach(() => restore());

async function markdown(path: string, routes: Record<string, unknown> = {}) {
  restore = fakeApi(routes);
  const response = await GET(new Request("http://web.test"), {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  });
  expect(response.headers.get("content-type")).toBe(
    "text/markdown; charset=utf-8",
  );
  expect(response.headers.get("vary")).toBe("Accept");
  return { status: response.status, body: await response.text() };
}

const thread = {
  number: 7,
  title: "Fix it",
  body: "It broke.",
  state: "open",
  authorUsername: "alice",
  createdAt: "2026-10-01T00:00:00Z",
};
const comments = {
  comments: [
    {
      body: "Same here.",
      authorUsername: "bob",
      createdAt: "2026-10-02T00:00:00Z",
    },
  ],
};

describe("Markdown pages", () => {
  it("answers the home page with llms.txt and the changelog with its entries", async () => {
    expect((await markdown("/")).body).toBe(LLMS_TXT);
    const changelog = (await markdown("/changelog")).body;
    expect(changelog).toStartWith(
      `# Changelog\n\n## ${CHANGELOG[0].title}\n\n${CHANGELOG[0].date}`,
    );
  });

  it("lists an organization's details, members and repositories", async () => {
    const { body } = await markdown("/ghost", {
      "/api/organizations/ghost": {
        name: "Ghost",
        description: "Building Ghost",
        website: "https://ghost.test",
        location: null,
        members: [{ username: "alice" }],
      },
      "/api/repositories/ghost": {
        repositories: [
          { slug: "ghost", description: "Source\n" },
          { slug: "docs", description: null },
        ],
      },
    });
    expect(body).toBe(
      [
        "# Ghost",
        "Building Ghost",
        "- Organization: @ghost\n- Website: https://ghost.test\n- Members: [@alice](http://localhost:3000/alice)",
        "## Repositories\n\n- [ghost/ghost](http://localhost:3000/ghost/ghost): Source\n- [ghost/docs](http://localhost:3000/ghost/docs)",
      ].join("\n\n"),
    );
  });

  it("leaves out an organization's empty fields", async () => {
    const { body } = await markdown("/ghost", {
      "/api/organizations/ghost": {
        name: "Ghost",
        description: null,
        website: null,
        location: null,
        members: [],
      },
    });
    expect(body).toBe(
      "# Ghost\n\n- Organization: @ghost\n\n## Repositories\n\nNone yet.",
    );
  });

  it("lists a user's details", async () => {
    const { body } = await markdown("/alice", {
      "/api/users/alice": {
        username: "alice",
        name: "Alice",
        joinedAt: "2026-01-01T00:00:00Z",
        repositoryCount: 0,
        starCount: 2,
      },
    });
    expect(body).toStartWith(
      "# Alice (@alice)\n\n- Joined: 2026-01-01\n- Public repositories: 0\n- Stars: 2",
    );
  });

  it("shows a repository with its README", async () => {
    const repository = {
      owner: "ghost",
      slug: "ghost",
      description: "Source\n",
      starCount: 1,
      forkCount: 0,
      parent: { username: "up", slug: "stream" },
    };
    const { body } = await markdown("/ghost/ghost", {
      "/api/repositories/ghost/ghost": repository,
      "/api/repositories/ghost/ghost/readme": { content: "# Read me" },
    });
    expect(body).toContain("# ghost/ghost\n\nSource\n\n- Stars: 1");
    expect(body).toContain(
      "- Forked from: [up/stream](http://localhost:3000/up/stream)",
    );
    expect(body).toContain(
      "- Clone: `git clone http://localhost:3001/ghost/ghost.git`",
    );
    expect(body).toEndWith("---\n\n# Read me");

    const bare = await markdown("/ghost/ghost", {
      "/api/repositories/ghost/ghost": {
        ...repository,
        description: null,
        parent: null,
      },
      "/api/repositories/ghost/ghost/readme": { content: null },
    });
    expect(bare.body).not.toContain("Forked from");
    expect(bare.body).toEndWith(
      "[Releases](http://localhost:3000/ghost/ghost/releases)",
    );
  });

  it("lists issues and pull requests", async () => {
    const issues = await markdown("/ghost/ghost/issues", {
      "/api/repositories/ghost/ghost/issues": {
        openCount: 1,
        closedCount: 2,
        issues: [thread],
      },
    });
    expect(issues.body).toContain("1 open, 2 closed.");
    expect(issues.body).toContain(
      "- [#7 Fix it](http://localhost:3000/ghost/ghost/issues/7) by @alice",
    );

    const pulls = await markdown("/ghost/ghost/pulls", {
      "/api/repositories/ghost/ghost/pulls": {
        total: 1,
        pullRequests: [
          {
            ...thread,
            draft: true,
            head: { ref: "feat" },
            base: { ref: "main" },
          },
        ],
      },
    });
    expect(pulls.body).toContain(
      "- [#7 Fix it](http://localhost:3000/ghost/ghost/pull/7) by @alice, feat into main (draft)",
    );

    const none = await markdown("/ghost/ghost/pulls", {
      "/api/repositories/ghost/ghost/pulls": { total: 0, pullRequests: [] },
    });
    expect(none.body).toEndWith("None.");
  });

  it("lists releases with their notes", async () => {
    const { body } = await markdown("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": {
        releases: [
          {
            tagName: "v1",
            name: "One",
            body: "Notes",
            isLatest: true,
            isPrerelease: true,
            authorUsername: "alice",
            publishedAt: null,
            createdAt: "2026-10-01T00:00:00Z",
          },
        ],
      },
    });
    expect(body).toBe(
      "# Releases · ghost/ghost\n\n## One (latest) (pre-release)\n\nTag `v1`, published 2026-10-01 by @alice.\n\nNotes",
    );

    const none = await markdown("/ghost/ghost/releases", {
      "/api/repositories/ghost/ghost/releases": { releases: [] },
    });
    expect(none.body).toEndWith("None yet.");
  });

  it("shows an issue with its labels and comments", async () => {
    const { body } = await markdown("/ghost/ghost/issues/7", {
      "/api/repositories/ghost/ghost/issues/7": {
        ...thread,
        labels: [{ name: "bug" }],
      },
      "/api/repositories/ghost/ghost/issues/7/comments": comments,
    });
    expect(body).toBe(
      [
        "# Fix it · Issue #7 · ghost/ghost",
        "- State: open\n- Opened by @alice on 2026-10-01\n- Labels: bug",
        "It broke.",
        "---\n\n**@bob** on 2026-10-02:\n\nSame here.",
      ].join("\n\n"),
    );
  });

  it("shows a pull request with its branches and size", async () => {
    const { body } = await markdown("/ghost/ghost/pull/7", {
      "/api/repositories/ghost/ghost/pulls/7": {
        ...thread,
        body: "",
        draft: false,
        head: { username: "alice", ref: "feat" },
        base: { ref: "main" },
        commitCount: 1,
        changedFiles: 2,
        additions: 3,
        deletions: 4,
      },
    });
    expect(body).toContain("# Fix it · Pull request #7 · ghost/ghost");
    expect(body).toContain(
      "- Merges alice:feat into main\n- 1 commit, 2 files changed, +3 −4",
    );
    expect(body).toEndWith("_No description._");
  });

  it("answers 404 for unknown paths and resources the viewer may not see", async () => {
    for (const path of [
      "/ghost/ghost/tree/main",
      "/nobody",
      "/ghost/ghost",
      "/ghost/ghost/issues",
      "/ghost/ghost/pulls",
      "/ghost/ghost/releases",
      "/ghost/ghost/issues/7",
    ]) {
      const { status, body } = await markdown(path);
      expect(status).toBe(404);
      expect(body).toStartWith("# Not found");
    }
    expect(
      (
        await markdown("/ghost/ghost/pull/7", {
          "/api/repositories/ghost/ghost/pulls/7": 401,
        })
      ).status,
    ).toBe(404);
  });

  it("fails when the API fails, rather than answering a 404", async () => {
    restore = fakeApi({ "/api/repositories/ghost/ghost": 500 });
    await expect(
      GET(new Request("http://web.test"), {
        params: Promise.resolve({ path: ["ghost", "ghost"] }),
      }),
    ).rejects.toThrow("Failed to render /ghost/ghost");
  });
});
