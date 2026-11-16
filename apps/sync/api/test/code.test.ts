import { beforeEach, describe, expect, test } from "bun:test";
import { withMarker } from "../src/format.ts";
import type { Repo } from "./fake-host.ts";
import { BOTS, databaseUrl, startWorld, twoRepositories, type World } from "./harness.ts";

type SyncPage = { flagged: { name: string; ghost: string | null; github: string | null; reason: string }[] };

describe.skipIf(!databaseUrl)("branches and pull requests", () => {
  let world: World;
  let ghostRepo: Repo;
  let githubRepo: Repo;
  let syncId: string;
  let main: string;
  beforeEach(async () => {
    world = await startWorld(import.meta.file);
    ({ ghostRepo, githubRepo } = twoRepositories(world));
    main = world.ghost.push("acme/app", "main", "first");
    await world.settle();
    syncId = await world.pair();
  });

  const pullTitled = (repo: Repo, title: string) => [...repo.items.values()].find((item) => item.pull && item.title === title);

  describe("branches", () => {
    test("a push on either side moves the other", async () => {
      const next = world.ghost.push("acme/app", "main", "second", { author: "alice" });
      await world.settle();
      expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBe(next);

      world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
      const fromGithub = world.github.push("acme-gh/app", "main", "third", { author: "dave" });
      await world.settle();
      expect(world.ghost.sha("acme/app", "refs/heads/main")).toBe(fromGithub);
    });

    test("a new branch on GitHub appears on Ghost", async () => {
      world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
      const tip = world.github.push("acme-gh/app", "topic", "topic work", { from: main, author: "dave" });
      await world.settle();
      expect(world.ghost.sha("acme/app", "refs/heads/topic")).toBe(tip);
    });

    test("both sides moving apart: nothing is overwritten, the branch is flagged, and a merge by a person clears it", async () => {
      world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
      const onGhost = world.ghost.push("acme/app", "main", "ghost side", { author: "alice" });
      const onGithub = world.github.push("acme-gh/app", "main", "github side", { from: main, author: "dave" });
      await world.settle();

      expect(world.ghost.sha("acme/app", "refs/heads/main")).toBe(onGhost);
      expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBe(onGithub);
      const page = await world.call<SyncPage>("GET", `/api/syncs/${syncId}`);
      expect(page.body.flagged).toEqual([{ name: "refs/heads/main", ghost: onGhost, github: onGithub, reason: "diverged" }]);

      world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
      const merge = world.github.push("acme-gh/app", "main", "merge", { parents: [onGithub, onGhost], author: "dave" });
      await world.settle();
      expect(world.ghost.sha("acme/app", "refs/heads/main")).toBe(merge);
      expect((await world.call<SyncPage>("GET", `/api/syncs/${syncId}`)).body.flagged).toEqual([]);
    });
  });

  describe("pull requests", () => {
    async function openOnGithub() {
      world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
      world.github.push("acme-gh/app", "fix", "fix it", { from: main, author: "dave" });
      await world.settle();
      await world.github.as("dave").request("POST", "/repos/acme-gh/app/pulls", { title: "Fix it", body: "Fixes the bug", head: "fix", base: "main" });
      await world.settle();
      const original = pullTitled(githubRepo, "Fix it");
      const copy = pullTitled(ghostRepo, "Fix it");
      if (!original || !copy) throw new Error("pull request not copied");
      return { original, copy };
    }

    test("opened on GitHub, copied to Ghost with its branch, once", async () => {
      const { copy } = await openOnGithub();
      expect(copy).toMatchObject({ author: BOTS.ghost, body: withMarker("Fixes the bug", "github", "dave") });
      expect(copy.pull).toMatchObject({ head: { ref: "fix" }, base: "main" });
      expect([...githubRepo.items.values()].filter((item) => item.pull)).toHaveLength(1);
    });

    test("an approval on GitHub reaches Ghost as a comment that states it, never as an approval", async () => {
      const { original, copy } = await openOnGithub();
      await world.github.as("coderabbitai[bot]").request("POST", `/repos/acme-gh/app/pulls/${original.number}/reviews`, {
        event: "APPROVE",
        body: "Looks good",
        comments: [{ path: "src/fix.ts", line: 10, side: "RIGHT", body: "Consider a guard here" }],
      });
      await world.settle();
      // GitHub may send the line comment's webhook before the review's, so the comment can arrive on its own; either way the verdict is stated once and nothing approves.
      const verdicts = ghostRepo.reviews.filter((each) => each.number === copy.number && each.body.includes("Approved"));
      expect(verdicts).toEqual([expect.objectContaining({ author: BOTS.ghost, state: "COMMENTED", body: withMarker("Approved on GitHub by @coderabbitai[bot]\n\nLooks good", "github", "coderabbitai[bot]") })]);
      expect(ghostRepo.reviews.some((each) => each.state === "APPROVED")).toBe(false);
      expect(ghostRepo.reviewComments.filter((comment) => comment.number === copy.number).map((comment) => comment.body)).toEqual([withMarker("Consider a guard here", "github", "coderabbitai[bot]")]);
    });

    test("the review's webhook arriving before its comments' copies each comment once, inside the review", async () => {
      const { original, copy } = await openOnGithub();
      await world.github.as("carol").request("POST", `/repos/acme-gh/app/pulls/${original.number}/reviews`, {
        event: "REQUEST_CHANGES",
        body: "Two things",
        comments: [
          { path: "src/a.ts", line: 1, side: "RIGHT", body: "First" },
          { path: "src/b.ts", line: 2, side: "RIGHT", body: "Second" },
        ],
      });
      for (const delivery of world.github.takeDeliveries().reverse()) expect((await world.server.app.fetch(delivery)).status).toBeLessThan(300);
      await world.settle();
      const verdict = ghostRepo.reviews.find((each) => each.number === copy.number && each.body.includes("Changes requested on GitHub by @carol"));
      expect(ghostRepo.reviewComments.filter((comment) => comment.number === copy.number).map((comment) => [comment.reviewId === verdict?.id, comment.body])).toEqual([
        [true, withMarker("First", "github", "carol")],
        [true, withMarker("Second", "github", "carol")],
      ]);
    });

    test("a reply on Ghost joins the GitHub thread it answers", async () => {
      const { original, copy } = await openOnGithub();
      await world.github.as("coderabbitai[bot]").request("POST", `/repos/acme-gh/app/pulls/${original.number}/reviews`, {
        event: "COMMENT",
        body: "",
        comments: [{ path: "src/fix.ts", line: 10, side: "RIGHT", body: "Why this?" }],
      });
      await world.settle();
      const root = ghostRepo.reviewComments.find((comment) => comment.number === copy.number);
      await world.ghost.as("bob").request("POST", `/repos/acme/app/pulls/${copy.number}/comments`, { body: "Because of #2", in_reply_to: root?.id });
      await world.settle();
      const githubRoot = githubRepo.reviewComments.find((comment) => comment.body === "Why this?");
      const reply = githubRepo.reviewComments.find((comment) => comment.inReplyTo === githubRoot?.id);
      expect(reply?.body).toBe(withMarker("Because of #2", "ghost", "bob"));
    });

    test("title, body and draft follow; merged on Ghost closes the GitHub original with a note", async () => {
      const { original, copy } = await openOnGithub();
      await world.github.as("dave").request("PATCH", `/repos/acme-gh/app/pulls/${original.number}`, { title: "Fix it properly" });
      await world.settle();
      expect(copy.title).toBe("Fix it properly");

      const nodeId = (await world.github.as("dave").request<{ node_id: string }>("GET", `/repos/acme-gh/app/pulls/${original.number}`)).node_id;
      await world.github.as("dave").graphql("mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { clientMutationId } }", { id: nodeId });
      await world.settle();
      expect(copy.pull?.draft).toBe(true);

      world.ghost.merge("acme/app", copy.number, "bob");
      await world.settle();
      expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBe(world.ghost.sha("acme/app", "refs/heads/main"));
      expect(original.state).toBe("closed");
      expect(githubRepo.comments.filter((comment) => comment.number === original.number).map((comment) => comment.body)).toEqual(["Merged on Ghost"]);
    });

    test("a Ghost fork's pull request is headed on GitHub by ghost-pr/<n>, which goes when it closes", async () => {
      const fork = world.ghost.openForkPull("acme/app", "erin", "From my fork", "main");
      await world.settle();
      expect(world.github.sha("acme-gh/app", `refs/heads/ghost-pr/${fork.number}`)).toBe(fork.sha);
      const copy = pullTitled(githubRepo, "From my fork");
      expect(copy?.pull?.head.ref).toBe(`ghost-pr/${fork.number}`);

      await world.ghost.as("bob").request("PATCH", `/repos/acme/app/pulls/${fork.number}`, { state: "closed" });
      await world.settle();
      expect(copy?.state).toBe("closed");
      expect(world.github.sha("acme-gh/app", `refs/heads/ghost-pr/${fork.number}`)).toBeNull();
    });

    test("a GitHub fork's pull request is not synced, and the sync page says why", async () => {
      world.github.openForkPull("acme-gh/app", "mallory", "Drive-by", "main");
      await world.settle();
      expect(pullTitled(ghostRepo, "Drive-by")).toBeUndefined();
      const page = await world.call<{ activity: { summary: string }[] }>("GET", `/api/syncs/${syncId}`);
      expect(page.body.activity.some((entry) => /fork/i.test(entry.summary))).toBe(true);
    });
  });
});
