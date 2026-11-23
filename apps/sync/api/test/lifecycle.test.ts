import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Repo } from "./fake-host.ts";
import { databaseUrl, LOGINS, SLUGS, startWorld, twoRepositories, type World } from "./harness.ts";

describe.skipIf(!databaseUrl)("checks and the sync's lifecycle", () => {
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

  const titled = (repo: Repo, title: string) => [...repo.items.values()].filter((item) => item.title === title);

  describe("check runs", () => {
    test("a CI run on GitHub is copied onto the Ghost commit, its completion follows, and the copy never echoes back", async () => {
      const run = world.github.addCheckRun("acme-gh/app", { name: "CI / test", headSha: main, status: "in_progress", conclusion: null, app: "github-actions" });
      await world.settle();
      const copies = () => ghostRepo.checkRuns.filter((each) => each.name === "CI / test");
      expect(copies()).toEqual([expect.objectContaining({ headSha: main, status: "in_progress", app: SLUGS.ghost, detailsUrl: `${world.github.origin}/acme-gh/app/runs/${run.id}` })]);

      await world.github.as("ci").request("PATCH", `/repos/acme-gh/app/check-runs/${run.id}`, { status: "completed", conclusion: "failure" });
      await world.settle();
      expect(copies()).toEqual([expect.objectContaining({ status: "completed", conclusion: "failure" })]);
      expect(githubRepo.checkRuns.filter((each) => each.name === "CI / test")).toHaveLength(1);
    });

    test("a Ghost commit gets a passing \"Sync with GitHub\" check once it is on GitHub", async () => {
      const next = world.ghost.push("acme/app", "main", "second", { author: "alice" });
      world.ghost.requestCheckSuite("acme/app", next);
      await world.settle();
      expect(ghostRepo.checkRuns.filter((each) => each.name === "Sync with GitHub")).toEqual([expect.objectContaining({ headSha: next, status: "completed", conclusion: "success" })]);
    });
  });

  describe("commit statuses", () => {
    const deploy = { context: "Ghost - api", description: "Deploying", targetUrl: "https://railway.example.com/deploy/1", creator: "railway-app[bot]" };
    const view = (repo: Repo, context: string) => repo.statuses.filter((each) => each.context === context).map(({ state, description, targetUrl, creator }) => ({ state, description, targetUrl, creator }));

    test("a deploy status on GitHub is copied onto the Ghost commit, its update follows, and the copy never echoes back", async () => {
      world.github.addStatus("acme-gh/app", { sha: main, state: "pending", ...deploy });
      await world.settle();
      world.github.addStatus("acme-gh/app", { sha: main, state: "success", ...deploy, description: "Success - api.example.com" });
      await world.settle();
      expect(view(ghostRepo, "Ghost - api")).toEqual([
        { state: "pending", description: "Deploying", targetUrl: deploy.targetUrl, creator: `${SLUGS.ghost}[bot]` },
        { state: "success", description: "Success - api.example.com", targetUrl: deploy.targetUrl, creator: `${SLUGS.ghost}[bot]` },
      ]);
      expect(view(githubRepo, "Ghost - api").map((each) => each.creator)).toEqual(["railway-app[bot]", "railway-app[bot]"]);
    });

    test("a status on Ghost reaches GitHub", async () => {
      world.ghost.addStatus("acme/app", { sha: main, context: "ghost-ci", state: "failure", creator: "ci[bot]" });
      await world.settle();
      expect(view(githubRepo, "ghost-ci")).toEqual([{ state: "failure", description: null, targetUrl: null, creator: `${SLUGS.github}[bot]` }]);
    });
  });

  describe("lifecycle", () => {
    test("a paused sync drops webhooks, and resuming catches up on what it missed", async () => {
      expect((await world.call("POST", `/api/syncs/${syncId}/pause`)).status).toBe(200);
      await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "While paused", body: "" });
      await world.settle();
      expect(titled(ghostRepo, "While paused")).toEqual([]);

      expect((await world.call("POST", `/api/syncs/${syncId}/resume`)).status).toBe(200);
      await world.settle();
      expect(titled(ghostRepo, "While paused")).toHaveLength(1);
      expect((await world.store.getSync(syncId))?.status).toBe("active");
    });

    test("the GitHub app uninstalled disconnects the sync, naming GitHub; installed again, it reconnects and catches up", async () => {
      world.github.setInstalled(false);
      await world.settle();
      expect(await world.store.getSync(syncId)).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("GitHub app") });

      await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "While uninstalled", body: "" });
      await world.settle();
      expect(titled(githubRepo, "While uninstalled")).toEqual([]);

      world.github.setInstalled(true);
      await world.settle();
      expect((await world.store.getSync(syncId))?.status).toBe("active");
      expect(titled(githubRepo, "While uninstalled")).toHaveLength(1);
    });

    test("an owner who is no longer admin on GitHub stops the sync at the next reconcile", async () => {
      githubRepo.admins.delete(LOGINS.github);
      await world.call("POST", `/api/syncs/${syncId}/resync`);
      await world.settle();
      expect(await world.store.getSync(syncId)).toMatchObject({ status: "disconnected", disconnectReason: "owner lost access" });
    });

    test("a sync whose GitHub link was revoked counts as the owner losing access", async () => {
      world.linked.github = false;
      await world.call("POST", `/api/syncs/${syncId}/resync`);
      await world.settle();
      expect(await world.store.getSync(syncId)).toMatchObject({ status: "disconnected", disconnectReason: "owner lost access" });
    });

    test("deleting a sync forgets it and its mirror and leaves both repositories exactly as they were", async () => {
      await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "Kept", body: "" });
      await world.settle();
      const before = { ghost: [...ghostRepo.items.keys()], github: [...githubRepo.items.keys()], ghostMain: world.ghost.sha("acme/app", "refs/heads/main"), githubMain: world.github.sha("acme-gh/app", "refs/heads/main") };
      const mirror = join(world.root, "mirrors", `${syncId}.git`);
      expect(existsSync(mirror)).toBe(true);

      expect((await world.call("DELETE", `/api/syncs/${syncId}`)).status).toBe(200);
      await world.settle();
      expect(await world.store.getSync(syncId)).toBeNull();
      expect(existsSync(mirror)).toBe(false);
      expect({ ghost: [...ghostRepo.items.keys()], github: [...githubRepo.items.keys()], ghostMain: world.ghost.sha("acme/app", "refs/heads/main"), githubMain: world.github.sha("acme-gh/app", "refs/heads/main") }).toEqual(before);

      await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "After delete", body: "" });
      await world.settle();
      expect(titled(ghostRepo, "After delete")).toEqual([]);
    });

    test("another user cannot see or act on the sync", async () => {
      const asStranger = (method: string, path: string) => world.server.app.request(path, { method, headers: { "x-test-user": "stranger" } });
      expect((await asStranger("GET", `/api/syncs/${syncId}`)).status).toBe(404);
      expect((await asStranger("POST", `/api/syncs/${syncId}/pause`)).status).toBe(404);
      expect((await asStranger("DELETE", `/api/syncs/${syncId}`)).status).toBe(404);
      expect((await world.store.getSync(syncId))?.status).toBe("active");
    });
  });
});
