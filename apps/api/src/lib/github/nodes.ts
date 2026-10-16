import type { schema } from '@ghost/db';

import {
  CommentAuthorAssociation,
  IssueState,
  IssueStateReason,
  PullRequestReviewState,
  PullRequestState,
  RepositoryPermission,
  RepositoryVisibility,
} from '../../github/graphql/enums.js';
import { IssueNode } from '../../github/graphql/types/issue.type.js';
import { IssueCommentNode } from '../../github/graphql/types/issue-comment.type.js';
import type { IssueOrPullRequestFields } from '../../github/graphql/types/issue-or-pull-request.type.js';
import { LabelNode } from '../../github/graphql/types/label.type.js';
import { OrganizationNode } from '../../github/graphql/types/organization.type.js';
import {
  CommitNode,
  PullRequestNode,
  PullRequestReviewNode,
} from '../../github/graphql/types/pull-request.type.js';
import { ReleaseNode } from '../../github/graphql/types/release.type.js';
import {
  RefNode,
  RepositoryNode,
} from '../../github/graphql/types/repository.type.js';
import { UserNode } from '../../github/graphql/types/user.type.js';
import type { CombinedCommitStatusDTO } from '../../resources/commit-statuses/dto/commit-status.dto.js';
import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import type { ReleaseDTO } from '../../resources/releases/dto/release.dto.js';
import type { Commit } from '../git/commits/list-commits.js';
import type { AuthorizedRepository } from '../repositories/access/repository-access.js';
import type { ReviewRow } from './loaders.js';
import { encodeNodeId } from './node-id.js';
import type { PullRequestRow } from './node-lookup.js';
import type { GithubOrigins } from './origins.js';
import { repositoryPermissionOf } from './permission.js';
import { tagPath } from './rest.js';

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
    databaseId: row.numericId,
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
    databaseId: row.numericId,
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
    databaseId: row.numericId,
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
export function toLabelNode(
  label: LabelDTO,
  repository: { url: string; resourcePath: string },
) {
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

type RepositoryRefs = Pick<
  RepositoryNode,
  'ghostId' | 'ownerLogin' | 'slug' | 'url' | 'resourcePath'
>;

/** What toIssueNode and toPullRequestNode share; `path` is `issues` or `pull`, as GitHub's URLs have it. */
function issueOrPullRequestFields(
  issue: IssueDTO,
  repository: RepositoryRefs,
  path: 'issues' | 'pull',
) {
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
  return Object.assign(
    new IssueNode(),
    issueOrPullRequestFields(issue, repository, 'issues'),
    {
      id: encodeNodeId('Issue', issue.id),
      state: closed ? IssueState.CLOSED : IssueState.OPEN,
      // ponytail: Ghost records no close reason; every close reads as COMPLETED until it does.
      stateReason: closed ? IssueStateReason.COMPLETED : null,
      isPinned: false,
    },
  );
}

// Mapper: same source as toIssueNode, plus the pull_request row; IssueDTO carries the labels, assignees and close time a pull request shares with an issue.
export function toPullRequestNode(
  issue: IssueDTO,
  repository: RepositoryRefs,
  pull: PullRequestRow,
) {
  return Object.assign(
    new PullRequestNode(),
    issueOrPullRequestFields(issue, repository, 'pull'),
    {
      id: encodeNodeId('PullRequest', issue.id),
      pullRequestGhostId: pull.id,
      baseRepositoryGhostId: pull.baseRepositoryId,
      headRepositoryGhostId: pull.headRepositoryId,
      storedHeadSha: pull.headSha,
      mergeCommitSha: pull.mergeCommitSha,
      state:
        pull.state === 'merged'
          ? PullRequestState.MERGED
          : pull.state === 'closed'
            ? PullRequestState.CLOSED
            : PullRequestState.OPEN,
      isDraft: pull.draft,
      merged: pull.state === 'merged',
      mergedAt: pull.mergedAt,
      mergedByLogin: pull.state === 'merged' ? issue.closedByUsername : null,
      baseRefName: pull.baseRef,
      headRefName: pull.headRef,
      isCrossRepository: pull.headRepositoryId !== pull.baseRepositoryId,
      // ponytail: Ghost has no "allow edits by maintainers"; a fork's branch is never writable from the base, so false.
      maintainerCanModify: false,
    },
  );
}

/** A branch as GitHub's Ref; the id is opaque and only needs to be stable. */
export function toRefNode(repositoryGhostId: string, name: string) {
  return Object.assign(new RefNode(), {
    id: encodeNodeId('Repository', `${repositoryGhostId}:refs/heads/${name}`),
    name,
    prefix: 'refs/heads/',
    branchProtectionRule: null,
  });
}

export type CommentRow = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorUsername: string;
};

