import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { createRest, type Rest } from "../src/rest.ts";
import type { Side } from "../src/side.ts";

/**
 * An in-memory Ghost or GitHub: the REST and GraphQL calls Ghost Sync makes, real bare git repositories served over file://, and the webhooks a real host sends for every write, Ghost Sync's own included.
 * `side` picks the flavour: Ghost names comments, reviews and repositories by UUID in webhooks and spells their REST `node_id` as `<prefix>_<base64url UUID>`; GitHub uses numeric ids throughout.
 */

type Label = { name: string; color: string; description: string | null };
type Branch = { ref: string; repoId: number | null };
type Item = {
  number: number;
  uuid: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  author: string;
  labels: string[];
  updatedAt: Date;
  pull: { head: Branch; base: string; draft: boolean; merged: boolean } | null;
};
type Comment = { id: number; uuid: string; number: number; body: string; author: string; createdAt: string };
type Review = { id: number; uuid: string; number: number; state: string; body: string; author: string; commitId: string; submittedAt: string };
type ReviewComment = {
  id: number;
  uuid: string;
  number: number;
  reviewId: number;
  path: string;
  line: number | null;
  side: string | null;
  startLine: number | null;
  startSide: string | null;
  body: string;
  author: string;
  commitId: string;
  inReplyTo: number | null;
  createdAt: string;
};
type Status = { id: number; uuid: string; sha: string; context: string; state: string; description: string | null; targetUrl: string | null; creator: string };
type CheckRun = { id: number; uuid: string; name: string; headSha: string; status: string; conclusion: string | null; output: { title: string | null; summary: string | null; text?: string | null }; detailsUrl: string | null; app: string };
export type Repo = {
  id: number;
  uuid: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  bare: string;
  admins: Set<string>;
  installed: boolean;
  nextNumber: number;
  items: Map<number, Item>;
  labels: Map<string, Label>;
  comments: Comment[];
  reviews: Review[];
  reviewComments: ReviewComment[];
  checkRuns: CheckRun[];
  statuses: Status[];
};
type Actor = { kind: "user"; login: string } | { kind: "installation"; id: number } | { kind: "app" };

const b64 = (text: string) => Buffer.from(text).toString("base64url");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

export function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

const tryGit = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: GIT_ENV });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
};

