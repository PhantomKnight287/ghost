import { describe, expect, test } from "bun:test";
import { handleGhost } from "./ghost.ts";
import { handleGitHub } from "./github.ts";

const ghost = (event: string, extra: Record<string, unknown> = {}) => ({ event, repository: { id: "ghost-repo-uuid", fullName: "acme/app" }, sender: { id: "u1", username: "bob" }, ...extra });
const github = (action: string | undefined, extra: Record<string, unknown> = {}) => ({ action, repository: { id: 4242, full_name: "acme-gh/app" }, sender: { login: "alice" }, ...extra });
const job = (repoId: string, actor: string, action: unknown) => ({ kind: "job", repoId, actor, action });
const g = (action: unknown) => job("ghost-repo-uuid", "bob", action);
const h = (action: unknown) => job("4242", "alice", action);

describe("Ghost events", () => {
  const cases: [string, Record<string, unknown>, unknown][] = [
    ["push", ghost("push", { ref: "refs/heads/main", before: "a", after: "b" }), g({ kind: "refs", refs: ["refs/heads/main"] })],
    ["pull_request.opened", ghost("pull_request.opened", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.edited", ghost("pull_request.edited", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.closed", ghost("pull_request.closed", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.merged", ghost("pull_request.merged", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.reopened", ghost("pull_request.reopened", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.ready_for_review", ghost("pull_request.ready_for_review", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.converted_to_draft", ghost("pull_request.converted_to_draft", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.synchronized", ghost("pull_request.synchronized", { pullRequest: { number: 3 } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["pull_request.reviewed", ghost("pull_request.reviewed", { pullRequest: { number: 3 }, review: { id: "rev-uuid", numericId: 900 } }), g({ kind: "review", from: "ghost", pullNumber: 3, key: "rev-uuid" })],
    ["pull_request.review_commented", ghost("pull_request.review_commented", { pullRequest: { number: 3 }, comment: { id: "c-uuid", numericId: 601 } }), g({ kind: "review_comment", from: "ghost", pullNumber: 3, key: "c-uuid", deleted: false })],
    ["issue.opened", ghost("issue.opened", { issue: { number: 12 } }), g({ kind: "issue", from: "ghost", number: 12, deleted: false })],
    ["issue.edited", ghost("issue.edited", { issue: { number: 12 } }), g({ kind: "issue", from: "ghost", number: 12, deleted: false })],
    ["issue.closed", ghost("issue.closed", { issue: { number: 12 } }), g({ kind: "issue", from: "ghost", number: 12, deleted: false })],
    ["issue.reopened", ghost("issue.reopened", { issue: { number: 12 } }), g({ kind: "issue", from: "ghost", number: 12, deleted: false })],
    ["issue.deleted", ghost("issue.deleted", { issue: { number: 12 } }), g({ kind: "issue", from: "ghost", number: 12, deleted: true })],
    ["issue.labeled on an issue", ghost("issue.labeled", { issue: { number: 12 }, label: { name: "bug" } }), g({ kind: "issue", from: "ghost", number: 12, deleted: false })],
    ["issue.unlabeled on a pull request", ghost("issue.unlabeled", { pullRequest: { number: 3 }, label: { name: "bug" } }), g({ kind: "pull", from: "ghost", number: 3 })],
    ["issue.commented", ghost("issue.commented", { issue: { number: 12 }, comment: { id: "c-uuid" } }), g({ kind: "comment", from: "ghost", issueNumber: 12, key: "c-uuid", deleted: false })],
    ["issue.commented on a pull request", ghost("issue.commented", { pullRequest: { number: 3 }, comment: { id: "c-uuid" } }), g({ kind: "comment", from: "ghost", issueNumber: 3, key: "c-uuid", deleted: false })],
    ["issue.comment_edited", ghost("issue.comment_edited", { issue: { number: 12 }, comment: { id: "c-uuid" } }), g({ kind: "comment", from: "ghost", issueNumber: 12, key: "c-uuid", deleted: false })],
    ["issue.comment_deleted", ghost("issue.comment_deleted", { issue: { number: 12 }, comment: { id: "c-uuid" } }), g({ kind: "comment", from: "ghost", issueNumber: 12, key: "c-uuid", deleted: true })],
    ["label.created", ghost("label.created", { label: { name: "bug" } }), g({ kind: "label", from: "ghost", name: "bug", deleted: false })],
    ["label.edited", ghost("label.edited", { label: { name: "bug" } }), g({ kind: "label", from: "ghost", name: "bug", deleted: false })],
    ["label.deleted", ghost("label.deleted", { label: { name: "bug" } }), g({ kind: "label", from: "ghost", name: "bug", deleted: true })],
    ["check_run.completed", ghost("check_run.completed", { checkRun: { id: "cr-uuid", numericId: 55, app: { slug: "ghost-ci" } } }), g({ kind: "check_run", from: "ghost", id: "55" })],
    ["check_suite.requested", ghost("check_suite.requested", { checkSuite: { headSha: "h1" } }), g({ kind: "sync_check", sha: "h1" })],
    ["check_run.rerequested", ghost("check_run.rerequested", { checkRun: { numericId: 77 } }), g({ kind: "reconcile" })],
    ["check_suite.rerequested", ghost("check_suite.rerequested", { checkSuite: { headSha: "h1" } }), g({ kind: "reconcile" })],
  ];
  test.each(cases)("%s", (_, payload, expected) => {
    expect(handleGhost(String(payload.event), payload)).toEqual(expected as never);
  });

  test("a sender-less event has a null actor", () => {
    expect(handleGhost("push", { ...ghost("push", { ref: "refs/heads/main" }), sender: null })).toMatchObject({ actor: null });
  });

  test("events Ghost Sync does not copy", () => {
    for (const event of ["issue.assigned", "issue.unassigned", "pull_request.review_requested", "release.created", "star.created", "ping"]) {
      expect(handleGhost(event, ghost(event, { issue: { number: 1 } }))).toBeNull();
    }
  });

  test("installation events", () => {
    const base = { installation: { id: 11, account: { login: "acme", type: "organization" } }, sender: null };
    expect(handleGhost("installation.deleted", { event: "installation.deleted", ...base })).toEqual({ kind: "installation", side: "ghost", installationId: 11, status: "deleted" });
    expect(handleGhost("installation.suspended", { event: "installation.suspended", ...base })).toEqual({ kind: "installation", side: "ghost", installationId: 11, status: "suspended" });
    expect(handleGhost("installation.unsuspended", { event: "installation.unsuspended", ...base })).toEqual({ kind: "installation", side: "ghost", installationId: 11, status: "active" });
    expect(handleGhost("installation.repositories_removed", { event: "installation.repositories_removed", ...base, repositories: [{ id: "ghost-repo-uuid", fullName: "acme/app" }] })).toEqual({ kind: "installation", side: "ghost", installationId: 11, removed: ["ghost-repo-uuid"] });
    expect(handleGhost("installation.repositories_added", { event: "installation.repositories_added", ...base, repositories: [{ id: "ghost-repo-uuid", fullName: "acme/app" }] })).toEqual({ kind: "installation", side: "ghost", installationId: 11, added: ["ghost-repo-uuid"] });
  });
});

describe("GitHub events", () => {
  const cases: [string, string, Record<string, unknown>, unknown][] = [
    ["push", "push", github(undefined, { ref: "refs/heads/main" }), h({ kind: "refs", refs: ["refs/heads/main"] })],
    ["create branch", "create", github(undefined, { ref: "feat", ref_type: "branch" }), h({ kind: "refs", refs: ["refs/heads/feat"] })],
    ["delete tag", "delete", github(undefined, { ref: "v1", ref_type: "tag" }), h({ kind: "refs", refs: ["refs/tags/v1"] })],
    ["pull_request opened", "pull_request", github("opened", { number: 8 }), h({ kind: "pull", from: "github", number: 8 })],
    ["pull_request synchronize", "pull_request", github("synchronize", { number: 8 }), h({ kind: "pull", from: "github", number: 8 })],
    ["pull_request labeled", "pull_request", github("labeled", { number: 8 }), h({ kind: "pull", from: "github", number: 8 })],
    ["pull_request_review submitted", "pull_request_review", github("submitted", { pull_request: { number: 8 }, review: { id: 77 } }), h({ kind: "review", from: "github", pullNumber: 8, key: "77" })],
    ["pull_request_review_comment created", "pull_request_review_comment", github("created", { pull_request: { number: 8 }, comment: { id: 501 } }), h({ kind: "review_comment", from: "github", pullNumber: 8, key: "501", deleted: false })],
    ["pull_request_review_comment edited", "pull_request_review_comment", github("edited", { pull_request: { number: 8 }, comment: { id: 501 } }), h({ kind: "review_comment", from: "github", pullNumber: 8, key: "501", deleted: false })],
    ["pull_request_review_comment deleted", "pull_request_review_comment", github("deleted", { pull_request: { number: 8 }, comment: { id: 501 } }), h({ kind: "review_comment", from: "github", pullNumber: 8, key: "501", deleted: true })],
    ["issues opened", "issues", github("opened", { issue: { number: 5 } }), h({ kind: "issue", from: "github", number: 5, deleted: false })],
    ["issues labeled", "issues", github("labeled", { issue: { number: 5 } }), h({ kind: "issue", from: "github", number: 5, deleted: false })],
    ["issues deleted", "issues", github("deleted", { issue: { number: 5 } }), h({ kind: "issue", from: "github", number: 5, deleted: true })],
    ["issue_comment created", "issue_comment", github("created", { issue: { number: 5 }, comment: { id: 9001 } }), h({ kind: "comment", from: "github", issueNumber: 5, key: "9001", deleted: false })],
    ["issue_comment deleted", "issue_comment", github("deleted", { issue: { number: 5 }, comment: { id: 9001 } }), h({ kind: "comment", from: "github", issueNumber: 5, key: "9001", deleted: true })],
    ["label edited", "label", github("edited", { label: { name: "bug" } }), h({ kind: "label", from: "github", name: "bug", deleted: false })],
    ["label deleted", "label", github("deleted", { label: { name: "bug" } }), h({ kind: "label", from: "github", name: "bug", deleted: true })],
    ["check_run completed", "check_run", github("completed", { check_run: { id: 1001 } }), h({ kind: "check_run", from: "github", id: "1001" })],
  ];
  test.each(cases)("%s", (_, event, payload, expected) => {
    expect(handleGitHub(event, payload)).toEqual(expected as never);
  });

  test("a renamed label carries its old name", () => {
    expect(handleGitHub("label", github("edited", { label: { name: "defect" }, changes: { name: { from: "bug" } } }))).toEqual(h({ kind: "label", from: "github", name: "defect", deleted: false, previousName: "bug" }) as never);
  });

  test("branches and tags created or deleted on GitHub, but not repositories", () => {
    expect(handleGitHub("create", github(undefined, { ref: "main", ref_type: "repository" }))).toBeNull();
  });

  test("events Ghost Sync does not copy", () => {
    expect(handleGitHub("pull_request", github("assigned", { number: 8 }))).toBeNull();
    expect(handleGitHub("pull_request_review", github("dismissed", { pull_request: { number: 8 }, review: { id: 77 } }))).toBeNull();
    expect(handleGitHub("issues", github("assigned", { issue: { number: 5 } }))).toBeNull();
    expect(handleGitHub("star", github("created"))).toBeNull();
    expect(handleGitHub("ping", { zen: "hi" })).toBeNull();
  });

  test("installation events", () => {
    const installation = { installation: { id: 22 }, sender: { login: "alice" } };
    expect(handleGitHub("installation", { action: "deleted", ...installation })).toEqual({ kind: "installation", side: "github", installationId: 22, status: "deleted" });
    expect(handleGitHub("installation", { action: "suspend", ...installation })).toEqual({ kind: "installation", side: "github", installationId: 22, status: "suspended" });
    expect(handleGitHub("installation", { action: "unsuspend", ...installation })).toEqual({ kind: "installation", side: "github", installationId: 22, status: "active" });
    expect(handleGitHub("installation_repositories", { action: "removed", ...installation, repositories_removed: [{ id: 4242 }], repositories_added: [] })).toEqual({ kind: "installation", side: "github", installationId: 22, removed: ["4242"] });
    expect(handleGitHub("installation_repositories", { action: "added", ...installation, repositories_added: [{ id: 4242 }], repositories_removed: [] })).toEqual({ kind: "installation", side: "github", installationId: 22, added: ["4242"] });
  });
});
