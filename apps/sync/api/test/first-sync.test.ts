import { beforeEach, describe, expect, test } from "bun:test";
import { withMarker } from "../src/format.ts";
import { git } from "./fake-host.ts";
import { BOTS, databaseUrl, startWorld, twoRepositories, type World } from "./harness.ts";

describe.skipIf(!databaseUrl)("pairing and the first sync", () => {
  let world: World;
  beforeEach(async () => {
    world = await startWorld(import.meta.file);
  });

  /** Ghost has history, an open and a closed issue, a label, and a reviewed pull request; GitHub has only an issue of its own. */
  async function seeded() {
    const { ghostRepo, githubRepo } = twoRepositories(world);
    const ghost = world.ghost.as("alice");
    const main = world.ghost.push("acme/app", "main", "first");
    world.ghost.push("acme/app", "feat", "feature work", { from: main });
    await ghost.request("POST", "/repos/acme/app/labels", { name: "bug", color: "d73a4a", description: "Broken" });
    await ghost.request("POST", "/repos/acme/app/issues", { title: "Crash on save", body: "Steps", labels: ["bug"] });
    await world.ghost.as("carol").request("POST", "/repos/acme/app/issues/1/comments", { body: "Same here" });
    await ghost.request("POST", "/repos/acme/app/issues", { title: "Old", body: "Done" });
    await ghost.request("PATCH", "/repos/acme/app/issues/2", { state: "closed" });
    await ghost.request("POST", "/repos/acme/app/pulls", { title: "Add feature", body: "Please review", head: "feat", base: "main" });
    await world.ghost.as("carol").request("POST", "/repos/acme/app/pulls/3/reviews", {
      event: "APPROVE",
      body: "LGTM",
      comments: [{ path: "src/a.ts", line: 3, side: "RIGHT", body: "nit" }],
    });
    await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "From GitHub", body: "Hello" });
    // The hosts' webhooks for the setup itself arrive before any sync exists and are dropped.
    await world.settle();
    return { ghostRepo, githubRepo, main };
  }

  test("copies branches, issues with comments and labels, and pull requests with reviews, both ways, then goes active", async () => {
    const { githubRepo, ghostRepo, main } = await seeded();
    const id = await world.pair();

    expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBe(main);
    expect(world.github.sha("acme-gh/app", "refs/heads/feat")).toBe(world.ghost.sha("acme/app", "refs/heads/feat"));

    const githubItems = [...githubRepo.items.values()];
    const crash = githubItems.find((item) => item.title === "Crash on save");
    expect(crash).toMatchObject({ author: BOTS.github, body: withMarker("Steps", "ghost", "alice"), labels: ["bug"], state: "open" });
    expect(githubRepo.labels.get("bug")).toEqual({ name: "bug", color: "d73a4a", description: "Broken" });
    expect(githubRepo.comments.find((comment) => comment.number === crash?.number)?.body).toBe(withMarker("Same here", "ghost", "carol"));
    expect(githubItems.find((item) => item.title === "Old")?.state).toBe("closed");

    const pull = githubItems.find((item) => item.title === "Add feature");
    expect(pull?.pull).toMatchObject({ head: { ref: "feat" }, base: "main", draft: false });
    const review = githubRepo.reviews.find((each) => each.number === pull?.number && each.author === BOTS.github && each.body.includes("Approved"));
    expect(review?.state).toBe("COMMENTED");
    expect(review?.body).toBe(withMarker("Approved on Ghost by @carol\n\nLGTM", "ghost", "carol"));
    expect(githubRepo.reviewComments.find((comment) => comment.reviewId === review?.id)).toMatchObject({ path: "src/a.ts", line: 3, body: withMarker("nit", "ghost", "carol") });

    const fromGithub = [...ghostRepo.items.values()].find((item) => item.title === "From GitHub");
    expect(fromGithub).toMatchObject({ author: BOTS.ghost, body: withMarker("Hello", "github", "dave") });

    const sync = await world.store.getSync(id);
    expect(sync).toMatchObject({ status: "active", lastError: null });
    expect(sync?.lastReconciledAt).not.toBeNull();
    expect((await world.store.listActivity(id, 50)).filter((entry) => entry.error)).toEqual([]);
  });

  test("twins a person opened on both sides before the sync are paired, not copied, and follow each other from then on", async () => {
    const { ghostRepo, githubRepo } = twoRepositories(world);
    const main = world.ghost.push("acme/app", "main", "first");
    const feat = world.ghost.push("acme/app", "feat", "feature work", { from: main });
    world.github.fetchFrom("acme-gh/app", ghostRepo.bare);
    git(githubRepo.bare, "update-ref", "refs/heads/main", main);
    git(githubRepo.bare, "update-ref", "refs/heads/feat", feat);
    const ghost = world.ghost.as("alice");
    const github = world.github.as("alice");
    await ghost.request("POST", "/repos/acme/app/issues", { title: "Twin", body: "GitHub twin: #1" });
    await github.request("POST", "/repos/acme-gh/app/issues", { title: "Twin", body: "Ghost twin: #1" });
    await github.request("PATCH", "/repos/acme-gh/app/issues/1", { state: "closed" });
    await ghost.request("POST", "/repos/acme/app/pulls", { title: "Add feature", body: "GitHub twin: #2", head: "feat", base: "main" });
    await github.request("POST", "/repos/acme-gh/app/pulls", { title: "Add feature", body: "Ghost twin: #2", head: "feat", base: "main" });
    await world.github.as("coderabbitai[bot]").request("POST", "/repos/acme-gh/app/issues/2/comments", { body: "Summary from before pairing" });
    await world.settle();

    await world.pair();
    const items = (repo: typeof ghostRepo) => [...repo.items.values()].map(({ number, title, body, state, author }) => ({ number, title, body, state, author }));
    expect(items(ghostRepo)).toEqual([
      { number: 1, title: "Twin", body: "GitHub twin: #1", state: "open", author: "alice" },
      { number: 2, title: "Add feature", body: "GitHub twin: #2", state: "open", author: "alice" },
    ]);
    expect(items(githubRepo)).toEqual([
      { number: 1, title: "Twin", body: "Ghost twin: #1", state: "closed", author: "alice" },
      { number: 2, title: "Add feature", body: "Ghost twin: #2", state: "open", author: "alice" },
    ]);

    // Each twin keeps the comments it had before pairing; new ones follow.
    expect(ghostRepo.comments).toEqual([]);
    await github.request("POST", "/repos/acme-gh/app/issues/2/comments", { body: "After pairing" });
    await ghost.request("PATCH", "/repos/acme/app/issues/1", { title: "Twin, renamed" });
    await world.settle();
    expect(ghostRepo.comments.map((comment) => comment.body)).toEqual([withMarker("After pairing", "github", "alice")]);
    expect(githubRepo.items.get(1)).toMatchObject({ title: "Twin, renamed", body: "Ghost twin: #1", state: "closed" });
  });

  test("without backfill, nothing from before is copied, and work after it is", async () => {
    const { ghostRepo, githubRepo, main } = await seeded();
    world.ghost.push("acme/app", "stale", "old work", { from: main });
    await world.settle();
    const id = await world.pair("acme/app", "acme-gh/app", { backfill: false });
    expect(await world.store.getSync(id)).toMatchObject({ status: "active", backfill: false });
    expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBeNull();
    expect(githubRepo.items.size).toBe(1);
    expect(ghostRepo.items.size).toBe(3);

    const ghost = world.ghost.as("alice");
    await ghost.request("POST", "/repos/acme/app/issues", { title: "New since", body: "Fresh" });
    await world.ghost.as("carol").request("POST", "/repos/acme/app/issues/1/comments", { body: "Still broken" });
    const feat = world.ghost.push("acme/app", "feat", "more work", { from: world.ghost.sha("acme/app", "refs/heads/feat") ?? undefined });
    await world.settle();
    await world.call("POST", `/api/syncs/${id}/resync`);
    await world.settle();

    const titles = [...githubRepo.items.values()].map((item) => item.title).sort();
    // The push to feat is new work on its pull request, so the pull request comes across; its review from before stays behind.
    expect(titles).toEqual(["Add feature", "Crash on save", "From GitHub", "New since"]);
    expect(githubRepo.reviews).toEqual([]);
    expect(githubRepo.reviewComments).toEqual([]);
    const crash = [...githubRepo.items.values()].find((item) => item.title === "Crash on save");
    expect(githubRepo.comments.filter((comment) => comment.number === crash?.number).map((comment) => comment.body)).toEqual([withMarker("Still broken", "ghost", "carol")]);
    // main comes across as the copied pull request's base; a branch no one touched stays behind.
    expect(world.github.sha("acme-gh/app", "refs/heads/feat")).toBe(feat);
    expect(world.github.sha("acme-gh/app", "refs/heads/main")).toBe(main);
    expect(world.github.sha("acme-gh/app", "refs/heads/stale")).toBeNull();
  });

  test("a second full reconcile copies nothing again", async () => {
    const { githubRepo, ghostRepo } = await seeded();
    const id = await world.pair();
    const count = () => ({
      ghost: [ghostRepo.items.size, ghostRepo.comments.length, ghostRepo.reviews.length, ghostRepo.reviewComments.length, ghostRepo.labels.size],
      github: [githubRepo.items.size, githubRepo.comments.length, githubRepo.reviews.length, githubRepo.reviewComments.length, githubRepo.labels.size],
    });
    const before = count();
    await world.store.updateSync(id, { lastReconciledAt: null });
    expect((await world.call("POST", `/api/syncs/${id}/resync`)).status).toBe(200);
    await world.settle();
    expect(count()).toEqual(before);
  });

  test("the preview counts what the first sync will copy each way", async () => {
    await seeded();
    const preview = await world.call("POST", "/api/syncs/preview", { ghost: { fullName: "acme/app" }, github: { fullName: "acme-gh/app" } });
    expect(preview).toEqual({
      status: 200,
      body: { branches: { toGhost: 0, toGitHub: 2, diverged: 0 }, issues: { toGhost: 1, toGitHub: 2 }, pulls: { toGhost: 0, toGitHub: 1 } },
    });
  });

  test("pairing refuses a repository the app is not installed on, and one already synced", async () => {
    twoRepositories(world);
    world.github.createRepo("acme-gh/elsewhere", { admins: ["bob-gh"], installed: false });
    const refused = await world.call<{ error: string; installUrl: string }>("POST", "/api/syncs", { ghost: { fullName: "acme/app" }, github: { fullName: "acme-gh/elsewhere" } });
    expect(refused.status).toBe(403);
    expect(refused.body.installUrl).toBe("https://github.com/apps/sync-bot-gh/installations/new");
    await world.pair();
    expect((await world.call("POST", "/api/syncs", { ghost: { fullName: "acme/app" }, github: { fullName: "acme-gh/app" } })).status).toBe(409);
  });

  test("creating a new GitHub repository waits for the owner to add it to the installation", async () => {
    world.ghost.createRepo("acme/app", { admins: ["bob"] });
    world.ghost.push("acme/app", "main", "first");
    const created = await world.call<{ id: string; installUrl: string }>("POST", "/api/syncs", { ghost: { fullName: "acme/app" }, github: { create: { owner: "bob-gh", name: "mirror", private: true } } });
    expect(created.status).toBe(201);
    expect(world.github.repo("bob-gh/mirror").private).toBe(true);
    expect(await world.store.getSync(created.body.id)).toMatchObject({ status: "disconnected", githubInstallationId: null });
  });
});
