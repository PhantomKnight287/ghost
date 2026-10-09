import type { Role } from '@ghost/permissions';
import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { RepositoryPermission, RepositoryVisibility } from '../enums.js';
import { GitSSHRemote, URI } from '../scalars.js';
import { Node, RepositoryOwner, UniformResourceLocatable } from './node.interface.js';

@ObjectType('Ref', { implements: () => [Node] })
export class RefNode {
  kind = 'Ref';

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  prefix: string;
}

@ObjectType('Repository', { implements: () => [Node, UniformResourceLocatable] })
export class RepositoryNode {
  kind = 'Repository';
  ghostId: string;
  ownerGhostId: string;
  organizationGhostId: string | null;
  parentGhostId: string | null;
  ownerLogin: string;
  slug: string;
  defaultBranch: string | null;
  viewerRole: Role | null;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field()
  name: string;

  @Field()
  nameWithOwner: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  isPrivate: boolean;

  @Field()
  isFork: boolean;

  @Field()
  isArchived: boolean;

  @Field()
  isEmpty: boolean;

  @Field(() => RepositoryVisibility)
  visibility: RepositoryVisibility;

  @Field()
  hasIssuesEnabled: boolean;

  @Field()
  hasWikiEnabled: boolean;

  @Field()
  hasProjectsEnabled: boolean;

  @Field()
  mergeCommitAllowed: boolean;

  @Field()
  rebaseMergeAllowed: boolean;

  @Field()
  squashMergeAllowed: boolean;

  @Field(() => GitSSHRemote)
  sshUrl: string;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  pushedAt: Date | null;

  @Field(() => RepositoryPermission, { nullable: true })
  viewerPermission: RepositoryPermission | null;
}

export const RepositoryConnection = Connection(RepositoryNode, 'Repository');
