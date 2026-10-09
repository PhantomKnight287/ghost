import type { schema } from '@ghost/db';

import { OrganizationNode } from '../../github/graphql/types/organization.type.js';
import { UserNode } from '../../github/graphql/types/user.type.js';
import { encodeNodeId } from './node-id.js';
import type { GithubOrigins } from './origins.js';

import type { AuthorizedRepository } from '../repositories/access/repository-access.js';
import { RepositoryNode } from '../../github/graphql/types/repository.type.js';
import {
  CommentAuthorAssociation,
  IssueState,
  IssueStateReason,
  PullRequestState,
  RepositoryPermission,
  RepositoryVisibility,
} from '../../github/graphql/enums.js';
import { repositoryPermissionOf } from './permission.js';
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import { LabelNode } from '../../github/graphql/types/label.type.js';
import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';
import { IssueNode } from '../../github/graphql/types/issue.type.js';
import { PullRequestNode } from '../../github/graphql/types/pull-request.type.js';
import type { IssueOrPullRequestFields } from '../../github/graphql/types/issue-or-pull-request.type.js';
import { IssueCommentNode } from '../../github/graphql/types/issue-comment.type.js';

export type UserRow = typeof schema.user.$inferSelect;
export type OrganizationRow = typeof schema.organization.$inferSelect;

// Mapper: loaders hand back whole rows shared by several GraphQL types, so the GitHub shape cannot be selected in the query.
export function toUserNode(row: UserRow, { web }: GithubOrigins) {
  const login = row.username ?? '';
  return Object.assign(new UserNode(), {
    ghostId: row.id,
    id: encodeNodeId('User', row.id),
    login,
    name: row.name,
    avatarUrl: row.image ?? '',
    resourcePath: `/${login}`,
    url: `${web}/${login}`,
    databaseId: null,
    createdAt: row.createdAt,
  });
}

// Mapper: same reason as toUserNode.
export function toOrganizationNode(
  row: OrganizationRow,
  { web }: GithubOrigins,
) {
  return Object.assign(new OrganizationNode(), {
    ghostId: row.id,
    id: encodeNodeId('Organization', row.id),
    login: row.slug,
    name: row.name,
    avatarUrl: row.logo ?? '',
    resourcePath: `/${row.slug}`,
    url: `${web}/${row.slug}`,
    databaseId: null,
  });
}

