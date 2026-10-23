import type { RepositoryNode } from '../../github/graphql/types/repository.type.js';
import type {
  CombinedCommitStatusDTO,
  CommitStatusDTO,
} from '../../resources/commit-statuses/dto/commit-status.dto.js';
import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import type { RequestedReviewers } from '../../resources/pull-requests/review-requests.service.js';
import type {
  ReleaseAssetDTO,
  ReleaseDTO,
} from '../../resources/releases/dto/release.dto.js';
import { GithubValidationError } from './github.errors.js';
import { encodeNodeId } from './node-id.js';
import type { ReleaseAssetExtras } from './node-lookup.js';
import type { GithubOrigins } from './origins.js';

export type RestUserSource = {
  ghostId: string;
  numericId: number;
  login: string;
  avatarUrl: string | null;
};

// Mapper: GitHub's simple-user is the same few columns plus URL templates typed SDKs expect, whichever query found the user.
export function toUserRest(
  user: RestUserSource,
  { api, web }: GithubOrigins,
  type: 'User' | 'Organization' = 'User',
) {
  const url = `${api}/api/v3/users/${user.login}`;
  return {
    login: user.login,
    id: user.numericId,
    node_id: encodeNodeId(type, user.ghostId),
    avatar_url: user.avatarUrl ?? '',
    gravatar_id: '',
    url,
    html_url: `${web}/${user.login}`,
    followers_url: `${url}/followers`,
    following_url: `${url}/following{/other_user}`,
    gists_url: `${url}/gists{/gist_id}`,
    starred_url: `${url}/starred{/owner}{/repo}`,
    subscriptions_url: `${url}/subscriptions`,
    organizations_url: `${url}/orgs`,
    repos_url: `${url}/repos`,
    events_url: `${url}/events{/privacy}`,
    received_events_url: `${url}/received_events`,
    type,
    site_admin: false,
  };
}

export type RestUser = ReturnType<typeof toUserRest>;

// Mapper: the repository node GraphQL already built, with its permission, in GitHub's REST shape.
export function toRepositoryRest(
  node: RepositoryNode,
  { api, web }: GithubOrigins,
) {
  return {
    id: node.databaseId,
    node_id: node.id,
    name: node.name,
    full_name: node.nameWithOwner,
    private: node.isPrivate,
    visibility: node.isPrivate ? 'private' : 'public',
    owner: { login: node.ownerLogin, html_url: `${web}/${node.ownerLogin}` },
    html_url: node.url,
    description: node.description,
    fork: node.isFork,
    url: `${api}/api/v3/repos/${node.nameWithOwner}`,
    clone_url: `${api}/${node.nameWithOwner}.git`,
    ssh_url: node.sshUrl,
    default_branch: node.defaultBranch ?? 'main',
    created_at: node.createdAt.toISOString(),
    updated_at: node.updatedAt.toISOString(),
    pushed_at: node.pushedAt?.toISOString() ?? null,
    has_issues: node.hasIssuesEnabled,
    permissions: node.viewerPermission && {
      admin: node.viewerPermission === 'ADMIN',
      maintain: ['ADMIN', 'MAINTAIN'].includes(node.viewerPermission),
      push: ['ADMIN', 'MAINTAIN', 'WRITE'].includes(node.viewerPermission),
      triage: node.viewerPermission !== 'READ',
      pull: true,
    },
  };
}

/** What every issue, comment and label response links to: the repository's API URL and its page in the web app. */
export type RestRepository = {
  ownerLogin: string;
  apiUrl: string;
  webUrl: string;
};

/** The ids and users an issue, comment or label response embeds, loaded once per response. */
export type RestContext = {
  repository: RestRepository;
  users: Map<string, RestUser>;
  labelIds: Map<string, number>;
};

// Mapper: labels come from IssuesService in Ghost's shape; GitHub's adds the numeric id and URLs.
export function toLabelRest(label: LabelDTO, context: RestContext) {
  return {
    id: context.labelIds.get(label.id) ?? null,
    node_id: encodeNodeId('Label', label.id),
    url: `${context.repository.apiUrl}/labels/${encodeURIComponent(label.name)}`,
    name: label.name,
    color: label.color,
    description: label.description,
    default: false,
    archived_at: null,
    archived_by: null,
  };
}