// Mapper: IssuesService.getComments selects Ghost's comment columns for its own API.
export function toIssueCommentNode(
  comment: CommentRow,
  issue: Pick<IssueOrPullRequestFields, 'ownerLogin' | 'url' | 'resourcePath'>,
  viewerLogin: string | null,
) {
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
    authorAssociation:
      comment.authorUsername === issue.ownerLogin
        ? CommentAuthorAssociation.OWNER
        : CommentAuthorAssociation.NONE,
    viewerDidAuthor: comment.authorUsername === viewerLogin,
    url: `${issue.url}#issuecomment-${comment.id}`,
    resourcePath: `${issue.resourcePath}#issuecomment-${comment.id}`,
  });
}

// Mapper: reviews come from the per-request loader, whose rows other fields (reviewDecision) read too.
export function toPullRequestReviewNode(
  review: ReviewRow,
  pull: Pick<
    PullRequestNode,
    | 'ownerLogin'
    | 'repoSlug'
    | 'number'
    | 'url'
    | 'resourcePath'
    | 'repositoryGhostId'
    | 'repositoryUrl'
    | 'repositoryResourcePath'
  >,
) {
  const anchor = `#pullrequestreview-${review.id}`;
  return Object.assign(new PullRequestReviewNode(), {
    authorLogin: review.authorLogin,
    commitSha: review.commitSha,
    pullRequest: pull,
    id: encodeNodeId('PullRequestReview', review.id),
    databaseId: review.numericId,
    body: review.body ?? '',
    state: review.dismissed
      ? PullRequestReviewState.DISMISSED
      : review.state === 'approved'
        ? PullRequestReviewState.APPROVED
        : review.state === 'changes_requested'
          ? PullRequestReviewState.CHANGES_REQUESTED
          : PullRequestReviewState.COMMENTED,
    // ponytail: OWNER or NONE only, as for comments.
    authorAssociation:
      review.authorLogin === pull.ownerLogin
        ? CommentAuthorAssociation.OWNER
        : CommentAuthorAssociation.NONE,
    createdAt: review.createdAt,
    submittedAt: review.submittedAt,
    includesCreatedEdit: false,
    url: `${pull.url}${anchor}`,
    resourcePath: `${pull.resourcePath}${anchor}`,
  });
}

// Mapper: commits come from git log, in Ghost's shape; GitActor.user resolves each email to an account.
export function toCommitNode(
  commit: Commit & { status?: CombinedCommitStatusDTO | null },
  repository: { ghostId: string; url: string; resourcePath: string },
) {
  return Object.assign(new CommitNode(), {
    author: { name: commit.authorName, email: commit.authorEmail },
    committer: { name: commit.committerName, email: commit.committerEmail },
    id: encodeNodeId('Commit', `${repository.ghostId}:${commit.sha}`),
    oid: commit.sha,
    abbreviatedOid: commit.sha.slice(0, 7),
    message: [commit.subject, commit.body].filter(Boolean).join('\n\n'),
    messageHeadline: commit.subject,
    messageBody: commit.body,
    authoredDate: new Date(commit.authoredAt),
    committedDate: new Date(commit.committedAt),
    url: `${repository.url}/commit/${commit.sha}`,
    resourcePath: `${repository.resourcePath}/commit/${commit.sha}`,
    repositoryGhostId: repository.ghostId,
    status: commit.status ?? null,
  });
}

// Mapper: releases come from ReleasesService in Ghost's shape; the node adds the integer id releaseNumericIdsOf loads and the web URLs.
export function toReleaseNode(
  release: ReleaseDTO,
  numericId: number | null,
  repository: { url: string; resourcePath: string },
) {
  const path = `/releases/tag/${tagPath(release.tagName)}`;
  return Object.assign(new ReleaseNode(), {
    id: encodeNodeId('Release', release.id),
    databaseId: numericId,
    name: release.name,
    tagName: release.tagName,
    description: release.body,
    isDraft: release.isDraft,
    isLatest: release.isLatest,
    isPrerelease: release.isPrerelease,
    createdAt: new Date(release.createdAt),
    publishedAt: release.publishedAt ? new Date(release.publishedAt) : null,
    updatedAt: new Date(release.updatedAt),
    url: `${repository.url}${path}`,
    resourcePath: `${repository.resourcePath}${path}`,
  });
}
