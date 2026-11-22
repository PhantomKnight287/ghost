import type { SyncAction } from "../sync/action.ts";
import type { HandlerResult } from "./result.ts";

type Thread = { number: number };
type GhostPayload = {
  repository?: { id: string };
  sender?: { username: string | null } | null;
  installation?: { id: number };
  repositories?: { id: string }[];
  ref?: string;
  issue?: Thread;
  pullRequest?: Thread;
  comment?: { id: string };
  review?: { id: string };
  label?: { name: string };
  checkRun?: { numericId: number };
  checkSuite?: { headSha: string };
};

const PULL_EVENTS = new Set(["opened", "edited", "closed", "merged", "reopened", "ready_for_review", "converted_to_draft", "synchronized"]);
const ISSUE_EVENTS = new Set(["opened", "edited", "closed", "reopened", "labeled", "unlabeled", "deleted"]);
const INSTALLATION_STATUS = { created: "active", deleted: "deleted", suspended: "suspended", unsuspended: "active" } as const;

/** The action a Ghost event asks for, or null when Ghost Sync does not copy it. */
function actionOf(event: string, body: GhostPayload): SyncAction | null {
  const [family, verb = ""] = event.split(".");
  const thread = body.issue ?? body.pullRequest;
  switch (family) {
    case "push":
      return body.ref ? { kind: "refs", refs: [body.ref] } : null;
    case "pull_request":
      if (!body.pullRequest) return null;
      if (verb === "reviewed" && body.review) return { kind: "review", from: "ghost", pullNumber: body.pullRequest.number, key: body.review.id };
      if (verb === "review_commented" && body.comment) return { kind: "review_comment", from: "ghost", pullNumber: body.pullRequest.number, key: body.comment.id, deleted: false };
      return PULL_EVENTS.has(verb) ? { kind: "pull", from: "ghost", number: body.pullRequest.number } : null;
    case "issue":
      if (!thread) return null;
      if (["commented", "comment_edited", "comment_deleted"].includes(verb) && body.comment) {
        return { kind: "comment", from: "ghost", issueNumber: thread.number, key: body.comment.id, deleted: verb === "comment_deleted" };
      }
      if (!ISSUE_EVENTS.has(verb)) return null;
      // Labels on a pull request arrive as issue events; the pull request's own sync carries them.
      if (body.pullRequest) return verb === "deleted" ? null : { kind: "pull", from: "ghost", number: body.pullRequest.number };
      return { kind: "issue", from: "ghost", number: thread.number, deleted: verb === "deleted" };
    case "label":
      return body.label && ["created", "edited", "deleted"].includes(verb) ? { kind: "label", from: "ghost", name: body.label.name, deleted: verb === "deleted" } : null;
    case "check_run":
      if (verb === "rerequested") return { kind: "reconcile" };
      return body.checkRun && (verb === "created" || verb === "completed") ? { kind: "check_run", from: "ghost", id: String(body.checkRun.numericId) } : null;
    case "check_suite":
      if (verb === "rerequested") return { kind: "reconcile" };
      return verb === "requested" && body.checkSuite ? { kind: "sync_check", sha: body.checkSuite.headSha } : null;
    default:
      return null;
  }
}

export function handleGhost(event: string, payload: unknown): HandlerResult {
  const body = payload as GhostPayload;
  if (event.startsWith("installation.")) {
    if (!body.installation) return null;
    const verb = event.slice("installation.".length);
    const installationId = body.installation.id;
    if (verb === "repositories_added") return { kind: "installation", side: "ghost", installationId, added: (body.repositories ?? []).map((r) => r.id) };
    if (verb === "repositories_removed") return { kind: "installation", side: "ghost", installationId, removed: (body.repositories ?? []).map((r) => r.id) };
    const status = INSTALLATION_STATUS[verb as keyof typeof INSTALLATION_STATUS];
    return status ? { kind: "installation", side: "ghost", installationId, status } : null;
  }
  const action = actionOf(event, body);
  if (!action || !body.repository) return null;
  return { kind: "job", repoId: body.repository.id, actor: body.sender?.username ?? null, action };
}
