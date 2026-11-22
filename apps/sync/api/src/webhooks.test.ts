import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { fakeStore } from "./lib/fake-store.ts";
import { syncRow } from "./lib/test-context.ts";
import type { SyncRow } from "./store.ts";
import type { SyncAction } from "./sync/action.ts";
import { webhookRoutes } from "./webhooks.ts";

const secrets = { ghost: "whsec_ghost", github: "whsec_github" };

function setup(syncs: SyncRow[] = [syncRow()]) {
  const store = fakeStore({ syncs });
  const queued: { syncId: string; action: SyncAction }[] = [];
  const app = webhookRoutes({
    secrets,
    bots: { ghost: "ghost-sync[bot]", github: "ghost-sync[bot]" },
    store,
    queue: {
      push: async (syncId, action) => {
        queued.push({ syncId, action });
      },
    },
  });
  return { app, store, queued };
}

function ghostRequest(body: unknown, opts: { event?: string; delivery?: string; timestamp?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac("sha256", opts.secret ?? secrets.ghost).update(`${timestamp}.${raw}`).digest("hex")}`;
  return new Request("http://sync/webhooks/ghost", {
    method: "POST",
    body: raw,
    headers: { "x-ghost-event": opts.event ?? (body as { event: string }).event, "x-ghost-delivery": opts.delivery ?? crypto.randomUUID(), "x-ghost-timestamp": timestamp, "x-ghost-signature-256": signature },
  });
}

function githubRequest(event: string, body: unknown, opts: { delivery?: string; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", opts.secret ?? secrets.github).update(raw).digest("hex")}`;
  return new Request("http://sync/webhooks/github", {
    method: "POST",
    body: raw,
    headers: { "x-github-event": event, "x-github-delivery": opts.delivery ?? crypto.randomUUID(), "x-hub-signature-256": signature },
  });
}

const ghostIssue = (sender = "bob") => ({ event: "issue.opened", repository: { id: "ghost-repo-uuid" }, sender: { username: sender }, issue: { number: 12 } });
const githubIssue = { action: "opened", repository: { id: 4242 }, sender: { login: "alice" }, issue: { number: 5 } };

describe("POST /webhooks/ghost", () => {
  test("a valid event is accepted and its action queued on its sync", async () => {
    const { app, queued } = setup();
    const response = await app.request(ghostRequest(ghostIssue()));
    expect(response.status).toBe(202);
    expect(queued).toEqual([{ syncId: "sync-1", action: { kind: "issue", from: "ghost", number: 12, deleted: false } }]);
  });

  test("a bad signature is refused", async () => {
    const { app, queued } = setup();
    expect((await app.request(ghostRequest(ghostIssue(), { secret: "wrong" }))).status).toBe(401);
    expect(queued).toEqual([]);
  });

  test("a stale timestamp is refused", async () => {
    const { app } = setup();
    expect((await app.request(ghostRequest(ghostIssue(), { timestamp: Math.floor(Date.now() / 1000) - 301 }))).status).toBe(401);
  });

  test("a repeated delivery is acknowledged once", async () => {
    const { app, queued } = setup();
    await app.request(ghostRequest(ghostIssue(), { delivery: "d-1" }));
    expect((await app.request(ghostRequest(ghostIssue(), { delivery: "d-1" }))).status).toBe(200);
    expect(queued).toHaveLength(1);
  });

  test("our own bot's events are dropped", async () => {
    const { app, queued } = setup();
    expect((await app.request(ghostRequest(ghostIssue("ghost-sync[bot]")))).status).toBe(200);
    expect(queued).toEqual([]);
  });

  test("an unknown repository is acknowledged and dropped", async () => {
    const { app, queued } = setup();
    expect((await app.request(ghostRequest({ ...ghostIssue(), repository: { id: "elsewhere" } }))).status).toBe(200);
    expect(queued).toEqual([]);
  });

  test("paused and disconnected syncs drop events", async () => {
    for (const status of ["paused", "disconnected"] as const) {
      const { app, queued } = setup([syncRow({ status })]);
      expect((await app.request(ghostRequest(ghostIssue()))).status).toBe(200);
      expect(queued).toEqual([]);
    }
  });

  test("events Ghost Sync does not copy are acknowledged", async () => {
    const { app, queued } = setup();
    expect((await app.request(ghostRequest({ event: "ping", webhook: { id: "w" } }))).status).toBe(200);
    expect(queued).toEqual([]);
  });

  test("an uninstalled app disconnects its syncs, naming the side", async () => {
    const { app, store } = setup();
    const response = await app.request(ghostRequest({ event: "installation.deleted", installation: { id: 11, account: { login: "acme" } }, sender: null }));
    expect(response.status).toBe(200);
    expect(await store.getSync("sync-1")).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("Ghost") });
  });

  test("a repository removed from the installation disconnects only its sync", async () => {
    const other = syncRow({ id: "sync-2", ghostRepoId: "other-repo", githubRepoId: "1" });
    const { app, store } = setup([syncRow(), other]);
    await app.request(ghostRequest({ event: "installation.repositories_removed", installation: { id: 11 }, repositories: [{ id: "ghost-repo-uuid" }], sender: null }));
    expect((await store.getSync("sync-1"))?.status).toBe("disconnected");
    expect((await store.getSync("sync-2"))?.status).toBe("active");
  });

  test("coverage coming back reconnects and queues a reconcile", async () => {
    const { app, store, queued } = setup([syncRow({ status: "disconnected", disconnectReason: "Ghost app suspended" })]);
    await app.request(ghostRequest({ event: "installation.unsuspended", installation: { id: 11 }, sender: null }));
    expect(await store.getSync("sync-1")).toMatchObject({ status: "active", disconnectReason: null });
    expect(queued).toEqual([{ syncId: "sync-1", action: { kind: "reconcile" } }]);
  });

  test("an owner who lost access is not reconnected by an installation event", async () => {
    const { app, store } = setup([syncRow({ status: "disconnected", disconnectReason: "owner lost access" })]);
    await app.request(ghostRequest({ event: "installation.unsuspended", installation: { id: 11 }, sender: null }));
    expect((await store.getSync("sync-1"))?.status).toBe("disconnected");
  });
});