export function createFakeHost(opts: { side: Side; origin: string; root: string; slug: string; webhookSecret: string; installationId: number }) {
  const { side, origin, slug, installationId } = opts;
  const ghost = side === "ghost";
  const bot = `${slug}[bot]`;
  const repos = new Map<string, Repo>();
  const tokens = new Map<string, Actor>();
  const pending: Request[] = [];
  let ids = 1000;
  let installed = true;
  const settings = { refuseDeleteIssue: false };

  const nodeId = (prefix: string, entity: { id?: number; number?: number; uuid: string }) => (ghost ? `${prefix}_${b64(entity.uuid)}` : `${prefix}_${entity.id ?? entity.number}`);
  const loginOf = (actor: Actor) => (actor.kind === "user" ? actor.login : bot);
  const sha = (repo: Repo, ref: string) => tryGit(repo.bare, "rev-parse", "--verify", "--quiet", ref);

  // Webhooks, queued until the test delivers them, as a real host sends them shortly after the write.
  function emit(repo: Repo | null, actor: string | null, ghostEvent: string, githubEvent: string, payload: { ghost: object; github: object }) {
    const body = ghost
      ? { event: ghostEvent, repository: repo ? { id: repo.uuid, fullName: repo.fullName } : undefined, sender: actor ? { username: actor } : null, installation: { id: installationId }, ...payload.ghost }
      : { repository: repo ? { id: repo.id, full_name: repo.fullName } : undefined, sender: actor ? { login: actor } : null, installation: { id: installationId }, ...payload.github };
    const raw = JSON.stringify(body);
    const delivery = crypto.randomUUID();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ghost) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      Object.assign(headers, {
        "x-ghost-event": ghostEvent,
        "x-ghost-delivery": delivery,
        "x-ghost-timestamp": timestamp,
        "x-ghost-signature-256": `sha256=${createHmac("sha256", opts.webhookSecret).update(`${timestamp}.${raw}`).digest("hex")}`,
      });
    } else {
      Object.assign(headers, { "x-github-event": githubEvent, "x-github-delivery": delivery, "x-hub-signature-256": `sha256=${createHmac("sha256", opts.webhookSecret).update(raw).digest("hex")}` });
    }
    pending.push(new Request(`http://sync.test/webhooks/${side}`, { method: "POST", body: raw, headers }));
  }

  const threadOf = (item: Item) => (item.pull ? { pullRequest: { number: item.number } } : { issue: { number: item.number } });
  function emitItem(repo: Repo, item: Item, verb: string, actor: string) {
    if (item.pull) {
      const githubVerb = { synchronized: "synchronize", merged: "closed" }[verb] ?? verb;
      emit(repo, actor, `pull_request.${verb}`, "pull_request", { ghost: { pullRequest: { number: item.number } }, github: { action: githubVerb, number: item.number, pull_request: { number: item.number } } });
    } else {
      emit(repo, actor, `issue.${verb}`, "issues", { ghost: { issue: { number: item.number } }, github: { action: verb, issue: { number: item.number } } });
    }
  }

  const labelJson = (repo: Repo, name: string) => repo.labels.get(name.toLowerCase()) ?? { name, color: "ededed", description: null };
  const repoJson = (repo: Repo, viewer?: string) => ({
    id: repo.id,
    node_id: nodeId("R", repo),
    name: repo.name,
    full_name: repo.fullName,
    owner: { login: repo.owner },
    private: repo.private,
    default_branch: "main",
    permissions: { admin: viewer ? repo.admins.has(viewer) : false },
  });
  const itemJson = (repo: Repo, item: Item) => ({
    number: item.number,
    node_id: nodeId(item.pull ? "PR" : "I", item),
    title: item.title,
    body: item.body,
    state: item.state,
    user: { login: item.author },
    labels: item.labels.map((name) => labelJson(repo, name)),
    updated_at: item.updatedAt.toISOString(),
    ...(item.pull ? { pull_request: { url: `${origin}/${repo.fullName}/pull/${item.number}` } } : {}),
  });
  const pullJson = (repo: Repo, item: Item) => {
    const pull = item.pull as NonNullable<Item["pull"]>;
    const fork = pull.head.repoId !== repo.id;
    return {
      ...itemJson(repo, item),
      pull_request: undefined,
      draft: pull.draft,
      merged: pull.merged,
      head: { ref: pull.head.ref, sha: (fork ? sha(repo, `refs/pull/${item.number}/head`) : sha(repo, `refs/heads/${pull.head.ref}`)) ?? "", repo: pull.head.repoId === null ? null : { id: pull.head.repoId } },
      base: { ref: pull.base, sha: sha(repo, `refs/heads/${pull.base}`) ?? "", repo: { id: repo.id } },
    };
  };
  const commentJson = (comment: Comment) => ({ id: comment.id, node_id: nodeId("IC", comment), body: comment.body, user: { login: comment.author }, created_at: comment.createdAt });
  const reviewJson = (review: Review) => ({ id: review.id, node_id: nodeId("PRR", review), state: review.state, body: review.body, user: { login: review.author }, commit_id: review.commitId, submitted_at: review.submittedAt });
  const reviewCommentJson = (comment: ReviewComment) => ({
    id: comment.id,
    node_id: nodeId("PRRC", comment),
    path: comment.path,
    line: comment.line,
    side: comment.side,
    start_line: comment.startLine,
    start_side: comment.startSide,
    body: comment.body,
    user: { login: comment.author },
    commit_id: comment.commitId,
    in_reply_to_id: comment.inReplyTo,
    pull_request_review_id: comment.reviewId,
    created_at: comment.createdAt,
  });
  const checkRunJson = (repo: Repo, run: CheckRun) => ({
    id: run.id,
    name: run.name,
    head_sha: run.headSha,
    status: run.status,
    conclusion: run.conclusion,
    output: run.output,
    html_url: `${origin}/${repo.fullName}/runs/${run.id}`,
    details_url: run.detailsUrl,
    app: { slug: run.app },
  });

  // REST and GraphQL. Ghost serves GitHub's REST under /api/v3.
  const api = new Hono<{ Variables: { actor: Actor; repo: Repo } }>();
  const notFound = (c: { json: (body: unknown, status: 404) => Response }) => c.json({ message: "Not Found" }, 404);

  api.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    const actor = tokens.get(token) ?? (token.split(".").length === 3 ? ({ kind: "app" } as const) : undefined);
    if (!actor) return c.json({ message: "Bad credentials" }, 401);
    if (actor.kind === "installation" && !installed) return c.json({ message: "Bad credentials" }, 401);
    c.set("actor", actor);
    await next();
  });
  api.use("/repos/:owner/:name/*", async (c, next) => {
    const repo = repos.get(`${c.req.param("owner")}/${c.req.param("name")}`);
    if (!repo) return notFound(c);
    c.set("repo", repo);
    await next();
  });

  api.post("/app/installations/:id/access_tokens", (c) => {
    if (!installed || Number(c.req.param("id")) !== installationId) return notFound(c);
    const token = `ghs_${crypto.randomUUID().replaceAll("-", "")}`;
    tokens.set(token, { kind: "installation", id: installationId });
    return c.json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  });
  api.get("/user", (c) => {
    const actor = c.get("actor");
    return actor.kind === "user" ? c.json({ login: actor.login, id: 1 }) : c.json({ message: "Resource not accessible by integration" }, 403);
  });
  api.get("/user/installations", (c) => c.json({ total_count: installed ? 1 : 0, installations: installed ? [{ id: installationId }] : [] }));
  api.get("/user/installations/:id/repositories", (c) => {
    const login = loginOf(c.get("actor"));
    const covered = [...repos.values()].filter((repo) => repo.installed).map((repo) => repoJson(repo, login));
    return c.json({ total_count: covered.length, repositories: covered });
  });
  api.get("/user/orgs", (c) => c.json([]));
  api.post("/user/repos", async (c) => {
    const { name, private: isPrivate } = await c.req.json<{ name: string; private: boolean }>();
    const login = loginOf(c.get("actor"));
    return c.json(repoJson(createRepo(`${login}/${name}`, { private: isPrivate, admins: [login], installed: false }), login), 201);
  });

  api.get("/repos/:owner/:name", (c) => {
    const repo = repos.get(`${c.req.param("owner")}/${c.req.param("name")}`);
    return repo ? c.json(repoJson(repo, loginOf(c.get("actor")))) : notFound(c);
  });
  api.get("/repos/:owner/:name/installation", (c) => (installed && c.get("repo").installed ? c.json({ id: installationId }) : notFound(c)));
  api.get("/repos/:owner/:name/commits/:sha", (c) => {
    const repo = c.get("repo");
    const found = tryGit(repo.bare, "cat-file", "-e", `${c.req.param("sha")}^{commit}`) !== null;
    if (found) return c.json({ sha: c.req.param("sha") });
    return ghost ? notFound(c) : c.json({ message: `No commit found for SHA: ${c.req.param("sha")}` }, 422);
  });

  // Issues and pull requests share one numbering, as on both hosts.
  api.get("/repos/:owner/:name/issues", (c) => {
    const repo = c.get("repo");
    const since = c.req.query("since");
    const items = [...repo.items.values()].filter((item) => !since || item.updatedAt >= new Date(since));
    return c.json(items.map((item) => itemJson(repo, item)));
  });
  api.get("/repos/:owner/:name/issues/:number{[0-9]+}", (c) => {
    const repo = c.get("repo");
    const item = repo.items.get(Number(c.req.param("number")));
    return item ? c.json(itemJson(repo, item)) : notFound(c);
  });
  api.post("/repos/:owner/:name/issues", async (c) => {
    const repo = c.get("repo");
    const { title, body, labels = [] } = await c.req.json<{ title: string; body?: string; labels?: string[] }>();
    const item = addItem(repo, { title, body: body ?? null, author: loginOf(c.get("actor")), labels, pull: null });
    emitItem(repo, item, "opened", item.author);
    return c.json(itemJson(repo, item), 201);
  });
  api.patch("/repos/:owner/:name/issues/:number{[0-9]+}", async (c) => {
    const repo = c.get("repo");
    const item = repo.items.get(Number(c.req.param("number")));
    if (!item) return notFound(c);
    const patch = await c.req.json<Partial<{ title: string; body: string; state: "open" | "closed"; labels: string[] }>>();
    const actor = loginOf(c.get("actor"));
    const wasState = item.state;
    const labelsChanged = patch.labels !== undefined && patch.labels.join("\n") !== item.labels.join("\n");
    Object.assign(item, { ...patch, updatedAt: new Date() });
    if (patch.state && patch.state !== wasState) emitItem(repo, item, patch.state === "closed" ? "closed" : "reopened", actor);
    else if (labelsChanged) emitItem(repo, item, "labeled", actor);
    else emitItem(repo, item, "edited", actor);
    return c.json(itemJson(repo, item));
  });

  api.get("/repos/:owner/:name/issues/comments/:id{[0-9]+}", (c) => {
    const comment = c.get("repo").comments.find((each) => each.id === Number(c.req.param("id")));
    return comment ? c.json(commentJson(comment)) : notFound(c);
  });
  api.patch("/repos/:owner/:name/issues/comments/:id{[0-9]+}", async (c) => {
    const repo = c.get("repo");
    const comment = repo.comments.find((each) => each.id === Number(c.req.param("id")));
    if (!comment) return notFound(c);
    comment.body = (await c.req.json<{ body: string }>()).body;
    emitComment(repo, comment, "edited", loginOf(c.get("actor")));
    return c.json(commentJson(comment));
  });
  api.delete("/repos/:owner/:name/issues/comments/:id{[0-9]+}", (c) => {
    const repo = c.get("repo");
    const comment = repo.comments.find((each) => each.id === Number(c.req.param("id")));
    if (!comment) return notFound(c);
    repo.comments = repo.comments.filter((each) => each !== comment);
    emitComment(repo, comment, "deleted", loginOf(c.get("actor")));
    return c.body(null, 204);
  });
  api.get("/repos/:owner/:name/issues/:number{[0-9]+}/comments", (c) => {
    const number = Number(c.req.param("number"));
    return c.json(c.get("repo").comments.filter((each) => each.number === number).map(commentJson));
  });
  api.post("/repos/:owner/:name/issues/:number{[0-9]+}/comments", async (c) => {
    const repo = c.get("repo");
    const number = Number(c.req.param("number"));
    if (!repo.items.has(number)) return notFound(c);
    const comment: Comment = { id: ++ids, uuid: crypto.randomUUID(), number, body: (await c.req.json<{ body: string }>()).body, author: loginOf(c.get("actor")), createdAt: new Date().toISOString() };
    repo.comments.push(comment);
    // A new comment counts as activity on its issue, as on both hosts, so `since` lists the issue again.
    repo.items.get(number)!.updatedAt = new Date();
    emitComment(repo, comment, "created", comment.author);
    return c.json(commentJson(comment), 201);
  });

  api.get("/repos/:owner/:name/labels/:label", (c) => {
    const label = c.get("repo").labels.get(decodeURIComponent(c.req.param("label")).toLowerCase());
    return label ? c.json(label) : notFound(c);
  });
  api.post("/repos/:owner/:name/labels", async (c) => {
    const repo = c.get("repo");
    const label = await c.req.json<Label>();
    if (repo.labels.has(label.name.toLowerCase())) return c.json({ message: "Validation Failed" }, 422);
    repo.labels.set(label.name.toLowerCase(), { name: label.name, color: label.color, description: label.description ?? null });
    emitLabel(repo, label.name, "created", loginOf(c.get("actor")));
    return c.json(label, 201);
  });
  api.patch("/repos/:owner/:name/labels/:label", async (c) => {
    const repo = c.get("repo");
    const name = decodeURIComponent(c.req.param("label"));
    const label = repo.labels.get(name.toLowerCase());
    if (!label) return notFound(c);
    const patch = await c.req.json<{ new_name?: string; color?: string; description?: string | null }>();
    repo.labels.delete(name.toLowerCase());
    const next = { name: patch.new_name ?? label.name, color: patch.color ?? label.color, description: patch.description === undefined ? label.description : patch.description };
    repo.labels.set(next.name.toLowerCase(), next);
    for (const item of repo.items.values()) item.labels = item.labels.map((each) => (each.toLowerCase() === name.toLowerCase() ? next.name : each));
    emitLabel(repo, next.name, "edited", loginOf(c.get("actor")), next.name !== name ? name : undefined);
    return c.json(next);
  });
  api.delete("/repos/:owner/:name/labels/:label", (c) => {
    const repo = c.get("repo");
    const name = decodeURIComponent(c.req.param("label"));
    if (!repo.labels.delete(name.toLowerCase())) return notFound(c);
    emitLabel(repo, name, "deleted", loginOf(c.get("actor")));
    return c.body(null, 204);
  });

  api.get("/repos/:owner/:name/pulls", (c) => {
    const repo = c.get("repo");
    const [, headRef] = (c.req.query("head") ?? "").split(":");
    const state = c.req.query("state") ?? "open";
    const pulls = [...repo.items.values()].filter((item) => item.pull && (state === "all" || item.state === state) && (!headRef || item.pull.head.ref === headRef));
    return c.json(pulls.map((item) => pullJson(repo, item)));
  });
  api.get("/repos/:owner/:name/pulls/:number{[0-9]+}", (c) => {
    const repo = c.get("repo");
    const item = repo.items.get(Number(c.req.param("number")));
    return item?.pull ? c.json(pullJson(repo, item)) : notFound(c);
  });
  api.post("/repos/:owner/:name/pulls", async (c) => {
    const repo = c.get("repo");
    const { title, body, head, base, draft = false } = await c.req.json<{ title: string; body: string; head: string; base: string; draft?: boolean }>();
    const headSha = sha(repo, `refs/heads/${head}`);
    const baseSha = sha(repo, `refs/heads/${base}`);
    if (!headSha || !baseSha) return c.json({ message: "Validation Failed", errors: [{ field: headSha ? "base" : "head", code: "invalid" }] }, 422);
    if (tryGit(repo.bare, "merge-base", "--is-ancestor", headSha, baseSha) !== null) return c.json({ message: `No commits between ${base} and ${head}` }, 422);
    const item = addItem(repo, { title, body, author: loginOf(c.get("actor")), labels: [], pull: { head: { ref: head, repoId: repo.id }, base, draft, merged: false } });
    emitItem(repo, item, "opened", item.author);
    return c.json(pullJson(repo, item), 201);
  });
  api.patch("/repos/:owner/:name/pulls/:number{[0-9]+}", async (c) => {
    const repo = c.get("repo");
    const item = repo.items.get(Number(c.req.param("number")));
    if (!item?.pull) return notFound(c);
    const patch = await c.req.json<Partial<{ title: string; body: string; state: "open" | "closed"; base: string }>>();
    const actor = loginOf(c.get("actor"));
    const wasState = item.state;
    if (patch.title !== undefined) item.title = patch.title;
    if (patch.body !== undefined) item.body = patch.body;
    if (patch.base !== undefined) item.pull.base = patch.base;
    if (patch.state !== undefined) item.state = patch.state;
    item.updatedAt = new Date();
    emitItem(repo, item, patch.state && patch.state !== wasState ? (patch.state === "closed" ? "closed" : "reopened") : "edited", actor);
    return c.json(pullJson(repo, item));
  });

  api.get("/repos/:owner/:name/pulls/:number{[0-9]+}/reviews", (c) => {
    const number = Number(c.req.param("number"));
    return c.json(c.get("repo").reviews.filter((each) => each.number === number).map(reviewJson));
  });
  api.get("/repos/:owner/:name/pulls/:number{[0-9]+}/reviews/:id{[0-9]+}", (c) => {
    const review = c.get("repo").reviews.find((each) => each.id === Number(c.req.param("id")));
    return review ? c.json(reviewJson(review)) : notFound(c);
  });
  api.get("/repos/:owner/:name/pulls/:number{[0-9]+}/reviews/:id{[0-9]+}/comments", (c) => {
    const id = Number(c.req.param("id"));
    return c.json(c.get("repo").reviewComments.filter((each) => each.reviewId === id).map(reviewCommentJson));
  });
  api.post("/repos/:owner/:name/pulls/:number{[0-9]+}/reviews", async (c) => {
    const repo = c.get("repo");
    const number = Number(c.req.param("number"));
    const item = repo.items.get(number);
    if (!item?.pull) return notFound(c);
    const request = await c.req.json<{ event: string; body?: string; commit_id?: string; comments?: Partial<ReviewCommentInput>[] }>();
    const author = loginOf(c.get("actor"));
    const state = { APPROVE: "APPROVED", REQUEST_CHANGES: "CHANGES_REQUESTED", COMMENT: "COMMENTED" }[request.event] ?? "COMMENTED";
    const commitId = request.commit_id ?? sha(repo, `refs/heads/${item.pull.head.ref}`) ?? "";
    const review: Review = { id: ++ids, uuid: crypto.randomUUID(), number, state, body: request.body ?? "", author, commitId, submittedAt: new Date().toISOString() };
    repo.reviews.push(review);
    for (const comment of request.comments ?? []) addReviewComment(repo, number, review.id, author, commitId, comment as ReviewCommentInput);
    emit(repo, author, "pull_request.reviewed", "pull_request_review", {
      ghost: { pullRequest: { number }, review: { id: review.uuid, numericId: review.id } },
      github: { action: "submitted", pull_request: { number }, review: { id: review.id } },
    });
    return c.json(reviewJson(review), 200);
  });

  api.get("/repos/:owner/:name/pulls/:number{[0-9]+}/comments", (c) => {
    const number = Number(c.req.param("number"));
    return c.json(c.get("repo").reviewComments.filter((each) => each.number === number).map(reviewCommentJson));
  });
  api.post("/repos/:owner/:name/pulls/:number{[0-9]+}/comments", async (c) => {
    const repo = c.get("repo");
    const number = Number(c.req.param("number"));
    const item = repo.items.get(number);
    if (!item?.pull) return notFound(c);
    const request = await c.req.json<ReviewCommentInput & { in_reply_to?: number }>();
    const author = loginOf(c.get("actor"));
    const parent = request.in_reply_to ? repo.reviewComments.find((each) => each.id === request.in_reply_to) : undefined;
    if (request.in_reply_to && !parent) return notFound(c);
    const commitId = parent?.commitId ?? request.commit_id ?? "";
    const review: Review = { id: ++ids, uuid: crypto.randomUUID(), number, state: "COMMENTED", body: "", author, commitId, submittedAt: new Date().toISOString() };
    repo.reviews.push(review);
    const comment = addReviewComment(repo, number, review.id, author, commitId, parent ? { ...parent, body: request.body, in_reply_to: parent.id } : request);
    return c.json(reviewCommentJson(comment), 201);
  });
  api.get("/repos/:owner/:name/pulls/comments/:id{[0-9]+}", (c) => {
    const comment = c.get("repo").reviewComments.find((each) => each.id === Number(c.req.param("id")));
    return comment ? c.json(reviewCommentJson(comment)) : notFound(c);
  });
  api.patch("/repos/:owner/:name/pulls/comments/:id{[0-9]+}", async (c) => {
    const repo = c.get("repo");
    const comment = repo.reviewComments.find((each) => each.id === Number(c.req.param("id")));
    if (!comment) return notFound(c);
    comment.body = (await c.req.json<{ body: string }>()).body;
    emitReviewComment(repo, comment, "edited", loginOf(c.get("actor")));
    return c.json(reviewCommentJson(comment));
  });
  api.delete("/repos/:owner/:name/pulls/comments/:id{[0-9]+}", (c) => {
    const repo = c.get("repo");
    const comment = repo.reviewComments.find((each) => each.id === Number(c.req.param("id")));
    if (!comment) return notFound(c);
    repo.reviewComments = repo.reviewComments.filter((each) => each !== comment);
    emitReviewComment(repo, comment, "deleted", loginOf(c.get("actor")));
    return c.body(null, 204);
  });

  const hasCommit = (repo: Repo, commit: string) => tryGit(repo.bare, "cat-file", "-e", `${commit}^{commit}`) !== null;
  const statusJson = (status: Status) => ({ id: status.id, context: status.context, state: status.state, description: status.description, target_url: status.targetUrl, creator: { login: status.creator } });
  // Statuses are append-only; both hosts list a commit's newest first.
  api.get("/repos/:owner/:name/commits/:sha/statuses", (c) => {
    const repo = c.get("repo");
    if (!hasCommit(repo, c.req.param("sha"))) return ghost ? notFound(c) : c.json({ message: `No commit found for SHA: ${c.req.param("sha")}` }, 422);
    return c.json(repo.statuses.filter((status) => status.sha === c.req.param("sha")).reverse().map(statusJson));
  });
  api.post("/repos/:owner/:name/statuses/:sha", async (c) => {
    const repo = c.get("repo");
    if (!hasCommit(repo, c.req.param("sha"))) return c.json({ message: `No commit found for SHA: ${c.req.param("sha")}` }, 422);
    const request = await c.req.json<{ state: string; context?: string; description?: string; target_url?: string }>();
    const status = addStatus(repo, { sha: c.req.param("sha"), context: request.context ?? "default", state: request.state, description: request.description ?? null, targetUrl: request.target_url ?? null, creator: loginOf(c.get("actor")) });
    return c.json(statusJson(status), 201);
  });

  api.get("/repos/:owner/:name/check-runs/:id{[0-9]+}", (c) => {
    const repo = c.get("repo");
    const run = repo.checkRuns.find((each) => each.id === Number(c.req.param("id")));
    return run ? c.json(checkRunJson(repo, run)) : notFound(c);
  });
  api.get("/repos/:owner/:name/commits/:sha/check-runs", (c) => {
    const repo = c.get("repo");
    const name = c.req.query("check_name");
    const runs = repo.checkRuns.filter((run) => run.headSha === c.req.param("sha") && (!name || run.name === name)).map((run) => checkRunJson(repo, run));
    return c.json({ total_count: runs.length, check_runs: runs });
  });
  api.post("/repos/:owner/:name/check-runs", async (c) => {
    const repo = c.get("repo");
    const request = await c.req.json<{ name: string; head_sha: string; status?: string; conclusion?: string; output?: CheckRun["output"]; details_url?: string }>();
    const app = loginOf(c.get("actor")) === bot ? slug : "ci-app";
    const run: CheckRun = { id: ++ids, uuid: crypto.randomUUID(), name: request.name, headSha: request.head_sha, status: request.status ?? "queued", conclusion: request.conclusion ?? null, output: request.output ?? { title: null, summary: null }, detailsUrl: request.details_url ?? null, app };
    repo.checkRuns.push(run);
    emitCheckRun(repo, run, "created", loginOf(c.get("actor")));
    return c.json(checkRunJson(repo, run), 201);
  });
  api.patch("/repos/:owner/:name/check-runs/:id{[0-9]+}", async (c) => {
    const repo = c.get("repo");
    const run = repo.checkRuns.find((each) => each.id === Number(c.req.param("id")));
    if (!run) return notFound(c);
    const patch = await c.req.json<Partial<{ status: string; conclusion: string; output: CheckRun["output"]; details_url: string; name: string }>>();
    if (patch.status) run.status = patch.status;
    if (patch.conclusion) run.conclusion = patch.conclusion;
    if (patch.output) run.output = patch.output;
    if (patch.name) run.name = patch.name;
    emitCheckRun(repo, run, run.status === "completed" ? "completed" : "created", loginOf(c.get("actor")));
    return c.json(checkRunJson(repo, run));
  });

  api.post("/graphql", async (c) => {
    const { query, variables } = await c.req.json<{ query: string; variables: { id: string } }>();
    const actor = c.get("actor");
    const found = findByNodeId(variables.id);
    if (!found) return c.json({ data: null, errors: [{ message: "Could not resolve to a node" }] });
    const { repo, item } = found;
    if (query.includes("deleteIssue")) {
      if (settings.refuseDeleteIssue && actor.kind !== "user") return c.json({ data: null, errors: [{ message: "Resource not accessible by integration" }] });
      repo.items.delete(item.number);
      emitItem(repo, item, "deleted", loginOf(actor));
      return c.json({ data: { deleteIssue: { clientMutationId: null } } });
    }
    if (query.includes("markPullRequestReadyForReview") || query.includes("convertPullRequestToDraft")) {
      if (!item.pull) return c.json({ data: null, errors: [{ message: "Not a pull request" }] });
      item.pull.draft = query.includes("convertPullRequestToDraft");
      emitItem(repo, item, item.pull.draft ? "converted_to_draft" : "ready_for_review", loginOf(actor));
      return c.json({ data: {} });
    }
    return c.json({ data: null, errors: [{ message: "Unknown mutation" }] });
  });

  type ReviewCommentInput = { path: string; line: number | null; side: string | null; start_line?: number | null; start_side?: string | null; body: string; commit_id?: string; in_reply_to?: number };
  function addReviewComment(repo: Repo, number: number, reviewId: number, author: string, commitId: string, input: ReviewCommentInput) {
    const comment: ReviewComment = {
      id: ++ids,
      uuid: crypto.randomUUID(),
      number,
      reviewId,
      path: input.path,
      line: input.line ?? null,
      side: input.side ?? null,
      startLine: input.start_line ?? null,
      startSide: input.start_side ?? null,
      body: input.body,
      author,
      commitId,
      inReplyTo: input.in_reply_to ?? null,
      createdAt: new Date().toISOString(),
    };
    repo.reviewComments.push(comment);
    emitReviewComment(repo, comment, "created", author);
    return comment;
  }

  function addItem(repo: Repo, fields: Pick<Item, "title" | "body" | "author" | "labels" | "pull">) {
    const item: Item = { number: repo.nextNumber++, uuid: crypto.randomUUID(), state: "open", updatedAt: new Date(), ...fields };
    repo.items.set(item.number, item);
    return item;
  }

  function findByNodeId(id: string) {
    for (const repo of repos.values()) for (const item of repo.items.values()) if (nodeId(item.pull ? "PR" : "I", item) === id) return { repo, item };
    return null;
  }

  function emitComment(repo: Repo, comment: Comment, verb: "created" | "edited" | "deleted", actor: string) {
    const item = repo.items.get(comment.number);
    const ghostVerb = { created: "commented", edited: "comment_edited", deleted: "comment_deleted" }[verb];
    emit(repo, actor, `issue.${ghostVerb}`, "issue_comment", {
      ghost: { ...(item ? threadOf(item) : { issue: { number: comment.number } }), comment: { id: comment.uuid, numericId: comment.id } },
      github: { action: verb, issue: { number: comment.number }, comment: { id: comment.id } },
    });
  }

  function emitReviewComment(repo: Repo, comment: ReviewComment, verb: "created" | "edited" | "deleted", actor: string) {
    // Ghost has no event for a deleted line comment; reconcile notices.
    if (ghost && verb === "deleted") return;
    emit(repo, actor, "pull_request.review_commented", "pull_request_review_comment", {
      ghost: { pullRequest: { number: comment.number }, comment: { id: comment.uuid, numericId: comment.id } },
      github: { action: verb, pull_request: { number: comment.number }, comment: { id: comment.id } },
    });
  }

  function emitLabel(repo: Repo, name: string, verb: "created" | "edited" | "deleted", actor: string, previousName?: string) {
    emit(repo, actor, `label.${verb}`, "label", {
      ghost: { label: { name } },
      github: { action: verb, label: { name }, ...(previousName ? { changes: { name: { from: previousName } } } : {}) },
    });
  }

  function addStatus(repo: Repo, fields: Omit<Status, "id" | "uuid">) {
    const status: Status = { id: ++ids, uuid: crypto.randomUUID(), ...fields };
    repo.statuses.push(status);
    const body = { sha: status.sha, context: status.context, state: status.state, description: status.description, target_url: status.targetUrl };
    emit(repo, status.creator, "commit_status.created", "status", { ghost: { status: { id: status.uuid, ...body } }, github: body });
    return status;
  }

  function emitCheckRun(repo: Repo, run: CheckRun, verb: "created" | "completed", actor: string) {
    emit(repo, actor, `check_run.${verb}`, "check_run", {
      ghost: { checkRun: { id: run.uuid, numericId: run.id, app: { slug: run.app } } },
      github: { action: verb, check_run: { id: run.id } },
    });
  }

  function createRepo(fullName: string, options: { private?: boolean; admins?: string[]; installed?: boolean } = {}) {
    const [owner = "", name = ""] = fullName.split("/");
    const bare = join(opts.root, side, owner, `${name}.git`);
    mkdirSync(join(opts.root, side, owner), { recursive: true });
    git(opts.root, "init", "--bare", "--quiet", "--initial-branch=main", bare);
    git(bare, "config", "receive.denyDeleteCurrent", "ignore");
    const repo: Repo = {
      id: ++ids,
      uuid: crypto.randomUUID(),
      owner,
      name,
      fullName,
      private: options.private ?? true,
      bare,
      admins: new Set(options.admins ?? []),
      installed: options.installed ?? true,
      nextNumber: 1,
      items: new Map(),
      labels: new Map(),
      comments: [],
      reviews: [],
      reviewComments: [],
      checkRuns: [],
      statuses: [],
    };
    repos.set(fullName, repo);
    return repo;
  }

  const repoOf = (fullName: string) => {
    const repo = repos.get(fullName);
    if (!repo) throw new Error(`No repository ${fullName} on ${side}`);
    return repo;
  };

  return {
    side,
    origin,
    repos,
    settings,
    createRepo,
    repo: repoOf,
    /** Handles a request Ghost Sync sent to this host. */
    fetch: (request: Request) => {
      const url = new URL(request.url);
      const path = ghost ? url.pathname.replace(/^\/api\/v3/, "").replace(/^\/api\/graphql$/, "/graphql") : url.pathname;
      return api.fetch(new Request(`http://host${path}${url.search}`, request));
    },
    /** A user token for `login`, as a signed-in person's would be. */
    userToken(login: string) {
      const token = `ghu_${login}`;
      tokens.set(token, { kind: "user", login });
      return token;
    },
    /** A REST client acting as `login`, for writes a person makes on this host. */
    as(login: string): Rest {
      const token = this.userToken(login);
      const host = this;
      return createRest({
        baseUrl: ghost ? `${origin}/api/v3` : origin,
        graphqlUrl: ghost ? `${origin}/api/graphql` : `${origin}/graphql`,
        token: async () => token,
        fetch: ((input: string, init?: RequestInit) => host.fetch(new Request(input, init))) as unknown as typeof globalThis.fetch,
        sleep: async () => {},
      });
    },
    /** A person commits on `branch` (from `from`, or the branch's tip) and pushes it, as `git push` would. Returns the new sha. */
    push(fullName: string, branch: string, message: string, options: { from?: string; parents?: string[]; author?: string } = {}) {
      const repo = repoOf(fullName);
      const before = sha(repo, `refs/heads/${branch}`) ?? "0".repeat(40);
      const parents = options.parents ?? [options.from ?? (before.startsWith("0000") ? null : before)].filter((each): each is string => each !== null);
      const tree = git(repo.bare, "hash-object", "-w", "-t", "tree", "/dev/null");
      const commit = Bun.spawnSync(["git", "commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", `${message} ${crypto.randomUUID()}`], { cwd: repo.bare, env: GIT_ENV }).stdout.toString().trim();
      git(repo.bare, "update-ref", `refs/heads/${branch}`, commit);
      for (const item of repo.items.values()) if (item.pull && item.state === "open" && item.pull.head.ref === branch && item.pull.head.repoId === repo.id) emitItem(repo, item, "synchronized", options.author ?? "someone");
      emit(repo, options.author ?? "someone", "push", "push", { ghost: { ref: `refs/heads/${branch}`, before, after: commit }, github: { ref: `refs/heads/${branch}`, before, after: commit } });
      return commit;
    },
    /** A pull request from a fork: its head lives only at `refs/pull/<n>/head`. */
    openForkPull(fullName: string, author: string, title: string, base: string) {
      const repo = repoOf(fullName);
      const tree = git(repo.bare, "hash-object", "-w", "-t", "tree", "/dev/null");
      const baseSha = sha(repo, `refs/heads/${base}`);
      const commit = Bun.spawnSync(["git", "commit-tree", tree, ...(baseSha ? ["-p", baseSha] : []), "-m", `fork ${crypto.randomUUID()}`], { cwd: repo.bare, env: GIT_ENV }).stdout.toString().trim();
      const item = addItem(repo, { title, body: "from a fork", author, labels: [], pull: { head: { ref: "feature", repoId: 99_999 }, base, draft: false, merged: false } });
      git(repo.bare, "update-ref", `refs/pull/${item.number}/head`, commit);
      emitItem(repo, item, "opened", author);
      return { number: item.number, sha: commit };
    },
    /** Merges a pull request as the host would: the base moves to the head, the pull request closes as merged. */
    merge(fullName: string, number: number, by: string) {
      const repo = repoOf(fullName);
      const item = repo.items.get(number);
      if (!item?.pull) throw new Error(`No pull request #${number}`);
      const head = sha(repo, `refs/heads/${item.pull.head.ref}`) as string;
      const before = sha(repo, `refs/heads/${item.pull.base}`) as string;
      git(repo.bare, "update-ref", `refs/heads/${item.pull.base}`, head);
      Object.assign(item, { state: "closed", updatedAt: new Date() });
      item.pull.merged = true;
      emitItem(repo, item, "merged", by);
      emit(repo, by, "push", "push", { ghost: { ref: `refs/heads/${item.pull.base}`, before, after: head }, github: { ref: `refs/heads/${item.pull.base}`, before, after: head } });
    },
    /** A person runs a CI app's check on `sha`. */
    /** A status reported by `creator`, such as a deploy service, as if it called the API. */
    addStatus(fullName: string, status: { sha: string; context: string; state: string; description?: string; targetUrl?: string; creator: string }) {
      return addStatus(repoOf(fullName), { description: null, targetUrl: null, ...status });
    },
    addCheckRun(fullName: string, run: { name: string; headSha: string; status: string; conclusion: string | null; app: string }) {
      const repo = repoOf(fullName);
      const created: CheckRun = { id: ++ids, uuid: crypto.randomUUID(), output: { title: "CI", summary: `${run.name} ${run.conclusion ?? run.status}` }, detailsUrl: null, ...run };
      repo.checkRuns.push(created);
      emitCheckRun(repo, created, created.status === "completed" ? "completed" : "created", "ci-app[bot]");
      return created;
    },
    sha: (fullName: string, ref: string) => sha(repoOf(fullName), ref),
    /** Ghost asks the app for its checks on a pushed commit. */
    requestCheckSuite(fullName: string, headSha: string) {
      emit(repoOf(fullName), "someone", "check_suite.requested", "check_suite", { ghost: { checkSuite: { headSha } }, github: { action: "requested", check_suite: { head_sha: headSha } } });
    },
    /** Copies objects from another repository in, so a person here can build on commits made there. */
    fetchFrom(fullName: string, otherBare: string) {
      git(repoOf(fullName).bare, "fetch", "--quiet", otherBare, "+refs/heads/*:refs/remotes/other/*");
    },
    /** The app is uninstalled, or installed again; sends the matching installation event. */
    setInstalled(value: boolean) {
      installed = value;
      emit(null, "owner", value ? "installation.unsuspended" : "installation.deleted", "installation", { ghost: {}, github: { action: value ? "created" : "deleted" } });
    },
    /** Webhooks not yet delivered, oldest first; taking them empties the outbox. */
    takeDeliveries() {
      return pending.splice(0);
    },
  };
}

export type FakeHost = ReturnType<typeof createFakeHost>;
