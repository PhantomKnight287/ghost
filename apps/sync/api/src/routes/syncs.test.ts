import { describe, expect, test } from "bun:test";
import { fakeRest } from "../lib/fake-rest.ts";
import { fakeStore } from "../lib/fake-store.ts";
import { syncRow } from "../lib/test-context.ts";
import type { RouteDeps } from "./setup.ts";
import { syncRoutes } from "./syncs.ts";

function setup() {
  const store = fakeStore({ syncs: [syncRow({ id: "mine" }), syncRow({ id: "theirs", ownerId: "user-2", ghostRepoId: "g2", githubRepoId: "2" })] });
  const rest = fakeRest();
  const reconciled: string[] = [];
  const removed: string[] = [];
  const deps: RouteDeps = {
    store,
    currentUser: async (c) => (c.req.header("x-test-user") ? { id: c.req.header("x-test-user") ?? "" } : null),
    userRest: async () => rest,
    appInstallation: async () => 1,
    installUrl: { ghost: "g", github: "h" },
    webUrl: { ghost: "https://ghost.example.com", github: "https://github.com" },
    compareRefs: async () => ({ toGhost: 0, toGitHub: 0, diverged: 0 }),
    reconcileNow: (id) => reconciled.push(id),
    removeMirror: async (id) => {
      removed.push(id);
    },
  };
  const app = syncRoutes(deps);
  const call = (method: string, path: string, user: string | null = "user-1") => app.request(path, { method, headers: user ? { "x-test-user": user } : {} });
  return { call, store, rest, reconciled, removed };
}

describe("reading", () => {
  test("GET /api/syncs lists only the user's syncs", async () => {
    const { call } = setup();
    const body = (await (await call("GET", "/api/syncs")).json()) as { syncs: { id: string }[] };
    expect(body.syncs.map((s) => s.id)).toEqual(["mine"]);
  });

  test("GET /api/syncs/:id has flagged refs and recent activity, newest first", async () => {
    const { call, store } = setup();
    await store.flagRef("mine", "refs/heads/main", { ghost: "b", github: "c", reason: "diverged" });
    await store.setBase("mine", "refs/heads/ok", "a");
    await store.addActivity({ syncId: "mine", direction: "github", kind: "issue", summary: "first", error: null });
    await store.addActivity({ syncId: "mine", direction: "ghost", kind: "pull", summary: "second", error: null });
    const body = (await (await call("GET", "/api/syncs/mine")).json()) as { sync: { id: string }; flagged: unknown[]; activity: { summary: string }[] };
    expect(body.sync.id).toBe("mine");
    expect(body.flagged).toEqual([{ name: "refs/heads/main", ghost: "b", github: "c", reason: "diverged" }]);
    expect(body.activity.map((a) => a.summary)).toEqual(["second", "first"]);
    expect((body as unknown as { installUrl: unknown }).installUrl).toEqual({ ghost: "g", github: "h" });
  });

  test("GET /api/syncs/:id counts synced refs and paired items", async () => {
    const { call, store } = setup();
    await store.setBase("mine", "refs/heads/main", "a");
    await store.setBase("mine", "refs/heads/stuck", "a");
    await store.flagRef("mine", "refs/heads/stuck", { ghost: "b", github: "c", reason: "diverged" });
    await store.saveLink({ syncId: "mine", kind: "issue", ghostId: "12", ghostRestId: null, githubId: "5" });
    const body = (await (await call("GET", "/api/syncs/mine")).json()) as { counts: unknown; webUrl: unknown };
    expect(body.counts).toEqual({ refs: 1, issue: 1 });
    expect(body.webUrl).toEqual({ ghost: "https://ghost.example.com", github: "https://github.com" });
  });

  test("another user's sync is 404, signed out is 401", async () => {
    const { call } = setup();
    expect((await call("GET", "/api/syncs/theirs")).status).toBe(404);
    expect((await call("GET", "/api/syncs/missing")).status).toBe(404);
    expect((await call("GET", "/api/syncs", null)).status).toBe(401);
  });

  test("no response carries a token", async () => {
    const { call } = setup();
    for (const path of ["/api/syncs", "/api/syncs/mine"]) {
      expect(await (await call("GET", path)).text()).not.toMatch(/gh[usoapr]_[A-Za-z0-9]/);
    }
  });
});

describe("actions", () => {
  test("pause, then resume reconciles", async () => {
    const { call, store, reconciled } = setup();
    expect((await call("POST", "/api/syncs/mine/pause")).status).toBe(200);
    expect((await store.getSync("mine"))?.status).toBe("paused");
    expect((await call("POST", "/api/syncs/mine/resume")).status).toBe(200);
    expect((await store.getSync("mine"))?.status).toBe("active");
    expect(reconciled).toEqual(["mine"]);
    expect(store.activity.map((a) => a.summary)).toEqual(["Paused", "Resumed; catching up with both sides"]);
  });

  test("resume clears a disconnect reason", async () => {
    const { call, store } = setup();
    await store.updateSync("mine", { status: "disconnected", disconnectReason: "owner lost access" });
    await call("POST", "/api/syncs/mine/resume");
    expect(await store.getSync("mine")).toMatchObject({ status: "active", disconnectReason: null });
  });

  test("resync reconciles without changing the status", async () => {
    const { call, store, reconciled } = setup();
    await call("POST", "/api/syncs/mine/resync");
    expect(reconciled).toEqual(["mine"]);
    expect(store.activity.map((a) => a.summary)).toEqual(["Resync requested"]);
    expect((await store.getSync("mine"))?.status).toBe("active");
  });

  test("delete removes the sync and its mirror and touches neither host", async () => {
    const { call, store, rest, removed } = setup();
    expect((await call("DELETE", "/api/syncs/mine")).status).toBe(200);
    expect(await store.getSync("mine")).toBeNull();
    expect(removed).toEqual(["mine"]);
    expect(rest.calls).toEqual([]);
  });

  test("only the creator may act", async () => {
    const { call, store, reconciled, removed } = setup();
    for (const [method, path] of [["POST", "/api/syncs/theirs/pause"], ["POST", "/api/syncs/theirs/resume"], ["POST", "/api/syncs/theirs/resync"], ["DELETE", "/api/syncs/theirs"]] as const) {
      expect((await call(method, path)).status).toBe(404);
    }
    expect((await store.getSync("theirs"))?.status).toBe("active");
    expect(reconciled).toEqual([]);
    expect(removed).toEqual([]);
  });
});
