import { describe, expect, test } from "bun:test";
import { type FakeRest, fakeRest, type Routes } from "../lib/fake-rest.ts";
import { fakeStore } from "../lib/fake-store.ts";
import { ghostNodeId, syncRow } from "../lib/test-context.ts";
import type { Side } from "../side.ts";
import type { SyncRow } from "../store.ts";
import { type RouteDeps, setupRoutes } from "./setup.ts";

const adminRepo = { ghost: { id: 1, node_id: ghostNodeId("R", "new-uuid"), full_name: "acme/new", private: true, permissions: { admin: true } }, github: { id: 5555, node_id: "R_gh", full_name: "acme-gh/new", private: true, permissions: { admin: true } } };

function setup(opts: { ghost?: Routes; github?: Routes | null; syncs?: SyncRow[]; installations?: Partial<Record<Side, number | null>> } = {}) {
  const store = fakeStore({ syncs: opts.syncs ?? [syncRow()] });
  const rest: Record<Side, FakeRest | null> = { ghost: fakeRest({ "GET /user": { login: "bob" }, ...opts.ghost }), github: opts.github === null ? null : fakeRest({ "GET /user": { login: "bob-gh" }, ...opts.github }) };
  const reconciled: string[] = [];
  const deps: RouteDeps = {
    store,
    currentUser: async (c) => (c.req.header("x-test-user") ? { id: c.req.header("x-test-user") ?? "" } : null),
    userRest: async (_userId, side) => rest[side],
    appInstallation: async (side) => (opts.installations && side in opts.installations ? (opts.installations[side] ?? null) : side === "ghost" ? 11 : 22),
    installUrl: { ghost: "https://ghost.example.com/apps/ghost-sync/installations/new", github: "https://github.com/apps/ghost-sync/installations/new" },
    compareRefs: async () => ({ toGhost: 1, toGitHub: 2, diverged: 0 }),
    reconcileNow: (syncId) => reconciled.push(syncId),
    removeMirror: async () => {},
  };
  const app = setupRoutes(deps);
  const call = (method: string, path: string, body?: unknown, user: string | null = "user-1") =>
    app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) } });
  return { app, call, store, rest, reconciled };
}

const existing = { ghost: { fullName: "acme/new" }, github: { fullName: "acme-gh/new" } };
const repoRoutes = { ghost: { "GET /repos/acme/new": adminRepo.ghost }, github: { "GET /repos/acme-gh/new": adminRepo.github } };

describe("GET /api/me", () => {
  test("names both accounts, GitHub null until linked", async () => {
    expect(await (await setup().call("GET", "/api/me")).json()).toEqual({ ghost: { login: "bob" }, github: { login: "bob-gh" } });
    expect(await (await setup({ github: null }).call("GET", "/api/me")).json()).toEqual({ ghost: { login: "bob" }, github: null });
  });

  test("signed out is 401", async () => {
    expect((await setup().call("GET", "/api/me", undefined, null)).status).toBe(401);
  });
});

describe("GET /api/repositories/:side", () => {
  test("lists only repositories the user administers, marking ones already synced", async () => {
    const { call } = setup({
      ghost: {
        "GET /user/installations": [{ id: 11 }],
        "GET /user/installations/11/repositories": [
          { id: 1, node_id: ghostNodeId("R", "ghost-repo-uuid"), full_name: "acme/app", private: true, permissions: { admin: true } },
          { id: 2, node_id: ghostNodeId("R", "other-uuid"), full_name: "acme/other", private: false, permissions: { admin: false } },
          adminRepo.ghost,
        ],
      },
    });
    expect(await (await call("GET", "/api/repositories/ghost")).json()).toEqual({
      installUrl: "https://ghost.example.com/apps/ghost-sync/installations/new",
      repositories: [
        { id: "ghost-repo-uuid", fullName: "acme/app", private: true, synced: true },
        { id: "new-uuid", fullName: "acme/new", private: true, synced: false },
      ],
    });
  });

  test("GitHub ids are the numeric id as text", async () => {
    const { call } = setup({ github: { "GET /user/installations": [{ id: 22 }], "GET /user/installations/22/repositories": [adminRepo.github] } });
    expect((await (await call("GET", "/api/repositories/github")).json()).repositories).toEqual([{ id: "5555", fullName: "acme-gh/new", private: true, synced: false }]);
  });

  test("an unknown side is 404", async () => {
    expect((await setup().call("GET", "/api/repositories/gitlab")).status).toBe(404);
  });
});

describe("GET /api/github/owners", () => {
  test("the user and organizations they can create repositories in", async () => {
    const { call } = setup({ github: { "GET /user/orgs": [{ login: "acme-gh" }, { login: "other-org" }], "GET /user/memberships/orgs/acme-gh": { role: "admin" }, "GET /user/memberships/orgs/other-org": { role: "member" } } });
    expect(await (await call("GET", "/api/github/owners")).json()).toEqual({ owners: ["bob-gh", "acme-gh"] });
  });
});

