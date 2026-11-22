import { type Context, Hono } from "hono";
import { handleGhost } from "./handlers/ghost.ts";
import { handleGitHub } from "./handlers/github.ts";
import type { HandlerResult } from "./handlers/result.ts";
import { applyInstallationChange } from "./installations.ts";
import type { Queue } from "./queue.ts";
import type { Side } from "./side.ts";
import type { Store } from "./store.ts";
import { verifyGhost, verifyGitHub } from "./verify.ts";

type Deps = { secrets: Record<Side, string>; bots: Record<Side, string>; store: Store; queue: Pick<Queue, "push"> };

/** Webhooks from both apps: verify, deduplicate, then store the job before answering, since the host only retries what was not acknowledged. */
export function webhookRoutes({ secrets, bots, store, queue }: Deps) {
  const app = new Hono();

  const receive = async (c: Context, side: Side, raw: Uint8Array, event: string | undefined, deliveryId: string | undefined, handle: (event: string, payload: unknown) => HandlerResult) => {
    if (!event || !deliveryId) return c.body(null, 400);
    if (!(await store.claimDelivery(side, deliveryId))) return c.body(null, 200);
    try {
      const result = handle(event, JSON.parse(new TextDecoder().decode(raw)));
      if (!result) return c.body(null, 200);
      if (result.kind === "installation") {
        await applyInstallationChange(store, queue, result);
        return c.body(null, 200);
      }
      // Our own writes come back as events; copying them would echo forever.
      if (result.actor === bots[side]) return c.body(null, 200);
      const sync = await store.findSyncByRepo(side, result.repoId);
      if (!sync || sync.status === "paused" || sync.status === "disconnected") return c.body(null, 200);
      await queue.push(sync.id, result.action);
      return c.body(null, 202);
    } catch (error) {
      await store.releaseDelivery(side, deliveryId);
      throw error;
    }
  };

  app.post("/webhooks/ghost", async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!verifyGhost(secrets.ghost, raw, c.req.header("x-ghost-timestamp") ?? null, c.req.header("x-ghost-signature-256") ?? null, Math.floor(Date.now() / 1000))) return c.body(null, 401);
    return receive(c, "ghost", raw, c.req.header("x-ghost-event"), c.req.header("x-ghost-delivery"), handleGhost);
  });

  app.post("/webhooks/github", async (c) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!verifyGitHub(secrets.github, raw, c.req.header("x-hub-signature-256") ?? null)) return c.body(null, 401);
    return receive(c, "github", raw, c.req.header("x-github-event"), c.req.header("x-github-delivery"), handleGitHub);
  });

  return app;
}