// Mapper: the access service returns the row the permission check already loaded; re-querying it in GitHub's shape would read it twice.
export function toRepositoryNode(
  row: AuthorizedRepository,
  ownerLogin: string,
  { web, sshHost }: GithubOrigins,
) {
  const permission = repositoryPermissionOf(row.viewerRole);
  return Object.assign(new RepositoryNode(), {
    ghostId: row.id,
    ownerGhostId: row.ownerId,
    organizationGhostId: row.organizationId,
    parentGhostId: row.parentRepositoryId,
    ownerLogin,
    slug: row.slug,
    defaultBranch: row.defaultBranch,
    viewerRole: row.viewerRole,
    id: encodeNodeId('Repository', row.id),
    databaseId: null,
    name: row.slug,
    nameWithOwner: `${ownerLogin}/${row.slug}`,
    description: row.description,
    isPrivate: row.visibility === 'private',
    isFork: row.parentRepositoryId !== null,
    isArchived: false,
    isEmpty: false,
    visibility:
      row.visibility === 'private'
        ? RepositoryVisibility.PRIVATE
        : RepositoryVisibility.PUBLIC,
    hasIssuesEnabled: true,
    hasWikiEnabled: false,
    hasProjectsEnabled: false,
    // ponytail: Ghost allows every merge method on every repository; read per-repository settings here once they exist.
    mergeCommitAllowed: true,
    rebaseMergeAllowed: true,
    squashMergeAllowed: true,
    sshUrl: sshHost ? `ssh://git@${sshHost}/${ownerLogin}/${row.slug}.git` : '',
    url: `${web}/${ownerLogin}/${row.slug}`,
    resourcePath: `/${ownerLogin}/${row.slug}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pushedAt: row.lastPushedAt,
    viewerPermission: permission ? RepositoryPermission[permission] : null,
  });
}

// Mapper: labels arrive from IssuesService already selected for Ghost's API; selecting them again in GitHub's shape would double the query.
export function toLabelNode(label: LabelDTO, repository: { url: string; resourcePath: string }) {
  const path = `/labels/${encodeURIComponent(label.name)}`;
  return Object.assign(new LabelNode(), {
    ghostId: label.id,
    id: encodeNodeId('Label', label.id),
    name: label.name,
    color: label.color,
    description: label.description,
    isDefault: false,
    url: `${repository.url}${path}`,
    resourcePath: `${repository.resourcePath}${path}`,
    createdAt: new Date(label.createdAt),
    updatedAt: new Date(label.updatedAt),
  });
}

type RepositoryRefs = Pick<RepositoryNode, 'ghostId' | 'ownerLogin' | 'slug' | 'url' | 'resourcePath'>;

/** What toIssueNode and toPullRequestNode share; `path` is `issues` or `pull`, as GitHub's URLs have it. */
function issueOrPullRequestFields(issue: IssueDTO, repository: RepositoryRefs, path: 'issues' | 'pull') {
  return {
    ghostId: issue.id,
    ownerLogin: repository.ownerLogin,
    repoSlug: repository.slug,
    repositoryGhostId: repository.ghostId,
    authorLogin: issue.authorUsername,
    assigneeLogins: issue.assignees,
    labelDtos: issue.labels,
    repositoryUrl: repository.url,
    repositoryResourcePath: repository.resourcePath,
    databaseId: null,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    bodyHTML: '',
    bodyText: issue.body ?? '',
    closed: issue.state === 'closed',
    closedAt: issue.closedAt ? new Date(issue.closedAt) : null,
    createdAt: new Date(issue.createdAt),
    updatedAt: new Date(issue.updatedAt),
    locked: false,
    includesCreatedEdit: issue.updatedAt !== issue.createdAt,
    viewerCanUpdate: issue.viewerCanEdit,
    url: `${repository.url}/${path}/${issue.number}`,
    resourcePath: `${repository.resourcePath}/${path}/${issue.number}`,
  };
}

// Mapper: IssuesService.getIssues/getIssue already expand authors, labels and assignees for Ghost's API; the GitHub shape renames and re-cases those fields.
export function toIssueNode(issue: IssueDTO, repository: RepositoryRefs) {
  const closed = issue.state === 'closed';
  return Object.assign(new IssueNode(), issueOrPullRequestFields(issue, repository, 'issues'), {
    id: encodeNodeId('Issue', issue.id),
    state: closed ? IssueState.CLOSED : IssueState.OPEN,
    // ponytail: Ghost records no close reason; every close reads as COMPLETED until it does.
    stateReason: closed ? IssueStateReason.COMPLETED : null,
    isPinned: false,
  });
}

// Mapper: same source as toIssueNode; a number that belongs to a pull request answers as one.
export function toPullRequestNode(issue: IssueDTO, repository: RepositoryRefs) {
  return Object.assign(new PullRequestNode(), issueOrPullRequestFields(issue, repository, 'pull'), {
    id: encodeNodeId('PullRequest', issue.id),
    // ponytail: merged requests read as CLOSED until milestone 3 reads pull_request.state.
    state: issue.state === 'closed' ? PullRequestState.CLOSED : PullRequestState.OPEN,
  });
}

export type CommentRow = { id: string; body: string; createdAt: string; updatedAt: string; authorUsername: string };

// Mapper: IssuesService.getComments selects Ghost's comment columns for its own API.
export function toIssueCommentNode(comment: CommentRow, issue: Pick<IssueOrPullRequestFields, 'ownerLogin' | 'url' | 'resourcePath'>, viewerLogin: string | null) {
  return Object.assign(new IssueCommentNode(), {
    ghostId: comment.id,
    authorLogin: comment.authorUsername,
    id: encodeNodeId('IssueComment', comment.id),
    body: comment.body,
    createdAt: new Date(comment.createdAt),
    updatedAt: new Date(comment.updatedAt),
    includesCreatedEdit: comment.updatedAt !== comment.createdAt,
    isMinimized: false,
    minimizedReason: null,
    // ponytail: OWNER or NONE only; MEMBER and COLLABORATOR need a role lookup per author.
    authorAssociation: comment.authorUsername === issue.ownerLogin ? CommentAuthorAssociation.OWNER : CommentAuthorAssociation.NONE,
    viewerDidAuthor: comment.authorUsername === viewerLogin,
    url: `${issue.url}#issuecomment-${comment.id}`,
    resourcePath: `${issue.resourcePath}#issuecomment-${comment.id}`,
  });
}
