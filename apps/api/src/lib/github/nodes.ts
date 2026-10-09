import type { schema } from '@ghost/db';

import { OrganizationNode } from '../../github/graphql/types/organization.type.js';
import { UserNode } from '../../github/graphql/types/user.type.js';
import { encodeNodeId } from './node-id.js';
import type { GithubOrigins } from './origins.js';

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
export function toOrganizationNode(row: OrganizationRow, { web }: GithubOrigins) {
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