/** The issue columns IssueDTO leaves out: its numeric id, and for a pull request whether it is a draft and when it merged. */
export type IssueExtras = {
  numericId: number;
  draft: boolean | null;
  mergedAt: Date | null;
};

export function authorAssociation(login: string, context: RestContext) {
  // ponytail: OWNER or NONE only, as in GraphQL; MEMBER and COLLABORATOR need a role lookup per author.
  return login === context.repository.ownerLogin ? 'OWNER' : 'NONE';
}

// Mapper: IssuesService expands authors, labels and assignees for Ghost's API; GitHub's shape embeds full users and labels and adds URLs.
export function toIssueRest(
  issue: IssueDTO,
  extras: IssueExtras,
  context: RestContext,
) {
  const { apiUrl, webUrl } = context.repository;
  const url = `${apiUrl}/issues/${issue.number}`;
  const htmlUrl = `${webUrl}/${issue.isPullRequest ? 'pull' : 'issues'}/${issue.number}`;
  const user = (login: string | null) =>
    (login && context.users.get(login)) || null;
  const assignees = issue.assignees.flatMap((login) => user(login) ?? []);
  const closed = issue.state === 'closed';
  return {
    id: extras.numericId,
    node_id: encodeNodeId(
      issue.isPullRequest ? 'PullRequest' : 'Issue',
      issue.id,
    ),
    url,
    repository_url: apiUrl,
    labels_url: `${url}/labels{/name}`,
    comments_url: `${url}/comments`,
    events_url: `${url}/events`,
    timeline_url: `${url}/timeline`,
    html_url: htmlUrl,
    number: issue.number,
    state: issue.state,
    // ponytail: Ghost records no close reason; every close reads as completed until it does.
    state_reason: closed ? 'completed' : null,
    title: issue.title,
    body: issue.body,
    user: user(issue.authorUsername),
    labels: issue.labels.map((label) => toLabelRest(label, context)),
    assignee: assignees[0] ?? null,
    assignees,
    milestone: null,
    locked: false,
    active_lock_reason: null,
    comments: issue.commentCount,
    closed_at: issue.closedAt,
    closed_by: user(issue.closedByUsername),
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    author_association: authorAssociation(issue.authorUsername, context),
    ...(issue.isPullRequest && {
      draft: extras.draft ?? false,
      pull_request: {
        url: `${apiUrl}/pulls/${issue.number}`,
        html_url: htmlUrl,
        diff_url: `${htmlUrl}.diff`,
        patch_url: `${htmlUrl}.patch`,
        merged_at: extras.mergedAt?.toISOString() ?? null,
      },
    }),
  };
}

export type RestCommentSource = {
  id: string;
  numericId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
  issueNumber: number;
  isPullRequest: boolean;
};

// Mapper: comments come from IssuesService in Ghost's shape; GitHub's embeds the author and adds URLs.
export function toCommentRest(
  comment: RestCommentSource,
  context: RestContext,
) {
  const { apiUrl, webUrl } = context.repository;
  const path = comment.isPullRequest ? 'pull' : 'issues';
  return {
    id: comment.numericId,
    node_id: encodeNodeId('IssueComment', comment.id),
    url: `${apiUrl}/issues/comments/${comment.numericId}`,
    // The web app anchors comments by Ghost's id, so the link opens on the comment.
    html_url: `${webUrl}/${path}/${comment.issueNumber}#issuecomment-${comment.id}`,
    issue_url: `${apiUrl}/issues/${comment.issueNumber}`,
    body: comment.body,
    user: context.users.get(comment.authorUsername) ?? null,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    author_association: authorAssociation(comment.authorUsername, context),
  };
}

export type Page = { page: number; perPage: number; offset: number };

/** One page of a REST list and how many items the whole list holds; GithubRestInterceptor answers `items` and links the other pages. */
export class RestPage<T> {
  constructor(
    readonly items: T[],
    readonly page: Page,
    readonly total: number,
  ) {}
}

