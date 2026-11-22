import type { Side } from "../side.ts";
import type { SyncRow } from "../store.ts";
import type { SyncContext } from "../sync/context.ts";
import { type FakeGit, fakeGit, fakeRemotes } from "./fake-git.ts";
import { type FakeRest, fakeRest, type Routes } from "./fake-rest.ts";
import { type FakeStore, fakeStore } from "./fake-store.ts";

/** Ghost repository `acme/app` (webhook id `ghost-repo-uuid`), GitHub repository `acme-gh/app` (id `4242`). */
export function syncRow(overrides: Partial<SyncRow> = {}): SyncRow {
  const now = new Date("2026-11-01T00:00:00Z");
  return {
    id: "sync-1",
    ownerId: "user-1",
    ghostRepoId: "ghost-repo-uuid",
    ghostFullName: "acme/app",
    githubRepoId: "4242",
    githubFullName: "acme-gh/app",
    ghostInstallationId: 11,
    githubInstallationId: 22,
    status: "active",
    lastError: null,
    disconnectReason: null,
    lastReconciledAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export type TestContext = SyncContext & { ghost: FakeRest; github: FakeRest; store: FakeStore; git: FakeGit };

export function testContext(opts: { ghost?: Routes; github?: Routes; git?: FakeGit; sync?: Partial<SyncRow> } = {}): TestContext {
  const ghost = fakeRest(opts.ghost);
  const github = fakeRest(opts.github);
  const sync = syncRow(opts.sync);
  const store = fakeStore({ syncs: [sync] });
  const git = opts.git ?? fakeGit();
  return {
    sync,
    rest: { ghost, github },
    repo: { ghost: { owner: "acme", name: "app" }, github: { owner: "acme-gh", name: "app" } },
    remote: async () => fakeRemotes,
    git,
    dir: "/unused",
    bot: { ghost: "ghost-sync[bot]", github: "ghost-sync[bot]" },
    appSlug: { ghost: "ghost-sync", github: "ghost-sync" },
    store,
    ghost,
    github,
  };
}

/** `IC_` + base64url of the UUID, as Ghost's REST layer spells a comment's `node_id`. */
export function ghostNodeId(prefix: string, uuid: string) {
  return `${prefix}_${Buffer.from(uuid).toString("base64url")}`;
}

export const sides: Side[] = ["ghost", "github"];
