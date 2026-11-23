import { readMarker, withMarker } from "../format.ts";
import { RestError } from "../rest.ts";
import { other, SIDE_NAME, type Side } from "../side.ts";
import { repoPath, type SyncContext } from "./context.ts";
import { describeChanges, isNewer, mergeFields, pairedFields } from "./fields.ts";
import { createOnce, done, isNotFound, skipped } from "./write.ts";

export type Label = { name: string; color: string; description: string | null };
type Issue = {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string };
  labels: Label[];
  pull_request?: unknown;
  updated_at?: string;
};

/** The fields an issue's copy follows, with the body as the person wrote it, whichever side holds the marked copy. */
const issueFields = (issue: Issue) => ({ title: issue.title, body: readMarker(issue.body ?? "").body, state: issue.state, labels: issue.labels.map((l) => l.name).sort() });

const path = (ctx: SyncContext, side: Side, rest = "") => `${repoPath(ctx, side)}${rest}`;
const labelPath = (ctx: SyncContext, side: Side, name: string) => path(ctx, side, `/labels/${encodeURIComponent(name)}`);

/** `<type prefix>_<base64url UUID>`, as Ghost's REST layer spells `node_id`, back to the UUID its webhooks carry. */
export function ghostKeyOfNodeId(nodeId: string) {
  return Buffer.from(nodeId.slice(nodeId.indexOf("_") + 1), "base64url").toString("utf8");
}

/** The body as it should read on the other side: attributed to its author, or, for an edit made on our own copy, the person's text alone. */
export function copiedBody(ctx: SyncContext, from: Side, author: string, body: string | null) {
  const text = readMarker(body ?? "").body;
  return author === ctx.bot[from] ? text : withMarker(text, from, author);
}

export async function ensureLabel(ctx: SyncContext, to: Side, label: Label) {
  try {
    await ctx.rest[to].request("GET", labelPath(ctx, to, label.name));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await ctx.rest[to].request("POST", path(ctx, to, "/labels"), { name: label.name, color: label.color, description: label.description });
    await done(ctx, to, "label", `Created label ${label.name}`);
  }
}

/** Each run lists a side's issues once; a reconcile asks for twins of every issue it visits. */
const issueLists = new WeakMap<object, Promise<Issue[]>>();

/**
 * The issue on `side` a person opened by hand as the twin of one on the other side, as people did before Ghost Sync: the only unlinked issue with that exact title that Ghost Sync did not write. Two or more such issues are no twin, so the issue is copied instead.
 */
async function findTwinIssue(ctx: SyncContext, side: Side, title: string) {
  let listed = issueLists.get(ctx.rest[side]);
  if (!listed) {
    listed = (async () => {
      const issues: Issue[] = [];
      try {
        for await (const issue of ctx.rest[side].paginate<Issue>(path(ctx, side, "/issues?state=all"))) issues.push(issue);
      } catch (error) {
        // A repository that cannot be listed has no twins to find; the create that follows reports the real problem.
        if (!isNotFound(error)) throw error;
      }
      return issues;
    })();
    issueLists.set(ctx.rest[side], listed);
    // A failed listing is not kept, so the next issue in the run asks again.
    listed.catch(() => issueLists.delete(ctx.rest[side]));
  }
  const isTwin = (issue: Issue) => !issue.pull_request && issue.user.login !== ctx.bot[side] && issue.title === title;
  const unlinked = [];
  for (const issue of (await listed).filter(isTwin)) if (!(await ctx.store.findLink(ctx.sync.id, "issue", side, String(issue.number)))) unlinked.push(issue);
  const [found] = unlinked;
  if (unlinked.length !== 1 || !found) return undefined;
  // The list is as old as this run; the pair's agreed state must be the twin as it is now, and it must still be a twin.
  let current: Issue;
  try {
    current = await ctx.rest[side].request<Issue>("GET", path(ctx, side, `/issues/${found.number}`));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return undefined;
  }
  return isTwin(current) ? current : undefined;
}

/**
 * Brings issue `number` on `from` into agreement on the other side and returns the counterpart's number, or null when nothing was copied: the source is gone, is a pull request not yet linked, or is our own copy with no original.
 */