function positiveInteger(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** GitHub's `page` and `per_page`: 1 and 30 when missing or not a positive integer, `per_page` capped at 100. */
export function pageOf(query: { page?: unknown; per_page?: unknown }): Page {
  const page = positiveInteger(query.page) ?? 1;
  const perPage = Math.min(positiveInteger(query.per_page) ?? 30, 100);
  return { page, perPage, offset: (page - 1) * perPage };
}

/** GitHub's `Link` header for a numbered page of `total` items, or null when everything fits on one page. */
export function linkHeader(url: URL, { page, perPage }: Page, total: number) {
  const last = Math.max(1, Math.ceil(total / perPage));
  const link = (to: number, rel: string) => {
    const target = new URL(url);
    target.searchParams.set('page', String(to));
    target.searchParams.set('per_page', String(perPage));
    return `<${target}>; rel="${rel}"`;
  };
  const links = [
    ...(page > 1 ? [link(page - 1, 'prev')] : []),
    ...(page < last ? [link(page + 1, 'next'), link(last, 'last')] : []),
    ...(page > 1 ? [link(1, 'first')] : []),
  ];
  return links.length > 0 ? links.join(', ') : null;
}

function labelName(value: unknown) {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  )
    return value.name;
  return null;
}

/** The label names in any body shape GitHub accepts for an issue's labels: `{ labels }` or a bare array, of names or `{ name }`. */
export function labelNamesOf(body: unknown) {
  const list =
    typeof body === 'object' && body !== null && 'labels' in body
      ? body.labels
      : body;
  const names = Array.isArray(list) ? list.map(labelName) : null;
  if (!names || names.some((name) => name === null))
    throw new GithubValidationError([
      { resource: 'Label', field: 'labels', code: 'invalid' },
    ]);
  return names as string[];
}

export type RestRepositoryObject = ReturnType<typeof toRepositoryRest>;

/** What a pull request response adds to its issue: the pull_request row, its head as it stands, and both sides' repositories, null once deleted or unreadable. */
export type PullRestSource = {
  numericId: number;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  baseSha: string | null;
  mergeCommitSha: string | null;
  mergedAt: Date | null;
  base: RestRepositoryObject;
  head: RestRepositoryObject | null;
  reviewers: RequestedReviewers;
};

/** The figures only a single pull request's response carries, from PullRequestsService.getPullRequest. */
export type PullRestDetail = {
  mergeable: boolean | null;
  conflicted: boolean;
  /** Mergeable, but held back by ruleset requirements. */
  blocked: boolean;
  commits: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewComments: number;
};

