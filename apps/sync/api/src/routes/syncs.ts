import { Hono, type MiddlewareHandler } from "hono";
import { type RouteDeps, type RouteEnv, signedIn } from "./setup.ts";

const RECENT_ACTIVITY = 100;

/** The dashboard and a sync's page: list, read, pause, resume, resync, delete. Another user's sync answers 404, as if it did not exist. */
export function syncRoutes(deps: RouteDeps) {
  const app = new Hono<RouteEnv>();
  const owned: MiddlewareHandler<RouteEnv> = async (c, next) => {
    const sync = await deps.store.getSync(c.req.param("id") ?? "");
    if (!sync || sync.ownerId !== c.get("userId")) return c.json({ error: "No such sync." }, 404);
    await next();
  };

  app.use("/api/*", signedIn(deps));
  app.use("/api/syncs/:id", owned);
  app.use("/api/syncs/:id/*", owned);

  app.get("/api/syncs", async (c) => c.json({ syncs: await deps.store.listSyncs({ ownerId: c.get("userId") }) }));

  app.get("/api/syncs/:id", async (c) => {
    const id = c.req.param("id");
    const flagged = (await deps.store.listRefs(id)).flatMap((ref) => (ref.diverged ? [{ name: ref.name, ghost: ref.diverged.ghost, github: ref.diverged.github, reason: ref.diverged.reason }] : []));
    // The install links let the page offer a fix when an app no longer covers a repository.
    return c.json({ sync: await deps.store.getSync(id), flagged, activity: await deps.store.listActivity(id, RECENT_ACTIVITY), installUrl: deps.installUrl });
  });

  app.post("/api/syncs/:id/pause", async (c) => {
    await deps.store.updateSync(c.req.param("id"), { status: "paused" });
    return c.json({ ok: true });
  });

  // Resuming also clears a disconnect; the reconcile it starts checks the owner and installations again and disconnects anew if they are still missing.
  app.post("/api/syncs/:id/resume", async (c) => {
    const id = c.req.param("id");
    await deps.store.updateSync(id, { status: "active", disconnectReason: null, lastError: null });
    await deps.reconcileNow(id);
    return c.json({ ok: true });
  });

  app.post("/api/syncs/:id/resync", async (c) => {
    await deps.reconcileNow(c.req.param("id"));
    return c.json({ ok: true });
  });

  // Deleting a sync stops it and forgets it; neither repository is touched.
  app.delete("/api/syncs/:id", async (c) => {
    const id = c.req.param("id");
    await deps.store.deleteSync(id);
    await deps.removeMirror(id);
    return c.json({ ok: true });
  });

  return app;
}
