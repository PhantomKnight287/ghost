import type { schema } from '@ghost/db';

import { OrganizationNode } from '../../github/graphql/types/organization.type.js';
import { UserNode } from '../../github/graphql/types/user.type.js';
import { encodeNodeId } from './node-id.js';
import type { GithubOrigins } from './origins.js';

import type { AuthorizedRepository } from '../repositories/access/repository-access.js';
import { RepositoryNode } from '../../github/graphql/types/repository.type.js';
import {
  RepositoryPermission,
  RepositoryVisibility,
} from '../../github/graphql/enums.js';
import { repositoryPermissionOf } from './permission.js';
import type { LabelDTO } from '../../resources/issues/dto/label.dto.js';
import { LabelNode } from '../../github/graphql/types/label.type.js';

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
    createdAt: label.createdAt,
    updatedAt: label.updatedAt,
  });
}
