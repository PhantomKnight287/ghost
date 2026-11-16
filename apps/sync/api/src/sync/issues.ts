import { readMarker, withMarker } from "../format.ts";
import { RestError } from "../rest.ts";
import { other, SIDE_NAME, type Side } from "../side.ts";
import type { SyncContext } from "./context.ts";
import { createOnce, isNotFound, skipped } from "./write.ts";

type Label = { name: string; color: string; description: string | null };
type Issue = {
  number: number;
  node_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string };
  labels: Label[];
  pull_request?: unknown;
};

const path = (ctx: SyncContext, side: Side, rest = "") => `/repos/${ctx.repo[side].owner}/${ctx.repo[side].name}${rest}`;
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

async function ensureLabel(ctx: SyncContext, to: Side, label: Label) {
  try {
    await ctx.rest[to].request("GET", labelPath(ctx, to, label.name));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await ctx.rest[to].request("POST", path(ctx, to, "/labels"), { name: label.name, color: label.color, description: label.description });
  }
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

  for (const label of source.labels) await ensureLabel(ctx, to, label);
  const fields = { title: source.title, body: copiedBody(ctx, from, source.user.login, source.body), labels: source.labels.map((l) => l.name) };

  if (link) {
    const counterpart = Number(to === "ghost" ? link.ghostId : link.githubId);
    await ctx.rest[to].request("PATCH", path(ctx, to, `/issues/${counterpart}`), { ...fields, state: source.state });
    return counterpart;
  }

  const created = await createOnce<{ number: number }>(ctx, to, path(ctx, to, "/issues"), fields, async () => {
    const recent = await ctx.rest[to].request<Issue[]>("GET", path(ctx, to, `/issues?creator=${encodeURIComponent(ctx.bot[to])}&state=all&sort=created&direction=desc&per_page=30`));
    return recent.find((issue) => issue.user.login === ctx.bot[to] && issue.title === fields.title && issue.body === fields.body);
  });
  const ids = from === "ghost" ? { ghostId: String(number), githubId: String(created.number) } : { ghostId: String(created.number), githubId: String(number) };
  await ctx.store.saveLink({ syncId: ctx.sync.id, kind: "issue", ghostRestId: null, ...ids });
  if (source.state === "closed") await ctx.rest[to].request("PATCH", path(ctx, to, `/issues/${created.number}`), { state: "closed" });
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
    return;
  }
  if (!target) {
    await ctx.rest[to].request("POST", path(ctx, to, "/labels"), { name, color: source.color, description: source.description });
    return;
  }
  if (target.color !== source.color || target.description !== source.description) {
    await ctx.rest[to].request("PATCH", labelPath(ctx, to, name), { color: source.color, description: source.description });
  }
}

export async function deleteLabelDefinition(ctx: SyncContext, from: Side, name: string) {
  try {
    await ctx.rest[other(from)].request("DELETE", labelPath(ctx, other(from), name));
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