// Mapper: the issue fields come from IssuesService as for toIssueRest; GitHub's pull request adds the two branches, merge state and its own URLs.
export function toPullRest(
  issue: IssueDTO,
  pull: PullRestSource,
  context: RestContext,
  detail?: PullRestDetail,
) {
  const { apiUrl, webUrl } = context.repository;
  const url = `${apiUrl}/pulls/${issue.number}`;
  const issueUrl = `${apiUrl}/issues/${issue.number}`;
  const htmlUrl = `${webUrl}/pull/${issue.number}`;
  const user = (login: string | null) =>
    (login && context.users.get(login)) || null;
  const assignees = issue.assignees.flatMap((login) => user(login) ?? []);
  const side = (
    ref: string,
    sha: string | null,
    repository: RestRepositoryObject | null,
  ) => ({
    label: repository ? `${repository.owner.login}:${ref}` : ref,
    ref,
    sha,
    // ponytail: an organization owner is not in context.users and reads as null.
    user: repository ? user(repository.owner.login) : null,
    repo: repository,
  });
  const merged = pull.state === 'merged';
  return {
    url,
    id: pull.numericId,
    node_id: encodeNodeId('PullRequest', issue.id),
    html_url: htmlUrl,
    diff_url: `${htmlUrl}.diff`,
    patch_url: `${htmlUrl}.patch`,
    issue_url: issueUrl,
    commits_url: `${url}/commits`,
    review_comments_url: `${url}/comments`,
    review_comment_url: `${apiUrl}/pulls/comments{/number}`,
    comments_url: `${issueUrl}/comments`,
    statuses_url: `${apiUrl}/statuses/${pull.headSha}`,
    number: issue.number,
    state: issue.state,
    locked: false,
    title: issue.title,
    user: user(issue.authorUsername),
    body: issue.body,
    labels: issue.labels.map((label) => toLabelRest(label, context)),
    milestone: null,
    active_lock_reason: null,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.closedAt,
    merged_at: pull.mergedAt?.toISOString() ?? null,
    merge_commit_sha: pull.mergeCommitSha,
    assignee: assignees[0] ?? null,
    assignees,
    requested_reviewers: pull.reviewers.users.flatMap(
      (reviewer) => user(reviewer.username) ?? [],
    ),
    // ponytail: teams carry no numeric id, as Ghost keeps none for them.
    requested_teams: pull.reviewers.teams.map((team) => ({
      node_id: encodeNodeId('Team', team.id),
      name: team.name,
      slug: team.slug,
      description: null,
      privacy: 'closed',
      permission: 'pull',
      parent: null,
    })),
    head: side(pull.headRef, pull.headSha, pull.head),
    base: side(pull.baseRef, pull.baseSha, pull.base),
    _links: {
      self: { href: url },
      html: { href: htmlUrl },
      issue: { href: issueUrl },
      comments: { href: `${issueUrl}/comments` },
      review_comments: { href: `${url}/comments` },
      review_comment: { href: `${apiUrl}/pulls/comments{/number}` },
      commits: { href: `${url}/commits` },
      statuses: { href: `${apiUrl}/statuses/${pull.headSha}` },
    },
    author_association: authorAssociation(issue.authorUsername, context),
    auto_merge: null,
    draft: pull.draft,
    ...(detail && {
      merged,
      mergeable: detail.mergeable,
      rebaseable: detail.mergeable,
      mergeable_state: pull.draft
        ? 'draft'
        : detail.conflicted
          ? 'dirty'
          : detail.blocked
            ? 'blocked'
            : detail.mergeable
              ? 'clean'
              : 'unknown',
      merged_by: merged ? user(issue.closedByUsername) : null,
      comments: issue.commentCount,
      review_comments: detail.reviewComments,
      maintainer_can_modify: false,
      commits: detail.commits,
      additions: detail.additions,
      deletions: detail.deletions,
      changed_files: detail.changedFiles,
    }),
  };
}

/** A review as GitHub's REST `pull-request-review`, from reviewsOf; a pending one has no state yet. */
export type RestReviewSource = {
  id: string;
  numericId: number;
  authorLogin: string;
  state: 'commented' | 'approved' | 'changes_requested' | null;
  body: string | null;
  commitSha: string;
  dismissed: boolean;
  submittedAt: Date | null;
};

// Mapper: reviews come from reviewsOf in Ghost's shape; GitHub's embeds the author and links the pull request.
export function toReviewRest(
  review: RestReviewSource,
  number: number,
  context: RestContext,
) {
  const { apiUrl, webUrl } = context.repository;
  const htmlUrl = `${webUrl}/pull/${number}#pullrequestreview-${review.id}`;
  const pullUrl = `${apiUrl}/pulls/${number}`;
  return {
    id: review.numericId,
    node_id: encodeNodeId('PullRequestReview', review.id),
    user: context.users.get(review.authorLogin) ?? null,
    body: review.body ?? '',
    state: review.dismissed
      ? 'DISMISSED'
      : (review.state ?? 'pending').toUpperCase(),
    html_url: htmlUrl,
    pull_request_url: pullUrl,
    author_association: authorAssociation(review.authorLogin, context),
    _links: { html: { href: htmlUrl }, pull_request: { href: pullUrl } },
    submitted_at: review.submittedAt?.toISOString() ?? null,
    commit_id: review.commitSha,
  };
}

/** A tag as a path, each segment escaped and its slashes kept, as the web app's release routes take it. */
export const tagPath = (tagName: string) =>
  tagName.split('/').map(encodeURIComponent).join('/');