describe("POST /webhooks/github", () => {
  test("a valid event is accepted and queued", async () => {
    const { app, queued } = setup();
    expect((await app.request(githubRequest("issues", githubIssue))).status).toBe(202);
    expect(queued).toEqual([{ syncId: "sync-1", action: { kind: "issue", from: "github", number: 5, deleted: false } }]);
  });

  test("a bad signature is refused", async () => {
    const { app } = setup();
    expect((await app.request(githubRequest("issues", githubIssue, { secret: "wrong" }))).status).toBe(401);
  });

  test("a repeated delivery is acknowledged once", async () => {
    const { app, queued } = setup();
    await app.request(githubRequest("issues", githubIssue, { delivery: "d-1" }));
    expect((await app.request(githubRequest("issues", githubIssue, { delivery: "d-1" }))).status).toBe(200);
    expect(queued).toHaveLength(1);
  });

  test("the same delivery id on the other side is a different delivery", async () => {
    const { app, queued } = setup();
    await app.request(ghostRequest(ghostIssue(), { delivery: "d-1" }));
    await app.request(githubRequest("issues", githubIssue, { delivery: "d-1" }));
    expect(queued).toHaveLength(2);
  });

  test("our own bot's events are dropped", async () => {
    const { app, queued } = setup();
    await app.request(githubRequest("issues", { ...githubIssue, sender: { login: "ghost-sync[bot]" } }));
    expect(queued).toEqual([]);
  });

  test("an uninstalled GitHub app disconnects its syncs", async () => {
    const { app, store } = setup();
    await app.request(githubRequest("installation", { action: "deleted", installation: { id: 22 }, sender: { login: "alice" } }));
    expect(await store.getSync("sync-1")).toMatchObject({ status: "disconnected", disconnectReason: expect.stringContaining("GitHub") });
  });
});

describe("pipeline edge cases", () => {
  test("a delivery whose job could not be stored is processed again on the host's retry", async () => {
    const { store } = setup();
    const queued: unknown[] = [];
    let fail = true;
    const flaky = webhookRoutes({
      secrets,
      bots: { ghost: "ghost-sync[bot]", github: "ghost-sync[bot]" },
      store,
      queue: {
        push: async (syncId, action) => {
          if (fail) throw new Error("database unreachable");
          queued.push({ syncId, action });
        },
      },
    });
    const first = await flaky.request(githubRequest("issues", githubIssue, { delivery: "d-9" }));
    expect(first.status).toBe(500);
    fail = false;
    expect((await flaky.request(githubRequest("issues", githubIssue, { delivery: "d-9" }))).status).toBe(202);
    expect(queued).toHaveLength(1);
  });

  test("a delivery without its event or id headers is refused", async () => {
    const { app } = setup();
    const raw = JSON.stringify(githubIssue);
    const request = new Request("http://sync/webhooks/github", { method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secrets.github).update(raw).digest("hex")}` } });
    expect((await app.request(request)).status).toBe(400);
  });

  test("a repository added to the GitHub installation records it, reconnects and reconciles", async () => {
    const { app, store, queued } = setup([syncRow({ status: "disconnected", disconnectReason: "GitHub app no longer covers acme-gh/app", githubInstallationId: null })]);
    await app.request(githubRequest("installation_repositories", { action: "added", installation: { id: 22 }, repositories_added: [{ id: 4242 }], repositories_removed: [], sender: { login: "alice" } }));
    expect(await store.getSync("sync-1")).toMatchObject({ status: "active", githubInstallationId: 22, disconnectReason: null });
    expect(queued).toEqual([{ syncId: "sync-1", action: { kind: "reconcile" } }]);
  });

  test("the other side's app returning does not reconnect a sync this side disconnected", async () => {
    const { app, store } = setup([syncRow({ status: "disconnected", disconnectReason: "GitHub app suspended" })]);
    await app.request(ghostRequest({ event: "installation.unsuspended", installation: { id: 11 }, sender: null }));
    expect((await store.getSync("sync-1"))?.status).toBe("disconnected");
  });
});