describe("POST /api/syncs/preview", () => {
  test("counts what the first sync copies each way", async () => {
    const { call } = setup({
      ghost: { ...repoRoutes.ghost, "GET /repos/acme/new/issues?state=all": [{ number: 1 }, { number: 2, pull_request: {} }] },
      github: { ...repoRoutes.github, "GET /repos/acme-gh/new/issues?state=all": [{ number: 1 }, { number: 2 }, { number: 3 }] },
    });
    expect(await (await call("POST", "/api/syncs/preview", existing)).json()).toEqual({
      branches: { toGhost: 1, toGitHub: 2, diverged: 0 },
      issues: { toGhost: 3, toGitHub: 1 },
      pulls: { toGhost: 0, toGitHub: 1 },
    });
  });
});

describe("POST /api/syncs", () => {
  test("pairs two repositories the user administers and starts the first reconcile", async () => {
    const { call, store, reconciled } = setup(repoRoutes);
    const response = await call("POST", "/api/syncs", existing);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect(await store.getSync(id)).toMatchObject({
      ownerId: "user-1",
      ghostRepoId: "new-uuid",
      ghostFullName: "acme/new",
      githubRepoId: "5555",
      githubFullName: "acme-gh/new",
      ghostInstallationId: 11,
      githubInstallationId: 22,
      status: "backfilling",
    });
    expect(reconciled).toEqual([id]);
  });

  test("signed out is 401", async () => {
    expect((await setup(repoRoutes).call("POST", "/api/syncs", existing, null)).status).toBe(401);
  });

  test("not an admin of either repository is 403", async () => {
    for (const side of ["ghost", "github"] as const) {
      const routes = { ...repoRoutes, [side]: { [`GET /repos/${side === "ghost" ? "acme" : "acme-gh"}/new`]: { ...adminRepo[side], permissions: { admin: false } } } };
      const { call, store } = setup(routes);
      expect((await call("POST", "/api/syncs", existing)).status).toBe(403);
      expect(store.syncs).toHaveLength(1);
    }
  });

  test("a repository the user cannot see is 403", async () => {
    expect((await setup({ ghost: {}, github: repoRoutes.github }).call("POST", "/api/syncs", existing)).status).toBe(403);
  });

  test("a repository the app is not installed on is 403 with the install link", async () => {
    const { call } = setup({ ...repoRoutes, installations: { ghost: null } });
    const response = await call("POST", "/api/syncs", existing);
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).toContain("https://ghost.example.com/apps/ghost-sync/installations/new");
  });

  test("a repository already in a sync is 409", async () => {
    const { call } = setup({ ...repoRoutes, syncs: [syncRow({ ghostRepoId: "new-uuid" })] });
    expect((await call("POST", "/api/syncs", existing)).status).toBe(409);
    const other = setup({ ...repoRoutes, syncs: [syncRow({ githubRepoId: "5555" })] });
    expect((await other.call("POST", "/api/syncs", existing)).status).toBe(409);
  });

  test("GitHub not linked yet is 400", async () => {
    expect((await setup({ ghost: repoRoutes.ghost, github: null }).call("POST", "/api/syncs", existing)).status).toBe(400);
  });

  test("a malformed body is 400", async () => {
    expect((await setup(repoRoutes).call("POST", "/api/syncs", { ghost: {} })).status).toBe(400);
  });

  test("create new under the user: private exactly as chosen, empty", async () => {
    const { call, rest, store } = setup({ ghost: repoRoutes.ghost, github: { "POST /user/repos": { ...adminRepo.github, full_name: "bob-gh/new" } } });
    const response = await call("POST", "/api/syncs", { ghost: existing.ghost, github: { create: { owner: "bob-gh", name: "new", private: false } } });
    expect(response.status).toBe(201);
    expect(rest.github?.calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/user/repos", body: { name: "new", private: false, auto_init: false } });
    expect(store.syncs.at(-1)).toMatchObject({ githubFullName: "bob-gh/new", githubRepoId: "5555" });
  });

  test("create new under an organization", async () => {
    const { call, rest } = setup({ ghost: repoRoutes.ghost, github: { "POST /orgs/acme-gh/repos": adminRepo.github } });
    await call("POST", "/api/syncs", { ghost: existing.ghost, github: { create: { owner: "acme-gh", name: "new", private: true } } });
    expect(rest.github?.calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/orgs/acme-gh/repos", body: { name: "new", private: true, auto_init: false } });
  });

  test("a new repository the installation does not cover waits disconnected, with the link to add it", async () => {
    const { call, store, reconciled } = setup({ ghost: repoRoutes.ghost, github: { "POST /user/repos": adminRepo.github }, installations: { github: null } });
    const response = await call("POST", "/api/syncs", { ghost: existing.ghost, github: { create: { owner: "bob-gh", name: "new", private: true } } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ installUrl: "https://github.com/apps/ghost-sync/installations/new" });
    expect(store.syncs.at(-1)).toMatchObject({ status: "disconnected" });
    expect(reconciled).toEqual([]);
  });
});
