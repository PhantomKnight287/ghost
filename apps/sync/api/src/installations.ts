import type { HandlerResult } from "./handlers/result.ts";
import type { Queue } from "./queue.ts";
import { SIDE_NAME, type Side } from "./side.ts";
import type { Store, SyncRow } from "./store.ts";

type InstallationChange = Extract<NonNullable<HandlerResult>, { kind: "installation" }>;

/** Disconnect reasons this side's app writes, so only its own return reconnects a sync. An owner who lost access is never reconnected here. */
const appReason = (side: Side) => `${SIDE_NAME[side]} app`;

async function disconnect(store: Store, sync: SyncRow, reason: string) {
  if (sync.status !== "disconnected") await store.updateSync(sync.id, { status: "disconnected", disconnectReason: reason });
}

async function reconnect(store: Store, queue: Pick<Queue, "push">, side: Side, sync: SyncRow) {
  if (sync.status !== "disconnected" || !sync.disconnectReason?.startsWith(appReason(side))) return;
  await store.updateSync(sync.id, { status: "active", disconnectReason: null, lastError: null });
  await queue.push(sync.id, { kind: "reconcile" });
}

/** Applies an installation event: an app removed, suspended or no longer covering a repository disconnects its syncs; coverage coming back reconnects them and reconciles. */
export async function applyInstallationChange(store: Store, queue: Pick<Queue, "push">, change: InstallationChange) {
  const { side, installationId } = change;
  const installed = await store.listSyncs({ installation: { side, id: installationId } });

  if (change.status === "deleted" || change.status === "suspended") {
    for (const sync of installed) await disconnect(store, sync, `${appReason(side)} ${change.status === "deleted" ? "uninstalled" : "suspended"}`);
  }
  if (change.status === "active") {
    for (const sync of installed) await reconnect(store, queue, side, sync);
  }
  for (const repoId of change.removed ?? []) {
    const sync = await store.findSyncByRepo(side, repoId);
    if (sync) await disconnect(store, sync, `${appReason(side)} no longer covers ${side === "ghost" ? sync.ghostFullName : sync.githubFullName}`);
  }
  for (const repoId of change.added ?? []) {
    const sync = await store.findSyncByRepo(side, repoId);
    if (!sync) continue;
    // A repository created on GitHub during setup has no installation until the owner adds it.
    await store.updateSync(sync.id, side === "ghost" ? { ghostInstallationId: installationId } : { githubInstallationId: installationId });
    await reconnect(store, queue, side, { ...sync, ...(side === "ghost" ? { ghostInstallationId: installationId } : { githubInstallationId: installationId }) });
  }
}