// Mapper: assets come from ReleasesService in Ghost's shape; GitHub's adds the integer id, label, uploader and URLs, which releaseAssetExtrasOf loads.
export function toReleaseAssetRest(
  asset: ReleaseAssetDTO,
  extras: ReleaseAssetExtras,
  tagName: string,
  context: RestContext,
) {
  return {
    url: `${context.repository.apiUrl}/releases/assets/${extras.numericId}`,
    browser_download_url: `${context.repository.webUrl}/releases/download/${tagPath(tagName)}/${encodeURIComponent(asset.name)}`,
    id: extras.numericId,
    node_id: encodeNodeId('ReleaseAsset', asset.id),
    name: asset.name,
    label: extras.label,
    // Assets still uploading are never listed.
    state: 'uploaded',
    content_type: asset.contentType,
    size: asset.size,
    digest: null,
    download_count: asset.downloadCount,
    created_at: asset.createdAt,
    updated_at: extras.updatedAt,
    uploader:
      (extras.uploaderLogin && context.users.get(extras.uploaderLogin)) || null,
  };
}

export type RestReleaseAsset = ReturnType<typeof toReleaseAssetRest>;

// Mapper: releases come from ReleasesService in Ghost's shape; GitHub's embeds the author and adds the integer id and URLs.
export function toReleaseRest(
  release: ReleaseDTO,
  numericId: number,
  assets: RestReleaseAsset[],
  { uploadUrl, defaultBranch }: { uploadUrl: string; defaultBranch: string },
  context: RestContext,
) {
  const url = `${context.repository.apiUrl}/releases/${numericId}`;
  return {
    url,
    html_url: `${context.repository.webUrl}/releases/tag/${tagPath(release.tagName)}`,
    assets_url: `${url}/assets`,
    upload_url: `${uploadUrl}/releases/${numericId}/assets{?name,label}`,
    tarball_url: `${context.repository.apiUrl}/tarball/${encodeURIComponent(release.tagName)}`,
    zipball_url: `${context.repository.apiUrl}/zipball/${encodeURIComponent(release.tagName)}`,
    id: numericId,
    node_id: encodeNodeId('Release', release.id),
    tag_name: release.tagName,
    // Ghost keeps the commit the tag points at, not the branch it was cut from; a deleted tag reads as the default branch, GitHub's default target.
    target_commitish: release.commitSha ?? defaultBranch,
    name: release.name,
    body: release.body,
    draft: release.isDraft,
    prerelease: release.isPrerelease,
    immutable: false,
    created_at: release.createdAt,
    published_at: release.publishedAt,
    updated_at: release.updatedAt,
    author:
      (release.authorUsername && context.users.get(release.authorUsername)) ||
      null,
    assets,
  };
}

// Mapper: statuses come from CommitStatusesService in Ghost's shape; GitHub's embeds the creator and adds the integer id and URLs.
export function toStatusRest(
  status: CommitStatusDTO,
  numericId: number,
  sha: string,
  context: RestContext,
) {
  const creator =
    (status.creator && context.users.get(status.creator.username)) || null;
  return {
    url: `${context.repository.apiUrl}/statuses/${sha}`,
    avatar_url: creator?.avatar_url ?? '',
    id: numericId,
    node_id: encodeNodeId('StatusContext', status.id),
    state: status.state,
    description: status.description,
    target_url: status.targetUrl,
    context: status.context,
    created_at: status.createdAt,
    // Statuses are never edited, each report is a new one.
    updated_at: status.createdAt,
    creator,
  };
}

export type RestStatus = ReturnType<typeof toStatusRest>;

// Mapper: the combined status comes from CommitStatusesService in Ghost's shape; GitHub's embeds the repository and adds URLs.
export function toCombinedStatusRest(
  combined: CombinedCommitStatusDTO,
  statuses: RestStatus[],
  repository: RestRepositoryObject,
  context: RestContext,
) {
  const commitUrl = `${context.repository.apiUrl}/commits/${combined.sha}`;
  return {
    state: combined.state,
    statuses,
    sha: combined.sha,
    total_count: combined.totalCount,
    repository,
    commit_url: commitUrl,
    url: `${commitUrl}/status`,
  };
}