export async function syncIssue(ctx: SyncContext, from: Side, number: number): Promise<number | null> {
  const to = other(from);
  let source: Issue;
  try {
    source = await ctx.rest[from].request<Issue>("GET", path(ctx, from, `/issues/${number}`));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "issue", `${SIDE_NAME[from]} issue #${number} is gone`, error);
    return null;
  }

  const link = await ctx.store.findLink(ctx.sync.id, "issue", from, String(number));
  // Pull requests are created by `syncPull`, which knows their branches.
  if (!link && (source.pull_request || source.user.login === ctx.bot[from])) return null;
  if (!link) {
    const twin = await findTwinIssue(ctx, to, source.title);
    if (twin) {
      const ids = from === "ghost" ? { ghostId: String(number), githubId: String(twin.number) } : { ghostId: String(twin.number), githubId: String(number) };
      await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostRestId: null, ...ids, synced: pairedFields(from === "ghost" ? { ghost: issueFields(source), github: issueFields(twin) } : { ghost: issueFields(twin), github: issueFields(source) }), pairedAt: new Date() });
      await done(ctx, to, "issue", `Paired ${SIDE_NAME[from]} issue #${number} with its twin, ${SIDE_NAME[to]} issue #${twin.number}`);
      return twin.number;
    }
  }

  for (const label of source.labels) await ensureLabel(ctx, to, label);
  const fields = { title: source.title, body: copiedBody(ctx, from, source.user.login, source.body), labels: source.labels.map((l) => l.name) };

  if (link) {
    const counterpart = Number(to === "ghost" ? link.ghostId : link.githubId);
    const targetPath = path(ctx, to, `/issues/${counterpart}`);
    let target: Issue;
    try {
      target = await ctx.rest[to].request<Issue>("GET", targetPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await skipped(ctx, to, "issue", `${SIDE_NAME[to]} issue #${counterpart}, the copy of ${SIDE_NAME[from]} issue #${number}, is gone`, error);
      return counterpart;
    }
    const { write, agreed } = mergeFields(from, issueFields(source), issueFields(target), link.synced, isNewer(source, target));
    if (Object.keys(write).length > 0) {
      await ctx.rest[to].request("PATCH", targetPath, "body" in write ? { ...write, body: fields.body } : write);
      for (const summary of describeChanges(write, `${SIDE_NAME[to]} issue #${counterpart}`)) await done(ctx, to, "issue", summary);
    }
    await ctx.store.saveLink({ ...link, synced: agreed });
    return counterpart;
  }

  const created = await createOnce<{ number: number }>(ctx, to, path(ctx, to, "/issues"), fields, async () => {
    const recent = await ctx.rest[to].request<Issue[]>("GET", path(ctx, to, `/issues?creator=${encodeURIComponent(ctx.bot[to])}&state=all&sort=created&direction=desc&per_page=30`));
    return recent.find((issue) => issue.user.login === ctx.bot[to] && issue.title === fields.title && issue.body === fields.body);
  });
  const ids = from === "ghost" ? { ghostId: String(number), githubId: String(created.number) } : { ghostId: String(created.number), githubId: String(number) };
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostRestId: null, ...ids, synced: issueFields(source) });
  await done(ctx, to, "issue", `Copied ${SIDE_NAME[from]} issue #${number} as #${created.number}`);
  if (source.state === "closed") {
    await ctx.rest[to].request("PATCH", path(ctx, to, `/issues/${created.number}`), { state: "closed" });
    await done(ctx, to, "issue", `Closed ${SIDE_NAME[to]} issue #${created.number}`);
  }
  return created.number;
}

/** Deletes the counterpart of a deleted issue. A host that refuses (deleting needs admin) gets the copy closed with a note instead. */
export async function deleteIssue(ctx: SyncContext, from: Side, number: number) {
  const link = await ctx.store.findLink(ctx.sync.id, "issue", from, String(number));
  if (!link) return;
  const to = other(from);
  const counterpart = to === "ghost" ? link.ghostId : link.githubId;

  let nodeId: string;
  try {
    nodeId = (await ctx.rest[to].request<Issue>("GET", path(ctx, to, `/issues/${counterpart}`))).node_id;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await ctx.store.deleteLink(ctx.sync.id, "issue", from, String(number));
    return;
  }

  try {
    await ctx.rest[to].graphql("mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }", { id: nodeId });
    await done(ctx, to, "issue", `Deleted ${SIDE_NAME[to]} issue #${counterpart}, as ${SIDE_NAME[from]} issue #${number} was`);
  } catch (error) {
    // GraphQL refusals arrive as a 200 with errors; a missing permission as 403.
    if (!(error instanceof RestError) || ![200, 401, 403].includes(error.status)) throw error;
    await ctx.rest[to].request("POST", path(ctx, to, `/issues/${counterpart}/comments`), { body: `Deleted on ${SIDE_NAME[from]}` });
    await ctx.rest[to].request("PATCH", path(ctx, to, `/issues/${counterpart}`), { state: "closed" });
    await skipped(ctx, to, "issue", `Could not delete ${SIDE_NAME[to]} issue #${counterpart}; closed it instead`, error);
  }
  await ctx.store.deleteLink(ctx.sync.id, "issue", from, String(number));
}

/**
 * Copies label `name`'s colour and description. With `previousName` (a rename, which GitHub reports), the counterpart is renamed rather than a second label created.
 */
export async function syncLabelDefinition(ctx: SyncContext, from: Side, name: string, previousName?: string) {
  const to = other(from);
  let source: Label;
  try {
    source = await ctx.rest[from].request<Label>("GET", labelPath(ctx, from, name));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await skipped(ctx, to, "label", `${SIDE_NAME[from]} label ${name} is gone`, error);
    return;
  }

  const current = async (label: string) => {
    try {
      return await ctx.rest[to].request<Label>("GET", labelPath(ctx, to, label));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };

  const target = await current(name);
  const renamed = !target && previousName !== undefined && previousName !== name ? await current(previousName) : null;
  if (renamed && previousName !== undefined) {
    await ctx.rest[to].request("PATCH", labelPath(ctx, to, previousName), { new_name: name, color: source.color, description: source.description });
    await done(ctx, to, "label", `Renamed label ${previousName} to ${name}`);
    return;
  }
  if (!target) {
    await ctx.rest[to].request("POST", path(ctx, to, "/labels"), { name, color: source.color, description: source.description });
    await done(ctx, to, "label", `Created label ${name}`);
    return;
  }
  if (target.color !== source.color || target.description !== source.description) {
    await ctx.rest[to].request("PATCH", labelPath(ctx, to, name), { color: source.color, description: source.description });
    await done(ctx, to, "label", `Updated the colour or description of label ${name}`);
  }
}

export async function deleteLabelDefinition(ctx: SyncContext, from: Side, name: string) {
  try {
    await ctx.rest[other(from)].request("DELETE", labelPath(ctx, other(from), name));
    await done(ctx, other(from), "label", `Deleted label ${name}`);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
