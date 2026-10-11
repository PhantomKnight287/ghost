import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import { GithubValidationError } from './github.errors.js';
import { encodeNodeId } from './node-id.js';
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

function authorAssociation(login: string, context: RestContext) {
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
