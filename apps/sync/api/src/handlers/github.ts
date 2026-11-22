import type { SyncAction } from "../sync/action.ts";
import type { HandlerResult } from "./result.ts";

type GitHubPayload = {
  action?: string;
  repository?: { id: number };
  sender?: { login: string } | null;
  installation?: { id: number };
  repositories_added?: { id: number }[];
  repositories_removed?: { id: number }[];
  ref?: string;
  ref_type?: "branch" | "tag" | "repository";
  number?: number;
  pull_request?: { number: number };
  issue?: { number: number };
  comment?: { id: number };
  review?: { id: number };
  label?: { name: string };
  changes?: { name?: { from: string } };
  check_run?: { id: number };
};

const PULL_ACTIONS = new Set(["opened", "edited", "closed", "reopened", "synchronize", "ready_for_review", "converted_to_draft", "labeled", "unlabeled"]);
const ISSUE_ACTIONS = new Set(["opened", "edited", "closed", "reopened", "labeled", "unlabeled", "deleted"]);
const INSTALLATION_STATUS = { created: "active", deleted: "deleted", suspend: "suspended", unsuspend: "active" } as const;

/** The action a GitHub event asks for, or null when Ghost Sync does not copy it. */
function actionOf(event: string, body: GitHubPayload): SyncAction | null {
  const verb = body.action ?? "";
  switch (event) {
    case "push":
      return body.ref ? { kind: "refs", refs: [body.ref] } : null;
    case "create":
    case "delete":
      if (body.ref_type === "branch") return { kind: "refs", refs: [`refs/heads/${body.ref}`] };
      return body.ref_type === "tag" ? { kind: "refs", refs: [`refs/tags/${body.ref}`] } : null;
    case "pull_request":
      return body.number !== undefined && PULL_ACTIONS.has(verb) ? { kind: "pull", from: "github", number: body.number } : null;
    case "pull_request_review":
      return verb === "submitted" && body.pull_request && body.review ? { kind: "review", from: "github", pullNumber: body.pull_request.number, key: String(body.review.id) } : null;
    case "pull_request_review_comment":
      return body.pull_request && body.comment && ["created", "edited", "deleted"].includes(verb)
        ? { kind: "review_comment", from: "github", pullNumber: body.pull_request.number, key: String(body.comment.id), deleted: verb === "deleted" }
        : null;
    case "issues":
      return body.issue && ISSUE_ACTIONS.has(verb) ? { kind: "issue", from: "github", number: body.issue.number, deleted: verb === "deleted" } : null;
    case "issue_comment":
      return body.issue && body.comment && ["created", "edited", "deleted"].includes(verb)
        ? { kind: "comment", from: "github", issueNumber: body.issue.number, key: String(body.comment.id), deleted: verb === "deleted" }
        : null;
    case "label": {
      if (!body.label || !["created", "edited", "deleted"].includes(verb)) return null;
      const action: SyncAction = { kind: "label", from: "github", name: body.label.name, deleted: verb === "deleted" };
      return body.changes?.name ? { ...action, previousName: body.changes.name.from } : action;
    }
    case "check_run":
      return body.check_run && (verb === "created" || verb === "completed") ? { kind: "check_run", from: "github", id: String(body.check_run.id) } : null;
    default:
      return null;
  }
}

export function handleGitHub(event: string, payload: unknown): HandlerResult {
  const body = payload as GitHubPayload;
  if (event === "installation" || event === "installation_repositories") {
    if (!body.installation) return null;
    const installationId = body.installation.id;
    if (event === "installation_repositories") {
      if (body.action === "added") return { kind: "installation", side: "github", installationId, added: (body.repositories_added ?? []).map((r) => String(r.id)) };
      if (body.action === "removed") return { kind: "installation", side: "github", installationId, removed: (body.repositories_removed ?? []).map((r) => String(r.id)) };
      return null;
    }
    const status = INSTALLATION_STATUS[body.action as keyof typeof INSTALLATION_STATUS];
    return status ? { kind: "installation", side: "github", installationId, status } : null;
  }
  const action = actionOf(event, body);
  if (!action || !body.repository) return null;
  return { kind: "job", repoId: String(body.repository.id), actor: body.sender?.login ?? null, action };
}
